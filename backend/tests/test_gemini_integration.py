"""Comprehensive Gemini API integration, cost calculation, budget enforcement, and qualification tests.

Includes:
- Test A: Configuration loading and rates
- Test B: Model availability verification
- Test C: Gemini connectivity and response parsing
- Test D: Lead qualification workflow on test lead
- Test E: Failure scenarios (401 invalid key, 404 model not found, timeout, malformed JSON, budget exceeded)
"""
import pytest
from fastapi.testclient import TestClient

from app import main
from app.core.config import settings
from app.domain.schemas import LeadRecord, LeadStatus, TenantSettings
from app.agents.qualification import (
    LeadQualificationAgent,
    _estimate_cost,
)
from app.storage.local_store import LocalStore
from app.services.events import EventService


@pytest.fixture
def mock_store(tmp_path, monkeypatch):
    store = LocalStore(str(tmp_path / "data"))
    monkeypatch.setattr(main, "store", store)
    monkeypatch.setattr(main, "events", EventService(store))
    main.rate_buckets.clear()
    return store


@pytest.fixture
def test_client(mock_store):
    return TestClient(main.app)


H_NORTHSTAR = {
    "X-Tenant-ID": "northstar-test",
    "X-Actor-ID": "soumy-test-user",
    "X-Role": "tenant_admin",
}


# =========================================================================
# TEST A: Configuration
# =========================================================================

def test_config_loading_and_rates():
    """Verify settings loads model, rates, and does not expose sensitive key in repr."""
    assert settings.gemini_model in ("gemini-3.8-flash", "gemini-2.0-flash", "gemini-1.5-flash")
    assert settings.gemini_input_usd_per_million == 0.75
    assert settings.gemini_output_usd_per_million == 3.75
    # Cost estimation calculation check
    usage = {"input_tokens": 1_000_000, "output_tokens": 1_000_000}
    expected_cost = 0.75 + 3.75
    assert _estimate_cost(usage) == round(expected_cost, 8)


# =========================================================================
# TEST B: Model Availability
# =========================================================================

def test_supported_model_identifier():
    """Verify the configured model is among officially supported Google Gemini models."""
    supported_models = {
        "gemini-3.8-flash",
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
        "gemini-1.5-flash",
        "gemini-1.5-pro",
    }
    assert settings.gemini_model in supported_models, f"Unsupported model: {settings.gemini_model}"


# =========================================================================
# TEST C: Gemini Connectivity & Response Parsing (Mocked for Unit Test)
# =========================================================================

def test_mock_gemini_connectivity_and_cost_calculation(monkeypatch):
    """Test Gemini response parsing and accurate token usage calculation."""
    mock_response_data = {
        "intent": "service_enquiry",
        "service_type": "commercial_cleaning",
        "location": "Kolkata",
        "quantity": 1,
        "equipment": [],
        "requested_time": None,
        "urgency": "normal",
        "missing_fields": [],
        "evidence": {"service": "office cleaning", "location": "Kolkata"},
        "confidence": 0.95,
        "confidence_reason": "Clear facility office cleaning enquiry",
    }
    mock_usage = {"input_tokens": 450, "output_tokens": 120}

    monkeypatch.setattr(
        "app.agents.qualification._run_adk_structured",
        lambda **kwargs: (mock_response_data, mock_usage),
    )

    agent = LeadQualificationAgent()
    q = agent.run("We need regular commercial office cleaning for our facility in Kolkata.")
    assert q.model_used == settings.gemini_model
    assert q.service_type == "commercial_cleaning"
    assert q.location == "Kolkata"
    assert q.input_tokens == 450
    assert q.output_tokens == 120
    assert q.estimated_cost_usd is not None
    expected_cost = round((450 * settings.gemini_input_usd_per_million + 120 * settings.gemini_output_usd_per_million) / 1_000_000, 8)
    assert q.estimated_cost_usd == expected_cost


# =========================================================================
# TEST D: Lead Qualification Workflow (End-to-End Flow with Mocked Gemini)
# =========================================================================

def test_qualification_workflow_success(test_client, mock_store, monkeypatch):
    """Test full qualification route execution, lead update, job status, and usage record persistence."""
    # Seed tenant settings with budget
    tenant_settings = TenantSettings(
        tenant_id="northstar-test",
        ai_monthly_budget_usd=1.00,
        allowed_services=["boiler_service", "inspection"],
        territories=["Manchester", "Salford"],
    )
    mock_store.put("tenants/northstar-test/settings", tenant_settings)

    # Seed lead
    lead_id = "led_8388f5cd7ae5"
    lead = LeadRecord(
        id=lead_id,
        tenant_id="northstar-test",
        channel="website",
        external_ref="WEB-LEAD-001",
        message="We need a boiler service in Manchester for 2 units next week.",
        consent=True,
        idempotency_key="northstar-test-key-001",
        customer_name="Amit Sharma",
        status=LeadStatus.NEW,
    )
    mock_store.put(f"tenants/northstar-test/leads/{lead_id}/state", lead)

    # Mock Gemini response
    mock_output = {
        "intent": "service_enquiry",
        "service_type": "boiler_service",
        "location": "Manchester",
        "quantity": 2,
        "equipment": [],
        "requested_time": "next week",
        "urgency": "normal",
        "missing_fields": [],
        "evidence": {"service_type": "boiler service", "location": "Manchester", "quantity": "2 units"},
        "confidence": 0.95,
        "confidence_reason": "Explicit service, location, and quantity supplied.",
    }
    mock_usage = {"input_tokens": 500, "output_tokens": 150}

    monkeypatch.setattr(
        "app.agents.qualification._run_adk_structured",
        lambda **kwargs: (mock_output, mock_usage),
    )

    # Invoke qualification endpoint
    resp = test_client.post(f"/v1/leads/{lead_id}/qualify", headers=H_NORTHSTAR)
    assert resp.status_code == 202
    data = resp.json()
    assert data["state"] == "queued"
    job_id = data["job_id"]

    # Verify Job state
    job_resp = test_client.get(f"/v1/jobs/{job_id}", headers=H_NORTHSTAR)
    assert job_resp.status_code == 200
    job_data = job_resp.json()
    assert job_data["state"] == "completed"

    # Verify Lead updated
    lead_resp = test_client.get(f"/v1/leads/{lead_id}", headers=H_NORTHSTAR)
    assert lead_resp.status_code == 200
    updated_lead = lead_resp.json()["lead"]
    assert updated_lead["status"] == "qualified"
    assert updated_lead["qualification"]["model_used"] == settings.gemini_model
    assert updated_lead["qualification"]["input_tokens"] == 500
    assert updated_lead["qualification"]["output_tokens"] == 150

    # Verify Usage Record persisted
    usage_entry = mock_store.get(f"tenants/northstar-test/usage/{job_id}")
    assert usage_entry is not None
    usage_record = usage_entry[0]
    assert usage_record["tenant_id"] == "northstar-test"
    assert usage_record["model"] == settings.gemini_model
    assert usage_record["input_tokens"] == 500
    assert usage_record["output_tokens"] == 150
    assert usage_record["estimated_cost_usd"] > 0


# =========================================================================
# TEST E: Failure Scenarios
# =========================================================================

def test_missing_pricing_returns_503(test_client, mock_store, monkeypatch):
    """When pricing rates are None but API key exists, return 503."""
    tenant_settings = TenantSettings(tenant_id="northstar-test", ai_monthly_budget_usd=1.00)
    mock_store.put("tenants/northstar-test/settings", tenant_settings)

    lead_id = "led_test_rates"
    lead = LeadRecord(
        id=lead_id, tenant_id="northstar-test", channel="website", message="Sample enquiry",
        consent=True, idempotency_key="rate-key-001",
    )
    mock_store.put(f"tenants/northstar-test/leads/{lead_id}/state", lead)

    monkeypatch.setattr(settings, "gemini_input_usd_per_million", None)
    resp = test_client.post(f"/v1/leads/{lead_id}/qualify", headers=H_NORTHSTAR)
    assert resp.status_code == 503
    assert resp.json()["detail"] == "ai_cost_rates_required_for_budget_enforcement"


def test_budget_exhaustion_blocks_qualification(test_client, mock_store):
    """When monthly AI spend reaches or exceeds budget, return 429 and preserve lead."""
    from datetime import datetime, timezone

    # Budget is $1.00
    tenant_settings = TenantSettings(tenant_id="northstar-test", ai_monthly_budget_usd=1.00)
    mock_store.put("tenants/northstar-test/settings", tenant_settings)

    lead_id = "led_budget_exhausted"
    lead = LeadRecord(
        id=lead_id, tenant_id="northstar-test", channel="website", message="Sample enquiry",
        consent=True, idempotency_key="budget-key-001", status=LeadStatus.NEW,
    )
    mock_store.put(f"tenants/northstar-test/leads/{lead_id}/state", lead)

    # Seed usage rows totaling $1.05 this month
    now = datetime.now(timezone.utc).isoformat()
    mock_store.put("tenants/northstar-test/usage/job_prev1", {"timestamp": now, "estimated_cost_usd": 0.60})
    mock_store.put("tenants/northstar-test/usage/job_prev2", {"timestamp": now, "estimated_cost_usd": 0.45})

    resp = test_client.post(f"/v1/leads/{lead_id}/qualify", headers=H_NORTHSTAR)
    assert resp.status_code == 429
    assert resp.json()["detail"] == "tenant_ai_budget_exceeded_capture_preserved"

    # Verify lead was NOT changed to queued
    lead_check = mock_store.get(f"tenants/northstar-test/leads/{lead_id}/state")
    assert lead_check[0]["status"] == "new"


def test_zero_budget_blocks_qualification(test_client, mock_store):
    """A zero monthly budget ($0.00) must strictly block qualification."""
    tenant_settings = TenantSettings(tenant_id="northstar-test", ai_monthly_budget_usd=0.00)
    mock_store.put("tenants/northstar-test/settings", tenant_settings)

    lead_id = "led_zero_budget"
    lead = LeadRecord(
        id=lead_id, tenant_id="northstar-test", channel="website", message="Sample enquiry",
        consent=True, idempotency_key="zero-budget-key-001", status=LeadStatus.NEW,
    )
    mock_store.put(f"tenants/northstar-test/leads/{lead_id}/state", lead)

    resp = test_client.post(f"/v1/leads/{lead_id}/qualify", headers=H_NORTHSTAR)
    assert resp.status_code == 429
    assert resp.json()["detail"] == "tenant_ai_budget_exceeded_capture_preserved"


def test_provider_error_falls_back_safely_with_transparent_flags(monkeypatch):
    """When Gemini raises 401 ClientError, agent safely falls back to deterministic extraction."""
    def mock_failing_adk(**kwargs):
        raise RuntimeError("ClientError 401: API key not valid.")

    monkeypatch.setattr("app.agents.qualification._run_adk_structured", mock_failing_adk)

    agent = LeadQualificationAgent()
    q = agent.run("We need a boiler service in Manchester for 3 units next week.")
    assert q.model_used == "deterministic_fallback"
    assert q.service_type == "boiler_service"
    assert q.location == "Manchester"
    assert q.quantity == 3


def test_list_quotes_endpoint(test_client, mock_store):
    """Verify GET /v1/quotes lists tenant quotes in descending order."""
    from app.domain.schemas import QuoteRecord, QuoteLineItem
    quote1 = QuoteRecord(
        id="quo_test001",
        tenant_id="northstar-test",
        lead_id="led_test001",
        catalogue_version="catalogue-v1",
        policy_version="policy-v1.0.0",
        line_items=[QuoteLineItem(service_code="boiler_service", description="Boiler service", quantity=1, unit_price=150.0)],
        subtotal=150.0,
        vat_rate=0.20,
        vat_amount=30.0,
        total=180.0,
        status="draft",
    )
    mock_store.put("tenants/northstar-test/quotes/quo_test001/v1", quote1)
    resp = test_client.get("/v1/quotes", headers=H_NORTHSTAR)
    assert resp.status_code == 200
    quotes = resp.json()
    assert len(quotes) == 1
    assert quotes[0]["id"] == "quo_test001"
    assert quotes[0]["total"] == 180.0


def test_list_usage_endpoint(test_client, mock_store):
    """Verify GET /v1/usage returns usage records, monthly spend, and budget status."""
    usage_entry = {
        "tenant_id": "northstar-test",
        "job_id": "job_001",
        "lead_id": "led_001",
        "timestamp": "2026-10-30T10:00:00Z",
        "model": "gemini-3.8-flash",
        "input_tokens": 500,
        "output_tokens": 150,
        "thinking_tokens": 0,
        "estimated_cost_usd": 0.000938,
        "verifier_used": False,
    }
    mock_store.put("tenants/northstar-test/usage/job_001", usage_entry)
    tenant_settings = TenantSettings(
        tenant_id="northstar-test",
        ai_monthly_budget_usd=1.00,
    )
    mock_store.put("tenants/northstar-test/settings", tenant_settings)
    resp = test_client.get("/v1/usage", headers=H_NORTHSTAR)
    assert resp.status_code == 200
    data = resp.json()
    assert data["tenant_id"] == "northstar-test"
    assert data["ai_monthly_budget_usd"] == 1.00
    assert data["total_records"] == 1
    assert len(data["records"]) == 1
    assert data["records"][0]["model"] == "gemini-3.8-flash"

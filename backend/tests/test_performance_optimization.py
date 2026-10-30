"""Performance optimization tests for Lead-to-Order Agent qualification workflow.

Validates:
1. Limited retries and fast prompt fallback on Gemini 503 / 429 errors (< 3s with mock).
2. Verifier skips redundant external model call when primary agent fell back to deterministic fallback.
3. Timeout and retry configuration enforcement.
4. Prevention of duplicate qualification jobs for the same lead.
5. End-to-end timing measurements recorded in Qualification, JobRecord, and UsageRecord.
"""
import time
from unittest.mock import MagicMock
import pytest
from fastapi.testclient import TestClient

from app import main
from app.core.config import settings
from app.domain.schemas import LeadRecord, LeadStatus, TenantSettings, JobRecord, Qualification
from app.agents.qualification import (
    AgentOrchestrator,
    EvidenceVerificationAgent,
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
    "X-Actor-ID": "test-perf-user",
    "X-Role": "tenant_admin",
}


def test_gemini_timeout_and_retry_settings():
    """Verify default Gemini timeout, max retries, and delay settings."""
    assert settings.gemini_timeout_seconds == 8.0
    assert settings.gemini_max_retries == 1
    assert settings.gemini_retry_delay_seconds == 1.0


def test_gemini_503_limited_retry_and_fast_fallback(monkeypatch):
    """Verify that a 503 Service Unavailable triggers immediate deterministic fallback without stalling."""
    call_count = 0

    def mock_503(**kwargs):
        nonlocal call_count
        call_count += 1
        raise Exception("503 Service Unavailable")

    monkeypatch.setattr("app.agents.qualification._run_adk_structured", mock_503)

    tenant = TenantSettings(tenant_id="northstar-test")
    orchestrator = AgentOrchestrator()

    start_time = time.perf_counter()
    qualification = orchestrator.qualify("Need boiler service in Manchester for 2 units next week", tenant)
    elapsed_ms = (time.perf_counter() - start_time) * 1000

    # Ensure deterministic fallback was used
    assert qualification.model_used == "deterministic_fallback"
    assert qualification.service_type == "boiler_service"
    assert qualification.location == "Manchester"
    assert qualification.quantity == 2

    # Verification must be fast (mocked failure returns immediately)
    assert elapsed_ms < 500.0, f"Fallback took too long: {elapsed_ms}ms"

    # Verify timing breakdown was captured
    assert "gemini_duration_ms" in qualification.timing_ms
    assert "fallback_duration_ms" in qualification.timing_ms
    assert "agent_total_ms" in qualification.timing_ms
    assert qualification.timing_ms["agent_total_ms"] > 0


def test_gemini_429_quota_exhaustion_fast_fallback(monkeypatch):
    """Verify that a 429 RESOURCE_EXHAUSTED triggers fast fallback."""
    def mock_429(**kwargs):
        raise Exception("429 Resource has been exhausted (e.g. check quota).")

    monkeypatch.setattr("app.agents.qualification._run_adk_structured", mock_429)

    tenant = TenantSettings(tenant_id="northstar-test")
    orchestrator = AgentOrchestrator()

    qualification = orchestrator.qualify("Urgent boiler service needed in Salford", tenant)
    assert qualification.model_used == "deterministic_fallback"
    assert qualification.service_type == "boiler_service"
    assert qualification.location == "Salford"
    assert qualification.urgency == "urgent"


def test_verifier_skips_external_call_on_deterministic_fallback(monkeypatch):
    """Verify that EvidenceVerificationAgent does NOT call Gemini if primary agent already fell back."""
    mock_run = MagicMock(side_effect=Exception("Should not be called"))
    monkeypatch.setattr("app.agents.qualification._run_adk_structured", mock_run)

    verifier = EvidenceVerificationAgent()
    fallback_qual = Qualification(
        model_used="deterministic_fallback",
        service_type="boiler_service",
        location="Manchester",
        quantity=2,
        missing_fields=[],
        confidence=0.65,
    )

    result = verifier.verify("We need boiler service in Manchester for 2 units", fallback_qual)

    # _run_adk_structured should NEVER have been invoked by verifier
    mock_run.assert_not_called()
    assert result.model_used == "deterministic_fallback"
    assert "verifier_duration_ms" in result.timing_ms
    # Local verification is sub-millisecond
    assert result.timing_ms["verifier_duration_ms"] < 50.0


def test_duplicate_qualification_prevention(test_client, mock_store):
    """Verify that qualify_lead returns existing active job if already queued/running."""
    lead = LeadRecord(
        id="led_test_dup",
        tenant_id="northstar-test",
        channel="website",
        message="Need site inspection in Stockport",
        consent=True,
        idempotency_key="test_idem_dup_123",
        status=LeadStatus.QUALIFICATION_QUEUED,
    )
    mock_store.put("tenants/northstar-test/leads/led_test_dup/state", lead)

    existing_job = JobRecord(
        id="job_existing_123",
        tenant_id="northstar-test",
        lead_id="led_test_dup",
        state="queued",
    )
    mock_store.put("tenants/northstar-test/jobs/job_existing_123/state", existing_job)

    # Trigger qualification on already queued lead
    response = test_client.post("/v1/leads/led_test_dup/qualify", headers=H_NORTHSTAR)
    assert response.status_code == 202
    data = response.json()

    assert data["job_id"] == "job_existing_123"
    assert data["state"] == "queued"
    assert data["dispatch_mode"] == "existing_active_job"


def test_timing_measurements_recorded_end_to_end(mock_store, monkeypatch):
    """Verify end-to-end timing_ms recording in Qualification, JobRecord, and UsageRecord."""
    def mock_503(**kwargs):
        raise Exception("503 Service Unavailable")

    monkeypatch.setattr("app.agents.qualification._run_adk_structured", mock_503)

    lead_id = "led_timing_test"
    job_id = "job_timing_test"
    tenant_id = "northstar-test"

    lead = LeadRecord(
        id=lead_id,
        tenant_id=tenant_id,
        channel="website",
        message="Need maintenance in Manchester for 1 boiler next week",
        consent=True,
        idempotency_key="test_idem_timing_456",
        status=LeadStatus.QUALIFICATION_QUEUED,
    )
    mock_store.put(f"tenants/{tenant_id}/leads/{lead_id}/state", lead)

    job = JobRecord(
        id=job_id,
        tenant_id=tenant_id,
        lead_id=lead_id,
        state="queued",
    )
    mock_store.put(f"tenants/{tenant_id}/jobs/{job_id}/state", job)

    # Run processing directly
    main._process_qualification(lead_id, tenant_id, job_id)

    # 1. Verify JobRecord
    job_found = mock_store.get(f"tenants/{tenant_id}/jobs/{job_id}/state")
    assert job_found is not None
    job_rec = JobRecord.model_validate(job_found[0])
    assert job_rec.state == "completed"
    assert "total_duration_ms" in job_rec.timing_ms
    assert "storage_duration_ms" in job_rec.timing_ms
    assert job_rec.timing_ms["total_duration_ms"] > 0

    # 2. Verify LeadRecord qualification
    lead_found = mock_store.get(f"tenants/{tenant_id}/leads/{lead_id}/state")
    assert lead_found is not None
    lead_rec = LeadRecord.model_validate(lead_found[0])
    assert lead_rec.qualification is not None
    q_timing = lead_rec.qualification.timing_ms
    assert "total_duration_ms" in q_timing
    assert "storage_duration_ms" in q_timing
    assert "fallback_duration_ms" in q_timing
    assert "gemini_duration_ms" in q_timing

    # 3. Verify Usage record
    usage_found = mock_store.get(f"tenants/{tenant_id}/usage/{job_id}")
    assert usage_found is not None
    usage_data = usage_found[0]
    assert "timing_ms" in usage_data
    assert usage_data["timing_ms"]["total_duration_ms"] > 0

"""Performance optimization tests for Lead-to-Order Agent qualification workflow.

Validates:
1. Limited retries and fast prompt fallback on Gemini 503 / 429 errors (< 3s with mock).
2. Verifier skips redundant external model call when primary agent fell back to deterministic fallback.
3. Timeout and retry configuration enforcement.
4. Prevention of duplicate qualification jobs for the same lead.
5. End-to-end timing measurements recorded in Qualification, JobRecord, and UsageRecord.
"""
import time
from types import SimpleNamespace
from unittest.mock import MagicMock
import pytest
from fastapi.testclient import TestClient

from app import main
from app.core.config import settings
from app.domain.schemas import LeadRecord, LeadStatus, TenantSettings, JobRecord, Qualification
from app.agents.qualification import (
    AgentOrchestrator,
    EvidenceVerificationAgent,
    LeadQualificationAgent,
    QualificationOutput,
    _run_adk_structured,
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


def test_gemini_http_timeout_meets_provider_minimum(monkeypatch):
    """Gemini rejects request deadlines shorter than 10 seconds."""
    captured = {}

    class FakeClient:
        def __init__(self, *, api_key, http_options):
            captured["timeout_ms"] = http_options.timeout
            self.models = SimpleNamespace(
                generate_content=lambda **kwargs: SimpleNamespace(
                    usage_metadata=None, text="{}"
                )
            )

    monkeypatch.setattr("app.agents.qualification.settings.google_api_key", "test-key")
    monkeypatch.setattr("google.genai.Client", FakeClient)
    monkeypatch.setattr(settings, "gemini_timeout_seconds", 8.0)

    _run_adk_structured(
        name="timeout_test",
        instruction="Return structured output.",
        user_message="{}",
        output_schema=QualificationOutput,
    )

    assert captured["timeout_ms"] >= 10_000


def test_gemini_retry_attempts_are_bounded_and_exclude_quota_errors(monkeypatch):
    captured = {"attempts": 0, "delays": []}

    class UpstreamError(Exception):
        code = 503

    class FakeClient:
        def __init__(self, *, api_key, http_options):
            captured["sdk_attempts"] = http_options.retry_options.attempts
            captured["retry_statuses"] = http_options.retry_options.http_status_codes
            self.models = SimpleNamespace(generate_content=self.generate_content)

        def generate_content(self, **kwargs):
            captured["attempts"] += 1
            if captured["attempts"] < 3:
                raise UpstreamError("temporary unavailable")
            return SimpleNamespace(usage_metadata=None, text="{}")

    monkeypatch.setattr("app.agents.qualification.settings.google_api_key", "test-key")
    monkeypatch.setattr("google.genai.Client", FakeClient)
    monkeypatch.setattr(settings, "gemini_max_retries", 8)
    monkeypatch.setattr(settings, "gemini_retry_delay_seconds", 1.0)
    monkeypatch.setattr(
        "app.agents.qualification.time.sleep",
        lambda delay: captured["delays"].append(delay),
    )

    _, usage = _run_adk_structured(
        name="retry_test",
        instruction="Return structured output.",
        user_message="{}",
        output_schema=QualificationOutput,
    )

    assert captured["attempts"] == 3
    assert captured["sdk_attempts"] == 1
    assert 429 not in captured["retry_statuses"]
    assert captured["delays"] == [1.0, 2.0]
    assert usage["gemini_attempt_count"] == 3
    assert usage["gemini_retry_count"] == 2
    assert "api_request_duration_ms" in usage
    assert "response_parse_duration_ms" in usage


def test_gemini_429_is_not_retried(monkeypatch):
    captured = {"attempts": 0}

    class QuotaError(Exception):
        code = 429

    class FakeClient:
        def __init__(self, *, api_key, http_options):
            captured["sdk_attempts"] = http_options.retry_options.attempts
            captured["retry_statuses"] = http_options.retry_options.http_status_codes
            self.models = SimpleNamespace(generate_content=self.generate_content)

        def generate_content(self, **kwargs):
            captured["attempts"] += 1
            raise QuotaError("quota exceeded")

    monkeypatch.setattr("app.agents.qualification.settings.google_api_key", "test-key")
    monkeypatch.setattr("google.genai.Client", FakeClient)
    monkeypatch.setattr(settings, "gemini_max_retries", 8)

    with pytest.raises(QuotaError) as error:
        _run_adk_structured(
            name="quota_test",
            instruction="Return structured output.",
            user_message="{}",
            output_schema=QualificationOutput,
        )

    assert captured["attempts"] == 1
    assert captured["sdk_attempts"] == 1
    assert 429 not in captured["retry_statuses"]
    assert error.value.gemini_attempt_count == 1
    assert error.value.gemini_retry_count == 0


def test_primary_qualification_records_preparation_and_validation_timings(monkeypatch):
    monkeypatch.setattr("app.agents.qualification.settings.google_api_key", "test-key")
    monkeypatch.setattr(
        "app.agents.qualification._run_adk_structured",
        lambda **kwargs: (
            {
                "service_type": "boiler_service",
                "location": "Manchester",
                "quantity": 2,
                "requested_time": "10 November 2026",
                "missing_fields": [],
                "evidence": {
                    "service_type": "boiler service",
                    "location": "Manchester",
                    "quantity": "2 units",
                    "requested_time": "10 November 2026",
                },
                "confidence": 0.95,
            },
            {
                "input_tokens": 10,
                "output_tokens": 5,
                "thinking_tokens": 0,
                "api_request_duration_ms": 8.0,
                "response_parse_duration_ms": 0.2,
                "gemini_attempt_count": 1,
                "gemini_retry_count": 0,
                "gemini_retry_delay_ms": 0.0,
            },
        ),
    )

    qualification = LeadQualificationAgent().run(
        "We need boiler service in Manchester for 2 units on 10 November 2026.",
        TenantSettings(tenant_id="northstar-test"),
    )

    assert qualification.model_used == settings.gemini_model
    assert qualification.timing_ms["request_preparation_ms"] >= 0
    assert qualification.timing_ms["gemini_api_request_ms"] == 8.0
    assert qualification.timing_ms["gemini_response_parse_ms"] == 0.2
    assert qualification.timing_ms["pydantic_validation_ms"] >= 0
    assert qualification.timing_ms["primary_gemini_duration_ms"] >= 0


def test_gemini_503_limited_retry_and_fast_fallback(monkeypatch):
    """Verify that a 503 Service Unavailable triggers immediate deterministic fallback without stalling."""
    call_count = 0

    def mock_503(**kwargs):
        nonlocal call_count
        call_count += 1
        raise Exception("503 Service Unavailable")

    monkeypatch.setattr("app.agents.qualification.settings.google_api_key", "test-key")
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


def test_local_verifier_rejects_candidate_fields_without_evidence():
    qualification = Qualification(
        service_type="boiler_service",
        location="Salford",
        quantity=2,
        requested_time="next week",
        evidence={"location": "Salford"},
        confidence=0.95,
    )

    result = EvidenceVerificationAgent._local_verify(
        "We need a boiler service in Salford.", qualification
    )

    assert result.service_type is None
    assert result.quantity is None
    assert result.requested_time is None
    assert result.location == "Salford"


def test_deterministic_fallback_extracts_area_frequency_and_explicit_date():
    tenant = TenantSettings(
        tenant_id="synthetic-cleaning",
        allowed_services=["commercial_cleaning"],
        territories=["Kolkata"],
        service_catalogue={
            "commercial_cleaning": {
                "label": "Office cleaning",
                "unit_price": 1.0,
                "eligible": True,
            }
        },
    )

    qualification = LeadQualificationAgent._fallback(
        "Our office in Kolkata requires daily commercial cleaning for 5,000 square feet, "
        "starting 10 November 2026.",
        False,
        tenant,
    )

    assert qualification.service_type == "commercial_cleaning"
    assert qualification.location == "Kolkata"
    assert qualification.area == "5000 sq ft"
    assert qualification.frequency == "daily"
    assert qualification.requested_time == "10 November 2026"
    assert qualification.evidence["area"] == "5,000 square feet"


def test_local_verifier_rejects_evidence_that_does_not_match_candidate():
    qualification = Qualification(
        location="Salford",
        evidence={"location": "Manchester"},
        confidence=0.95,
    )

    result = EvidenceVerificationAgent._local_verify(
        "We need service in Manchester.", qualification
    )

    assert result.location is None
    assert "location" in result.missing_fields


def test_gemini_verifier_cannot_override_missing_verbatim_evidence(monkeypatch):
    monkeypatch.setattr("app.agents.qualification.settings.google_api_key", "test-key")
    monkeypatch.setattr(
        "app.agents.qualification._run_adk_structured",
        lambda **kwargs: (
            {"supported_fields": ["service_type", "location", "quantity"], "concerns": []},
            {"input_tokens": 10, "output_tokens": 5, "thinking_tokens": 0},
        ),
    )
    qualification = Qualification(
        model_used="gemini-test",
        service_type="boiler_service",
        location="Salford",
        quantity=2,
        evidence={"location": "Manchester"},
        confidence=0.6,
    )

    result = EvidenceVerificationAgent().verify(
        "We need service in Manchester.", qualification
    )

    assert result.service_type is None
    assert result.quantity is None
    assert result.location is None


def test_gemini_verifier_ignores_unknown_concern_labels(monkeypatch):
    monkeypatch.setattr("app.agents.qualification.settings.google_api_key", "test-key")
    monkeypatch.setattr(
        "app.agents.qualification._run_adk_structured",
        lambda **kwargs: (
            {
                "supported_fields": ["service_type", "location", "quantity"],
                "concerns": ["unsupported_field_intent", "unsupported_field_model_used"],
            },
            {"input_tokens": 10, "output_tokens": 5, "thinking_tokens": 0},
        ),
    )
    qualification = Qualification(
        model_used="gemini-test",
        service_type="boiler_service",
        location="Manchester",
        quantity=2,
        evidence={
            "service_type": "boiler service",
            "location": "Manchester",
            "quantity": "2 units",
        },
        confidence=0.95,
    )

    result = EvidenceVerificationAgent().verify(
        "We need boiler service in Manchester for 2 units.", qualification
    )

    assert result.safety_flags == []
    assert result.confidence == 0.95
    assert result.service_type == "boiler_service"
    assert result.quantity == 2


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

    monkeypatch.setattr("app.agents.qualification.settings.google_api_key", "test-key")
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
    assert "policy_evaluation_ms" in q_timing
    assert "gemini_attempt_count" in q_timing
    assert "gemini_api_request_ms" in q_timing
    assert "request_preparation_ms" in q_timing

    # 3. Verify Usage record
    usage_found = mock_store.get(f"tenants/{tenant_id}/usage/{job_id}")
    assert usage_found is not None
    usage_data = usage_found[0]
    assert "timing_ms" in usage_data
    assert usage_data["timing_ms"]["total_duration_ms"] > 0

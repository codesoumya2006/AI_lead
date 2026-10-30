import json
import sys
import time
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

from fastapi.testclient import TestClient
from app.main import app, store

client = TestClient(app)
H = {
    "X-Tenant-ID": "northstar-test",
    "X-Actor-ID": "soumy-test-user",
    "X-Role": "tenant_admin",
}

print("=== CHECKPOINT 1: Health Endpoint ===")
health_res = client.get("/healthz")
assert health_res.status_code == 200, f"Health check failed: {health_res.text}"
health_data = health_res.json()
print("Health status:", health_data.get("status"))
print("Environment:", health_data.get("environment"))
print("Persistence:", health_data.get("persistence"))
print("Model configured:", health_data.get("model_configured"))
print("PASS: Health endpoint\n")

print("=== CHECKPOINT 2: Lead Listing ===")
leads_res = client.get("/v1/leads", headers=H)
assert leads_res.status_code == 200, f"Leads listing failed: {leads_res.text}"
leads = leads_res.json()
print(f"Total leads listed: {len(leads)}")
lead_ids = [l["id"] for l in leads]
assert "led_8388f5cd7ae5" in lead_ids, "Existing lead led_8388f5cd7ae5 not found in list"
print("PASS: Lead listing includes led_8388f5cd7ae5\n")

print("=== CHECKPOINT 3: Lead Details for led_8388f5cd7ae5 ===")
detail_res = client.get("/v1/leads/led_8388f5cd7ae5", headers=H)
assert detail_res.status_code == 200, f"Lead details failed: {detail_res.text}"
orig_lead = detail_res.json()["lead"]
assert orig_lead["id"] == "led_8388f5cd7ae5"
assert orig_lead["status"] == "new"
assert orig_lead["qualification"] is None
assert orig_lead["customer_name"] == "Amit Sharma"
assert orig_lead["consent"] is True
print("Lead ID:", orig_lead["id"])
print("Customer:", orig_lead["customer_name"])
print("Status:", orig_lead["status"])
print("Qualification:", orig_lead["qualification"])
print("PASS: Existing lead data is pristine and uncorrupted\n")

print("=== CHECKPOINT 4: Create Safe Ephemeral Lead for Testing ===")
ephem_key = f"e2e-test-{int(time.time())}"
create_res = client.post(
    "/v1/leads",
    headers=H,
    json={
        "tenant_id": "northstar-test",
        "channel": "website",
        "message": "We need a boiler service in Manchester for 3 units next week.",
        "consent": True,
        "idempotency_key": ephem_key,
        "customer_name": "E2E Test Lead",
        "customer_email": "e2e@example.com",
    },
)
assert create_res.status_code == 201, f"Create lead failed: {create_res.text}"
ephem_lead_id = create_res.json()["lead_id"]
print("Created ephemeral lead:", ephem_lead_id)
print("PASS: Lead creation\n")

print(f"=== CHECKPOINT 5: Qualification Request on {ephem_lead_id} ===")
qual_res = client.post(f"/v1/leads/{ephem_lead_id}/qualify", headers=H)
assert qual_res.status_code == 202, f"Qualify request failed: {qual_res.text}"
job_id = qual_res.json()["job_id"]
print("Job ID:", job_id)
print("Dispatch mode:", qual_res.json().get("dispatch_mode"))
print("PASS: Qualification request accepted (202)\n")

print(f"=== CHECKPOINT 6: Qualification Job Status for {job_id} ===")
job_completed = False
job_record = None
for attempt in range(15):
    j_res = client.get(f"/v1/jobs/{job_id}", headers=H)
    assert j_res.status_code == 200
    job_record = j_res.json()
    if job_record.get("state") in ("completed", "failed"):
        job_completed = True
        break
    time.sleep(0.5)

assert job_completed, f"Job did not complete in time: {job_record}"
print("Final Job State:", job_record.get("state"))
print("Job Trace:", job_record.get("trace"))
print("PASS: Job status retrieval and completion\n")

print(f"=== CHECKPOINT 7: Qualification Result Retrieval on {ephem_lead_id} ===")
ephem_detail_res = client.get(f"/v1/leads/{ephem_lead_id}", headers=H)
assert ephem_detail_res.status_code == 200
ephem_data = ephem_detail_res.json()["lead"]
print("Lead Status:", ephem_data["status"])
qual = ephem_data.get("qualification")
assert qual is not None, "Qualification should not be None after completion"
print("Extraction Model:", qual.get("model_used"))
print("Extracted Service:", qual.get("service_type"))
print("Extracted Location:", qual.get("location"))
print("Extracted Quantity:", qual.get("quantity"))
print("Extracted Confidence:", qual.get("confidence"))
print("Safety Flags:", qual.get("safety_flags"))
print("PASS: Qualification result retrieval\n")

print(f"=== CHECKPOINT 8: Usage Persistence Verification for {job_id} ===")
usage = store.get(f"tenants/northstar-test/usage/{job_id}")
assert usage is not None, f"Usage record not found for {job_id}"
usage_dict = usage[0]
print("Usage Record Tenant:", usage_dict.get("tenant_id"))
print("Usage Record Lead:", usage_dict.get("lead_id"))
print("Usage Record Model:", usage_dict.get("model"))
print("Usage Record Cost USD:", usage_dict.get("estimated_cost_usd"))
print("PASS: Usage persistence\n")

print("=== CHECKPOINT 9: Error Handling Verification ===")
# 1. Missing consent -> 422
bad_consent = client.post(
    "/v1/leads",
    headers=H,
    json={
        "tenant_id": "northstar-test",
        "channel": "website",
        "message": "Enquiry without consent",
        "consent": False,
        "idempotency_key": "no-consent-key",
    },
)
assert bad_consent.status_code == 422, f"Expected 422, got {bad_consent.status_code}"
print("  [9.1] Missing consent rejected with 422: OK")

# 2. Non-existent lead qualify -> 404
bad_lead = client.post("/v1/leads/led_nonexistent_9999/qualify", headers=H)
assert bad_lead.status_code == 404, f"Expected 404, got {bad_lead.status_code}"
print("  [9.2] Nonexistent lead qualify rejected with 404: OK")

# 3. Missing auth role -> 403
no_role = client.post(
    f"/v1/leads/{ephem_lead_id}/qualify",
    headers={"X-Tenant-ID": "northstar-test", "X-Actor-ID": "tester", "X-Role": "viewer"},
)
assert no_role.status_code == 403, f"Expected 403, got {no_role.status_code}"
print("  [9.3] Unauthorized role rejected with 403: OK")
print("PASS: Error handling verified\n")

print("=== CHECKPOINT 10: Cleaning up Ephemeral Test Records ===")
import shutil
ephem_lead_dir = store.root / f"tenants/northstar-test/leads/{ephem_lead_id}"
if ephem_lead_dir.exists():
    shutil.rmtree(ephem_lead_dir)
job_dir = store.root / f"tenants/northstar-test/jobs/{job_id}"
if job_dir.exists():
    shutil.rmtree(job_dir)
job_file = store.root / f"tenants/northstar-test/jobs/{job_id}.json"
job_file.unlink(missing_ok=True)
usage_file = store.root / f"tenants/northstar-test/usage/{job_id}.json"
usage_file.unlink(missing_ok=True)
idem_file = store.root / f"tenants/northstar-test/idempotency/{ephem_key}.json"
idem_file.unlink(missing_ok=True)
print(f"Cleaned up {ephem_lead_id}, {job_id}")

# Final verify led_8388f5cd7ae5 still exists intact
final_check = client.get("/v1/leads/led_8388f5cd7ae5", headers=H)
assert final_check.status_code == 200
assert final_check.json()["lead"]["status"] == "new"
print("FINAL CONFIRMATION: Existing lead led_8388f5cd7ae5 is in original state ('new', qualification: null).")
print("ALL E2E INTEGRATION CHECKS PASSED.")

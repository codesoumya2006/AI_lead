import csv, io, logging, time
from datetime import datetime, timezone
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from app.core.auth import Principal, get_principal, require_role, require_tenant
from app.core.config import settings
from app.core.logging import configure_logging, request_context
from app.domain.schemas import (
    ApproveQuote, Channel, JobRecord, LeadCreate, LeadRecord, LeadStatus, QuoteCreate, QuoteRecord,
    Role, SendQuote, TenantSettings, SubscriptionContract, SubscriptionPlan, SubscriptionPlanDraft,
    PublishPlan, EventRecord, new_id,
)
from app.storage.local_store import StoreConflict
from app.storage.factory import create_store
from app.agents.qualification import AgentOrchestrator
from app.services.policy import PolicyError, create_quote, evaluate_qualification
from app.services.events import EventService

configure_logging(settings.log_level)
app = FastAPI(title=settings.app_name, version="0.1.0", description="Human-controlled, tenant-scoped lead-to-order workflow API")
app.middleware("http")(request_context)
@app.middleware("http")
async def enforce_request_size(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > settings.max_request_bytes:
        return Response(content="request_too_large", status_code=413)
    return await call_next(request)

app.add_middleware(CORSMiddleware, allow_origins=[origin.strip() for origin in settings.cors_allowed_origins.split(",") if origin.strip()], allow_credentials=False, allow_methods=["GET","POST","PUT","OPTIONS"], allow_headers=["Authorization","Content-Type","X-Request-ID","X-Tenant-ID","X-Actor-ID","X-Role","Idempotency-Key"])
store = create_store()
events = EventService(store)
orchestrator = AgentOrchestrator()
rate_buckets: dict[str, list[float]] = {}

def _key(kind: str, tenant: str, ident: str) -> str:
    if kind == "leads": return f"tenants/{tenant}/leads/{ident}/state"
    if kind == "quotes": return f"tenants/{tenant}/quotes/{ident}/v1"
    if kind == "jobs": return f"tenants/{tenant}/jobs/{ident}/state"
    return f"tenants/{tenant}/{kind}/{ident}"
def _tenant_settings(tenant_id: str) -> TenantSettings:
    found = store.get(f"tenants/{tenant_id}/settings")
    if found: return TenantSettings.model_validate(found[0])
    defaults = TenantSettings(tenant_id=tenant_id)
    store.put(f"tenants/{tenant_id}/settings", defaults)
    return defaults

def _require_permission(principal: Principal, permission: str) -> None:
    if principal.role == Role.PLATFORM_ADMIN: return
    tenant = _tenant_settings(principal.tenant_id)
    allowed = tenant.role_permissions.get(principal.role.value, [])
    if permission not in allowed: raise HTTPException(403, "tenant_role_permission_denied")

def _effective_entitlements(tenant: TenantSettings) -> dict:
    entitlements = dict(tenant.entitlements)
    found = store.get(f"tenants/{tenant.tenant_id}/billing/plans/{tenant.plan_id}/{tenant.plan_version}")
    if not found:
        return entitlements
    try:
        plan = SubscriptionPlan.model_validate(found[0])
        now = datetime.now(timezone.utc)
        effective = plan.status == "published" and plan.effective_from is not None and plan.effective_from <= now
        if plan.effective_to is not None and plan.effective_to <= now: effective = False
        if effective:
            entitlements.update(plan.feature_flags)
            if "monthly_leads" in plan.metered_limits: entitlements["monthly_leads"] = plan.metered_limits["monthly_leads"]
    except Exception:
        logging.getLogger("billing").exception("active_entitlement_resolution_failed")
    return entitlements

def _load_lead(lead_id: str, principal: Principal) -> tuple[LeadRecord, int]:
    found = store.get(_key("leads", principal.tenant_id, lead_id))
    if not found: raise HTTPException(404, "not_found")
    return LeadRecord.model_validate(found[0]), found[1]

def _save_lead(lead: LeadRecord, expected: int) -> int:
    try: return store.put(_key("leads", lead.tenant_id, lead.id), lead, expected_generation=expected)
    except StoreConflict as exc: raise HTTPException(409, "stale_generation") from exc

def _rate_limit(principal: Principal):
    now = time.monotonic(); key = principal.tenant_id
    values = [x for x in rate_buckets.get(key, []) if now-x < 60]
    if len(values) >= settings.rate_limit_per_minute: raise HTTPException(429, "rate_limit_exceeded")
    values.append(now); rate_buckets[key] = values

def _process_qualification(lead_id: str, tenant_id: str, job_id: str):
    t_start = time.perf_counter()
    storage_duration_ms = 0.0

    t_s = time.perf_counter()
    job_found = store.get(_key("jobs", tenant_id, job_id))
    lead_found = store.get(_key("leads", tenant_id, lead_id))
    storage_duration_ms += (time.perf_counter() - t_s) * 1000.0

    if not job_found or not lead_found: return
    job = JobRecord.model_validate(job_found[0])
    lead = LeadRecord.model_validate(lead_found[0])
    generation = lead_found[1]
    try:
        job.state = "running"
        job.trace.append("qualification.started")
        t_s = time.perf_counter()
        store.put(_key("jobs", tenant_id, job_id), job, job_found[1])
        storage_duration_ms += (time.perf_counter() - t_s) * 1000.0

        tenant = _tenant_settings(tenant_id)
        qualification = orchestrator.qualify(lead.message, tenant)

        qualified, reasons = evaluate_qualification(qualification, tenant)

        # Assemble timing breakdown
        timing = dict(qualification.timing_ms)
        timing["storage_duration_ms"] = round(storage_duration_ms, 2)
        timing["total_duration_ms"] = round((time.perf_counter() - t_start) * 1000.0, 2)
        qualification.timing_ms = timing
        job.timing_ms = timing

        lead.qualification = qualification
        lead.status = LeadStatus.QUALIFIED if qualified else (LeadStatus.ESCALATED if qualification.injection_detected or qualification.safety_flags else LeadStatus.NEEDS_INFORMATION)
        lead.updated_at = datetime.now(timezone.utc)
        lead.history.append({"action":"qualification.completed","reasons":reasons,"at":lead.updated_at.isoformat()})

        t_s = time.perf_counter()
        _save_lead(lead, generation)
        storage_duration_ms += (time.perf_counter() - t_s) * 1000.0

        # Update timings with lead save duration
        timing["storage_duration_ms"] = round(storage_duration_ms, 2)
        timing["total_duration_ms"] = round((time.perf_counter() - t_start) * 1000.0, 2)
        qualification.timing_ms = timing
        job.timing_ms = timing

        usage_record = {
            "tenant_id": tenant_id,
            "job_id": job_id,
            "lead_id": lead_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "model": qualification.model_used,
            "input_tokens": qualification.input_tokens,
            "output_tokens": qualification.output_tokens,
            "thinking_tokens": qualification.thinking_tokens,
            "estimated_cost_usd": qualification.estimated_cost_usd,
            "verifier_used": qualification.verifier_used,
            "timing_ms": timing,
        }
        t_s = time.perf_counter()
        store.put(f"tenants/{tenant_id}/usage/{job_id}", usage_record)
        storage_duration_ms += (time.perf_counter() - t_s) * 1000.0

        if settings.bigquery_usage_dataset and settings.google_cloud_project:
            try:
                from google.cloud import bigquery
                client = bigquery.Client(project=settings.google_cloud_project)
                client.insert_rows_json(f"{settings.google_cloud_project}.{settings.bigquery_usage_dataset}.usage", [usage_record], row_ids=[job_id])
            except Exception:
                logging.getLogger("usage").exception("usage_sink_unavailable", extra={"event":"usage.sink_unavailable","tenant_id":tenant_id,"entity_id":lead_id})

        job.state = "completed"
        job.completed_at = datetime.now(timezone.utc)
        job.trace.extend(["qualification.completed", "policy.evaluated"])

        t_s = time.perf_counter()
        current_job = store.get(_key("jobs", tenant_id, job_id))
        storage_duration_ms += (time.perf_counter() - t_s) * 1000.0
        timing["storage_duration_ms"] = round(storage_duration_ms, 2)
        timing["total_duration_ms"] = round((time.perf_counter() - t_start) * 1000.0, 2)
        job.timing_ms = timing

        store.put(_key("jobs", tenant_id, job_id), job, current_job[1] if current_job else 0)
        events.emit(tenant_id, lead_id, "lead.qualification_completed", policy_version=tenant.policy_version, content=qualification.model_dump(mode="json"))
    except Exception:
        logging.getLogger("workflow").exception("qualification.failed")
        current = store.get(_key("jobs", tenant_id, job_id))
        if current:
            job = JobRecord.model_validate(current[0])
            job.state = "failed"
            job.errors.append("qualification_failed_safe_to_retry")
            job.completed_at = datetime.now(timezone.utc)
            store.put(_key("jobs", tenant_id, job_id), job, current[1])

def _dispatch_qualification(lead_id: str, tenant_id: str, job_id: str, background: BackgroundTasks) -> str:
    if settings.cloud_tasks_queue and settings.worker_url:
        try:
            from google.cloud import tasks_v2
            import json
            client = tasks_v2.CloudTasksClient()
            parent = client.queue_path(settings.google_cloud_project, settings.cloud_tasks_location, settings.cloud_tasks_queue)
            body = json.dumps({"lead_id": lead_id, "tenant_id": tenant_id, "job_id": job_id}).encode()
            target = settings.worker_url.rstrip("/") + "/v1/internal/jobs/run"
            http_request = {"http_method": tasks_v2.HttpMethod.POST, "url": target,
                "headers": {"Content-Type": "application/json"}, "body": body}
            if settings.worker_service_account:
                http_request["oidc_token"] = {"service_account_email": settings.worker_service_account, "audience": settings.worker_url}
            client.create_task(request={"parent": parent, "task": {"http_request": http_request}})
            return "cloud_tasks"
        except Exception as exc:
            logging.getLogger("workflow").exception("cloud_task_enqueue_failed")
            raise HTTPException(503, "qualification_queue_unavailable_retry_safely") from exc
    if settings.environment != "local":
        raise HTTPException(503, "cloud_tasks_not_configured")
    background.add_task(_process_qualification, lead_id, tenant_id, job_id)
    return "local_background_task"

class QualificationTaskPayload(BaseModel):
    lead_id: str
    tenant_id: str
    job_id: str

@app.post("/v1/internal/jobs/run")
def run_qualification_task(payload: QualificationTaskPayload, x_cloudtasks_taskname: str | None = Header(default=None)):
    # In cloud, this endpoint must be protected by Cloud Run IAM and Cloud Tasks OIDC.
    if settings.environment != "local" and not (settings.cloud_tasks_queue and x_cloudtasks_taskname):
        raise HTTPException(401, "trusted_cloud_task_required")
    _process_qualification(payload.lead_id, payload.tenant_id, payload.job_id)
    job = store.get(_key("jobs", payload.tenant_id, payload.job_id))
    if not job: raise HTTPException(404, "job_not_found")
    if job[0].get("state") == "failed": raise HTTPException(503, "job_failed_retryable")
    return {"status": job[0].get("state"), "job_id": payload.job_id}

@app.post("/v1/internal/events/flush")
def flush_audit_event(payload: EventRecord, x_cloudtasks_taskname: str | None = Header(default=None)):
    # In cloud, protect this route with Cloud Run IAM and Cloud Tasks OIDC.
    if settings.environment != "local" and not (settings.cloud_tasks_events_queue and x_cloudtasks_taskname):
        raise HTTPException(401, "trusted_cloud_task_required")
    try:
        EventService.flush_to_bigquery(payload.model_dump(mode="json"))
    except Exception as exc:
        logging.getLogger("events").exception("event_flush_failed", extra={"event":"event.flush_failed","tenant_id":payload.tenant_id,"entity_id":payload.entity_id})
        raise HTTPException(503, "event_flush_retryable") from exc
    return {"status":"flushed","event_id":payload.event_id}

@app.get("/healthz")
def health(): return {"status":"ok", "version":"0.1.0", "environment":settings.environment, "model_configured":bool(settings.google_api_key), "persistence":"gcs" if settings.gcs_state_bucket else "local_json_development_only"}

@app.get(settings.api_prefix + "/me")
def me(principal: Principal = Depends(get_principal)):
    return {"actor_id":principal.actor_id,"tenant_id":principal.tenant_id,"role":principal.role.value,"environment":settings.environment}

@app.get(settings.api_prefix + "/dashboard")
def dashboard(principal: Principal = Depends(get_principal)):
    _require_permission(principal, "read")
    _rate_limit(principal); rows=[]
    for _, data, _generation in store.list_prefix(f"tenants/{principal.tenant_id}/leads"):
        try: rows.append(LeadRecord.model_validate(data))
        except Exception: continue
    counts={s.value:sum(1 for x in rows if x.status==s) for s in LeadStatus}
    quotes=0; approved=0; drafted=0; sent=0
    for _, data, _generation in store.list_prefix(f"tenants/{principal.tenant_id}/quotes"):
        try:
            q=QuoteRecord.model_validate(data); quotes+=1
            if q.status == "draft": drafted += 1
            elif q.status == "approved": approved += 1
            elif q.status == "sent": sent += 1
        except Exception: continue
    month_prefix = datetime.now(timezone.utc).strftime("%Y-%m")
    usage_rows = store.list_prefix(f"tenants/{principal.tenant_id}/usage")
    spend = sum(float(row.get("estimated_cost_usd") or 0) for _, row, _ in usage_rows if str(row.get("timestamp", "")).startswith(month_prefix))
    tenant = _tenant_settings(principal.tenant_id)
    budget = tenant.ai_monthly_budget_usd
    remaining = max(0.0, budget - spend) if budget is not None else None
    return {
        "lead_count":len(rows),
        "quote_count":quotes,
        "draft_quotes":drafted,
        "approved_quotes":approved,
        "sent_quotes":sent,
        "status_counts":counts,
        "monthly_spend_usd":round(spend, 6),
        "ai_monthly_budget_usd":budget,
        "remaining_budget_usd":round(remaining, 6) if remaining is not None else None,
        "recent_leads":[x.model_dump(mode="json") for x in sorted(rows,key=lambda x:x.created_at,reverse=True)[:8]],
        "events_today":len([e for e in store.events(principal.tenant_id) if e.get("timestamp","")[:10]==datetime.now(timezone.utc).date().isoformat()])
    }

@app.post(settings.api_prefix + "/leads", status_code=201)
def create_lead(payload: LeadCreate, request: Request, principal: Principal = Depends(get_principal)):
    _rate_limit(principal); require_tenant(principal, payload.tenant_id); _require_permission(principal, "create_lead")
    if not payload.consent: raise HTTPException(422, "consent_required_for_processing")
    if payload.channel == Channel.WHATSAPP and not settings.enable_whatsapp: raise HTTPException(503, "whatsapp_channel_not_enabled")
    idem = _key("idempotency", principal.tenant_id, payload.idempotency_key)
    payload_hash = store.digest(payload.model_dump(mode="json"))
    previous = store.get(idem)
    if previous:
        if previous[0].get("payload_hash") != payload_hash: raise HTTPException(409, "conflicting_idempotency_key")
        lead_found=store.get(_key("leads",principal.tenant_id,previous[0]["lead_id"]))
        if lead_found: return JSONResponse(status_code=200, content={"lead_id":previous[0]["lead_id"],"status":lead_found[0]["status"],"duplicate":True})
        raise HTTPException(503, "idempotency_reservation_incomplete_retry_safely")
    lead_id=new_id("led")
    if not store.create_once(idem,{"lead_id":lead_id,"payload_hash":payload_hash}):
        previous=store.get(idem)
        if previous and previous[0].get("payload_hash") != payload_hash: raise HTTPException(409, "conflicting_idempotency_key")
        if previous:
            lead_found=store.get(_key("leads",principal.tenant_id,previous[0]["lead_id"]))
            if lead_found: return JSONResponse(status_code=200, content={"lead_id":previous[0]["lead_id"],"status":lead_found[0]["status"],"duplicate":True})
        raise HTTPException(503, "idempotency_reservation_incomplete_retry_safely")
    lead=LeadRecord(id=lead_id,tenant_id=principal.tenant_id,channel=payload.channel,external_ref=payload.external_ref,message=payload.message,consent=payload.consent,idempotency_key=payload.idempotency_key,customer_name=payload.customer_name,customer_email=payload.customer_email)
    lead.history.append({"action":"lead.created","actor_id":principal.actor_id,"at":lead.created_at.isoformat()})
    store.put(_key("leads",principal.tenant_id,lead_id),lead)
    events.emit(principal.tenant_id,lead_id,"lead.created",principal.actor_id,content={"channel":payload.channel.value,"consent":True})
    return {"lead_id":lead_id,"status":lead.status.value,"duplicate":False}

@app.get(settings.api_prefix + "/leads")
def list_leads(principal: Principal = Depends(get_principal)):
    _require_permission(principal, "read")
    out=[]
    for _, data, _generation in store.list_prefix(f"tenants/{principal.tenant_id}/leads"):
        try: out.append(LeadRecord.model_validate(data))
        except Exception: continue
    return sorted([x.model_dump(mode="json") for x in out],key=lambda x:x["created_at"],reverse=True)

@app.get(settings.api_prefix + "/leads/{lead_id}")
def get_lead(lead_id: str, principal: Principal = Depends(get_principal)):
    _require_permission(principal, "read")
    lead,_=_load_lead(lead_id,principal); quotes=[]
    for qid in lead.quote_ids:
        f=store.get(_key("quotes",principal.tenant_id,qid))
        if f: quotes.append(f[0])
    return {"lead":lead.model_dump(mode="json"),"quotes":quotes}

@app.post(settings.api_prefix + "/leads/{lead_id}/qualify", status_code=202)
def qualify_lead(lead_id: str, background: BackgroundTasks, principal: Principal = Depends(get_principal)):
    _rate_limit(principal); require_role(principal,Role.STAFF,Role.REVIEWER,Role.TENANT_ADMIN); _require_permission(principal, "qualify_lead")
    lead,generation=_load_lead(lead_id,principal)
    if not lead.message: raise HTTPException(422,"missing_source")
    tenant = _tenant_settings(principal.tenant_id)
    entitlements = _effective_entitlements(tenant)
    if not entitlements.get("ai_qualification", True): raise HTTPException(403,"ai_qualification_not_included_in_plan")
    monthly_limit = entitlements.get("monthly_leads")
    if isinstance(monthly_limit, int) and monthly_limit >= 0:
        month_prefix = datetime.now(timezone.utc).strftime("%Y-%m")
        leads_this_month = sum(1 for _, row, _ in store.list_prefix(f"tenants/{principal.tenant_id}/leads") if str(row.get("created_at", "")).startswith(month_prefix))
        if leads_this_month > monthly_limit:
            events.emit(principal.tenant_id, lead_id, "usage.qualification_quota_exceeded", principal.actor_id, result="blocked")
            raise HTTPException(429,"tenant_monthly_lead_quota_exceeded_capture_preserved")
    if tenant.ai_monthly_budget_usd is not None:
        if settings.google_api_key and (settings.gemini_input_usd_per_million is None or settings.gemini_output_usd_per_million is None):
            raise HTTPException(503,"ai_cost_rates_required_for_budget_enforcement")
        month_prefix = datetime.now(timezone.utc).strftime("%Y-%m")
        usage_rows = store.list_prefix(f"tenants/{principal.tenant_id}/usage")
        spend = sum(float(row.get("estimated_cost_usd") or 0) for _, row, _ in usage_rows if str(row.get("timestamp", "")).startswith(month_prefix))
        baseline_cost = 0.0
        if settings.google_api_key and settings.gemini_input_usd_per_million is not None and settings.gemini_output_usd_per_million is not None:
            baseline_cost = (500 * settings.gemini_input_usd_per_million + 200 * settings.gemini_output_usd_per_million) / 1_000_000
        if spend >= tenant.ai_monthly_budget_usd or (spend + baseline_cost > tenant.ai_monthly_budget_usd):
            events.emit(principal.tenant_id, lead_id, "usage.ai_budget_exceeded", principal.actor_id, result="blocked", content={"monthly_spend_usd":spend, "budget_usd":tenant.ai_monthly_budget_usd})
            raise HTTPException(429,"tenant_ai_budget_exceeded_capture_preserved")
    if lead.status == LeadStatus.QUALIFICATION_QUEUED:
        for _, data, _ in store.list_prefix(f"tenants/{principal.tenant_id}/jobs"):
            try:
                rec = JobRecord.model_validate(data)
                if rec.lead_id == lead_id and rec.state in ("queued", "running"):
                    return {"job_id": rec.id, "state": rec.state, "dispatch_mode": "existing_active_job"}
            except Exception:
                continue
    lead.status=LeadStatus.QUALIFICATION_QUEUED; lead.updated_at=datetime.now(timezone.utc); _save_lead(lead,generation)
    job=JobRecord(id=new_id("job"),tenant_id=principal.tenant_id,lead_id=lead_id)
    store.put(_key("jobs",principal.tenant_id,job.id),job)
    events.emit(principal.tenant_id,lead_id,"qualification.queued",principal.actor_id)
    dispatch_mode = _dispatch_qualification(lead_id, principal.tenant_id, job.id, background)
    return {"job_id":job.id,"state":"queued","dispatch_mode":dispatch_mode}

@app.get(settings.api_prefix + "/jobs/{job_id}")
def get_job(job_id: str, principal: Principal = Depends(get_principal)):
    _require_permission(principal, "read")
    found=store.get(_key("jobs",principal.tenant_id,job_id))
    if not found: raise HTTPException(404,"not_found")
    return JobRecord.model_validate(found[0]).model_dump(mode="json")

@app.post(settings.api_prefix + "/leads/{lead_id}/quotes", status_code=201)
def draft_quote(lead_id: str, payload: QuoteCreate, principal: Principal = Depends(get_principal)):
    require_role(principal,Role.STAFF,Role.REVIEWER,Role.TENANT_ADMIN); _require_permission(principal, "draft_quote")
    lead,generation=_load_lead(lead_id,principal); tenant=_tenant_settings(principal.tenant_id)
    if lead.status not in (LeadStatus.QUALIFIED,LeadStatus.QUOTE_DRAFT): raise HTTPException(422,"lead_not_qualified")
    if not lead.qualification: raise HTTPException(422,"qualification_required")
    ok,reasons=evaluate_qualification(lead.qualification,tenant)
    if not ok: raise HTTPException(422,{"quote_blocked_by_policy":reasons})
    try: quote=create_quote(principal.tenant_id,lead_id,payload,tenant)
    except PolicyError as exc: raise HTTPException(422,str(exc)) from exc
    quote.generation = 1
    store.put(_key("quotes",principal.tenant_id,quote.id),quote)
    lead.quote_ids.append(quote.id); lead.status=LeadStatus.QUOTE_DRAFT; lead.updated_at=datetime.now(timezone.utc); _save_lead(lead,generation)
    events.emit(principal.tenant_id,quote.id,"quote.drafted",principal.actor_id,tenant.policy_version,content=quote.model_dump(mode="json"))
    return quote.model_dump(mode="json")

@app.post(settings.api_prefix + "/quotes/{quote_id}/approve")
def approve_quote(quote_id: str, payload: ApproveQuote, principal: Principal = Depends(get_principal)):
    require_role(principal,Role.REVIEWER,Role.TENANT_ADMIN); _require_permission(principal, "approve_quote")
    found=store.get(_key("quotes",principal.tenant_id,quote_id))
    if not found: raise HTTPException(404,"not_found")
    quote=QuoteRecord.model_validate(found[0])
    if payload.expected_generation != found[1] or quote.generation != payload.expected_generation: raise HTTPException(409,"stale_generation")
    if quote.status != "draft": raise HTTPException(409,"quote_not_draft")
    quote.status="approved"; quote.approved_by=payload.reviewer_id; quote.approved_at=datetime.now(timezone.utc); quote.generation+=1
    store.put(_key("quotes",principal.tenant_id,quote_id),quote,expected_generation=found[1])
    lead_found=store.get(_key("leads",principal.tenant_id,quote.lead_id))
    if lead_found:
        lead=LeadRecord.model_validate(lead_found[0]); lead.status=LeadStatus.QUOTE_APPROVED; lead.updated_at=datetime.now(timezone.utc)
        _save_lead(lead,lead_found[1])
    events.emit(principal.tenant_id,quote_id,"quote.approved",principal.actor_id,quote.policy_version,content={"reviewer_id":payload.reviewer_id,"generation":quote.generation})
    return quote.model_dump(mode="json")

@app.post(settings.api_prefix + "/quotes/{quote_id}/send")
def send_quote(quote_id: str, payload: SendQuote, principal: Principal = Depends(get_principal)):
    require_role(principal,Role.REVIEWER,Role.TENANT_ADMIN); _require_permission(principal, "record_send")
    found=store.get(_key("quotes",principal.tenant_id,quote_id))
    if not found: raise HTTPException(404,"not_found")
    quote=QuoteRecord.model_validate(found[0])
    if quote.status != "approved" or not quote.approved_by or not quote.approved_at: raise HTTPException(409,"quote_not_approved")
    if payload.approved_by != quote.approved_by: raise HTTPException(403,"approver_mismatch")
    lead_found=store.get(_key("leads",principal.tenant_id,quote.lead_id))
    if not lead_found: raise HTTPException(404,"not_found")
    lead=LeadRecord.model_validate(lead_found[0])
    if not lead.consent: raise HTTPException(422,"consent_required")
    # Safe default: no live provider configured; never imply delivery.
    if payload.channel == Channel.WHATSAPP and not settings.enable_whatsapp: raise HTTPException(503,"whatsapp_provider_not_configured")
    quote.status="sent"; quote.sent_at=datetime.now(timezone.utc); quote.send_channel=payload.channel.value; quote.generation+=1
    store.put(_key("quotes",principal.tenant_id,quote_id),quote,expected_generation=found[1])
    lead.status = LeadStatus.SENT
    lead.updated_at = datetime.now(timezone.utc)
    _save_lead(lead, lead_found[1])
    events.emit(principal.tenant_id,quote_id,"quote.send_authorized_sandbox",principal.actor_id,quote.policy_version,result="sandbox_only",content={"channel":payload.channel.value})
    return {"status":"sandbox_recorded_not_delivered","quote":quote.model_dump(mode="json"),"notice":"No external message was sent by this local implementation."}

@app.get(settings.api_prefix + "/quotes")
def list_quotes(principal: Principal = Depends(get_principal)):
    _require_permission(principal, "read")
    quotes = []
    for _, data, _ in store.list_prefix(f"tenants/{principal.tenant_id}/quotes"):
        try:
            quotes.append(QuoteRecord.model_validate(data))
        except Exception:
            continue
    return sorted([q.model_dump(mode="json") for q in quotes], key=lambda x: str(x.get("created_at", "")), reverse=True)

@app.get(settings.api_prefix + "/usage")
def list_usage(principal: Principal = Depends(get_principal)):
    _require_permission(principal, "read")
    records = []
    month_prefix = datetime.now(timezone.utc).strftime("%Y-%m")
    for _, data, _ in store.list_prefix(f"tenants/{principal.tenant_id}/usage"):
        try:
            records.append(data)
        except Exception:
            continue
    tenant = _tenant_settings(principal.tenant_id)
    budget = tenant.ai_monthly_budget_usd
    spend = sum(float(r.get("estimated_cost_usd") or 0) for r in records if str(r.get("timestamp", "")).startswith(month_prefix))
    remaining = max(0.0, budget - spend) if budget is not None else None
    sorted_records = sorted(records, key=lambda x: str(x.get("timestamp", "")), reverse=True)
    return {
        "tenant_id": principal.tenant_id,
        "monthly_spend_usd": round(spend, 6),
        "ai_monthly_budget_usd": budget,
        "remaining_budget_usd": round(remaining, 6) if remaining is not None else None,
        "total_records": len(records),
        "records": sorted_records,
    }

@app.get(settings.api_prefix + "/billing/plans")
def list_subscription_plans(principal: Principal = Depends(get_principal)):
    _require_permission(principal, "read")
    return [SubscriptionPlan.model_validate(data).model_dump(mode="json") for _, data, _ in store.list_prefix(f"tenants/{principal.tenant_id}/billing/plans")]

@app.post(settings.api_prefix + "/billing/plans", status_code=201)
def create_subscription_plan(payload: SubscriptionPlanDraft, principal: Principal = Depends(get_principal)):
    require_role(principal, Role.TENANT_ADMIN); _require_permission(principal, "manage_billing")
    if payload.pricing_visibility not in {"public", "private", "quote_only"}: raise HTTPException(422,"invalid_pricing_visibility")
    if payload.overage_policy not in {"pause_premium", "request_upgrade", "approved_overage"}: raise HTTPException(422,"invalid_overage_policy")
    if any(value < 0 for value in payload.metered_limits.values()): raise HTTPException(422,"metered_limits_must_be_non_negative")
    if payload.effective_from and payload.effective_to and payload.effective_to <= payload.effective_from: raise HTTPException(422,"invalid_effective_window")
    plan = SubscriptionPlan(**payload.model_dump(), tenant_id=principal.tenant_id, created_by=principal.actor_id, status="draft", generation=1)
    key = f"tenants/{principal.tenant_id}/billing/plans/{plan.plan_id}/{plan.plan_version}"
    if not store.create_once(key, plan): raise HTTPException(409,"plan_version_already_exists")
    events.emit(principal.tenant_id, plan.plan_id, "billing.plan_draft_created", principal.actor_id, content={"plan_version":plan.plan_version,"currency":plan.currency})
    return plan.model_dump(mode="json")

@app.get(settings.api_prefix + "/billing/contracts")
def list_subscription_contracts(principal: Principal = Depends(get_principal)):
    _require_permission(principal, "read")
    return [SubscriptionContract.model_validate(data).model_dump(mode="json") for _, data, _ in store.list_prefix(f"tenants/{principal.tenant_id}/billing/contracts")]

@app.post(settings.api_prefix + "/billing/contracts", status_code=201)
def create_subscription_contract(payload: SubscriptionContract, principal: Principal = Depends(get_principal)):
    require_role(principal, Role.TENANT_ADMIN); _require_permission(principal, "manage_billing")
    require_tenant(principal, payload.tenant_id)
    key = f"tenants/{principal.tenant_id}/billing/contracts/{payload.contract_id}"
    if not store.create_once(key, payload): raise HTTPException(409,"contract_already_exists")
    events.emit(principal.tenant_id, payload.contract_id, "billing.contract_imported", principal.actor_id, content={"plan_id":payload.plan_id,"plan_version":payload.plan_version})
    return payload.model_dump(mode="json")

@app.get(settings.api_prefix + "/billing/plans/{plan_id}/{plan_version}/preview")
def preview_subscription_plan(plan_id: str, plan_version: str, principal: Principal = Depends(get_principal)):
    _require_permission(principal, "read")
    found = store.get(f"tenants/{principal.tenant_id}/billing/plans/{plan_id}/{plan_version}")
    if not found: raise HTTPException(404,"not_found")
    plan = SubscriptionPlan.model_validate(found[0])
    contracts = [SubscriptionContract.model_validate(data) for _, data, _ in store.list_prefix(f"tenants/{principal.tenant_id}/billing/contracts")]
    affected = [c for c in contracts if c.plan_id == plan_id and c.status == "active"]
    return {"plan_id":plan_id,"plan_version":plan_version,"status":plan.status,"affected_contract_count":len(affected),
        "affected_contracts":[{"contract_id":c.contract_id,"customer_ref":c.customer_ref,"current_plan_version":c.plan_version,
            "current_recurring_fee":c.recurring_fee,"proposed_recurring_fee":plan.recurring_fee,"currency":c.currency,
            "terms_would_change":c.plan_version != plan.plan_version or c.recurring_fee != plan.recurring_fee} for c in affected],
        "warning":"Preview only. Existing customer contract terms are never changed by publishing a plan."}

@app.post(settings.api_prefix + "/billing/plans/{plan_id}/{plan_version}/publish")
def publish_subscription_plan(plan_id: str, plan_version: str, payload: PublishPlan, principal: Principal = Depends(get_principal)):
    require_role(principal, Role.REVIEWER, Role.TENANT_ADMIN); _require_permission(principal, "manage_billing")
    if payload.approver_id != principal.actor_id: raise HTTPException(403,"approver_identity_mismatch")
    found = store.get(f"tenants/{principal.tenant_id}/billing/plans/{plan_id}/{plan_version}")
    if not found: raise HTTPException(404,"not_found")
    plan = SubscriptionPlan.model_validate(found[0])
    if found[1] != payload.expected_generation or plan.generation != payload.expected_generation: raise HTTPException(409,"stale_generation")
    if plan.status != "draft": raise HTTPException(409,"plan_not_draft")
    if plan.created_by == principal.actor_id: raise HTTPException(403,"two_person_approval_required")
    if payload.effective_from <= datetime.now(timezone.utc): raise HTTPException(422,"effective_from_must_be_future_dated")
    plan.status = "published"; plan.approved_by = principal.actor_id; plan.published_at = datetime.now(timezone.utc); plan.effective_from = payload.effective_from; plan.generation += 1
    try: store.put(f"tenants/{principal.tenant_id}/billing/plans/{plan_id}/{plan_version}", plan, expected_generation=found[1])
    except StoreConflict as exc: raise HTTPException(409,"stale_generation") from exc
    events.emit(principal.tenant_id, plan_id, "billing.plan_published", principal.actor_id, content={"plan_version":plan_version,"effective_from":payload.effective_from.isoformat()})
    return plan.model_dump(mode="json")

@app.get(settings.api_prefix + "/settings")
def get_settings_api(principal: Principal = Depends(get_principal)):
    _require_permission(principal, "read")
    return _tenant_settings(principal.tenant_id).model_dump(mode="json")

@app.put(settings.api_prefix + "/settings")
def update_settings(payload: TenantSettings, principal: Principal = Depends(get_principal)):
    require_role(principal,Role.TENANT_ADMIN); _require_permission(principal, "tenant_settings"); require_tenant(principal,payload.tenant_id)
    if not 0 <= payload.vat_rate <= 1: raise HTTPException(422,"invalid_vat_rate")
    existing = _tenant_settings(principal.tenant_id)
    if payload.service_catalogue != existing.service_catalogue and payload.catalogue_version == existing.catalogue_version:
        parts = existing.catalogue_version.rsplit("-v", 1)
        payload.catalogue_version = f"{parts[0]}-v{int(parts[1])+1}" if len(parts) == 2 and parts[1].isdigit() else existing.catalogue_version + ".1"
    policy_changed = any([payload.service_catalogue != existing.service_catalogue, payload.territories != existing.territories,
        payload.allowed_services != existing.allowed_services, payload.vat_rate != existing.vat_rate,
        payload.vat_exempt_services != existing.vat_exempt_services])
    if policy_changed and payload.policy_version == existing.policy_version:
        parts = existing.policy_version.rsplit(".", 1)
        payload.policy_version = f"{parts[0]}.{int(parts[1])+1}" if len(parts) == 2 and parts[1].isdigit() else existing.policy_version + ".1"
    store.put(f"tenants/{principal.tenant_id}/settings",payload)
    events.emit(principal.tenant_id,payload.tenant_id,"tenant.settings_updated",principal.actor_id,payload.policy_version)
    return payload.model_dump(mode="json")

@app.get(settings.api_prefix + "/events")
def list_events(principal: Principal = Depends(get_principal)):
    _require_permission(principal, "read")
    return store.events(principal.tenant_id)[-500:]

@app.get(settings.api_prefix + "/exports/leads.csv")
def export_csv(principal: Principal = Depends(get_principal)):
    require_role(principal,Role.STAFF,Role.REVIEWER,Role.TENANT_ADMIN); _require_permission(principal, "csv_export")
    if not _effective_entitlements(_tenant_settings(principal.tenant_id)).get("crm_csv_export", True): raise HTTPException(403,"csv_export_not_included_in_plan")
    buf=io.StringIO(); writer=csv.writer(buf)
    writer.writerow(["lead_id","tenant_id","status","channel","service_type","location","quantity","confidence","created_at"])
    for _, data, _generation in store.list_prefix(f"tenants/{principal.tenant_id}/leads"):
        try:
            lead=LeadRecord.model_validate(data); q=lead.qualification
            writer.writerow([lead.id,lead.tenant_id,lead.status.value,lead.channel.value,q.service_type if q else "",q.location if q else "",q.quantity if q else "",q.confidence if q else "",lead.created_at.isoformat()])
        except Exception: continue
    return StreamingResponse(iter([buf.getvalue()]),media_type="text/csv",headers={"Content-Disposition":"attachment; filename=lead-export.csv"})

@app.post(settings.api_prefix + "/webhooks/whatsapp")
async def whatsapp_webhook(request: Request, x_hub_signature_256: str | None = Header(default=None)):
    if not settings.enable_whatsapp: raise HTTPException(404,"webhook_disabled")
    body=await request.body()
    import hashlib, hmac
    expected="sha256="+hmac.new((settings.whatsapp_app_secret or "").encode(),body,hashlib.sha256).hexdigest()
    if not settings.whatsapp_app_secret or not x_hub_signature_256 or not hmac.compare_digest(expected,x_hub_signature_256): raise HTTPException(401,"invalid_signature")
    # Provider event parsing is deliberately feature-gated until approved setup is supplied.
    return {"status":"accepted","provider_event_id":request.headers.get("x-provider-event-id"),"note":"signature_validated; event parsing adapter not enabled"}

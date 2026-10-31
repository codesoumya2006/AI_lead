# Industry-Specific Lead-to-Order Agent

A human-controlled, multi-tenant lead-to-order workflow MVP aligned to the four supplied Brilliant Brains Experiment 5 documents. The product takes a service enquiry through structured qualification, deterministic policy checks, a draft quotation, human approval, a sandbox-only send record, and an audit trail.

> **Status:** local implementation candidate. It is not production-approved. The supplied specification is itself marked “Approval Candidate”. GCP provisioning and live integrations remain release-gated. No live customer message is sent by the local build.

## Product boundary preserved

- Website-first lead capture; WhatsApp is feature-gated and disabled by default.
- FastAPI API, React + TypeScript console, structured AI qualification, deterministic quote policy, tenant scoping, idempotency, CAS state writes, audit events and CSV export.
- No payments, inbound telephony, autonomous final quotes, direct ERP writeback, marketing blasts, or multi-sector optimisation.
- No Cloud SQL or PostgreSQL. Local development uses JSON files; the production state adapter uses GCS generation preconditions.
- Two cooperating AI roles: primary qualification and conditional evidence verification. The second role runs only for low confidence, missing fields, or safety flags. Pricing and approvals are deterministic and human-controlled.

## Repository structure

```text
backend/
  app/
    agents/          # qualification agent + conditional evidence verifier
    api/             # reserved for additional routers; current routes in main.py
    core/            # configuration, request context, auth
    domain/          # typed Pydantic contracts and workflow states
    services/        # deterministic policy and audit events
    storage/         # local CAS store, GCS adapter, store factory
    main.py          # FastAPI routes and workflow orchestration
  tests/             # API, security, idempotency and quote invariants
frontend/
  src/components/    # sidebar, topbar
  src/pages/         # premium operations dashboard and workflow views
  src/lib/           # API client and typed contracts
  src/styles.css     # responsive UI, subtle motion, reduced-motion support
infra/terraform/     # GCP buckets, BigQuery, Cloud Tasks, IAM, Artifact Registry, gated Cloud Run
.github/workflows/   # backend tests/lint and frontend build
```

## Run locally (Windows PowerShell)

Prerequisites: Python 3.12+, Node.js 20+, npm.

### 1. Backend

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
Copy-Item ..\.env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Swagger UI: `http://127.0.0.1:8000/docs`  
Health: `http://127.0.0.1:8000/healthz`

The default `AUTH_MODE=dev` works only when `ENVIRONMENT=local`. It accepts demo identity headers and is not an authentication mode for a deployed service. Local data is written under `backend/.local-data` unless `DATA_DIR` is set.

### 2. Frontend (second terminal)

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The UI uses the local API at `http://127.0.0.1:8000` by default, matching the backend bind address. Set `VITE_API_URL` in the frontend terminal before starting Vite or building to use another API origin.

### 3. Optional Gemini

Set `GOOGLE_API_KEY` in `backend/.env` and optionally `GEMINI_MODEL`. The primary agent requests schema-constrained JSON with temperature zero. If the provider is missing or unavailable, the app uses a clearly labelled deterministic fallback; fallback output is not represented as a Gemini response. The verifier is conditional to reduce latency and model cost.

Never commit `.env`, API keys, provider credentials, customer data or generated `.local-data`.

## Tests

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pytest -q
ruff check app tests
```

The test suite covers health, idempotency, conflicting retries, consent, tenant isolation, structured qualification evidence, prompt-injection escalation, catalogue-authoritative quote prices, approval gating, reviewer identity, sandbox-only send, CSV export and audit events.

Frontend build:

```powershell
cd frontend
npm install
npm run build
```

## API summary

- `POST /v1/leads` — tenant-scoped lead capture, consent and idempotency.
- `GET /v1/leads` and `GET /v1/leads/{id}` — tenant-scoped cases and quote history.
- `POST /v1/leads/{id}/qualify` — asynchronous qualification (`Cloud Tasks` when configured; local background task only in local mode).
- `GET /v1/jobs/{id}` — job status and safe retry metadata.
- `POST /v1/leads/{id}/review` — persist authorized human corrections without overwriting the original AI result or enquiry.
- `POST /v1/leads/{id}/policy/evaluate` — explicitly evaluate reviewed values against deterministic tenant policy.
- `POST /v1/leads/{id}/quotes` — deterministic quote draft from tenant catalogue.
- `POST /v1/quotes/{id}/approve` — generation-aware human approval.
- `POST /v1/quotes/{id}/send` — requires approval and records sandbox intent; never claims delivery.
- `GET/PUT /v1/settings` — tenant service catalogue and policy settings.
- `GET /v1/events` — audit events.
- `GET /v1/exports/leads.csv` — CSV export.
- `POST /v1/webhooks/whatsapp` — disabled unless configured; validates HMAC signature before accepting.

## Reliability and security design

- All inbound text is untrusted data; it is JSON-quoted in model prompts. The model cannot execute code, choose arbitrary URLs, change pricing, invoke unrestricted tools or send messages.
- Structured model output is validated through Pydantic. Evidence and confidence reason are returned to reviewers. Suspicious instructions trigger safety flags and escalation.
- A conditional verifier checks extracted facts when confidence is low, information is missing or a safety flag is raised.
- Qualification requires a minimum 10-second Gemini request deadline. Only HTTP 503 is retried, with at most three total attempts; quota responses (429) fall back without retry. Each successful qualification records request preparation, API, retry delay/count, response parsing, Pydantic validation, verifier, policy, storage and total durations.
- A failed qualification job remains explicitly failed and its lead is escalated and marked policy-ineligible. Requalification clears stale human-review data, and qualification is locked once a quote exists.
- Pricing uses the tenant's versioned service catalogue. A client-supplied unit price that differs from the configured price is rejected. VAT and totals are computed by deterministic code.
- Quote send requires a persisted approval by the same reviewer identity. Local sends are only audit records, never actual external messages.
- Local storage has atomic file replacement and generation checks for development. The GCS adapter uses object generation preconditions and the Terraform bucket has versioning, uniform bucket access and public-access prevention.
- Audit records include event ID, tenant, actor, entity, action, timestamp, correlation ID, policy version, content hash and result. Raw message text is not placed in normal logs.
- Request IDs are propagated in response headers; JSON logs include correlation IDs and duration.
- Tenant access is derived from identity in OIDC mode. Local identity headers are accepted only when `ENVIRONMENT=local` and `AUTH_MODE=dev`.

## Important release gates / limitations

These are not silently claimed as done:

1. Set and verify the intended OIDC issuer/audience and tenant/role claims; configure the actual identity provider and production CORS allowlist.
2. Validate Cloud Run IAM/ingress and Cloud Tasks OIDC end-to-end in a dedicated GCP dev project. The internal worker route must not be exposed without Cloud Run IAM.
3. Add workload identity federation to GitHub Actions, protected environments, artifact digest attestation, SAST/dependency scans, SBOM and image vulnerability scan before production release.
4. The Terraform file is a reviewed starting point; run `terraform fmt`, `terraform validate` and `terraform plan` with the chosen provider version and project before apply. Deployment is disabled by default.
5. Verify BigQuery table schema, service-account least privilege, event reconciliation, usage/funnel dataset schemas and retention configuration in the target project.
6. Connect one approved CRM adapter only after selection and credentials are supplied. Current supported handoff is CSV export.
7. WhatsApp requires approved business/provider setup, templates, consent/opt-out logic, signature verification and replay/idempotency tests. It remains disabled by default.
8. Configure the frontend API origin and real OIDC sign-in integration before exposing the console outside local development.
9. Validate UK VAT rules, privacy basis, retention, DPA/processor map, DSAR/deletion path, SLOs, budgets and recovery procedure with the designated owners.
10. The UI seven-day trend is derived from the tenant's stored lead creation dates. It is not BigQuery analytics or an operational conversion-funnel measure.

The documents require reviewed Terraform and explicit release authorization. Do not run `terraform apply` or onboard a production tenant until those approvals and evidence exist.

The configured agent path uses the Google Gen AI SDK with schema-constrained JSON output. The second verification role is invoked conditionally. Model calls and fallback behavior emit duration-tagged structured logs; raw customer messages are not logged. Gemini SDK retries are disabled in favor of a measured, bounded application retry loop for HTTP 503 only; HTTP 429 does not retry.

## Subscription configuration (no payment processing)

The backend exposes `/v1/billing/plans`, `/v1/billing/contracts`, and plan preview/publish routes. Tariffs are versioned drafts; preview lists active contract terms that would differ; publishing requires a different reviewer and a future effective date. Publishing never silently rewrites existing contract terms. The UI supports creating drafts and previewing/publishing with a second reviewer. There is no Stripe integration or payment credential storage in this MVP.

Backend entitlements are enforced for monthly lead qualification volume, AI qualification availability and CSV export. When a monthly lead cap is exceeded, the lead remains captured while premium qualification is paused. If an AI spend budget is configured, model cost rates must also be configured; otherwise Gemini qualification is blocked rather than pretending spend can be measured. Token/cost usage is recorded to GCS and optionally BigQuery. Cost is estimated only when token usage and configurable per-million-token rates are available.

# Implementation status and verification record

## Local implementation

- [x] Typed API contracts, tenant-scoped lead capture, consent and idempotency.
- [x] Local JSON storage with generation checks and a GCS adapter with object preconditions.
- [x] Gemini schema-constrained qualification, bounded HTTP 503 retries, a deterministic fallback, and separately identified model provenance.
- [x] Evidence spans checked against both the original message and extracted values; unsupported values are removed.
- [x] Conditional verification with an allowlist for safety concerns; local verification does not call Gemini redundantly.
- [x] Human review persists corrected values and reviewer provenance separately from the original AI result.
- [x] Deterministic policy evaluation is explicit and required before quote eligibility; failed qualification jobs escalate and remain ineligible.
- [x] Requalification clears stale review state; requalification is locked after quote creation.
- [x] Catalogue-based quote pricing, VAT, generation-aware approval, reviewer identity checks and sandbox-only send.
- [x] Audit event coverage for lead, review, policy, quote, approval and sandbox-send transitions.
- [x] Frontend API origin is centralized and configurable; failed API requests produce visible errors.
- [x] The seven-day dashboard trend uses stored tenant lead dates rather than fabricated sample values.
- [x] Local startup and API documentation updated in the README.

## Verification performed

- Backend: `python -m pytest -q` — **54 passed**, one Starlette/AnyIO deprecation warning.
- Backend lint: `ruff check app tests` — **passed**.
- Frontend: `npm run build` — TypeScript and Vite production build **passed**; the generated JavaScript bundle exceeds Vite's 500 kB advisory threshold.
- `git diff --check` — **passed**.
- Real UI workflow: synthetic lead capture, qualification/fallback, human correction, deterministic policy evaluation, catalogue-priced quote, approval, simulated send and audit inspection — **passed** against an isolated temporary JSON store.
- Controlled Gemini activity: a schema-constrained request succeeded in a controlled call; subsequent live UI calls observed provider 503/504 responses and exercised fallback. See the three `LEAD_TO_ORDER_*_REPORT.md` files for exact timings, intermediate failures and limitations.
- Existing `backend/.local-data`, `.env`, tenant `northstar-test` and customer/lead/quote records were not used for the UI test. No migration or destructive storage change was performed.

## Not validated for production

- Production OIDC identity, issuer/audience, tenant/role claims and frontend sign-in.
- GCP provisioning, Terraform validation/plan, Cloud Run IAM/ingress, Cloud Tasks OIDC, BigQuery schema/retention and cloud recovery.
- CRM, WhatsApp and any live outbound communication.
- Privacy, retention, VAT, SLO, budget, incident-response and release approvals.
- Automated frontend component/browser tests are not configured; UI acceptance was performed manually in the browser.

This is a local implementation candidate, not production approval. The supplied source specification remains authoritative; cloud deployment stays gated.

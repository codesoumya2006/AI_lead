# Lead-to-Order Implementation Report

## Outcome

The local MVP was repaired and exercised through its browser UI. The requested customer journey was completed using an isolated synthetic tenant and local JSON store. This is not a production approval: identity-provider, cloud, privacy and release gates remain open.

## Requirement-to-code mapping

| Requirement | Implementation | Result |
|---|---|---|
| Structured qualification and honest fallback | `backend/app/agents/qualification.py` | Gemini uses a typed JSON schema. Deterministic output is explicitly marked `deterministic_fallback`; failures do not appear as Gemini output. |
| Verifiable evidence | `backend/app/agents/qualification.py` | Candidate fields require source-present spans that match their values. Unsupported values are removed. A verifier's claim alone cannot support a field. |
| Bounded provider handling and performance data | `backend/app/agents/qualification.py`, `backend/app/main.py` | 10-second minimum per request attempt; application retries HTTP 503 only, capped at three attempts. Per-stage timing is persisted. HTTP 429 does not retry. |
| Deterministic business eligibility | `backend/app/services/policy.py`, `backend/app/main.py` | Human-edited values are explicitly re-evaluated. Catalogue membership, required information, territory and other configured policy checks remain server-side. |
| Human review with provenance | `backend/app/domain/schemas.py`, `backend/app/main.py`, `frontend/src/pages/App.tsx` | Reviewer corrections are persisted separately from the original AI qualification and source message; corrected fields and reviewer identity are recorded. |
| Complete quote workflow | `backend/app/main.py`, `backend/app/services/policy.py`, `frontend/src/pages/App.tsx` | Quote prices come from the tenant catalogue; approval checks the principal and generation; sending records sandbox intent only. |
| Failure state integrity | `backend/app/main.py` | Failed qualification jobs are marked failed; leads are escalated and policy-ineligible with a failure history/audit event. Requalification clears stale review state and is blocked after quotes exist. |
| Frontend/backend integration | `frontend/src/lib/api.ts`, `frontend/src/pages/App.tsx`, `README.md` | One configurable API base is used for requests and health checks. Network failures are surfaced rather than converted to fabricated empty data. |
| Local runbook and implementation status | `README.md`, `docs/IMPLEMENTATION_STATUS.md` | Startup, endpoint, retry and current limitation details are documented. |

## Implemented and verified

- Preserved the existing Gemini model configuration (`gemini-3.1-flash-lite`); did not print or change the API key.
- Repaired Gemini schema compatibility and clamped request timeouts to the provider's 10-second minimum without editing `.env`.
- Added a typed retry loop: maximum three attempts regardless of a larger configured value, retries only HTTP 503, exponential delay capped at three seconds. Provider SDK-level retries are disabled to make attempts measurable.
- Added evidence-backed area, service frequency and explicit-date extraction to the deterministic path, plus deterministic verifier checks.
- Added a persisted human review endpoint and explicit policy-evaluation endpoint. Human review can address low AI confidence but cannot waive service, territory, required-field or safety rules.
- Bound quote approval/send actor identities to the authenticated principal. Local identity headers remain restricted to local development.
- Updated the UI to show explicit API errors, model/fallback provenance, editable review fields, policy result, and measured request/retry/parse/validation/verifier/policy/storage timing.
- Replaced fabricated trend values with seven-day stored lead counts.
- The final synthetic UI run completed lead creation, fallback qualification, quantity correction, deterministic policy approval, a catalogue-priced quote, approval, sandbox send and audit inspection. No external message was sent.

## Verification classification

- **Tested and passed:** backend tests, Ruff, frontend TypeScript/production build, `git diff --check`, and the synthetic browser workflow. Exact commands and results are in [LEAD_TO_ORDER_TEST_REPORT.md](./LEAD_TO_ORDER_TEST_REPORT.md).
- **Tested with mixed results:** Live Gemini availability. A controlled schema-constrained call succeeded earlier; later live UI calls observed both 503 and 504. The bounded retry and safe fallback paths were exercised. A live primary+verifier run exposed malformed verifier concern labels; those labels are now allowlisted and covered by a regression test. Exact timings and limitations are in [LEAD_TO_ORDER_PERFORMANCE_REPORT.md](./LEAD_TO_ORDER_PERFORMANCE_REPORT.md).
- **Partially implemented / not production-verified:** production authentication, cloud deployment, cloud task and BigQuery integration, CRM and WhatsApp. These remain release gates rather than claimed successes.
- **Not configured:** automated frontend component/browser test suite. UI acceptance was run manually in the browser.

## Data safety and worktree

The browser test used tenant `synthetic-e2e`, backend port 8002, frontend port 5174, and a new temporary `DATA_DIR`. Port 8000 was already responding when inspected, so it was not used for synthetic writes. The existing `.env`, `backend/.local-data`, `northstar-test` tenant, and existing customer/lead/quote/audit records were not used or modified. No migration or destructive storage change was performed.

Pre-existing uncommitted user changes were present in `.env.example`, `backend/app/core/config.py`, `backend/app/main.py`, `backend/tests/test_gemini_integration.py`, and `frontend/src/pages/App.tsx`; they were preserved and integrated rather than reverted. No commit was created.

## Remaining release gates

- Configure and verify real OIDC issuer/audience, tenant/role claims and frontend sign-in.
- Validate Terraform, Cloud Run IAM/ingress, Cloud Tasks OIDC, BigQuery schema/retention and recovery in a dedicated non-production GCP project.
- Configure and test an approved CRM handoff and any future WhatsApp provider; local send remains sandbox-only.
- Complete privacy, retention, VAT, SLO, budget, incident-response and release approvals.
- Consider frontend bundle splitting; Vite reports a 688.31 kB minified JavaScript chunk, above its 500 kB advisory threshold.
- Establish latency SLOs from a larger, representative sample. The timeout is per HTTP attempt, not a single end-to-end deadline; the bounded multi-attempt path can take longer than one configured request timeout.

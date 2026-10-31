# Lead-to-Order Test Report

## Summary

**Final automated status: PASS.** Backend tests, Ruff and the frontend production build passed. The complete synthetic lead-to-order path was exercised through the real React UI. The UI flow used a fresh temporary store and no live outbound communication.

## Automated checks

| Check | Command | Result |
|---|---|---|
| Backend regression suite | `cd backend; .\.venv\Scripts\python.exe -m pytest -q` | **54 passed**, 1 warning, 9.31 seconds |
| Backend lint | `cd backend; .\.venv\Scripts\ruff.exe check app tests` | **Passed** |
| Frontend type-check and production build | `cd frontend; npm run build` | **Passed** (`tsc -b` and Vite); 5.59 seconds |
| Diff whitespace validation | `git diff --check` | **Passed** |
| CORS preflight | `OPTIONS /v1/dashboard` from the isolated frontend origin | **200 OK**, allowed origin and identity headers present |

The lone backend warning is a third-party Starlette/AnyIO deprecation warning. The frontend build reports a 688.31 kB minified JavaScript chunk, above Vite's 500 kB advisory threshold; this is a warning, not a build failure.

## Regression coverage added or extended

- Gemini schema compatibility, 10-second provider timeout floor, bounded 503 retries, a hard maximum of three attempts, and no retry for 429.
- Request preparation, API, retry, parse, Pydantic validation, verifier, policy, storage and total timing fields.
- Evidence span presence and value matching, including area, frequency and explicit dates.
- Unknown verifier concern labels do not become safety flags or force escalation.
- Human-reviewed qualification remains separate from AI output; explicit policy evaluation gates eligibility.
- Requalification clears stale review values; quote creation locks subsequent requalification.
- Qualification failure marks its job failed and lead escalated/ineligible, with failure history.
- Quote actor identity, catalogue pricing, mandatory approval, sandbox-only send and audit event assertions.

## Browser acceptance run

To avoid writing to the already-existing local application/data, the browser test used:

- Tenant: `synthetic-e2e`
- API: `http://127.0.0.1:8002`
- Frontend: `http://127.0.0.1:5174`
- A new temporary JSON `DATA_DIR`; the test process explicitly allowed the 5174 CORS origin.

The following user-visible workflow passed:

1. Captured a synthetic website enquiry in the UI; the original message remained unchanged.
2. Observed the qualification job and its explicit deterministic-fallback label after the live provider returned HTTP 504.
3. Reviewed the extracted service, Manchester location and date; added missing quantity `2` through the human-review form.
4. Saved the correction; the UI attributed it to `demo-reviewer` and identified `quantity` as corrected.
5. Ran deterministic policy evaluation; the lead became eligible and its status changed to `Qualified`.
6. Drafted a quote from the configured `boiler_service` catalogue: GBP 300.00 subtotal + GBP 60.00 VAT = GBP 360.00 total.
7. Approved as `demo-reviewer`; the quote moved out of the approval queue.
8. Selected **Sandbox Send**; the UI showed **Sent (Sandbox)** and explicitly stated that no external message was sent.
9. Opened **Audit Logs** and verified `lead.created`, `qualification.queued`, `lead.qualification_completed`, `lead.review_saved`, `lead.policy_evaluated`, `quote.drafted`, `quote.approved`, and `quote.send_authorized_sandbox`. The final event was attributed to `demo-reviewer` and had result `sandbox_only`.

The completed synthetic workflow used lead `led_91391026965d` and quote `quo_32e9f6896d66`. Those identifiers refer only to the isolated temporary test store.

## Live Gemini checks and mixed results

- A controlled schema-constrained Gemini request succeeded earlier in this task: model `gemini-3.1-flash-lite`, 5,109.64 ms, 44 input tokens, 160 output tokens, 0 thinking tokens, and successful Pydantic validation. The key was not printed.
- A later UI primary+verifier run also received Gemini responses but exposed two issues: required fields were missing and the verifier returned unrecognized `unsupported_field_*` concern labels, which caused false escalation. An allowlist and regression test were added. This intermediate run is not counted as a qualification acceptance pass.
- After that fix, the final UI lead journey encountered a live HTTP 504 and used the deterministic fallback; the fallback, review, policy and order flow passed. A prior live 503 was retried once and then safely fell back.
- No live HTTP 429 was observed. Its no-retry behavior was tested with a mocked provider exception and verified against the SDK retry configuration.

## Tested but failed during development (resolved or accurately surfaced)

- The original Gemini response schema failed provider validation; it was changed to a fixed typed evidence object and the controlled request later succeeded.
- The configured 8-second request timeout was below the provider minimum; the code now applies a 10-second minimum without editing `.env`.
- `test_gemini_verifier_ignores_unknown_concern_labels` initially failed, reproducing the false-escalation bug; it passes with the concern allowlist.
- The first isolated frontend preflight failed because port 5174 was not in the local CORS list. The isolated test process was restarted with an explicit 5174 allowlist, after which preflight and browser requests succeeded. The existing user server/configuration was not changed for this test.
- A prior failing qualification test showed that the lead could remain `qualification_queued` after its job failed. The implementation and regression test now persist an escalated, policy-ineligible failure state.

## Not tested / blocked

- Automated frontend unit/component/browser tests: no frontend test runner is configured. The real UI flow above was manual.
- Production OIDC sign-in and tenant/role claims.
- Terraform validation/plan, GCP Cloud Run/Cloud Tasks IAM, BigQuery ingestion, CRM and WhatsApp integrations.
- External email or WhatsApp delivery; sending is intentionally sandbox-only.
- Production privacy, retention, VAT, SLO and release approvals.

## Data safety and changed files

`backend/.local-data`, `.env`, the existing `northstar-test` tenant, and existing customer/lead/quote/audit records were not used or modified. No database migration or production cloud change was performed.

Implementation files touched include `backend/app/agents/qualification.py`, `backend/app/domain/schemas.py`, `backend/app/services/policy.py`, `backend/app/main.py`, `frontend/src/lib/api.ts`, and `frontend/src/pages/App.tsx`. Tests were updated in `backend/tests/test_gemini_integration.py`, `backend/tests/test_performance_optimization.py`, and `backend/tests/test_workflow.py`. Documentation includes `README.md`, `docs/IMPLEMENTATION_STATUS.md`, and the three `LEAD_TO_ORDER_*_REPORT.md` deliverables. Pre-existing user changes in `.env.example`, `backend/app/core/config.py`, `backend/app/main.py`, backend tests and `frontend/src/pages/App.tsx` were preserved.

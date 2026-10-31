# Lead-to-Order Performance Report

## Measurement method

Durations are collected with `time.perf_counter()` and persisted in qualification, job and usage records. The request helper reports the sum of HTTP request durations separately from retry sleep, response parsing and Pydantic validation. The verifier has its own total, API, retry, parsing and validation measurements. Deterministic policy and storage are measured by the workflow handler.

The configured environment had `GEMINI_MODEL=gemini-3.1-flash-lite`, an 8-second timeout setting and one configured retry. The code applies a 10-second minimum request timeout to satisfy the provider, so `.env` was left unchanged. Only HTTP 503 is retried, at most three total attempts regardless of a larger retry setting; 429 and other statuses do not retry. The provider SDK's internal retries are disabled.

## Observed runs

| Run | Result | Measured stages |
|---|---|---|
| Controlled schema-constrained Gemini request | Successful; Pydantic validation passed | 5,109.64 ms wall time; 44 input tokens, 160 output tokens, 0 thinking tokens. This controlled request occurred earlier in the task, before all per-stage instrumentation was added. |
| Live 503 fallback probe | Failed over safely to deterministic extraction after two 503 responses | 5,996.13 ms Gemini duration; two HTTP attempts, one 1-second retry delay; fallback about 0.9 ms; storage about 56.27 ms; total about 6,073.08 ms. This was observed in the initial browser probe. |
| Live primary plus verifier (intermediate, not an accepted qualification) | Gemini responded, but required fields were missing and the verifier returned unrecognized concern labels. This triggered false escalation; the concern allowlist and regression test were added afterward. | Primary API 8,298.13 ms; 2 attempts, 1 retry, 1,001.66 ms retry delay; primary parse 0.13 ms; primary Pydantic validation 0.08 ms; primary qualifier 12,135.99 ms. Verifier API 9,179.72 ms; 1 attempt; parse 0.50 ms; validation 0.07 ms; verifier total 11,520.87 ms. Agent total 23,657.89 ms; policy 0.01 ms; storage 36.24 ms; workflow total 23,696.19 ms. |
| Final UI qualification run after the verifier-label fix | Provider returned HTTP 504; one attempt, no retry; deterministic fallback ran; human review supplied the missing quantity and the rest of the workflow passed. | Request preparation 0.05 ms; Gemini HTTP 9,712.50 ms; attempts 1; retries 0; no response parsing or Pydantic validation because no model response was accepted; fallback 1.23 ms; local verifier 0.23 ms; policy 0.01 ms; storage 34.44 ms; total qualification 12,819.46 ms. |

These are individual observations, not percentile statistics. The intermediate 23.70-second primary+verifier run is explicitly not presented as an accepted qualification result. The final successful order journey was based on fallback plus human review, not on falsely claiming a Gemini result.

## Retry and timeout verification

- Unit test `test_gemini_retry_attempts_are_bounded_and_exclude_quota_errors` set the configured retry count above the cap. The mocked client was called three times maximum, with 1- and 2-second exponential delays; SDK attempts remained one per call.
- Unit test `test_gemini_429_is_not_retried` confirmed one provider call and zero retries for HTTP 429.
- The live 503 probe made two total HTTP attempts before fallback. A live 504 in the final UI run made one attempt and fell back.
- The configured 8-second timeout is clamped to at least 10 seconds per HTTP attempt, verified by a test. It is not an end-to-end deadline. With three attempts, configured backoff and provider timeouts, the total provider phase can exceed one timeout interval; current local configuration allows at most two attempts.
- The deterministic verifier does not make a redundant Gemini request after the primary agent has fallen back. No tools or automatic function-calling are exposed to the model.

## Stage-level interpretation

- Prompt/request preparation and local JSON parsing/Pydantic validation were negligible in the measured successful run (`<1 ms` each); provider/network time dominated.
- Retry sleep is observable separately from network duration. A 503 may add another provider round trip; non-503 failures such as the observed 504 fall back without retry.
- The verifier can nearly double the model latency when the primary result is missing fields or otherwise requires verification. The earlier measured run was about 23.7 seconds end-to-end, so conditional invocation remains important.
- Local policy and storage were small relative to provider time in observed runs (policy about 0.01 ms; storage about 34-56 ms).
- Fallback parsing remained about 1 ms in the final run. The job still reports fallback provenance and the UI presents it explicitly.

## Provisional performance targets

Until representative load and provider-availability samples exist, these are engineering guardrails rather than SLOs:

- One successful primary call: target under 10 seconds wall time where provider/network conditions permit.
- Provider failure with the current one-retry local configuration: target under 22 seconds for two full 10-second attempts plus backoff; actual 503 and 504 observations were about 6.0 and 9.7 seconds of request duration, respectively.
- Fallback parsing: target under 50 ms; observed about 1.23 ms.
- Full conditional-verification workflow: target under 30 seconds; the intermediate measured run was 23.70 seconds, with extraction/verification quality issues subsequently addressed by a verifier concern allowlist.

The request timeout is per HTTP attempt, not a single request-to-result deadline. A separate overall deadline would require an explicit cancellation/worker design and has not been added. More live samples are needed before setting latency percentiles or production SLOs.

"""Controlled Gemini API connectivity and diagnostic verification script.

Tests minimal live connectivity without modifying state or consuming unnecessary quota.
Never prints or leaks API keys.
"""
import sys
import time
from pathlib import Path

# Add backend directory to path
backend_dir = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

from app.core.config import settings

def redact_key(key: str | None) -> str:
    if not key:
        return "<not configured>"
    if len(key) <= 8:
        return "***"
    return f"{key[:4]}...{key[-4:]} (len: {len(key)})"

def run_live_connectivity_check() -> dict:
    result = {
        "api_key_configured": bool(settings.google_api_key),
        "api_key_redacted": redact_key(settings.google_api_key),
        "model_configured": settings.gemini_model,
        "input_rate_usd_per_million": settings.gemini_input_usd_per_million,
        "output_rate_usd_per_million": settings.gemini_output_usd_per_million,
        "connectivity_ok": False,
        "http_status": None,
        "error_reason": None,
        "response_text": None,
        "input_tokens": None,
        "output_tokens": None,
        "thinking_tokens": None,
        "estimated_cost_usd": None,
    }

    if not settings.google_api_key:
        result["error_reason"] = "GOOGLE_API_KEY is not configured in backend/.env"
        return result

    max_attempts = 4
    for attempt in range(1, max_attempts + 1):
        try:
            from google import genai
            from google.genai.errors import APIError, ClientError

            if attempt == 1:
                print("  [1/3] Initializing genai.Client...", flush=True)
            client = genai.Client(api_key=settings.google_api_key)
            prompt = "Reply with exactly: GEMINI_CONNECTION_OK"
            print(f"  [2/3] Calling client.models.generate_content(model='{settings.gemini_model}') [attempt {attempt}/{max_attempts}]...", flush=True)
            start = time.perf_counter()

            response = client.models.generate_content(
                model=settings.gemini_model,
                contents=prompt,
            )
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            print(f"  [3/3] Received response in {duration_ms}ms.", flush=True)

            result["connectivity_ok"] = True
            result["http_status"] = 200
            result["response_text"] = (response.text or "").strip()
            result["duration_ms"] = duration_ms

            if response.usage_metadata:
                result["input_tokens"] = getattr(response.usage_metadata, "prompt_token_count", None)
                cand = getattr(response.usage_metadata, "candidates_token_count", 0) or 0
                thoughts = getattr(response.usage_metadata, "thoughts_token_count", 0) or 0
                result["thinking_tokens"] = thoughts
                result["output_tokens"] = cand + thoughts

                in_rate = settings.gemini_input_usd_per_million or 0.0
                out_rate = settings.gemini_output_usd_per_million or 0.0
                if result["input_tokens"] is not None and result["output_tokens"] is not None:
                    cost = (result["input_tokens"] * in_rate + result["output_tokens"] * out_rate) / 1_000_000
                    result["estimated_cost_usd"] = round(cost, 8)
            break

        except ClientError as ce:
            result["http_status"] = getattr(ce, "code", 400)
            result["error_reason"] = f"ClientError {result['http_status']}: {ce.message}"
            break
        except APIError as ae:
            result["http_status"] = getattr(ae, "code", 500)
            result["error_reason"] = f"APIError {result['http_status']}: {ae.message}"
            if result["http_status"] in (503, 429) and attempt < max_attempts:
                print(f"  Transient {result['http_status']} encountered. Retrying in 4s...", flush=True)
                time.sleep(4)
                continue
            break
        except Exception as exc:
            result["http_status"] = "ERROR"
            result["error_reason"] = f"{type(exc).__name__}: {str(exc)}"
            break

    return result

if __name__ == "__main__":
    print("=== Gemini Live API Connectivity Diagnostic ===")
    res = run_live_connectivity_check()
    for k, v in res.items():
        print(f"  {k}: {v}")
    if res["connectivity_ok"]:
        print("\nRESULT: PASS - Gemini API connectivity is functional.")
    else:
        print(f"\nRESULT: FAIL - {res['error_reason']}")


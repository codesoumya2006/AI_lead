import json, logging, time, uuid
from contextvars import ContextVar
from fastapi import Request

correlation_id_var: ContextVar[str] = ContextVar("correlation_id", default="-")

class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "severity": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "correlation_id": correlation_id_var.get(),
        }
        for key in ("tenant_id", "actor_id", "entity_id", "event", "duration_ms", "model", "agent", "input_tokens", "output_tokens", "estimated_cost_usd"):
            if hasattr(record, key): payload[key] = getattr(record, key)
        return json.dumps(payload, ensure_ascii=False)

def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)

async def request_context(request: Request, call_next):
    cid = request.headers.get("x-request-id", str(uuid.uuid4()))[:128]
    token = correlation_id_var.set(cid)
    start = time.perf_counter()
    try:
        response = await call_next(request)
        response.headers["X-Request-ID"] = cid
        logging.getLogger("http").info("request.complete", extra={"event": "request.complete", "duration_ms": round((time.perf_counter()-start)*1000, 2)})
        return response
    finally:
        correlation_id_var.reset(token)

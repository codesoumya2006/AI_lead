"""Production GCS adapter. Every state mutation uses generation-match preconditions."""
import hashlib, json
from typing import Any
from google.cloud import storage
from app.storage.local_store import StoreConflict

class GCSStore:
    def __init__(self, bucket_name: str, project: str | None = None):
        self.client = storage.Client(project=project)
        self.bucket = self.client.bucket(bucket_name)
    @staticmethod
    def _dump(value: Any) -> str:
        payload = value.model_dump(mode="json") if hasattr(value, "model_dump") else value
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    def get(self, key: str) -> tuple[dict[str, Any], int] | None:
        blob = self.bucket.blob(key if key.endswith(".json") else key + ".json")
        try: blob.reload()
        except Exception as exc:
            if exc.__class__.__name__ == "NotFound": return None
            raise
        generation = int(blob.generation or 0)
        return json.loads(blob.download_as_text(if_generation_match=generation)), generation
    def put(self, key: str, value: Any, expected_generation: int | None = None) -> int:
        name = key if key.endswith(".json") else key + ".json"
        blob = self.bucket.blob(name)
        if expected_generation is None:
            existing = self.get(key)
            expected_generation = existing[1] if existing else 0
        try:
            blob.upload_from_string(self._dump(value), content_type="application/json", if_generation_match=expected_generation)
        except Exception as exc:
            if exc.__class__.__name__ in {"PreconditionFailed", "Conflict"}: raise StoreConflict("stale GCS generation") from exc
            raise
        return int(blob.generation or 0)
    def create_once(self, key: str, value: Any) -> bool:
        name = key if key.endswith(".json") else key + ".json"
        blob = self.bucket.blob(name)
        try:
            blob.upload_from_string(self._dump(value), content_type="application/json", if_generation_match=0)
            return True
        except Exception as exc:
            if exc.__class__.__name__ in {"PreconditionFailed", "Conflict"}: return False
            raise
    def list_prefix(self, prefix: str) -> list[tuple[str, dict[str, Any], int]]:
        result=[]
        for blob in self.bucket.list_blobs(prefix=prefix.rstrip("/") + "/"):
            if not blob.name.endswith(".json"): continue
            try:
                generation = int(blob.generation or 0)
                result.append((blob.name[:-5], json.loads(blob.download_as_text(if_generation_match=generation)), generation))
            except Exception: continue
        return result
    def append_event(self, event: dict[str, Any]) -> None:
        # Durable event copy in GCS before attempting the analytics sink.
        self.create_once(f"events/{event['tenant_id']}/{event['event_id']}", event)
    def events(self, tenant_id: str | None = None) -> list[dict[str, Any]]:
        prefix = f"events/{tenant_id}" if tenant_id else "events"
        return [value for _, value, _ in self.list_prefix(prefix)]
    @staticmethod
    def digest(value: Any) -> str:
        return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()

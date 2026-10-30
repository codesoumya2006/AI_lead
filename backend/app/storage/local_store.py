"""Local JSON store implementing generation-match compare-and-swap semantics.
Production uses GCS with if_generation_match; local mode is for development/tests only."""
import hashlib, json, threading, os
from pathlib import Path
from typing import Any
from pydantic import BaseModel

class StoreConflict(Exception): pass
class StoreNotFound(Exception): pass

class LocalStore:
    def __init__(self, root: str):
        self.root = Path(root).resolve(); self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
    def _path(self, key: str) -> Path:
        safe = key.replace("..", "").strip("/")
        return self.root / (safe + ".json")
    def get(self, key: str) -> tuple[dict[str, Any], int] | None:
        p = self._path(key)
        with self._lock:
            if not p.exists(): return None
            data = json.loads(p.read_text(encoding="utf-8"))
            return data["value"], int(data["generation"])
    def put(self, key: str, value: BaseModel | dict[str, Any], expected_generation: int | None = None) -> int:
        p = self._path(key); p.parent.mkdir(parents=True, exist_ok=True)
        obj = value.model_dump(mode="json") if isinstance(value, BaseModel) else value
        with self._lock:
            current = json.loads(p.read_text(encoding="utf-8"))["generation"] if p.exists() else 0
            if expected_generation is not None and current != expected_generation:
                raise StoreConflict(f"stale generation: expected {expected_generation}, actual {current}")
            generation = current + 1
            tmp = p.with_suffix(f".tmp-{threading.get_ident()}")
            tmp.write_text(json.dumps({"generation": generation, "value": obj}, ensure_ascii=False), encoding="utf-8")
            tmp.replace(p)
            return generation
    def create_once(self, key: str, value: BaseModel | dict[str, Any]) -> bool:
        p = self._path(key); p.parent.mkdir(parents=True, exist_ok=True)
        obj = value.model_dump(mode="json") if isinstance(value, BaseModel) else value
        with self._lock:
            if p.exists(): return False
            tmp = p.with_suffix(f".create-{threading.get_ident()}.tmp")
            tmp.write_text(json.dumps({"generation": 1, "value": obj}, ensure_ascii=False), encoding="utf-8")
            try:
                # Hard-link creation is atomic and fails if another process already reserved the key.
                os.link(tmp, p)
                return True
            except FileExistsError:
                return False
            finally:
                try: tmp.unlink(missing_ok=True)
                except OSError: pass
    def append_event(self, event: dict[str, Any]) -> None:
        path = self.root / "events.jsonl"
        with self._lock:
            with path.open("a", encoding="utf-8") as f: f.write(json.dumps(event, ensure_ascii=False) + "\n")
    def events(self, tenant_id: str | None = None) -> list[dict[str, Any]]:
        path = self.root / "events.jsonl"
        if not path.exists(): return []
        rows = [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]
        return [r for r in rows if tenant_id is None or r.get("tenant_id") == tenant_id]
    def digest(self, value: Any) -> str:
        return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()

    def list_prefix(self, prefix: str) -> list[tuple[str, dict[str, Any], int]]:
        base = self.root / prefix
        if not base.exists(): return []
        rows=[]
        for p in base.rglob("*.json"):
            try:
                wrapped=json.loads(p.read_text(encoding="utf-8"))
                key=p.relative_to(self.root).as_posix()[:-5]
                rows.append((key,wrapped["value"],int(wrapped["generation"])))
            except (OSError, ValueError, KeyError, TypeError): continue
        return rows

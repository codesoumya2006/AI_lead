import logging
from app.domain.schemas import EventRecord
from app.core.logging import correlation_id_var
from app.core.config import settings

log = logging.getLogger("events")
class EventService:
    def __init__(self, store): self.store = store

    def emit(self, tenant_id: str, entity_id: str, action: str, actor_id: str = "system", policy_version: str = "policy-v1.0.0", result: str = "success", content: dict | None = None):
        event = EventRecord(tenant_id=tenant_id, entity_id=entity_id, action=action, actor_id=actor_id,
            correlation_id=correlation_id_var.get(), policy_version=policy_version,
            content_hash=self.store.digest(content or {}), result=result)
        payload = event.model_dump(mode="json")
        # Write a durable event copy first. Cloud Tasks can retry the analytics flush independently.
        self.store.append_event(payload)
        if settings.cloud_tasks_events_queue and settings.worker_url and settings.google_cloud_project:
            try:
                from google.cloud import tasks_v2
                import json
                client = tasks_v2.CloudTasksClient()
                parent = client.queue_path(settings.google_cloud_project, settings.cloud_tasks_location, settings.cloud_tasks_events_queue)
                target = settings.worker_url.rstrip("/") + "/v1/internal/events/flush"
                http_request = {"http_method": tasks_v2.HttpMethod.POST, "url": target,
                    "headers": {"Content-Type": "application/json"}, "body": json.dumps(payload).encode()}
                if settings.worker_service_account:
                    http_request["oidc_token"] = {"service_account_email": settings.worker_service_account, "audience": settings.worker_url}
                client.create_task(request={"parent": parent, "task": {"http_request": http_request}})
            except Exception:
                # The immutable GCS/local event remains available for reconciliation/replay.
                log.exception("event_enqueue_failed", extra={"event":"event.enqueue_failed","tenant_id":tenant_id,"entity_id":entity_id})
        elif settings.bigquery_dataset and settings.google_cloud_project:
            self.flush_to_bigquery(payload)
        log.info("audit.event", extra={"event": action, "tenant_id": tenant_id, "actor_id": actor_id, "entity_id": entity_id})

    @staticmethod
    def flush_to_bigquery(payload: dict) -> None:
        if not settings.bigquery_dataset or not settings.google_cloud_project:
            raise RuntimeError("BigQuery event sink is not configured")
        from google.cloud import bigquery
        client = bigquery.Client(project=settings.google_cloud_project)
        table = f"{settings.google_cloud_project}.{settings.bigquery_dataset}.events"
        errors = client.insert_rows_json(table, [payload], row_ids=[payload["event_id"]])
        if errors:
            log.error("bigquery_event_insert_failed", extra={"event":"bigquery.insert_failed","tenant_id":payload.get("tenant_id"),"entity_id":payload.get("entity_id")})
            raise RuntimeError("BigQuery rejected event row")

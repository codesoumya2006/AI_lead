from app.core.config import settings
from app.storage.local_store import LocalStore

def create_store():
    if settings.gcs_state_bucket:
        from app.storage.gcs_store import GCSStore
        return GCSStore(settings.gcs_state_bucket, settings.google_cloud_project)
    return LocalStore(settings.data_dir)

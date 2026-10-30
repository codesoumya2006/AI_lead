locals {
  prefix        = "lto-${var.environment}"
  dataset_prefix = replace(local.prefix, "-", "_")
  common_labels = merge(var.labels, { environment = var.environment })
}

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "storage.googleapis.com",
    "cloudtasks.googleapis.com",
    "bigquery.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "iam.googleapis.com"
  ])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_storage_bucket" "state" {
  name                        = var.state_bucket_name
  project                     = var.project_id
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  versioning { enabled = true }
  retention_policy {
    retention_period = 604800
    is_locked        = false
  }
  lifecycle_rule {
    action { type = "Delete" }
    condition {
      age             = 365
      matches_prefix  = ["reports/", "exports/"]
    }
  }
  labels      = local.common_labels
  depends_on  = [google_project_service.apis]
}

resource "google_storage_bucket" "dead_letter" {
  name                        = "${var.state_bucket_name}-dlq"
  project                     = var.project_id
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  versioning { enabled = true }
  labels = local.common_labels
}

resource "google_bigquery_dataset" "events" {
  dataset_id                 = "${local.dataset_prefix}_events"
  project                    = var.project_id
  location                   = var.region
  delete_contents_on_destroy = false
  labels                     = local.common_labels
}

resource "google_bigquery_dataset" "usage" {
  dataset_id                 = "${local.dataset_prefix}_usage"
  project                    = var.project_id
  location                   = var.region
  delete_contents_on_destroy = false
  labels                     = local.common_labels
}

resource "google_bigquery_dataset" "funnel_metrics" {
  dataset_id                 = "${local.dataset_prefix}_funnel_metrics"
  project                    = var.project_id
  location                   = var.region
  delete_contents_on_destroy = false
  labels                     = local.common_labels
}

resource "google_bigquery_table" "events" {
  dataset_id          = google_bigquery_dataset.events.dataset_id
  table_id            = "events"
  project             = var.project_id
  deletion_protection  = true
  time_partitioning {
    type  = "DAY"
    field = "timestamp"
  }
  schema = jsonencode([
    { name = "event_id", type = "STRING", mode = "REQUIRED" },
    { name = "tenant_id", type = "STRING", mode = "REQUIRED" },
    { name = "actor_id", type = "STRING", mode = "REQUIRED" },
    { name = "entity_id", type = "STRING", mode = "REQUIRED" },
    { name = "action", type = "STRING", mode = "REQUIRED" },
    { name = "timestamp", type = "TIMESTAMP", mode = "REQUIRED" },
    { name = "correlation_id", type = "STRING", mode = "REQUIRED" },
    { name = "policy_version", type = "STRING", mode = "REQUIRED" },
    { name = "content_hash", type = "STRING", mode = "REQUIRED" },
    { name = "result", type = "STRING", mode = "REQUIRED" }
  ])
}

resource "google_bigquery_table" "usage" {
  dataset_id         = google_bigquery_dataset.usage.dataset_id
  table_id           = "usage"
  project            = var.project_id
  deletion_protection = true
  time_partitioning {
    type  = "DAY"
    field = "timestamp"
  }
  schema = jsonencode([
    { name = "tenant_id", type = "STRING", mode = "REQUIRED" },
    { name = "job_id", type = "STRING", mode = "REQUIRED" },
    { name = "lead_id", type = "STRING", mode = "REQUIRED" },
    { name = "timestamp", type = "TIMESTAMP", mode = "REQUIRED" },
    { name = "model", type = "STRING", mode = "NULLABLE" },
    { name = "input_tokens", type = "INTEGER", mode = "NULLABLE" },
    { name = "output_tokens", type = "INTEGER", mode = "NULLABLE" },
    { name = "estimated_cost_usd", type = "FLOAT", mode = "NULLABLE" },
    { name = "verifier_used", type = "BOOLEAN", mode = "REQUIRED" }
  ])
}

resource "google_artifact_registry_repository" "containers" {
  location      = var.region
  repository_id = "${local.prefix}-images"
  description  = "Immutable app containers"
  format        = "DOCKER"
  labels        = local.common_labels
}

resource "google_cloud_tasks_queue" "qualification" {
  name     = "${local.prefix}-qualification"
  location = var.region
  rate_limits {
    max_concurrent_dispatches = 10
    max_dispatches_per_second = 5
  }
  retry_config {
    max_attempts       = 5
    min_backoff        = "5s"
    max_backoff        = "300s"
    max_doublings      = 4
  }
  depends_on = [google_project_service.apis]
}

resource "google_cloud_tasks_queue" "events" {
  name     = "${local.prefix}-events"
  location = var.region
  rate_limits {
    max_concurrent_dispatches = 20
    max_dispatches_per_second = 10
  }
  retry_config {
    max_attempts  = 8
    min_backoff   = "5s"
    max_backoff   = "600s"
    max_doublings = 5
  }
}

resource "google_service_account" "api" {
  account_id   = "${local.prefix}-api"
  display_name = "Lead-to-order API"
}

resource "google_service_account" "worker" {
  account_id   = "${local.prefix}-worker"
  display_name = "Lead-to-order worker"
}

resource "google_storage_bucket_iam_member" "api_state_access" {
  bucket = google_storage_bucket.state.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.api.email}"
}

resource "google_storage_bucket_iam_member" "worker_state_access" {
  bucket = google_storage_bucket.state.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_bigquery_dataset_iam_member" "api_events_writer" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.events.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.api.email}"
}

resource "google_bigquery_dataset_iam_member" "worker_events_writer" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.events.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_bigquery_dataset_iam_member" "api_usage_writer" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.usage.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.api.email}"
}

resource "google_bigquery_dataset_iam_member" "worker_usage_writer" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.usage.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_secret_manager_secret" "gemini_key" {
  secret_id = "${local.prefix}-gemini-api-key"
  replication { auto {} }
  labels     = local.common_labels
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_iam_member" "api_secret_reader" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.gemini_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "worker_secret_reader" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.gemini_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_cloud_run_v2_service" "api" {
  count    = var.enable_service_deployments && var.api_image_digest != "" ? 1 : 0
  name     = "${local.prefix}-api"
  location = var.region
  project  = var.project_id
  ingress  = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  template {
    service_account = google_service_account.api.email
    labels          = local.common_labels
    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }
    containers {
      image = var.api_image_digest
      ports { container_port = 8080 }
      resources {
        limits = { cpu = "1", memory = "512Mi" }
      }
      env {
        name  = "ENVIRONMENT"
        value = var.environment
      }
      env {
        name  = "AUTH_MODE"
        value = "oidc"
      }
      env {
        name  = "GCS_STATE_BUCKET"
        value = google_storage_bucket.state.name
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "BIGQUERY_DATASET"
        value = google_bigquery_dataset.events.dataset_id
      }
      env {
        name  = "BIGQUERY_USAGE_DATASET"
        value = google_bigquery_dataset.usage.dataset_id
      }
      env {
        name  = "CLOUD_TASKS_QUEUE"
        value = google_cloud_tasks_queue.qualification.name
      }
      env {
        name  = "CLOUD_TASKS_EVENTS_QUEUE"
        value = google_cloud_tasks_queue.events.name
      }
      env {
        name  = "CLOUD_TASKS_LOCATION"
        value = var.region
      }
      env {
        name  = "WORKER_URL"
        value = var.enable_service_deployments && var.api_image_digest != "" ? google_cloud_run_v2_service.worker[0].uri : ""
      }
      env {
        name  = "WORKER_SERVICE_ACCOUNT"
        value = google_service_account.worker.email
      }
      env {
        name  = "OIDC_AUDIENCE"
        value = var.oidc_audience
      }
      env {
        name  = "CORS_ALLOWED_ORIGINS"
        value = var.frontend_origin
      }
      env {
        name = "GOOGLE_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.gemini_key.secret_id
            version = "latest"
          }
        }
      }
    }
  }
  depends_on = [google_project_service.apis]
}

resource "google_project_iam_member" "api_tasks_enqueuer" {
  project = var.project_id
  role    = "roles/cloudtasks.enqueuer"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_service_account_iam_member" "api_can_mint_worker_token" {
  service_account_id = google_service_account.worker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.api.email}"
}

resource "google_cloud_run_v2_service" "worker" {
  count    = var.enable_service_deployments && var.api_image_digest != "" ? 1 : 0
  name     = "${local.prefix}-worker"
  location = var.region
  project  = var.project_id
  ingress  = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  template {
    service_account = google_service_account.worker.email
    labels          = local.common_labels
    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }
    containers {
      image = var.api_image_digest
      ports { container_port = 8080 }
      resources {
        limits = { cpu = "1", memory = "512Mi" }
      }
      env {
        name  = "ENVIRONMENT"
        value = var.environment
      }
      env {
        name  = "AUTH_MODE"
        value = "oidc"
      }
      env {
        name  = "GCS_STATE_BUCKET"
        value = google_storage_bucket.state.name
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "BIGQUERY_DATASET"
        value = google_bigquery_dataset.events.dataset_id
      }
      env {
        name  = "BIGQUERY_USAGE_DATASET"
        value = google_bigquery_dataset.usage.dataset_id
      }
      env {
        name  = "CLOUD_TASKS_EVENTS_QUEUE"
        value = google_cloud_tasks_queue.events.name
      }
      env {
        name  = "OIDC_AUDIENCE"
        value = var.oidc_audience
      }
      env {
        name = "GOOGLE_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.gemini_key.secret_id
            version = "latest"
          }
        }
      }
    }
  }
  depends_on = [google_project_service.apis]
}

resource "google_cloud_run_v2_service_iam_member" "worker_invoker" {
  count    = var.enable_service_deployments && var.api_image_digest != "" ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.worker[0].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_cloud_run_v2_service" "web" {
  count    = var.enable_service_deployments && var.web_image_digest != "" ? 1 : 0
  name     = "${local.prefix}-web"
  location = var.region
  project  = var.project_id
  ingress  = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  template {
    service_account = google_service_account.api.email
    labels          = local.common_labels
    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }
    containers {
      image = var.web_image_digest
      ports { container_port = 8080 }
      resources {
        limits = { cpu = "1", memory = "256Mi" }
      }
    }
  }
  depends_on = [google_project_service.apis]
}

resource "google_billing_budget" "monthly" {
  count           = var.billing_account_id != "" && var.project_number != "" ? 1 : 0
  billing_account = var.billing_account_id
  display_name    = "${local.prefix} monthly spend budget"
  budget_filter {
    projects = ["projects/${var.project_number}"]
  }
  amount {
    specified_amount {
      currency_code = "USD"
      units         = floor(var.monthly_budget_usd)
      nanos         = floor((var.monthly_budget_usd - floor(var.monthly_budget_usd)) * 1000000000)
    }
  }
  threshold_rules {
    threshold_percent = 0.5
    spend_basis       = "CURRENT_SPEND"
  }
  threshold_rules {
    threshold_percent = 0.8
    spend_basis       = "CURRENT_SPEND"
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "CURRENT_SPEND"
  }
}

resource "google_monitoring_alert_policy" "api_5xx" {
  display_name = "${local.prefix} API 5xx spike"
  combiner     = "OR"
  enabled      = true
  notification_channels = var.notification_channels
  conditions {
    display_name = "Cloud Run API 5xx responses exceed threshold"
    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.label.response_code_class = \"5xx\" AND resource.label.service_name = \"${local.prefix}-api\""
      comparison      = "COMPARISON_GT"
      threshold_value = 10
      duration        = "300s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }
  documentation {
    content   = "Investigate API error spikes, dependency outages, recent revisions, Cloud Tasks queue age and GCS generation conflicts."
    mime_type = "text/markdown"
  }
  depends_on = [google_project_service.apis]
}

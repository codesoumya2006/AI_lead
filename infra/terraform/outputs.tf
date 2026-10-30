output "state_bucket" { value = google_storage_bucket.state.name }
output "bigquery_events_dataset" { value = google_bigquery_dataset.events.dataset_id }
output "bigquery_events_table" { value = google_bigquery_table.events.table_id }
output "qualification_queue" { value = google_cloud_tasks_queue.qualification.name }
output "artifact_repository" { value = google_artifact_registry_repository.containers.name }
output "api_service_url" { value = try(google_cloud_run_v2_service.api[0].uri, null) }
output "web_service_url" { value = try(google_cloud_run_v2_service.web[0].uri, null) }
output "release_gate" { value = var.enable_service_deployments ? "deployments enabled: require reviewed staging evidence and owner approval" : "infrastructure only; Cloud Run deployments disabled" }
output "billing_budget_name" {
  value = try(google_billing_budget.monthly[0].name, null)
}

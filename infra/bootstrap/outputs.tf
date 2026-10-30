output "terraform_state_bucket" {
  value = google_storage_bucket.terraform_state.name
}

output "workload_identity_provider" {
  value = "projects/${var.project_number}/locations/global/workloadIdentityPools/${google_iam_workload_identity_pool.github.workload_identity_pool_id}/providers/${google_iam_workload_identity_pool_provider.github.workload_identity_pool_provider_id}"
}

output "github_deployer_service_account" {
  value = google_service_account.github_deployer.email
}

output "deployment_roles_note" {
  value = "No project-wide deployment roles were granted automatically. Grant least-privilege roles to this identity in each environment project after security review."
}

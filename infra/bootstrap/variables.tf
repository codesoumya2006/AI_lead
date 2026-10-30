variable "project_id" {
  type        = string
  description = "Authorized bootstrap project ID."
}

variable "project_number" {
  type        = string
  description = "Numeric project number for Workload Identity principal bindings."
}

variable "region" {
  type    = string
  default = "europe-west2"
}

variable "github_repository" {
  type        = string
  description = "Exact GitHub repository in owner/repo form."
  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must be owner/repo."
  }
}

variable "state_bucket_name" {
  type        = string
  description = "Globally unique bucket name for versioned Terraform state."
}

variable "workload_identity_pool_id" {
  type    = string
  default = "github-actions"
}

variable "workload_identity_provider_id" {
  type    = string
  default = "github-provider"
}

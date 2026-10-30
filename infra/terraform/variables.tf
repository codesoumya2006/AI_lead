variable "project_id" {
  type        = string
  description = "Dedicated environment GCP project ID. Never reuse production credentials in staging."
}

variable "region" {
  type        = string
  default     = "europe-west2"
  description = "Validate region against customer residency and selected model processing locations before apply."
}

variable "environment" {
  type = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod."
  }
}

variable "oidc_audience" {
  type        = string
  default     = ""
  description = "Expected audience for OIDC identity tokens. Set to the intended API audience before enabling Cloud Run deployments."
}

variable "state_bucket_name" {
  type        = string
  description = "Globally unique bucket name for workflow state and evidence."
}

variable "api_image_digest" {
  type        = string
  default     = ""
  description = "Immutable Artifact Registry image digest; empty means do not deploy Cloud Run API."
}

variable "web_image_digest" {
  type        = string
  default     = ""
  description = "Immutable Artifact Registry image digest; empty means do not deploy Cloud Run web."
}

variable "enable_service_deployments" {
  type        = bool
  default     = false
  description = "Explicit deployment gate. Keep false until security and release approvals are recorded."
}

variable "labels" {
  type    = map(string)
  default = { app = "lead-to-order", managed_by = "terraform" }
}

variable "frontend_origin" {
  type        = string
  default     = ""
  description = "Exact HTTPS frontend origin to allow in API CORS. Set before deploying the UI."
}

variable "billing_account_id" {
  type        = string
  default     = ""
  description = "Optional billing account ID. Leave empty to skip creation of a Cloud Billing budget until authorized."
}

variable "project_number" {
  type        = string
  default     = ""
  description = "Numeric project number used by Cloud Billing budget filters."
}

variable "monthly_budget_usd" {
  type        = number
  default     = 200
  description = "Illustrative cloud spend alert budget; validate against approved budget before apply."
  validation {
    condition     = var.monthly_budget_usd > 0
    error_message = "monthly_budget_usd must be positive."
  }
}

variable "notification_channels" {
  type        = list(string)
  default     = []
  description = "Existing Cloud Monitoring notification channel resource names."
}

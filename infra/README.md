# Infrastructure layout and environment boundaries

The current Terraform root in `terraform/` is a consolidated reviewable infrastructure candidate. The `environments/{dev,staging,prod}` directories contain separate project-specific variable templates; each must use a distinct GCP project and separate remote state prefix/bucket. Never share live provider credentials with staging.

The `modules/{iam,run,tasks,gcs,bq,secrets,monitoring,budget}` directories mark the required decomposition boundaries from the DevOps specification. The initial candidate keeps resources together so the full dependency graph can be reviewed before splitting; module extraction and remote-backend bootstrap must be completed and validated before production use.

## Bootstrap and plan workflow

1. Create a dedicated project and enable billing with the authorized owner.
2. Set up GitHub Workload Identity Federation; do not create long-lived service-account JSON keys.
3. Create a separate remote Terraform state bucket and configure state locking/versioning per environment.
4. Copy the relevant `terraform.tfvars.example` values into a local variable file; never commit the real file.
5. From the repository root, run `terraform -chdir=infra/terraform fmt -recursive`, then initialize with a dedicated state bucket and prefix (or use `terraform init -backend=false` for validation only), validate, and plan with `-var-file=../environments/dev/terraform.tfvars`.
6. Review the plan before apply.
7. Keep `enable_service_deployments = false` until OIDC audience, frontend origin, Secret Manager version, worker IAM, Cloud Tasks OIDC and release evidence are verified.
8. Production apply requires explicit owner approval and the documented staging attestation.

The present environment did not have Terraform installed, so these templates have not been provider-validated or applied.

Example plan command after initialization (do not apply until reviewed):

```bash
terraform -chdir=infra/terraform init -backend-config="bucket=YOUR_TERRAFORM_STATE_BUCKET" -backend-config="prefix=lead-to-order/dev"
terraform -chdir=infra/terraform validate
terraform -chdir=infra/terraform plan -var-file=../environments/dev/terraform.tfvars
```

Use a different state prefix and project for staging and production. The example `state_bucket_name` variable is the application's evidence/state bucket, not the remote Terraform state bucket.

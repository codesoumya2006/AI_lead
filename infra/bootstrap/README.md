# Bootstrap: remote state and GitHub Workload Identity Federation

This bootstrap root creates a versioned, private GCS state bucket and a GitHub OIDC Workload Identity Pool/provider restricted to the configured repository and `refs/heads/main`. It does not create or store service-account JSON keys and does not grant project-wide deployment roles automatically.

## Before applying

1. Use an authorized bootstrap project and confirm the project number.
2. Supply the exact repository as `owner/repo` and a globally unique state bucket name.
3. Review the provider attribute condition and branch policy.
4. Run `terraform fmt`, `terraform init`, `terraform validate` and `terraform plan` with an authorized identity.
5. Apply only after owner approval. Then grant the GitHub deployer the minimum required roles separately in each dev/staging environment project. Production permissions require a separate release approval.
6. Configure the application Terraform root with the state bucket and an environment-specific prefix. Keep bootstrap and application state separate.

The bootstrap state bucket is created by this root, so the first bootstrap run starts with local state. After successful review, migrate state to the created bucket using Terraform's documented state migration procedure. Never commit state files.

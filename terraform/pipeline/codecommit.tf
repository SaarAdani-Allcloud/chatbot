# ============================================================
# CodeCommit Repository
# Either creates a new repo or references an existing one.
# ============================================================

resource "aws_codecommit_repository" "this" {
  count = var.create_new_repo ? 1 : 0

  repository_name = var.repo_name
  description     = "AWS GenAI LLM Chatbot - managed by Terraform Pipeline"

  tags = {
    Name      = var.repo_name
    ManagedBy = "terraform"
    Prefix    = var.prefix
  }
}

data "aws_codecommit_repository" "existing" {
  count = var.create_new_repo ? 0 : 1

  repository_name = var.repo_name
}

# ── Locals for unified access ────────────────────────────────

locals {
  repo_arn = var.create_new_repo ? aws_codecommit_repository.this[0].arn : data.aws_codecommit_repository.existing[0].arn
  repo_name = var.create_new_repo ? aws_codecommit_repository.this[0].repository_name : data.aws_codecommit_repository.existing[0].repository_name
  clone_url_http = var.create_new_repo ? aws_codecommit_repository.this[0].clone_url_http : data.aws_codecommit_repository.existing[0].clone_url_http
}

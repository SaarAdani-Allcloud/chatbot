# ============================================================
# Outputs
# ============================================================

output "pipeline_name" {
  description = "Name of the CodePipeline"
  value       = aws_codepipeline.this.name
}

output "pipeline_arn" {
  description = "ARN of the CodePipeline"
  value       = aws_codepipeline.this.arn
}

output "codecommit_clone_url_https" {
  description = "HTTPS clone URL for the CodeCommit repository"
  value       = local.clone_url_http
}

output "codecommit_repo_name" {
  description = "Name of the CodeCommit repository"
  value       = local.repo_name
}

output "codebuild_project_name" {
  description = "Name of the CodeBuild deploy project"
  value       = aws_codebuild_project.deploy.name
}

output "artifact_bucket" {
  description = "S3 bucket used for pipeline artifacts"
  value       = aws_s3_bucket.artifacts.bucket
}

output "sns_topic_arn" {
  description = "ARN of the SNS topic for approval notifications (empty if not created)"
  value       = var.notification_email != "" ? aws_sns_topic.approval[0].arn : ""
}

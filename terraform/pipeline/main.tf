# ============================================================
# Terraform Pipeline Module
#
# Creates a CI/CD pipeline (CodeCommit + CodePipeline + CodeBuild)
# that deploys the AWS GenAI LLM Chatbot CDK stack on every push.
#
# This is functionally equivalent to lib/pipeline-stack.ts (CDK).
# ============================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }

  # S3 backend - partially configured here, completed by
  # -backend-config flags passed from the deploy script.
  backend "s3" {}
}

provider "aws" {
  region = var.region
}

# Current account ID (used for IAM ARNs)
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

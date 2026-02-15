# ============================================================
# CodePipeline  – Source -> (Approval) -> Deploy
#
# Mirrors the CDK pipeline-stack.ts simplified pipeline.
# ============================================================

# ── Locals ───────────────────────────────────────────────────
# S3 bucket names MUST be all-lowercase.
locals {
  prefix_lower = lower(var.prefix)
}

# ── Artifact Bucket ──────────────────────────────────────────

resource "aws_s3_bucket" "artifacts" {
  bucket_prefix = "${local.prefix_lower}-pipeline-art-"
  force_destroy = true

  tags = {
    Name      = "${var.prefix}-pipeline-artifacts"
    ManagedBy = "terraform"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ── IAM Role for CodePipeline ────────────────────────────────

resource "aws_iam_role" "codepipeline" {
  name = "${var.prefix}-codepipeline-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "codepipeline.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name      = "${var.prefix}-codepipeline-role"
    ManagedBy = "terraform"
  }
}

resource "aws_iam_role_policy" "codepipeline" {
  name = "codepipeline-policy"
  role = aws_iam_role.codepipeline.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # S3 artifact bucket
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:GetBucketVersioning",
          "s3:PutObjectAcl",
          "s3:PutObject"
        ]
        Resource = [
          "${aws_s3_bucket.artifacts.arn}",
          "${aws_s3_bucket.artifacts.arn}/*"
        ]
      },
      # CodeCommit
      {
        Effect = "Allow"
        Action = [
          "codecommit:CancelUploadArchive",
          "codecommit:GetBranch",
          "codecommit:GetCommit",
          "codecommit:GetRepository",
          "codecommit:GetUploadArchiveStatus",
          "codecommit:UploadArchive"
        ]
        Resource = local.repo_arn
      },
      # CodeBuild
      {
        Effect = "Allow"
        Action = [
          "codebuild:BatchGetBuilds",
          "codebuild:StartBuild"
        ]
        Resource = aws_codebuild_project.deploy.arn
      },
      # SNS (for approval notifications)
      {
        Effect   = "Allow"
        Action   = "sns:Publish"
        Resource = var.notification_email != "" ? aws_sns_topic.approval[0].arn : "*"
      },
      # KMS (for encrypted artifact bucket)
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey",
          "kms:Encrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*"
        ]
        Resource = "*"
      }
    ]
  })
}

# ── Pipeline ─────────────────────────────────────────────────

resource "aws_codepipeline" "this" {
  name     = "${var.prefix}-chatbot-pipeline"
  role_arn = aws_iam_role.codepipeline.arn

  artifact_store {
    location = aws_s3_bucket.artifacts.bucket
    type     = "S3"
  }

  # ── Stage 1: Source ──────────────────────────────────────
  stage {
    name = "Source"

    action {
      name             = "CodeCommit"
      category         = "Source"
      owner            = "AWS"
      provider         = "CodeCommit"
      version          = "1"
      output_artifacts = ["source_output"]

      configuration = {
        RepositoryName       = local.repo_name
        BranchName           = var.branch
        PollForSourceChanges = "false"
      }
    }
  }

  # ── Stage 2: Approval (conditional) ─────────────────────
  dynamic "stage" {
    for_each = var.require_approval ? [1] : []
    content {
      name = "Approval"

      action {
        name     = "ManualApproval"
        category = "Approval"
        owner    = "AWS"
        provider = "Manual"
        version  = "1"

        configuration = var.notification_email != "" ? {
          NotificationArn = aws_sns_topic.approval[0].arn
          CustomData      = "A new commit is ready to be deployed. Please review and approve."
        } : {
          CustomData = "A new commit is ready to be deployed. Please review and approve."
        }
      }
    }
  }

  # ── Stage 3: Deploy ─────────────────────────────────────
  stage {
    name = "Deploy"

    action {
      name            = "CDK-Deploy"
      category        = "Build"
      owner           = "AWS"
      provider        = "CodeBuild"
      version         = "1"
      input_artifacts = ["source_output"]

      configuration = {
        ProjectName = aws_codebuild_project.deploy.name
      }
    }
  }

  tags = {
    Name      = "${var.prefix}-chatbot-pipeline"
    ManagedBy = "terraform"
  }
}

# ── CloudWatch Event Rule to trigger pipeline on CodeCommit push ──

resource "aws_cloudwatch_event_rule" "codecommit_trigger" {
  name        = "${var.prefix}-pipeline-codecommit-trigger"
  description = "Trigger pipeline on CodeCommit push to ${var.branch}"

  event_pattern = jsonencode({
    source      = ["aws.codecommit"]
    detail-type = ["CodeCommit Repository State Change"]
    resources   = [local.repo_arn]
    detail = {
      event         = ["referenceCreated", "referenceUpdated"]
      referenceType = ["branch"]
      referenceName = [var.branch]
    }
  })

  tags = {
    Name      = "${var.prefix}-pipeline-trigger"
    ManagedBy = "terraform"
  }
}

resource "aws_cloudwatch_event_target" "codepipeline" {
  rule      = aws_cloudwatch_event_rule.codecommit_trigger.name
  target_id = "codepipeline"
  arn       = aws_codepipeline.this.arn
  role_arn  = aws_iam_role.events.arn
}

# IAM role for EventBridge to start the pipeline
resource "aws_iam_role" "events" {
  name = "${var.prefix}-events-pipeline-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "events.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    ManagedBy = "terraform"
  }
}

resource "aws_iam_role_policy" "events" {
  name = "start-pipeline"
  role = aws_iam_role.events.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "codepipeline:StartPipelineExecution"
        Resource = aws_codepipeline.this.arn
      }
    ]
  })
}

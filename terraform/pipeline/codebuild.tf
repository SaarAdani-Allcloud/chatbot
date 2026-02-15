# ============================================================
# CodeBuild Project - Deploy
#
# Runs `cdk deploy` for the ChatBot stack. Mirrors the CDK
# PipelineStack DeployProject exactly:
#   - Standard 7.0 image, LARGE compute, privileged mode
#   - CDK_PIPELINE_DEPLOY=true environment variable
#   - 60-minute timeout
#   - Optional VPC configuration
# ============================================================

# ── Security Group (only when VPC is configured) ─────────────

resource "aws_security_group" "codebuild" {
  count = var.vpc_id != "" ? 1 : 0

  name_prefix = "${var.prefix}-codebuild-"
  description = "Security group for CodeBuild deploy project"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound traffic"
  }

  tags = {
    Name      = "${var.prefix}-codebuild-sg"
    ManagedBy = "terraform"
  }
}

# ── IAM Role ─────────────────────────────────────────────────

resource "aws_iam_role" "codebuild" {
  name = "${var.prefix}-codebuild-deploy-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "codebuild.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name      = "${var.prefix}-codebuild-deploy-role"
    ManagedBy = "terraform"
  }
}

# Base CodeBuild permissions (CloudWatch Logs, S3 artifacts)
resource "aws_iam_role_policy" "codebuild_base" {
  name = "codebuild-base"
  role = aws_iam_role.codebuild.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = [
          "arn:aws:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/codebuild/${var.prefix}-chatbot-deploy",
          "arn:aws:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/codebuild/${var.prefix}-chatbot-deploy:*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:GetBucketLocation",
          "s3:PutObject"
        ]
        Resource = [
          "${aws_s3_bucket.artifacts.arn}",
          "${aws_s3_bucket.artifacts.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "codebuild:CreateReportGroup",
          "codebuild:CreateReport",
          "codebuild:UpdateReport",
          "codebuild:BatchPutTestCases",
          "codebuild:BatchPutCodeCoverages"
        ]
        Resource = "arn:aws:codebuild:${var.region}:${data.aws_caller_identity.current.account_id}:report-group/${var.prefix}-chatbot-deploy-*"
      }
    ]
  })
}

# CDK bootstrap role assumption (same as CDK pipeline-stack.ts)
resource "aws_iam_role_policy" "codebuild_cdk_assume" {
  name = "cdk-bootstrap-assume"
  role = aws_iam_role.codebuild.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "sts:AssumeRole"
        Resource = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/cdk-hnb659fds-*"
      }
    ]
  })
}

# ECR Public auth for Docker base images used during asset bundling
resource "aws_iam_role_policy" "codebuild_ecr_public" {
  name = "ecr-public-auth"
  role = aws_iam_role.codebuild.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr-public:GetAuthorizationToken",
          "sts:GetServiceBearerToken"
        ]
        Resource = "*"
      }
    ]
  })
}

# EC2 read-only for Vpc.fromLookup during internal cdk synth
resource "aws_iam_role_policy_attachment" "codebuild_ec2_readonly" {
  role       = aws_iam_role.codebuild.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ReadOnlyAccess"
}

# VPC networking permissions (only when VPC is configured)
resource "aws_iam_role_policy" "codebuild_vpc" {
  count = var.vpc_id != "" ? 1 : 0

  name = "vpc-networking"
  role = aws_iam_role.codebuild.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ec2:CreateNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DeleteNetworkInterface",
          "ec2:DescribeSubnets",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeDhcpOptions",
          "ec2:DescribeVpcs",
          "ec2:CreateNetworkInterfacePermission"
        ]
        Resource = "*"
      }
    ]
  })
}

# ── CodeBuild Project ────────────────────────────────────────

resource "aws_codebuild_project" "deploy" {
  name          = "${var.prefix}-chatbot-deploy"
  description   = "Deploy AWS GenAI LLM Chatbot via CDK"
  service_role  = aws_iam_role.codebuild.arn
  build_timeout = 60

  artifacts {
    type = "CODEPIPELINE"
  }

  environment {
    compute_type                = "BUILD_GENERAL1_LARGE"
    image                       = "aws/codebuild/standard:7.0"
    type                        = "LINUX_CONTAINER"
    privileged_mode             = true
    image_pull_credentials_type = "CODEBUILD"

    environment_variable {
      name  = "CDK_PIPELINE_DEPLOY"
      value = "true"
    }
  }

  source {
    type      = "CODEPIPELINE"
    buildspec = yamlencode({
      version = "0.2"
      phases = {
        install = {
          commands = [
            "npm ci",
            "npm install -g @aws-amplify/cli",
            "aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws"
          ]
        }
        build = {
          commands = [
            "npm run build",
            "npx cdk deploy ${var.chatbot_stack_name} --require-approval never"
          ]
        }
      }
    })
  }

  # VPC configuration (conditional)
  dynamic "vpc_config" {
    for_each = var.vpc_id != "" ? [1] : []
    content {
      vpc_id             = var.vpc_id
      subnets            = var.subnet_ids
      security_group_ids = [aws_security_group.codebuild[0].id]
    }
  }

  tags = {
    Name      = "${var.prefix}-chatbot-deploy"
    ManagedBy = "terraform"
  }
}

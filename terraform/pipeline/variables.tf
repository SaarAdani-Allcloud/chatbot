# ============================================================
# Variables - mirrors the pipeline config from deployment-manifest.yaml
# ============================================================

variable "prefix" {
  description = "Resource naming prefix (1-16 chars, must start with letter)"
  type        = string

  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9-]{0,15}$", var.prefix))
    error_message = "Prefix must start with a letter, be 1-16 chars, alphanumeric and hyphens only."
  }
}

variable "region" {
  description = "AWS region for deployment"
  type        = string
}

# ── CodeCommit ───────────────────────────────────────────────

variable "create_new_repo" {
  description = "Whether to create a new CodeCommit repository (true) or use an existing one (false)"
  type        = bool
  default     = true
}

variable "repo_name" {
  description = "CodeCommit repository name (new or existing)"
  type        = string
  default     = "aws-genai-llm-chatbot"
}

# ── Pipeline ─────────────────────────────────────────────────

variable "branch" {
  description = "Branch to monitor for changes"
  type        = string
  default     = "main"
}

variable "require_approval" {
  description = "Insert a manual approval stage before deployment"
  type        = bool
  default     = true
}

variable "notification_email" {
  description = "Email for pipeline approval notifications (empty string = no SNS topic)"
  type        = string
  default     = ""
}

# ── VPC (optional, for CodeBuild) ────────────────────────────

variable "vpc_id" {
  description = "VPC ID for CodeBuild (empty string = no VPC)"
  type        = string
  default     = ""
}

variable "subnet_ids" {
  description = "Subnet IDs for CodeBuild when running in a VPC"
  type        = list(string)
  default     = []
}

# ── CDK Stack ────────────────────────────────────────────────

variable "chatbot_stack_name" {
  description = "Name of the CDK ChatBot stack that CodeBuild will deploy"
  type        = string
}

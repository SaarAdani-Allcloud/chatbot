# ============================================================
# SNS Topic for Pipeline Approval Notifications (optional)
#
# Only created when notification_email is provided.
# ============================================================

resource "aws_sns_topic" "approval" {
  count = var.notification_email != "" ? 1 : 0

  name = "${var.prefix}-pipeline-approval"

  tags = {
    Name      = "${var.prefix}-pipeline-approval"
    ManagedBy = "terraform"
  }
}

resource "aws_sns_topic_subscription" "approval_email" {
  count = var.notification_email != "" ? 1 : 0

  topic_arn = aws_sns_topic.approval[0].arn
  protocol  = "email"
  endpoint  = var.notification_email
}

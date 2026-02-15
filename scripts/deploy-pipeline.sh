#!/usr/bin/env bash
# ============================================================
# deploy-pipeline.sh
#
# One-command deployment of the CI/CD pipeline for the
# AWS GenAI LLM Chatbot. Designed to run on a fresh AL2 EC2
# instance with an IAM role attached.
#
# Supports two pipeline deployment methods:
#   - CDK (default): deploys the PipelineStack via CDK
#   - Terraform: applies terraform/pipeline/ module
#
# What it does:
#   1. Installs prerequisites (git, Node.js, npm, AWS CLI,
#      and Terraform if TF mode is selected)
#   2. Configures git credential helper for CodeCommit
#   3. Installs npm dependencies & builds the project
#   4. Runs interactive configuration wizard (writes manifest + config)
#   5. Selects pipeline deployment tool (CDK / Terraform)
#   6. CDK bootstrap / Terraform backend & tfvars setup
#   7. Deploys the Pipeline via CDK or Terraform
#   8. Adds CodeCommit as a git remote, commits, and pushes
#      everything to CodeCommit, triggering the first execution
#
# Usage:
#   ./scripts/deploy-pipeline.sh [OPTIONS]
#
# Options:
#   --profile <name>       AWS CLI profile (skip if using EC2 IAM role)
#   --prefix <prefix>      CDK prefix (auto-detected from manifest/config)
#   --branch <branch>      CodeCommit branch (default: main)
#   --remote <name>        Git remote name (default: codecommit)
#   --region <region>      AWS region (default: from AWS config)
#   --cdk                  Use CDK to deploy the pipeline (default)
#   --terraform            Use Terraform to deploy the pipeline
#   --tf-state-bucket <b>  S3 bucket for Terraform state (TF mode only)
#   --skip-bootstrap       Skip CDK bootstrap step
#   --skip-prereqs         Skip prerequisite installation
#   --wizard               Force run the interactive configuration wizard
#   --skip-wizard          Skip the wizard (use existing manifest/config)
#   -h, --help             Show this help
#
# Examples:
#   # On EC2 with IAM role (most common, defaults to CDK):
#   ./scripts/deploy-pipeline.sh
#
#   # Deploy pipeline with Terraform:
#   ./scripts/deploy-pipeline.sh --terraform
#
#   # Deploy with Terraform, providing state bucket:
#   ./scripts/deploy-pipeline.sh --terraform --tf-state-bucket my-tf-state
#
#   # With explicit profile:
#   ./scripts/deploy-pipeline.sh --profile my-sandbox
#
#   # Skip prereq install (already have Node.js, git, etc.):
#   ./scripts/deploy-pipeline.sh --skip-prereqs --profile my-sandbox
#
# Prerequisites (auto-installed if missing):
#   - git, Node.js >= 18, npm, AWS CLI
#   - CDK bootstrapped in target account/region (CDK mode)
#   - Terraform >= 1.5 (Terraform mode, auto-installed if missing)
#   - Valid AWS credentials (IAM role on EC2 or AWS profile)
# ============================================================

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}ℹ ${NC}$*"; }
ok()      { echo -e "${GREEN}✅ ${NC}$*"; }
warn()    { echo -e "${YELLOW}⚠️  ${NC}$*"; }
err()     { echo -e "${RED}❌ ${NC}$*" >&2; }
section() { echo -e "\n${BOLD}============================================================${NC}"; info "$*"; echo -e "${BOLD}============================================================${NC}"; }

# ── Parse arguments ───────────────────────────────────────────
AWS_PROFILE_ARG=""
AWS_PROFILE_NAME=""
PREFIX=""
BRANCH="main"
REMOTE_NAME="codecommit"
REGION=""
SKIP_BOOTSTRAP=false
SKIP_PREREQS=false
RUN_WIZARD=""  # empty = auto-detect, "true" = force, "false" = skip
DEPLOY_TOOL="" # empty = prompt user, "cdk" or "terraform"
TF_STATE_BUCKET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      AWS_PROFILE_NAME="$2"
      AWS_PROFILE_ARG="--profile $2"
      shift 2
      ;;
    --prefix)
      PREFIX="$2"
      shift 2
      ;;
    --branch)
      BRANCH="$2"
      shift 2
      ;;
    --remote)
      REMOTE_NAME="$2"
      shift 2
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    --cdk)
      DEPLOY_TOOL="cdk"
      shift
      ;;
    --terraform)
      DEPLOY_TOOL="terraform"
      shift
      ;;
    --tf-state-bucket)
      TF_STATE_BUCKET="$2"
      shift 2
      ;;
    --skip-bootstrap)
      SKIP_BOOTSTRAP=true
      shift
      ;;
    --skip-prereqs)
      SKIP_PREREQS=true
      shift
      ;;
    --wizard)
      RUN_WIZARD="true"
      shift
      ;;
    --skip-wizard)
      RUN_WIZARD="false"
      shift
      ;;
    -h|--help)
      # Print the header comment as help text
      sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      err "Unknown argument: $1"
      exit 1
      ;;
  esac
done

# ── Navigate to project root ─────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"
info "Project root: $PROJECT_ROOT"

# ── Detect OS ─────────────────────────────────────────────────
detect_os() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    source /etc/os-release
    echo "$ID"
  elif [[ -f /etc/system-release ]]; then
    if grep -qi "amazon linux 2" /etc/system-release 2>/dev/null; then
      echo "amzn"
    else
      echo "unknown"
    fi
  elif [[ "$(uname)" == "Darwin" ]]; then
    echo "macos"
  else
    echo "unknown"
  fi
}

OS_ID=$(detect_os)
info "Detected OS: $OS_ID"

# ── Step 1: Install prerequisites ─────────────────────────────
if [[ "$SKIP_PREREQS" == "false" ]]; then
  section "Step 1/8: Installing prerequisites"

  # --- Git ---
  if ! command -v git >/dev/null 2>&1; then
    info "Installing git..."
    case "$OS_ID" in
      amzn|rhel|centos)
        sudo yum install -y git
        ;;
      ubuntu|debian)
        sudo apt-get update && sudo apt-get install -y git
        ;;
      macos)
        # git comes with Xcode CLI tools; prompt install
        xcode-select --install 2>/dev/null || true
        ;;
      *)
        err "Cannot auto-install git on this OS. Please install git manually."
        exit 1
        ;;
    esac
    ok "git installed: $(git --version)"
  else
    ok "git already installed: $(git --version)"
  fi

  # --- Node.js ---
  if ! command -v node >/dev/null 2>&1; then
    info "Installing Node.js 18 LTS..."
    case "$OS_ID" in
      amzn)
        # Amazon Linux 2: use NodeSource or nvm
        if [[ -f /etc/system-release ]] && grep -qi "Amazon Linux 2023" /etc/system-release 2>/dev/null; then
          sudo dnf install -y nodejs
        else
          # AL2: install via nvm (most reliable for Node 18+)
          info "Installing nvm and Node.js 18..."
          curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
          export NVM_DIR="$HOME/.nvm"
          # shellcheck disable=SC1091
          [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
          nvm install 18
          nvm use 18
          nvm alias default 18
        fi
        ;;
      ubuntu|debian)
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
        ;;
      macos)
        if command -v brew >/dev/null 2>&1; then
          brew install node@18
        else
          err "Please install Node.js 18+ via https://nodejs.org or Homebrew"
          exit 1
        fi
        ;;
      *)
        err "Cannot auto-install Node.js on this OS. Please install Node.js 18+ manually."
        exit 1
        ;;
    esac
    ok "Node.js installed: $(node --version)"
  else
    NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
    if [[ "$NODE_VERSION" -lt 18 ]]; then
      err "Node.js >= 18 is required (found v$NODE_VERSION). Please upgrade."
      exit 1
    fi
    ok "Node.js already installed: $(node --version)"
  fi

  # --- AWS CLI ---
  if ! command -v aws >/dev/null 2>&1; then
    info "Installing AWS CLI v2..."
    case "$OS_ID" in
      amzn|rhel|centos|ubuntu|debian)
        curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip"
        unzip -o /tmp/awscliv2.zip -d /tmp
        sudo /tmp/aws/install --update
        rm -rf /tmp/aws /tmp/awscliv2.zip
        ;;
      macos)
        if command -v brew >/dev/null 2>&1; then
          brew install awscli
        else
          err "Please install AWS CLI: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html"
          exit 1
        fi
        ;;
      *)
        err "Cannot auto-install AWS CLI on this OS."
        exit 1
        ;;
    esac
    ok "AWS CLI installed: $(aws --version)"
  else
    ok "AWS CLI already installed: $(aws --version | head -1)"
  fi

  # --- jq (useful for JSON parsing, often missing on AL2) ---
  if ! command -v jq >/dev/null 2>&1; then
    info "Installing jq..."
    case "$OS_ID" in
      amzn|rhel|centos)
        sudo yum install -y jq
        ;;
      ubuntu|debian)
        sudo apt-get install -y jq
        ;;
      macos)
        brew install jq 2>/dev/null || true
        ;;
      *)
        warn "Could not install jq. Continuing without it."
        ;;
    esac
  fi

  ok "All prerequisites satisfied"
else
  section "Step 1/8: Skipping prerequisite installation (--skip-prereqs)"

  # Still validate
  for cmd in git node npm aws; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      err "$cmd is required but not installed. Remove --skip-prereqs to auto-install."
      exit 1
    fi
  done

  NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
  if [[ "$NODE_VERSION" -lt 18 ]]; then
    err "Node.js >= 18 is required (found v$NODE_VERSION)"
    exit 1
  fi

  ok "All prerequisites validated"
fi

# ── Step 2: Configure git for CodeCommit ──────────────────────
section "Step 2/8: Configuring git credential helper for CodeCommit"

# Configure the AWS CodeCommit credential helper
git config --global credential.helper '!aws codecommit credential-helper $@'
git config --global credential.UseHttpPath true

# Set git identity if not configured (needed for commits)
if ! git config --global user.email >/dev/null 2>&1; then
  git config --global user.email "pipeline-deploy@automated"
  git config --global user.name "Pipeline Deploy"
  info "Set default git identity (pipeline-deploy@automated)"
fi

# If the project directory isn't a git repo, initialize it
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  info "Initializing git repository..."
  git init
  git add -A
  git commit -m "Initial commit"
  ok "Git repository initialized"
else
  ok "Git repository already initialized"
fi

ok "Git configured for CodeCommit"

# ── Step 3: Install & Build ──────────────────────────────────
section "Step 3/8: Installing dependencies & building"

npm ci

# Install Amplify CLI (needed for codegen during build)
if ! command -v amplify >/dev/null 2>&1; then
  info "Installing @aws-amplify/cli globally..."
  npm install -g @aws-amplify/cli
fi

npm run build

ok "Build completed"

# ── Step 4: Interactive Configuration Wizard ──────────────────
# The wizard runs the compiled magic-config.js with --manifest flag.
# It asks all configuration questions interactively, then writes both
# deployment-manifest.yaml and bin/config.json.
SHOULD_RUN_WIZARD=false
if [[ "$RUN_WIZARD" == "true" ]]; then
  SHOULD_RUN_WIZARD=true
elif [[ "$RUN_WIZARD" == "false" ]]; then
  SHOULD_RUN_WIZARD=false
else
  # Auto-detect: run wizard if no deployment-manifest.yaml exists
  if [[ ! -f "deployment-manifest.yaml" ]]; then
    SHOULD_RUN_WIZARD=true
  else
    info "Existing deployment-manifest.yaml found."
    read -rp "  Re-run the configuration wizard? (y/N): " WIZARD_ANSWER
    if [[ "$WIZARD_ANSWER" =~ ^[Yy] ]]; then
      SHOULD_RUN_WIZARD=true
    fi
  fi
fi

if [[ "$SHOULD_RUN_WIZARD" == "true" ]]; then
  section "Step 4/8: Running interactive configuration wizard"
  node dist/cli/magic-config.js --manifest
  ok "Configuration wizard completed"
else
  section "Step 4/8: Skipping wizard (using existing configuration)"
  if [[ ! -f "deployment-manifest.yaml" ]] && [[ ! -f "bin/config.json" ]]; then
    err "No deployment-manifest.yaml or bin/config.json found. Re-run with --wizard."
    exit 1
  fi
  ok "Using existing configuration files"
fi

# ── Resolve prefix ────────────────────────────────────────────
if [[ -z "$PREFIX" ]]; then
  if [[ -f "deployment-manifest.yaml" ]]; then
    PREFIX=$(grep '^prefix:' deployment-manifest.yaml | sed 's/prefix:[[:space:]]*//' | tr -d '"' | tr -d "'")
  fi
  if [[ -z "$PREFIX" ]] && [[ -f "bin/config.json" ]]; then
    PREFIX=$(node -e "console.log(require('./bin/config.json').prefix || '')")
  fi
  if [[ -z "$PREFIX" ]]; then
    err "Could not determine prefix. Provide --prefix or set it in deployment-manifest.yaml"
    exit 1
  fi
fi

PIPELINE_STACK_NAME="${PREFIX}ChatBotPipelineStack"
CHATBOT_STACK_NAME="${PREFIX}GenAIChatBotStack"
info "Prefix: $PREFIX"
info "Pipeline stack: $PIPELINE_STACK_NAME"
info "ChatBot stack:  $CHATBOT_STACK_NAME"

# ── Resolve region ────────────────────────────────────────────
if [[ -z "$REGION" ]]; then
  if [[ -n "$AWS_PROFILE_NAME" ]]; then
    REGION=$(aws configure get region --profile "$AWS_PROFILE_NAME" 2>/dev/null || true)
  fi
  if [[ -z "$REGION" ]]; then
    REGION=$(aws configure get region 2>/dev/null || true)
  fi
  if [[ -z "$REGION" ]]; then
    # Try EC2 metadata (IMDSv2 with token, then fall back to IMDSv1)
    IMDS_TOKEN=$(curl -s --connect-timeout 2 -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null || true)
    if [[ -n "$IMDS_TOKEN" ]]; then
      REGION=$(curl -s --connect-timeout 2 -H "X-aws-ec2-metadata-token: $IMDS_TOKEN" http://169.254.169.254/latest/meta-data/placement/region 2>/dev/null || true)
    else
      REGION=$(curl -s --connect-timeout 2 http://169.254.169.254/latest/meta-data/placement/region 2>/dev/null || true)
    fi
  fi
  if [[ -z "$REGION" ]]; then
    err "Could not determine AWS region. Provide --region or configure it with 'aws configure'"
    exit 1
  fi
fi
info "AWS Region: $REGION"

# ── Resolve AWS Account ID ────────────────────────────────────
# shellcheck disable=SC2086
ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text $AWS_PROFILE_ARG 2>/dev/null || true)
if [[ -z "$ACCOUNT_ID" ]]; then
  err "Could not determine AWS account ID. Check your credentials."
  exit 1
fi
info "AWS Account: $ACCOUNT_ID"

# ── Step 5: Choose pipeline deploy tool ───────────────────────
section "Step 5/8: Selecting pipeline deployment tool"

if [[ -z "$DEPLOY_TOOL" ]]; then
  echo ""
  echo "  How would you like to deploy the CI/CD pipeline?"
  echo ""
  echo "    1) CDK  (default) — deploys the PipelineStack via CDK"
  echo "    2) Terraform      — applies the terraform/pipeline/ module"
  echo ""
  read -rp "  Choose [1/2] (default: 1): " TOOL_CHOICE
  case "$TOOL_CHOICE" in
    2|terraform|tf)
      DEPLOY_TOOL="terraform"
      ;;
    *)
      DEPLOY_TOOL="cdk"
      ;;
  esac
fi

ok "Pipeline deploy tool: $(echo "$DEPLOY_TOOL" | tr '[:lower:]' '[:upper:]')"

# ── Install Terraform if needed (TF mode only) ───────────────
install_terraform() {
  if command -v terraform >/dev/null 2>&1; then
    ok "Terraform already installed: $(terraform version -json 2>/dev/null | head -1 || terraform version | head -1)"
    return
  fi

  info "Installing Terraform..."
  case "$OS_ID" in
    amzn|rhel|centos)
      sudo yum install -y yum-utils
      sudo yum-config-manager --add-repo https://rpm.releases.hashicorp.com/AmazonLinux/hashicorp.repo
      sudo yum install -y terraform
      ;;
    ubuntu|debian)
      sudo apt-get update && sudo apt-get install -y gnupg software-properties-common
      wget -O- https://apt.releases.hashicorp.com/gpg | gpg --dearmor | sudo tee /usr/share/keyrings/hashicorp-archive-keyring.gpg >/dev/null
      echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
      sudo apt-get update && sudo apt-get install -y terraform
      ;;
    macos)
      if command -v brew >/dev/null 2>&1; then
        brew tap hashicorp/tap
        brew install hashicorp/tap/terraform
      else
        err "Please install Terraform: https://developer.hashicorp.com/terraform/install"
        exit 1
      fi
      ;;
    *)
      err "Cannot auto-install Terraform on this OS. Please install it manually: https://developer.hashicorp.com/terraform/install"
      exit 1
      ;;
  esac
  ok "Terraform installed: $(terraform version | head -1)"
}

if [[ "$DEPLOY_TOOL" == "terraform" ]]; then
  install_terraform

  # Terraform uses AWS_PROFILE env var (not --profile flag like AWS CLI)
  if [[ -n "$AWS_PROFILE_NAME" ]]; then
    export AWS_PROFILE="$AWS_PROFILE_NAME"
    info "Exported AWS_PROFILE=$AWS_PROFILE_NAME for Terraform"
  fi
fi

# ── Step 6: CDK Bootstrap / Terraform backend + tfvars ────────

if [[ "$DEPLOY_TOOL" == "cdk" ]]; then
  # ── CDK Bootstrap ──────────────────────────────────────────
  if [[ "$SKIP_BOOTSTRAP" == "false" ]]; then
    section "Step 6/8: Running CDK bootstrap"

    info "Bootstrapping CDK in $ACCOUNT_ID/$REGION..."
    # shellcheck disable=SC2086
    npx cdk bootstrap "aws://$ACCOUNT_ID/$REGION" $AWS_PROFILE_ARG

    ok "CDK bootstrap complete"
  else
    section "Step 6/8: Skipping CDK bootstrap (--skip-bootstrap)"
  fi

else
  # ── Terraform backend + tfvars setup ───────────────────────
  section "Step 6/8: Setting up Terraform backend & generating tfvars"

  TF_DIR="$PROJECT_ROOT/terraform/pipeline"
  TF_KEY="${PREFIX}/pipeline.tfstate"

  # --- S3 bucket for TF state ---
  if [[ -z "$TF_STATE_BUCKET" ]]; then
    DEFAULT_TF_BUCKET="${PREFIX}-tf-state-${ACCOUNT_ID}-${REGION}"
    read -rp "  S3 bucket for Terraform state [${DEFAULT_TF_BUCKET}]: " TF_STATE_BUCKET
    TF_STATE_BUCKET="${TF_STATE_BUCKET:-$DEFAULT_TF_BUCKET}"
  fi
  info "Terraform state bucket: $TF_STATE_BUCKET"

  # Create the bucket if it doesn't exist
  # shellcheck disable=SC2086
  if ! aws s3api head-bucket --bucket "$TF_STATE_BUCKET" $AWS_PROFILE_ARG --region "$REGION" 2>/dev/null; then
    info "Creating S3 bucket '$TF_STATE_BUCKET' for Terraform state..."
    # shellcheck disable=SC2086
    aws s3api create-bucket \
      --bucket "$TF_STATE_BUCKET" \
      --region "$REGION" \
      --create-bucket-configuration LocationConstraint="$REGION" \
      $AWS_PROFILE_ARG

    # Enable versioning
    # shellcheck disable=SC2086
    aws s3api put-bucket-versioning \
      --bucket "$TF_STATE_BUCKET" \
      --versioning-configuration Status=Enabled \
      --region "$REGION" \
      $AWS_PROFILE_ARG

    # Enable encryption
    # shellcheck disable=SC2086
    aws s3api put-bucket-encryption \
      --bucket "$TF_STATE_BUCKET" \
      --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' \
      --region "$REGION" \
      $AWS_PROFILE_ARG

    # Block public access
    # shellcheck disable=SC2086
    aws s3api put-public-access-block \
      --bucket "$TF_STATE_BUCKET" \
      --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" \
      --region "$REGION" \
      $AWS_PROFILE_ARG

    ok "Created and configured TF state bucket: $TF_STATE_BUCKET"
  else
    ok "TF state bucket already exists: $TF_STATE_BUCKET"
  fi

  # --- Generate terraform.tfvars from manifest ---
  info "Generating terraform.tfvars from deployment-manifest.yaml..."

  # Extract pipeline-related values from manifest
  MANIFEST_FILE="$PROJECT_ROOT/deployment-manifest.yaml"
  if [[ ! -f "$MANIFEST_FILE" ]]; then
    err "deployment-manifest.yaml not found. Re-run with --wizard."
    exit 1
  fi

  # Helper to read yaml values (simple grep-based, works for flat values)
  yaml_val() {
    local key="$1"
    grep "^${key}:" "$MANIFEST_FILE" 2>/dev/null | sed "s/${key}:[[:space:]]*//" | tr -d '"' | tr -d "'" || true
  }

  # Nested yaml value (e.g. "  existingRepositoryName: foo" under "pipeline:")
  yaml_nested() {
    local key="$1"
    grep "  ${key}:" "$MANIFEST_FILE" 2>/dev/null | sed "s/.*${key}:[[:space:]]*//" | tr -d '"' | tr -d "'" | head -1 || true
  }

  # Determine repo settings
  TF_CREATE_NEW_REPO=$(yaml_nested "createNew")
  TF_CREATE_NEW_REPO="${TF_CREATE_NEW_REPO:-true}"
  if [[ "$TF_CREATE_NEW_REPO" == "true" ]]; then
    TF_REPO_NAME=$(yaml_nested "newRepositoryName")
    TF_REPO_NAME="${TF_REPO_NAME:-aws-genai-llm-chatbot}"
  else
    TF_REPO_NAME=$(yaml_nested "existingRepositoryName")
    TF_REPO_NAME="${TF_REPO_NAME:-aws-genai-llm-chatbot}"
  fi

  TF_REQUIRE_APPROVAL=$(yaml_nested "requireApproval")
  TF_REQUIRE_APPROVAL="${TF_REQUIRE_APPROVAL:-true}"

  TF_NOTIFICATION_EMAIL=$(yaml_nested "notificationEmail")
  TF_NOTIFICATION_EMAIL="${TF_NOTIFICATION_EMAIL:-}"

  TF_BRANCH=$(yaml_nested "branch")
  TF_BRANCH="${TF_BRANCH:-main}"

  # VPC settings
  TF_VPC_ID=$(yaml_nested "vpcId")
  TF_VPC_ID="${TF_VPC_ID:-}"

  # Subnet IDs (need to parse yaml list — only items directly under subnetIds:)
  TF_SUBNET_IDS=""
  if [[ -n "$TF_VPC_ID" ]]; then
    TF_SUBNET_IDS=$(awk '
      /^  subnetIds:/ { capture=1; next }
      capture && /^    - / { sub(/^    - /, ""); print; next }
      capture { capture=0 }
    ' "$MANIFEST_FILE" | tr -d '"' | tr -d "'" || true)
  fi

  # Write terraform.tfvars
  cat > "$TF_DIR/terraform.tfvars" <<TFVARS
# Auto-generated by deploy-pipeline.sh from deployment-manifest.yaml
# Generated at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

prefix             = "${PREFIX}"
region             = "${REGION}"
create_new_repo    = ${TF_CREATE_NEW_REPO}
repo_name          = "${TF_REPO_NAME}"
branch             = "${TF_BRANCH}"
require_approval   = ${TF_REQUIRE_APPROVAL}
notification_email = "${TF_NOTIFICATION_EMAIL}"
vpc_id             = "${TF_VPC_ID}"
chatbot_stack_name = "${CHATBOT_STACK_NAME}"
TFVARS

  # Add subnet_ids as a proper list
  if [[ -n "$TF_SUBNET_IDS" ]]; then
    # Convert newline-separated list to terraform list format
    SUBNET_LIST=$(echo "$TF_SUBNET_IDS" | while read -r s; do echo "  \"$s\","; done)
    cat >> "$TF_DIR/terraform.tfvars" <<TFVARS
subnet_ids         = [
${SUBNET_LIST}
]
TFVARS
  else
    echo 'subnet_ids         = []' >> "$TF_DIR/terraform.tfvars"
  fi

  ok "Generated $TF_DIR/terraform.tfvars"
  info "Contents:"
  cat "$TF_DIR/terraform.tfvars"
  echo ""

  # Also run CDK bootstrap if not skipped (needed because CodeBuild still runs cdk deploy)
  if [[ "$SKIP_BOOTSTRAP" == "false" ]]; then
    info "Running CDK bootstrap (needed for chatbot CDK deploy inside CodeBuild)..."
    # shellcheck disable=SC2086
    npx cdk bootstrap "aws://$ACCOUNT_ID/$REGION" $AWS_PROFILE_ARG
    ok "CDK bootstrap complete"
  fi
fi

# ── Step 7: Deploy Pipeline ──────────────────────────────────

if [[ "$DEPLOY_TOOL" == "cdk" ]]; then
  section "Step 7/8: Deploying pipeline stack via CDK"

  # shellcheck disable=SC2086
  npx cdk deploy "$PIPELINE_STACK_NAME" --require-approval never $AWS_PROFILE_ARG

  ok "Pipeline stack deployed via CDK"

else
  section "Step 7/8: Deploying pipeline via Terraform"

  TF_DIR="$PROJECT_ROOT/terraform/pipeline"

  info "Running terraform init..."
  terraform -chdir="$TF_DIR" init \
    -backend-config="bucket=$TF_STATE_BUCKET" \
    -backend-config="key=$TF_KEY" \
    -backend-config="region=$REGION" \
    -backend-config="use_lockfile=true"

  info "Running terraform apply..."
  terraform -chdir="$TF_DIR" apply -auto-approve

  ok "Pipeline deployed via Terraform"
fi

# ── Step 8: Push to CodeCommit ────────────────────────────────
section "Step 8/8: Pushing code to CodeCommit"

# Get the CodeCommit clone URL
if [[ "$DEPLOY_TOOL" == "cdk" ]]; then
  # From CloudFormation stack outputs
  # shellcheck disable=SC2086
  CLONE_URL=$(aws cloudformation describe-stacks \
    --stack-name "$PIPELINE_STACK_NAME" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='CodeCommitCloneUrlHTTPS'].OutputValue" \
    --output text $AWS_PROFILE_ARG 2>/dev/null || true)
else
  # From Terraform outputs
  TF_DIR="$PROJECT_ROOT/terraform/pipeline"
  CLONE_URL=$(terraform -chdir="$TF_DIR" output -raw codecommit_clone_url_https 2>/dev/null || true)
fi

if [[ -z "$CLONE_URL" || "$CLONE_URL" == "None" ]]; then
  # Fallback: try to get it from the repo name in the manifest
  REPO_NAME=$(grep 'existingRepositoryName:' deployment-manifest.yaml 2>/dev/null \
    | sed 's/.*existingRepositoryName:[[:space:]]*//' | tr -d '"' | tr -d "'" || true)
  if [[ -z "$REPO_NAME" ]]; then
    REPO_NAME=$(grep 'newRepositoryName:' deployment-manifest.yaml 2>/dev/null \
      | sed 's/.*newRepositoryName:[[:space:]]*//' | tr -d '"' | tr -d "'" || true)
  fi
  if [[ -n "$REPO_NAME" ]]; then
    # shellcheck disable=SC2086
    CLONE_URL=$(aws codecommit get-repository \
      --repository-name "$REPO_NAME" \
      --region "$REGION" \
      --query 'repositoryMetadata.cloneUrlHttp' \
      --output text $AWS_PROFILE_ARG 2>/dev/null || true)
  fi
fi

if [[ -z "$CLONE_URL" || "$CLONE_URL" == "None" ]]; then
  err "Could not determine CodeCommit clone URL."
  err "Add the remote manually: git remote add $REMOTE_NAME <clone-url>"
  exit 1
fi

info "CodeCommit URL: $CLONE_URL"

# Add or update the remote
if git remote get-url "$REMOTE_NAME" >/dev/null 2>&1; then
  EXISTING_URL=$(git remote get-url "$REMOTE_NAME")
  if [[ "$EXISTING_URL" != "$CLONE_URL" ]]; then
    warn "Remote '$REMOTE_NAME' exists with different URL, updating..."
    git remote set-url "$REMOTE_NAME" "$CLONE_URL"
  else
    info "Remote '$REMOTE_NAME' already configured correctly"
  fi
else
  git remote add "$REMOTE_NAME" "$CLONE_URL"
  ok "Added git remote '$REMOTE_NAME'"
fi

# Force-add gitignored files the pipeline needs
GITIGNORED_FILES=()

if [[ -f "bin/config.json" ]]; then
  git add -f bin/config.json
  GITIGNORED_FILES+=("bin/config.json")
fi

if [[ -f "deployment-manifest.yaml" ]]; then
  git add -f deployment-manifest.yaml
  GITIGNORED_FILES+=("deployment-manifest.yaml")
fi

if [[ ${#GITIGNORED_FILES[@]} -gt 0 ]]; then
  info "Force-added gitignored files: ${GITIGNORED_FILES[*]}"
fi

# Stage all other changes
git add -A

# Check if there's anything to commit
if git diff --cached --quiet 2>/dev/null; then
  info "No new changes to commit, pushing existing commits..."
else
  git commit -m "chore: pipeline setup - initial push to CodeCommit

Includes force-added files needed by the pipeline:
$(printf '  - %s\n' "${GITIGNORED_FILES[@]}")"
  ok "Created commit"
fi

# Push to CodeCommit
info "Pushing to $REMOTE_NAME/$BRANCH..."
git push "$REMOTE_NAME" "HEAD:$BRANCH"

ok "Code pushed to CodeCommit"

# ── Summary ───────────────────────────────────────────────────
echo ""
echo -e "${BOLD}============================================================${NC}"
ok "Pipeline deployment complete!"
echo -e "${BOLD}============================================================${NC}"
echo ""
info "What just happened:"
if [[ "$DEPLOY_TOOL" == "cdk" ]]; then
  echo "  1. Pipeline stack deployed via CDK:  $PIPELINE_STACK_NAME"
else
  echo "  1. Pipeline deployed via Terraform:  terraform/pipeline/"
fi
echo "  2. Code pushed to CodeCommit → pipeline triggered"
echo ""
info "The pipeline will now:"
if grep -q 'requireApproval: true' deployment-manifest.yaml 2>/dev/null; then
  echo "  1. Wait for manual approval in the CodePipeline console"
  echo "     (or via email if notificationEmail is configured)"
  echo "  2. After approval → deploy $CHATBOT_STACK_NAME"
else
  echo "  1. Deploy $CHATBOT_STACK_NAME automatically"
fi
echo ""
info "Monitor the pipeline:"
echo "  https://${REGION}.console.aws.amazon.com/codesuite/codepipeline/pipelines?region=${REGION}"
echo ""
info "Future updates — just push to CodeCommit:"
echo "  git add -A && git commit -m 'your message' && git push $REMOTE_NAME HEAD:$BRANCH"
echo ""
info "To re-run this script later (faster, skipping installs):"
if [[ "$DEPLOY_TOOL" == "cdk" ]]; then
  echo "  ./scripts/deploy-pipeline.sh --cdk --skip-prereqs --skip-bootstrap"
else
  echo "  ./scripts/deploy-pipeline.sh --terraform --tf-state-bucket $TF_STATE_BUCKET --skip-prereqs --skip-bootstrap"
fi

#!/bin/bash

# =============================================================================
# VPC Endpoints Creation Script for AWS GenAI LLM Chatbot
# =============================================================================
# This script creates all required VPC endpoints for the chatbot solution.
# Run with: ./scripts/create-vpc-endpoints.sh
# =============================================================================

set -e

# Disable AWS CLI pager (prevents output from opening in less/more)
export AWS_PAGER=""

# -----------------------------------------------------------------------------
# CONFIGURATION - Update these values for your environment
# -----------------------------------------------------------------------------
VPC_ID="vpc-0bee666b81ca89734"
SUBNET_IDS="subnet-0ff16c4f5cdf49bed,subnet-06453b8fe50459fd0"
REGION="il-central-1"

# Optional: Specify a security group ID, or leave empty to use VPC default
SECURITY_GROUP_ID=""

# Features enabled (set to "true" or "false")
ENABLE_PRIVATE_WEBSITE="true"
ENABLE_BEDROCK="true"
ENABLE_SAGEMAKER="false"
ENABLE_KENDRA="false"
ENABLE_AURORA="false"
ENABLE_OPENSEARCH="false"

# -----------------------------------------------------------------------------
# Colors for output
# -----------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# -----------------------------------------------------------------------------
# Helper functions
# -----------------------------------------------------------------------------
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Get route table IDs for the VPC
get_route_table_ids() {
    aws ec2 describe-route-tables \
        --filters "Name=vpc-id,Values=${VPC_ID}" \
        --query 'RouteTables[*].RouteTableId' \
        --output text \
        --region "$REGION" | tr '\t' ','
}

# Check if endpoint already exists
endpoint_exists() {
    local service_name=$1
    local result=$(aws ec2 describe-vpc-endpoints \
        --filters "Name=vpc-id,Values=${VPC_ID}" "Name=service-name,Values=${service_name}" \
        --query 'VpcEndpoints[0].VpcEndpointId' \
        --output text \
        --region "$REGION" 2>/dev/null)
    
    if [ "$result" != "None" ] && [ -n "$result" ]; then
        echo "$result"
        return 0
    fi
    return 1
}

# Create Gateway Endpoint
create_gateway_endpoint() {
    local service=$1
    local service_name="com.amazonaws.${REGION}.${service}"
    
    log_info "Checking Gateway endpoint for ${service}..."
    
    if existing_id=$(endpoint_exists "$service_name"); then
        log_warn "Gateway endpoint for ${service} already exists: ${existing_id}"
        return 0
    fi
    
    log_info "Creating Gateway endpoint for ${service}..."
    
    local route_tables=$(get_route_table_ids)
    
    aws ec2 create-vpc-endpoint \
        --vpc-id "$VPC_ID" \
        --service-name "$service_name" \
        --vpc-endpoint-type Gateway \
        --route-table-ids ${route_tables//,/ } \
        --region "$REGION" \
        --output text \
        --query 'VpcEndpoint.VpcEndpointId'
    
    log_info "✓ Created Gateway endpoint for ${service}"
}

# Create Interface Endpoint with Private DNS
create_interface_endpoint() {
    local service=$1
    local service_name="com.amazonaws.${REGION}.${service}"
    
    log_info "Checking Interface endpoint for ${service}..."
    
    if existing_id=$(endpoint_exists "$service_name"); then
        log_warn "Interface endpoint for ${service} already exists: ${existing_id}"
        return 0
    fi
    
    log_info "Creating Interface endpoint for ${service} with Private DNS..."
    
    local sg_option=""
    if [ -n "$SECURITY_GROUP_ID" ]; then
        sg_option="--security-group-ids $SECURITY_GROUP_ID"
    fi
    
    aws ec2 create-vpc-endpoint \
        --vpc-id "$VPC_ID" \
        --service-name "$service_name" \
        --vpc-endpoint-type Interface \
        --subnet-ids ${SUBNET_IDS//,/ } \
        --private-dns-enabled \
        $sg_option \
        --region "$REGION" \
        --output text \
        --query 'VpcEndpoint.VpcEndpointId'
    
    log_info "✓ Created Interface endpoint for ${service}"
}

# -----------------------------------------------------------------------------
# Main execution
# -----------------------------------------------------------------------------
echo ""
echo "=============================================="
echo "  VPC Endpoints Creation Script"
echo "=============================================="
echo ""
echo "Configuration:"
echo "  VPC ID:           ${VPC_ID}"
echo "  Subnets:          ${SUBNET_IDS}"
echo "  Region:           ${REGION}"
echo "  Private Website:  ${ENABLE_PRIVATE_WEBSITE}"
echo "  Bedrock:          ${ENABLE_BEDROCK}"
echo "  SageMaker:        ${ENABLE_SAGEMAKER}"
echo "  Kendra:           ${ENABLE_KENDRA}"
echo "  Aurora:           ${ENABLE_AURORA}"
echo "  OpenSearch:       ${ENABLE_OPENSEARCH}"
echo ""

# Confirm before proceeding
read -p "Do you want to proceed? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_info "Aborted by user."
    exit 0
fi

echo ""
log_info "Starting VPC endpoint creation..."
echo ""

# -----------------------------------------------------------------------------
# GATEWAY ENDPOINTS (always required)
# -----------------------------------------------------------------------------
echo "=== Gateway Endpoints ==="

create_gateway_endpoint "s3"
create_gateway_endpoint "dynamodb"

# -----------------------------------------------------------------------------
# INTERFACE ENDPOINTS - Core (always required)
# -----------------------------------------------------------------------------
echo ""
echo "=== Core Interface Endpoints ==="

create_interface_endpoint "s3"
create_interface_endpoint "secretsmanager"

# -----------------------------------------------------------------------------
# INTERFACE ENDPOINTS - SageMaker (if enabled)
# -----------------------------------------------------------------------------
if [ "$ENABLE_SAGEMAKER" = "true" ]; then
    echo ""
    echo "=== SageMaker Endpoints ==="
    create_interface_endpoint "sagemaker.runtime"
fi

# -----------------------------------------------------------------------------
# INTERFACE ENDPOINTS - Private Website (if enabled)
# -----------------------------------------------------------------------------
if [ "$ENABLE_PRIVATE_WEBSITE" = "true" ]; then
    echo ""
    echo "=== Private Website Endpoints ==="
    
    create_interface_endpoint "execute-api"
    create_interface_endpoint "appsync-api"
    create_interface_endpoint "lambda"
    create_interface_endpoint "sns"
    create_interface_endpoint "states"
    create_interface_endpoint "ssm"
    create_interface_endpoint "kms"
    
    # Bedrock endpoints (if enabled with private website)
    if [ "$ENABLE_BEDROCK" = "true" ]; then
        echo ""
        echo "=== Bedrock Endpoints ==="
        create_interface_endpoint "bedrock"
        create_interface_endpoint "bedrock-runtime"
    fi
    
    # Kendra endpoint (if enabled)
    if [ "$ENABLE_KENDRA" = "true" ]; then
        echo ""
        echo "=== Kendra Endpoints ==="
        create_interface_endpoint "kendra"
    fi
    
    # Aurora/RDS endpoints (if enabled)
    if [ "$ENABLE_AURORA" = "true" ]; then
        echo ""
        echo "=== Aurora/RDS Endpoints ==="
        create_interface_endpoint "rds"
        create_interface_endpoint "rds-data"
    fi
    
    # ECS/Logs/EC2 endpoints (if Aurora or OpenSearch enabled)
    if [ "$ENABLE_AURORA" = "true" ] || [ "$ENABLE_OPENSEARCH" = "true" ]; then
        echo ""
        echo "=== Indexing Endpoints (ECS/Logs/EC2) ==="
        create_interface_endpoint "ecs"
        create_interface_endpoint "logs"
        create_interface_endpoint "ec2"
    fi
fi

echo ""
echo "=============================================="
log_info "VPC endpoint creation completed!"
echo "=============================================="
echo ""

# -----------------------------------------------------------------------------
# Display created endpoints
# -----------------------------------------------------------------------------
log_info "Listing all VPC endpoints in ${VPC_ID}:"
echo ""

aws ec2 describe-vpc-endpoints \
    --filters "Name=vpc-id,Values=${VPC_ID}" \
    --query 'VpcEndpoints[*].[ServiceName,VpcEndpointId,VpcEndpointType,State]' \
    --output table \
    --region "$REGION"

echo ""
log_info "Done! You can now set 'createVpcEndpoints: false' in bin/config.json"

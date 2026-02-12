# Configuration Parameters Reference

This document provides a comprehensive reference for all configuration parameters supported in the deployment manifest YAML file for the AWS GenAI LLM Chatbot solution.

## Table of Contents

- [Configuration Overview](#configuration-overview)
- [Configuration Loading Priority](#configuration-loading-priority)
- [Supported Parameters](#supported-parameters)
  - [Core Deployment Settings](#core-deployment-settings)
  - [Website/UI Configuration](#websiteui-configuration)
  - [VPC/Network Configuration](#vpcnetwork-configuration)
  - [Authentication (Cognito Federation)](#authentication-cognito-federation)
  - [Bedrock Guardrails](#bedrock-guardrails)
  - [RAG Configuration](#rag-configuration)
- [YAML Manifest Examples](#yaml-manifest-examples)
- [Validation Rules](#validation-rules)
- [Testing the Configuration](#testing-the-configuration)

---

## Configuration Overview

The solution supports configuration through two files:

1. **`config.json`** - Full configuration with all parameters (set once during initial setup)
2. **`deployment-manifest.yaml`** - Override file for parameters that change between deployments (recommended for CI/CD pipelines)

## Configuration Loading Priority

Parameters are loaded in the following order (later takes precedence):

```
Defaults → config.json → deployment-manifest.yaml
```

When a parameter is specified in the YAML manifest, it will override the value from `config.json`.

---

## Supported Parameters

The following parameters can be configured in the `deployment-manifest.yaml` file:

### Core Deployment Settings

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prefix` | string | **Yes** | Resource naming prefix and primary deployment identifier. Max 16 characters, must start with a letter, alphanumeric and hyphens only. |
| `enableWaf` | boolean | No | Enable AWS WAF (Web Application Firewall) rules for protection against common web exploits. |
| `createCMKs` | boolean | No | Create KMS Customer Managed Keys for data encryption at rest (BYOK encryption). |
| `advancedMonitoring` | boolean | No | Enable Amazon CloudWatch custom metrics, alarms, and AWS X-Ray tracing. |

### Website/UI Configuration (Private Website)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `privateWebsite` | boolean | No | Deploy as private website (only accessible within VPC via VPC endpoints). |
| `certificate` | string | No | ACM certificate ARN. Must be in `il-central-1` for private website deployments. |
| `domain` | string | No | Custom domain name for the private website (e.g., `chat.example.com`). Requires certificate. |

### VPC/Network Configuration

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `vpc.vpcId` | string | No | Existing VPC ID (format: `vpc-xxxxxxxxxxxxxxxxx`). |
| `vpc.subnetIds` | string[] | No | Specific VPC subnet IDs to use. At least one required when specified. |
| `vpc.executeApiVpcEndpointId` | string | No | Existing execute-api VPC endpoint ID (format: `vpce-xxxxxxxx`). |
| `vpc.s3VpcEndpointId` | string | No | S3 VPC endpoint ID (format: `vpce-xxxxxxxx`). Required when providing `s3VpcEndpointIps`. |
| `vpc.s3VpcEndpointIps` | string[] | No | S3 VPC endpoint IP addresses (one per AZ). Requires `s3VpcEndpointId`. |

### Authentication (Cognito Federation)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cognitoFederation.enabled` | boolean | No | Enable Federated (SSO) login with Cognito. |
| `cognitoFederation.autoRedirect` | boolean | No | Automatically redirect users to identity provider (skip Cognito login page). |
| `cognitoFederation.customProviderName` | string | Conditional | Name of the SAML/OIDC provider. Required when federation enabled and type is not "later". Max 32 characters. |
| `cognitoFederation.customProviderType` | string | No | Provider type: `"SAML"`, `"OIDC"`, or `"later"` (configure manually after deployment). |
| `cognitoFederation.cognitoDomain` | string | No | Cognito domain prefix for hosted UI. Lowercase alphanumeric and hyphens only. |

#### SAML Configuration (when `customProviderType` = "SAML")

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cognitoFederation.customSAML.metadataDocumentUrl` | string | **Yes** | HTTPS URL to SAML metadata document from your identity provider. |

#### OIDC Configuration (when `customProviderType` = "OIDC")

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cognitoFederation.customOIDC.OIDCClient` | string | **Yes** | OIDC client ID. Alphanumeric, hyphens, underscores, max 255 characters. |
| `cognitoFederation.customOIDC.OIDCSecret` | string | **Yes** | Secrets Manager ARN containing OIDC client secret. |
| `cognitoFederation.customOIDC.OIDCIssuerURL` | string | **Yes** | HTTPS OIDC issuer URL from your identity provider. |

### Bedrock Guardrails

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `bedrock.guardrails.enabled` | boolean | No | Enable Bedrock Guardrails for responsible AI content filtering. |
| `bedrock.guardrails.identifier` | string | Conditional | Bedrock Guardrail Identifier. Required when guardrails enabled. Lowercase alphanumeric. |
| `bedrock.guardrails.version` | string | Conditional | Bedrock Guardrail Version. Required when guardrails enabled. |

### RAG Configuration

Only OpenSearch and Knowledge Base engines are supported in the YAML manifest.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `rag.enabled` | boolean | No | Enable RAG capabilities for document retrieval. |
| `rag.crossEncodingEnabled` | boolean | No | Enable cross-encoding for improved RAG relevance scoring. |
| `rag.engines.opensearch.enabled` | boolean | No | Enable Amazon OpenSearch Service as RAG engine. |
| `rag.engines.knowledgeBase.enabled` | boolean | No | Enable Amazon Bedrock Knowledge Base as RAG engine. |
| `rag.engines.knowledgeBase.external` | array | No | Array of external Knowledge Base indexes to connect. |
| `rag.embeddingsModels` | array | No | Array of embedding model configurations. |
| `rag.crossEncoderModels` | array | No | Array of cross-encoder model configurations. |

#### External Knowledge Base Object

```yaml
external:
  - name: "my-knowledge-base"           # Required: alphanumeric, hyphens, underscores
    knowledgeBaseId: "ABCD123456"       # Required: exactly 10 uppercase alphanumeric characters
    region: "us-east-1"                 # Optional: AWS region
    roleArn: "arn:aws:iam::..."         # Optional: cross-account IAM role ARN
    enabled: true                        # Optional: defaults to true
```

#### Model Configuration Object

```yaml
embeddingsModels:
  - provider: "bedrock"                  # Required: "sagemaker", "bedrock", "openai", or "nexus"
    name: "amazon.titan-embed-text-v1"   # Required: model name
    dimensions: 1536                     # Optional: embedding dimensions
    default: true                        # Optional: set as default model
```

---

## YAML Manifest Examples

### Minimal Manifest

```yaml
prefix: "dev-chatbot"
```

### Production Manifest with All Features

```yaml
# Deployment Manifest for AWS GenAI LLM Chatbot

# Core Settings - prefix is the primary deployment identifier
prefix: "prod-cb"
enableWaf: true
createCMKs: true
advancedMonitoring: true

# Private Website Configuration (il-central-1 region)
privateWebsite: true
certificate: "arn:aws:acm:il-central-1:123456789012:certificate/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
domain: "chat.example.com"

# VPC Configuration
vpc:
  vpcId: "vpc-0123456789abcdef0"
  subnetIds:
    - "subnet-0123456789abcdef0"
    - "subnet-0123456789abcdef1"
  executeApiVpcEndpointId: "vpce-0123456789abcdef0"
  s3VpcEndpointId: "vpce-0123456789abcdef1"
  s3VpcEndpointIps:
    - "10.0.1.100"
    - "10.0.2.100"

# Authentication (SAML)
cognitoFederation:
  enabled: true
  autoRedirect: true
  customProviderName: "EnterpriseSSO"
  customProviderType: "SAML"
  cognitoDomain: "my-chatbot"
  customSAML:
    metadataDocumentUrl: "https://idp.example.com/metadata.xml"

# Bedrock Guardrails
bedrock:
  guardrails:
    enabled: true
    identifier: "abc123def456"
    version: "1"

# RAG Configuration
rag:
  enabled: true
  crossEncodingEnabled: false
  engines:
    opensearch:
      enabled: true
    knowledgeBase:
      enabled: true
      external:
        - name: "corporate-kb"
          knowledgeBaseId: "ABCD123456"
          region: "us-east-1"
          enabled: true
  embeddingsModels:
    - provider: "bedrock"
      name: "amazon.titan-embed-text-v1"
      dimensions: 1536
      default: true
```

### OIDC Authentication Example

```yaml
prefix: "oidc-cb"

cognitoFederation:
  enabled: true
  autoRedirect: true
  customProviderName: "OktaSSO"
  customProviderType: "OIDC"
  cognitoDomain: "my-okta-chatbot"
  customOIDC:
    OIDCClient: "0oa1234567890abcdef"
    OIDCSecret: "arn:aws:secretsmanager:il-central-1:123456789012:secret:okta-client-secret-AbCdEf"
    OIDCIssuerURL: "https://dev-123456.okta.com"
```

---

## Validation Rules

### Core Settings

| Parameter | Validation |
|-----------|------------|
| `prefix` | **Required**. 1-16 characters, must start with letter, alphanumeric and hyphens only |

### VPC

| Parameter | Validation |
|-----------|------------|
| `vpc.vpcId` | Format: `vpc-[a-f0-9]{8,17}` |
| `vpc.subnetIds` | Array of strings matching format: `subnet-[a-f0-9]{8,17}` |
| `vpc.executeApiVpcEndpointId` | Format: `vpce-[a-f0-9]+` |
| `vpc.s3VpcEndpointId` | Format: `vpce-[a-f0-9]+` |
| `vpc.s3VpcEndpointIps` | Array of valid IPv4 addresses |

### Authentication

| Parameter | Validation |
|-----------|------------|
| `cognitoFederation.customProviderName` | 1-32 characters, alphanumeric, hyphens, underscores |
| `cognitoFederation.cognitoDomain` | Lowercase alphanumeric and hyphens only |
| `cognitoFederation.customSAML.metadataDocumentUrl` | Must be HTTPS URL |
| `cognitoFederation.customOIDC.OIDCClient` | 1-255 characters, alphanumeric, hyphens, underscores |
| `cognitoFederation.customOIDC.OIDCSecret` | Valid Secrets Manager ARN format |
| `cognitoFederation.customOIDC.OIDCIssuerURL` | Must be HTTPS URL |

### Certificate & Domain

| Parameter | Validation |
|-----------|------------|
| `certificate` | Valid ACM certificate ARN format |
| `domain` | Valid domain name format (e.g., `chat.example.com`) |

### RAG

| Parameter | Validation |
|-----------|------------|
| `rag.engines.knowledgeBase.external[].name` | Alphanumeric, hyphens, underscores |
| `rag.engines.knowledgeBase.external[].knowledgeBaseId` | Exactly 10 uppercase alphanumeric characters |
| `rag.engines.knowledgeBase.external[].roleArn` | Valid IAM role ARN format |

---

## Testing the Configuration

### Run Validation Tests

```bash
# Run the validation test suite
npx ts-node bin/config-loader.test.ts
```

### Test Your Manifest

```bash
# Test parsing and validation of your manifest
npx ts-node bin/test-config-override.ts
```

### Deploy with Manifest

```bash
# Deploy the CDK stack (will use deployment-manifest.yaml if present)
npx cdk deploy --all
```

---

## CI/CD Pipeline Integration

### GitHub Actions Example

```yaml
name: Deploy Chatbot

on:
  push:
    paths:
      - 'deployment-manifest.yaml'
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Validate manifest
        run: npx ts-node bin/config-loader.test.ts
        
      - name: Deploy CDK
        run: npx cdk deploy --all --require-approval never
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_REGION: ${{ vars.AWS_REGION }}
```

---

## Notes

1. **Conditional Parameters**: Some parameters are only required when their parent feature is enabled (e.g., SAML metadata URL when `customProviderType` is "SAML").

2. **RAG Engine Requirement**: When `rag.enabled` is true, at least one RAG engine (OpenSearch or Knowledge Base) must be enabled.

3. **S3 VPC Endpoint IPs**: When providing `s3VpcEndpointIps`, you must also provide `s3VpcEndpointId`. These must match your actual VPC endpoint configuration.

4. **Security**: SAML metadata URLs and OIDC issuer URLs must use HTTPS for security.

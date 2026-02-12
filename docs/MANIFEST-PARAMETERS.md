# Deployment Manifest Parameters Reference

This document provides a comprehensive reference for all configuration parameters supported by the AWS GenAI LLM Chatbot solution, with a focus on parameters that can be configured via the deployment manifest YAML file.

## Table of Contents

- [Overview](#overview)
- [Configuration Files](#configuration-files)
- [Manifest-Supported Parameters](#manifest-supported-parameters)
  - [Core Deployment Settings](#core-deployment-settings)
  - [Logging Configuration](#logging-configuration)
  - [Website/UI Configuration](#websiteui-configuration)
  - [VPC/Network Configuration](#vpcnetwork-configuration)
  - [Authentication (Cognito Federation)](#authentication-cognito-federation)
  - [Bedrock Guardrails](#bedrock-guardrails)
  - [RAG Configuration](#rag-configuration)
  - [CI/CD Pipeline Configuration](#cicd-pipeline-configuration)
- [Config.json Only Parameters](#configjson-only-parameters)
- [Validation Rules](#validation-rules)
- [Examples](#examples)

---

## Overview

The solution uses a two-file configuration system:

1. **`config.json`** - Complete configuration with all parameters (typically set during initial setup via the CLI wizard)
2. **`deployment-manifest.yaml`** - Override file for parameters that clients need to modify (recommended for CI/CD pipelines)

### Configuration Priority

```
deployment-manifest.yaml > config.json > defaults
```

When a parameter is specified in the YAML manifest, it overrides the value from `config.json`.

### When to Use Each File

| File | Use For |
|------|---------|
| `config.json` | Initial setup, rarely-changed settings, full configuration |
| `deployment-manifest.yaml` | Client-managed parameters, CI/CD-triggered changes |

---

## Configuration Files

### deployment-manifest.yaml

Location: Project root (`/deployment-manifest.yaml`)

This file contains only the parameters that clients may need to modify. Changes to this file trigger the CI/CD pipeline (if configured).

### config.json

Location: `/bin/config.json`

This file contains the complete configuration, including parameters not exposed in the manifest (like SageMaker models, Kendra, Aurora, etc.).

---

## Manifest-Supported Parameters

The following parameters can be configured via `deployment-manifest.yaml`:

### Core Deployment Settings

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prefix` | string | **Yes** | - | Resource naming prefix and primary deployment identifier |
| `enableWaf` | boolean | No | `true` | Enable AWS WAF protection |
| `createCMKs` | boolean | No | `false` | Create KMS Customer Managed Keys for encryption |
| `advancedMonitoring` | boolean | No | `false` | Enable CloudWatch metrics, alarms, and X-Ray |

#### prefix

The primary identifier for this deployment. Used as a prefix for all AWS resource names.

**Constraints:**
- Required field
- 1-16 characters
- Must start with a letter
- Only letters, numbers, and hyphens allowed

**Example:**
```yaml
prefix: "prod-chatbot"
```

#### enableWaf

Enable AWS WAF (Web Application Firewall) to protect against common web exploits.

**Recommendation:** Always enable in production environments.

```yaml
enableWaf: true
```

#### createCMKs

Create KMS Customer Managed Keys for data encryption at rest. Required for BYOK (Bring Your Own Key) compliance.

```yaml
createCMKs: true
```

#### advancedMonitoring

Enable enhanced monitoring:
- CloudWatch custom metrics
- CloudWatch alarms
- AWS X-Ray distributed tracing

```yaml
advancedMonitoring: true
```

---

### Logging Configuration

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `disableS3AccessLogs` | boolean | No | `false` | Disable S3 server access logging |
| `logArchiveBucketName` | string | No | - | Centralized log bucket for ALB logs |

#### disableS3AccessLogs

Disable S3 server access logging for all solution buckets.

**When to use:**
- Set to `true` if using CloudTrail data events for S3 logging
- Avoids duplicate logging and reduces storage costs

```yaml
disableS3AccessLogs: true
```

#### logArchiveBucketName

Name of a centralized S3 bucket for ALB access logs. Supports cross-account logging.

When specified, ALB logs are written to: `s3://<bucket>/<prefix>/alb-logs/`

**Prerequisites:**
- Bucket must already exist
- Bucket policy must allow ALB to write logs
- Must be in the same region as deployment

**Constraints:**
- 3-63 characters
- Lowercase letters, numbers, dots, and hyphens
- Must start and end with letter or number

```yaml
logArchiveBucketName: "company-central-logs"
```

---

### Website/UI Configuration

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `privateWebsite` | boolean | No | `false` | Deploy as private website (VPC-only access) |
| `certificate` | string | No | - | ACM certificate ARN for HTTPS |
| `domain` | string | No | - | Custom domain name |

#### privateWebsite

Deploy the chatbot as a private website, accessible only within a VPC.

**When `true`:**
- No CloudFront distribution
- Access only via VPC endpoints
- Requires VPC configuration

**When `false`:**
- Public website via CloudFront
- Accessible from the internet

```yaml
privateWebsite: true
```

#### certificate

ACM certificate ARN for HTTPS.

**Region requirements:**
- Private website: Certificate must be in the deployment region (e.g., `il-central-1`)
- Public website: Certificate must be in `us-east-1` (CloudFront requirement)

**Format:** `arn:aws:acm:<region>:<account>:certificate/<id>`

```yaml
certificate: "arn:aws:acm:il-central-1:123456789012:certificate/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
```

#### domain

Custom domain name for the chatbot.

After deployment, create a DNS record pointing to:
- Private website: ALB DNS name
- Public website: CloudFront distribution domain

```yaml
domain: "chatbot.company.com"
```

---

### VPC/Network Configuration

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `vpc.vpcId` | string | No | - | Existing VPC ID |
| `vpc.subnetIds` | string[] | No | - | Subnet IDs for resources |
| `vpc.executeApiVpcEndpointId` | string | No | - | API Gateway VPC endpoint ID |
| `vpc.s3VpcEndpointId` | string | No | - | S3 VPC endpoint ID |
| `vpc.s3VpcEndpointIps` | string[] | No | - | S3 VPC endpoint IP addresses |

#### vpc.vpcId

ID of an existing VPC. If not provided, a new VPC is created.

**Format:** `vpc-<8-17 hex characters>`

```yaml
vpc:
  vpcId: "vpc-0123456789abcdef0"
```

#### vpc.subnetIds

List of private subnet IDs for Lambda functions and other resources.

**Requirements:**
- At least 2 subnets in different AZs for high availability
- Must have NAT Gateway or VPC endpoints for AWS services

```yaml
vpc:
  subnetIds:
    - "subnet-0123456789abcdef0"
    - "subnet-0123456789abcdef1"
```

#### vpc.executeApiVpcEndpointId

ID of an existing VPC endpoint for API Gateway (execute-api service).

Required for private API Gateway access from within the VPC.

```yaml
vpc:
  executeApiVpcEndpointId: "vpce-0123456789abcdef0"
```

#### vpc.s3VpcEndpointId & vpc.s3VpcEndpointIps

S3 VPC interface endpoint configuration for private S3 access.

**Important:** Both must be provided together.

```yaml
vpc:
  s3VpcEndpointId: "vpce-0123456789abcdef1"
  s3VpcEndpointIps:
    - "10.0.1.100"
    - "10.0.2.100"
```

---

### Authentication (Cognito Federation)

Configure federated authentication with enterprise identity providers using SAML 2.0 or OIDC.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `cognitoFederation.enabled` | boolean | No | `false` | Enable federated SSO |
| `cognitoFederation.autoRedirect` | boolean | No | `false` | Auto-redirect to IdP |
| `cognitoFederation.customProviderName` | string | Conditional | - | Identity provider name |
| `cognitoFederation.customProviderType` | string | No | - | "SAML", "OIDC", or "later" |
| `cognitoFederation.cognitoDomain` | string | No | Auto | Cognito hosted UI domain prefix |
| `cognitoFederation.customSAML.metadataDocumentUrl` | string | Conditional | - | SAML metadata URL |
| `cognitoFederation.customOIDC.OIDCClient` | string | Conditional | - | OIDC client ID |
| `cognitoFederation.customOIDC.OIDCSecret` | string | Conditional | - | Secrets Manager ARN for OIDC secret |
| `cognitoFederation.customOIDC.OIDCIssuerURL` | string | Conditional | - | OIDC issuer URL |

#### SAML Configuration Example

```yaml
cognitoFederation:
  enabled: true
  autoRedirect: true
  customProviderName: "EnterpriseSSO"
  customProviderType: "SAML"
  cognitoDomain: "my-chatbot"
  customSAML:
    metadataDocumentUrl: "https://idp.company.com/saml/metadata.xml"
```

#### OIDC Configuration Example

```yaml
cognitoFederation:
  enabled: true
  autoRedirect: true
  customProviderName: "OktaSSO"
  customProviderType: "OIDC"
  cognitoDomain: "my-chatbot"
  customOIDC:
    OIDCClient: "0oa1234567890abcdef"
    OIDCSecret: "arn:aws:secretsmanager:il-central-1:123456789012:secret:oidc-secret"
    OIDCIssuerURL: "https://company.okta.com"
```

---

### Bedrock Guardrails

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `bedrock.guardrails.enabled` | boolean | Yes (in section) | `false` | Enable Bedrock Guardrails |
| `bedrock.guardrails.identifier` | string | Conditional | - | Guardrail ID from Bedrock |
| `bedrock.guardrails.version` | string | Conditional | - | Guardrail version |

**Prerequisites:** Create a guardrail in the Bedrock console first.

```yaml
bedrock:
  guardrails:
    enabled: true
    identifier: "abc123def456"
    version: "1"
```

---

### RAG Configuration

Configure Retrieval Augmented Generation for document-based Q&A.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `rag.enabled` | boolean | No | `false` | Enable RAG capabilities |
| `rag.crossEncodingEnabled` | boolean | No | `false` | Enable cross-encoder re-ranking |
| `rag.engines.opensearch.enabled` | boolean | No | `false` | Enable OpenSearch engine |
| `rag.engines.knowledgeBase.enabled` | boolean | No | `false` | Enable Bedrock Knowledge Base |
| `rag.engines.knowledgeBase.external` | array | No | `[]` | External knowledge bases |
| `rag.embeddingsModels` | array | No | `[]` | Embedding model configurations |
| `rag.crossEncoderModels` | array | No | `[]` | Cross-encoder model configurations |

#### External Knowledge Base Configuration

```yaml
rag:
  enabled: true
  engines:
    knowledgeBase:
      enabled: true
      external:
        - name: "corporate-kb"
          knowledgeBaseId: "ABCD123456"  # Exactly 10 chars, uppercase
          region: "il-central-1"
          roleArn: "arn:aws:iam::999999999999:role/CrossAccountAccess"  # Optional
          enabled: true
```

#### Embedding Models Configuration

```yaml
rag:
  embeddingsModels:
    - provider: "bedrock"
      name: "amazon.titan-embed-text-v1"
      dimensions: 1536
      default: true
```

**Available providers:** `bedrock`, `sagemaker`, `openai`

---

### CI/CD Pipeline Configuration

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `pipeline.enabled` | boolean | Yes (in section) | - | Enable pipeline deployment |
| `pipeline.codecommit.existingRepositoryName` | string | Conditional | - | Existing repo name |
| `pipeline.codecommit.createNew` | boolean | Conditional | - | Create new repo |
| `pipeline.codecommit.newRepositoryName` | string | Conditional | - | New repo name |
| `pipeline.branch` | string | No | `main` | Branch to monitor |
| `pipeline.requireApproval` | boolean | No | `true` | Require manual approval |
| `pipeline.notificationEmail` | string | No | - | Notification email |

#### Using Existing Repository

```yaml
pipeline:
  enabled: true
  codecommit:
    existingRepositoryName: "my-chatbot-repo"
  branch: "main"
  requireApproval: true
  notificationEmail: "devops@company.com"
```

#### Creating New Repository

```yaml
pipeline:
  enabled: true
  codecommit:
    createNew: true
    newRepositoryName: "aws-genai-llm-chatbot"
  branch: "main"
  requireApproval: true
  notificationEmail: "devops@company.com"
```

---

## Config.json Only Parameters

The following parameters are NOT supported in the manifest and must be configured via `config.json`:

| Parameter | Description |
|-----------|-------------|
| `enableS3TransferAcceleration` | S3 Transfer Acceleration |
| `directSend` | Lambda direct send mode |
| `provisionedConcurrency` | Lambda provisioned concurrency |
| `caCerts` | Custom CA certificates |
| `cloudfrontLogBucketArn` | CloudFront log bucket |
| `retainOnDelete` | Retain data on deletion |
| `ddbDeletionProtection` | DynamoDB deletion protection |
| `logRetention` | CloudWatch log retention |
| `rateLimitPerIP` | API rate limiting |
| `cfGeoRestrictEnable` | CloudFront geo restriction |
| `cfGeoRestrictList` | Allowed country codes |
| `bedrock.enabled` | Enable Bedrock |
| `bedrock.region` | Bedrock region |
| `bedrock.roleArn` | Cross-account Bedrock role |
| `bedrock.endpointUrl` | Custom Bedrock endpoint |
| `nexus.*` | Nexus Gateway configuration |
| `llms.*` | SageMaker models and scheduling |
| `rag.deployDefaultSagemakerModels` | Deploy default SageMaker models |
| `rag.engines.aurora.*` | Aurora PostgreSQL RAG engine |
| `rag.engines.kendra.*` | Amazon Kendra RAG engine |

---

## Validation Rules

### Format Validation

| Parameter | Format |
|-----------|--------|
| `prefix` | `^[a-zA-Z][a-zA-Z0-9-]*$`, 1-16 chars |
| `vpc.vpcId` | `^vpc-[a-f0-9]{8,17}$` |
| `vpc.subnetIds` | `^subnet-[a-f0-9]{8,17}$` each |
| `vpc.executeApiVpcEndpointId` | `^vpce-[a-f0-9]+$` |
| `vpc.s3VpcEndpointId` | `^vpce-[a-f0-9]+$` |
| `vpc.s3VpcEndpointIps` | Valid IPv4 addresses |
| `certificate` | `^arn:aws:acm:[a-z0-9-]+:\d{12}:certificate\/[a-f0-9-]+$` |
| `domain` | Valid domain format |
| `cognitoFederation.customProviderName` | Alphanumeric, hyphens, underscores, 1-32 chars |
| `cognitoFederation.cognitoDomain` | Lowercase alphanumeric and hyphens |
| `cognitoFederation.customSAML.metadataDocumentUrl` | HTTPS URL |
| `cognitoFederation.customOIDC.OIDCSecret` | Secrets Manager ARN format |
| `cognitoFederation.customOIDC.OIDCIssuerURL` | HTTPS URL |
| `bedrock.guardrails.identifier` | Lowercase alphanumeric |
| `rag.engines.knowledgeBase.external[].knowledgeBaseId` | Exactly 10 uppercase alphanumeric |
| `logArchiveBucketName` | S3 bucket naming rules |
| `pipeline.notificationEmail` | Valid email format |

### Conditional Requirements

| Condition | Required Parameters |
|-----------|---------------------|
| `cognitoFederation.enabled: true` + type "SAML" | `customSAML.metadataDocumentUrl` |
| `cognitoFederation.enabled: true` + type "OIDC" | `customOIDC.OIDCClient`, `OIDCSecret`, `OIDCIssuerURL` |
| `cognitoFederation.enabled: true` + type != "later" | `customProviderName` |
| `bedrock.guardrails.enabled: true` | `identifier`, `version` |
| `rag.enabled: true` | At least one engine enabled |
| `vpc.s3VpcEndpointIps` provided | `vpc.s3VpcEndpointId` required |
| `pipeline.codecommit.createNew: true` | `newRepositoryName` required |

---

## Examples

### Minimal Manifest

```yaml
prefix: "my-chatbot"
```

### Development Environment

```yaml
prefix: "dev-chatbot"
enableWaf: false
advancedMonitoring: false
privateWebsite: false
```

### Production Environment with Full Features

```yaml
prefix: "prod-chatbot"
enableWaf: true
createCMKs: true
advancedMonitoring: true
disableS3AccessLogs: true
logArchiveBucketName: "company-central-logs"
privateWebsite: true
certificate: "arn:aws:acm:il-central-1:123456789012:certificate/xxx"
domain: "chatbot.company.com"

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

cognitoFederation:
  enabled: true
  autoRedirect: true
  customProviderName: "EnterpriseSSO"
  customProviderType: "SAML"
  cognitoDomain: "prod-chatbot"
  customSAML:
    metadataDocumentUrl: "https://idp.company.com/saml/metadata"

bedrock:
  guardrails:
    enabled: true
    identifier: "abc123def456"
    version: "1"

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
          region: "il-central-1"
          enabled: true
  embeddingsModels:
    - provider: "bedrock"
      name: "amazon.titan-embed-text-v1"
      dimensions: 1536
      default: true

pipeline:
  enabled: true
  codecommit:
    createNew: true
    newRepositoryName: "aws-genai-llm-chatbot"
  branch: "main"
  requireApproval: true
  notificationEmail: "devops@company.com"
```

---

## Testing Configuration

### Validate Manifest Schema

```bash
npx ts-node bin/config-loader.test.ts
```

### Test Manifest Parsing

```bash
npx ts-node bin/test-config-override.ts
```

### Dry Run (Synth Only)

```bash
npx cdk synth
```

The output will show all applied overrides:
```
📝 Applying manifest overrides:
  🔀 prefix: old-value → new-value
  🔀 enableWaf: false → true
  ...
✅ Applied X override(s) from manifest
```

---

## See Also

- [manifest-example.yaml](../manifest-example.yaml) - Complete example with all parameters
- [bin/config-schema.ts](../bin/config-schema.ts) - Zod schema definitions
- [bin/config-loader.ts](../bin/config-loader.ts) - Configuration loading logic

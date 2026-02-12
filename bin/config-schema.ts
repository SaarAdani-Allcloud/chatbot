import { z } from "zod";

/**
 * Supported AWS regions
 */
const SupportedRegionSchema = z.enum([
  "af-south-1",
  "ap-east-1",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "ap-south-1",
  "ap-south-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-southeast-3",
  "ap-southeast-4",
  "ca-central-1",
  "eu-central-1",
  "eu-central-2",
  "eu-north-1",
  "eu-south-1",
  "eu-south-2",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "il-central-1",
  "me-central-1",
  "me-south-1",
  "sa-east-1",
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
]);

// ============================================
// VPC Configuration Schema
// ============================================
const VpcConfigSchema = z
  .object({
    vpcId: z
      .string()
      .regex(
        /^vpc-[a-f0-9]{8,17}$/,
        "Invalid VPC ID format. Expected: vpc-xxxxxxxx or vpc-xxxxxxxxxxxxxxxxx"
      )
      .optional(),
    subnetIds: z
      .array(
        z
          .string()
          .regex(
            /^subnet-[a-f0-9]{8,17}$/,
            "Invalid subnet ID format. Expected: subnet-xxxxxxxx"
          )
      )
      .min(1, "At least one subnet ID is required when specifying subnetIds")
      .optional(),
    executeApiVpcEndpointId: z
      .string()
      .regex(
        /^vpce-[a-f0-9]+$/,
        "Invalid VPC endpoint ID format. Expected: vpce-xxxxxxxx"
      )
      .optional(),
    s3VpcEndpointId: z
      .string()
      .regex(
        /^vpce-[a-f0-9]+$/,
        "Invalid S3 VPC endpoint ID format. Expected: vpce-xxxxxxxx"
      )
      .optional(),
    s3VpcEndpointIps: z
      .array(
        z
          .string()
          .regex(
            /^(\d{1,3}\.){3}\d{1,3}$/,
            "Invalid IP address format. Expected: x.x.x.x"
          )
      )
      .optional(),
  })
  .refine(
    (data) => {
      // If s3VpcEndpointIps is provided, s3VpcEndpointId must also be provided
      if (data.s3VpcEndpointIps && data.s3VpcEndpointIps.length > 0) {
        return !!data.s3VpcEndpointId;
      }
      return true;
    },
    {
      message:
        "s3VpcEndpointId is required when s3VpcEndpointIps is provided",
      path: ["s3VpcEndpointId"],
    }
  );

// ============================================
// Cognito Federation Schema
// ============================================
const CognitoFederationSAMLSchema = z.object({
  metadataDocumentUrl: z
    .string()
    .url("Invalid SAML metadata URL")
    .refine(
      (url) => url.startsWith("https://"),
      "SAML metadata URL must use HTTPS"
    ),
});

const CognitoFederationOIDCSchema = z.object({
  OIDCClient: z
    .string()
    .min(1, "OIDC Client ID is required")
    .max(255, "OIDC Client ID must be at most 255 characters")
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      "OIDC Client ID must contain only alphanumeric characters, hyphens, and underscores"
    ),
  OIDCSecret: z
    .string()
    .regex(
      /^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:.+$/,
      "Invalid Secrets Manager ARN format. Expected: arn:aws:secretsmanager:region:account-id:secret:name"
    ),
  OIDCIssuerURL: z
    .string()
    .url("Invalid OIDC Issuer URL")
    .refine(
      (url) => url.startsWith("https://"),
      "OIDC Issuer URL must use HTTPS"
    ),
});

const CognitoFederationSchema = z
  .object({
    enabled: z.boolean().optional(),
    autoRedirect: z.boolean().optional(),
    customProviderName: z
      .string()
      .min(1, "Provider name is required when federation is enabled")
      .max(32, "Provider name must be at most 32 characters")
      .regex(
        /^[a-zA-Z0-9_-]+$/,
        "Provider name must contain only alphanumeric characters, hyphens, and underscores"
      )
      .optional(),
    customProviderType: z.enum(["SAML", "OIDC", "later"]).optional(),
    cognitoDomain: z
      .string()
      .regex(
        /^[a-z0-9-]+$/,
        "Cognito domain must contain only lowercase letters, numbers, and hyphens"
      )
      .optional(),
    customSAML: CognitoFederationSAMLSchema.optional(),
    customOIDC: CognitoFederationOIDCSchema.optional(),
  })
  .refine(
    (data) => {
      // If enabled and type is SAML, customSAML must be provided
      if (data.enabled && data.customProviderType === "SAML") {
        return !!data.customSAML?.metadataDocumentUrl;
      }
      return true;
    },
    {
      message: "SAML metadata URL is required when provider type is SAML",
      path: ["customSAML", "metadataDocumentUrl"],
    }
  )
  .refine(
    (data) => {
      // If enabled and type is OIDC, customOIDC must be provided
      if (data.enabled && data.customProviderType === "OIDC") {
        return (
          !!data.customOIDC?.OIDCClient &&
          !!data.customOIDC?.OIDCSecret &&
          !!data.customOIDC?.OIDCIssuerURL
        );
      }
      return true;
    },
    {
      message:
        "OIDC configuration (OIDCClient, OIDCSecret, OIDCIssuerURL) is required when provider type is OIDC",
      path: ["customOIDC"],
    }
  )
  .refine(
    (data) => {
      // If enabled, customProviderName must be provided
      if (data.enabled && data.customProviderType !== "later") {
        return !!data.customProviderName;
      }
      return true;
    },
    {
      message: "Provider name is required when federation is enabled",
      path: ["customProviderName"],
    }
  );

// ============================================
// Bedrock Guardrails Schema
// ============================================
const BedrockGuardrailsSchema = z
  .object({
    enabled: z.boolean(),
    identifier: z
      .string()
      .regex(
        /^[a-z0-9]+$/,
        "Guardrail identifier must contain only lowercase alphanumeric characters"
      )
      .optional(),
    version: z.string().optional(),
  })
  .refine(
    (data) => {
      // If enabled, identifier and version are required
      if (data.enabled) {
        return !!data.identifier && !!data.version;
      }
      return true;
    },
    {
      message:
        "Guardrail identifier and version are required when guardrails are enabled",
      path: ["identifier"],
    }
  );

// ============================================
// RAG Configuration Schema (OpenSearch & Knowledge Base only)
// ============================================
const ExternalKnowledgeBaseSchema = z.object({
  name: z
    .string()
    .min(1, "Knowledge Base name is required")
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      "Name must contain only alphanumeric characters, hyphens, and underscores"
    ),
  knowledgeBaseId: z
    .string()
    .length(10, "Knowledge Base ID must be exactly 10 characters")
    .regex(/^[A-Z0-9]+$/, "Knowledge Base ID must be uppercase alphanumeric"),
  region: SupportedRegionSchema.optional(),
  roleArn: z
    .string()
    .regex(
      /^arn:aws:iam::\d{12}:role\/.+$/,
      "Invalid IAM role ARN format"
    )
    .optional(),
  enabled: z.boolean().optional().default(true),
});

const ModelConfigSchema = z.object({
  provider: z.enum(["sagemaker", "bedrock", "openai", "nexus"]),
  name: z.string().min(1, "Model name is required"),
  dimensions: z.number().positive("Dimensions must be a positive number").optional(),
  default: z.boolean().optional(),
});

const RagConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    crossEncodingEnabled: z.boolean().optional(),
    engines: z
      .object({
        opensearch: z
          .object({
            enabled: z.boolean(),
          })
          .optional(),
        knowledgeBase: z
          .object({
            enabled: z.boolean(),
            external: z.array(ExternalKnowledgeBaseSchema).optional(),
          })
          .optional(),
      })
      .optional(),
    embeddingsModels: z.array(ModelConfigSchema).optional(),
    crossEncoderModels: z.array(ModelConfigSchema).optional(),
  })
  .refine(
    (data) => {
      // If RAG is enabled, at least one engine should be enabled
      if (data.enabled) {
        const hasOpenSearch = data.engines?.opensearch?.enabled;
        const hasKnowledgeBase = data.engines?.knowledgeBase?.enabled;
        return hasOpenSearch || hasKnowledgeBase;
      }
      return true;
    },
    {
      message:
        "At least one RAG engine (OpenSearch or Knowledge Base) must be enabled when RAG is enabled",
      path: ["engines"],
    }
  );

// ============================================
// CI/CD Pipeline Configuration Schema
// ============================================
const PipelineCodeCommitSchema = z
  .object({
    /** Name of an existing CodeCommit repository to use */
    existingRepositoryName: z
      .string()
      .min(1)
      .max(100)
      .regex(
        /^[a-zA-Z0-9._-]+$/,
        "Invalid CodeCommit repository name. Only alphanumeric, dots, hyphens, and underscores."
      )
      .optional(),
    /** Create a new CodeCommit repository */
    createNew: z.boolean().optional(),
    /** Name for the new CodeCommit repository (required when createNew is true) */
    newRepositoryName: z
      .string()
      .min(1)
      .max(100)
      .regex(
        /^[a-zA-Z0-9._-]+$/,
        "Invalid CodeCommit repository name. Only alphanumeric, dots, hyphens, and underscores."
      )
      .optional(),
    /** Seed the new repository with the project code on first creation */
    seedOnCreate: z.boolean().optional().default(false),
  })
  .refine(
    (data) => {
      // Must provide either existingRepositoryName OR createNew (not both)
      const hasExisting = !!data.existingRepositoryName;
      const hasNew = !!data.createNew;
      return hasExisting !== hasNew;
    },
    {
      message:
        "Provide either existingRepositoryName OR createNew: true, not both",
    }
  )
  .refine(
    (data) => {
      // If createNew is true, newRepositoryName is required
      if (data.createNew) return !!data.newRepositoryName;
      return true;
    },
    {
      message: "newRepositoryName is required when createNew is true",
      path: ["newRepositoryName"],
    }
  );

const PipelineConfigSchema = z.object({
  /** Enable pipeline-based deployment */
  enabled: z.boolean(),
  /** CodeCommit repository configuration */
  codecommit: PipelineCodeCommitSchema,
  /** Branch to monitor for changes (default: main) */
  branch: z.string().min(1).default("main"),
  /** Require manual approval before deployment (default: true) */
  requireApproval: z.boolean().optional().default(true),
  /** Notification email - SNS topic is only created if provided */
  notificationEmail: z.string().email("Invalid email address").optional(),
});

// ============================================
// Main Deployment Manifest Schema
// ============================================
/**
 * Deployment manifest schema
 * Contains only the agreed-upon parameters that clients can override via YAML
 *
 * Agreed parameters:
 * - Core: prefix, enableWaf, createCMKs, advancedMonitoring
 * - Website: privateWebsite, certificate, domain
 * - VPC: vpcId, subnetIds, executeApiVpcEndpointId, s3VpcEndpointId, s3VpcEndpointIps
 * - Auth: cognitoFederation (all sub-parameters)
 * - RAG: OpenSearch and Knowledge Base engines only
 * - Guardrails: bedrock.guardrails
 */
export const DeploymentManifestSchema = z.object({
  // ============================================
  // Core Deployment Settings
  // ============================================
  prefix: z
    .string()
    .min(1, "Prefix is required")
    .max(16, "Prefix must be at most 16 characters")
    .regex(
      /^[a-zA-Z][a-zA-Z0-9-]*$/,
      "Prefix must start with a letter and contain only letters, numbers, and hyphens"
    ),

  enableWaf: z.boolean().optional(),

  createCMKs: z.boolean().optional(),

  advancedMonitoring: z.boolean().optional(),

  // ============================================
  // Logging Configuration
  // ============================================

  /** Disable S3 server access log buckets (use when CloudTrail data events are enabled) */
  disableS3AccessLogs: z.boolean().optional(),

  /** Centralized log archive bucket name (cross-account, for ALB access logs) */
  logArchiveBucketName: z
    .string()
    .min(3, "S3 bucket name must be at least 3 characters")
    .max(63, "S3 bucket name must be at most 63 characters")
    .regex(
      /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/,
      "Invalid S3 bucket name format. Must start and end with lowercase letter or number."
    )
    .optional()
    .or(z.literal("")),

  // ============================================
  // Website/UI Configuration
  // ============================================
  privateWebsite: z.boolean().optional(),

  certificate: z
    .string()
    .regex(
      /^arn:aws:acm:[a-z0-9-]+:\d{12}:certificate\/[a-f0-9-]+$/,
      "Invalid ACM certificate ARN format"
    )
    .optional()
    .or(z.literal("")),

  domain: z
    .string()
    .regex(
      /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
      "Invalid domain format. Example: chat.example.com"
    )
    .optional()
    .or(z.literal("")),

  // ============================================
  // VPC/Network Configuration
  // ============================================
  vpc: VpcConfigSchema.optional(),

  // ============================================
  // Authentication (Cognito Federation)
  // ============================================
  cognitoFederation: CognitoFederationSchema.optional(),

  // ============================================
  // Bedrock Guardrails
  // ============================================
  bedrock: z
    .object({
      guardrails: BedrockGuardrailsSchema.optional(),
    })
    .optional(),

  // ============================================
  // RAG Configuration (OpenSearch & Knowledge Base only)
  // ============================================
  rag: RagConfigSchema.optional(),

  // ============================================
  // CI/CD Pipeline Configuration
  // ============================================
  pipeline: PipelineConfigSchema.optional(),
});

export type DeploymentManifest = z.infer<typeof DeploymentManifestSchema>;

/**
 * Format Zod validation errors into readable messages
 */
export function formatValidationErrors(error: z.ZodError): string {
  return error.errors
    .map((err) => {
      const path = err.path.join(".");
      return `  - ${path || "root"}: ${err.message}`;
    })
    .join("\n");
}

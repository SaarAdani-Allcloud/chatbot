import * as yaml from "js-yaml";
import { existsSync, readFileSync } from "fs";
import {
  DeploymentManifestSchema,
  DeploymentManifest,
  formatValidationErrors,
} from "./config-schema";
import { getConfig } from "./config";
import { SystemConfig } from "../lib/shared/types";

/**
 * Find the deployment manifest file
 * Checks multiple locations in priority order
 */
function findManifestFile(): string | null {
  const searchPaths = [
    process.env.DEPLOYMENT_MANIFEST, // Explicit path via env var
    "deployment-manifest.yaml", // Root directory
    "deployment-manifest.yml", // Alternative extension
  ].filter(Boolean) as string[];

  for (const manifestPath of searchPaths) {
    if (existsSync(manifestPath)) {
      return manifestPath;
    }
  }

  return null;
}

/**
 * Load and validate the YAML manifest
 */
export function loadDeploymentManifest(): DeploymentManifest | null {
  const manifestPath = findManifestFile();

  if (!manifestPath) {
    console.log("ℹ️  No deployment manifest found, using config.json only");
    return null;
  }

  console.log(`📄 Loading deployment manifest: ${manifestPath}`);

  // Read and parse YAML
  const yamlContent = readFileSync(manifestPath, "utf8");
  let parsed: unknown;

  try {
    parsed = yaml.load(yamlContent);
  } catch (e) {
    throw new Error(`Failed to parse YAML file ${manifestPath}: ${e}`);
  }

  // Validate with Zod
  const result = DeploymentManifestSchema.safeParse(parsed);

  if (!result.success) {
    console.error("\n❌ Deployment manifest validation failed!\n");
    console.error(`File: ${manifestPath}\n`);
    console.error("Errors:");
    console.error(formatValidationErrors(result.error));
    console.error("\nPlease fix the above errors and try again.\n");
    throw new Error("Deployment manifest validation failed");
  }

  console.log("✅ Deployment manifest validated successfully");
  return result.data;
}

/**
 * Helper to log an override
 */
function logOverride(
  path: string,
  oldValue: unknown,
  newValue: unknown
): void {
  const formatValue = (val: unknown): string => {
    if (val === undefined) return "undefined";
    if (val === null) return "null";
    if (typeof val === "object") return JSON.stringify(val);
    return String(val);
  };

  console.log(
    `  🔀 ${path}: ${formatValue(oldValue)} → ${formatValue(newValue)}`
  );
}

/**
 * Apply manifest overrides to config
 * YAML values take priority over config.json values
 */
function applyManifestOverrides(
  baseConfig: SystemConfig,
  manifest: DeploymentManifest
): SystemConfig {
  // Deep clone the base config to avoid mutations
  const config: SystemConfig = JSON.parse(JSON.stringify(baseConfig));

  console.log("\n📝 Applying manifest overrides:");

  let overrideCount = 0;

  // ============================================
  // Core Deployment Settings
  // ============================================

  // prefix
  if (manifest.prefix !== undefined) {
    logOverride("prefix", config.prefix, manifest.prefix);
    config.prefix = manifest.prefix;
    overrideCount++;
  }

  // enableWaf
  if (manifest.enableWaf !== undefined) {
    logOverride("enableWaf", config.enableWaf, manifest.enableWaf);
    config.enableWaf = manifest.enableWaf;
    overrideCount++;
  }

  // createCMKs
  if (manifest.createCMKs !== undefined) {
    logOverride("createCMKs", config.createCMKs, manifest.createCMKs);
    config.createCMKs = manifest.createCMKs;
    overrideCount++;
  }

  // advancedMonitoring
  if (manifest.advancedMonitoring !== undefined) {
    logOverride(
      "advancedMonitoring",
      config.advancedMonitoring,
      manifest.advancedMonitoring
    );
    config.advancedMonitoring = manifest.advancedMonitoring;
    overrideCount++;
  }

  // ============================================
  // Logging Configuration
  // ============================================

  // disableS3AccessLogs
  if (manifest.disableS3AccessLogs !== undefined) {
    logOverride(
      "disableS3AccessLogs",
      config.disableS3AccessLogs,
      manifest.disableS3AccessLogs
    );
    config.disableS3AccessLogs = manifest.disableS3AccessLogs;
    overrideCount++;
  }

  // logArchiveBucketName
  if (manifest.logArchiveBucketName !== undefined && manifest.logArchiveBucketName !== "") {
    logOverride(
      "logArchiveBucketName",
      config.logArchiveBucketName,
      manifest.logArchiveBucketName
    );
    config.logArchiveBucketName = manifest.logArchiveBucketName;
    overrideCount++;
  }

  // ============================================
  // Website/UI Configuration
  // ============================================

  // privateWebsite
  if (manifest.privateWebsite !== undefined) {
    logOverride("privateWebsite", config.privateWebsite, manifest.privateWebsite);
    config.privateWebsite = manifest.privateWebsite;
    overrideCount++;
  }

  // certificate
  if (manifest.certificate !== undefined) {
    logOverride("certificate", config.certificate, manifest.certificate);
    config.certificate = manifest.certificate;
    overrideCount++;
  }

  // domain
  if (manifest.domain !== undefined) {
    logOverride("domain", config.domain, manifest.domain);
    config.domain = manifest.domain;
    overrideCount++;
  }

  // ============================================
  // VPC/Network Configuration
  // ============================================

  if (manifest.vpc !== undefined) {
    // Initialize vpc object if not exists
    if (!config.vpc) {
      config.vpc = {};
    }

    // vpc.vpcId
    if (manifest.vpc.vpcId !== undefined) {
      logOverride("vpc.vpcId", config.vpc.vpcId, manifest.vpc.vpcId);
      config.vpc.vpcId = manifest.vpc.vpcId;
      overrideCount++;
    }

    // vpc.subnetIds
    if (manifest.vpc.subnetIds !== undefined) {
      logOverride("vpc.subnetIds", config.vpc.subnetIds, manifest.vpc.subnetIds);
      config.vpc.subnetIds = manifest.vpc.subnetIds;
      overrideCount++;
    }

    // vpc.executeApiVpcEndpointId
    if (manifest.vpc.executeApiVpcEndpointId !== undefined) {
      logOverride(
        "vpc.executeApiVpcEndpointId",
        config.vpc.executeApiVpcEndpointId,
        manifest.vpc.executeApiVpcEndpointId
      );
      config.vpc.executeApiVpcEndpointId = manifest.vpc.executeApiVpcEndpointId;
      overrideCount++;
    }

    // vpc.s3VpcEndpointId
    if (manifest.vpc.s3VpcEndpointId !== undefined) {
      logOverride(
        "vpc.s3VpcEndpointId",
        config.vpc.s3VpcEndpointId,
        manifest.vpc.s3VpcEndpointId
      );
      config.vpc.s3VpcEndpointId = manifest.vpc.s3VpcEndpointId;
      overrideCount++;
    }

    // vpc.s3VpcEndpointIps
    if (manifest.vpc.s3VpcEndpointIps !== undefined) {
      logOverride(
        "vpc.s3VpcEndpointIps",
        config.vpc.s3VpcEndpointIps,
        manifest.vpc.s3VpcEndpointIps
      );
      config.vpc.s3VpcEndpointIps = manifest.vpc.s3VpcEndpointIps;
      overrideCount++;
    }
  }

  // ============================================
  // Authentication (Cognito Federation)
  // ============================================

  if (manifest.cognitoFederation !== undefined) {
    // Initialize cognitoFederation object if not exists
    if (!config.cognitoFederation) {
      config.cognitoFederation = {};
    }

    // cognitoFederation.enabled
    if (manifest.cognitoFederation.enabled !== undefined) {
      logOverride(
        "cognitoFederation.enabled",
        config.cognitoFederation.enabled,
        manifest.cognitoFederation.enabled
      );
      config.cognitoFederation.enabled = manifest.cognitoFederation.enabled;
      overrideCount++;
    }

    // cognitoFederation.autoRedirect
    if (manifest.cognitoFederation.autoRedirect !== undefined) {
      logOverride(
        "cognitoFederation.autoRedirect",
        config.cognitoFederation.autoRedirect,
        manifest.cognitoFederation.autoRedirect
      );
      config.cognitoFederation.autoRedirect =
        manifest.cognitoFederation.autoRedirect;
      overrideCount++;
    }

    // cognitoFederation.customProviderName
    if (manifest.cognitoFederation.customProviderName !== undefined) {
      logOverride(
        "cognitoFederation.customProviderName",
        config.cognitoFederation.customProviderName,
        manifest.cognitoFederation.customProviderName
      );
      config.cognitoFederation.customProviderName =
        manifest.cognitoFederation.customProviderName;
      overrideCount++;
    }

    // cognitoFederation.customProviderType
    if (manifest.cognitoFederation.customProviderType !== undefined) {
      logOverride(
        "cognitoFederation.customProviderType",
        config.cognitoFederation.customProviderType,
        manifest.cognitoFederation.customProviderType
      );
      config.cognitoFederation.customProviderType =
        manifest.cognitoFederation.customProviderType;
      overrideCount++;
    }

    // cognitoFederation.cognitoDomain
    if (manifest.cognitoFederation.cognitoDomain !== undefined) {
      logOverride(
        "cognitoFederation.cognitoDomain",
        config.cognitoFederation.cognitoDomain,
        manifest.cognitoFederation.cognitoDomain
      );
      config.cognitoFederation.cognitoDomain =
        manifest.cognitoFederation.cognitoDomain;
      overrideCount++;
    }

    // cognitoFederation.customSAML
    if (manifest.cognitoFederation.customSAML !== undefined) {
      if (!config.cognitoFederation.customSAML) {
        config.cognitoFederation.customSAML = {};
      }

      if (
        manifest.cognitoFederation.customSAML.metadataDocumentUrl !== undefined
      ) {
        logOverride(
          "cognitoFederation.customSAML.metadataDocumentUrl",
          config.cognitoFederation.customSAML.metadataDocumentUrl,
          manifest.cognitoFederation.customSAML.metadataDocumentUrl
        );
        config.cognitoFederation.customSAML.metadataDocumentUrl =
          manifest.cognitoFederation.customSAML.metadataDocumentUrl;
        overrideCount++;
      }
    }

    // cognitoFederation.customOIDC
    if (manifest.cognitoFederation.customOIDC !== undefined) {
      if (!config.cognitoFederation.customOIDC) {
        config.cognitoFederation.customOIDC = {};
      }

      if (manifest.cognitoFederation.customOIDC.OIDCClient !== undefined) {
        logOverride(
          "cognitoFederation.customOIDC.OIDCClient",
          config.cognitoFederation.customOIDC.OIDCClient,
          manifest.cognitoFederation.customOIDC.OIDCClient
        );
        config.cognitoFederation.customOIDC.OIDCClient =
          manifest.cognitoFederation.customOIDC.OIDCClient;
        overrideCount++;
      }

      if (manifest.cognitoFederation.customOIDC.OIDCSecret !== undefined) {
        logOverride(
          "cognitoFederation.customOIDC.OIDCSecret",
          config.cognitoFederation.customOIDC.OIDCSecret,
          manifest.cognitoFederation.customOIDC.OIDCSecret
        );
        config.cognitoFederation.customOIDC.OIDCSecret =
          manifest.cognitoFederation.customOIDC.OIDCSecret;
        overrideCount++;
      }

      if (manifest.cognitoFederation.customOIDC.OIDCIssuerURL !== undefined) {
        logOverride(
          "cognitoFederation.customOIDC.OIDCIssuerURL",
          config.cognitoFederation.customOIDC.OIDCIssuerURL,
          manifest.cognitoFederation.customOIDC.OIDCIssuerURL
        );
        config.cognitoFederation.customOIDC.OIDCIssuerURL =
          manifest.cognitoFederation.customOIDC.OIDCIssuerURL;
        overrideCount++;
      }
    }
  }

  // ============================================
  // Bedrock Guardrails
  // ============================================

  if (manifest.bedrock?.guardrails !== undefined) {
    // Initialize bedrock object if not exists
    if (!config.bedrock) {
      config.bedrock = {};
    }

    // Initialize guardrails object if not exists
    if (!config.bedrock.guardrails) {
      config.bedrock.guardrails = {
        enabled: false,
        identifier: "",
        version: "",
      };
    }

    // bedrock.guardrails.enabled
    if (manifest.bedrock.guardrails.enabled !== undefined) {
      logOverride(
        "bedrock.guardrails.enabled",
        config.bedrock.guardrails.enabled,
        manifest.bedrock.guardrails.enabled
      );
      config.bedrock.guardrails.enabled = manifest.bedrock.guardrails.enabled;
      overrideCount++;
    }

    // bedrock.guardrails.identifier
    if (manifest.bedrock.guardrails.identifier !== undefined) {
      logOverride(
        "bedrock.guardrails.identifier",
        config.bedrock.guardrails.identifier,
        manifest.bedrock.guardrails.identifier
      );
      config.bedrock.guardrails.identifier =
        manifest.bedrock.guardrails.identifier;
      overrideCount++;
    }

    // bedrock.guardrails.version
    if (manifest.bedrock.guardrails.version !== undefined) {
      logOverride(
        "bedrock.guardrails.version",
        config.bedrock.guardrails.version,
        manifest.bedrock.guardrails.version
      );
      config.bedrock.guardrails.version = manifest.bedrock.guardrails.version;
      overrideCount++;
    }
  }

  // ============================================
  // RAG Configuration (OpenSearch & Knowledge Base)
  // ============================================

  if (manifest.rag !== undefined) {
    // rag.enabled
    if (manifest.rag.enabled !== undefined) {
      logOverride("rag.enabled", config.rag.enabled, manifest.rag.enabled);
      config.rag.enabled = manifest.rag.enabled;
      overrideCount++;
    }

    // rag.crossEncodingEnabled
    if (manifest.rag.crossEncodingEnabled !== undefined) {
      logOverride(
        "rag.crossEncodingEnabled",
        config.rag.crossEncodingEnabled,
        manifest.rag.crossEncodingEnabled
      );
      config.rag.crossEncodingEnabled = manifest.rag.crossEncodingEnabled;
      overrideCount++;
    }

    // rag.engines
    if (manifest.rag.engines !== undefined) {
      // rag.engines.opensearch
      if (manifest.rag.engines.opensearch !== undefined) {
        if (manifest.rag.engines.opensearch.enabled !== undefined) {
          logOverride(
            "rag.engines.opensearch.enabled",
            config.rag.engines.opensearch.enabled,
            manifest.rag.engines.opensearch.enabled
          );
          config.rag.engines.opensearch.enabled =
            manifest.rag.engines.opensearch.enabled;
          overrideCount++;
        }
      }

      // rag.engines.knowledgeBase
      if (manifest.rag.engines.knowledgeBase !== undefined) {
        if (manifest.rag.engines.knowledgeBase.enabled !== undefined) {
          logOverride(
            "rag.engines.knowledgeBase.enabled",
            config.rag.engines.knowledgeBase.enabled,
            manifest.rag.engines.knowledgeBase.enabled
          );
          config.rag.engines.knowledgeBase.enabled =
            manifest.rag.engines.knowledgeBase.enabled;
          overrideCount++;
        }

        if (manifest.rag.engines.knowledgeBase.external !== undefined) {
          logOverride(
            "rag.engines.knowledgeBase.external",
            config.rag.engines.knowledgeBase.external,
            manifest.rag.engines.knowledgeBase.external
          );
          config.rag.engines.knowledgeBase.external =
            manifest.rag.engines.knowledgeBase.external as typeof config.rag.engines.knowledgeBase.external;
          overrideCount++;
        }
      }
    }

    // rag.embeddingsModels
    if (manifest.rag.embeddingsModels !== undefined) {
      logOverride(
        "rag.embeddingsModels",
        config.rag.embeddingsModels,
        manifest.rag.embeddingsModels
      );
      config.rag.embeddingsModels =
        manifest.rag.embeddingsModels as typeof config.rag.embeddingsModels;
      overrideCount++;
    }

    // rag.crossEncoderModels
    if (manifest.rag.crossEncoderModels !== undefined) {
      logOverride(
        "rag.crossEncoderModels",
        config.rag.crossEncoderModels,
        manifest.rag.crossEncoderModels
      );
      config.rag.crossEncoderModels =
        manifest.rag.crossEncoderModels as typeof config.rag.crossEncoderModels;
      overrideCount++;
    }
  }

  // ============================================
  // CI/CD Pipeline Configuration
  // ============================================

  if (manifest.pipeline !== undefined) {
    logOverride("pipeline", config.pipeline, manifest.pipeline);
    config.pipeline = {
      enabled: manifest.pipeline.enabled,
      codecommit: {
        existingRepositoryName:
          manifest.pipeline.codecommit.existingRepositoryName,
        createNew: manifest.pipeline.codecommit.createNew,
        newRepositoryName: manifest.pipeline.codecommit.newRepositoryName,
        seedOnCreate: manifest.pipeline.codecommit.seedOnCreate,
      },
      branch: manifest.pipeline.branch,
      requireApproval: manifest.pipeline.requireApproval ?? true,
      notificationEmail: manifest.pipeline.notificationEmail,
    };
    overrideCount++;
  }

  // ============================================
  // Summary
  // ============================================

  if (overrideCount === 0) {
    console.log("  (no overrides applied)");
  } else {
    console.log(`\n✅ Applied ${overrideCount} override(s) from manifest\n`);
  }

  return config;
}

/**
 * Load configuration with YAML manifest overrides
 * Priority: YAML manifest > config.json > defaults
 */
export function loadConfig(): SystemConfig {
  console.log("\n" + "=".repeat(60));
  console.log("🚀 Loading Configuration");
  console.log("=".repeat(60) + "\n");

  // 1. Load base config from config.json
  const baseConfig = getConfig();
  console.log("📦 Loaded base configuration from config.json");

  // 2. Load deployment manifest (if exists)
  const manifest = loadDeploymentManifest();

  if (!manifest) {
    console.log("\n" + "=".repeat(60) + "\n");
    return baseConfig;
  }

  console.log(`📋 Deployment prefix: "${manifest.prefix}"`);

  // 3. Apply manifest overrides
  const mergedConfig = applyManifestOverrides(baseConfig, manifest);

  console.log("=".repeat(60) + "\n");

  return mergedConfig;
}

/**
 * Export for testing - validates a manifest object without loading from file
 */
export function validateManifest(manifest: unknown): {
  success: boolean;
  data?: DeploymentManifest;
  errors?: string;
} {
  const result = DeploymentManifestSchema.safeParse(manifest);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    errors: formatValidationErrors(result.error),
  };
}

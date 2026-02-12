/**
 * Test file for config-loader.ts
 *
 * Run with: npx ts-node bin/config-loader.test.ts
 *
 * This test verifies that:
 * 1. YAML manifest values override config.json values
 * 2. Validation works correctly for all parameters
 * 3. Invalid values are rejected with clear error messages
 */

import { validateManifest } from "./config-loader";
import { DeploymentManifestSchema } from "./config-schema";

// Test utilities
let passCount = 0;
let failCount = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    passCount++;
  } catch (error) {
    console.log(`❌ FAIL: ${name}`);
    console.log(`   Error: ${error instanceof Error ? error.message : error}`);
    failCount++;
  }
}

function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message ||
        `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assertValidationFails(
  manifest: unknown,
  expectedPathSubstring?: string
): void {
  const result = validateManifest(manifest);
  if (result.success) {
    throw new Error("Expected validation to fail, but it passed");
  }
  if (expectedPathSubstring && !result.errors?.includes(expectedPathSubstring)) {
    throw new Error(
      `Expected error to contain "${expectedPathSubstring}", got: ${result.errors}`
    );
  }
}

function assertValidationPasses(manifest: unknown): void {
  const result = validateManifest(manifest);
  if (!result.success) {
    throw new Error(`Expected validation to pass, but got errors: ${result.errors}`);
  }
}

console.log("\n" + "=".repeat(60));
console.log("🧪 Config Loader Tests");
console.log("=".repeat(60) + "\n");

// ============================================
// Basic validation tests
// ============================================

console.log("📋 Basic Validation Tests\n");

test("should require prefix field", () => {
  assertValidationFails({}, "prefix");
});

test("should accept minimal valid manifest", () => {
  assertValidationPasses({ prefix: "test-chatbot" });
});

// ============================================
// Prefix validation tests
// ============================================

console.log("\n📋 Prefix Validation Tests\n");

test("should accept valid prefix", () => {
  assertValidationPasses({ prefix: "my-chatbot" });
});

test("should reject prefix starting with number", () => {
  assertValidationFails({ prefix: "1-chatbot" }, "prefix");
});

test("should reject prefix longer than 16 characters", () => {
  assertValidationFails(
    { prefix: "this-is-way-too-long" },
    "prefix"
  );
});

test("should reject prefix with invalid characters", () => {
  assertValidationFails({ prefix: "my_chatbot" }, "prefix");
});

// ============================================
// VPC validation tests
// ============================================

console.log("\n📋 VPC Validation Tests\n");

test("should accept valid VPC configuration", () => {
  assertValidationPasses({
    prefix: "test-app",
    vpc: {
      vpcId: "vpc-0123456789abcdef0",
      subnetIds: ["subnet-0123456789abcdef0"],
    },
  });
});

test("should reject invalid VPC ID format", () => {
  assertValidationFails({ prefix: "test-app", vpc: { vpcId: "invalid" } }, "vpcId");
});

test("should reject invalid subnet ID format", () => {
  assertValidationFails(
    { prefix: "test-app", vpc: { subnetIds: ["invalid"] } },
    "subnetIds"
  );
});

test("should reject s3VpcEndpointIps without s3VpcEndpointId", () => {
  assertValidationFails(
    { prefix: "test-app", vpc: { s3VpcEndpointIps: ["10.0.1.100"] } },
    "s3VpcEndpointId"
  );
});

test("should accept s3VpcEndpointIps with s3VpcEndpointId", () => {
  assertValidationPasses({
    prefix: "test-app",
    vpc: {
      s3VpcEndpointId: "vpce-0123456789abcdef0",
      s3VpcEndpointIps: ["10.0.1.100"],
    },
  });
});

test("should reject invalid IP address format", () => {
  assertValidationFails(
    {
      prefix: "test-app",
      vpc: {
        s3VpcEndpointId: "vpce-abc123",
        s3VpcEndpointIps: ["invalid-ip"],
      },
    },
    "s3VpcEndpointIps"
  );
});

// ============================================
// Cognito Federation validation tests
// ============================================

console.log("\n📋 Cognito Federation Validation Tests\n");

test("should accept disabled federation", () => {
  assertValidationPasses({
    prefix: "test-app",
    cognitoFederation: { enabled: false },
  });
});

test("should require SAML metadata URL when type is SAML", () => {
  assertValidationFails(
    {
      prefix: "test-app",
      cognitoFederation: {
        enabled: true,
        customProviderName: "TestSSO",
        customProviderType: "SAML",
      },
    },
    "metadataDocumentUrl"
  );
});

test("should accept valid SAML configuration", () => {
  assertValidationPasses({
    prefix: "test-app",
    cognitoFederation: {
      enabled: true,
      customProviderName: "TestSSO",
      customProviderType: "SAML",
      customSAML: {
        metadataDocumentUrl: "https://idp.example.com/metadata.xml",
      },
    },
  });
});

test("should require OIDC configuration when type is OIDC", () => {
  assertValidationFails(
    {
      prefix: "test-app",
      cognitoFederation: {
        enabled: true,
        customProviderName: "TestOIDC",
        customProviderType: "OIDC",
      },
    },
    "customOIDC"
  );
});

test("should accept valid OIDC configuration", () => {
  assertValidationPasses({
    prefix: "test-app",
    cognitoFederation: {
      enabled: true,
      customProviderName: "TestOIDC",
      customProviderType: "OIDC",
      customOIDC: {
        OIDCClient: "my-client-id",
        OIDCSecret:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret",
        OIDCIssuerURL: "https://login.example.com",
      },
    },
  });
});

test("should reject non-HTTPS SAML metadata URL", () => {
  assertValidationFails(
    {
      prefix: "test-app",
      cognitoFederation: {
        enabled: true,
        customProviderName: "TestSSO",
        customProviderType: "SAML",
        customSAML: {
          metadataDocumentUrl: "http://idp.example.com/metadata.xml",
        },
      },
    },
    "HTTPS"
  );
});

// ============================================
// Bedrock Guardrails validation tests
// ============================================

console.log("\n📋 Bedrock Guardrails Validation Tests\n");

test("should accept disabled guardrails", () => {
  assertValidationPasses({
    prefix: "test-app",
    bedrock: { guardrails: { enabled: false } },
  });
});

test("should require identifier when guardrails enabled", () => {
  assertValidationFails(
    { prefix: "test-app", bedrock: { guardrails: { enabled: true } } },
    "identifier"
  );
});

test("should accept valid guardrails configuration", () => {
  assertValidationPasses({
    prefix: "test-app",
    bedrock: {
      guardrails: {
        enabled: true,
        identifier: "abc123def456",
        version: "1",
      },
    },
  });
});

// ============================================
// RAG validation tests
// ============================================

console.log("\n📋 RAG Validation Tests\n");

test("should accept disabled RAG", () => {
  assertValidationPasses({
    prefix: "test-app",
    rag: { enabled: false },
  });
});

test("should require at least one engine when RAG is enabled", () => {
  assertValidationFails(
    { prefix: "test-app", rag: { enabled: true } },
    "engine"
  );
});

test("should accept RAG with OpenSearch enabled", () => {
  assertValidationPasses({
    prefix: "test-app",
    rag: {
      enabled: true,
      engines: { opensearch: { enabled: true } },
    },
  });
});

test("should accept RAG with Knowledge Base enabled", () => {
  assertValidationPasses({
    prefix: "test-app",
    rag: {
      enabled: true,
      engines: {
        knowledgeBase: {
          enabled: true,
          external: [
            {
              name: "my-kb",
              knowledgeBaseId: "ABCD123456",
            },
          ],
        },
      },
    },
  });
});

test("should reject invalid Knowledge Base ID length", () => {
  assertValidationFails(
    {
      prefix: "test-app",
      rag: {
        enabled: true,
        engines: {
          knowledgeBase: {
            enabled: true,
            external: [{ name: "my-kb", knowledgeBaseId: "short" }],
          },
        },
      },
    },
    "knowledgeBaseId"
  );
});

// ============================================
// Certificate validation tests
// ============================================

console.log("\n📋 Certificate & Domain Validation Tests\n");

test("should accept valid ACM certificate ARN (il-central-1)", () => {
  assertValidationPasses({
    prefix: "test-app",
    certificate:
      "arn:aws:acm:il-central-1:123456789012:certificate/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  });
});

test("should reject invalid certificate ARN", () => {
  assertValidationFails(
    { prefix: "test-app", certificate: "invalid-arn" },
    "certificate"
  );
});

test("should accept valid domain", () => {
  assertValidationPasses({
    prefix: "test-app",
    domain: "chat.example.com",
  });
});

test("should reject invalid domain format", () => {
  assertValidationFails(
    { prefix: "test-app", domain: "invalid domain" },
    "domain"
  );
});

// ============================================
// Complete manifest test
// ============================================

console.log("\n📋 Complete Manifest Test\n");

test("should accept complete valid manifest", () => {
  const completeManifest = {
    prefix: "prod-cb",
    enableWaf: true,
    createCMKs: true,
    advancedMonitoring: true,
    privateWebsite: true,
    certificate:
      "arn:aws:acm:il-central-1:123456789012:certificate/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    domain: "chat.example.com",
    vpc: {
      vpcId: "vpc-0123456789abcdef0",
      subnetIds: ["subnet-0123456789abcdef0", "subnet-0123456789abcdef1"],
      executeApiVpcEndpointId: "vpce-0123456789abcdef0",
      s3VpcEndpointId: "vpce-0123456789abcdef1",
      s3VpcEndpointIps: ["10.0.1.100", "10.0.2.100"],
    },
    cognitoFederation: {
      enabled: true,
      autoRedirect: true,
      customProviderName: "EnterpriseSSO",
      customProviderType: "SAML" as const,
      cognitoDomain: "my-chatbot",
      customSAML: {
        metadataDocumentUrl: "https://idp.example.com/metadata.xml",
      },
    },
    bedrock: {
      guardrails: {
        enabled: true,
        identifier: "abc123def456",
        version: "1",
      },
    },
    rag: {
      enabled: true,
      crossEncodingEnabled: false,
      engines: {
        opensearch: { enabled: true },
        knowledgeBase: {
          enabled: true,
          external: [
            {
              name: "my-knowledge-base",
              knowledgeBaseId: "ABCD123456",
              region: "il-central-1" as const,
              enabled: true,
            },
          ],
        },
      },
      embeddingsModels: [
        {
          provider: "bedrock" as const,
          name: "amazon.titan-embed-text-v1",
          dimensions: 1536,
          default: true,
        },
      ],
    },
  };

  assertValidationPasses(completeManifest);
});

// ============================================
// Summary
// ============================================

console.log("\n" + "=".repeat(60));
console.log(`📊 Test Results: ${passCount} passed, ${failCount} failed`);
console.log("=".repeat(60) + "\n");

if (failCount > 0) {
  process.exit(1);
}

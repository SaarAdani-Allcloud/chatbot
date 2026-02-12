/**
 * Integration test to verify YAML manifest parsing and validation
 *
 * Run with: npx ts-node bin/test-config-override.ts
 *
 * This script demonstrates how the manifest validation works
 * and shows sample overrides that would be applied.
 */

import * as yaml from "js-yaml";
import { readFileSync, existsSync } from "fs";
import { DeploymentManifestSchema, formatValidationErrors } from "./config-schema";

console.log("\n" + "=".repeat(70));
console.log("🔬 Config Override Integration Test");
console.log("=".repeat(70));

// Read the deployment manifest
const manifestPath = "deployment-manifest.yaml";

if (!existsSync(manifestPath)) {
  console.log("\n❌ No deployment-manifest.yaml found");
  process.exit(1);
}

console.log(`\n📄 Reading manifest: ${manifestPath}`);
const yamlContent = readFileSync(manifestPath, "utf8");
const parsed = yaml.load(yamlContent);

console.log("\n📝 Raw YAML content parsed:");
console.log(JSON.stringify(parsed, null, 2));

// Validate the manifest
console.log("\n🔍 Validating manifest against schema...");
const result = DeploymentManifestSchema.safeParse(parsed);

if (!result.success) {
  console.log("\n❌ Validation failed:");
  console.log(formatValidationErrors(result.error));
  process.exit(1);
}

console.log("✅ Manifest validation passed!");

const manifest = result.data;

// Show what would be overridden
console.log("\n📊 Values that would override config.json:");

if (manifest.prefix !== undefined) {
  console.log(`   prefix: "${manifest.prefix}"`);
}
if (manifest.enableWaf !== undefined) {
  console.log(`   enableWaf: ${manifest.enableWaf}`);
}
if (manifest.createCMKs !== undefined) {
  console.log(`   createCMKs: ${manifest.createCMKs}`);
}
if (manifest.advancedMonitoring !== undefined) {
  console.log(`   advancedMonitoring: ${manifest.advancedMonitoring}`);
}
if (manifest.privateWebsite !== undefined) {
  console.log(`   privateWebsite: ${manifest.privateWebsite}`);
}
if (manifest.certificate !== undefined) {
  console.log(`   certificate: "${manifest.certificate}"`);
}
if (manifest.domain !== undefined) {
  console.log(`   domain: "${manifest.domain}"`);
}

if (manifest.vpc) {
  console.log("\n   VPC Configuration:");
  if (manifest.vpc.vpcId) console.log(`     vpcId: ${manifest.vpc.vpcId}`);
  if (manifest.vpc.subnetIds) console.log(`     subnetIds: ${JSON.stringify(manifest.vpc.subnetIds)}`);
  if (manifest.vpc.executeApiVpcEndpointId) console.log(`     executeApiVpcEndpointId: ${manifest.vpc.executeApiVpcEndpointId}`);
  if (manifest.vpc.s3VpcEndpointId) console.log(`     s3VpcEndpointId: ${manifest.vpc.s3VpcEndpointId}`);
  if (manifest.vpc.s3VpcEndpointIps) console.log(`     s3VpcEndpointIps: ${JSON.stringify(manifest.vpc.s3VpcEndpointIps)}`);
}

if (manifest.cognitoFederation) {
  console.log("\n   Cognito Federation:");
  console.log(`     enabled: ${manifest.cognitoFederation.enabled}`);
  if (manifest.cognitoFederation.customProviderName) console.log(`     customProviderName: ${manifest.cognitoFederation.customProviderName}`);
  if (manifest.cognitoFederation.customProviderType) console.log(`     customProviderType: ${manifest.cognitoFederation.customProviderType}`);
}

if (manifest.bedrock?.guardrails) {
  console.log("\n   Bedrock Guardrails:");
  console.log(`     enabled: ${manifest.bedrock.guardrails.enabled}`);
  if (manifest.bedrock.guardrails.identifier) console.log(`     identifier: ${manifest.bedrock.guardrails.identifier}`);
  if (manifest.bedrock.guardrails.version) console.log(`     version: ${manifest.bedrock.guardrails.version}`);
}

if (manifest.rag) {
  console.log("\n   RAG Configuration:");
  console.log(`     enabled: ${manifest.rag.enabled}`);
  if (manifest.rag.engines?.opensearch) console.log(`     opensearch.enabled: ${manifest.rag.engines.opensearch.enabled}`);
  if (manifest.rag.engines?.knowledgeBase) console.log(`     knowledgeBase.enabled: ${manifest.rag.engines.knowledgeBase.enabled}`);
}

console.log("\n" + "=".repeat(70));
console.log("✅ Integration test complete - manifest is valid and ready for use");
console.log("=".repeat(70) + "\n");

#!/usr/bin/env node

// Copyright 2021 Amazon.com.
// SPDX-License-Identifier: MIT

import { Command } from "commander";
import * as enquirer from "enquirer";
import {
  ModelConfig,
  SupportedBedrockRegion,
  SupportedRegion,
  SupportedSageMakerModels,
  SystemConfig,
} from "../lib/shared/types";
import { LIB_VERSION } from "./version";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { AWSCronValidator } from "./aws-cron-validator";
import { tz } from "moment-timezone";
import { getData } from "country-list";
import { randomBytes } from "crypto";
import { StringUtils } from "turbocommons-ts";
import { resolveConfigFile } from "./utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

function getTimeZonesWithCurrentTime(): { message: string; name: string }[] {
  const timeZones = tz.names(); // Get a list of all timezones
  return timeZones.map((zone) => {
    // Get current time in each timezone
    const currentTime = tz(zone).format("YYYY-MM-DD HH:mm");
    return { message: `${zone}: ${currentTime}`, name: zone };
  });
}

function getCountryCodesAndNames(): { message: string; name: string }[] {
  // Use country-list to get an array of countries with their codes and names
  const countries = getData();
  // Map the country data to match the desired output structure
  return countries.map(({ code, name }) => {
    return { message: `${name} (${code})`, name: code };
  });
}

function isValidDate(dateString: string): boolean {
  // Check the pattern YYYY-MM-DD
  const regex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
  if (!regex.test(dateString)) {
    return false;
  }

  // Parse the date parts to integers
  const parts = dateString.split("-");
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
  const day = parseInt(parts[2], 10);

  // Check the date validity
  const date = new Date(year, month, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    return false;
  }

  // Check if the date is in the future compared to the current date at 00:00:00
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date > today;
}

const timeZoneData = getTimeZonesWithCurrentTime();
const cfCountries = getCountryCodesAndNames();
// test s3 bucket arn regexp
const s3BucketArnRegExp = RegExp(/^arn:aws:s3:::(?!-)[a-z0-9.-]{3,63}(?<!-)$/);
const iamRoleRegExp = RegExp(/arn:aws:iam::\d+:role\/[\w-_]+/);
const acmCertRegExp = RegExp(/arn:aws:acm:[\w-_]+:\d+:certificate\/[\w-_]+/);
const cfAcmCertRegExp = RegExp(
  /arn:aws:acm:us-east-1:\d+:certificate\/[\w-_]+/
);
const kendraIdRegExp = RegExp(/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/);
const secretManagerArnRegExp = RegExp(
  /arn:aws:secretsmanager:[\w-_]+:\d+:secret:[\w-_]+/
);

const embeddingModels: ModelConfig[] = [
  {
    provider: "sagemaker",
    name: "intfloat/multilingual-e5-large",
    dimensions: 1024,
    default: false,
  },
  {
    provider: "sagemaker",
    name: "sentence-transformers/all-MiniLM-L6-v2",
    dimensions: 384,
    default: false,
  },
  {
    provider: "bedrock",
    name: "amazon.titan-embed-text-v1",
    dimensions: 1536,
    default: false,
  },
  //Support for inputImage is not yet implemented for amazon.titan-embed-image-v1
  {
    provider: "bedrock",
    name: "amazon.titan-embed-image-v1",
    dimensions: 1024,
    default: false,
  },
  {
    provider: "bedrock",
    name: "cohere.embed-english-v3",
    dimensions: 1024,
    default: false,
  },
  {
    provider: "bedrock",
    name: "cohere.embed-multilingual-v3",
    dimensions: 1024,
    default: false,
  },
  {
    provider: "openai",
    name: "text-embedding-ada-002",
    dimensions: 1536,
    default: false,
  },
];

// Helper functions for environment variable handling
function getEnvVar(
  name: string | undefined,
  envPrefix?: string
): string | undefined {
  if (!name) return undefined;

  // Check for prefixed version if prefix is provided, then fall back to direct name
  const prefixedName = envPrefix ? `${envPrefix}${name}` : undefined;
  return prefixedName
    ? (process.env[prefixedName] ?? process.env[name])
    : process.env[name];
}

// Parse boolean environment variables
function parseBool(value: string | undefined): boolean {
  return (value ?? "").toLowerCase() === "true";
}

// Parse JSON environment variables
function parseJson<T>(value: string | undefined, defaultValue: T): T {
  if (!value) return defaultValue;
  try {
    return JSON.parse(value) as T;
  } catch (e) {
    console.warn(`Failed to parse JSON from env var: ${value}`);
    return defaultValue;
  }
}

// Get environment variable with type conversion
function getTypedEnvVar<T>(
  name: string,
  defaultValue: T,
  envPrefix?: string
): T {
  const value = getEnvVar(name, envPrefix);
  if (value === undefined) return defaultValue;

  switch (typeof defaultValue) {
    case "boolean":
      return parseBool(value) as unknown as T;
    case "number":
      return Number(value) as unknown as T;
    case "object":
      return parseJson(value, defaultValue);
    default:
      return value as unknown as T;
  }
}

/**
 * Main entry point
 */

(async () => {
  const program = new Command().description(
    "Creates a new chatbot configuration"
  );
  program.version(LIB_VERSION);

  program.option("-p, --prefix <prefix>", "The prefix for the stack");
  program.option(
    "--non-interactive",
    "Run in non-interactive mode for SeedFarmer deployment"
  );
  program.option("--deployment-type <type>", "Deployment type (e.g., 'nexus')");
  program.option(
    "--env-prefix <prefix>",
    "Environment variable prefix for non-interactive mode"
  );
  program.option(
    "--manifest",
    "Output deployment-manifest.yaml instead of config.json (also asks pipeline questions)"
  );

  program.action(async (options) => {
    const configFile = resolveConfigFile();
    if (fs.existsSync(configFile)) {
      const config: SystemConfig = JSON.parse(
        fs.readFileSync(configFile).toString("utf8")
      );
      options.prefix = config.prefix;
      options.enableWaf = config.enableWaf;
      options.provisionedConcurrency = config.provisionedConcurrency;
      options.directSend = config.directSend;
      options.caCerts = config.caCerts;
      options.enableS3TransferAcceleration =
        config.enableS3TransferAcceleration;
      options.cloudfrontLogBucketArn = config.cloudfrontLogBucketArn;
      options.createCMKs = config.createCMKs;
      options.retainOnDelete = config.retainOnDelete;
      options.ddbDeletionProtection = config.ddbDeletionProtection;
      options.vpcId = config.vpc?.vpcId;
      options.vpcSubnetIds = config.vpc?.subnetIds;
      options.bedrockEnable = config.bedrock?.enabled;
      options.bedrockRegion = config.bedrock?.region;
      options.bedrockRoleArn = config.bedrock?.roleArn;
      options.guardrailsEnable = config.bedrock?.guardrails?.enabled;
      options.guardrails = config.bedrock?.guardrails;
      options.nexusEnable = config.nexus?.enabled;
      options.nexusGatewayUrl = config.nexus?.gatewayUrl;
      options.nexusTokenUrl = config.nexus?.tokenUrl;
      options.nexusAuthClientId = config.nexus?.clientId;
      options.nexusAuthClientSecret = config.nexus?.clientSecret;
      options.sagemakerModels = config.llms?.sagemaker ?? [];
      options.enableSagemakerModels = config.llms?.sagemaker
        ? config.llms?.sagemaker.length > 0
        : false;
      options.huggingfaceApiSecretArn = config.llms?.huggingfaceApiSecretArn;
      options.enableSagemakerModelsSchedule =
        config.llms?.sagemakerSchedule?.enabled;
      options.enableSagemakerModelsSchedule =
        config.llms?.sagemakerSchedule?.enabled;
      options.timezonePicker = config.llms?.sagemakerSchedule?.timezonePicker;
      options.enableCronFormat =
        config.llms?.sagemakerSchedule?.enableCronFormat;
      options.cronSagemakerModelsScheduleStart =
        config.llms?.sagemakerSchedule?.sagemakerCronStartSchedule;
      options.cronSagemakerModelsScheduleStop =
        config.llms?.sagemakerSchedule?.sagemakerCronStopSchedule;
      options.daysForSchedule = config.llms?.sagemakerSchedule?.daysForSchedule;
      options.scheduleStartTime =
        config.llms?.sagemakerSchedule?.scheduleStartTime;
      options.scheduleStopTime =
        config.llms?.sagemakerSchedule?.scheduleStopTime;
      options.enableScheduleEndDate =
        config.llms?.sagemakerSchedule?.enableScheduleEndDate;
      options.startScheduleEndDate =
        config.llms?.sagemakerSchedule?.startScheduleEndDate;
      options.enableRag = config.rag.enabled;
      options.deployDefaultSagemakerModels =
        config.rag.deployDefaultSagemakerModels;
      options.ragsToEnable = Object.keys(config.rag.engines ?? {}).filter(
        (v: string) =>
          (
            config.rag.engines as {
              [key: string]: { enabled: boolean };
            }
          )[v].enabled
      );
      if (
        options.ragsToEnable.includes("kendra") &&
        !config.rag.engines.kendra.createIndex
      ) {
        options.ragsToEnable.pop("kendra");
      }
      options.embeddings = config.rag.embeddingsModels.map((m) => m.name);
      const defaultEmbeddings = (config.rag.embeddingsModels ?? []).filter(
        (m) => m.default
      );

      if (defaultEmbeddings.length > 0) {
        options.defaultEmbedding = defaultEmbeddings[0].name;
      }

      options.kendraExternal = config.rag.engines.kendra.external;
      options.kbExternal = config.rag.engines.knowledgeBase?.external ?? [];
      options.kendraEnterprise = config.rag.engines.kendra.enterprise;

      // Advanced settings

      options.advancedMonitoring = config.advancedMonitoring;
      options.createVpcEndpoints = config.vpc?.createVpcEndpoints;
      options.s3VpcEndpointIps = config.vpc?.s3VpcEndpointIps;
      options.s3VpcEndpointId = config.vpc?.s3VpcEndpointId;
      options.executeApiVpcEndpointId = config.vpc?.executeApiVpcEndpointId;
      options.logRetention = config.logRetention;
      options.rateLimitPerAIP = config.rateLimitPerIP;
      options.llmRateLimitPerIP = config.llms.rateLimitPerIP;
      options.privateWebsite = config.privateWebsite;
      options.certificate = config.certificate;
      options.domain = config.domain;
      options.cognitoFederationEnabled = config.cognitoFederation?.enabled;
      options.cognitoCustomProviderName =
        config.cognitoFederation?.customProviderName;
      options.cognitoCustomProviderType =
        config.cognitoFederation?.customProviderType;
      options.cognitoCustomProviderSAMLMetadata =
        config.cognitoFederation?.customSAML?.metadataDocumentUrl;
      options.cognitoCustomProviderOIDCClient =
        config.cognitoFederation?.customOIDC?.OIDCClient;
      options.cognitoCustomProviderOIDCSecret =
        config.cognitoFederation?.customOIDC?.OIDCSecret;
      options.cognitoCustomProviderOIDCIssuerURL =
        config.cognitoFederation?.customOIDC?.OIDCIssuerURL;
      options.cognitoAutoRedirect = config.cognitoFederation?.autoRedirect;
      options.cognitoDomain = config.cognitoFederation?.cognitoDomain;
      options.cfGeoRestrictEnable = config.cfGeoRestrictEnable;
      options.cfGeoRestrictList = config.cfGeoRestrictList;
    }

    // If --manifest mode, also try to pre-fill from existing deployment-manifest.yaml
    if (options.manifest) {
      const manifestPaths = [
        "deployment-manifest.yaml",
        "deployment-manifest.yml",
      ];
      for (const mp of manifestPaths) {
        const resolvedPath = path.resolve(mp);
        if (fs.existsSync(resolvedPath)) {
          try {
            const parsed = yaml.load(
              fs.readFileSync(resolvedPath, "utf8")
            ) as any;
            if (parsed) {
              // Pre-fill from manifest (manifest takes precedence over config.json)
              if (parsed.prefix) options.prefix = parsed.prefix;
              if (parsed.enableWaf !== undefined) options.enableWaf = parsed.enableWaf;
              if (parsed.enableS3TransferAcceleration !== undefined)
                options.enableS3TransferAcceleration = parsed.enableS3TransferAcceleration;
              if (parsed.directSend !== undefined) options.directSend = parsed.directSend;
              if (parsed.provisionedConcurrency !== undefined)
                options.provisionedConcurrency = parsed.provisionedConcurrency;
              if (parsed.cloudfrontLogBucketArn !== undefined)
                options.cloudfrontLogBucketArn = parsed.cloudfrontLogBucketArn;
              if (parsed.createCMKs !== undefined) options.createCMKs = parsed.createCMKs;
              if (parsed.retainOnDelete !== undefined) options.retainOnDelete = parsed.retainOnDelete;
              if (parsed.ddbDeletionProtection !== undefined)
                options.ddbDeletionProtection = parsed.ddbDeletionProtection;
              if (parsed.privateWebsite !== undefined) options.privateWebsite = parsed.privateWebsite;
              if (parsed.certificate !== undefined) options.certificate = parsed.certificate;
              if (parsed.domain !== undefined) options.domain = parsed.domain;
              if (parsed.logRetention !== undefined) options.logRetention = parsed.logRetention;
              if (parsed.rateLimitPerIP !== undefined) options.rateLimitPerAIP = parsed.rateLimitPerIP;
              if (parsed.advancedMonitoring !== undefined)
                options.advancedMonitoring = parsed.advancedMonitoring;
              if (parsed.cfGeoRestrictEnable !== undefined)
                options.cfGeoRestrictEnable = parsed.cfGeoRestrictEnable;
              if (parsed.cfGeoRestrictList !== undefined)
                options.cfGeoRestrictList = parsed.cfGeoRestrictList;
              if (parsed.vpc) {
                if (parsed.vpc.vpcId) options.vpcId = parsed.vpc.vpcId;
                if (parsed.vpc.subnetIds) options.vpcSubnetIds = parsed.vpc.subnetIds;
                if (parsed.vpc.createVpcEndpoints !== undefined)
                  options.createVpcEndpoints = parsed.vpc.createVpcEndpoints;
                if (parsed.vpc.s3VpcEndpointIps)
                  options.s3VpcEndpointIps = parsed.vpc.s3VpcEndpointIps;
                if (parsed.vpc.s3VpcEndpointId)
                  options.s3VpcEndpointId = parsed.vpc.s3VpcEndpointId;
                if (parsed.vpc.executeApiVpcEndpointId)
                  options.executeApiVpcEndpointId = parsed.vpc.executeApiVpcEndpointId;
              }
              if (parsed.bedrock) {
                if (parsed.bedrock.enabled !== undefined) options.bedrockEnable = parsed.bedrock.enabled;
                if (parsed.bedrock.region) options.bedrockRegion = parsed.bedrock.region;
                if (parsed.bedrock.roleArn) options.bedrockRoleArn = parsed.bedrock.roleArn;
                if (parsed.bedrock.guardrails) {
                  options.guardrailsEnable = parsed.bedrock.guardrails.enabled;
                  options.guardrails = parsed.bedrock.guardrails;
                }
              }
              if (parsed.nexus) {
                options.nexusEnable = parsed.nexus.enabled;
                options.nexusGatewayUrl = parsed.nexus.gatewayUrl;
                options.nexusTokenUrl = parsed.nexus.tokenUrl;
                options.nexusAuthClientId = parsed.nexus.clientId;
                options.nexusAuthClientSecret = parsed.nexus.clientSecret;
              }
              if (parsed.cognitoFederation) {
                options.cognitoFederationEnabled = parsed.cognitoFederation.enabled;
                options.cognitoCustomProviderName = parsed.cognitoFederation.customProviderName;
                options.cognitoCustomProviderType = parsed.cognitoFederation.customProviderType;
                options.cognitoAutoRedirect = parsed.cognitoFederation.autoRedirect;
                if (parsed.cognitoFederation.customSAML)
                  options.cognitoCustomProviderSAMLMetadata =
                    parsed.cognitoFederation.customSAML.metadataDocumentUrl;
                if (parsed.cognitoFederation.customOIDC) {
                  options.cognitoCustomProviderOIDCClient = parsed.cognitoFederation.customOIDC.OIDCClient;
                  options.cognitoCustomProviderOIDCSecret = parsed.cognitoFederation.customOIDC.OIDCSecret;
                  options.cognitoCustomProviderOIDCIssuerURL = parsed.cognitoFederation.customOIDC.OIDCIssuerURL;
                }
              }
              // Pipeline pre-fill
              if (parsed.pipeline) {
                options.pipelineEnabled = parsed.pipeline.enabled;
                options.pipelineCodecommitCreateNew = parsed.pipeline.codecommit?.createNew;
                options.pipelineCodecommitRepoName =
                  parsed.pipeline.codecommit?.newRepositoryName ||
                  parsed.pipeline.codecommit?.existingRepositoryName;
                options.pipelineBranch = parsed.pipeline.branch;
                options.pipelineRequireApproval = parsed.pipeline.requireApproval;
                options.pipelineNotificationEmail = parsed.pipeline.notificationEmail;
              }
              console.log(`\n📄 Pre-filled values from existing ${mp}\n`);
            }
          } catch (e) {
            // Ignore parse errors, will just use config.json defaults
          }
          break;
        }
      }
    }

    try {
      // SeedFarmer deployment detection
      if (
        options.nonInteractive ||
        process.env.SEEDFARMER_DEPLOYMENT === "true"
      ) {
        console.log(
          "Running in non-interactive mode for SeedFarmer deployment"
        );

        // Create a base config structure
        const defaultConfig: SystemConfig = {
          prefix: getTypedEnvVar<string>(
            "PREFIX",
            "genai-chatbot",
            options.envPrefix
          ),
          createCMKs: getTypedEnvVar<boolean>(
            "CREATE_CMKS",
            false,
            options.envPrefix
          ),
          retainOnDelete: getTypedEnvVar<boolean>(
            "RETAIN_ON_DELETE",
            false,
            options.envPrefix
          ),
          ddbDeletionProtection: getTypedEnvVar<boolean>(
            "DDB_DELETION_PROTECTION",
            false,
            options.envPrefix
          ),
          enableWaf: getTypedEnvVar<boolean>(
            "ENABLE_WAF",
            false,
            options.envPrefix
          ),
          enableS3TransferAcceleration: getTypedEnvVar<boolean>(
            "ENABLE_S3_TRANSFER_ACCELERATION",
            false,
            options.envPrefix
          ),

          // VPC Configuration
          vpc: getTypedEnvVar<string>("VPC_ID", "", options.envPrefix)
            ? {
                vpcId: getTypedEnvVar<string>("VPC_ID", "", options.envPrefix),
                createVpcEndpoints: getTypedEnvVar<boolean>(
                  "CREATE_VPC_ENDPOINTS",
                  false,
                  options.envPrefix
                ),
                // Both IPs and endpoint ID must be provided together for manual configuration
                s3VpcEndpointIps: getTypedEnvVar<string>(
                  "S3_VPC_ENDPOINT_IPS",
                  "",
                  options.envPrefix
                ) && getTypedEnvVar<string>(
                  "S3_VPC_ENDPOINT_ID",
                  "",
                  options.envPrefix
                )
                  ? getTypedEnvVar<string>(
                      "S3_VPC_ENDPOINT_IPS",
                      "",
                      options.envPrefix
                    )
                      .split(",")
                      .map((ip: string) => ip.trim())
                      .filter((ip: string) => ip.length > 0)
                  : undefined,
                s3VpcEndpointId: getTypedEnvVar<string>(
                  "S3_VPC_ENDPOINT_IPS",
                  "",
                  options.envPrefix
                ) && getTypedEnvVar<string>(
                  "S3_VPC_ENDPOINT_ID",
                  "",
                  options.envPrefix
                )
                  ? getTypedEnvVar<string>(
                      "S3_VPC_ENDPOINT_ID",
                      "",
                      options.envPrefix
                    )
                  : undefined,
                executeApiVpcEndpointId: getTypedEnvVar<string>(
                  "EXECUTE_API_VPC_ENDPOINT_ID",
                  "",
                  options.envPrefix
                ) || undefined,
              }
            : undefined,

          // Advanced settings
          advancedMonitoring: getTypedEnvVar<boolean>(
            "ADVANCED_MONITORING",
            false,
            options.envPrefix
          ),
          logRetention: getTypedEnvVar<number>(
            "LOG_RETENTION",
            7,
            options.envPrefix
          ),
          rateLimitPerIP: getTypedEnvVar<number>(
            "RATE_LIMIT_PER_IP",
            400,
            options.envPrefix
          ),
          privateWebsite: getTypedEnvVar<boolean>(
            "PRIVATE_WEBSITE",
            false,
            options.envPrefix
          ),
          certificate: getTypedEnvVar<string>(
            "CERTIFICATE_ARN",
            "",
            options.envPrefix
          ),
          domain: getTypedEnvVar<string>("DOMAIN_NAME", "", options.envPrefix),
          cfGeoRestrictEnable: getTypedEnvVar<boolean>(
            "CF_GEO_RESTRICT_ENABLE",
            false,
            options.envPrefix
          ),
          cfGeoRestrictList: getTypedEnvVar<string>(
            "CF_GEO_RESTRICT_LIST",
            "",
            options.envPrefix
          )
            ? getTypedEnvVar<string>(
                "CF_GEO_RESTRICT_LIST",
                "",
                options.envPrefix
              )
                .split(",")
                .map((country) => country.trim())
            : ([] as string[]),

          // LLM Configuration
          llms: {
            sagemaker: getTypedEnvVar<string>(
              "SAGEMAKER_MODELS",
              "",
              options.envPrefix
            )
              ? getTypedEnvVar<string>(
                  "SAGEMAKER_MODELS",
                  "",
                  options.envPrefix
                )
                  .split(",")
                  .map((model) => model.trim() as SupportedSageMakerModels)
              : [],
            rateLimitPerIP: getTypedEnvVar<number>(
              "LLM_RATE_LIMIT_PER_IP",
              100,
              options.envPrefix
            ),
            huggingfaceApiSecretArn: getTypedEnvVar<string>(
              "HUGGINGFACE_API_SECRET_ARN",
              "",
              options.envPrefix
            ),
            sagemakerSchedule: getTypedEnvVar<boolean>(
              "SAGEMAKER_SCHEDULE_ENABLE",
              false,
              options.envPrefix
            )
              ? {
                  enabled: true,
                  timezonePicker: getTypedEnvVar<string>(
                    "SAGEMAKER_SCHEDULE_TIMEZONE",
                    "UTC",
                    options.envPrefix
                  ),
                  enableCronFormat: getTypedEnvVar<boolean>(
                    "SAGEMAKER_SCHEDULE_CRON_FORMAT",
                    false,
                    options.envPrefix
                  ),
                  sagemakerCronStartSchedule: getTypedEnvVar<string>(
                    "SAGEMAKER_CRON_START_SCHEDULE",
                    "0 8 ? * MON-FRI *",
                    options.envPrefix
                  ),
                  sagemakerCronStopSchedule: getTypedEnvVar<string>(
                    "SAGEMAKER_CRON_STOP_SCHEDULE",
                    "0 18 ? * MON-FRI *",
                    options.envPrefix
                  ),
                  daysForSchedule: getTypedEnvVar<string>(
                    "SAGEMAKER_SCHEDULE_DAYS",
                    "MON,TUE,WED,THU,FRI",
                    options.envPrefix
                  ),
                  scheduleStartTime: getTypedEnvVar<string>(
                    "SAGEMAKER_SCHEDULE_START_TIME",
                    "08:00",
                    options.envPrefix
                  ),
                  scheduleStopTime: getTypedEnvVar<string>(
                    "SAGEMAKER_SCHEDULE_STOP_TIME",
                    "18:00",
                    options.envPrefix
                  ),
                  enableScheduleEndDate: getTypedEnvVar<boolean>(
                    "SAGEMAKER_SCHEDULE_END_DATE_ENABLE",
                    false,
                    options.envPrefix
                  ),
                  startScheduleEndDate: getTypedEnvVar<string>(
                    "SAGEMAKER_SCHEDULE_END_DATE",
                    "",
                    options.envPrefix
                  ),
                }
              : undefined,
          },

          // RAG Configuration
          rag: {
            enabled: getTypedEnvVar<boolean>(
              "RAG_ENABLE",
              false,
              options.envPrefix
            ),
            deployDefaultSagemakerModels: getTypedEnvVar<boolean>(
              "RAG_DEPLOY_DEFAULT_SAGEMAKER_MODELS",
              false,
              options.envPrefix
            ),
            crossEncodingEnabled: getTypedEnvVar<boolean>(
              "RAG_CROSS_ENCODING_ENABLE",
              false,
              options.envPrefix
            ),
            engines: {
              aurora: {
                enabled: getTypedEnvVar<boolean>(
                  "RAG_AURORA_ENABLE",
                  false,
                  options.envPrefix
                ),
              },
              opensearch: {
                enabled: getTypedEnvVar<boolean>(
                  "RAG_OPENSEARCH_ENABLE",
                  false,
                  options.envPrefix
                ),
              },
              kendra: {
                enabled: getTypedEnvVar<boolean>(
                  "RAG_KENDRA_ENABLE",
                  false,
                  options.envPrefix
                ),
                createIndex: getTypedEnvVar<boolean>(
                  "RAG_KENDRA_CREATE_INDEX",
                  false,
                  options.envPrefix
                ),
                external: getTypedEnvVar<any[]>(
                  "RAG_KENDRA_EXTERNAL",
                  [],
                  options.envPrefix
                ),
                enterprise: getTypedEnvVar<boolean>(
                  "RAG_KENDRA_ENTERPRISE",
                  false,
                  options.envPrefix
                ),
              },
              knowledgeBase: {
                enabled: getTypedEnvVar<boolean>(
                  "RAG_KNOWLEDGE_BASE_ENABLE",
                  false,
                  options.envPrefix
                ),
                external: getTypedEnvVar<any[]>(
                  "RAG_KNOWLEDGE_BASE_EXTERNAL",
                  [],
                  options.envPrefix
                ),
              },
            },
            embeddingsModels: [],
            crossEncoderModels: [],
          },
        };

        // Add conditional configurations

        // Bedrock Configuration
        if (
          getTypedEnvVar<boolean>("BEDROCK_ENABLE", false, options.envPrefix)
        ) {
          defaultConfig.bedrock = {
            enabled: true,
            region: getTypedEnvVar<string>(
              "BEDROCK_REGION",
              "us-east-1",
              options.envPrefix
            ) as SupportedRegion,
            roleArn: getTypedEnvVar<string>(
              "BEDROCK_ROLE_ARN",
              "",
              options.envPrefix
            ),
          };

          // Add guardrails if enabled
          if (
            getTypedEnvVar<boolean>(
              "BEDROCK_GUARDRAILS_ENABLE",
              false,
              options.envPrefix
            )
          ) {
            defaultConfig.bedrock.guardrails = {
              enabled: true,
              identifier: getTypedEnvVar<string>(
                "BEDROCK_GUARDRAILS_ID",
                "",
                options.envPrefix
              ),
              version: getTypedEnvVar<string>(
                "BEDROCK_GUARDRAILS_VERSION",
                "DRAFT",
                options.envPrefix
              ),
            };
          }
        }

        // Nexus Gateway Configuration
        if (getTypedEnvVar<boolean>("NEXUS_ENABLE", false, options.envPrefix)) {
          defaultConfig.nexus = {
            enabled: true,
            gatewayUrl: getTypedEnvVar<string>(
              "NEXUS_GATEWAY_URL",
              "",
              options.envPrefix
            ),
            tokenUrl: getTypedEnvVar<string>(
              "NEXUS_AUTH_TOKEN_URL",
              "",
              options.envPrefix
            ),
            clientId: getTypedEnvVar<string>(
              "NEXUS_AUTH_CLIENT_ID",
              "",
              options.envPrefix
            ),
            clientSecret: getTypedEnvVar<string>(
              "NEXUS_AUTH_CLIENT_SECRET",
              "",
              options.envPrefix
            ),
          };
        }

        // Cognito Federation
        if (
          getTypedEnvVar<boolean>(
            "COGNITO_FEDERATION_ENABLE",
            false,
            options.envPrefix
          )
        ) {
          defaultConfig.cognitoFederation = {
            enabled: true,
            autoRedirect: getTypedEnvVar<boolean>(
              "COGNITO_AUTO_REDIRECT",
              false,
              options.envPrefix
            ),
            customProviderName: getTypedEnvVar<string>(
              "COGNITO_CUSTOM_PROVIDER_NAME",
              "",
              options.envPrefix
            ),
            customProviderType: getTypedEnvVar<string>(
              "COGNITO_CUSTOM_PROVIDER_TYPE",
              "",
              options.envPrefix
            ),
            cognitoDomain: getTypedEnvVar<string>(
              "COGNITO_DOMAIN",
              `llm-cb-${randomBytes(8).toString("hex")}`,
              options.envPrefix
            ),
          };

          // Add SAML or OIDC config based on provider type
          if (defaultConfig.cognitoFederation.customProviderType === "SAML") {
            defaultConfig.cognitoFederation.customSAML = {
              metadataDocumentUrl: getTypedEnvVar<string>(
                "COGNITO_CUSTOM_PROVIDER_SAML_METADATA",
                "",
                options.envPrefix
              ),
            };
          } else if (
            defaultConfig.cognitoFederation.customProviderType === "OIDC"
          ) {
            defaultConfig.cognitoFederation.customOIDC = {
              OIDCClient: getTypedEnvVar<string>(
                "COGNITO_CUSTOM_PROVIDER_OIDC_CLIENT",
                "",
                options.envPrefix
              ),
              OIDCSecret: getTypedEnvVar<string>(
                "COGNITO_CUSTOM_PROVIDER_OIDC_SECRET",
                "",
                options.envPrefix
              ),
              OIDCIssuerURL: getTypedEnvVar<string>(
                "COGNITO_CUSTOM_PROVIDER_OIDC_ISSUER_URL",
                "",
                options.envPrefix
              ),
            };
          }
        }

        // Configure embedding models if RAG is enabled
        if (defaultConfig.rag.enabled) {
          if (defaultConfig.rag.deployDefaultSagemakerModels) {
            defaultConfig.rag.crossEncoderModels = [
              {
                provider: "sagemaker",
                name: "cross-encoder/ms-marco-MiniLM-L-12-v2",
                default: true,
              },
            ];
            defaultConfig.rag.embeddingsModels = embeddingModels;
          } else {
            defaultConfig.rag.embeddingsModels = embeddingModels.filter(
              (model) => model.provider !== "sagemaker"
            );
          }

          // Set default embedding model if specified
          const defaultEmbeddingName = getTypedEnvVar<string>(
            "RAG_DEFAULT_EMBEDDING_MODEL",
            "",
            options.envPrefix
          );
          if (
            defaultEmbeddingName &&
            defaultConfig.rag.embeddingsModels.length > 0
          ) {
            for (const model of defaultConfig.rag.embeddingsModels) {
              model.default = model.name === defaultEmbeddingName;
            }
          }
        }

        // Apply any additional environment-specific configuration
        if (
          options.deploymentType === "default" ||
          process.env.DEPLOYMENT_TYPE === "default"
        ) {
          console.log("Using default deployment configuration");
          // Use base configuration - no special settings needed
        }

        // Write the configuration file
        createConfig(defaultConfig);
        return;
      }

      // Interactive mode (original functionality)
      await processCreateOptions(options, !!options.manifest);
    } catch (err) {
      console.error("Could not complete the operation.");
      if (err instanceof Error) {
        console.error(err.message);
      }
      process.exit(1);
    }
  });

  program.parse(process.argv);
})();

function createConfig(config: any): void {
  fs.writeFileSync(resolveConfigFile(), JSON.stringify(config, undefined, 2));
  console.log(`Configuration written to ${resolveConfigFile()}`);
}

/**
 * Prompts the user for missing options
 *
 * @param options Options provided via the CLI
 * @returns The complete options
 */
async function processCreateOptions(options: any, manifestMode: boolean = false): Promise<void> {
  const questions = [
    {
      type: "input",
      name: "prefix",
      message: "Prefix to differentiate this deployment",
      initial: options.prefix,
      askAnswered: false,
      validate(value: string) {
        const regex = /^[a-zA-Z0-9-]{0,10}$/;
        return regex.test(value)
          ? true
          : "Only letters, numbers, and dashes are allowed. The max length is 10 characters.";
      },
    },
    {
      type: "confirm",
      name: "enableWaf",
      message: "Do you want to enable waf rules?",
      initial: options.enableWaf ?? true,
    },
    {
      type: "confirm",
      name: "enableS3TransferAcceleration",
      message: "Do you want to enable S3 transfer acceleration",
      initial: options.enableS3TransferAcceleration ?? true,
    },
    {
      type: "confirm",
      name: "directSend",
      message: "Do you want to lambda handlers to send directly to client",
      initial: options.directSend ?? false,
    },
    {
      type: "input",
      name: "provisionedConcurrency",
      message: "Do you want to enable provisioned concurrency?",
      hint: "Enter the number of provisioned concurrency 0 to disable",
      initial: options.provisionedConcurrency ?? 0,
      validate(value: string) {
        return value.match(/^\d+$/) ? true : "Enter a valid number";
      },
    },
    {
      type: "input",
      name: "caCert",
      message: "add ca certificates that will be trusted",
      hint: "this is required when called are being proxied",
      initial: "",
    },
    {
      type: "input",
      name: "cloudfrontLogBucketArn",
      message: "Cloudfront log bucket arn - leave empty to create one",
      hint: "this should be used when Cloudfront dosen't support a log bucket in your target region",
      initial: options.cloudfrontLogBucketArn ?? "",
      validate(bucketArn: string) {
        return (this as any).skipped || bucketArn === ""
          ? true
          : s3BucketArnRegExp.test(bucketArn)
            ? true
            : "Enter a valid S3 Bucket ARN in the format arn:aws:s3::bucket";
      },
    },
    {
      type: "confirm",
      name: "existingVpc",
      message:
        "Do you want to use existing vpc? (selecting false will create a new vpc)",
      initial: !!options.vpcId,
    },
    {
      type: "input",
      name: "vpcId",
      message: "Specify existing VpcId (vpc-xxxxxxxxxxxxxxxxx)",
      initial: options.vpcId,
      validate(vpcId: string) {
        return (this as any).skipped ||
          RegExp(/^vpc-[0-9a-f]{8,17}$/i).test(vpcId)
          ? true
          : "Enter a valid VpcId in vpc-xxxxxxxxxxx format";
      },
      skip(): boolean {
        return !(this as any).state.answers.existingVpc;
      },
    },
    {
      type: "confirm",
      name: "specificSubnets",
      message:
        "Do you want to use specifiy vpc subnets to use? (selecting false will use all private subnets with egress in the vpc)",
      initial: options.vpcSubnetIds ? true : false,
      skip(): boolean {
        return !(this as any).state.answers.existingVpc;
      },
    },
    {
      type: "list",
      name: "vpcSubnetIds",
      message:
        "Specify existing SubnetIds separated by comma (subnet-xxxxxxxxxxxxxxxxx, subnet-xxxxxxxxxxxxxxxxx)",
      initial: options.vpcSubnetIds,
      validate(vpcSubnetIds: any) {
        return (this as any).skipped ||
          (vpcSubnetIds as string[]).every((v) =>
            RegExp(/^subnet-[0-9a-f]{8,17}$/i).test(v)
          )
          ? true
          : "Enter valid SubnetIds in subnet-xxxxxxxxxxx format";
      },
      skip(): boolean {
        return !(this as any).state.answers.specificSubnets;
      },
    },
    {
      type: "confirm",
      name: "createCMKs",
      message:
        "Do you want to create KMS Customer Managed Keys (CMKs)? (It will be used to encrypt the data at rest.)",
      initial: options.createCMKs ?? true,
      hint: "It is recommended but enabling it on an existing environment will cause the re-creation of some of the resources (for example Aurora cluster, Open Search collection). To prevent data loss, it is recommended to use it on a new environment or at least enable retain on cleanup (needs to be deployed before enabling the use of CMK). For more information on Aurora migration, please refer to the documentation.",
    },
    {
      type: "confirm",
      name: "retainOnDelete",
      message:
        "Do you want to retain data stores on cleanup of the project (Logs, S3, Tables, Indexes, Cognito User pools)?",
      initial: options.retainOnDelete ?? true,
      hint: "It reduces the risk of deleting data. It will however not delete all the resources on cleanup (would require manual removal if relevant)",
    },
    {
      type: "confirm",
      name: "ddbDeletionProtection",
      message:
        "Do you want to enable delete protection for your DynamoDB tables?",
      initial: options.ddbDeletionProtection ?? false,
      hint: "It reduces the risk of accidental deleting your DDB tables. It will however not delete your DDB tables on cleanup.",
    },
    {
      type: "confirm",
      name: "bedrockEnable",
      message: "Do you have access to Bedrock and want to enable it",
      initial: true,
    },
    {
      type: "select",
      name: "bedrockRegion",
      message: "Region where Bedrock is available",
      choices: Object.values(SupportedBedrockRegion),
      initial: options.bedrockRegion ?? "us-east-1",
      skip() {
        return !(this as any).state.answers.bedrockEnable;
      },
    },
    {
      type: "input",
      name: "bedrockRoleArn",
      message:
        "Cross account role arn to invoke Bedrock - leave empty if Bedrock is in same account",
      validate: (v: string) => {
        const valid = iamRoleRegExp.test(v);
        return v.length === 0 || valid;
      },
      initial: options.bedrockRoleArn ?? "",
      skip() {
        return !(this as any).state.answers.bedrockEnable;
      },
    },
    {
      type: "confirm",
      name: "guardrailsEnable",
      message:
        "Do you want to enable Bedrock Guardrails? This is a recommended feature to build responsible AI applications." +
        " (Supported by all models except Idefics via SageMaker. If enabled, streaming will only work with Bedrock)",
      initial: options.guardrailsEnable ?? false,
    },
    {
      type: "input",
      name: "guardrailsIdentifier",
      message: "Bedrock Guardrail Identifier",
      validate(v: string) {
        return (this as any).skipped || (v && v.length === 12);
      },
      skip() {
        return !(this as any).state.answers.guardrailsEnable;
      },
      initial: options.guardrails?.identifier ?? "",
    },
    {
      type: "input",
      name: "guardrailsVersion",
      message: "Bedrock Guardrail Version",
      skip() {
        return !(this as any).state.answers.guardrailsEnable;
      },
      initial: options.guardrails?.version ?? "DRAFT",
    },
    {
      type: "confirm",
      name: "nexusEnable",
      message:
        "Do you want to enable the Nexus Gateway for model access? (If enabled, this will be used exclusively for all model providers)",
      initial: options.nexusEnable ?? false,
    },
    {
      type: "input",
      name: "nexusGatewayUrl",
      message: "Nexus Gateway URL",
      validate(v: string) {
        return (this as any).skipped || (v && v.length > 0);
      },
      skip() {
        return !(this as any).state.answers.nexusEnable;
      },
      initial: options.nexusGatewayUrl ?? "",
    },
    {
      type: "input",
      name: "nexusTokenUrl",
      message: "Nexus Auth Token URL",
      validate(v: string) {
        return (this as any).skipped || (v && v.length > 0);
      },
      skip() {
        return !(this as any).state.answers.nexusEnable;
      },
      initial: options.nexusTokenUrl ?? "",
    },
    {
      type: "input",
      name: "nexusAuthClientId",
      message: "Nexus Gateway Authentication Client ID",
      validate(v: string) {
        return (this as any).skipped || (v && v.length > 0);
      },
      skip() {
        return !(this as any).state.answers.nexusEnable;
      },
      initial: options.nexusAuthClientId ?? "",
    },
    {
      type: "input",
      name: "nexusAuthClientSecret",
      message: "Nexus Gateway Authentication Client Secret",
      validate(v: string) {
        return (this as any).skipped || (v && v.length > 0);
      },
      skip() {
        return !(this as any).state.answers.nexusEnable;
      },
      initial: options.nexusAuthClientSecret ?? "",
    },
    {
      type: "confirm",
      name: "enableSagemakerModels",
      message: "Do you want to use any text generation SageMaker Models",
      initial: options.enableSagemakerModels || false,
    },
    {
      type: "multiselect",
      name: "sagemakerModels",
      hint: "SPACE to select, ENTER to confirm selection [denotes instance size to host model]",
      message: "Which SageMaker Models do you want to enable",
      choices: Object.values(SupportedSageMakerModels),
      initial:
        (options.sagemakerModels ?? []).filter((m: string) =>
          Object.values(SupportedSageMakerModels)
            .map((x) => x.toString())
            .includes(m)
        ) || [],
      validate(choices: any) {
        return (this as any).skipped || choices.length > 0
          ? true
          : "You need to select at least one model";
      },
      skip(): boolean {
        (this as any).state._choices = (this as any).state.choices;
        return !(this as any).state.answers.enableSagemakerModels;
      },
    },
    {
      type: "input",
      name: "huggingfaceApiSecretArn",
      message:
        "Some HuggingFace models including mistral now require an API key, Please enter an Secrets Manager Secret ARN (see docs: Model Requirements)",
      validate: (v: string) => {
        const valid = secretManagerArnRegExp.test(v);
        return v.length === 0 || valid
          ? true
          : "If you are supplying a HF API key it needs to be a reference to a secrets manager secret ARN";
      },
      initial: options.huggingfaceApiSecretArn || "",
      skip(): boolean {
        return !(this as any).state.answers.enableSagemakerModels;
      },
    },
    {
      type: "confirm",
      name: "enableSagemakerModelsSchedule",
      message:
        "Do you want to enable a start/stop schedule for sagemaker models?",
      initial(): boolean {
        return (
          (options.enableSagemakerModelsSchedule &&
            (this as any).state.answers.enableSagemakerModels) ||
          false
        );
      },
      skip(): boolean {
        return !(this as any).state.answers.enableSagemakerModels;
      },
    },
    {
      type: "AutoComplete",
      name: "timezonePicker",
      hint: "start typing to auto complete, ENTER to confirm selection",
      message: "Which TimeZone do you want to run the schedule in?",
      choices: timeZoneData,
      validate(choices: any) {
        return (this as any).skipped || choices.length > 0
          ? true
          : "You need to select at least one time zone";
      },
      skip(): boolean {
        return !(this as any).state.answers.enableSagemakerModelsSchedule;
      },
      initial: options.timezonePicker || [],
    },
    {
      type: "select",
      name: "enableCronFormat",
      choices: [
        { message: "Simple - Wizard lead", name: "simple" },
        { message: "Advanced - Provide cron expression", name: "cron" },
      ],
      message: "How do you want to set the schedule?",
      initial: options.enableCronFormat || "",
      skip(): boolean {
        (this as any).state._choices = (this as any).state.choices;
        return !(this as any).state.answers.enableSagemakerModelsSchedule;
      },
    },
    {
      type: "input",
      name: "sagemakerCronStartSchedule",
      hint: "This cron format is using AWS eventbridge cron syntax see docs for more information",
      message:
        "Start schedule for Sagmaker models expressed in UTC AWS cron format",
      skip(): boolean {
        return !(this as any).state.answers.enableCronFormat.includes("cron");
      },
      validate(v: string) {
        if ((this as any).skipped) {
          return true;
        }
        try {
          AWSCronValidator.validate(v);
          return true;
        } catch (error) {
          if (error instanceof Error) {
            return error.message;
          }
          return false;
        }
      },
      initial: options.cronSagemakerModelsScheduleStart,
    },
    {
      type: "input",
      name: "sagemakerCronStopSchedule",
      hint: "This cron format is using AWS eventbridge cron syntax see docs for more information",
      message: "Stop schedule for Sagmaker models expressed in AWS cron format",
      skip(): boolean {
        return !(this as any).state.answers.enableCronFormat.includes("cron");
      },
      validate(v: string) {
        if ((this as any).skipped) {
          return true;
        }
        try {
          AWSCronValidator.validate(v);
          return true;
        } catch (error) {
          if (error instanceof Error) {
            return error.message;
          }
          return false;
        }
      },
      initial: options.cronSagemakerModelsScheduleStop,
    },
    {
      type: "multiselect",
      name: "daysForSchedule",
      hint: "SPACE to select, ENTER to confirm selection",
      message: "Which days of the week would you like to run the schedule on?",
      choices: [
        { message: "Sunday", name: "SUN" },
        { message: "Monday", name: "MON" },
        { message: "Tuesday", name: "TUE" },
        { message: "Wednesday", name: "WED" },
        { message: "Thursday", name: "THU" },
        { message: "Friday", name: "FRI" },
        { message: "Saturday", name: "SAT" },
      ],
      validate(choices: any) {
        return (this as any).skipped || choices.length > 0
          ? true
          : "You need to select at least one day";
      },
      skip(): boolean {
        (this as any).state._choices = (this as any).state.choices;
        if (!(this as any).state.answers.enableSagemakerModelsSchedule) {
          return true;
        }
        return !(this as any).state.answers.enableCronFormat.includes("simple");
      },
      initial: options.daysForSchedule || [],
    },
    {
      type: "input",
      name: "scheduleStartTime",
      message:
        "What time of day do you wish to run the start schedule? enter in HH:MM format",
      validate(v: string) {
        if ((this as any).skipped) {
          return true;
        }
        // Regular expression to match HH:MM format
        const regex = /^([0-1]?[0-9]|2[0-3]):([0-5]?[0-9])$/;
        return regex.test(v) || "Time must be in HH:MM format!";
      },
      skip(): boolean {
        if (!(this as any).state.answers.enableSagemakerModelsSchedule) {
          return true;
        }
        return !(this as any).state.answers.enableCronFormat.includes("simple");
      },
      initial: options.scheduleStartTime,
    },
    {
      type: "input",
      name: "scheduleStopTime",
      message:
        "What time of day do you wish to run the stop schedule? enter in HH:MM format",
      validate(v: string) {
        if ((this as any).skipped) {
          return true;
        }
        // Regular expression to match HH:MM format
        const regex = /^([0-1]?[0-9]|2[0-3]):([0-5]?[0-9])$/;
        return regex.test(v) || "Time must be in HH:MM format!";
      },
      skip(): boolean {
        if (!(this as any).state.answers.enableSagemakerModelsSchedule) {
          return true;
        }
        return !(this as any).state.answers.enableCronFormat.includes("simple");
      },
      initial: options.scheduleStopTime,
    },
    {
      type: "confirm",
      name: "enableScheduleEndDate",
      message:
        "Would you like to set an end date for the start schedule? (after this date the models would no longer start)",
      initial: options.enableScheduleEndDate || false,
      skip(): boolean {
        return !(this as any).state.answers.enableSagemakerModelsSchedule;
      },
    },
    {
      type: "input",
      name: "startScheduleEndDate",
      message: "After this date the models will no longer start",
      hint: "YYYY-MM-DD",
      validate(v: string) {
        if ((this as any).skipped) {
          return true;
        }
        return (
          isValidDate(v) ||
          "The date must be in format YYYY-MM-DD and be in the future"
        );
      },
      skip(): boolean {
        return !(this as any).state.answers.enableScheduleEndDate;
      },
      initial: options.startScheduleEndDate || false,
    },
    {
      type: "confirm",
      name: "enableRag",
      message: "Do you want to enable RAG",
      initial: options.enableRag || false,
    },
    {
      type: "confirm",
      name: "deployDefaultSagemakerModels",
      message:
        "Do you want to deploy the default embedding and cross-encoder models via SageMaker?",
      initial: options.deployDefaultSagemakerModels || false,
      skip(): boolean {
        return !(this as any).state.answers.enableRag;
      },
    },
    {
      type: "multiselect",
      name: "ragsToEnable",
      hint: "SPACE to select, ENTER to confirm selection",
      message: "Which datastores do you want to enable for RAG",
      choices: [
        { message: "Aurora", name: "aurora" },
        { message: "OpenSearch", name: "opensearch" },
        { message: "Kendra (managed)", name: "kendra" },
        { message: "Bedrock KnowldgeBase", name: "knowledgeBase" },
      ],
      validate(choices: any) {
        return (this as any).skipped || choices.length > 0
          ? true
          : "You need to select at least one engine";
      },
      skip(): boolean {
        // workaround for https://github.com/enquirer/enquirer/issues/298
        (this as any).state._choices = (this as any).state.choices;
        return !(this as any).state.answers.enableRag;
      },
      initial: options.ragsToEnable || [],
    },
    {
      type: "confirm",
      name: "kendraEnterprise",
      message: "Do you want to enable Kendra Enterprise Edition?",
      initial: options.kendraEnterprise || false,
      skip(): boolean {
        return !(this as any).state.answers.ragsToEnable.includes("kendra");
      },
    },
    {
      type: "confirm",
      name: "kendra",
      message: "Do you want to add existing Kendra indexes",
      initial:
        (options.kendraExternal !== undefined &&
          options.kendraExternal.length > 0) ||
        false,
      skip(): boolean {
        return (
          !(this as any).state.answers.enableRag ||
          !(this as any).state.answers.ragsToEnable.includes("kendra")
        );
      },
    },
  ];

  const answers: any = await enquirer.prompt(questions);
  const kendraExternal: any[] = [];
  let newKendra = answers.enableRag && answers.kendra;
  const existingKendraIndices = Array.from(options.kendraExternal || []);
  while (newKendra === true) {
    const existingIndex: any = existingKendraIndices.pop();
    const kendraQ = [
      {
        type: "input",
        name: "name",
        message: "Kendra source name",
        validate(v: string) {
          return RegExp(/^\w[\w-_]*\w$/).test(v);
        },
        initial: existingIndex?.name,
      },
      {
        type: "autocomplete",
        limit: 8,
        name: "region",
        choices: Object.values(SupportedRegion),
        message: `Region of the Kendra index${
          existingIndex?.region ? " (" + existingIndex?.region + ")" : ""
        }`,
        initial: Object.values(SupportedRegion).indexOf(existingIndex?.region),
      },
      {
        type: "input",
        name: "roleArn",
        message:
          "Cross account role Arn to assume to call Kendra, leave empty if not needed",
        validate: (v: string) => {
          const valid = iamRoleRegExp.test(v);
          return v.length === 0 || valid;
        },
        initial: existingIndex?.roleArn ?? "",
      },
      {
        type: "input",
        name: "kendraId",
        message: "Kendra ID",
        validate(v: string) {
          return kendraIdRegExp.test(v);
        },
        initial: existingIndex?.kendraId,
      },
      {
        type: "confirm",
        name: "enabled",
        message: "Enable this index",
        initial: existingIndex?.enabled ?? true,
      },
      {
        type: "confirm",
        name: "newKendra",
        message: "Do you want to add another Kendra source",
        initial: false,
      },
    ];
    const kendraInstance: any = await enquirer.prompt(kendraQ);
    const ext = (({ enabled, name, roleArn, kendraId, region }) => ({
      enabled,
      name,
      roleArn,
      kendraId,
      region,
    }))(kendraInstance);
    if (ext.roleArn === "") ext.roleArn = undefined;
    kendraExternal.push({
      ...ext,
    });
    newKendra = kendraInstance.newKendra;
  }

  // Knowledge Bases
  let newKB =
    answers.enableRag && answers.ragsToEnable.includes("knowledgeBase");
  const kbExternal: any[] = [];
  const existingKBIndices = Array.from(options.kbExternal || []);
  while (newKB === true) {
    const existingIndex: any = existingKBIndices.pop();
    const kbQ = [
      {
        type: "input",
        name: "name",
        message: "Bedrock KnowledgeBase source name",
        validate(v: string) {
          return RegExp(/^\w[\w-_]*\w$/).test(v);
        },
        initial: existingIndex?.name,
      },
      {
        type: "autocomplete",
        limit: 8,
        name: "region",
        choices: ["us-east-1", "us-west-2"],
        message: `Region of the Bedrock Knowledge Base index${
          existingIndex?.region ? " (" + existingIndex?.region + ")" : ""
        }`,
        initial: ["us-east-1", "us-west-2"].indexOf(existingIndex?.region),
      },
      {
        type: "input",
        name: "roleArn",
        message:
          "Cross account role Arn to assume to call the Bedrock KnowledgeBase, leave empty if not needed",
        validate: (v: string) => {
          const valid = iamRoleRegExp.test(v);
          return v.length === 0 || valid;
        },
        initial: existingIndex?.roleArn ?? "",
      },
      {
        type: "input",
        name: "knowledgeBaseId",
        message: "Bedrock KnowledgeBase ID",
        validate(v: string) {
          return /[A-Z0-9]{10}/.test(v);
        },
        initial: existingIndex?.knowledgeBaseId,
      },
      {
        type: "confirm",
        name: "enabled",
        message: "Enable this knowledge base",
        initial: existingIndex?.enabled ?? true,
      },
      {
        type: "confirm",
        name: "newKB",
        message: "Do you want to add another Bedrock KnowledgeBase source",
        initial: false,
      },
    ];
    const kbInstance: any = await enquirer.prompt(kbQ);
    const ext = (({ enabled, name, roleArn, knowledgeBaseId, region }) => ({
      enabled,
      name,
      roleArn,
      knowledgeBaseId,
      region,
    }))(kbInstance);
    if (ext.roleArn === "") ext.roleArn = undefined;
    kbExternal.push({
      ...ext,
    });
    newKB = kbInstance.newKB;
  }

  const modelsPrompts = [
    {
      type: "select",
      name: "defaultEmbedding",
      message: "Select a default embedding model",
      choices: embeddingModels.map((m) => ({ name: m.name, value: m })),
      initial: options.defaultEmbedding,
      validate(value: string) {
        if ((this as any).skipped) return true;
        const embeding = embeddingModels.find((i) => i.name === value);
        if (
          answers.enableRag &&
          embeding &&
          answers?.deployDefaultSagemakerModels === false &&
          embeding?.provider === "sagemaker"
        ) {
          return "SageMaker default models are not enabled. Please select another model.";
        }
        if (answers.enableRag) {
          return value ? true : "Select a default embedding model";
        }
        return true;
      },
      skip() {
        return (
          !answers.enableRag ||
          !(
            answers.ragsToEnable.includes("aurora") ||
            answers.ragsToEnable.includes("opensearch")
          )
        );
      },
    },
  ];
  const models: any = await enquirer.prompt(modelsPrompts);

  const advancedSettingsPrompts = [
    {
      type: "input",
      name: "llmRateLimitPerIP",
      message:
        "What is the allowed rate per IP for Gen AI calls (over 10 minutes)? This is used by the SendQuery mutation only",
      initial: options.llmRateLimitPerIP
        ? String(options.llmRateLimitPerIP)
        : "100",
      validate(value: string) {
        if (Number(value) >= 10) {
          return true;
        } else {
          return "Should be more than 10";
        }
      },
    },
    {
      type: "input",
      name: "rateLimitPerIP",
      message:
        "What the allowed per IP for all calls (over 10 minutes)? This is used by the all the AppSync APIs and CloudFront",
      initial: options.rateLimitPerAIP
        ? String(options.rateLimitPerAIP)
        : "400",
      validate(value: string) {
        if (Number(value) >= 10) {
          return true;
        } else {
          return "Should be more than 10";
        }
      },
    },
    {
      type: "input",
      name: "logRetention",
      message: "For how long do you want to store the logs (in days)?",
      initial: options.logRetention ? String(options.logRetention) : "7",
      validate(value: string) {
        // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-logs-loggroup.html#cfn-logs-loggroup-retentionindays
        const allowed = [
          1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096,
          1827, 2192, 2557, 2922, 3288, 3653,
        ];
        if (allowed.includes(Number(value))) {
          return true;
        } else {
          return "Allowed values are: " + allowed.join(", ");
        }
      },
    },
    {
      type: "confirm",
      name: "advancedMonitoring",
      message:
        "Do you want to use Amazon CloudWatch custom metrics, alarms and AWS X-Ray?",
      initial: options.advancedMonitoring || false,
    },
    {
      type: "confirm",
      name: "createVpcEndpoints",
      message: "Do you want create VPC Endpoints?",
      initial: options.createVpcEndpoints || false,
      skip(): boolean {
        return !answers.existingVpc;
      },
    },
    {
      type: "confirm",
      name: "privateWebsite",
      message:
        "Do you want to deploy a private website? I.e only accessible in VPC",
      initial: options.privateWebsite || false,
    },
    {
      type: "confirm",
      name: "provideS3VpcEndpointIps",
      message: "Do you want to provide S3 VPC endpoint IP addresses manually? (Otherwise they will be auto-discovered)",
      initial: false,
      skip(): boolean {
        return !(this as any).state.answers.privateWebsite || !answers.existingVpc;
      },
    },
    {
      type: "list",
      name: "s3VpcEndpointIps",
      message: "Enter S3 VPC endpoint IP addresses (comma-separated, one per availability zone)",
      separator: ",",
      skip(): boolean {
        return !(this as any).state.answers.provideS3VpcEndpointIps;
      },
      validate(v: any) {
        if ((this as any).skipped) return true;
        const ips = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(',') : []);
        const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
        const allValid = ips.every((ip: string) => {
          const trimmedIp = ip.trim();
          if (!ipPattern.test(trimmedIp)) return false;
          const parts = trimmedIp.split('.').map(Number);
          return parts.every(part => part >= 0 && part <= 255);
        });
        return allValid || "Please enter valid IP addresses (e.g., 10.0.1.5, 10.0.2.5)";
      },
      initial: options.s3VpcEndpointIps || [],
    },
    {
      type: "input",
      name: "s3VpcEndpointId",
      message: "Enter the S3 VPC endpoint ID (e.g., vpce-xxxxx)",
      skip(): boolean {
        return !(this as any).state.answers.provideS3VpcEndpointIps;
      },
      validate(v: string) {
        if ((this as any).skipped) return true;
        if (!v || v.trim() === '') {
          return "VPC endpoint ID is required when providing manual IP addresses";
        }
        const vpcePattern = /^vpce-[a-f0-9]+$/;
        return vpcePattern.test(v.trim()) || "Please enter a valid VPC endpoint ID (e.g., vpce-0123456789abcdef0)";
      },
      initial: options.s3VpcEndpointId || "",
    },
    {
      type: "input",
      name: "executeApiVpcEndpointId",
      message: "Enter existing execute-api VPC endpoint ID (leave empty to create new one)",
      skip(): boolean {
        return !(this as any).state.answers.privateWebsite || !answers.existingVpc;
      },
      validate(v: string) {
        if ((this as any).skipped || !v || v.trim() === '') return true;
        const vpcePattern = /^vpce-[a-f0-9]+$/;
        return vpcePattern.test(v.trim()) || "Please enter a valid VPC endpoint ID (e.g., vpce-0123456789abcdef0)";
      },
      initial: options.executeApiVpcEndpointId || "",
    },
    {
      type: "confirm",
      name: "customPublicDomain",
      message:
        "Do you want to provide a custom domain name and corresponding certificate arn for the public website ?",
      initial: !!options.domain,
      skip(): boolean {
        return (this as any).state.answers.privateWebsite;
      },
    },
    {
      type: "input",
      name: "certificate",
      validate(v: string) {
        if ((this as any).state.answers.privateWebsite) {
          const valid = acmCertRegExp.test(v);
          return (this as any).skipped || valid
            ? true
            : "You need to enter an ACM certificate arn";
        } else {
          const valid = cfAcmCertRegExp.test(v);
          return (this as any).skipped || valid
            ? true
            : "You need to enter an ACM certificate arn in us-east-1 for CF";
        }
      },
      message(): string {
        if ((this as any).state.answers.customPublicDomain) {
          return "ACM certificate ARN with custom domain for public website. Note that the certificate must resides in us-east-1";
        }
        return "ACM certificate ARN";
      },
      initial: options.certificate,
      skip(): boolean {
        return (
          !(this as any).state.answers.privateWebsite &&
          !(this as any).state.answers.customPublicDomain
        );
      },
    },
    {
      type: "input",
      name: "domain",
      message(): string {
        if ((this as any).state.answers.customPublicDomain) {
          return "Custom Domain for public website i.e example.com";
        }
        return "Domain for private website i.e example.com";
      },
      validate(v: any) {
        return (this as any).skipped || v.length > 0
          ? true
          : "You need to enter a domain name";
      },
      initial: options.domain,
      skip(): boolean {
        return (
          !(this as any).state.answers.privateWebsite &&
          !(this as any).state.answers.customPublicDomain
        );
      },
    },
    {
      type: "confirm",
      name: "cognitoFederationEnabled",
      message: "Do you want to enable Federated (SSO) login with Cognito?",
      initial: options.cognitoFederationEnabled || false,
    },
    {
      type: "input",
      name: "cognitoCustomProviderName",
      message:
        "Please enter the name of the SAML/OIDC Federated identity provider that is or will be setup in Cognito",
      skip(): boolean {
        return !(this as any).state.answers.cognitoFederationEnabled;
      },
      initial: options.cognitoCustomProviderName || "",
    },
    {
      type: "select",
      name: "cognitoCustomProviderType",
      choices: [
        { message: "Custom Cognito SAML", name: "SAML" },
        { message: "Custom Cognito OIDC", name: "OIDC" },
        { message: "Setup in Cognito Later", name: "later" },
      ],
      message:
        "Do you want to setup a SAML or OIDC provider? or choose to do this later after install",
      skip(): boolean {
        (this as any).state._choices = (this as any).state.choices;
        return !(this as any).state.answers.cognitoFederationEnabled;
      },
      initial: options.cognitoCustomProviderType || "",
    },
    {
      type: "input",
      name: "cognitoCustomProviderSAMLMetadata",
      message:
        "Provide a URL to a SAML metadata document. This document is issued by your SAML provider.",
      validate(v: string) {
        return (this as any).skipped || StringUtils.isUrl(v)
          ? true
          : "That does not look like a valid URL";
      },
      skip(): boolean {
        if (!(this as any).state.answers.cognitoFederationEnabled) {
          return true;
        }
        return !(this as any).state.answers.cognitoCustomProviderType.includes(
          "SAML"
        );
      },
      initial: options.cognitoCustomProviderSAMLMetadata || "",
    },
    {
      type: "input",
      name: "cognitoCustomProviderOIDCClient",
      message:
        "Enter the client ID provided by OpenID Connect identity provider.",
      validate(v: string) {
        if ((this as any).skipped) {
          return true;
        }
        // Regular expression to match HH:MM format
        const regex = /^[a-zA-Z0-9-_]{1,255}$/;
        return (
          regex.test(v) ||
          'Must only contain Alpha Numeric characters, "-" or "_" and be a maximum of 255 in length.'
        );
      },
      skip(): boolean {
        if (!(this as any).state.answers.cognitoFederationEnabled) {
          return true;
        }
        return !(this as any).state.answers.cognitoCustomProviderType.includes(
          "OIDC"
        );
      },
      initial: options.cognitoCustomProviderOIDCClient || "",
    },
    {
      type: "input",
      name: "cognitoCustomProviderOIDCSecret",
      validate(v: string) {
        const valid = secretManagerArnRegExp.test(v);
        return (this as any).skipped || valid
          ? true
          : "You need to enter an Secret Manager Secret arn";
      },
      message:
        "Enter the secret manager ARN containing the OIDC client secret to use (see docs for info)",
      skip(): boolean {
        if (!(this as any).state.answers.cognitoFederationEnabled) {
          return true;
        }
        return !(this as any).state.answers.cognitoCustomProviderType.includes(
          "OIDC"
        );
      },
      initial: options.cognitoCustomProviderOIDCSecret || "",
    },
    {
      type: "input",
      name: "cognitoCustomProviderOIDCIssuerURL",
      message: "Enter the issuer URL you received from the OIDC provider.",
      validate(v: string) {
        return (this as any).skipped || StringUtils.isUrl(v)
          ? true
          : "That does not look like a valid URL";
      },
      skip(): boolean {
        if (!(this as any).state.answers.cognitoFederationEnabled) {
          return true;
        }
        return !(this as any).state.answers.cognitoCustomProviderType.includes(
          "OIDC"
        );
      },
      initial: options.cognitoCustomProviderOIDCIssuerURL || "",
    },
    {
      type: "confirm",
      name: "cognitoAutoRedirect",
      message:
        "Would you like to automatically redirect users to this identity provider?",
      skip(): boolean {
        return !(this as any).state.answers.cognitoFederationEnabled;
      },
      initial: options.cognitoAutoRedirect || false,
    },
    {
      type: "confirm",
      name: "cfGeoRestrictEnable",
      message:
        "Do want to restrict access to the website (CF Distribution) to only a country or countries?",
      initial: options.cfGeoRestrictEnable || false,
      skip(): boolean {
        return (this as any).state.answers.privateWebsite;
      },
    },
    {
      type: "multiselect",
      name: "cfGeoRestrictList",
      hint: "SPACE to select, ENTER to confirm selection",
      message: "Which countries do you wish to ALLOW access?",
      choices: cfCountries,
      validate(choices: any) {
        return (this as any).skipped || choices.length > 0
          ? true
          : "You need to select at least one country";
      },
      skip(): boolean {
        (this as any).state._choices = (this as any).state.choices;
        return (
          !(this as any).state.answers.cfGeoRestrictEnable ||
          (this as any).state.answers.privateWebsite
        );
      },
      initial: options.cfGeoRestrictList || [],
    },
  ];

  const doAdvancedConfirm: any = await enquirer.prompt([
    {
      type: "confirm",
      name: "doAdvancedSettings",
      message: "Do you want to configure advanced settings?",
      initial: false,
    },
  ]);

  let advancedSettings: any = {};
  if (doAdvancedConfirm.doAdvancedSettings) {
    advancedSettings = await enquirer.prompt(advancedSettingsPrompts);
  }
  // Convert simple time into cron format for schedule
  if (
    answers.enableSagemakerModelsSchedule &&
    answers.enableCronFormat == "simple"
  ) {
    const daysToRunSchedule = answers.daysForSchedule.join(",");
    const startMinutes = answers.scheduleStartTime.split(":")[1];
    const startHour = answers.scheduleStartTime.split(":")[0];
    answers.sagemakerCronStartSchedule = `${startMinutes} ${startHour} ? * ${daysToRunSchedule} *`;
    AWSCronValidator.validate(answers.sagemakerCronStartSchedule);

    const stopMinutes = answers.scheduleStopTime.split(":")[1];
    const stopHour = answers.scheduleStopTime.split(":")[0];
    answers.sagemakerCronStopSchedule = `${stopMinutes} ${stopHour} ? * ${daysToRunSchedule} *`;
    AWSCronValidator.validate(answers.sagemakerCronStopSchedule);
  }

  const randomSuffix = randomBytes(8).toString("hex");
  // Create the config object
  const config = {
    prefix: answers.prefix,
    enableS3TransferAcceleration: answers.enableS3TransferAcceleration,
    enableWaf: answers.enableWaf,
    directSend: answers.directSend,
    provisionedConcurrency: parseInt(answers.provisionedConcurrency, 0),
    cloudfrontLogBucketArn: answers.cloudfrontLogBucketArn,
    createCMKs: answers.createCMKs,
    retainOnDelete: answers.retainOnDelete,
    ddbDeletionProtection: answers.ddbDeletionProtection,
    vpc: answers.existingVpc
      ? {
          vpcId: answers.vpcId.toLowerCase(),
          createVpcEndpoints: advancedSettings.createVpcEndpoints,
          subnetIds: answers.vpcSubnetIds,
          // Both IPs and endpoint ID must be provided together for manual configuration
          s3VpcEndpointIps: advancedSettings.s3VpcEndpointIps && 
                           advancedSettings.s3VpcEndpointIps.length > 0 &&
                           advancedSettings.s3VpcEndpointId &&
                           advancedSettings.s3VpcEndpointId.trim() !== ''
            ? advancedSettings.s3VpcEndpointIps.map((ip: string) => ip.trim())
            : undefined,
          s3VpcEndpointId: advancedSettings.s3VpcEndpointIps && 
                          advancedSettings.s3VpcEndpointIps.length > 0 &&
                          advancedSettings.s3VpcEndpointId &&
                          advancedSettings.s3VpcEndpointId.trim() !== ''
            ? advancedSettings.s3VpcEndpointId.trim()
            : undefined,
          executeApiVpcEndpointId: advancedSettings.executeApiVpcEndpointId &&
                          advancedSettings.executeApiVpcEndpointId.trim() !== ''
            ? advancedSettings.executeApiVpcEndpointId.trim()
            : undefined,
        }
      : undefined,
    privateWebsite: advancedSettings.privateWebsite,
    advancedMonitoring: advancedSettings.advancedMonitoring,
    logRetention: advancedSettings.logRetention
      ? Number(advancedSettings.logRetention)
      : undefined,
    rateLimitPerAIP: advancedSettings?.rateLimitPerIP
      ? Number(advancedSettings?.rateLimitPerIP)
      : undefined,
    certificate: advancedSettings.certificate,
    domain: advancedSettings.domain,
    cognitoFederation: advancedSettings.cognitoFederationEnabled
      ? {
          enabled: advancedSettings.cognitoFederationEnabled,
          autoRedirect: advancedSettings.cognitoAutoRedirect,
          customProviderName: advancedSettings.cognitoCustomProviderName,
          customProviderType: advancedSettings.cognitoCustomProviderType,
          customSAML:
            advancedSettings.cognitoCustomProviderType == "SAML"
              ? {
                  metadataDocumentUrl:
                    advancedSettings.cognitoCustomProviderSAMLMetadata,
                }
              : undefined,
          customOIDC:
            advancedSettings.cognitoCustomProviderType == "OIDC"
              ? {
                  OIDCClient: advancedSettings.cognitoCustomProviderOIDCClient,
                  OIDCSecret: advancedSettings.cognitoCustomProviderOIDCSecret,
                  OIDCIssuerURL:
                    advancedSettings.cognitoCustomProviderOIDCIssuerURL,
                }
              : undefined,
          cognitoDomain: advancedSettings.cognitoDomain
            ? advancedSettings.cognitoDomain
            : `llm-cb-${randomSuffix}`,
        }
      : undefined,
    cfGeoRestrictEnable: advancedSettings.cfGeoRestrictEnable,
    cfGeoRestrictList: advancedSettings.cfGeoRestrictList,
    bedrock: answers.bedrockEnable
      ? {
          enabled: answers.bedrockEnable,
          region: answers.bedrockRegion,
          roleArn:
            answers.bedrockRoleArn === "" ? undefined : answers.bedrockRoleArn,
          guardrails: {
            enabled: answers.guardrailsEnable,
            identifier: answers.guardrailsIdentifier,
            version: answers.guardrailsVersion,
          },
        }
      : undefined,
    nexus: answers.nexusEnable
      ? {
          enabled: answers.nexusEnable,
          gatewayUrl: answers.nexusGatewayUrl,
          tokenUrl: answers.nexusTokenUrl,
          clientId: answers.nexusAuthClientId,
          clientSecret: answers.nexusAuthClientSecret,
        }
      : undefined,
    llms: {
      enableSagemakerModels: answers.enableSagemakerModels,
      rateLimitPerAIP: advancedSettings?.llmRateLimitPerIP
        ? Number(advancedSettings?.llmRateLimitPerIP)
        : undefined,
      sagemaker: answers.sagemakerModels,
      huggingfaceApiSecretArn: answers.huggingfaceApiSecretArn,
      sagemakerSchedule: answers.enableSagemakerModelsSchedule
        ? {
            enabled: answers.enableSagemakerModelsSchedule,
            timezonePicker: answers.timezonePicker,
            enableCronFormat: answers.enableCronFormat,
            sagemakerCronStartSchedule: answers.sagemakerCronStartSchedule,
            sagemakerCronStopSchedule: answers.sagemakerCronStopSchedule,
            daysForSchedule: answers.daysForSchedule,
            scheduleStartTime: answers.scheduleStartTime,
            scheduleStopTime: answers.scheduleStopTime,
            enableScheduleEndDate: answers.enableScheduleEndDate,
            startScheduleEndDate: answers.startScheduleEndDate,
          }
        : undefined,
    },
    rag: {
      enabled: answers.enableRag,
      deployDefaultSagemakerModels: answers.deployDefaultSagemakerModels,
      engines: {
        aurora: {
          enabled: answers.ragsToEnable.includes("aurora"),
        },
        opensearch: {
          enabled: answers.ragsToEnable.includes("opensearch"),
        },
        kendra: {
          enabled: false,
          createIndex: false,
          external: [{}],
          enterprise: false,
        },
        knowledgeBase: {
          enabled: false,
          external: [{}],
        },
      },
      embeddingsModels: [] as ModelConfig[],
      crossEncoderModels: [] as ModelConfig[],
    },
  };

  if (config.rag.enabled && config.rag.deployDefaultSagemakerModels) {
    config.rag.crossEncoderModels[0] = {
      provider: "sagemaker",
      name: "cross-encoder/ms-marco-MiniLM-L-12-v2",
      default: true,
    };
    config.rag.embeddingsModels = embeddingModels;
  } else if (config.rag.enabled) {
    config.rag.embeddingsModels = embeddingModels.filter(
      (model) => model.provider !== "sagemaker"
    );
  } else {
    config.rag.embeddingsModels = [];
  }

  if (config.rag.embeddingsModels.length > 0 && models.defaultEmbedding) {
    for (const model of config.rag.embeddingsModels) {
      model.default = model.name === models.defaultEmbedding;
    }
  }

  config.rag.engines.kendra.createIndex =
    answers.ragsToEnable.includes("kendra");
  config.rag.engines.kendra.enabled =
    config.rag.engines.kendra.createIndex || kendraExternal.length > 0;
  config.rag.engines.kendra.external = [...kendraExternal];
  config.rag.engines.kendra.enterprise = answers.kendraEnterprise;

  config.rag.engines.knowledgeBase.external = [...kbExternal];
  config.rag.engines.knowledgeBase.enabled =
    config.rag.engines.knowledgeBase.external.length > 0;

  // ============================================
  // Pipeline Questions (only in --manifest mode)
  // ============================================
  let pipelineConfig: any = undefined;

  if (manifestMode) {
    const pipelineQuestions = [
      {
        type: "confirm",
        name: "pipelineEnabled",
        message: "Enable CI/CD pipeline (CodeCommit + CodePipeline)?",
        initial: options.pipelineEnabled ?? false,
      },
      {
        type: "confirm",
        name: "codecommitCreateNew",
        message: "Create a new CodeCommit repository?",
        initial: options.pipelineCodecommitCreateNew ?? true,
        skip(): boolean {
          return !(this as any).state.answers.pipelineEnabled;
        },
      },
      {
        type: "input",
        name: "codecommitRepoName",
        message(): string {
          if ((this as any).state.answers.codecommitCreateNew) {
            return "Name for the new CodeCommit repository";
          }
          return "Name of the existing CodeCommit repository";
        },
        initial: options.pipelineCodecommitRepoName ?? "aws-genai-llm-chatbot",
        validate(v: string) {
          return (this as any).skipped || /^[a-zA-Z0-9._-]+$/.test(v)
            ? true
            : "Repository name must contain only alphanumeric characters, dots, hyphens, and underscores";
        },
        skip(): boolean {
          return !(this as any).state.answers.pipelineEnabled;
        },
      },
      {
        type: "input",
        name: "pipelineBranch",
        message: "Branch to monitor for changes",
        initial: options.pipelineBranch ?? "main",
        skip(): boolean {
          return !(this as any).state.answers.pipelineEnabled;
        },
      },
      {
        type: "confirm",
        name: "requireApproval",
        message: "Require manual approval before deployment?",
        initial: options.pipelineRequireApproval ?? true,
        skip(): boolean {
          return !(this as any).state.answers.pipelineEnabled;
        },
      },
      {
        type: "input",
        name: "notificationEmail",
        message: "Notification email for pipeline events (leave empty to skip)",
        initial: options.pipelineNotificationEmail ?? "",
        validate(v: string) {
          if ((this as any).skipped || v === "") return true;
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
            ? true
            : "Enter a valid email address or leave empty";
        },
        skip(): boolean {
          return !(this as any).state.answers.pipelineEnabled;
        },
      },
    ];

    const pipelineAnswers: any = await enquirer.prompt(pipelineQuestions);

    if (pipelineAnswers.pipelineEnabled) {
      pipelineConfig = {
        enabled: true,
        codecommit: pipelineAnswers.codecommitCreateNew
          ? {
              createNew: true,
              newRepositoryName: pipelineAnswers.codecommitRepoName,
            }
          : {
              existingRepositoryName: pipelineAnswers.codecommitRepoName,
            },
        branch: pipelineAnswers.pipelineBranch || "main",
        requireApproval: pipelineAnswers.requireApproval ?? true,
        notificationEmail:
          pipelineAnswers.notificationEmail &&
          pipelineAnswers.notificationEmail.trim() !== ""
            ? pipelineAnswers.notificationEmail.trim()
            : undefined,
      };
    }
  }

  console.log("\n✨ This is the chosen configuration:\n");
  console.log(JSON.stringify(config, undefined, 2));

  if (manifestMode && pipelineConfig) {
    console.log("\n🔄 Pipeline configuration:");
    console.log(JSON.stringify(pipelineConfig, undefined, 2));
  }

  const confirmAnswer = (await enquirer.prompt([
    {
      type: "confirm",
      name: "create",
      message:
        "Do you want to create/update the configuration based on the above settings",
      initial: true,
    },
  ])) as any;

  if (confirmAnswer.create) {
    // Always write config.json (for local cdk deploy)
    createConfig(config);

    // If --manifest mode, also write deployment-manifest.yaml
    if (manifestMode) {
      writeManifest(config, pipelineConfig);
    }
  } else {
    console.log("Skipping");
  }
}

/**
 * Write deployment-manifest.yaml from the config object + pipeline config
 */
function writeManifest(config: any, pipelineConfig: any): void {
  const manifest: any = {
    // Core settings
    prefix: config.prefix,
    enableWaf: config.enableWaf,
    enableS3TransferAcceleration: config.enableS3TransferAcceleration,
    directSend: config.directSend,
    provisionedConcurrency: config.provisionedConcurrency,
    createCMKs: config.createCMKs,
    retainOnDelete: config.retainOnDelete,
    ddbDeletionProtection: config.ddbDeletionProtection,
  };

  // Optional strings
  if (config.caCert) manifest.caCerts = config.caCert;
  if (config.cloudfrontLogBucketArn)
    manifest.cloudfrontLogBucketArn = config.cloudfrontLogBucketArn;

  // Advanced / monitoring
  if (config.advancedMonitoring !== undefined)
    manifest.advancedMonitoring = config.advancedMonitoring;
  if (config.logRetention !== undefined)
    manifest.logRetention = Number(config.logRetention) || undefined;
  if (config.rateLimitPerAIP !== undefined)
    manifest.rateLimitPerIP = Number(config.rateLimitPerAIP) || undefined;
  if (config.privateWebsite !== undefined)
    manifest.privateWebsite = config.privateWebsite;
  if (config.certificate) manifest.certificate = config.certificate;
  if (config.domain) manifest.domain = config.domain;

  // CloudFront Geo Restriction
  if (config.cfGeoRestrictEnable !== undefined)
    manifest.cfGeoRestrictEnable = config.cfGeoRestrictEnable;
  if (config.cfGeoRestrictList && config.cfGeoRestrictList.length > 0)
    manifest.cfGeoRestrictList = config.cfGeoRestrictList;

  // VPC
  if (config.vpc) {
    manifest.vpc = {};
    if (config.vpc.vpcId) manifest.vpc.vpcId = config.vpc.vpcId;
    if (config.vpc.createVpcEndpoints !== undefined)
      manifest.vpc.createVpcEndpoints = config.vpc.createVpcEndpoints;
    if (config.vpc.subnetIds) manifest.vpc.subnetIds = config.vpc.subnetIds;
    if (config.vpc.s3VpcEndpointIps)
      manifest.vpc.s3VpcEndpointIps = config.vpc.s3VpcEndpointIps;
    if (config.vpc.s3VpcEndpointId)
      manifest.vpc.s3VpcEndpointId = config.vpc.s3VpcEndpointId;
    if (config.vpc.executeApiVpcEndpointId)
      manifest.vpc.executeApiVpcEndpointId =
        config.vpc.executeApiVpcEndpointId;
    // Remove empty vpc object
    if (Object.keys(manifest.vpc).length === 0) delete manifest.vpc;
  }

  // Cognito Federation
  if (config.cognitoFederation) {
    manifest.cognitoFederation = config.cognitoFederation;
  }

  // Bedrock
  if (config.bedrock) {
    manifest.bedrock = config.bedrock;
  }

  // Nexus
  if (config.nexus) {
    manifest.nexus = config.nexus;
  }

  // LLMs
  manifest.llms = {};
  if (config.llms) {
    if (config.llms.rateLimitPerAIP !== undefined)
      manifest.llms.rateLimitPerIP = Number(config.llms.rateLimitPerAIP);
    if (config.llms.sagemaker) manifest.llms.sagemaker = config.llms.sagemaker;
    if (config.llms.huggingfaceApiSecretArn)
      manifest.llms.huggingfaceApiSecretArn =
        config.llms.huggingfaceApiSecretArn;
    if (config.llms.sagemakerSchedule)
      manifest.llms.sagemakerSchedule = config.llms.sagemakerSchedule;
  }
  if (Object.keys(manifest.llms).length === 0) delete manifest.llms;

  // RAG
  manifest.rag = {
    enabled: config.rag.enabled,
    deployDefaultSagemakerModels: config.rag.deployDefaultSagemakerModels,
    crossEncodingEnabled: config.rag.crossEncodingEnabled,
    engines: config.rag.engines,
    embeddingsModels: config.rag.embeddingsModels,
    crossEncoderModels: config.rag.crossEncoderModels,
  };

  // Pipeline
  if (pipelineConfig) {
    manifest.pipeline = pipelineConfig;
  }

  const header = `# ============================================================
# Deployment Manifest - Generated by magic-config.ts
# This file overrides values from bin/config.json
# ============================================================
`;

  const manifestPath = path.resolve("deployment-manifest.yaml");
  const yamlContent =
    header + yaml.dump(manifest, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(manifestPath, yamlContent);
  console.log(`\n📄 Manifest written to ${manifestPath}`);
}

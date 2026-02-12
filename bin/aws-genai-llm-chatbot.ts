#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import "source-map-support/register";
import { AwsGenAILLMChatbotStack } from "../lib/aws-genai-llm-chatbot-stack";
import { AwsSolutionsChecks } from "cdk-nag";
import { Aspects } from "aws-cdk-lib";
import { LambdaVpcAspect } from "../lib/shared";
import { PipelineStack } from "../lib/pipeline-stack";
import { loadConfig } from "./config-loader";

const app = new cdk.App();

// Load config with YAML manifest overrides (YAML > config.json > defaults)
const config = loadConfig();
console.log("Final merged config: ", JSON.stringify(config, null, 2));

const env = {
  region: process.env.CDK_DEFAULT_REGION,
  account: process.env.CDK_DEFAULT_ACCOUNT,
};

// CDK_PIPELINE_DEPLOY is set by the pipeline's deploy CodeBuild step.
// When set, we skip creating the PipelineStack and instead create the
// ChatBot stack directly — producing the exact same template as a local deploy.
const isPipelineDeployStep = process.env.CDK_PIPELINE_DEPLOY === "true";

if (config.pipeline?.enabled && !isPipelineDeployStep) {
  // ============================================
  // Pipeline mode: deploy the CI/CD pipeline stack itself.
  // Run locally: npx cdk deploy <prefix>ChatBotPipelineStack
  // ============================================
  console.log("\n🔄 Pipeline mode: deploying CI/CD pipeline stack\n");

  new PipelineStack(app, `${config.prefix}ChatBotPipelineStack`, {
    config,
    env,
  });
} else {
  // ============================================
  // Direct deploy mode: deploy the ChatBot stack directly.
  // Used for:
  //   1. Local cdk deploy without pipeline (pipeline.enabled = false)
  //   2. Pipeline's deploy step (CDK_PIPELINE_DEPLOY = true)
  // ============================================
  console.log("\n🚀 Direct deploy mode: deploying ChatBot stack directly\n");

  const stack = new AwsGenAILLMChatbotStack(
    app,
    `${config.prefix}GenAIChatBotStack`,
    {
      config,
      env,
    }
  );

  // Apply Lambda VPC aspect to all Lambda functions in the stack
  if (config.vpc?.vpcId || !config.vpc) {
    Aspects.of(app).add(
      new LambdaVpcAspect({
        vpc: stack.shared.vpc,
        vpcSubnets: stack.shared.vpcSubnets,
        securityGroups: [stack.shared.lambdaSecurityGroup],
      })
    );
  }

  Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
}

import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { Aspects } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { AwsGenAILLMChatbotStack } from "./aws-genai-llm-chatbot-stack";
import { LambdaVpcAspect } from "./shared";
import { SystemConfig } from "./shared/types";

export interface ChatBotStageProps extends cdk.StageProps {
  readonly config: SystemConfig;
}

/**
 * CDK Stage that wraps the GenAI Chatbot stack.
 * Used by CDK Pipelines to deploy the chatbot as a self-contained unit.
 */
export class ChatBotStage extends cdk.Stage {
  constructor(scope: Construct, id: string, props: ChatBotStageProps) {
    super(scope, id, props);

    // Explicitly set stackName to match the direct-deploy stack name,
    // so the pipeline updates the existing stack instead of creating a new one.
    const stack = new AwsGenAILLMChatbotStack(
      this,
      `${props.config.prefix}GenAIChatBotStack`,
      {
        config: props.config,
        stackName: `${props.config.prefix}GenAIChatBotStack`,
      }
    );

    // Apply Lambda VPC aspect to all Lambda functions in the stage
    if (props.config.vpc?.vpcId || !props.config.vpc) {
      Aspects.of(this).add(
        new LambdaVpcAspect({
          vpc: stack.shared.vpc,
          vpcSubnets: stack.shared.vpcSubnets,
          securityGroups: [stack.shared.lambdaSecurityGroup],
        })
      );
    }

    Aspects.of(this).add(new AwsSolutionsChecks({ verbose: true }));
  }
}

import * as cdk from "aws-cdk-lib";
import * as codecommit from "aws-cdk-lib/aws-codecommit";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as pipelines from "aws-cdk-lib/pipelines";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";
import { SystemConfig } from "./shared/types";
import { ChatBotStage } from "./chatbot-stage";

export interface PipelineStackProps extends cdk.StackProps {
  readonly config: SystemConfig;
}

/**
 * CDK Pipeline stack that creates a self-mutating CI/CD pipeline
 * using CodeCommit, CodeBuild, and CodePipeline.
 *
 * The pipeline:
 * 1. Triggers on push to the configured branch in CodeCommit
 * 2. Runs cdk synth in CodeBuild (with Docker support for bundling)
 * 3. Self-mutates if the pipeline definition changed
 * 4. Optionally requires manual approval before deployment
 * 5. Deploys the ChatBot stack via CloudFormation
 */
export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, {
      description: "CI/CD Pipeline for AWS GenAI LLM Chatbot",
      ...props,
    });

    const pipelineConfig = props.config.pipeline!;

    // ============================================
    // 1. CodeCommit Repository (existing or new)
    // ============================================
    let repo: codecommit.IRepository;

    if (pipelineConfig.codecommit.createNew) {
      // Note: CodeCommit's initial commit API has a hard 20 MB limit.
      // This project exceeds that limit even with aggressive exclusions,
      // so we create the repo empty and the user pushes code manually.
      // The clone URLs are output below for convenience.
      repo = new codecommit.Repository(this, "ChatBotRepo", {
        repositoryName: pipelineConfig.codecommit.newRepositoryName!,
        description: "AWS GenAI LLM Chatbot - managed by CDK Pipeline",
      });

      // Output clone URLs so the user can push code after stack creation
      new cdk.CfnOutput(this, "CodeCommitCloneUrlHTTPS", {
        value: (repo as codecommit.Repository).repositoryCloneUrlHttp,
        description: "CodeCommit HTTPS clone URL",
      });
      new cdk.CfnOutput(this, "CodeCommitCloneUrlGRC", {
        value: (repo as codecommit.Repository).repositoryCloneUrlGrc,
        description:
          "CodeCommit GRC clone URL (recommended for credential-helper)",
      });
      new cdk.CfnOutput(this, "PostDeployInstructions", {
        value: `git remote add codecommit $(aws codecommit get-repository --repository-name ${pipelineConfig.codecommit.newRepositoryName!} --query 'repositoryMetadata.cloneUrlHttp' --output text) && git push codecommit HEAD:${pipelineConfig.branch}`,
        description:
          "Run this command after deploy to push code to CodeCommit and trigger the pipeline",
      });
    } else {
      repo = codecommit.Repository.fromRepositoryName(
        this,
        "ChatBotRepo",
        pipelineConfig.codecommit.existingRepositoryName!
      );
    }

    // ============================================
    // 2. Resolve VPC for CodeBuild (reuse chatbot VPC config)
    // ============================================
    let vpc: ec2.IVpc | undefined;
    let subnetSelection: ec2.SubnetSelection | undefined;

    if (props.config.vpc?.vpcId) {
      vpc = ec2.Vpc.fromLookup(this, "PipelineVpc", {
        vpcId: props.config.vpc.vpcId,
      });

      if (
        props.config.vpc.subnetIds &&
        props.config.vpc.subnetIds.length > 0
      ) {
        subnetSelection = {
          subnets: props.config.vpc.subnetIds.map((subnetId, idx) =>
            ec2.Subnet.fromSubnetId(this, `PipelineSubnet${idx}`, subnetId)
          ),
        };
      }
    }

    // ============================================
    // 3. Optional SNS Topic (only if email provided)
    // ============================================
    let notificationTopic: sns.ITopic | undefined;

    if (pipelineConfig.notificationEmail) {
      notificationTopic = new sns.Topic(this, "PipelineNotificationTopic", {
        topicName: `${props.config.prefix}-pipeline-notifications`,
        displayName: `${props.config.prefix} ChatBot Pipeline Notifications`,
      });
      notificationTopic.addSubscription(
        new subscriptions.EmailSubscription(pipelineConfig.notificationEmail)
      );
    }

    // ============================================
    // 4. CDK Pipeline (self-mutating)
    // ============================================
    const codeBuildDefaults: pipelines.CodeBuildOptions = {
      buildEnvironment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.LARGE,
        privileged: true, // required for Docker-in-Docker (Lambda layer bundling)
      },
      ...(vpc
        ? {
            vpc,
            subnetSelection,
          }
        : {}),
    };

    const pipeline = new pipelines.CodePipeline(this, "Pipeline", {
      pipelineName: `${props.config.prefix}-chatbot-pipeline`,
      selfMutation: true,
      dockerEnabledForSynth: true,
      dockerEnabledForSelfMutation: true,
      codeBuildDefaults,

      synth: new pipelines.ShellStep("Synth", {
        input: pipelines.CodePipelineSource.codeCommit(
          repo,
          pipelineConfig.branch
        ),
        installCommands: [
          "npm ci",
          "npm install -g @aws-amplify/cli",
        ],
        commands: [
          "npm run build", // runs: amplify codegen && tsc
          "npx cdk synth",
        ],
      }),
    });

    // ============================================
    // 5. Add Deployment Stage (with optional manual approval)
    // ============================================
    const deployStage = new ChatBotStage(this, "DeployChatBot", {
      config: props.config,
      env: {
        account: this.account,
        region: this.region,
      },
    });

    if (pipelineConfig.requireApproval) {
      pipeline.addStage(deployStage, {
        pre: [
          new pipelines.ManualApprovalStep("ApproveDeploy", {
            comment: `Approve deployment of ${props.config.prefix} GenAI ChatBot. Review changes before proceeding.`,
            ...(notificationTopic ? { notificationTopic } : {}),
          }),
        ],
      });
    } else {
      pipeline.addStage(deployStage);
    }

    // ============================================
    // 6. Pipeline output
    // ============================================
    // Note: pipeline.pipeline is not available until buildPipeline() is called
    // (which happens lazily during synth), so we use the known pipeline name.
    new cdk.CfnOutput(this, "PipelineName", {
      value: `${props.config.prefix}-chatbot-pipeline`,
      description: "CodePipeline name",
    });

    // ============================================
    // 7. CDK Nag suppressions for pipeline resources
    // ============================================
    NagSuppressions.addStackSuppressions(this, [
      {
        id: "AwsSolutions-IAM5",
        reason:
          "CDK Pipelines generates IAM policies with wildcards for CodeBuild and CodePipeline actions",
      },
      {
        id: "AwsSolutions-CB3",
        reason:
          "Privileged mode is required for Docker-in-Docker to bundle Lambda layers during cdk synth",
      },
      {
        id: "AwsSolutions-CB4",
        reason:
          "CDK Pipelines manages CodeBuild encryption settings automatically",
      },
      {
        id: "AwsSolutions-S1",
        reason:
          "CDK Pipelines artifact bucket does not require access logging for this use case",
      },
    ]);
  }
}

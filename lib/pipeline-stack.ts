import * as cdk from "aws-cdk-lib";
import * as codecommit from "aws-cdk-lib/aws-codecommit";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as pipelines from "aws-cdk-lib/pipelines";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";
import { SystemConfig } from "./shared/types";

export interface PipelineStackProps extends cdk.StackProps {
  readonly config: SystemConfig;
}

/**
 * CDK Pipeline stack that creates a CI/CD pipeline using CodeCommit,
 * CodeBuild, and CodePipeline.
 *
 * The pipeline:
 * 1. Triggers on push to the configured branch in CodeCommit
 * 2. Runs cdk synth in CodeBuild (build verification)
 * 3. Optionally requires manual approval before deployment
 * 4. Deploys the ChatBot stack via `cdk deploy` in a CodeBuild step
 *
 * The deploy step sets CDK_PIPELINE_DEPLOY=true so the CDK app
 * creates the ChatBot stack directly (same template as local deploy),
 * avoiding construct-path differences that CDK Stages introduce.
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
      repo = new codecommit.Repository(this, "ChatBotRepo", {
        repositoryName: pipelineConfig.codecommit.newRepositoryName!,
        description: "AWS GenAI LLM Chatbot - managed by CDK Pipeline",
      });

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
    // 4. CDK Pipeline
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

    const source = pipelines.CodePipelineSource.codeCommit(
      repo,
      pipelineConfig.branch
    );

    const pipeline = new pipelines.CodePipeline(this, "Pipeline", {
      pipelineName: `${props.config.prefix}-chatbot-pipeline`,
      selfMutation: false,
      dockerEnabledForSynth: true,
      codeBuildDefaults,

      synth: new pipelines.ShellStep("Synth", {
        input: source,
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
    // 5. Deploy via `cdk deploy` (no CDK Stage wrapper)
    // ============================================
    // Using a CodeBuildStep that runs `cdk deploy` directly produces
    // the exact same CloudFormation template as a local deploy,
    // avoiding the construct-path / logical-ID differences that
    // CDK Stages introduce (which caused resource replacements).
    const stackName = `${props.config.prefix}GenAIChatBotStack`;

    const deployStep = new pipelines.CodeBuildStep("CdkDeploy", {
      input: source,
      installCommands: [
        "npm ci",
        "npm install -g @aws-amplify/cli",
        // Authenticate to ECR Public for Docker base images used during asset bundling
        "aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws",
      ],
      commands: [
        "npm run build",
        `npx cdk deploy ${stackName} --require-approval never`,
      ],
      env: {
        // Tell the CDK app to create the ChatBot stack directly
        // (same path as local deploy), not the PipelineStack.
        CDK_PIPELINE_DEPLOY: "true",
      },
      rolePolicyStatements: [
        // Allow cdk deploy to assume CDK bootstrap roles
        // (deploy-role, file-publishing-role, cfn-exec-role, image-publishing-role)
        new iam.PolicyStatement({
          actions: ["sts:AssumeRole"],
          resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*`],
        }),
        // EC2 read-only for Vpc.fromLookup during internal cdk synth
        new iam.PolicyStatement({
          actions: ["ec2:Describe*"],
          resources: ["*"],
        }),
        // ECR Public auth for Docker base images
        new iam.PolicyStatement({
          actions: [
            "ecr-public:GetAuthorizationToken",
            "sts:GetServiceBearerToken",
          ],
          resources: ["*"],
        }),
      ],
    });

    // ============================================
    // 6. Wire up pipeline stages: Approval (optional) -> Deploy
    // ============================================
    if (pipelineConfig.requireApproval) {
      pipeline.addWave("Approval", {
        post: [
          new pipelines.ManualApprovalStep("ApproveDeploy", {
            comment: `Approve deployment of ${props.config.prefix} GenAI ChatBot. Review changes before proceeding.`,
            ...(notificationTopic ? { notificationTopic } : {}),
          }),
        ],
      });
    }

    pipeline.addWave("Deploy", {
      post: [deployStep],
    });

    // ============================================
    // 7. Materialize pipeline & attach managed policies
    // ============================================
    pipeline.buildPipeline();

    // Vpc.fromLookup during cdk synth needs broad EC2 read-only access
    const ec2ReadOnly = iam.ManagedPolicy.fromAwsManagedPolicyName(
      "AmazonEC2ReadOnlyAccess"
    );
    pipeline.synthProject.role?.addManagedPolicy(ec2ReadOnly);

    new cdk.CfnOutput(this, "PipelineName", {
      value: pipeline.pipeline.pipelineName,
      description: "CodePipeline name",
    });

    // ============================================
    // 8. CDK Nag suppressions for pipeline resources
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

import * as cdk from "aws-cdk-lib";
import * as codecommit from "aws-cdk-lib/aws-codecommit";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";
import { SystemConfig } from "./shared/types";

export interface PipelineStackProps extends cdk.StackProps {
  readonly config: SystemConfig;
}

/**
 * CI/CD Pipeline stack: Source -> (Approval) -> Deploy
 *
 * Uses a raw CodePipeline (not CDK Pipelines) for a lean pipeline
 * with no redundant synth stage. The deploy step runs `cdk deploy`
 * directly, producing the exact same CloudFormation template as a
 * local deploy.
 *
 * The deploy CodeBuild sets CDK_PIPELINE_DEPLOY=true so the CDK app
 * creates the ChatBot stack directly (not the PipelineStack).
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
    // 4. Deploy CodeBuild Project
    // ============================================
    const stackName = `${props.config.prefix}GenAIChatBotStack`;

    const deployProject = new codebuild.PipelineProject(
      this,
      "DeployProject",
      {
        projectName: `${props.config.prefix}-chatbot-deploy`,
        environment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
          computeType: codebuild.ComputeType.LARGE,
          privileged: true, // required for Docker-in-Docker (Lambda layer bundling)
        },
        environmentVariables: {
          CDK_PIPELINE_DEPLOY: { value: "true" },
        },
        ...(vpc
          ? {
              vpc,
              subnetSelection,
            }
          : {}),
        buildSpec: codebuild.BuildSpec.fromObject({
          version: "0.2",
          phases: {
            install: {
              commands: [
                "npm ci",
                "npm install -g @aws-amplify/cli",
                // Authenticate to ECR Public for Docker base images used during asset bundling
                "aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws || echo 'WARNING: ECR public login failed (SCP restriction?). Continuing without authenticated Docker pulls.'",
              ],
            },
            build: {
              commands: [
                "npm run build", // runs: amplify codegen && tsc
                `npx cdk deploy ${stackName} --require-approval never`,
              ],
            },
          },
        }),
        timeout: cdk.Duration.minutes(60),
      }
    );

    // Allow cdk deploy to assume CDK bootstrap roles
    deployProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*`],
      })
    );

    // EC2 read-only for Vpc.fromLookup during internal cdk synth
    deployProject.role?.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ReadOnlyAccess")
    );

    // ECR Public auth for Docker base images
    deployProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "ecr-public:GetAuthorizationToken",
          "sts:GetServiceBearerToken",
        ],
        resources: ["*"],
      })
    );

    // ============================================
    // 5. CodePipeline: Source -> (Approval) -> Deploy
    // ============================================
    const sourceOutput = new codepipeline.Artifact("SourceOutput");

    const pipeline = new codepipeline.Pipeline(this, "Pipeline", {
      // No explicit pipelineName — avoids name collision during the
      // migration from CDK Pipelines to raw CodePipeline (different
      // logical IDs, same physical name would fail the update).
      restartExecutionOnUpdate: false,
    });

    // --- Source stage ---
    pipeline.addStage({
      stageName: "Source",
      actions: [
        new codepipeline_actions.CodeCommitSourceAction({
          actionName: "CodeCommit",
          repository: repo,
          branch: pipelineConfig.branch,
          output: sourceOutput,
        }),
      ],
    });

    // --- Approval stage (optional) ---
    if (pipelineConfig.requireApproval) {
      pipeline.addStage({
        stageName: "Approval",
        actions: [
          new codepipeline_actions.ManualApprovalAction({
            actionName: "ApproveDeploy",
            ...(notificationTopic
              ? { notificationTopic }
              : {}),
            additionalInformation: `Approve deployment of ${props.config.prefix} GenAI ChatBot. Review changes before proceeding.`,
          }),
        ],
      });
    }

    // --- Deploy stage ---
    pipeline.addStage({
      stageName: "Deploy",
      actions: [
        new codepipeline_actions.CodeBuildAction({
          actionName: "CdkDeploy",
          project: deployProject,
          input: sourceOutput,
        }),
      ],
    });

    // ============================================
    // 6. Outputs
    // ============================================
    new cdk.CfnOutput(this, "PipelineName", {
      value: pipeline.pipelineName,
      description: "CodePipeline name",
    });

    // ============================================
    // 7. CDK Nag suppressions
    // ============================================
    NagSuppressions.addStackSuppressions(this, [
      {
        id: "AwsSolutions-IAM5",
        reason:
          "CodeBuild deploy role needs wildcards for CDK bootstrap role assumption and EC2 describe",
      },
      {
        id: "AwsSolutions-CB3",
        reason:
          "Privileged mode is required for Docker-in-Docker to bundle Lambda layers and React app",
      },
      {
        id: "AwsSolutions-CB4",
        reason:
          "CodeBuild project uses default encryption which is sufficient for CI/CD artifacts",
      },
      {
        id: "AwsSolutions-S1",
        reason:
          "Pipeline artifact bucket does not require access logging for this use case",
      },
    ]);
  }
}

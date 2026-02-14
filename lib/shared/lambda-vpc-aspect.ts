import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import { IConstruct } from "constructs";

export interface LambdaVpcAspectProps {
  readonly vpc: ec2.IVpc;
  readonly vpcSubnets: ec2.SubnetSelection;
  readonly securityGroups?: ec2.ISecurityGroup[];
}

/**
 * CDK Aspect that automatically associates all Lambda functions with a VPC.
 * 
 * Key insight: The main requirement is ensuring CloudFormation creates/updates
 * the IAM role permissions BEFORE updating the Lambda with VPC configuration.
 * This is achieved via explicit CloudFormation dependencies.
 */
export class LambdaVpcAspect implements cdk.IAspect {
  private readonly securityGroupIds: string[];
  private readonly subnetIds: string[];
  private readonly processedRoles = new Set<string>();

  constructor(props: LambdaVpcAspectProps) {
    this.securityGroupIds = props.securityGroups?.map(sg => sg.securityGroupId) || [];
    this.subnetIds = props.vpc.selectSubnets(props.vpcSubnets).subnetIds;
  }

  public visit(node: IConstruct): void {
    // Handle high-level Lambda Function constructs
    if (node instanceof lambda.Function) {
      this.configureLambdaFunction(node);
    }
    // Handle low-level CfnFunction constructs
    else if (node instanceof lambda.CfnFunction) {
      this.configureCfnFunction(node);
    }
    // Handle raw CfnResource Lambda functions (CDK singleton providers)
    else if (node instanceof cdk.CfnResource && node.cfnResourceType === 'AWS::Lambda::Function') {
      this.configureCfnResource(node);
    }
  }

  private configureLambdaFunction(fn: lambda.Function): void {
    const cfnFunction = fn.node.defaultChild as lambda.CfnFunction;
    if (!cfnFunction || cfnFunction.vpcConfig) {
      return;
    }

    // Add VPC permissions to the Lambda's actual role (not searching in parent scope)
    const roleResource = this.addVpcPermissionsToLambdaRole(fn);

    // Apply VPC configuration
    cfnFunction.addPropertyOverride('VpcConfig', {
      SecurityGroupIds: this.securityGroupIds,
      SubnetIds: this.subnetIds,
    });

    // Ensure role is updated before Lambda
    if (roleResource) {
      cfnFunction.addDependency(roleResource);
    }
  }

  /**
   * Add VPC permissions directly to the Lambda function's role.
   * This handles both auto-created roles and explicitly passed roles.
   */
  private addVpcPermissionsToLambdaRole(fn: lambda.Function): cdk.CfnResource | undefined {
    // Lambda functions have a 'role' property that references their execution role
    const role = fn.role;
    if (!role) return undefined;

    // Handle iam.Role (most common case - auto-created or explicitly passed)
    if (role instanceof iam.Role) {
      return this.addManagedVpcPolicy(role);
    }

    // For other IRole implementations, try to find the underlying CfnRole
    const defaultChild = role.node?.defaultChild;
    if (defaultChild) {
      return this.addManagedVpcPolicy(defaultChild as IConstruct);
    }

    // Fallback: search in parent scope (legacy behavior for edge cases)
    return this.addVpcPermissionsToRole(fn.node.scope);
  }

  private configureCfnFunction(cfnFunction: lambda.CfnFunction): void {
    if (cfnFunction.vpcConfig) {
      return;
    }

    const roleResource = this.addVpcPermissionsToRole(cfnFunction.node.scope);

    cfnFunction.addPropertyOverride('VpcConfig', {
      SecurityGroupIds: this.securityGroupIds,
      SubnetIds: this.subnetIds,
    });

    if (roleResource) {
      cfnFunction.addDependency(roleResource);
    }
  }

  private configureCfnResource(cfnResource: cdk.CfnResource): void {
    const props = (cfnResource as any)._cfnProperties || {};
    if (props.VpcConfig) {
      return;
    }

    const roleResource = this.addVpcPermissionsToRole(cfnResource.node.scope);

    cfnResource.addPropertyOverride('VpcConfig', {
      SecurityGroupIds: this.securityGroupIds.length > 0 ? this.securityGroupIds : undefined,
      SubnetIds: this.subnetIds,
    });

    if (roleResource) {
      cfnResource.addDependency(roleResource);
    }
  }

  /**
   * Find the IAM role for a Lambda and add VPC permissions.
   * Returns the CFN resource for dependency tracking.
   */
  private addVpcPermissionsToRole(parent: IConstruct | undefined): cdk.CfnResource | undefined {
    if (!parent) return undefined;

    // Find the role - try common CDK patterns
    const role = this.findRole(parent);
    if (!role) return undefined;

    // Add AWS managed VPC policy
    return this.addManagedVpcPolicy(role);
  }

  /**
   * Find IAM role construct using common CDK patterns.
   */
  private findRole(parent: IConstruct): IConstruct | undefined {
    // Try common child names
    for (const name of ['ServiceRole', 'Role']) {
      const child = parent.node.tryFindChild(name);
      if (child && this.isRoleConstruct(child)) {
        return child;
      }
    }

    // Search direct children
    for (const child of parent.node.children) {
      if (this.isRoleConstruct(child)) {
        return child;
      }
    }

    return undefined;
  }

  private isRoleConstruct(node: IConstruct): boolean {
    return (
      node instanceof iam.Role ||
      node instanceof iam.CfnRole ||
      (node instanceof cdk.CfnResource && node.cfnResourceType === 'AWS::IAM::Role')
    );
  }

  /**
   * Add AWS managed VPC policy to role. Returns CFN resource for dependency.
   */
  private addManagedVpcPolicy(role: IConstruct): cdk.CfnResource | undefined {
    const roleKey = role.node.addr;
    if (this.processedRoles.has(roleKey)) {
      // Already processed - return the existing role CFN resource
      return this.getCfnResourceForRole(role);
    }
    this.processedRoles.add(roleKey);

    const vpcPolicyArn = 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole';

    // Handle high-level iam.Role
    if (role instanceof iam.Role) {
      role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'));
      return role.node.defaultChild as cdk.CfnResource;
    }

    // Handle iam.CfnRole
    if (role instanceof iam.CfnRole) {
      const existing: any[] = (role.managedPolicyArns as any[]) || [];
      if (!existing.includes(vpcPolicyArn)) {
        role.managedPolicyArns = [...existing, vpcPolicyArn];
      }
      return role;
    }

    // Handle generic CfnResource (CDK singleton providers)
    if (role instanceof cdk.CfnResource) {
      const cfnProps = (role as any)._cfnProperties || {};
      const existing: any[] = cfnProps.ManagedPolicyArns || [];
      if (!existing.includes(vpcPolicyArn)) {
        role.addPropertyOverride('ManagedPolicyArns', [...existing, vpcPolicyArn]);
      }
      return role;
    }

    return undefined;
  }

  private getCfnResourceForRole(role: IConstruct): cdk.CfnResource | undefined {
    if (role instanceof cdk.CfnResource) return role;
    if (role instanceof iam.CfnRole) return role;
    if (role instanceof iam.Role) return role.node.defaultChild as cdk.CfnResource;
    return undefined;
  }
}

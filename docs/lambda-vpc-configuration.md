# Lambda VPC Configuration

This document explains how Lambda functions are automatically associated with VPCs in this chatbot solution.

## Overview

The solution now includes a CDK Aspect that automatically associates **all Lambda functions** with a VPC based on the configuration in `config.json`. This ensures consistent networking configuration across all Lambda functions without having to manually configure each one.

## How It Works

### 1. Lambda VPC Aspect

A CDK Aspect (`LambdaVpcAspect`) is applied to the main stack that:
- Visits all Lambda Function constructs in the CDK tree (both high-level `lambda.Function` and low-level `lambda.CfnFunction`)
- Checks if they already have VPC configuration
- Automatically associates them with the VPC, subnets, and security groups from the shared configuration
- Automatically adds the required AWS managed policies to each function's execution role:
  - `AWSLambdaVPCAccessExecutionRole` for VPC networking
  - `AWSLambdaBasicExecutionRole` for CloudWatch Logs
- Handles CDK singleton constructs (LogRetention, S3AutoDelete) that use low-level CFN resources

The aspect is defined in `lib/shared/lambda-vpc-aspect.ts`.

### 2. Shared Resources

The `Shared` construct (`lib/shared/index.ts`) provides:
- **VPC**: Either creates a new VPC or uses an existing one based on the `vpc.vpcId` configuration
- **Subnets**: Selects appropriate subnets (private with egress by default, or specific subnets if configured)
- **Security Group**: Creates or uses a default security group for Lambda functions

### 3. Automatic Application

The aspect is automatically applied in the main stack (`lib/aws-genai-llm-chatbot-stack.ts`) right after the `Shared` construct is created. This ensures all Lambda functions created after that point will be associated with the VPC.

## Configuration

You can configure VPC settings in your `config.json` file:

### Option 1: Use Existing VPC

```json
{
  "vpc": {
    "vpcId": "vpc-12345678",
    "subnetIds": ["subnet-12345678", "subnet-87654321"],
    "vpcDefaultSecurityGroup": "sg-12345678",
    "createVpcEndpoints": true,
    "s3VpcEndpointIps": ["10.0.1.5", "10.0.2.5", "10.0.3.5"],
    "s3VpcEndpointId": "vpce-0123456789abcdef0"
  }
}
```

### Option 2: Create New VPC (Default)

```json
{
  "vpc": {
    "createVpcEndpoints": true
  }
}
```

Or simply omit the `vpc` configuration entirely - a new VPC will be created automatically.

### Configuration Properties

- **`vpcId`** (optional): ID of an existing VPC to use. If not provided, a new VPC will be created.
- **`subnetIds`** (optional): Array of subnet IDs to place Lambda functions in. If not provided, private subnets with egress will be used.
- **`vpcDefaultSecurityGroup`** (optional): Security group ID for Lambda functions. If not provided, a new security group will be created.
- **`createVpcEndpoints`** (optional): Whether to create VPC endpoints for AWS services. Default is `true`.
- **`s3VpcEndpointIps`** (optional): Array of S3 VPC interface endpoint IP addresses to use for the private website ALB. Each IP should correspond to one availability zone. **Must be provided together with `s3VpcEndpointId`**. If not provided, both IPs and endpoint ID will be auto-discovered from the VPC.
- **`s3VpcEndpointId`** (optional): The VPC endpoint ID for the S3 interface endpoint (e.g., `vpce-0123456789abcdef0`). **Must be provided together with `s3VpcEndpointIps`**. This is used in the S3 bucket policy to restrict access to requests coming through the specified VPC endpoint. If not provided, both IPs and endpoint ID will be auto-discovered from the VPC.

**Important:** Both `s3VpcEndpointIps` and `s3VpcEndpointId` must be provided together for manual configuration (typically for cross-account scenarios). If neither is provided, the system will auto-discover both values from the local VPC.

## Benefits

1. **Consistency**: All Lambda functions use the same VPC configuration
2. **Simplicity**: No need to manually configure VPC for each Lambda function
3. **Flexibility**: Can use existing VPC resources or create new ones
4. **Security**: Functions that already have explicit VPC configuration are not modified
5. **Automatic IAM Permissions**: The aspect automatically adds required VPC execution permissions to all Lambda roles

## Technical Details

### Aspect Behavior

The `LambdaVpcAspect`:
- Handles both high-level (`lambda.Function`) and low-level (`lambda.CfnFunction`) constructs
- Only modifies Lambda functions that don't already have VPC configuration
- Applies VPC settings at the CloudFormation level
- Automatically adds required AWS managed policies to the Lambda execution role
- Specifically handles CDK singleton resources (LogRetention, S3AutoDelete) by finding and updating their IAM roles
- Adds metadata to track which functions were configured by the aspect
- Provides a `skipFunction` callback for custom filtering logic

### IAM Permissions

The aspect automatically attaches two AWS managed policies to each Lambda function's execution role:

1. **`service-role/AWSLambdaVPCAccessExecutionRole`** - VPC networking permissions:
   - `ec2:CreateNetworkInterface`
   - `ec2:DescribeNetworkInterfaces`
   - `ec2:DeleteNetworkInterface`
   - `ec2:AssignPrivateIpAddresses`
   - `ec2:UnassignPrivateIpAddresses`

2. **`service-role/AWSLambdaBasicExecutionRole`** - CloudWatch Logs permissions:
   - `logs:CreateLogGroup`
   - `logs:CreateLogStream`
   - `logs:PutLogEvents`

These permissions ensure Lambda functions can both manage ENIs in your VPC and write logs to CloudWatch.

### Skip Logic

By default, the aspect only skips Lambda functions that already have VPC configuration:

```typescript
skipFunction: (fn: lambda.Function) => {
  const cfnFunction = fn.node.defaultChild as lambda.CfnFunction;
  const vpcConfig = cfnFunction?.vpcConfig as lambda.CfnFunction.VpcConfigProperty | undefined;
  return !!(vpcConfig && vpcConfig.subnetIds && vpcConfig.subnetIds.length > 0);
}
```

This ensures that functions with explicit VPC configuration maintain their specific settings while all other Lambda functions (including CDK-generated ones) are automatically placed in the VPC with the proper IAM permissions.

## Example: Verifying VPC Association

After deployment, you can verify that Lambda functions are associated with the VPC by:

1. **AWS Console**: Check the Lambda function's configuration tab to see VPC settings
2. **AWS CLI**:
   ```bash
   aws lambda get-function --function-name <function-name> --query 'Configuration.VpcConfig'
   ```
3. **CloudFormation**: Inspect the synthesized CloudFormation template to see VPC configuration

## Troubleshooting

### CREATE_FAILED: Execution role does not have permissions to call CreateNetworkInterface

**Error**: "The provided execution role does not have permissions to call CreateNetworkInterface on EC2"

**Cause**: This error should not occur with the current implementation because the aspect automatically adds the `AWSLambdaVPCAccessExecutionRole` and `AWSLambdaBasicExecutionRole` managed policies to all Lambda execution roles.

**Solution**: If you still see this error:
1. Verify that the aspect is being applied correctly to the stack
2. Check that the Lambda function's execution role exists and is accessible
3. Ensure there are no IAM policy restrictions preventing the attachment of managed policies

### Lambda Function Not in VPC

If a Lambda function is not in the VPC:
1. Check if it already had VPC configuration before the aspect was applied
2. Verify that the aspect is applied after the `Shared` construct is created
3. Check if there's a custom `skipFunction` logic excluding it

### VPC Endpoint Issues

If you encounter issues with AWS service access:
1. Ensure `createVpcEndpoints` is set to `true` in the configuration
2. Verify that the appropriate VPC endpoints are created for the services you're using
3. Check security group rules allow traffic to the VPC endpoints

### Security Group Issues

If there are connectivity issues:
1. Verify that the security group allows outbound traffic
2. Check that the security group has the necessary ingress rules for inter-Lambda communication
3. If using an existing security group, ensure it has the correct rules

## Migration

If you're migrating from a version without this aspect:

1. **No action required** for new deployments - the aspect will automatically configure all Lambda functions
2. **Existing deployments**: The aspect will apply to new Lambda functions and update existing ones that don't have VPC configuration
3. **Lambda functions with explicit VPC configuration**: These will not be modified by the aspect

## Related Files

- `lib/shared/lambda-vpc-aspect.ts` - Aspect implementation
- `lib/shared/index.ts` - Shared resources including VPC and security group
- `lib/aws-genai-llm-chatbot-stack.ts` - Aspect application
- `bin/default-config.json` - Default VPC configuration
- `lib/shared/types.ts` - VPC configuration types


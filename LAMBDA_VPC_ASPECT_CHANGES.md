# Lambda VPC Aspect Implementation - Summary of Changes

## Overview
This document summarizes the changes made to automatically associate all Lambda functions with a VPC based on configuration parameters in `config.json`.

## Changes Made

### 1. Created Lambda VPC Aspect (`lib/shared/lambda-vpc-aspect.ts`)
- **New file**: Implements a CDK Aspect that automatically visits all Lambda Function constructs
- **Features**:
  - Checks if Lambda functions already have VPC configuration
  - Automatically associates Lambda functions with VPC, subnets, and security groups
  - **Automatically adds AWS managed policy `AWSLambdaVPCAccessExecutionRole` to Lambda execution roles**
  - **Directly accesses each Lambda's actual role** (via `fn.role`) instead of searching parent scope
  - Handles both auto-created roles and explicitly passed roles
  - Provides skip logic to avoid modifying functions with explicit VPC configuration
  - Adds metadata tracking for aspect application

### 2. Updated Shared Construct (`lib/shared/index.ts`)
- **Added**: `lambdaSecurityGroup` property to the Shared class
- **Logic**: 
  - Creates a new security group for Lambda functions OR
  - Uses an existing security group from `config.vpc.vpcDefaultSecurityGroup`
- **Export**: Added export of `LambdaVpcAspect` and `LambdaVpcAspectProps`

### 3. Updated Main Stack (`lib/aws-genai-llm-chatbot-stack.ts`)
- **Added**: Import of `LambdaVpcAspect` from shared module
- **Applied**: VPC aspect to the stack immediately after Shared construct creation
- **Skip Logic**: Implemented custom skip function to preserve existing VPC configurations only
- **IAM Permissions**: The aspect automatically adds required VPC execution permissions to ALL Lambda functions

### 4. Updated Default Configuration (`bin/default-config.json`)
- **Added**: Complete VPC configuration section with inline documentation
- **Properties**:
  - `vpcId`: Optional existing VPC ID
  - `subnetIds`: Optional array of subnet IDs
  - `vpcDefaultSecurityGroup`: Optional security group ID
  - `createVpcEndpoints`: Control VPC endpoint creation

### 5. Created Documentation (`docs/lambda-vpc-configuration.md`)
- **Comprehensive guide** covering:
  - How the VPC aspect works
  - Configuration options
  - Benefits and use cases
  - Troubleshooting tips
  - Technical details

## How It Works

1. **Configuration Loading**: VPC configuration is loaded from `config.json`
2. **Shared Resources Creation**: The Shared construct creates or imports VPC resources
3. **Aspect Application**: The LambdaVpcAspect is applied to the entire stack
4. **Automatic Association**: As CDK synthesizes the stack, the aspect visits each Lambda function and:
   - Configures VPC settings (VPC, subnets, security groups)
   - Adds `AWSLambdaVPCAccessExecutionRole` managed policy (VPC networking)
   - Adds `AWSLambdaBasicExecutionRole` managed policy (CloudWatch Logs)
5. **Skip Logic**: Only functions with existing VPC configuration are preserved

## Configuration Example

### Using Existing VPC
```json
{
  "vpc": {
    "vpcId": "vpc-0123456789abcdef0",
    "subnetIds": ["subnet-111111", "subnet-222222"],
    "vpcDefaultSecurityGroup": "sg-0123456789abcdef0",
    "createVpcEndpoints": true
  }
}
```

### Creating New VPC (Default)
```json
{
  "vpc": {
    "createVpcEndpoints": true
  }
}
```

## Key Benefits

1. **Consistency**: All Lambda functions automatically use the same VPC configuration
2. **Simplicity**: No need to manually configure VPC for each Lambda function
3. **Flexibility**: Supports both new and existing VPC resources
4. **Safety**: Preserves explicit VPC configurations where they exist
5. **Maintainability**: Single point of configuration for all Lambda networking
6. **Automatic IAM**: No need to manually add VPC execution permissions - the aspect handles it automatically

## Testing

- ✅ TypeScript compilation successful (`npx tsc --noEmit`)
- ✅ No linter errors
- ✅ All changes properly typed with TypeScript

## Files Modified

1. `lib/shared/lambda-vpc-aspect.ts` (NEW)
2. `lib/shared/index.ts` (MODIFIED)
3. `lib/aws-genai-llm-chatbot-stack.ts` (MODIFIED)
4. `bin/default-config.json` (MODIFIED)
5. `docs/lambda-vpc-configuration.md` (NEW)
6. `LAMBDA_VPC_ASPECT_CHANGES.md` (NEW - this file)

## Deployment Notes

- **Existing deployments**: The aspect will apply to all Lambda functions on the next deployment
- **New deployments**: All Lambda functions will automatically be in the VPC
- **Backward compatibility**: Functions with explicit VPC configuration are not modified
- **VPC endpoints**: Will be created automatically unless disabled in configuration

## AwsCustomResource and cr.Provider VPC Configuration

The CDK Aspect handles regular `lambda.Function` constructs, but `AwsCustomResource` and `cr.Provider` constructs create their own internal singleton Lambda functions that require explicit VPC configuration. The following resources have been updated with explicit VPC settings:

### Updated Files

1. **`lib/authentication/index.ts`**
   - `AwsCustomResource` for "UpdateSecret" (OIDC): Added `vpc` and `vpcSubnets`
   - Added VPC permissions to `lambdaRoleUpdateClient` and `lambdaRoleUpdateOidcSecret`

2. **`lib/aws-genai-llm-chatbot-stack.ts`**
   - `AwsCustomResource` for "UpdateUserPoolClientCustomResource": Added `vpc` and `vpcSubnets`

3. **`lib/user-interface/private-website.ts`**
   - `AwsCustomResource` for "describeVpcEndpoints": Added `vpc` and `vpcSubnets`
   - `AwsCustomResource` for "DescribeNetworkInterfaces": Added `vpc` and `vpcSubnets`

4. **`lib/sagemaker-model/hf-custom-script-model/index.ts`**
   - `cr.Provider` for HuggingFace model builds: Added `vpc` and `vpcSubnets`

### Why This Is Needed

- `AwsCustomResource` creates an internal singleton Lambda that makes AWS SDK calls
- When deployed in a VPC without NAT gateway, these Lambda functions need VPC endpoints for AWS service connectivity
- The CDK Aspect may not properly find and configure the roles for these singleton providers
- Explicit VPC configuration ensures the Lambda functions are created in the correct network context

### Cognito Federation Lambdas

The following Cognito federation-related Lambdas now have proper VPC configuration:

| Lambda | VPC Config Source | IAM VPC Permissions |
|--------|-------------------|---------------------|
| `updateUserPoolClientLambda` | Via Aspect | Explicit in role |
| `OIDCSecretsHandler` | Via Aspect | Explicit in role |
| `addFederatedUserToUserGroup` | Via Aspect | Explicit in role |
| `UpdateSecret` (AwsCustomResource) | Explicit | Via AwsCustomResource |
| `UpdateUserPoolClientCustomResource` | Explicit | Via AwsCustomResource |

## Next Steps

1. Update your `config.json` with VPC configuration
2. Run `cdk synth` to verify the changes
3. Run `cdk deploy` to deploy the updated stack
4. Verify Lambda functions are in VPC via AWS Console or CLI

## Support

For issues or questions, refer to:
- `docs/lambda-vpc-configuration.md` for detailed documentation
- AWS CDK documentation for Aspects: https://docs.aws.amazon.com/cdk/v2/guide/aspects.html
- AWS Lambda VPC configuration: https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html


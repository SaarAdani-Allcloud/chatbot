# Private Chatbot

Allows the deployment of a private chatbot via the 'npm run config' CLI setup.

- VPC only accessible website with an Application Load Balancer in front of an S3 hosted website.
- Private Appsync APIs and Web Sockets 
- VPC endpoints for AWS services
- Utilises a AWS Private CA certifice
- Utilises a Amazon Route 53 Private Hosted Zone and Domain


### Prerequisites: Private Chatbot Deployment  
1. [AWS Private CA issued ACM certificate](https://docs.aws.amazon.com/acm/latest/userguide/gs-acm-request-private.html) for your chosen domain. (i.e. chatbot.example.org)
2. A Route 53 [Private Hosted Zone](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/hosted-zones-private.html) (i.e. for example.org)

### During 'npm run config'
```shellsession
$ ✔ Do you want to deploy a private website? I.e only accessible in VPC (Y/n) · 
true
$ ✔ ACM certificate ARN · 
arn:aws:acm:us-east-1:1234567890:certificate/12345678-1234-1234-1234-12345678
$ ✔ Domain for private website · 
chatbot.example.org
$ ✔ Do you want to provide S3 VPC endpoint IP addresses manually? (Otherwise they will be auto-discovered) (y/N) ·
false
```

### S3 VPC Endpoint Configuration

The private website uses an Application Load Balancer (ALB) that targets the S3 VPC interface endpoint IP addresses. There are two configuration modes:

#### Option 1: Auto-Discovery (Default)
By default, the solution will automatically discover both the S3 VPC interface endpoint IPs and endpoint ID from your VPC. This works when:
- The S3 VPC interface endpoint exists in the same VPC where you're deploying
- The `createVpcEndpoints` option is enabled (creates the endpoint automatically)
- No manual configuration is provided

#### Option 2: Manual Configuration (Required for Cross-Account)
You can manually provide both S3 VPC endpoint IP addresses **AND** the endpoint ID. **Both must be provided together**. This is required when:
- You're using S3 VPC endpoints from a different account
- You want to use specific endpoint IPs across availability zones
- The endpoint is not auto-discoverable from the deployment account

**Important:** If you provide `s3VpcEndpointIps`, you **must** also provide `s3VpcEndpointId`. Both parameters are required together.

To manually configure S3 VPC endpoint:

1. **During `npm run config`**: Answer "yes" when prompted to provide S3 VPC endpoint IP addresses manually
2. **Enter the IPs**: Provide comma-separated IP addresses, one for each availability zone
   ```
   10.0.1.5, 10.0.2.5, 10.0.3.5
   ```
3. **Enter the VPC Endpoint ID**: Provide the VPC endpoint ID (required)
   ```
   vpce-0123456789abcdef0
   ```

Or directly in your `config.json`:
```json
{
  "vpc": {
    "vpcId": "vpc-12345678",
    "subnetIds": ["subnet-12345678", "subnet-87654321"],
    "createVpcEndpoints": false,
    "s3VpcEndpointIps": ["10.0.1.5", "10.0.2.5", "10.0.3.5"],
    "s3VpcEndpointId": "vpce-0123456789abcdef0"
  },
  "privateWebsite": true
}
```

**How to find S3 VPC endpoint IPs and ID:**

1. **Using AWS Console:**
   - Go to the VPC console → Endpoints
   - Find your S3 interface endpoint (type: Interface, service: com.amazonaws.region.s3)
   - Copy the **VPC endpoint ID** from the details (e.g., vpce-0123456789abcdef0)
   - Under "Subnets", note the Network Interface ID for each subnet
   - Click each Network Interface ID to view its private IP address

2. **Using AWS CLI:**
```bash
# Get the VPC endpoint ID and network interface IDs
aws ec2 describe-vpc-endpoints \
  --filters "Name=service-name,Values=com.amazonaws.REGION.s3" \
            "Name=vpc-id,Values=vpc-xxxxx" \
  --query 'VpcEndpoints[0].[VpcEndpointId,NetworkInterfaceIds]'

# Get the ENI IPs (run for each ENI)
aws ec2 describe-network-interfaces \
  --network-interface-ids eni-xxxxx \
  --query 'NetworkInterfaces[0].PrivateIpAddress'
```

3. **For Cross-Account Scenarios:**
   - If the S3 VPC endpoint is in a different AWS account, you'll need to obtain **both** the endpoint ID and IP addresses from that account
   - Ensure proper VPC peering or Transit Gateway configuration is in place
   - Both `s3VpcEndpointIps` **and** `s3VpcEndpointId` must be provided in your configuration

### After Private Deployment: 
1. In Route 53 [link the created VPC to the Private Hosted Zone (PHZ)](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/hosted-zone-private-associate-vpcs.html)
2. In the PHZ, [add an "A Record"](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-elb-load-balancer.html) with your chosen subdomain (i.e. chatbot.example.org) that points to the website Application Load Balancer Alias.

### Limitations
Deploying a fully private chatbot requires extending the existing solution. Since the current setup uses **Cognito and AppSync**, both of which are publicly accessible, additional configuration is needed:  

- Authentication must be extended to integrate with your **private IdP**.  
- AppSync access must be configured using **AWS PrivateLink** for private connectivity.  

For more details, refer to these resources:  
- [AppSync Lambda Authorization](https://aws.amazon.com/blogs/mobile/appsync-lambda-auth/)  
- [Using Private APIs with AppSync](https://docs.aws.amazon.com/appsync/latest/devguide/using-private-apis.html)  

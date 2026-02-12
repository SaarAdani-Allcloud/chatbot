const {
  CognitoIdentityProviderClient,
  UpdateUserPoolClientCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
//https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/cognito-identity-provider/command/UpdateUserPoolClientCommand/
exports.handler = async (event) => {
  const details = event;
  const client = new CognitoIdentityProviderClient({
    region: process.env.AWS_REGION,
  });

  // Always include the custom provider if a name is provided
  // This works for all provider types: SAML, OIDC, and "later" (pre-existing providers)
  const providers = details.oAuthV.customProviderName
    ? ["COGNITO", details.oAuthV.customProviderName]
    : ["COGNITO"];

  console.log("Provider type:", details.oAuthV.customProviderType);
  console.log("Provider name:", details.oAuthV.customProviderName);
  console.log("Supported identity providers:", providers);

  const params = {
    UserPoolId: process.env.USER_POOL_ID,
    ClientId: process.env.USER_POOL_CLIENT_ID,
    CallbackURLs: details.oAuthV.callbackUrls,
    LogoutURLs: details.oAuthV.logoutUrls,
    AllowedOAuthFlowsUserPoolClient: true,
    AllowedOAuthFlows: ["code"],
    SupportedIdentityProviders: providers,
    AllowedOAuthScopes: details.oAuthV.scopes,
  };

  console.log(params);

  const command = new UpdateUserPoolClientCommand(params);

  try {
    const response = await client.send(command);
    console.log(response);
    return { statusCode: 200, body: "UserPoolClient updated successfully" };
  } catch (error) {
    console.error(error);
    throw new Error("Failed to update UserPoolClient");
  }
};

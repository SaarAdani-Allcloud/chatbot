import {
  Alert,
  Box,
  Container,
  Header,
  Link,
  SpaceBetween,
} from "@cloudscape-design/components";
import BaseAppLayout from "../components/base-app-layout";

export default function NoDefaultApplication() {
  return (
    <BaseAppLayout
      content={
        <Container
          header={
            <Header variant="h1">Welcome to the Chatbot</Header>
          }
        >
          <SpaceBetween size="l">
            <Alert type="info" header="Application Access Required">
              To use the chatbot, you need to access a specific application.
            </Alert>
            
            <Box>
              <SpaceBetween size="s">
                <Box variant="h3">How to Access the Chatbot:</Box>
                <Box>
                  Your administrator should have provided you with a direct link
                  to a chatbot application. The link will look like:
                </Box>
                <Box variant="code">
                  https://chatbot.saar-internal.com/application/[APPLICATION-ID]
                </Box>
                <Box margin={{ top: "l" }}>
                  If you haven't received an application link, please contact
                  your system administrator.
                </Box>
              </SpaceBetween>
            </Box>

            <Box variant="small" color="text-status-inactive">
              <SpaceBetween size="xs">
                <Box fontWeight="bold">For Administrators:</Box>
                <Box>
                  To set up a default application for users, you can update
                  their Cognito profile using the AWS CLI. Refer to the{" "}
                  <Link
                    external
                    href="https://github.com/aws-samples/aws-genai-llm-chatbot"
                  >
                    documentation
                  </Link>{" "}
                  for more details.
                </Box>
              </SpaceBetween>
            </Box>
          </SpaceBetween>
        </Container>
      }
    />
  );
}


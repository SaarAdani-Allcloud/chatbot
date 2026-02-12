import * as path from "path";

export function resolveConfigFile(): string {
  // check if chatbot config env exists if it does use that
  if (process.env["CHATBOT_CONFIG"]) {
    return process.env["CHATBOT_CONFIG"];
  }
  // Use path.resolve to get absolute path
  // Handle both source (cli/) and compiled (dist/cli/) execution
  let projectRoot = path.resolve(__dirname, "..");
  
  // If running from dist/, go up one more level to get the actual project root
  // and then point to the source bin/config.json
  if (__dirname.includes(path.sep + "dist" + path.sep)) {
    projectRoot = path.resolve(__dirname, "../..");
  }
  
  return path.resolve(projectRoot, "bin/config.json");
}

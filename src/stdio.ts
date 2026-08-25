#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllTools } from "./tools/index";
import { SERVER_INSTRUCTIONS } from "./tools/prompts";

async function main() {
  const server = new McpServer(
    { name: "Bolna", version: "0.1.0" },
    { instructions: SERVER_INSTRUCTIONS }
  );
  registerAllTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();

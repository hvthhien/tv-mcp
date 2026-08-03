#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

const configFlag = process.argv.indexOf("--config");
const configPath = configFlag !== -1 ? process.argv[configFlag + 1] : undefined;

const server = buildServer(loadConfig(configPath));
await server.connect(new StdioServerTransport());

// stdio transport: never write to stdout outside the protocol.
console.error("tv-mcp ready (stdio)");

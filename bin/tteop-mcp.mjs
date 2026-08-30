#!/usr/bin/env node
/**
 * bin/tteop-mcp.mjs — TTEOP MCP Server entry point.
 *
 * Starts the TTEOP MCP server on stdio using the official MCP SDK.
 * The server exposes four tools for building, validating, describing,
 * and conforming TTEOP telemetry envelopes.
 *
 * Usage:
 *   npx tteop-mcp                    # start MCP server on stdio
 *   npx tteop-mcp --version          # print version
 *   npx tteop-mcp --help             # show help
 *
 * License: Apache-2.0
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { server } from "../src/server.mjs";

const VERSION = "tteop-mcp/0.1.0";

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  console.log(VERSION);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`TTEOP MCP Server — Token Telemetry Evaluation Operator Protocol

Usage:
  npx tteop-mcp              Start MCP server on stdio
  npx tteop-mcp --version    Show version
  npx tteop-mcp --help       Show this help

Tools:
  tteop_build_envelope       Build a TTEOP telemetry envelope from token counts
  tteop_validate_envelope    Validate an envelope against schema + semantics
  tteop_describe_protocol    Get TTEOP protocol metadata and metric definitions
  tteop_run_conformance      Run the conformance suite

Protocol: ${"tteop/0.1-draft"}
License: Apache-2.0
`);
  process.exit(0);
}

// ─── Start the MCP server on stdio ──────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // The server is now running and listening for JSON-RPC messages on stdin/stdout.
  // Do NOT log to stdout — that would corrupt the MCP protocol stream.
}

main().catch((err) => {
  console.error("Fatal error starting tteop-mcp:", err);
  process.exit(1);
});

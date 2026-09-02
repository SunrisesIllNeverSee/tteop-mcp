#!/usr/bin/env node
/**
 * bin/tteop-mcp.mjs — TTEOP MCP Server entry point.
 *
 * Starts the TTEOP MCP server on stdio using the official MCP SDK v2
 * high-level API (serveStdio). The server exposes four tools for building,
 * validating, describing, and conforming TTEOP telemetry envelopes.
 *
 * Usage:
 *   npx tteop-mcp                    # start MCP server on stdio (waits for client)
 *   npx tteop-mcp --version          # print version
 *   npx tteop-mcp --help             # show help
 *
 * License: Apache-2.0
 */

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { readFileSync } from "node:fs";
import { createServer } from "../src/server.mjs";

function pkgVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
    );
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const VERSION = `tteop-mcp/${pkgVersion()}`;

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  console.log(VERSION);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`TTEOP MCP Server — Token Telemetry Evaluation Operator Protocol

Usage:
  npx tteop-mcp              Start MCP server on stdio (waits for client connection)
  npx tteop-mcp --version    Show version
  npx tteop-mcp --help       Show this help

Tools:
  tteop_build_envelope       Build a TTEOP telemetry envelope from token counts
  tteop_validate_envelope    Validate an envelope against schema + semantics
  tteop_describe_protocol    Get TTEOP protocol metadata and metric definitions
  tteop_run_conformance      Run the conformance suite

Protocol: tteop/0.1-draft
License: Apache-2.0
`);
  process.exit(0);
}

// ─── Start the MCP server on stdio ──────────────────────────────────────────
//
// serveStdio owns the stdio transport: it reads JSON-RPC requests on stdin,
// writes responses to stdout, and calls createServer to build the instance
// that serves the connection. stdout is the protocol channel — do NOT log
// to stdout (that would corrupt the JSON-RPC stream). Log to stderr only.

// Prevent silent crashes — log to stderr (MCP clients read stdout; stderr is
// safe for diagnostics). Exit so the client can respawn with a clean slate.
process.on("uncaughtException", (err) => {
  process.stderr.write(`[tteop-mcp] uncaughtException: ${err?.stack || err}\n`);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  process.stderr.write(`[tteop-mcp] unhandledRejection: ${reason?.stack || reason}\n`);
  process.exit(1);
});

serveStdio(createServer);
process.stderr.write("tteop-mcp server running on stdio\n");

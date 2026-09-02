#!/usr/bin/env node
/**
 * test/test-mcp-client.mjs — Real MCP client test against the tteop-mcp server.
 *
 * Spawns the server as a child process, performs the full MCP handshake
 * (initialize → notifications/initialized → tools/list → tools/call), and
 * verifies every acceptance criterion from the build directive:
 *
 *   1. `npx tteop-mcp` waits for an MCP connection (server starts, doesn't exit)
 *   2. `initialize` succeeds (returns serverInfo + protocolVersion + capabilities)
 *   3. `tools/list` returns complete schemas (4 tools, each with inputSchema)
 *   4. Every tool can be called through MCP Inspector (we call each tool)
 *   5. Invalid token values return structured MCP errors (zod validation)
 *   6. stdout contains protocol messages only (no stray logs)
 *   7. CI runs an actual MCP client against the packaged tarball (this test)
 *
 * License: Apache-2.0
 */

import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_BIN = join(__dirname, "..", "bin", "tteop-mcp.mjs");

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
}

// ─── MCP client over stdio ──────────────────────────────────────────────────

class McpClient {
  constructor(serverPath) {
    this.serverPath = serverPath;
    this.proc = null;
    this.buffer = "";
    this.pending = new Map();
    this.nextId = 1;
    this.stdoutChunks = [];
  }

  start() {
    return new Promise((resolve, reject) => {
      this.proc = spawn("node", [this.serverPath], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.proc.stdout.on("data", (data) => {
        this.stdoutChunks.push(data);
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.proc.stderr.on("data", (data) => {
        // stderr is for diagnostics — not protocol. We capture it but don't fail.
        process.stderr.write(`[server stderr] ${data}`);
      });

      this.proc.on("error", reject);
      this.proc.on("exit", (code) => {
        if (this.pending.size > 0) {
          for (const [, { reject }] of this.pending) {
            reject(new Error(`Server exited with code ${code} while requests pending`));
          }
        }
      });

      // Give the server a moment to start
      setTimeout(resolve, 500);
    });
  }

  processBuffer() {
    // MCP messages are newline-delimited JSON-RPC
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop(); // keep incomplete line
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) {
            reject(msg.error);
          } else {
            resolve(msg.result);
          }
        }
      } catch (e) {
        // Not a valid JSON-RPC message — could be stray stdout
      }
    }
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const msg = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify(msg) + "\n");
    });
  }

  notify(method, params = {}) {
    const msg = { jsonrpc: "2.0", method, params };
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  stop() {
    if (this.proc) {
      this.proc.kill("SIGTERM");
      this.proc = null;
    }
  }

  getRawStdout() {
    return Buffer.concat(this.stdoutChunks).toString();
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== TTEOP MCP Server — Real MCP Client Test ===\n");

  const client = new McpClient(SERVER_BIN);

  // 1. Server starts and waits for connection
  console.log("1. Server startup");
  await client.start();
  assert(client.proc && !client.proc.killed, "Server starts and waits for MCP connection");

  try {
    // 2. initialize handshake
    console.log("\n2. Initialize handshake");
    const initResult = await client.send("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });
    assert(initResult.serverInfo?.name === "tteop-mcp", "serverInfo.name is tteop-mcp");
    assert(typeof initResult.serverInfo?.version === "string", "serverInfo.version is a string");
    assert(initResult.protocolVersion === "2025-06-18", "protocolVersion matches");
    assert(initResult.capabilities?.tools !== undefined, "tools capability advertised");

    // Send initialized notification
    client.notify("notifications/initialized");

    // 3. tools/list returns complete schemas
    console.log("\n3. tools/list");
    const toolsList = await client.send("tools/list", {});
    const tools = toolsList.tools;
    assert(Array.isArray(tools), "tools is an array");
    assert(tools.length === 4, `4 tools returned (got ${tools?.length})`);

    const toolNames = tools.map((t) => t.name);
    assert(toolNames.includes("tteop_build_envelope"), "tteop_build_envelope present");
    assert(toolNames.includes("tteop_validate_envelope"), "tteop_validate_envelope present");
    assert(toolNames.includes("tteop_describe_protocol"), "tteop_describe_protocol present");
    assert(toolNames.includes("tteop_run_conformance"), "tteop_run_conformance present");

    for (const tool of tools) {
      assert(typeof tool.name === "string", `${tool.name}: has name`);
      assert(typeof tool.description === "string", `${tool.name}: has description`);
      assert(tool.inputSchema && typeof tool.inputSchema === "object", `${tool.name}: has inputSchema`);
    }

    // 4. tteop_build_envelope — valid call
    console.log("\n4. tteop_build_envelope (valid)");
    const buildResult = await client.send("tools/call", {
      name: "tteop_build_envelope",
      arguments: {
        input: 1251211,
        output: 11296121,
        cache_write: 128196310,
        cache_read: 2555179769,
        tool: "claude-code",
        provider: "anthropic",
        model: "claude-sonnet-4",
      },
    });
    assert(buildResult.content?.length > 0, "build_envelope returns content");
    const builtEnvelope = JSON.parse(buildResult.content[0].text);
    assert(builtEnvelope.protocol_version === "tteop/0.1-draft", "built envelope has correct protocol_version");
    assert(builtEnvelope.metrics.yield === 18436.98, "built envelope yield matches canonical (18436.98)");
    assert(builtEnvelope.metrics.leverage === 2042.2, "built envelope leverage matches canonical (2042.2)");
    assert(builtEnvelope.metrics.velocity === 9.028, "built envelope velocity matches canonical (9.028)");
    assert(builtEnvelope.metrics.output_fraction === 0.9003, "built envelope output_fraction matches (0.9003)");
    assert(builtEnvelope.metrics.log_leverage === 3.31, "built envelope log_leverage matches (3.31)");

    // 5. tteop_build_envelope — invalid (negative input → zod rejects)
    // The SDK validates args against the zod schema before the handler runs.
    // Invalid args return a successful JSON-RPC response with isError: true
    // and a descriptive validation message — this is the correct MCP behavior
    // for tool execution failures (vs protocol-level errors).
    console.log("\n5. tteop_build_envelope (invalid — negative input)");
    {
      const result = await client.send("tools/call", {
        name: "tteop_build_envelope",
        arguments: { input: -1, output: 50 },
      });
      assert(result.isError === true, "negative input returns isError: true");
      assert(result.content?.[0]?.text?.includes("validation") || result.content?.[0]?.text?.includes(">=0") || result.content?.[0]?.text?.includes("Too small"),
        "negative input error message describes the validation failure");
    }

    // 6. tteop_build_envelope — invalid (non-integer → zod rejects)
    console.log("\n6. tteop_build_envelope (invalid — non-integer)");
    {
      const result = await client.send("tools/call", {
        name: "tteop_build_envelope",
        arguments: { input: 1.5, output: 50 },
      });
      assert(result.isError === true, "non-integer input returns isError: true");
      assert(result.content?.[0]?.text?.length > 0, "non-integer input error has message");
    }

    // 7. tteop_build_envelope — invalid (oversized → zod rejects)
    console.log("\n7. tteop_build_envelope (invalid — oversized)");
    {
      const result = await client.send("tools/call", {
        name: "tteop_build_envelope",
        arguments: { input: 9007199254740992, output: 50 },
      });
      assert(result.isError === true, "oversized input returns isError: true");
      assert(result.content?.[0]?.text?.length > 0, "oversized input error has message");
    }

    // 8. tteop_build_envelope — invalid (missing required field → zod rejects)
    console.log("\n8. tteop_build_envelope (invalid — missing output)");
    {
      const result = await client.send("tools/call", {
        name: "tteop_build_envelope",
        arguments: { input: 100 },
      });
      assert(result.isError === true, "missing output returns isError: true");
      assert(result.content?.[0]?.text?.length > 0, "missing output error has message");
    }

    // 9. tteop_build_envelope — invalid privacy mode rejected by the MCP schema
    console.log("\n9. tteop_build_envelope (invalid — privacy mode)");
    {
      const result = await client.send("tools/call", {
        name: "tteop_build_envelope",
        arguments: { input: 100, output: 50, privacy_mode: "public" },
      });
      assert(result.isError === true, "unknown privacy mode returns isError: true");
      assert(result.content?.[0]?.text?.length > 0, "privacy-mode error has message");
    }

    // 10. tteop_build_envelope — invalid provenance level rejected by schema
    console.log("\n10. tteop_build_envelope (invalid — provenance level)");
    {
      const result = await client.send("tools/call", {
        name: "tteop_build_envelope",
        arguments: { input: 100, output: 50, provenance_level: "verified" },
      });
      assert(result.isError === true, "unknown provenance level returns isError: true");
      assert(result.content?.[0]?.text?.length > 0, "provenance-level error has message");
    }

    // 11. The canonical enum includes signed, but the builder rejects it until
    // a complete signature object exists (SRP-SIG-001).
    console.log("\n11. tteop_build_envelope (signed requires signature object)");
    {
      const result = await client.send("tools/call", {
        name: "tteop_build_envelope",
        arguments: { input: 100, output: 50, provenance_level: "signed" },
      });
      assert(result.isError === true, "signed provenance without signature object returns isError: true");
      assert(result.content?.[0]?.text?.length > 0, "signed-provenance error has message");
    }

    // 12. tteop_validate_envelope — valid envelope
    console.log("\n12. tteop_validate_envelope (valid)");
    const validateResult = await client.send("tools/call", {
      name: "tteop_validate_envelope",
      arguments: { envelope: builtEnvelope },
    });
    const validationResult = JSON.parse(validateResult.content[0].text);
    assert(validationResult.valid === true, "valid envelope passes validation");

    // 13. tteop_validate_envelope — invalid envelope (forbidden field)
    console.log("\n13. tteop_validate_envelope (invalid — forbidden field)");
    const badEnvelope = { ...builtEnvelope, prompt: "should be rejected" };
    const badValidateResult = await client.send("tools/call", {
      name: "tteop_validate_envelope",
      arguments: { envelope: badEnvelope },
    });
    const badValidation = JSON.parse(badValidateResult.content[0].text);
    assert(badValidation.valid === false, "envelope with forbidden field is invalid");
    assert(
      badValidation.semanticErrors?.some((e) => e.includes("forbidden")),
      "semantic errors mention forbidden field",
    );

    // 14. tteop_describe_protocol
    console.log("\n14. tteop_describe_protocol");
    const describeResult = await client.send("tools/call", {
      name: "tteop_describe_protocol",
      arguments: {},
    });
    const protocolInfo = JSON.parse(describeResult.content[0].text);
    assert(protocolInfo.protocol_name === "TTEOP", "protocol_name is TTEOP");
    assert(protocolInfo.spec_version === "tteop/0.1-draft", "spec_version is tteop/0.1-draft");
    assert(Array.isArray(protocolInfo.privacy_modes), "privacy_modes is an array");
    assert(protocolInfo.privacy_modes.length === 3, "3 privacy modes");
    assert(Array.isArray(protocolInfo.metrics), "metrics is an array");
    assert(protocolInfo.metrics.length === 5, "5 metrics defined");

    // 15. tteop_run_conformance
    console.log("\n15. tteop_run_conformance");
    const conformanceResult = await client.send("tools/call", {
      name: "tteop_run_conformance",
      arguments: {},
    });
    const conformance = JSON.parse(conformanceResult.content[0].text);
    assert(conformance.failed === 0, `conformance suite: 0 failures (got ${conformance.failed})`);
    assert(conformance.total > 0, `conformance suite: has tests (got ${conformance.total})`);

    // 16. stdout contains protocol messages only (no stray logs)
    console.log("\n16. stdout protocol-only check");
    const rawStdout = client.getRawStdout();
    const stdoutLines = rawStdout.split("\n").filter((l) => l.trim());
    let allValidJsonRpc = true;
    for (const line of stdoutLines) {
      try {
        const msg = JSON.parse(line);
        if (msg.jsonrpc !== "2.0") {
          allValidJsonRpc = false;
          break;
        }
      } catch {
        allValidJsonRpc = false;
        break;
      }
    }
    assert(allValidJsonRpc, "stdout contains only JSON-RPC 2.0 messages (no stray logs)");

  } finally {
    client.stop();
  }

  // Summary
  console.log(`\n=== Summary ===\n`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  ${f}`);
  }
  console.log(
    failed === 0
      ? "\nALL MCP CLIENT TESTS PASS"
      : `\n${failed} TEST(S) FAILED`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});

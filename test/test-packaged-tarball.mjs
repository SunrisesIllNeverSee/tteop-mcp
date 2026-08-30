#!/usr/bin/env node
/**
 * test/test-packaged-tarball.mjs — Test the npm-packaged tarball.
 *
 * Packs the package with `npm pack`, extracts it to a temp directory, installs
 * its production dependencies (with tteop-spec linked locally for dev), and
 * runs a real MCP handshake against the packaged bin — proving the published
 * artifact works, not just the source tree.
 *
 * License: Apache-2.0
 */

import { execSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
  }
}

// ─── MCP client over stdio (minimal, same pattern as test-mcp-client.mjs) ───

function testMcpHandshake(serverPath) {
  return new Promise((resolve) => {
    const result = {
      initialized: false,
      toolsCount: 0,
      buildWorks: false,
      stdoutClean: false,
    };

    const proc = spawn("node", [serverPath], { stdio: ["pipe", "pipe", "pipe"] });
    let stdoutBuffer = "";
    let buffer = "";
    const pending = new Map();
    let nextId = 1;

    proc.stdout.on("data", (data) => {
      stdoutBuffer += data.toString();
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && pending.has(msg.id)) {
            const { resolve: resolvePending } = pending.get(msg.id);
            pending.delete(msg.id);
            resolvePending(msg);
          }
        } catch {}
      }
    });

    function send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolvePending) => {
        pending.set(id, { resolve: resolvePending });
        proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    }

    function notify(method, params = {}) {
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    }

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve(result);
    }, 10000);

    (async () => {
      // initialize
      const initResp = await send("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "tarball-test", version: "1.0.0" },
      });
      result.initialized = initResp?.result?.serverInfo?.name === "tteop-mcp";
      notify("notifications/initialized");

      // tools/list
      const toolsResp = await send("tools/list", {});
      result.toolsCount = toolsResp?.result?.tools?.length || 0;

      // tools/call — build_envelope
      const buildResp = await send("tools/call", {
        name: "tteop_build_envelope",
        arguments: { input: 100, output: 50, cache_write: 10, cache_read: 20 },
      });
      const envelope = JSON.parse(buildResp?.result?.content?.[0]?.text || "{}");
      result.buildWorks = envelope.protocol_version === "tteop/0.1-draft";

      // Check stdout is clean (only JSON-RPC messages)
      const lines = stdoutBuffer.split("\n").filter((l) => l.trim());
      result.stdoutClean = lines.every((l) => {
        try {
          return JSON.parse(l).jsonrpc === "2.0";
        } catch {
          return false;
        }
      });

      clearTimeout(timeout);
      proc.kill("SIGTERM");
      resolve(result);
    })();
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== TTEOP MCP Server — Packaged Tarball Test ===\n");

  // 1. npm pack
  console.log("1. npm pack");
  const tmpDir = mkdtempSync(join(tmpdir(), "tteop-mcp-pack-"));
  const tarballName = execSync("npm pack --silent", { cwd: ROOT, encoding: "utf8" }).trim();
  const tarballPath = join(ROOT, tarballName);
  assert(existsSync(tarballPath), `tarball created: ${tarballName}`);

  try {
    // 2. Extract tarball
    console.log("\n2. Extract tarball");
    execSync(`tar -xzf "${tarballPath}"`, { cwd: tmpDir });
    const pkgJson = JSON.parse(readFileSync(join(tmpDir, "package", "package.json"), "utf8"));
    assert(pkgJson.name === "tteop-mcp", "packaged package.json name is tteop-mcp");
    assert(pkgJson.bin?.["tteop-mcp"] === "bin/tteop-mcp.mjs", "packaged bin entry correct");
    assert(existsSync(join(tmpDir, "package", "bin", "tteop-mcp.mjs")), "packaged bin/tteop-mcp.mjs exists");
    assert(existsSync(join(tmpDir, "package", "src", "server.mjs")), "packaged src/server.mjs exists");
    assert(!existsSync(join(tmpDir, "package", "test")), "test/ directory NOT included in tarball (correct)");

    // 3. Install production deps in the extracted package
    // Try npm install first (works when tteop-spec is published). If that fails
    // (dev environment where tteop-spec isn't published yet), fall back to
    // removing tteop-spec from package.json and linking it locally.
    console.log("\n3. Install production dependencies");
    const extractedPkgPath = join(tmpDir, "package", "package.json");
    let tteopSpecInstalled = false;
    try {
      execSync("npm install --silent", { cwd: join(tmpDir, "package"), stdio: "pipe" });
      tteopSpecInstalled = existsSync(join(tmpDir, "package", "node_modules", "tteop-spec"));
    } catch {
      // Fall back: remove tteop-spec, install other deps, link locally
      const extractedPkg = JSON.parse(readFileSync(extractedPkgPath, "utf8"));
      delete extractedPkg.dependencies["tteop-spec"];
      writeFileSync(extractedPkgPath, JSON.stringify(extractedPkg, null, 2));
      execSync("npm install --silent", { cwd: join(tmpDir, "package"), stdio: "pipe" });
      execSync("npm link tteop-spec --silent", { cwd: join(tmpDir, "package"), stdio: "pipe" });
      tteopSpecInstalled = existsSync(join(tmpDir, "package", "node_modules", "tteop-spec"));
    }
    assert(existsSync(join(tmpDir, "package", "node_modules", "@modelcontextprotocol", "server")), "MCP server SDK installed");
    assert(existsSync(join(tmpDir, "package", "node_modules", "zod")), "zod installed");
    assert(tteopSpecInstalled, "tteop-spec installed/linked");

    // 4. Test the packaged bin with a real MCP handshake
    console.log("\n4. MCP handshake against packaged bin");
    const packagedBin = join(tmpDir, "package", "bin", "tteop-mcp.mjs");
    const handshakeResult = await testMcpHandshake(packagedBin);
    assert(handshakeResult.initialized, "initialize succeeds against packaged bin");
    assert(handshakeResult.toolsCount === 4, `tools/list returns 4 tools (got ${handshakeResult.toolsCount})`);
    assert(handshakeResult.buildWorks, "tteop_build_envelope works against packaged bin");
    assert(handshakeResult.stdoutClean, "stdout contains only JSON-RPC messages");

  } finally {
    rmSync(tarballPath, { force: true });
    rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`\n=== Summary ===\n`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(failed === 0 ? "\nALL PACKAGED TARBALL TESTS PASS" : `\n${failed} TEST(S) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});

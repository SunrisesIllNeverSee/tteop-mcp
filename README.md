# tteop-mcp

Production MCP server for **TTEOP** — Token Telemetry Evaluation Operator Protocol.

Build, validate, and describe TTEOP telemetry envelopes via the Model Context Protocol. Powered by the official [MCP TypeScript SDK v2](https://github.com/modelcontextprotocol/typescript-sdk) and the [`tteop-spec`](https://github.com/SunrisesIllNeverSee/otep-spec) reference implementation.

New here? Read [START-HERE.md](START-HERE.md). Automated contributors must also read [AGENTS.md](AGENTS.md).

## Architecture

This package is a thin MCP transport layer. All protocol logic — envelope construction, metric computation (banker's rounding), schema validation, and semantic rules — is delegated to `tteop-spec` via its stable JavaScript API:

- `tteop-spec/builder` → `buildEnvelope(telemetry, options)`
- `tteop-spec/validator` → `validateEnvelope(envelope, options)`, `computeMetrics(telemetry)`

No metric formulas or schema logic are duplicated here. When `tteop-spec` updates its validator or builder, this server inherits the changes.

### Product separation

| Package | Role |
|---------|------|
| `tteop-spec` | Specification, schemas, validator, conformance suite, builder API |
| `tteop-mcp` | Production MCP server (this package) — thin transport over `tteop-spec` |
| SignalAF / SigRank | Hosted benchmarking, leaderboard, pilots, enterprise services |

## Install

```bash
npm install -g tteop-mcp
# or use directly:
npx tteop-mcp
```

## Tools

| Tool | Description |
|------|-------------|
| `tteop_build_envelope` | Build a TTEOP v0.1-draft schema-conforming envelope from token counts. Computes Yield (Υ), Leverage (L), Velocity (V), output_fraction (F), and log_leverage (D). |
| `tteop_validate_envelope` | Validate an envelope against the JSON Schema and semantic rules. Returns schema errors, semantic errors, warnings, and computed metrics. |
| `tteop_describe_protocol` | Get TTEOP protocol metadata: versions, privacy modes, provenance levels, forbidden fields, metric definitions with formulas. |
| `tteop_run_conformance` | Run the conformance suite: canonical vector invariants, null semantics, forbidden field detection, banker's rounding. |

## Usage

### With Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tteop": {
      "command": "npx",
      "args": ["-y", "tteop-mcp"]
    }
  }
}
```

### With MCP Inspector

```bash
npx @modelcontextprotocol/inspector npx -y tteop-mcp
```

Open the browser tab, click **Connect**, open the **Tools** tab, and call any tool.

### Programmatic

```javascript
import { spawn } from "node:child_process";

const proc = spawn("npx", ["-y", "tteop-mcp"], { stdio: ["pipe", "pipe", "pipe"] });
// Send JSON-RPC 2.0 messages to proc.stdin, read responses from proc.stdout
```

## Development

```bash
# Install the exact locked dependency graph
npm ci

# Link tteop-spec locally (if not published to npm yet)
cd ../otep-spec && npm link && cd ../tteop-mcp && npm link tteop-spec

# Run tests
npm test                    # real MCP client test
npm run test:packaged       # packaged tarball test
npm run test:release        # package/lockfile/registry version agreement
npm run test:all            # complete local release gate

# Run with MCP Inspector
npm run inspect

# Start the server
npm start
```

## Acceptance criteria

- [x] `npx tteop-mcp` waits for an MCP connection
- [x] `initialize` succeeds
- [x] `tools/list` returns complete schemas (4 tools)
- [x] Every tool can be called through MCP Inspector
- [x] Invalid token values return structured MCP errors (`isError: true` with validation message)
- [x] stdout contains protocol messages only
- [x] CI runs an actual MCP client against the packaged tarball

## Distribution status and release order

`tteop-mcp@0.2.0` is currently published to npm and listed in the MCP Registry and Glama. Release `0.2.1` repairs source/package provenance, upgrades the exact protocol dependency to `tteop-spec@0.1.5-draft`, and adds release hardening.

The required release order is:

1. Confirm `tteop-spec@0.1.5-draft` is available from npm.
2. Merge the `tteop-mcp@0.2.1` release commit with every required check green.
3. Run the manual **Release npm package** workflow. It publishes with npm provenance and creates GitHub release `v0.2.1` at the same commit.
4. Confirm `npm view tteop-mcp@0.2.1 gitHead` equals the GitHub release commit.
5. Publish the matching `server.json` to the MCP Registry:
   ```bash
   mcp-publisher login
   mcp-publisher publish
   ```
6. Confirm the MCP Registry and Glama show version `0.2.1` and all four tools.
7. From a clean directory, run `npx -y tteop-mcp@0.2.1 --version` and a real MCP client invocation.

Never publish from an uncommitted working tree. Package version, lockfile, `server.json`, Git tag, GitHub release, npm `gitHead`, and MCP Registry version must identify the same release.

## License

Apache-2.0

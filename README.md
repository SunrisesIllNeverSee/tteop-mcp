# tteop-mcp

Production MCP server for **TTEOP** — Token Telemetry Evaluation Operator Protocol.

Build, validate, and describe TTEOP telemetry envelopes via the Model Context Protocol. Powered by the official [MCP TypeScript SDK v2](https://github.com/modelcontextprotocol/typescript-sdk) and the [`tteop-spec`](https://github.com/SunrisesIllNeverSee/otep-spec) reference implementation.

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
# Install deps
npm install

# Link tteop-spec locally (if not published to npm yet)
cd ../otep-spec && npm link && cd ../tteop-mcp && npm link tteop-spec

# Run tests
npm test                    # real MCP client test (50 assertions)
npm run test:packaged       # packaged tarball test (13 assertions)

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

## Distribution roadmap

This package is built and tested but not yet published. The next steps require owner credentials:

1. **Publish `tteop-spec@0.1.4-draft`** to npm (prerequisite — this package pins it exactly).
2. **Publish `tteop-mcp@0.2.0`** to npm.
3. **Publish to the MCP Registry** using `mcp-publisher`:
   ```bash
   mcp-publisher init      # generates server.json (already present)
   mcp-publisher login     # GitHub auth
   mcp-publisher publish   # publishes server.json to the registry
   ```
   The `mcpName` in `package.json` (`io.github.SunrisesIllNeverSee/tteop-mcp`) must match the `name` in `server.json`.
4. **Submit to Glama** using the `glama.json` metadata.
5. **Test privately on Glama** — verify the live Inspector session passes.
6. **Switch the listing public** after the live Inspector session passes.

## License

Apache-2.0

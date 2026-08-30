# tteop-mcp

Production MCP server for **TTEOP** — Token Telemetry Evaluation Operator Protocol.

Build, validate, and describe TTEOP telemetry envelopes via the Model Context Protocol.

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
npx @modelcontextprotocol/inspector npx tteop-mcp
```

### Programmatic

```javascript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "tteop-mcp"],
});

const client = new Client({ name: "my-app", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);

// Build an envelope
const result = await client.callTool({
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
```

## Protocol

TTEOP is an open, vendor-neutral interoperability standard for measuring AI-operator token efficiency.

**Architecture:** `MOSES → Upsilon → SigRank | SignalAF`

**Metrics:**

| Metric | Symbol | Formula | Description |
|--------|--------|---------|-------------|
| Yield | Υ | `(cache_read × output) / input²` | Efficiency: output per input, boosted by cache reuse |
| Leverage | L | `cache_read / input` | Cache leverage: cached context reused per unit of fresh input |
| Velocity | V | `output / input` | Raw amplification: output per unit of input |
| output_fraction | F | `output / (input + output)` | Signal-to-noise: fraction of tokens that are productive output |
| log_leverage | D | `log10(cache_read / input)` | Log-scaled cache leverage for order-of-magnitude comparison |

All metrics use banker's rounding (round-half-to-even) per SRP-METRIC-002.

## Privacy

TTEOP is privacy-first and content-free. The envelope schema forbids prompt text, completions, source code, file paths, keystrokes, and screen content. Only token counts and metadata are collected.

## License

Apache-2.0

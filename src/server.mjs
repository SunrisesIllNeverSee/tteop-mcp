/**
 * src/server.mjs — TTEOP MCP Server using the official @modelcontextprotocol/sdk.
 *
 * Exposes four tools:
 *   - tteop_build_envelope     — build a TTEOP telemetry envelope
 *   - tteop_validate_envelope  — validate an envelope against schema + semantics
 *   - tteop_describe_protocol  — get TTEOP protocol metadata
 *   - tteop_run_conformance    — run the conformance suite
 *
 * License: Apache-2.0
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  buildEnvelope,
  validateEnvelope,
  describeProtocol,
  runConformance,
  SPEC_VERSION,
} from "./tteop-engine.mjs";

const SERVER_NAME = "tteop-mcp";
const SERVER_VERSION = "0.1.0";

// ─── Tool definitions ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "tteop_build_envelope",
    description:
      "Build a TTEOP v0.1-draft schema-conforming telemetry envelope from token counts. " +
      "Computes Yield (Υ), Leverage (L), Velocity (V), output_fraction (F), and log_leverage (D). " +
      "No data is submitted or persisted. Returns the complete envelope as JSON.",
    inputSchema: {
      type: "object",
      required: ["input", "output"],
      properties: {
        input: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
          description: "Fresh input tokens (non-negative integer, required).",
        },
        output: {
          type: "integer",
          minimum: 0,
          maximum: 9007199254740991,
          description: "Output tokens (non-negative integer, required).",
        },
        cache_write: {
          type: ["integer", "null"],
          minimum: 0,
          maximum: 9007199254740991,
          description: "Cache-write tokens, or null when unavailable.",
        },
        cache_read: {
          type: ["integer", "null"],
          minimum: 0,
          maximum: 9007199254740991,
          description: "Cache-read tokens, or null when unavailable.",
        },
        tool: {
          type: "string",
          description: "AI tool name (e.g., 'claude-code', 'cursor', 'copilot').",
        },
        provider: {
          type: "string",
          description: "Provider name (e.g., 'anthropic', 'openai', 'google').",
        },
        model: {
          type: "string",
          description: "Model identifier (e.g., 'claude-sonnet-4', 'gpt-4o').",
        },
        privacy_mode: {
          type: "string",
          enum: ["public-pseudonymous", "private-managed-cohort", "enterprise-isolated"],
          description: "Privacy mode. Default: public-pseudonymous.",
        },
        provenance_level: {
          type: "string",
          enum: ["self-reported", "collector-attested", "platform-verified", "signed"],
          description: "Provenance level. Default: self-reported.",
        },
        operator_key: {
          type: "string",
          description: "Pseudonymous operator identifier. Must not contain real-world identity.",
        },
        cohort_id: {
          type: "string",
          description: "Cohort identifier for private-managed-cohort mode. Requires operator_key.",
        },
      },
    },
  },
  {
    name: "tteop_validate_envelope",
    description:
      "Validate a TTEOP v0.1-draft telemetry envelope against the JSON Schema and semantic rules. " +
      "Returns validation status, schema errors, semantic errors, warnings, and computed metrics if valid.",
    inputSchema: {
      type: "object",
      required: ["envelope"],
      properties: {
        envelope: {
          type: "object",
          description: "The TTEOP telemetry envelope to validate (as a JSON object).",
        },
        expected_profile: {
          type: "string",
          enum: ["public-pseudonymous", "private-managed-cohort", "enterprise-isolated"],
          description: "If set, asserts the envelope's privacy mode matches this profile.",
        },
      },
    },
  },
  {
    name: "tteop_describe_protocol",
    description:
      "Get TTEOP protocol metadata: version, supported versions, privacy modes, " +
      "provenance levels, forbidden fields, metric definitions (formulas, symbols, rounding), " +
      "and schema/spec URLs.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "tteop_run_conformance",
    description:
      "Run the TTEOP conformance suite: canonical vector invariants, zero-input/zero-output null semantics, " +
      "missing-cache handling, build-validate round-trip, forbidden field detection, and banker's rounding. " +
      "Returns pass/fail counts and detailed results.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// ─── Server setup ───────────────────────────────────────────────────────────

const server = new Server(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ─── List tools handler ─────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// ─── Call tool handler ──────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "tteop_build_envelope": {
        const envelope = buildEnvelope(
          {
            input: args.input,
            output: args.output,
            cache_write: args.cache_write ?? null,
            cache_read: args.cache_read ?? null,
          },
          {
            tool: args.tool,
            provider: args.provider,
            model: args.model,
            privacy_mode: args.privacy_mode,
            provenance_level: args.provenance_level,
            operator_key: args.operator_key,
            cohort_id: args.cohort_id,
          }
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(envelope, null, 2),
            },
          ],
        };
      }

      case "tteop_validate_envelope": {
        const result = validateEnvelope(args.envelope, {
          expectedProfile: args.expected_profile,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "tteop_describe_protocol": {
        const info = describeProtocol();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(info, null, 2),
            },
          ],
        };
      }

      case "tteop_run_conformance": {
        const result = runConformance();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: true,
            message: err.message,
            tool: name,
          }),
        },
      ],
      isError: true,
    };
  }
});

// ─── Start server ───────────────────────────────────────────────────────────

export { server };

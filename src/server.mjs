/**
 * src/server.mjs — TTEOP MCP Server factory.
 *
 * Uses the official @modelcontextprotocol/server v2 high-level API.
 * Imports the canonical builder + validator from tteop-spec (single source of
 * truth — no duplicated metric formulas or schema logic).
 *
 * Exposes four tools:
 *   - tteop_build_envelope     — build a TTEOP telemetry envelope
 *   - tteop_validate_envelope  — validate an envelope against schema + semantics
 *   - tteop_describe_protocol  — get TTEOP protocol metadata
 *   - tteop_run_conformance    — run the conformance suite
 *
 * License: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { buildEnvelope } from "tteop-spec/builder";
import {
  validateEnvelope,
  computeMetrics,
  roundHalfToEven,
  SPEC_VERSION,
  METRIC_SPEC_VERSION,
  LEGACY_ALIASES,
  SUPPORTED_VERSIONS,
  FORBIDDEN_FIELDS,
  PRIVACY_MODES,
  PROVENANCE_LEVELS,
} from "tteop-spec/validator";

// ─── Constants ──────────────────────────────────────────────────────────────

const SERVER_NAME = "tteop-mcp";

function serverVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
    );
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// Token bounds mirror tteop-spec's builder validation (non-negative safe
// integer). Using Number.MAX_SAFE_INTEGER directly avoids hardcoding a
// magic number that could drift from the canonical builder.
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

// ─── Zod schemas ────────────────────────────────────────────────────────────

const tokenField = (desc) =>
  z.int().min(0).max(MAX_SAFE).describe(desc);

const tokenFieldNullish = (desc) =>
  z.int().min(0).max(MAX_SAFE).nullish().describe(desc);

const privacyModeEnum = z.enum(PRIVACY_MODES);
const provenanceLevelEnum = z.enum(PROVENANCE_LEVELS);

const buildEnvelopeSchema = z.object({
  input: tokenField("Fresh input tokens (non-negative integer, required)."),
  output: tokenField("Output tokens (non-negative integer, required)."),
  cache_write: tokenFieldNullish("Cache-write tokens, or null when unavailable."),
  cache_read: tokenFieldNullish("Cache-read tokens, or null when unavailable."),
  tool: z.string().optional().describe("AI tool name (e.g., 'claude-code', 'cursor', 'copilot')."),
  provider: z.string().optional().describe("Provider name (e.g., 'anthropic', 'openai', 'google')."),
  model: z.string().optional().describe("Model identifier (e.g., 'claude-sonnet-4', 'gpt-4o')."),
  privacy_mode: privacyModeEnum.optional().describe("Privacy mode. Default: public-pseudonymous."),
  provenance_level: provenanceLevelEnum.optional().describe("Provenance level. Default: self-reported."),
  operator_key: z.string().optional().describe("Pseudonymous operator identifier. Must not contain real-world identity."),
  cohort_id: z.string().optional().describe("Cohort identifier for private-managed-cohort mode. Requires operator_key."),
});

const validateEnvelopeSchema = z.object({
  envelope: z.record(z.unknown()).describe("The TTEOP telemetry envelope to validate (as a JSON object)."),
  expected_profile: privacyModeEnum.optional().describe("If set, asserts the envelope's privacy mode matches this profile."),
});

const describeProtocolSchema = z.object({});

const runConformanceSchema = z.object({});

// ─── Server factory ─────────────────────────────────────────────────────────

/**
 * Create the TTEOP MCP server. This factory is passed to serveStdio so each
 * connection gets a fresh server instance.
 *
 * @returns {McpServer}
 */
export function createServer() {
  const server = new McpServer({
    name: SERVER_NAME,
    version: serverVersion(),
  });

  // ── tteop_build_envelope ──────────────────────────────────────────────
  server.registerTool(
    "tteop_build_envelope",
    {
      description:
        "Build a TTEOP v0.1-draft schema-conforming telemetry envelope from token counts. " +
        "Computes Yield (Υ), Leverage (L), Velocity (V), output_fraction (F), and log_leverage (D). " +
        "No data is submitted or persisted. Returns the complete envelope as JSON.",
      inputSchema: buildEnvelopeSchema,
    },
    async (args) => {
      // The SDK validates args against the zod schema before this handler runs.
      // buildEnvelope does additional semantic validation (cohort_id requires
      // operator_key, etc.) and throws on violation — caught by the SDK and
      // surfaced as a structured MCP error.
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
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
      };
    },
  );

  // ── tteop_validate_envelope ───────────────────────────────────────────
  server.registerTool(
    "tteop_validate_envelope",
    {
      description:
        "Validate a TTEOP v0.1-draft telemetry envelope against the JSON Schema and semantic rules. " +
        "Returns validation status, schema errors, semantic errors, warnings, and computed metrics if valid.",
      inputSchema: validateEnvelopeSchema,
    },
    async (args) => {
      const result = validateEnvelope(args.envelope, {
        expectedProfile: args.expected_profile,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // ── tteop_describe_protocol ───────────────────────────────────────────
  server.registerTool(
    "tteop_describe_protocol",
    {
      description:
        "Get TTEOP protocol metadata: version, supported versions, privacy modes, " +
        "provenance levels, forbidden fields, metric definitions (formulas, symbols, rounding), " +
        "and schema/spec URLs.",
      inputSchema: describeProtocolSchema,
    },
    async () => {
      const info = describeProtocol();
      return {
        content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
      };
    },
  );

  // ── tteop_run_conformance ─────────────────────────────────────────────
  server.registerTool(
    "tteop_run_conformance",
    {
      description:
        "Run the TTEOP conformance suite: canonical vector invariants, zero-input/zero-output null semantics, " +
        "missing-cache handling, build-validate round-trip, forbidden field detection, and banker's rounding. " +
        "Returns pass/fail counts and detailed results.",
      inputSchema: runConformanceSchema,
    },
    async () => {
      const result = runConformance();
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  return server;
}

// ─── Protocol description (delegates to tteop-spec constants) ───────────────
// The formula strings below are human-readable descriptions of what
// tteop-spec's computeMetrics() calculates. They are NOT independent
// formula definitions — the executable semantics live in tteop-spec.
// The conformance suite (runConformance) verifies that computeMetrics
// produces the expected values, catching any drift between these
// descriptions and the canonical implementation.

function describeProtocol() {
  return {
    protocol_name: "TTEOP",
    full_name: "Token Telemetry Evaluation Operator Protocol",
    spec_version: SPEC_VERSION,
    metric_spec_version: METRIC_SPEC_VERSION,
    legacy_aliases: LEGACY_ALIASES,
    supported_versions: SUPPORTED_VERSIONS,
    privacy_modes: PRIVACY_MODES,
    provenance_levels: PROVENANCE_LEVELS,
    forbidden_fields: FORBIDDEN_FIELDS,
    metrics: [
      {
        name: "yield",
        symbol: "Υ",
        formula: "(cache_read × output) / input²",
        description: "Efficiency metric: how much output an operator produces per unit of input, boosted by cache reuse.",
        rounding: "banker's rounding, 2 decimals",
      },
      {
        name: "leverage",
        symbol: "L",
        formula: "cache_read / input",
        description: "Cache leverage: how much cached context an operator reuses per unit of fresh input.",
        rounding: "banker's rounding, 1 decimal",
      },
      {
        name: "velocity",
        symbol: "V",
        formula: "output / input",
        description: "Raw amplification: how much output an operator generates per unit of input.",
        rounding: "banker's rounding, 3 decimals",
      },
      {
        name: "output_fraction",
        symbol: "F",
        formula: "output / (input + output)",
        description: "Signal-to-noise: fraction of total tokens that are productive output.",
        rounding: "banker's rounding, 4 decimals",
      },
      {
        name: "log_leverage",
        symbol: "D",
        formula: "log10(cache_read / input)",
        description: "Log-scaled cache leverage for order-of-magnitude comparison.",
        rounding: "banker's rounding, 2 decimals",
      },
    ],
    schema_url: "https://github.com/SunrisesIllNeverSee/otep-spec/blob/main/schemas/telemetry-envelope-v0.1.schema.json",
    specification: "https://github.com/SunrisesIllNeverSee/otep-spec",
    npm_package: "tteop-spec",
    license: "Apache-2.0",
  };
}

// ─── Conformance suite (uses tteop-spec's canonical computeMetrics) ─────────

function runConformance() {
  const results = [];
  let passed = 0;
  let failed = 0;

  function record(test, description, isPass, expected, actual) {
    results.push({ test, description, passed: isPass, expected, actual });
    if (isPass) passed++; else failed++;
  }

  // Test 1: Canonical MOSES vector
  const canonical = {
    telemetry: { input: 1251211, output: 11296121, cache_write: 128196310, cache_read: 2555179769 },
    expected: { yield: 18436.98, leverage: 2042.2, velocity: 9.028, output_fraction: 0.9003, log_leverage: 3.31 },
  };
  const canonicalResult = computeMetrics(canonical.telemetry);
  const canonicalPass = JSON.stringify(canonicalResult.metrics) === JSON.stringify(canonical.expected);
  record("canonical-moses-vector", "MOSES canonical seed vector with frozen invariants",
    canonicalPass, canonical.expected, canonicalResult.metrics);

  // Test 2: Zero input
  const zeroInput = computeMetrics({ input: 0, output: 100, cache_write: null, cache_read: null });
  const zeroInputPass = zeroInput.metrics.yield === null && zeroInput.metrics.leverage === null && zeroInput.metrics.velocity === null;
  record("zero-input-null-metrics", "Zero input produces null Yield, Leverage, Velocity",
    zeroInputPass, { yield: null, leverage: null, velocity: null }, zeroInput.metrics);

  // Test 3: Zero output
  const zeroOutput = computeMetrics({ input: 100, output: 0, cache_write: 50, cache_read: 200 });
  const zeroOutputPass = zeroOutput.metrics.yield === 0 && zeroOutput.metrics.velocity === 0;
  record("zero-output", "Zero output produces zero Yield and Velocity",
    zeroOutputPass, { yield: 0, velocity: 0 },
    { yield: zeroOutput.metrics.yield, velocity: zeroOutput.metrics.velocity });

  // Test 4: Missing cache
  const missingCache = computeMetrics({ input: 1000, output: 500, cache_write: null, cache_read: null });
  const missingCachePass = missingCache.metrics.yield === null && missingCache.metrics.leverage === null && missingCache.metrics.log_leverage === null;
  record("missing-cache-null-metrics", "Missing cache produces null Yield, Leverage, log_leverage",
    missingCachePass, { yield: null, leverage: null, log_leverage: null },
    { yield: missingCache.metrics.yield, leverage: missingCache.metrics.leverage, log_leverage: missingCache.metrics.log_leverage });

  // Test 5: Build and validate round-trip
  const envelope = buildEnvelope(
    { input: 1251211, output: 11296121, cache_write: 128196310, cache_read: 2555179769 },
    { tool: "claude-code", provider: "anthropic", model: "claude-sonnet-4" },
  );
  const validation = validateEnvelope(envelope);
  record("build-validate-roundtrip", "Built envelope passes schema + semantic validation",
    validation.valid, { valid: true },
    { valid: validation.valid, schemaErrors: validation.schemaErrors, semanticErrors: validation.semanticErrors });

  // Test 6: Forbidden field detection
  const badEnvelope = { ...envelope, prompt: "should be rejected" };
  const badValidation = validateEnvelope(badEnvelope);
  const forbiddenPass = !badValidation.valid && badValidation.semanticErrors.some(e => e.includes("forbidden field"));
  record("forbidden-field-detection", "Envelope with forbidden field 'prompt' is rejected",
    forbiddenPass, { valid: false, hasForbiddenError: true },
    { valid: badValidation.valid, semanticErrors: badValidation.semanticErrors });

  // Test 7: Banker's rounding
  const roundingPass = roundHalfToEven(0.5, 0) === 0 && roundHalfToEven(1.5, 0) === 2 && roundHalfToEven(2.5, 0) === 2;
  record("bankers-rounding", "Round-half-to-even: 0.5→0, 1.5→2, 2.5→2",
    roundingPass, { "0.5": 0, "1.5": 2, "2.5": 2 },
    { "0.5": roundHalfToEven(0.5, 0), "1.5": roundHalfToEven(1.5, 0), "2.5": roundHalfToEven(2.5, 0) });

  return {
    passed,
    failed,
    total: passed + failed,
    results,
    spec_version: SPEC_VERSION,
  };
}

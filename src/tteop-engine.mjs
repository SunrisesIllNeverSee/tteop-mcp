/**
 * src/tteop-engine.mjs — Self-contained TTEOP v0.1-draft engine.
 *
 * Implements:
 *   - buildEnvelope(telemetry, options) — schema-conforming envelope builder
 *   - validateEnvelope(envelope, options) — schema + semantic validation
 *   - computeMetrics(telemetry) — canonical five-metric computation
 *   - describeProtocol() — protocol metadata
 *   - runConformance() — executable conformance check against test vectors
 *
 * This module is self-contained: it embeds the schema and metric logic
 * directly so the MCP package has no file-path dependency on the spec repo.
 *
 * License: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, "..", "schemas", "telemetry-envelope-v0.1.schema.json");

// ─── Constants ──────────────────────────────────────────────────────────────

export const SPEC_VERSION = "tteop/0.1-draft";
export const METRIC_SPEC_VERSION = "tteop-metrics/0.1-draft";
export const LEGACY_ALIASES = ["otep/0.1-draft", "sigrank/0.1-draft"];
export const SUPPORTED_VERSIONS = [SPEC_VERSION, ...LEGACY_ALIASES];

export const FORBIDDEN_FIELDS = [
  "prompt", "prompt_text", "completion", "completion_text", "response_text",
  "source_code", "code", "diff", "keystrokes", "screen_content",
  "file_path", "file_content", "repo_content",
];

export const PRIVACY_MODES = ["public-pseudonymous", "private-managed-cohort", "enterprise-isolated"];
export const PROVENANCE_LEVELS = ["self-reported", "collector-attested", "platform-verified", "signed"];

const MAX_SAFE_INTEGER = 9007199254740991;

// ─── Schema loading ─────────────────────────────────────────────────────────

let _compiledValidator = null;
let _loadedSchema = null;

function loadSchema() {
  if (_compiledValidator) {
    return { schema: _loadedSchema, validate: _compiledValidator };
  }
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  _loadedSchema = schema;
  _compiledValidator = ajv.compile(schema);
  return { schema, validate: _compiledValidator };
}

// ─── Banker's rounding (round-half-to-even) per SRP-METRIC-002 ──────────────

export function roundHalfToEven(value, decimals) {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = Math.pow(10, decimals);
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const frac = scaled - floor;
  let result;
  if (frac < 0.5) {
    result = floor;
  } else if (frac > 0.5) {
    result = floor + 1;
  } else {
    result = (floor % 2 === 0) ? floor : floor + 1;
  }
  return result / factor;
}

// ─── Metric computation ─────────────────────────────────────────────────────

export function computeMetrics(telemetry) {
  const input = telemetry.input;
  const output = telemetry.output;
  const cacheWrite = telemetry.cache_write ?? telemetry.cache_creation ?? null;
  const cacheRead = telemetry.cache_read ?? null;

  const warnings = [];
  const cacheWarnings = [];

  // output_fraction = output / (input + output)
  const ofDenom = input + output;
  const ofRaw = ofDenom > 0 ? output / ofDenom : null;
  if (ofRaw === null) warnings.push("output_fraction_undefined: input+output=0");

  // Velocity = output / input
  const velocityRaw = input > 0 ? output / input : null;
  if (velocityRaw === null) warnings.push("velocity_undefined: input=0");

  // Leverage = cache_read / input
  let leverageRaw = null;
  if (cacheRead === null) {
    // unavailable → null
  } else if (input > 0) {
    leverageRaw = cacheRead / input;
  } else {
    warnings.push("leverage_undefined: input=0");
  }

  // Yield = (cache_read × output) / input² = Leverage × Velocity
  let yRaw = null;
  if (cacheRead === null) {
    // unavailable → null
  } else if (leverageRaw !== null && velocityRaw !== null) {
    yRaw = leverageRaw * velocityRaw;
  } else {
    warnings.push("yield_undefined: requires input>0 and cache_read available");
  }

  if (cacheWrite === null) {
    cacheWarnings.push("cache_write is unavailable; log_leverage is undefined.");
  }
  if (cacheRead === null) {
    cacheWarnings.push("cache_read is unavailable; Yield, Leverage, and log_leverage are undefined.");
  }

  // log_leverage = log10(cache_read / input)
  const allFourPositive = (
    input > 0 && output > 0 &&
    cacheWrite !== null && cacheWrite > 0 &&
    cacheRead !== null && cacheRead > 0
  );
  let logLevRaw = null;
  if (!allFourPositive) {
    warnings.push("log_leverage_undefined: requires all four pillars > 0");
  } else {
    logLevRaw = Math.log10(cacheRead / input);
  }

  const orderedWarnings = [...cacheWarnings, ...warnings];

  return {
    metrics: {
      yield: roundHalfToEven(yRaw, 2),
      leverage: roundHalfToEven(leverageRaw, 1),
      velocity: roundHalfToEven(velocityRaw, 3),
      output_fraction: roundHalfToEven(ofRaw, 4),
      log_leverage: roundHalfToEven(logLevRaw, 2),
    },
    warnings: orderedWarnings,
  };
}

// ─── Envelope builder ───────────────────────────────────────────────────────

/**
 * Build a TTEOP v0.1-draft schema-conforming envelope from token telemetry.
 * Computes Yield, Leverage, Velocity, output_fraction, and log_leverage.
 * No data is submitted or persisted.
 */
export function buildEnvelope(telemetry, opts = {}) {
  // Validate token fields
  const input = validateTokenField(telemetry.input, "input");
  const output = validateTokenField(telemetry.output, "output");
  const cacheWrite = validateTokenField(telemetry.cache_write, "cache_write");
  const cacheRead = validateTokenField(telemetry.cache_read, "cache_read");

  if (input === null) throw new Error("input is required and must be a non-negative integer");
  if (output === null) throw new Error("output is required and must be a non-negative integer");

  const { metrics, warnings } = computeMetrics({ input, output, cache_write: cacheWrite, cache_read: cacheRead });
  const now = new Date().toISOString();

  // Build missingness flags
  const missingnessFlags = [];
  if (cacheWrite === null) missingnessFlags.push("cache_write_not_reported");
  if (cacheRead === null) missingnessFlags.push("cache_read_not_reported");

  const envelope = {
    protocol_version: SPEC_VERSION,
    metric_spec_version: METRIC_SPEC_VERSION,
    observation: {
      timestamp: now,
      window_start: opts.window_start ?? null,
      window_end: opts.window_end ?? null,
      window_duration_seconds: opts.window_duration_seconds ?? null,
    },
    source: {
      tool: opts.tool ?? "unknown",
      platform: opts.platform ?? null,
      provider: opts.provider ?? null,
      model: opts.model ?? null,
      adapter_id: opts.adapter_id ?? null,
      adapter_version: opts.adapter_version ?? null,
    },
    telemetry: {
      input,
      output,
      cache_write: cacheWrite,
      cache_read: cacheRead,
    },
    provenance: {
      level: opts.provenance_level ?? "self-reported",
      signature_status: "unsigned",
    },
    privacy: {
      mode: opts.privacy_mode ?? "public-pseudonymous",
    },
    metrics,
    warnings,
  };

  // Attach operator when operator_key or cohort_id is provided
  if (opts.operator_key || opts.cohort_id !== undefined) {
    const privacyMode = opts.privacy_mode ?? "public-pseudonymous";
    let cohortId = opts.cohort_id ?? null;
    if (privacyMode === "public-pseudonymous") {
      cohortId = null;
    }
    if (opts.operator_key) {
      envelope.operator = {
        pseudonymous_key: opts.operator_key,
        cohort_id: cohortId,
      };
    } else if (opts.cohort_id !== undefined && opts.cohort_id !== null) {
      throw new Error(
        "buildEnvelope: cohort_id requires operator_key — cannot define cohort membership without a pseudonymous operator identifier"
      );
    }
  }

  // Attach validity only when there are missingness flags
  if (missingnessFlags.length > 0) {
    envelope.validity = {
      status: "partial",
      missingness_flags: missingnessFlags,
    };
  }

  return envelope;
}

function validateTokenField(value, fieldName) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer, got ${typeof value === "number" ? value : typeof value}`);
  }
  if (value < 0) {
    throw new Error(`${fieldName} must be non-negative, got ${value}`);
  }
  if (value > MAX_SAFE_INTEGER) {
    throw new Error(`${fieldName} exceeds MAX_SAFE_INTEGER, got ${value}`);
  }
  return value;
}

// ─── Semantic validation ────────────────────────────────────────────────────

function validateEnvelopeSemantics(envelope, options = {}) {
  const errors = [];
  const warnings = [];

  // 1. Forbidden field check
  const checkForbidden = (obj, path) => {
    if (obj === null || typeof obj !== "object") return;
    for (const [key, val] of Object.entries(obj)) {
      if (FORBIDDEN_FIELDS.includes(key)) {
        errors.push(`${path}.${key}: forbidden field name (SRP-VAL-006)`);
      }
      if (typeof val === "object" && val !== null) {
        checkForbidden(val, `${path}.${key}`);
      }
    }
  };
  checkForbidden(envelope, "envelope");

  if (!envelope || typeof envelope !== "object") return { errors, warnings };

  // 2. Missingness flags
  const telemetry = envelope.telemetry;
  if (telemetry) {
    const flags = envelope.validity?.missingness_flags ?? [];
    if (telemetry.cache_write === null) {
      if (!flags.some(f => f.startsWith("cache_write_"))) {
        errors.push("telemetry.cache_write is null but no cache_write_* missingness flag present (SRP-MISS-001)");
      }
    }
    if (telemetry.cache_read === null) {
      if (!flags.some(f => f.startsWith("cache_read_"))) {
        errors.push("telemetry.cache_read is null but no cache_read_* missingness flag present (SRP-MISS-002)");
      }
    }
  }

  // 3. Privacy mode constraints
  const mode = envelope.privacy?.mode;
  if (mode === "public-pseudonymous") {
    if (envelope.operator?.cohort_id != null) {
      errors.push("envelope.operator.cohort_id: not allowed in public-pseudonymous mode (SRP-PRIV-002)");
    }
  }
  if (mode === "private-managed-cohort") {
    if (envelope.operator?.cohort_id == null) {
      warnings.push("private-managed-cohort mode SHOULD include cohort_id (SRP-PRIV-004)");
    }
  }

  // 4. Provenance signature restrictions
  if (envelope.provenance?.level === "signed") {
    if (!envelope.extensions) {
      errors.push("envelope: signed provenance requires extensions with signature object (SRP-PROV-002)");
    }
    if (envelope.provenance?.signature_status === "valid") {
      errors.push("envelope.provenance.signature_status: 'valid' not supported in v0.1 — no cryptographic verification implemented. Use 'signature-present-unverified'. (SRP-PROV-005)");
    }
  }

  // 5. Raw provider field scalar restrictions
  if (envelope.raw_provider_fields) {
    for (const [key, val] of Object.entries(envelope.raw_provider_fields)) {
      if (typeof val === "object" && val !== null) {
        errors.push(`envelope.raw_provider_fields.${key}: non-scalar value not allowed (SRP-VAL-007)`);
      }
    }
  }

  // 6. Pseudonymous key identity leakage
  if (envelope.operator?.pseudonymous_key) {
    const key = envelope.operator.pseudonymous_key;
    if (/@|\.com|\.org|\.net|employee|hr@|name=/i.test(key)) {
      errors.push("envelope.operator.pseudonymous_key: appears to contain real-world identity (SRP-DATA-011)");
    }
  }

  // 7. Extension namespace rules
  if (envelope.extensions) {
    for (const key of Object.keys(envelope.extensions)) {
      if (!key.includes(".") && !key.includes(":") && !key.startsWith("x-")) {
        errors.push(`envelope.extensions.${key}: extension namespace must contain '.' or ':' or start with 'x-' (SRP-EXT-003)`);
      }
    }
  }

  // 8. Profile assertion
  if (options.expectedProfile && mode && mode !== options.expectedProfile) {
    errors.push(`privacy.mode is "${mode}" but expected profile "${options.expectedProfile}" (--profile assertion)`);
  }

  return { errors, warnings };
}

// ─── Combined validation ────────────────────────────────────────────────────

export function validateEnvelope(envelope, options = {}) {
  const { computeMetrics: shouldCompute = true } = options;

  // Schema validation
  const { validate } = loadSchema();
  const ok = validate(envelope);
  let schemaValid = ok;
  let schemaErrors = [];
  if (!ok) {
    schemaErrors = (validate.errors || []).map(e => {
      const path = e.instancePath || "(root)";
      return `${path}: ${e.message}${e.params ? ` (${JSON.stringify(e.params)})` : ""}`;
    });
  }

  // Semantic validation
  const { errors: semanticErrors, warnings: semanticWarnings } = validateEnvelopeSemantics(envelope, options);

  const valid = schemaValid && semanticErrors.length === 0;

  let metrics = null;
  let metricWarnings = [];
  if (valid && shouldCompute && envelope.telemetry) {
    const result = computeMetrics(envelope.telemetry);
    metrics = result.metrics;
    metricWarnings = result.warnings;
  }

  return {
    valid,
    schemaErrors,
    semanticErrors,
    semanticWarnings,
    metrics,
    metricWarnings,
    protocolVersion: envelope?.protocol_version ?? null,
  };
}

// ─── Protocol description ───────────────────────────────────────────────────

export function describeProtocol() {
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
    schema_url: "https://tteop.dev/schemas/telemetry-envelope-v0.1.schema.json",
    specification: "https://github.com/SunrisesIllNeverSee/otep-spec",
    license: "Apache-2.0",
  };
}

// ─── Conformance check ──────────────────────────────────────────────────────

export function runConformance() {
  const results = [];
  let passed = 0;
  let failed = 0;

  // Test 1: Canonical MOSES vector
  const canonical = {
    telemetry: { input: 1251211, output: 11296121, cache_write: 128196310, cache_read: 2555179769 },
    expected: { yield: 18436.98, leverage: 2042.2, velocity: 9.028, output_fraction: 0.9003, log_leverage: 3.31 },
  };
  const canonicalResult = computeMetrics(canonical.telemetry);
  const canonicalPass = JSON.stringify(canonicalResult.metrics) === JSON.stringify(canonical.expected);
  results.push({
    test: "canonical-moses-vector",
    description: "MOSES canonical seed vector with frozen invariants",
    passed: canonicalPass,
    expected: canonical.expected,
    actual: canonicalResult.metrics,
  });
  if (canonicalPass) passed++; else failed++;

  // Test 2: Zero input
  const zeroInput = computeMetrics({ input: 0, output: 100, cache_write: null, cache_read: null });
  const zeroInputPass = zeroInput.metrics.yield === null && zeroInput.metrics.leverage === null && zeroInput.metrics.velocity === null;
  results.push({
    test: "zero-input-null-metrics",
    description: "Zero input produces null Yield, Leverage, Velocity",
    passed: zeroInputPass,
    expected: { yield: null, leverage: null, velocity: null },
    actual: zeroInput.metrics,
  });
  if (zeroInputPass) passed++; else failed++;

  // Test 3: Zero output
  const zeroOutput = computeMetrics({ input: 100, output: 0, cache_write: 50, cache_read: 200 });
  const zeroOutputPass = zeroOutput.metrics.yield === 0 && zeroOutput.metrics.velocity === 0;
  results.push({
    test: "zero-output",
    description: "Zero output produces zero Yield and Velocity",
    passed: zeroOutputPass,
    expected: { yield: 0, velocity: 0 },
    actual: { yield: zeroOutput.metrics.yield, velocity: zeroOutput.metrics.velocity },
  });
  if (zeroOutputPass) passed++; else failed++;

  // Test 4: Missing cache
  const missingCache = computeMetrics({ input: 1000, output: 500, cache_write: null, cache_read: null });
  const missingCachePass = missingCache.metrics.yield === null && missingCache.metrics.leverage === null && missingCache.metrics.log_leverage === null;
  results.push({
    test: "missing-cache-null-metrics",
    description: "Missing cache produces null Yield, Leverage, log_leverage",
    passed: missingCachePass,
    expected: { yield: null, leverage: null, log_leverage: null },
    actual: { yield: missingCache.metrics.yield, leverage: missingCache.metrics.leverage, log_leverage: missingCache.metrics.log_leverage },
  });
  if (missingCachePass) passed++; else failed++;

  // Test 5: Build and validate round-trip
  const envelope = buildEnvelope(
    { input: 1251211, output: 11296121, cache_write: 128196310, cache_read: 2555179769 },
    { tool: "claude-code", provider: "anthropic", model: "claude-sonnet-4" }
  );
  const validation = validateEnvelope(envelope);
  const roundTripPass = validation.valid;
  results.push({
    test: "build-validate-roundtrip",
    description: "Built envelope passes schema + semantic validation",
    passed: roundTripPass,
    expected: { valid: true },
    actual: { valid: validation.valid, schemaErrors: validation.schemaErrors, semanticErrors: validation.semanticErrors },
  });
  if (roundTripPass) passed++; else failed++;

  // Test 6: Forbidden field detection
  const badEnvelope = { ...envelope, prompt: "should be rejected" };
  const badValidation = validateEnvelope(badEnvelope);
  const forbiddenPass = !badValidation.valid && badValidation.semanticErrors.some(e => e.includes("forbidden field"));
  results.push({
    test: "forbidden-field-detection",
    description: "Envelope with forbidden field 'prompt' is rejected",
    passed: forbiddenPass,
    expected: { valid: false, hasForbiddenError: true },
    actual: { valid: badValidation.valid, semanticErrors: badValidation.semanticErrors },
  });
  if (forbiddenPass) passed++; else failed++;

  // Test 7: Banker's rounding
  const roundingPass = roundHalfToEven(0.5, 0) === 0 && roundHalfToEven(1.5, 0) === 2 && roundHalfToEven(2.5, 0) === 2;
  results.push({
    test: "bankers-rounding",
    description: "Round-half-to-even: 0.5→0, 1.5→2, 2.5→2",
    passed: roundingPass,
    expected: { "0.5": 0, "1.5": 2, "2.5": 2 },
    actual: { "0.5": roundHalfToEven(0.5, 0), "1.5": roundHalfToEven(1.5, 0), "2.5": roundHalfToEven(2.5, 0) },
  });
  if (roundingPass) passed++; else failed++;

  return {
    suite: "tteop-mcp-conformance",
    spec_version: SPEC_VERSION,
    total: results.length,
    passed,
    failed,
    results,
  };
}

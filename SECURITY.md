# Security policy

## Supported versions

Security fixes are provided for the current npm release. Older releases may receive a new patched successor but are not modified in place.

## Reporting a vulnerability

Use GitHub private vulnerability reporting for `SunrisesIllNeverSee/tteop-mcp`. Do not open a public issue containing exploit details, credentials, private telemetry, or affected identities.

Include the affected version, reproduction steps, expected impact, and whether the issue originates in this MCP transport or the upstream `tteop-spec` dependency. Maintainers will acknowledge a complete report within 72 hours and coordinate remediation and disclosure timing.

## Security boundary

This package processes local tool arguments and writes MCP JSON-RPC to stdout. It does not persist or transmit telemetry. Protocol validation is delegated to the exact `tteop-spec` dependency. Prompt text, response text, source code, repository contents, keystrokes, screen content, secrets, and direct real-world identity are outside the permitted telemetry envelope.

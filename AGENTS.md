# AGENTS.md — tteop-mcp

This repository is a thin MCP transport over the normative `tteop-spec` package.

## First commands

```bash
npm ci
npm run test:all
```

## Authority and scope

- `otep-spec` is authoritative for schemas, formulas, null semantics, privacy modes, provenance levels, and conformance behavior.
- Import the exact `tteop-spec` release. Do not reproduce protocol logic in this repository.
- Keep the public surface to the four declared tools unless a reviewed change explicitly expands it.
- stdout is reserved for JSON-RPC. Diagnostics go to stderr.

## Required checks

- Real MCP initialization, tool discovery, valid calls, invalid calls, and protocol-only stdout.
- Packaged-tarball installation and invocation.
- Release metadata agreement across `package.json`, `package-lock.json`, and `server.json`.
- `npm pack --dry-run` contains only intended public files.

## Release rules

- Never publish from an uncommitted working tree.
- Version, tag, GitHub release, npm `gitHead`, `server.json`, and MCP Registry version must agree.
- Publish npm with provenance, then update the MCP Registry and verify Glama.
- Do not unpublish a consumed version except under npm security policy; correct it with a new patch release.

## Security and privacy

- Never accept prompt text, response text, source code, repository contents, keystrokes, screen content, secrets, or direct real-world identity in telemetry.
- Preserve TTEOP privacy and provenance validation. `signed` must fail unless the normative signature object is supported.
- Do not weaken numeric safe-integer bounds or forbidden-field checks.

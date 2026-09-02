# Start here

`tteop-mcp` is the installable Model Context Protocol transport for TTEOP. It does not define the protocol and must not copy metric formulas or validation rules.

## Reading order

1. Read this file for the operating model.
2. Read `README.md` for installation, tools, and release order.
3. Read `AGENTS.md` before making automated changes.
4. Read the normative TTEOP specification in `SunrisesIllNeverSee/otep-spec`.
5. Run `npm ci && npm run test:all` before proposing a change.

## Authority order

1. `otep-spec/SPEC.md` and its published schemas define TTEOP.
2. The exact `tteop-spec` npm dependency supplies the builder and validator.
3. This repository exposes those capabilities through four MCP tools.
4. `server.json` describes the same package version to the MCP Registry.
5. SignalAF/SigRank consumes TTEOP but does not redefine it.

## Change flow

Protocol change → accepted TEP and `tteop-spec` release → dependency update here → real-client and packaged-artifact tests → npm release → MCP Registry update → Glama verification → downstream consumer validation.

If a requested change alters a formula, schema, privacy profile, provenance level, or conformance rule, stop here and make the normative change through `otep-spec` governance first.

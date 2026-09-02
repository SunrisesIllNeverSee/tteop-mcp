# Contributing

Read `START-HERE.md` and `AGENTS.md` before changing code.

## Contribution process

1. Open a focused branch from `main`.
2. Keep protocol logic in `tteop-spec`; this repository owns only MCP transport, schemas exposed to clients, packaging, and distribution metadata.
3. Run `npm ci` and `npm run test:all`.
4. Confirm `npm pack --dry-run` contains no secrets, fixtures, or unintended files.
5. Submit a pull request with the behavior change, tests, compatibility impact, and rollback plan.

Commits must include a `Signed-off-by` trailer to certify the Developer Certificate of Origin. Security reports follow `SECURITY.md`, not the public issue tracker.

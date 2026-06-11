# Local evidence export hardening contracts

This document records the `M3-local-evidence-export-hardening-CU1-foundation-contracts` foundation contract.

## Scope

- Preserve release readiness Markdown exports, MCP dry-run JSON exports, and recovery comparison evidence as local review bundles.
- Keep export bundles comparable in Settings > Release readiness before any push, deploy, restart, cleanup, rerun, generation, or live MCP call.
- Store the bundle definitions in readiness history snapshots so operators can compare the same local evidence later.

## Bundles

| Bundle | Source | Export command | Boundary |
| --- | --- | --- | --- |
| readiness Markdown bundle | Settings > Release readiness Markdown export | `buildReleaseReadinessHandoffMarkdown(record)` | local evidence |
| MCP dry-run JSON bundle | `backend/src/mcp/mcpDryRunEvidence.ts` | `npm run export:mcp-dry-run-evidence` | operator review |
| recovery comparison bundle | Workflow recovery handoff + media/runtime triage queue | local handoff export only | approval required |

## Stop conditions

Stop and route approval instead of executing external work when a bundle comparison needs live MCP calls, generation, data mutation, cleanup, rerun, restart, public smoke, push, deploy, package/app version changes, credentials, schema/data/auth/security changes, or public API changes.

## Verification

```bash
npm run verify:release-readiness-history-contracts
npm run verify:mcp-local-evidence-export
```

The verifiers check that local evidence export bundle contracts persist into readiness history, appear in Markdown handoff output, and remain tied to the existing MCP dry-run JSON exporter without calling live MCP tools.

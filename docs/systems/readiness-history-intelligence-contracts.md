# Readiness history intelligence contracts

This document defines the local-only foundation for CoNAI readiness history intelligence.

## Goal

Readiness history intelligence turns saved Settings > Release readiness records into priority/caveat summaries that an operator can review before release, workflow rerun, smoke, media cleanup, or handoff decisions.

It is intentionally evidence-only. It summarizes local records and UI contract anchors; it does not execute external operations.

## Signals

The foundation contract contains exactly three cross-surface signals for the M3 CU1 contract:

1. `release-handoff-priority`
   - Domain: release operations
   - Evidence: `captured-handoff-readiness + final-verification-trend`
   - Purpose: compare the latest export-readiness state, handoff capture, and final verification trend before release actions.
   - Boundary: approval required.

2. `workflow-runtime-caveat`
   - Domain: workflow runtime
   - Evidence: `queue-retry-recovery-retention-signals`
   - Purpose: review queue pressure, retry stops, recovery mismatch, retention, and terminal failure caveats before rerun, smoke, or restart.
   - Boundary: operator review.

3. `media-stewardship-caveat`
   - Domain: media review
   - Evidence: `review-quality-cleanup-signals`
   - Purpose: keep quality backlog, similarity decision history, and cleanup staging visible before public review or cleanup decisions.
   - Boundary: approval required.

## Local-only boundary

The intelligence surface must not push, deploy, restart, run smoke against public targets, call public APIs with side effects, delete media, change retention, mutate schema/data/auth/security, edit package/app versions, or invoke MCP/live backend action endpoints.

Approved local behavior:

- Build typed signal contracts.
- Persist signal counts and signal summaries in browser-local readiness history records.
- Export the intelligence section in local Markdown handoff output.
- Render a Settings UI review surface that presents recommendations and caveats.
- Verify the contract with a local `tsx` script.

## Verification

Run the focused contract check:

```bash
npm run verify:readiness-history-intelligence-contracts
```

From the repository root, the matching alias is:

```bash
npm run verify:readiness-history-intelligence-contracts
```

Canonical release checks still remain owned by the project verification policy for the current worker run.

# Operator evidence review console

This note records the local-safe operator workflow for the Settings > Release readiness evidence console.

## Purpose

The console brings MCP dry-run evidence, workflow recovery handoff evidence, and media approval packet evidence into one review surface. It is intentionally a comparison and export workspace, not an execution surface.

## Local-safe boundaries

- It may save readiness snapshots in browser local storage.
- It may copy or download a Markdown handoff generated in the browser.
- It may mark release review items, alert review items, and handoff evidence as reviewed.
- It must not call MCP tools, push, deploy, restart services, rerun workflows, mutate media data, change retention policy, or perform destructive cleanup.

## Operator flow

1. Review the readiness checklist for completed work, caveats, verification evidence, and user-owned decisions.
2. Mark alert signals from media review and workflow runtime only after reading the threshold/source notes.
3. Mark handoff evidence when the local commit snapshot, push plan, demo-host handoff, smoke plan, and rollback plan are available for review.
4. Confirm the export readiness badge says the evidence is ready.
5. Save a snapshot and export/copy the local Markdown handoff for user approval review.

## Verification anchors

The local contract is covered by:

```bash
npm run verify:integrated-operations-surface-contracts
npm run verify:release-readiness-history-contracts
npm run build
npm run verify:release-readiness
git diff --check
```

These checks are local only and do not push, deploy, restart services, or call external services.

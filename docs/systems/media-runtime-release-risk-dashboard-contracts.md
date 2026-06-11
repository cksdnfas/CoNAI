# Media/runtime release risk dashboard contracts

This document records the local-only foundation contract for the `M3-media-runtime-release-risk-dashboard` roadmap axis.

## Scope

- Combine media quality backlog and workflow runtime stop-condition signals into a release-priority risk dashboard.
- Keep the dashboard evidence-only: it can describe severity, source anchors, release risk, mitigation, and approval boundaries.
- Persist dashboard cards into release readiness history records and the Markdown handoff export so saved snapshots carry the same release-risk context.
- Do not execute cleanup, deletion, retention changes, reruns, cancels, restarts, live smoke, public API calls, credential use, package version changes, or data/schema/auth/security changes.

## Dashboard items

1. `media-quality-release-blocker` - media review backlog and similarity cleanup staging are high release risk until reviewed or exported as non-destructive evidence.
2. `runtime-rerun-release-stop-condition` - queue, retry, recovery, retention, and terminal-failure caveats stay high release risk before rerun, smoke, or restart planning.
3. `release-evidence-drift-watch` - release handoff snapshots must include media/runtime risk so approval questions do not drift from current local evidence.

## Operator-visible foundation

- `data-media-runtime-release-risk-dashboard="true"` exposes the dashboard surface.
- `data-media-runtime-release-risk-dashboard-summary="true"` exposes high-risk, approval-required, and evidence-anchor counts.
- `data-media-runtime-release-risk-dashboard-item={item.id}` keeps each risk card individually addressable for regression checks.
- Saved release readiness history records include `releaseRiskDashboard`, `summary.releaseRiskDashboardItemCount`, and `summary.releaseRiskDashboardHighCount`.
- Markdown handoff export includes a `## Media Runtime Release Risk Dashboard` section with risk and mitigation text.

## No external side effects

The dashboard stores local evidence anchors and `approvalBoundary` values only. It must not import backend action clients, call `fetch`, mutate media files, rerun workflows, restart services, push, deploy, or hide approval-required operations behind UI action buttons.

## Verification

Run:

```bash
npm run verify:media-runtime-release-risk-dashboard-contracts
```

Canonical release verification remains:

```bash
npm run build
npm run verify:release-readiness
git diff --check
```

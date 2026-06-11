# Media/runtime caveat triage contracts

This document records the local-only foundation contract for the `media-runtime-caveat-triage` roadmap axis.

## Scope

- Bundle media review and workflow runtime caveats into a prioritized operator triage queue.
- Keep triage evidence-only: it can describe queue priority, source anchors, review questions, and safe next steps.
- Do not execute deletion, retention changes, reruns, cancels, restarts, live smoke, public API calls, credential use, package version changes, or data/schema/auth/security changes.
- Persist the queue into the release readiness history record and Markdown handoff export so the same caveat review survives snapshot save/load.

## Triage queue items

1. `review-backlog-before-cleanup` - media review backlog and quality backlog must be operator-review evidence before publication or cleanup judgment.
2. `similarity-cleanup-approval-gate` - similarity decisions and cleanup candidates remain non-destructive staging; deletion/retention/schema changes require approval.
3. `runtime-rerun-readiness-review` - queue, retry, and recovery caveats are stop-condition evidence before rerun, smoke, or restart planning.
4. `runtime-retention-terminal-gate` - retention-prune and terminal-failure signals stay watch/approval evidence, not policy changes or restart actions.

## Operator-visible foundation

- `data-media-runtime-caveat-triage="true"` exposes the queue surface.
- `data-media-runtime-caveat-triage-summary="true"` exposes operator-review and approval-required counts.
- `data-media-runtime-caveat-triage-item={item.id}` keeps each queue card individually addressable for regression checks.
- Saved release readiness history records include `mediaRuntimeTriageQueue` and `summary.mediaRuntimeTriageQueueCount`.
- Markdown handoff export includes a `## Media Runtime Caveat Triage Queue` section.

## No external side effects

The queue stores `approvalBoundary` values (`operator-review` or `approval-required`) and local evidence anchors only. It must not import backend action clients, call `fetch`, mutate media files, rerun workflows, restart services, or hide approval-required operations behind UI action buttons.

## Verification

Run:

```bash
npm run verify:media-runtime-caveat-triage-contracts
```

Canonical release verification remains:

```bash
npm run build
npm run verify:release-readiness
git diff --check
```

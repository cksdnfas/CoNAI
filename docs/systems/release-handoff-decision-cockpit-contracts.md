# Release handoff decision cockpit contracts

This document records the local-only foundation contract for the `release-handoff-decision-cockpit` roadmap axis.

## Scope

- Bundle release handoff decisions into one operator-visible cockpit.
- Keep the cockpit evidence-only: it can describe commands, caveats, and decision questions, but it does not execute push, deploy, restart, live smoke, cleanup, public API calls, credential use, package version changes, or data/schema/auth/security changes.
- Persist the cockpit cards into the release readiness history record and Markdown handoff export.

## Cockpit cards

1. `verification-baseline` - local build/docs/contracts evidence for release judgment.
2. `local-commit-range` - branch snapshot and local commits ahead of `origin/alphatest` before any push approval.
3. `approval-gate-register` - push, demo update, restart/smoke, and cleanup remain user-owned decisions.
4. `caveat-triage-snapshot` - media/runtime caveats remain operator review evidence before cleanup/rerun/restart.
5. `handoff-export-packet` - Markdown export carries verification, caveats, and approval gates for review.

## No external side effects

The cockpit stores `boundary` values (`local-evidence`, `operator-review`, or `approval-required`) and local evidence strings only. It must not import backend action clients, call `fetch`, mutate live services, or hide approval-required operations behind UI action buttons.

## Verification

Run:

```bash
npm run verify:release-handoff-decision-cockpit-contracts
```

Canonical release verification remains:

```bash
npm run build
npm run verify:release-readiness
git diff --check
```

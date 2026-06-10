# Workflow recovery runbook evidence

This document records the local-only evidence added for the `local-automation-context-operations` roadmap M2-CU2 commit unit.

## Scope

- Keep workflow recovery decisions inspectable from local runtime health data.
- Add evidence for rerun readiness, rollback handoff, and stop conditions.
- Avoid push, deploy, restart, live smoke, package version changes, destructive cleanup, credentials, auth/security/data changes, public API changes, or external service side effects.

## Runtime evidence cards

The workflow runner now derives three runbook evidence cards from existing runtime health fields:

| Evidence card | Source signals | Safe decision boundary |
| --- | --- | --- |
| Rerun readiness evidence | active queue count, queue pressure, cancellation requests, stopped schedules, recovery mismatches, failed/cancelled terminal history | local operator review before rerun |
| Rollback handoff evidence | recovery mismatches, failed/cancelled terminal history, pending retention prune signals | approval required before rollback, deploy, restart, or destructive cleanup |
| Stop condition evidence | paused/stopped autoruns, cancellation requests, recent failed runs | local stop-reason review before resuming schedules |

## Runbook order

1. Review the runbook evidence cards before triggering another run when any card is `Attention`.
2. For rerun readiness, compare queue pressure, input preset diffs, recent failures, and output state before retrying.
3. For rollback handoff, collect the current commit, failed step, recovery mismatch, and output/retention state, then ask for approval before rollback, deploy, restart, or cleanup.
4. For stop conditions, preserve the stopped schedule reason and recent error evidence before resuming autorun schedules.
5. If the evidence requires work outside the active milestone or approval boundaries, stop and route it instead of executing it.

## Verification

Local contract coverage is in `frontend/src/scripts/verifyMediaRuntimeObservabilityContracts.ts` and asserts:

- three runbook evidence records are produced;
- rollback/restart execution remains approval-owned;
- the workflow runner renders identifiable `data-workflow-runtime-runbook-evidence` and `data-workflow-runtime-runbook-evidence-card` hooks;
- no destructive media cleanup call is added.

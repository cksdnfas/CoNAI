# Automation rehearsal contracts

This note records the local-safe contract for the CoNAI approval-safe automation rehearsal milestone. Rehearsals use dry-run evidence and local diffs only; they are not execution surfaces.

## Scope

- Compare cleanup staging, workflow recovery replay, and release-candidate command plans before an operator approves live work.
- Keep rehearsal output reviewable in Settings > Release readiness and in exported handoff Markdown.
- Let operators mark each rehearsal lane as reviewed before export readiness, while preserving dry-run-only behavior.
- Preserve the Project Steward boundary: local implementation and verification only.

## Rehearsal lanes

| Lane | Dry-run anchor | Local artifact | Stop condition |
| --- | --- | --- | --- |
| Cleanup staging dry-run | Media review > cleanup staging preview | Candidate diff only; no deletion or retention-policy mutation | Stop for approval when deletion, retention changes, or schema changes are required. |
| Workflow recovery replay dry-run | `buildWorkflowRuntimeRecoveryHandoffPacket(runtimeHealth)` | Queue/retry/recovery handoff packet; no rerun, cancel, or restart | Stop with rehearsal evidence when rerun, cancel, restart, or live smoke is needed. |
| Release candidate command dry-run | Settings > Release readiness operation checklist | Command plan and expected smoke assertions only; no push/deploy/restart | Do not run push, deploy, restart, or public smoke before user approval. |

## Operator review workflow

- Settings > Release readiness shows each rehearsal lane as a local checkbox row.
- `Mark rehearsals` records all rehearsal lanes as reviewed; the reset control clears only this local review state.
- Saved release-readiness history stores `reviewedAutomationRehearsalIds`, exports each Automation Rehearsal line as checked/open Markdown, and does not execute the rehearsal anchors.
- Export readiness remains incomplete until review, handoff capture, alert review, and automation rehearsal review are all complete.

## Side-effect boundaries

The rehearsal surface must not push, deploy, restart services, change schema/data/auth/security/public APIs, change credentials, run destructive cleanup, call external services, call MCP tools, or mutate live data. It may only render local evidence, save browser-local snapshots, and export local Markdown.

## Verification

Local contract coverage:

```bash
npm run verify:automation-rehearsal-contracts
npm run verify:release-readiness-history-contracts
npm run build
npm run verify:release-readiness
git diff --check
```

These checks are local only and do not perform external side effects.

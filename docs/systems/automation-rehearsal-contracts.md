# Automation rehearsal contracts

This note records the local-safe contract for the CoNAI approval-safe automation rehearsal milestone. Rehearsals use dry-run evidence and local diffs only; they are not execution surfaces.

## Scope

- Compare MCP dry-run evidence, workflow recovery replay, cleanup staging, and release-candidate command plans before an operator approves live work.
- Keep rehearsal output reviewable in Settings > Release readiness and in exported handoff Markdown.
- Let operators mark each rehearsal lane as reviewed before export readiness, while preserving dry-run-only behavior.
- Preserve the Project Steward boundary: local implementation and verification only.

## Foundation data contract

Each `ReleaseReadinessAutomationRehearsalContract` lane records:

- `dryRunAnchor`: the local command, local function, or UI source that produces review evidence.
- `evidencePacket`: the bundle id that should be compared in the handoff export.
- `comparisonTarget`: the doc, cockpit card, queue, or staging surface used as the comparison baseline.
- `localDiffArtifact`: the local-only artifact produced for review.
- `rehearsalOutcome`: the operator-readable result expected from comparing those artifacts.
- `stopCondition`: the boundary that stops the rehearsal before side effects.

## Rehearsal lanes

| Lane | Dry-run anchor | Evidence packet | Comparison target | Local artifact | Stop condition |
| --- | --- | --- | --- | --- | --- |
| MCP dry-run evidence rehearsal | `npm run export:mcp-dry-run-evidence` | `mcp-dry-run-json-bundle` | `docs/systems/agent-mcp-local-evidence-export.md` + `docs/GUIDE/MCP_GUIDE.md` | Tool-class comparison packet only; no live MCP call, generation, mutation, or external service access | Stop with dry-run evidence only when live MCP calls, generation, mutation, or credential use is required. |
| Workflow recovery replay dry-run | `buildWorkflowRuntimeRecoveryHandoffPacket(runtimeHealth)` | `workflow-recovery-handoff-packet` | Queue pressure, retry policy, recovery mismatch, and terminal failure groups | Queue/retry/recovery handoff packet; no rerun, cancel, or restart | Stop with rehearsal evidence when rerun, cancel, restart, or live smoke is needed. |
| Cleanup staging comparison dry-run | Media review > cleanup staging preview | `media-approval-packet` | Review queue, tag quality backlog, similarity decisions, and reversible cleanup staging | Candidate diff only; no deletion or retention-policy mutation | Stop for approval when deletion, retention changes, or schema changes are required. |
| Release candidate command dry-run | Settings > Release readiness operation checklist | `readiness-markdown-bundle` | Release handoff decision cockpit and approval-gated operation checklist | Command plan and expected smoke assertions only; no push/deploy/restart | Do not run push, deploy, restart, or public smoke before user approval. |

## Operator review workflow

- Settings > Release readiness shows each rehearsal lane as a local checkbox row, plus a summary row for reviewed count, operator-review versus approval-required boundaries, and dry-run packet count.
- `Mark rehearsals` records all rehearsal lanes as reviewed; the reset control clears only this local review state.
- Saved release-readiness history stores `reviewedAutomationRehearsalIds`, shows the selected saved rehearsal review summary in the handoff export panel, exports each Automation Rehearsal line as checked/open Markdown, and includes the dry-run anchor, evidence packet, comparison target, local diff artifact, rehearsal outcome, and stop condition.
- Export readiness remains incomplete until review, handoff capture, alert review, automation rehearsal review, media/runtime triage review, and local evidence export review are all complete.

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

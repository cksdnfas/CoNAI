# Phase 08: QA, Hardening, and Cutover

## Objective

Finalize production readiness and switch default frontend usage from legacy UI to shadcn UI.

## In Scope

- Full regression test pass on critical user journeys:
  - login/auth
  - browse/search/filter/bulk
  - image detail/editor
  - group/upload
  - generation/workflow
  - settings/integrations
- Performance and stability checks:
  - route-level render performance
  - large image list behavior
  - memory/leak checks in editor and workflow pages
- Deployment and runtime updates:
  - default startup script decision
  - documentation updates
  - rollback instructions

## Out of Scope

- New feature development not required for parity.

## Work Breakdown

1. Build final parity report against Phase 01 matrix.
2. Run automated and manual regression suite.
3. Fix blocking defects by severity.
4. Update docs/scripts and prepare controlled cutover.

## Commit Checkpoints

- `test(shadcn-phase-08): add route-level smoke and regression suite`
- `fix(shadcn-phase-08): resolve parity blockers from final QA`
- `chore(shadcn-phase-08): update root scripts and docs for shadcn default`
- `docs(shadcn-phase-08): add rollback and release checklist`

## Test Checkpoints

Automated:

- `cd frontend-shadcn-test && npm run lint`
- `cd frontend-shadcn-test && npm run build`
- Run full test suite command(s) introduced in earlier phases

Manual:

- Browser compatibility check for supported targets.
- Deep-link and refresh checks on all hash routes.
- Failure-mode checks: backend down, slow network, invalid payloads.

Release Gates:

- Zero open P0/P1 parity defects.
- All critical route smoke checks green.
- Rollback path documented and verified.

## Exit Criteria

- shadcn frontend can replace legacy frontend for daily operations.
- Cutover decision can be made with low migration risk.


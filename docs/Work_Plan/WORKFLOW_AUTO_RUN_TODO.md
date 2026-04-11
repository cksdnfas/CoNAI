# Workflow Auto-Run TODO

## Backend foundation
- [x] Add `graph_workflow_schedules` table to user settings schema.
- [x] Add schedule-related indexes.
- [x] Add schema compatibility path for older DBs.
- [x] Extend `graph_executions` with `trigger_type` and `schedule_id`.
- [x] Update schema smoke test expectations.

## Backend models and service
- [x] Add `GraphWorkflowScheduleModel`.
- [x] Add schedule status and type definitions to `moduleGraph.ts`.
- [x] Add `GraphWorkflowScheduleService` polling loop.
- [x] Add next-run calculation helpers for `once`, `interval`, and `daily`.
- [x] Add overlap detection rules for unlimited and limited schedules.
- [x] Add automatic stop and pause reason recording.

## Queue and execution integration
- [x] Extend `GraphWorkflowExecutionQueue.enqueue(...)` to accept schedule metadata.
- [x] Persist schedule metadata on execution rows.
- [x] Add queue cleanup helpers by schedule id.
- [x] Add execution counting helpers for reserved runs per schedule.

## Workflow maintenance integration
- [x] Pause related schedules when a workflow changes.
- [x] Cancel queued scheduled executions when a workflow changes.
- [x] Delete related schedules when a workflow is deleted.
- [x] Cancel queued scheduled executions when a workflow is deleted.
- [x] Request cancellation for running scheduled executions on workflow deletion.

## API
- [x] Add schedule list route.
- [x] Add schedule create route.
- [x] Add schedule update route.
- [x] Add schedule pause and resume route.
- [x] Add schedule delete route.
- [x] Add run-now route.

## Frontend
- [x] Extend workflow browse API types for schedules.
- [x] Add auto-run list section to `module-workflow-empty-runs-tab.tsx`.
- [x] Add schedule status badges and stop-reason display.
- [x] Add schedule create and edit UI.
- [x] Reuse workflow runner input controls for schedule input values.
- [x] Add schedule pause, resume, run-now, and delete actions.
- [ ] Add workflow-change review UX.

## Verification
- [x] Build backend.
- [x] Build frontend.
- [ ] Test one-time schedule.
- [ ] Test repeating interval schedule.
- [ ] Test daily schedule.
- [ ] Test unlimited overlap stop behavior.
- [ ] Test limited overlap queue accumulation up to max runs.
- [ ] Test failure-driven stop behavior.
- [ ] Test workflow delete cleanup.
- [ ] Test workflow change pause and queue cleanup.
- [ ] Test restart recovery.

# Workflow Auto-Run Plan

## Goal
Add a reliable auto-run system to `/generation?tab=workflows`, inside the existing `Queue & Empty Runs` area, so saved workflows can run on a schedule with persisted input values and safe maintenance behavior.

## Required Schedule Types
1. One-time execution.
2. Repeating execution every N minutes.
3. Daily execution at HH:mm.

## Required Runtime Rules
- Scheduled executions must reuse the existing workflow execution queue instead of inventing a separate runner.
- Each schedule must persist its workflow input values in the same exposed-input shape already used by manual workflow runs.
- If a scheduled execution fails, the schedule must stop automatically and preserve the failure reason.
- Unlimited repeating schedules must stop when a new trigger arrives while the same schedule already has a queued or running execution.
- Limited repeating schedules may enqueue overlap, but the total reserved amount must never exceed the configured maximum run count.

## Required Maintenance Rules
### Workflow deleted
- Warn that linked auto-run schedules will also be removed.
- Remove linked schedules.
- Cancel queued scheduled executions for those schedules.
- Request cancellation for running scheduled executions when possible.
- Preserve a visible cleanup reason.

### Workflow changed
- Pause linked schedules automatically.
- Clear queued scheduled executions for those schedules.
- Preserve a visible pause reason.
- Require explicit user review before re-enabling the schedule.

## Core Design
### Persistence
Add DB-backed workflow schedule records instead of storing schedule state in memory.

### Execution linkage
Extend graph execution records so scheduled runs can be traced back to their schedule:
- trigger type (`manual` or `schedule`)
- schedule id

### Safety metadata
Each schedule should remember the workflow version and workflow input definition snapshot it was last confirmed against, so workflow edits can force a pause.

## Proposed Backend Pieces
1. `graph_workflow_schedules` table
2. `GraphWorkflowScheduleModel`
3. `GraphWorkflowScheduleService`
4. schedule-aware execution queue metadata
5. workflow update/delete hooks for schedule cleanup and pause
6. schedule CRUD and list routes

## Proposed Frontend Pieces
1. Add a new auto-run section inside `대기열 · 빈 실행`.
2. Show schedule rows with:
   - workflow name
   - schedule type
   - next run time
   - status
   - last execution result
   - stop or pause reason
3. Add create/edit UI that reuses workflow input controls.
4. Add explicit actions:
   - create
   - edit
   - pause
   - resume
   - run now
   - delete
   - review after workflow change

## Status Model
Recommended schedule status values:
- `active`
- `paused`
- `error_stopped`
- `overlap_stopped`
- `completed`

## Verification Goals
1. One-time schedule runs once and then completes.
2. Every-N-minutes schedule computes and stores the next run correctly.
3. Daily schedule computes the next local run correctly.
4. Failed scheduled execution stops future runs and stores the reason.
5. Unlimited repeating overlap stops the schedule with a clear reason.
6. Limited repeating overlap enqueues only up to the configured maximum total run count.
7. Workflow delete cleans schedules and scheduled queue entries.
8. Workflow update pauses schedules and clears scheduled queue entries.
9. Server restart restores schedules from DB and resumes polling safely.

## Immediate Implementation Order
1. Add schema and execution metadata foundations.
2. Add schedule model and backend service.
3. Add workflow change and delete maintenance hooks.
4. Add schedule routes.
5. Add frontend auto-run list.
6. Add create and edit modal.
7. Verify behavior with focused manual tests.

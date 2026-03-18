# Group Explorer Commonization Notes

## Current judgement
Full immediate unification is risky right now.
Use a staged approach:
1. normalize state model first
2. extract shared layout next
3. keep source-specific behavior in adapters

## Why risky now
- custom and auto-folder recently diverged in mobile sheet state handling
- auto-folder had a runtime loop (`Maximum update depth exceeded`)
- auto-folder uses `AutoFolderGroupWithStats`, custom uses `GroupWithStats`
- custom has CRUD/settings actions, auto-folder is read-only + rebuild

## Safe commonization target
Shared layout only:
- group explorer shell
- breadcrumb placement
- desktop right panel vs mobile bottom sheet layout
- empty/loading states
- shared image browser panel wiring

## Keep separated via adapters
- group loading APIs
- breadcrumb/detail fetching
- group data normalization
- readOnly/rebuild/custom settings actions
- image remove/assign policy

## Immediate prerequisite completed/required
- mobile sheet open state must be separate from selected image group state
- both custom and auto-folder should follow the same state model

## Suggested next implementation
- extract `GroupExplorerLayout` (presentational)
- extract `useGroupImagePanelState` or similar controller
- create adapters:
  - custom group explorer adapter
  - auto-folder group explorer adapter

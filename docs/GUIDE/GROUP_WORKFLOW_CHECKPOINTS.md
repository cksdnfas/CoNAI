# Group Workflow Checkpoints

Last updated: 2026-03-27
Project: CoNAI

## Scope

This note tracks the recently connected group-management workflows so they can be reviewed later without re-auditing the code first.

## Implemented workflows

### 1. Custom group management

- Create custom groups from the Groups page.
- Create nested child groups.
- Edit group name / description / color / parent group.
- Delete a group.
- Delete with or without cascading child-group removal.
- Root move is supported through `parent_id = null` handling.

### 2. Auto-collect management

- Enable or disable auto-collect per custom group.
- Edit auto-collect rules with chip-first UI.
- Fall back to raw JSON editing when stored rules cannot be represented safely as chips.
- Run auto-collect manually from the group detail card.
- Display last auto-collect execution time on the group detail card.

### 3. Image assignment workflows

- Home feed:
  - multi-select images
  - add selected images to a custom group
- Image detail page:
  - add current image to a custom group
- Image detail modal:
  - add current image to a custom group
- Groups page:
  - multi-select images inside a group
  - add selected images to another custom group
  - remove selected images from the current custom group

## Review checkpoints

### Group creation / editing

- [ ] Creating a root custom group works.
- [ ] Creating a child group under an existing group works.
- [ ] Editing a group can move it to another parent.
- [ ] Editing a group can move it back to root.
- [ ] Circular parent assignment is rejected.
- [ ] Maximum hierarchy depth protection still works.

### Auto-collect editor

- [ ] Positive prompt chip adds expected `prompt_contains` condition.
- [ ] Negative prompt chip adds expected `negative_prompt_contains` condition.
- [ ] Auto chip adds expected `auto_tag_any` condition.
- [ ] Rating chip adds expected `auto_tag_rating_score` condition.
- [ ] OR / AND / NOT operator cycling produces expected group placement.
- [ ] Existing supported rules load back into chip mode.
- [ ] Unsupported stored rules open in JSON fallback mode without losing data.
- [ ] Saving chip-edited rules still passes backend validation.
- [ ] Manual auto-collect run updates counts / last-run information correctly.

### Image assignment

- [ ] Home multi-select -> custom group add works.
- [ ] Image detail page -> custom group add works.
- [ ] Image detail modal -> custom group add works.
- [ ] Adding an image already auto-collected in the target group converts it to manual as expected.
- [ ] Adding an image already manually present shows skip/conflict behavior cleanly.

### Group image management

- [ ] Group page multi-select works on desktop.
- [ ] Group drawer multi-select works on mobile layout.
- [ ] Selected group images can be added to another custom group.
- [ ] Selected images can be removed from the current custom group.
- [ ] Bulk remove reports removed / skipped counts correctly.
- [ ] Group image count badges refresh after add/remove actions.

### General UI sanity

- [ ] Selection bar only appears when there is an active selection.
- [ ] Group assign modal opens with custom-group list loaded.
- [ ] Empty custom-group state is handled gracefully.
- [ ] Snackbar feedback is shown for create / update / delete / assign / remove actions.
- [ ] No broken navigation between custom-group tab and watched-folder tab.

## Key files

### Backend

- `backend/src/routes/groups.mutation.routes.ts`
- `backend/src/routes/groups.hierarchy.routes.ts`

### Frontend

- `frontend/src/lib/api-groups.ts`
- `frontend/src/types/group.ts`
- `frontend/src/features/groups/group-page.tsx`
- `frontend/src/features/groups/components/group-editor-modal.tsx`
- `frontend/src/features/groups/components/group-assign-modal.tsx`
- `frontend/src/features/groups/components/auto-collect-chip-editor.tsx`
- `frontend/src/features/groups/components/group-image-section.tsx`
- `frontend/src/features/groups/components/group-image-drawer.tsx`
- `frontend/src/features/images/components/detail/image-group-assign-action.tsx`
- `frontend/src/features/images/components/image-selection-bar.tsx`
- `frontend/src/features/home/home-page.tsx`

## Notes

- Browser-level verification is intentionally deferred.
- The current implementation favors shipping the workflows first, then validating the interaction details later.
- There are unrelated working-tree changes in other areas of the repository; review commits selectively when preparing releases.

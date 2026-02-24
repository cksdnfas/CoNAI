# frontend-shadcn-test migration continuation plan

## Scope
- ONLY `frontend-shadcn-test` migration continuation.

## Current State (with evidence)
- Parity app is active: `frontend-shadcn-test/src/App.tsx` renders `ParityApp`, and README states Parity Hybrid mode (`frontend-shadcn-test/README.md`:40).
- shadcn infrastructure exists: `frontend-shadcn-test/components.json` has shadcn schema/aliases and `ui` alias at `@/components/ui`.
- MUI is still dominant in many feature paths: `frontend-shadcn-test/src/features/home/home-page.tsx` imports from `@mui/material`, and README marks migration as in-progress (`frontend-shadcn-test/README.md`:91-97).

## Checklist
- [ ] Replace `@mui/material` usage in `frontend-shadcn-test/src/features/home/home-page.tsx` with local shadcn/ui composition while preserving behavior. Verify with `npm run build` in `frontend-shadcn-test/`.
- [ ] Migrate one high-impact image-generation surface from legacy dependency to local feature implementation under `frontend-shadcn-test/src/features/image-generation/`. Verify with `npm run test -- src/features/image-generation` in `frontend-shadcn-test/`.
- [ ] Reduce direct legacy imports in workflow route containers under `frontend-shadcn-test/src/features/workflows/` by introducing local wrappers/components. Verify with `npm run test -- src/features/workflows` in `frontend-shadcn-test/`.
- [ ] Update migration status notes in `frontend-shadcn-test/README.md` to reflect completed slice and remaining legacy targets. Verify with `grep "src/legacy" frontend-shadcn-test/README.md` from `Comfyui_Image_Manager_2/`.
- [ ] Run final regression pass for migration slice (`login`, `home`, `image-generation`, `workflows`) and record results in notepads for `frontend-shadcn-test-ulw`. Verify with `npm run dev:frontend:shadcn` from `Comfyui_Image_Manager_2/` and route-check in browser.

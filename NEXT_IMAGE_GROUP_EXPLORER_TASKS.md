# Next Image Group Explorer Tasks

## Background
Custom / auto-folder image groups were converted from modal browsing to explorer-style embedded panels.
Current baseline commits:
- `6a492cc` feat: switch custom image groups to explorer layout
- `f9b10e0` feat: switch auto-folder groups to explorer layout
- `9d7cade` refactor: polish embedded image group explorer panels

## Next candidate tasks
1. Breadcrumb / back-navigation polish
   - Make explorer navigation feel more like a file browser
   - Review whether current breadcrumb placement and root return flow are sufficient

2. Left panel density tuning
   - Adjust card density / sizing for group browsing
   - Check whether current grid is too sparse or too card-heavy for explorer usage

3. Right panel action layout cleanup
   - Revisit action button grouping in embedded image panel header
   - Ensure download / remove / assign / close actions feel natural in non-modal layout

4. Embedded panel behavior review
   - Re-check scroll feel, height behavior, and empty-state balance
   - Confirm modal-era assumptions are fully removed where no longer appropriate

## Important constraint
- Keep using the existing `ImageList`
- Do not replace the current image list implementation; only adjust surrounding explorer layout/UX

# Project Image Brief

## Project
- Name: CoNAI
- Type: Web app / AI image-generation management UI
- Root: D:\Share\0_DEV\Management\Deploy\CoNAI
- One-line context: Dark, tool-heavy creative AI web interface for generation workflows, result browsing, and automation controls.

## Visual Style
- Overall style: Modern dark UI, crisp, tech-forward, compact/readable at small sizes.
- Existing references: `frontend/src/index.css` theme tokens; no existing app favicon/logo asset found beyond vendor media.
- Canvas / aspect / resolution: Favicon/icon candidates should be square and readable at 16/32/64px; review sheets may use fixed grid cells.
- Palette / colors: Dark graphite base (`#131313`, `#1c1b1b`, `#201f1f`) with warm orange primary (`#f95e14`) and peach secondary (`#ffb59a`).
- Linework / outline: Clean geometric silhouettes, strong contrast, minimal internal details.
- Lighting / shading: For favicon candidates, avoid glow/gradients/3D/ornate rendering; prioritize flat, bold silhouettes that read at 16px.
- Background / transparency: Final favicon candidates should work on transparent or dark backgrounds. Review sheets may use helper-color backgrounds for slicing.
- UI or engine constraints: Must remain legible as browser favicon / app icon; no text, no tiny UI labels.

## Asset Guidelines
- Preferred formats: SVG first for final favicon/logo candidates; PNG/WebP only for review previews; ICO can be derived after user chooses a direction.
- Naming pattern: `conai-icon-candidates-YYYYMMDD.*` for review sheets.
- Output location for test assets: `tmp/agent-scratch/project-images/` under the project root.
- Do not modify/apply assets unless explicitly requested: Yes.

## Prompt Notes
- Reusable prompt seed: CoNAI brand icon candidates: minimal creative-AI/tooling favicon marks, flat dark graphite + warm orange/peach, bold simple silhouette, readable at 16/32px.
- Negative constraints: No text, no letters, no watermarks, no complex scenes, no faces, no copyrighted logos, no tiny unreadable details, no ornate gradients, no 3D renders, no miniature illustrations.

## Change Log
- 2026-05-01: Initial brief created for 20 favicon/icon candidate sprite sheet generation.
- 2026-05-01: User rejected generated/raster attempts as too decorative or fake-looking; switched favicon direction to clean hand-designed SVG logo marks with 16/32px readability previews.

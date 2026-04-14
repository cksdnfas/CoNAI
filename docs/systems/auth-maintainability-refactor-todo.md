# Auth Maintainability Refactor TODO, 2026-04-13

## Rules
- Keep behavior unchanged.
- Prefer readability over aggressive decomposition.
- Stop extracting when the next split would make the feature harder to follow.
- Verify after each track.

## Track 1, Frontend security tab
- [ ] Review current `security-tab.tsx` responsibilities and define the smallest clean section boundaries.
- [ ] Extract auth/security query and mutation wiring into one focused nearby data module or hook.
- [ ] Extract status, account form, account list, page access, and recovery UI into a small nearby component set.
- [ ] Keep `SecurityTab` as the top-level composition entry.
- [ ] Verify with `npm run build:frontend`.

## Track 2, Backend auth routes
- [ ] Review `auth.routes.ts` and separate router registration from reusable auth/session payload helpers.
- [ ] Extract current-session payload shaping into a helper module.
- [ ] Extract handler helpers only where they reduce repetition and scrolling.
- [ ] Keep route paths and API responses stable.
- [ ] Verify with `npm run build:backend`.

## Track 3, Backend auth DB bootstrap
- [ ] Review `authDb.ts` and identify the simplest split between schema setup, seed/default setup, and bootstrap orchestration.
- [ ] Extract schema creation into a nearby helper if it meaningfully improves readability.
- [ ] Extract seed/normalization logic into a nearby helper if it keeps SQL easier to scan.
- [ ] Keep legacy migration and legacy-admin sync explicit and easy to trace.
- [ ] Verify with `npm run build:backend`.

## Track 4, Small follow-up cleanup
- [ ] Re-check `settings-page.tsx` after the auth-specific cleanup.
- [ ] Apply only minimal follow-up extraction if there is an obvious low-risk win.
- [ ] Avoid turning this into a full settings-page rewrite.

## Final verification
- [ ] Run `npm run build:frontend`.
- [ ] Run `npm run build:backend`.
- [ ] Run `npm run build:frontend && npm run build:backend`.
- [ ] Summarize what changed, what stayed intentionally unsplit, and what should wait for a later wave.

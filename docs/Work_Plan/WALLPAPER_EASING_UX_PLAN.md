# Wallpaper Easing UX Plan

## Goal
Make wallpaper widget easing controls feel like real animation controls instead of isolated curve pickers.

## Problems Observed
- The custom cubic-bezier editor only exposes the two movable control points, which makes the graph feel incomplete even though start/end anchors are implicit.
- Transition speed/duration and hover intensity are configured outside the easing picker, so the easing preview does not reflect the actual widget behavior.
- Transition, hover, and motion controls are scattered across widget inspector sections, which weakens the mental model of "animation settings".

## Bounded Scope
1. Keep the existing stored settings model intact.
2. Improve the easing picker so it can receive contextual preview settings and related inline controls.
3. Merge the most directly related controls into the easing UI for wallpaper image widgets:
   - transition style + transition speed next to transition easing
   - hover intensity next to hover easing
4. Make the preview panel reflect the current settings where possible:
   - transition duration
   - hover intensity
   - motion strength / speed when the picker is used for motion easing
5. Clarify the custom bezier editor by showing fixed start/end anchors more explicitly.

## Non-Goals
- No backend or persistence schema changes.
- No broad wallpaper-inspector redesign beyond animation-related grouping.
- No attempt to unify every widget-specific motion behavior into one runtime engine.

## Expected Result
- Users adjust animation settings from one clearer place.
- The preview behaves closer to the actual configured widget behavior.
- The custom easing graph feels less confusing.

# Wallpaper Widget Layout Work Plan

## Goal

Build a wallpaper-oriented layout editor for CoNAI that feels like a phone home-screen widget editor.

Users should be able to:

- choose a target canvas resolution or aspect ratio
- add widgets into a bounded canvas area
- move and resize widgets visually
- save multiple layout presets
- switch between edit mode and wallpaper runtime mode
- use the result with tools such as Lively Wallpaper or Wallpaper Engine

## Product Direction

This feature is **not** a single fixed wallpaper page.

It is a **widget layout system** composed of:

1. a wallpaper layout editor
2. a wallpaper runtime page
3. a widget registry with reusable widget types
4. persistent user layout presets

## Core UX Model

The interaction model should follow the mental model of a mobile widget layout editor:

- select a canvas preset
- open a widget library
- add widgets to the canvas
- drag to reposition
- drag handles to resize
- select a widget to edit its settings
- save the layout as a reusable preset
- preview the final wallpaper mode without editor chrome

## Phase Boundaries

### Phase 1, System foundation

Build the minimal architecture needed to support future widgets without reworking storage or layout logic.

Deliverables:

- wallpaper feature route structure
- layout preset data model
- widget definition and widget instance model
- canvas preset model
- edit mode versus runtime mode separation
- grid-based placement and resize system

### Phase 2, First usable editor

Build the first end-to-end editor experience.

Deliverables:

- canvas preset selector
- empty wallpaper canvas
- widget library panel
- add, remove, move, resize widgets
- right-side widget settings panel
- preset save and load

### Phase 3, Initial widget set

Ship a small but useful widget catalog.

Initial widget candidates:

- clock widget
- queue status widget
- group image view widget
- image showcase or slideshow widget
- text note widget

### Phase 4, Wallpaper runtime mode

Build a clean runtime page meant for wallpaper tools.

Deliverables:

- runtime-only route with editor UI removed
- configurable refresh behavior per widget
- reduced interaction surface for wallpaper use
- stable rendering for different resolutions

## Key Design Decisions

### 1. Use grid-based layout first

The first implementation should use a grid layout instead of freeform pixel positioning.

Reason:

- easier save and restore
- easier snapping and alignment
- easier resolution scaling
- easier preset portability across aspect ratios

Recommended starting point:

- 24-column grid
- row height derived from canvas size or fixed logical unit
- snap enabled by default

### 2. Separate widget definitions from widget instances

A widget type and a placed widget are different things.

Example:

- widget definition: `clock`
- widget instance: `clock #1 at x=0 y=0 w=6 h=4`

This separation is required for clean extensibility.

### 3. Separate edit mode from runtime mode

Edit mode responsibilities:

- selection
- drag and resize handles
- add and delete actions
- settings editing
- alignment helpers

Runtime mode responsibilities:

- display widgets only
- no editor chrome
- minimal pointer interference
- stable refresh behavior

### 4. Treat canvas presets as first-class objects

The user should be able to choose from presets such as:

- 1920x1080
- 2560x1440
- 3440x1440
- 1080x1920
- custom width and height

Canvas presets should define:

- width
- height
- aspect ratio label
- grid columns
- optional safe area or margin

## Data Model Draft

### Wallpaper layout preset

Stores one saved layout configuration.

Fields:

- `id`
- `name`
- `canvasPresetId` or inline canvas config
- `widgets[]`
- `themeSettings`
- `createdAt`
- `updatedAt`

### Wallpaper widget definition

Describes one available widget type.

Fields:

- `type`
- `title`
- `description`
- `defaultSize`
- `minSize`
- `maxSize`
- `defaultSettings`
- `settingsSchema`

### Wallpaper widget instance

Represents one widget placed on a layout.

Fields:

- `id`
- `type`
- `x`
- `y`
- `w`
- `h`
- `zIndex`
- `locked`
- `hidden`
- `settings`

## Widget Requirements

All widgets should support a shared base contract where applicable.

Common capabilities:

- title on or off
- background on or off
- opacity
- padding
- border radius
- lock position
- hide widget
- refresh interval if data-driven

## Initial Widget Scope

### Clock widget

Settings examples:

- time format
- seconds on or off
- timezone mode
- date on or off
- alignment

### Queue status widget

Settings examples:

- source queue
- visible counters
- refresh interval
- warning thresholds

### Group image view widget

Settings examples:

- target group
- sort mode
- visible count
- layout mode
- refresh interval

### Image showcase widget

Settings examples:

- source selection
- slideshow interval
- fit mode
- caption on or off

### Text note widget

Settings examples:

- text content
- typography
- alignment
- background style

## Technical Constraints

- The editor must work as a normal web page first.
- The runtime page must remain compatible with wallpaper tools that load a webpage or URL.
- The system should avoid assumptions that require Electron-only APIs.
- The first pass should not depend on Wallpaper Engine-specific APIs.
- Authentication and session-sensitive behavior should be handled carefully for wallpaper runtime pages.

## Non-Goals for the First Pass

Do not include these in the first implementation unless required later:

- freeform overlapping desktop-like window system
- complex animation timeline editor
- per-widget scripting system
- multi-user collaboration
- automatic cross-resolution perfect relayout

## Recommended Implementation Order

1. Define TypeScript types for canvas presets, widget definitions, widget instances, and layout presets.
2. Create routes for editor mode and runtime mode.
3. Implement the canvas shell and grid placement system.
4. Implement widget registry and widget renderer contract.
5. Implement add, move, resize, remove, and select interactions.
6. Implement widget settings panel.
7. Implement preset persistence.
8. Ship the first widget set.
9. Add runtime polishing for wallpaper usage.

## Success Criteria

The first milestone is successful when all of the following are true:

- a user can create a wallpaper layout from a chosen canvas preset
- a user can add at least 4 different widget types
- widgets can be moved and resized reliably
- the layout can be saved and loaded
- runtime mode renders the layout without editor controls
- the runtime page works as a normal webpage suitable for wallpaper tools

## Immediate Next Task

Start with the foundation, not visual polish.

The next implementation step should be:

1. create the TypeScript data model
2. define route structure for editor and runtime pages
3. build the empty canvas editor shell with grid support

## Working Rule

Until this plan changes, implementation should follow this document and avoid jumping directly into isolated widget UI work without the shared layout foundation.

# Danbooru Read-Only Browser for Prompts

## Goal

Add a new tab under `#/prompts` that lets users browse the local `danbooru.sqlite` database in a clean, spreadsheet-style interface without writing to that database.

## Data Source

Default database path:

```text
user/database/danbooru.sqlite
```

If the exact default file is missing, the backend auto-detects the first DB file in `user/database` whose file name contains `danbooru` and whose extension is `.sqlite`, `.sqlite3`, or `.db`. The backend may override this with `DANBOORU_SQLITE_PATH`, but the connection must always be opened in read-only mode and protected with `PRAGMA query_only = ON`.

When no matching DB exists, the Danbooru tab shows the download/viewer guide at `https://github.com/cksdnfas/danbooru-db-viewer` and the expected local folder/path.

## UX Requirements

- Add a new top tab under the Prompts page: `Danbooru`.
- Use the existing Prompts page layout pattern:
  - left sidebar
  - main content panel
  - compact controls
- Use an Excel / spreadsheet-style table surface for the content area.
- Sidebar must reuse the existing explorer/sidebar visual shell and render as a tree view.
- Main sidebar sections must be only:
  - Tags
  - Artists
  - Characters
- Tags expands into the existing Danbooru taxonomy groups from `taxonomy_nodes` / `taxonomy_tag_memberships`.
- Artists must stay as a top-level section only; do not duplicate it as a tag category child.
- Characters must stay as a top-level section and may contain copyright/franchise character filters under it.
- Numeric display uses compact K units:
  - `1000 -> 1K`
  - `123751 -> 123.8K`

## Table Requirements

### Tags

Columns:

- Tag
- Usage count

Tag categories should be represented in the sidebar tree, not as a table column.

### Artists

Columns:

- Artist
- Works count
- Danbooru link action

Link format:

```text
https://danbooru.donmai.us/posts?tags={artist_name}
```

### Characters

Columns:

- Character
- Works count
- Copyright
- Related tags
- Danbooru link action

Character browsing must use pagination with a default and maximum page size of 30 rows. Related tags should wrap inside the cell and expand row height vertically instead of forcing horizontal scrolling.

## Backend API Plan

Add a read-only API mounted under:

```text
/api/danbooru-browser
```

Endpoints:

- `GET /summary`
  - Returns counts and sidebar tree metadata.
- `GET /tags?q=&category=&page=&limit=`
  - Returns paged tags.
- `GET /artists?q=&page=&limit=`
  - Returns paged artists.
- `GET /characters?q=&copyrightTagId=&page=&limit=`
  - Returns paged characters with copyright names and related tags.

## Implementation Notes

- Use `better-sqlite3` because the backend already uses it.
- Use `{ readonly: true, fileMustExist: true }` for the Danbooru database connection.
- Run `PRAGMA query_only = ON` immediately after opening the connection.
- Clamp pagination limits server-side.
- Avoid joining all character related tags globally; query related tags only for the current character page.
- Keep this feature read-only: no mutations, migrations, or writes to `danbooru.sqlite`.

## TODO

- [x] Confirm local DB is readable in read-only mode.
- [x] Inspect source tables and required columns.
- [x] Add backend read-only Danbooru browser service.
- [x] Add backend Danbooru browser routes.
- [x] Register the API route with prompts page permissions.
- [x] Add frontend API client and types.
- [x] Add a Danbooru tab under `#/prompts`.
- [x] Add sidebar tree for Tags / Artists / Characters.
- [x] Add spreadsheet-style table views.
- [x] Add character pagination with 30 rows per page.
- [x] Format counts with compact K units.
- [x] Build and verify.
- [x] Replace raw Danbooru category-code sidebar with taxonomy group nodes.
- [x] Remove duplicate artist/character tag-category nodes from the Tags sidebar.
- [x] Keep character copyright/franchise filter nodes under Characters.
- [x] Generalize taxonomy parent resolution for key-prefix, manual/proposed parent, and TAG LAB parent-group cases.
- [x] Sort `Unclassified` to the top within each sibling group.
- [x] Sort sidebar child groups by text instead of count, while keeping top-level order fixed as Artists / Tags / Characters.
- [x] Reuse the shared explorer sidebar shell.
- [x] Align character Works separately from Copyright so it does not visually run into the next column.
- [x] Truncate long sidebar labels before they collide with count badges.

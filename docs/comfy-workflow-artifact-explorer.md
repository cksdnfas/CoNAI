# ComfyUI Workflow Artifact Explorer

## Problem

The existing ComfyUI workflow result surface is history-first. That works for image and video generation because generated media is processed into the media database and then rendered by the generation history UI.

Some ComfyUI workflows produce outputs that should not be treated as gallery media: audio files, LoRA/checkpoint files, archives, logs, datasets, or training result folders. For these workflows, forcing every output through history/media processing creates two problems:

- non-image artifacts are hard to inspect from the workflow UI;
- generated artifacts can pollute watched media folders and media metadata tables.

## Goal

Allow selected ComfyUI workflows to use a file-service-backed artifact explorer instead of the generation history viewer.

The explorer is intentionally filesystem-first:

- artifact files are not inserted into media metadata tables;
- artifact files are not inserted into generation history as individual outputs;
- the UI lists files from an allowed workflow artifact root on demand;
- no metadata extraction, thumbnail generation, hashing, conversion, or post-processing is performed;
- only file organization is performed after ComfyUI execution.

## Workflow Settings

Each ComfyUI workflow can choose one result surface:

- `history`: default behavior. Outputs are processed into the existing media/history pipeline.
- `artifact_explorer`: outputs are copied/moved into a workflow artifact folder and displayed by the artifact explorer.

Artifact explorer workflows also choose one directory layout:

- `shared`: every run writes directly under the workflow artifact root.
- `per_run`: every run writes into a timestamped run directory under the workflow artifact root.

The root path may be customized per workflow. If it is empty, the backend uses a safe default under the runtime data root:

```text
<runtime-data-root>/artifacts/comfy-workflows/<workflow-id>-<workflow-slug>/
```

## Watcher Rule

Artifact roots must remain outside watched media folders. The default artifact root satisfies this because it is not under uploads/save watched-media roots. If a custom root is used, the operator must keep it outside watched folders.

The backend artifact file routes only serve files under the resolved workflow artifact root. Relative paths are normalized and path traversal is rejected.

## API Surface

### List workflow artifacts

```http
GET /api/workflows/:id/artifacts?path=<relative-directory>
```

Returns current directory entries with names, relative paths, file kind, size, modified time, MIME type, and file URLs.

### Stream or download one artifact

```http
GET /api/workflows/:id/artifacts/file?path=<relative-file>&download=1
```

Streams only files inside the workflow artifact root.

## UI Surface

When a selected ComfyUI workflow uses `artifact_explorer`, the image generation page replaces the generation history panel with a Windows-Explorer-style browser:

- breadcrumb navigation;
- thumbnail grid with latest-first sorting;
- folder cards that can show a representative image from inside the folder;
- image hover previews for quick inspection;
- open/download actions for every file.

When a workflow uses `history`, the current generation history viewer remains unchanged.

## Execution Behavior

For artifact explorer workflows:

1. Submit the ComfyUI prompt as usual.
2. Wait for completion and download every ComfyUI history output entry for artifact workflows, so final preview images and file-output artifacts from different output nodes are preserved together. History workflows keep the existing final-output-only behavior.
3. Copy/move outputs into the workflow artifact folder, preserving ComfyUI output subfolders when present.
4. Preserve the original output file name where possible, adding a suffix only when a file already exists.
5. Do not process files through media registration, hashing, metadata extraction, or thumbnail generation.
6. Do not create per-file database artifact rows.

For history workflows, existing behavior is unchanged.

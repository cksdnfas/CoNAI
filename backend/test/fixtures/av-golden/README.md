# av-golden: reference fixtures for the audio / sprite port

These are golden outputs from the original Python apps, captured on small fixed inputs:
`video-sprite-extractor` (sprite) and `stable-audio-sfx-manager` (audio). The originals
have no tests, so these captured outputs are the correctness oracle for the
Node/TypeScript re-implementation. Everything here was produced by calling the
original functions directly. The original sources were not modified.

`manifest.json` lists every case with its input, the exact options/arguments
passed, every ffmpeg argv (paths replaced by `{input}`, `{workspace}` and `{output}`),
output files with `sha256` and, for images, `rgba_sha256` (SHA-256 of the
decoded straight RGBA bytes, row-major), plus numeric results.

## Tools used

| tool | version |
|---|---|
| ffmpeg | 6.1.1 essentials_build (gyan.dev), `node_modules/ffmpeg-static/ffmpeg.exe` |
| ffprobe | 4.0.2, `node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe` |
| Python | 3.12.0 (each original app's own venv) |
| numpy / Pillow | 2.5.2 / 12.3.0 (sprite venv) |
| pydantic / fastapi | 2.13.5 / 0.141.1 (audio venv) |

Both originals call bare `ffmpeg` / `ffprobe`. The generators put the two
pinned binaries first on `PATH`, and `common.setup_tool_path` checks that they are first.

## Regenerate

```sh
AV_GOLDEN_TMP=<scratch dir> sh backend/test/fixtures/av-golden/_generate/generate.sh
```

- `make_inputs.py` (sprite venv) builds the synthetic inputs: Pillow frames
  encoded with libx264/yuv420p, and WAVs from `aevalsrc`.
- `sprite_cases.py` (sprite venv) runs the sprite cases.
- `audio_cases.py` (audio venv) runs the audio cases.

A second run with the same tools reproduces every file byte-for-byte. The one
exception is the OGG exports (see the Audio section).

## Sprite (`sprite/`, original `app/media.py`)

- `inputs/`: `magenta.mp4` and `green.mp4` (128x128, 12 fps, 24 frames). Each has
  an anti-aliased subject, a blurred translucent glow, near-key tints and a thin
  white stroke. `green.mp4` also has a #0000FF band. `dupes.mp4` holds each pose
  for 3 frames. There are also 32x32 despill vectors and normalization sheets.
- `sheets/<case>/sprite-sheet.png`: the
  `build_sprite_sheet(source, workspace, probe_video(source), SpriteOptions(...))`
  atlas. As in `POST /api/sprite-sheet`, `end_time=None` resolves to
  `metadata.last_frame_time`. Baseline options: magenta despill, tolerance 0.08,
  softness 0.92, edge cleanup on, interval 0.25 s, auto crop on at alpha 20,
  8 columns, spacing 0. Colorkey cases use `background_mode=color` with
  0.10 / 0.05, the web-UI defaults. Each case changes only what its name says.
  `output_webp_q80` also re-encodes the atlas with
  `encode_static_image_path(..., static_image_output("webp", 80))`.
- `frames/`: a content-addressed pool of per-frame PNGs shared by all cases.
  In each case, `raw_frames` are the frames just after the ffmpeg extraction
  (snapshotted by wrapping `media._run` in-process). `frames` are the final
  frames after despill, auto-crop and dedupe, as they go into `tile`.
  Use raw to processed to test the pixel stages in isolation from ffmpeg.
- `despill_unit/`: `_remove_magenta_color_difference_background([png], tol, soft, edge_cleanup)`
  on hand-made 32x32 RGB frames. `intermediate` records the border ratio and
  the float32 background median.
  v1 has an exact key and a mix ramp. v2 has a drifted, noisy key and a soft disc.
  v3 has a contour spike that triggers outlier suppression, plus a chroma-bleed
  row that triggers alpha refinement. v4 is a grey border that must raise.
- `normalize/<case>/`: the extracted ZIP contents (sheets, per-sheet JSON and
  manifests) from `build_normalized_sprite_archive`. One case uses
  `build_bulk_normalized_sprite_archive`. Error cases record the `MediaError` text.
- `animation/`: `build_sprite_animation` output for GIF, WebP and MP4 at 8 fps
  from `norm_sheet_a`.

Comparison guidance:
- Pixel stages (despill, auto-crop, normalization, dedupe decisions) are
  deterministic. Compare `rgba_sha256` exactly, or within ≤1 per channel for
  despill, since the original computes in float32 and rounds with `np.rint`.
- WebP, GIF and MP4 files are encoder-specific. Compare decoded frames, sizes
  and counts, never file bytes.
- `colorkey` keeps the original RGB under alpha 0, so compare RGB only where
  alpha > 0 unless the port preserves it too.

## Audio (`audio/`, original `sfx/audio.py`, `sfx/models.py`, `sfx/naming.py`)

- `inputs/`: a mono 44.1k sweep with a noise burst, 48k stereo tones, a
  near-silent clip (-100 dBFS), quiet audio with full-scale clicks, and a 0.2 s blip.
- `edit_filter_strings` (manifest only) is the primary oracle:
  `audio.filters(EditInput.model_validate_json(body), probe(...)["duration"])`.
  Each entry stores the JSON body exactly as sent.
- `renders/`: `audio.render(...)` output, WAV `pcm_s24le`. Byte equality across
  ffmpeg/rubberband builds is not guaranteed. Also compare `output_wav.frames`
  and the per-50 ms RMS list (`rms_dbfs_per_window`, ±0.5 dB).
- `exports/`: `audio.export(source, dest, ExportOptions(**options), probe(source))`.
  The manifest records the loudnorm measurement JSON, the branch taken
  (`two_pass_linear_loudnorm`, `linear_gain_fallback`, `unmeasurable_no_gain`
  or `no_normalize`) and the final `-af` chain. `verification_output_loudness`
  is a check made by the generator, not original code.
  OGG file bytes change on every run, because the ogg muxer picks a random
  stream serial and the original passes no `+bitexact`. For OGG, use
  `output_decoded.pcm_sha256` (an s16 decode with the pinned ffmpeg) instead.
- `naming`: `filename(label, index, count, format)` vectors,
  `validate_label` accept/reject vectors, and collision vectors. The collision
  vectors come from running the original `service.export_plan` against a
  throwaway SQLite.

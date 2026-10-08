"""Run the ORIGINAL video-sprite-extractor code on the synthetic inputs.

Run with the video-sprite-extractor venv python. The original package is
imported from SPRITE_APP_BACKEND (added to sys.path); nothing in it is
modified. `media._run` is wrapped (in this process only) to record each
ffmpeg argv and to snapshot the raw extracted frames before the Python
pixel stages (despill / auto-crop / dedupe) rewrite them.
"""
from __future__ import annotations

import dataclasses
import io
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (  # noqa: E402
    ROOT,
    SPRITE_APP_BACKEND,
    clean_dir,
    placeholder_argv,
    rel,
    setup_tool_path,
    sha256_bytes,
    sha256_file,
    tool_versions,
    update_manifest,
)

setup_tool_path()
sys.path.insert(0, str(SPRITE_APP_BACKEND))

import numpy as np  # noqa: E402
from PIL import Image, ImageSequence  # noqa: E402

from app import media  # noqa: E402
from app.errors import MediaError  # noqa: E402
from app.image_output import encode_static_image_path, static_image_output  # noqa: E402

INPUTS = ROOT / "sprite" / "inputs"
OUT = ROOT / "sprite"
FRAME_POOL = OUT / "frames"  # content-addressed pool shared by all cases
TMP = Path(tempfile.mkdtemp(prefix="av-golden-sprite-", dir=os.environ.get("AV_GOLDEN_TMP")))

# ------------------------------------------------------------------ helpers


def rgba_sha256(path: Path) -> str:
    with Image.open(path) as image:
        return sha256_bytes(image.convert("RGBA").tobytes())


def image_record(path: Path) -> dict:
    with Image.open(path) as image:
        size = list(image.size)
        mode = image.mode
    return {
        "file": rel(path),
        "sha256": sha256_file(path),
        "rgba_sha256": rgba_sha256(path),
        "size": size,
        "png_mode": mode,
    }


def pool_frame(path: Path) -> dict:
    digest = sha256_file(path)
    target = FRAME_POOL / f"{digest[:20]}.png"
    if not target.exists():
        shutil.copyfile(path, target)
    return image_record(target)


_calls: list[list[str]] = []
_raw_capture: list[Path] = []
_original_run = media._run


def _recording_run(command, timeout):
    _calls.append([str(part) for part in command])
    result = _original_run(command, timeout)
    if "-fps_mode" in command:  # the frame extraction call in build_sprite_sheet
        workspace = Path(command[-1]).parent
        _raw_capture.clear()
        for frame in sorted(workspace.glob("frame-*.png")):
            snapshot = TMP / "raw" / f"{workspace.name}-{frame.name}"
            snapshot.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(frame, snapshot)
            _raw_capture.append(snapshot)
    return result


media._run = _recording_run


def jsonable(value):
    if dataclasses.is_dataclass(value):
        value = dataclasses.asdict(value)
    if isinstance(value, dict):
        return {k: jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if isinstance(value, Path):
        return value.name
    return value


# ------------------------------------------------------------------ sprite sheet cases

BASELINE = dict(
    start_time=0.0,
    end_time=None,  # resolved to metadata.last_frame_time, like POST /api/sprite-sheet
    interval_seconds=0.25,
    sample_count=0,
    background_mode="chroma",
    chroma_method=media.CHROMA_METHOD_MAGENTA_DESPILL,
    key_colors=("#FF00FF",),
    tolerance=0.08,
    softness=0.92,
    ai_model="birefnet-dynamic-matting",
    ai_device="cpu",
    ai_edge_refinement=True,
    auto_crop=True,
    alpha_threshold=20,
    crop_x=0,
    crop_y=0,
    crop_width=0,
    crop_height=0,
    resize_mode="none",
    output_width=0,
    output_height=0,
    columns=8,
    spacing=0,
    chroma_edge_cleanup=True,
    remove_duplicate_frames=False,
    frame_similarity_threshold=0.99,
)
COLORKEY = dict(background_mode="color", chroma_method="ffmpeg", tolerance=0.10, softness=0.05)

SHEET_CASES = [
    ("colorkey_green_one_color", "green.mp4",
     {**COLORKEY, "key_colors": ("#00FF00",)}, {},
     "ffmpeg colorkey, one colour, web-UI defaults tolerance 10% / softness 5%"),
    ("colorkey_green_two_colors", "green.mp4",
     {**COLORKEY, "key_colors": ("#00FF00", "#0000FF")}, {},
     "two chained colorkey filters (green bg + blue band). OBSERVED: ffmpeg colorkey ASSIGNS alpha instead of "
     "combining it, so only the LAST colour (blue) ends up transparent and the green background stays opaque. "
     "This golden records the original (buggy) behaviour; a port that keys all colours will differ on purpose."),
    ("despill_magenta_cleanup_on", "magenta.mp4", {}, {},
     "baseline: magenta_color_difference_despill, tolerance 0.08 softness 0.92, edge cleanup ON"),
    ("despill_magenta_cleanup_off", "magenta.mp4", {"chroma_edge_cleanup": False}, {},
     "edge cleanup OFF (no near-background zeroing, no _refine_despill_edges)"),
    ("interval_mode_0p3s", "magenta.mp4",
     {"start_time": 0.25, "end_time": 1.75, "interval_seconds": 0.3}, {},
     "interval mode: trim + fps=1/0.3 round=near, interval not a multiple of the 1/12 s frame period"),
    ("count_mode_7", "magenta.mp4",
     {"start_time": 0.1, "end_time": 1.9, "sample_count": 7}, {},
     "count mode: select=eq(n,..) with indices from _sample_frame_indices"),
    ("auto_crop_off", "magenta.mp4", {"auto_crop": False}, {}, "auto crop disabled"),
    ("auto_crop_alpha_200", "magenta.mp4", {"alpha_threshold": 200}, {},
     "auto crop with alpha_threshold 200 (translucent glow excluded from union bounds)"),
    ("resize_contain_despill_square", "magenta.mp4",
     {"resize_mode": "contain", "output_width": 64, "output_height": 64}, {},
     "contain 64x64 on a square clip (no pad) followed by despill"),
    ("resize_contain_colorkey", "green.mp4",
     {**COLORKEY, "key_colors": ("#00FF00",), "resize_mode": "contain", "output_width": 64, "output_height": 48}, {},
     "contain 64x48 after colorkey (pad stays transparent)"),
    ("resize_cover", "magenta.mp4",
     {"resize_mode": "cover", "output_width": 48, "output_height": 64}, {}, "cover 48x64"),
    ("resize_stretch", "magenta.mp4",
     {"resize_mode": "stretch", "output_width": 64, "output_height": 40}, {}, "stretch 64x40"),
    ("precrop_manual", "magenta.mp4",
     {"crop_x": 8, "crop_y": 16, "crop_width": 104, "crop_height": 96}, {},
     "manual pre-crop applied in the ffmpeg filter before keying"),
    ("dedupe_despill_099", "dupes.mp4",
     {"interval_seconds": 1 / 12, "end_time": 1.0, "remove_duplicate_frames": True,
      "frame_similarity_threshold": 0.99}, {},
     "duplicate removal at 0.99 after despill; source holds each pose for 3 frames"),
    ("dedupe_opaque_099", "dupes.mp4",
     {"background_mode": "none", "chroma_method": "ffmpeg", "auto_crop": False,
      "interval_seconds": 1 / 12, "end_time": 1.0, "remove_duplicate_frames": True,
      "frame_similarity_threshold": 0.99}, {},
     "duplicate removal on fully opaque frames (no background removal, no auto crop)"),
    ("layout_columns3_spacing4", "magenta.mp4", {"columns": 3, "spacing": 4}, {},
     "tile 3 columns with 4 px transparent padding"),
    ("output_webp_q80", "magenta.mp4", {}, {"output_format": "webp", "output_quality": 80},
     "baseline sheet re-encoded by encode_static_image_path as WebP quality 80 (method 6, exact=True)"),
]

SHEET_ERROR_CASES = [
    ("error_resize_contain_pad_then_despill", "magenta.mp4",
     {"resize_mode": "contain", "output_width": 64, "output_height": 48},
     "contain pads with black@0 BEFORE despill; the pad has no alpha (yuv420p) and despill reads RGB only, "
     "so the opaque black pad columns drop the magenta border ratio below 50% and the build fails"),
    ("error_despill_on_green", "green.mp4", {}, "despill requires a magenta border; green clip must fail the border-ratio check"),
    ("error_count_exceeds_range", "magenta.mp4",
     {"start_time": 0.0, "end_time": 0.25, "sample_count": 5},
     "count mode asking for more frames than exist in the range"),
    ("error_despill_two_colors", "magenta.mp4", {"key_colors": ("#FF00FF", "#00FF00")},
     "despill accepts exactly one colour #FF00FF"),
]


def build_options(metadata, overrides: dict) -> tuple[media.SpriteOptions, dict]:
    values = {**BASELINE, **overrides}
    if values["end_time"] is None:
        values["end_time"] = metadata.last_frame_time
    values["key_colors"] = tuple(values["key_colors"])
    return media.SpriteOptions(**values), values


def run_sheet_case(case_id, video, overrides, output, note) -> dict:
    source = INPUTS / video
    metadata = media.probe_video(source)
    options, values = build_options(metadata, overrides)
    workspace = TMP / case_id
    workspace.mkdir()
    _calls.clear()
    _raw_capture.clear()
    validated = media._validate_options(metadata, options)
    record = {
        "id": case_id,
        "note": note,
        "function": "app.media.build_sprite_sheet(source, workspace, metadata, SpriteOptions(**options))",
        "input": rel(source),
        "video_metadata": metadata.to_dict(),
        "options": jsonable(values),
        "validated": dict(zip(
            ["expected_frames", "frame_width", "frame_height", "columns", "rows", "sheet_width", "sheet_height"],
            validated)),
        "video_filter": media._video_filter(metadata, options, validated[0]),
    }
    if options.sample_count:
        record["sample_frame_bounds"] = list(media._sample_frame_bounds(metadata, options))
        record["sample_frame_indices"] = list(media._sample_frame_indices(metadata, options))
    result = media.build_sprite_sheet(source, workspace, metadata, options)
    replacements = {str(source): "{input}", str(workspace): "{workspace}"}
    record["ffmpeg_calls"] = [placeholder_argv(call, replacements) for call in _calls]
    record["result"] = {
        key: getattr(result, key)
        for key in ("frame_count", "removed_frame_count", "frame_width", "frame_height",
                    "rows", "columns", "sheet_width", "sheet_height")
    }
    record["raw_frames"] = [pool_frame(path) for path in _raw_capture]
    if video == "magenta.mp4" and not options.crop_width and options.resize_mode == "none":
        lookup = source_frame_hashes(source)
        record["derived_source_frame_indices"] = {
            "indices": [lookup.get(f["rgba_sha256"]) for f in record["raw_frames"]],
            "note": "0-based decode-order index of each extracted frame, found by matching it against a full "
                    "`-vf format=rgba` decode of the input (derived by the generator, not original code)",
        }
    record["frames"] = [pool_frame(path) for path in result.frames]
    if options.remove_duplicate_frames:
        trace = dedupe_trace(list(_raw_capture), options)
        kept = [step["raw_frame"] for step in trace if step["kept"]]
        if len(kept) != result.frame_count:
            raise SystemExit(f"{case_id}: dedupe replay disagrees with the original run")
        record["dedupe_trace"] = trace
        record["kept_raw_frame_numbers"] = kept
    case_dir = clean_dir(OUT / "sheets" / case_id)
    atlas = case_dir / "sprite-sheet.png"
    shutil.copyfile(result.path, atlas)
    record["outputs"] = [image_record(atlas)]
    if output.get("output_format") == "webp":
        image_output = static_image_output("webp", output["output_quality"])
        webp = case_dir / "sprite-sheet.webp"
        webp.write_bytes(encode_static_image_path(result.path, image_output, error_message="webp failed"))
        record["output_encoding"] = {
            "function": "app.image_output.encode_static_image_path(result.path, static_image_output('webp', 80))",
            "format": image_output.format,
            "quality": image_output.quality,
            "pillow_save_kwargs": {"format": "WEBP", "quality": image_output.quality, "method": 6, "exact": True},
            "note": "lossy WebP: compare decoded pixels with tolerance, never bytes",
        }
        record["outputs"].append(image_record(webp))
    return record


_frame_hash_cache: dict[Path, dict[str, int]] = {}


def source_frame_hashes(source: Path) -> dict[str, int]:
    if source not in _frame_hash_cache:
        meta = media.probe_video(source)
        data = subprocess.run(["ffmpeg", "-v", "error", "-i", str(source), "-vf", "format=rgba", "-f", "rawvideo", "-"],
                              capture_output=True, check=True).stdout
        size = meta.width * meta.height * 4
        hashes: dict[str, int] = {}
        for index in range(len(data) // size):
            hashes.setdefault(sha256_bytes(data[index * size:(index + 1) * size]), index)
        _frame_hash_cache[source] = hashes
    return _frame_hash_cache[source]


def dedupe_trace(raw_frames: list[Path], options: media.SpriteOptions) -> list[dict]:
    """Replay the pairwise decision on the pre-dedupe processed frames.

    The kept/removed decision of the original run is already reflected in
    result.frames; this trace documents which consecutive comparisons the
    original _frames_similar() accepted, using the processed frames that the
    original pipeline compared (re-derived by rerunning the same pixel stages
    on a copy of the raw frames with the original functions).
    """
    work = TMP / f"trace-{len(list(TMP.iterdir()))}"
    work.mkdir()
    copies = []
    for index, path in enumerate(raw_frames, start=1):
        target = work / f"frame-{index:06d}.png"
        shutil.copyfile(path, target)
        copies.append(target)
    if options.background_mode == "chroma" and options.chroma_method == media.CHROMA_METHOD_MAGENTA_DESPILL:
        media._remove_magenta_color_difference_background(
            copies, options.tolerance, options.softness, edge_cleanup=options.chroma_edge_cleanup)
    if options.auto_crop:
        media._auto_crop_frames(copies, options.alpha_threshold)
    trace = []
    previous = None
    previous_index = None
    for index, path in enumerate(copies, start=1):
        current = np.asarray(media._load_rgba_image(path))
        similar = previous is not None and media._frames_similar(previous, current, options.frame_similarity_threshold)
        trace.append({"raw_frame": index, "compared_with_raw_frame": previous_index,
                      "similar_to_last_kept": bool(similar), "kept": not similar})
        if not similar:
            previous = current
            previous_index = index
    return trace


def run_sheet_error_case(case_id, video, overrides, note) -> dict:
    source = INPUTS / video
    metadata = media.probe_video(source)
    options, values = build_options(metadata, overrides)
    workspace = TMP / case_id
    workspace.mkdir()
    try:
        media.build_sprite_sheet(source, workspace, metadata, options)
    except MediaError as error:
        return {"id": case_id, "note": note, "input": rel(source), "options": jsonable(values),
                "raises": "MediaError", "message": str(error)}
    raise SystemExit(f"{case_id}: expected MediaError")


# ------------------------------------------------------------------ despill unit vectors

DESPILL_VECTORS = [
    "despill_v1_exact_key_ramp.png",
    "despill_v2_drifted_key_soft_disc.png",
    "despill_v3_contour_spike_glow.png",
]
DESPILL_SETTINGS = [
    ("cleanup_on", 0.08, 0.92, True),
    ("cleanup_off", 0.08, 0.92, False),
]


def despill_stats(path: Path, tolerance: float) -> dict:
    with Image.open(path) as source:
        rgb = np.asarray(source.convert("RGB"), dtype=np.uint8).astype(np.float32) / 255.0
    raw_alpha = media._magenta_color_difference_raw_alpha(rgb)
    border_rgb = media._outer_frame_border(rgb)
    border_raw = media._outer_frame_border(raw_alpha)
    background = np.median(border_rgb[border_raw <= tolerance], axis=0).astype(np.float32)
    return {
        "border_pixel_count": int(border_raw.shape[0]),
        "border_match_ratio": media._magenta_border_match_ratio(raw_alpha, tolerance),
        "background_estimate_float32": [float(v) for v in background],
        "background_estimate_times_255": [float(v) * 255 for v in background],
    }


def run_despill_units() -> list[dict]:
    out_dir = clean_dir(OUT / "despill_unit")
    records = []
    cases = [(v, s) for v in DESPILL_VECTORS for s in DESPILL_SETTINGS]
    cases.append(("despill_v2_drifted_key_soft_disc.png", ("tol015_soft060", 0.15, 0.60, True)))
    for vector, (label, tolerance, softness, cleanup) in cases:
        case_id = f"{Path(vector).stem}__{label}"
        work = TMP / case_id
        work.mkdir()
        frame = work / "frame-000001.png"
        shutil.copyfile(INPUTS / vector, frame)
        stats = despill_stats(frame, tolerance)
        media._remove_magenta_color_difference_background([frame], tolerance, softness, edge_cleanup=cleanup)
        target = out_dir / f"{case_id}.png"
        shutil.copyfile(frame, target)
        records.append({
            "id": case_id,
            "function": "app.media._remove_magenta_color_difference_background([frame], tolerance, softness, edge_cleanup=...)",
            "input": rel(INPUTS / vector),
            "input_rgba_sha256": rgba_sha256(INPUTS / vector),
            "options": {"tolerance": tolerance, "softness": softness, "edge_cleanup": cleanup},
            "intermediate": stats,
            "outputs": [image_record(target)],
        })
    # failure vector
    vector = "despill_v4_grey_border_fails.png"
    work = TMP / "despill_v4"
    work.mkdir()
    frame = work / "frame-000001.png"
    shutil.copyfile(INPUTS / vector, frame)
    try:
        media._remove_magenta_color_difference_background([frame], 0.08, 0.92, edge_cleanup=True)
        raise SystemExit("v4 expected MediaError")
    except MediaError as error:
        records.append({
            "id": "despill_v4_grey_border_fails",
            "function": "app.media._remove_magenta_color_difference_background",
            "input": rel(INPUTS / vector),
            "options": {"tolerance": 0.08, "softness": 0.92, "edge_cleanup": True},
            "intermediate": despill_stats_safe(INPUTS / vector, 0.08),
            "raises": "MediaError",
            "message": str(error),
        })
    return records


def despill_stats_safe(path: Path, tolerance: float) -> dict:
    with Image.open(path) as source:
        rgb = np.asarray(source.convert("RGB"), dtype=np.uint8).astype(np.float32) / 255.0
    raw_alpha = media._magenta_color_difference_raw_alpha(rgb)
    return {"border_match_ratio": media._magenta_border_match_ratio(raw_alpha, tolerance)}


# ------------------------------------------------------------------ normalization

SHEETS = {
    "a": ("norm_sheet_a_4x2_32px.png", dict(columns=4, rows=2, frame_count=7, input_spacing=0, output_columns=4)),
    "b": ("norm_sheet_b_3x3_24x40_sp2.png", dict(columns=3, rows=3, frame_count=8, input_spacing=2, output_columns=3)),
    "c": ("norm_sheet_c_2x2_edge_empty.png", dict(columns=2, rows=2, frame_count=4, input_spacing=0, output_columns=2)),
    "bad": ("norm_sheet_bad_indivisible.png", dict(columns=3, rows=1, frame_count=3, input_spacing=1, output_columns=3)),
    "transparent": ("norm_sheet_all_transparent.png", dict(columns=2, rows=1, frame_count=2, input_spacing=0, output_columns=2)),
}


def norm_source(key: str, read_order="row_major", anchor=(0, 0), **override) -> media.SpriteNormalizationSource:
    filename, grid = SHEETS[key]
    grid = {**grid, **override}
    return media.SpriteNormalizationSource(
        path=INPUTS / filename,
        source_name=filename,
        output_stem=f"{Path(filename).stem}-normalized",
        options=media.SpriteNormalizationSheetOptions(
            read_order=read_order, custom_anchor_x=anchor[0], custom_anchor_y=anchor[1], **grid),
    )


def norm_options(mode, anchor_policy, padding=2, alpha_threshold=20, output_spacing=0):
    return media.SpriteNormalizationOptions(
        mode=mode, alpha_threshold=alpha_threshold, padding=padding, output_spacing=output_spacing,
        anchor_policy=anchor_policy, output_format="png", output_quality=90)


NORMALIZATION_CASES = [
    ("per_sheet_bottom_center_row_major", "build_normalized_sprite_archive",
     lambda: [norm_source("a"), norm_source("b"), norm_source("c")],
     lambda: norm_options("per_sheet", "bottom_center")),
    ("group_center_column_major_spacing1", "build_normalized_sprite_archive",
     lambda: [norm_source("a", "column_major", output_columns=3), norm_source("b", "column_major", output_columns=4)],
     lambda: norm_options("group", "center", output_spacing=1)),
    ("group_custom_anchor_row_major", "build_normalized_sprite_archive",
     lambda: [norm_source("a", anchor=(16, 30)), norm_source("b", anchor=(12, 38))],
     lambda: norm_options("group", "custom")),
    ("per_sheet_bottom_center_alpha100", "build_normalized_sprite_archive",
     lambda: [norm_source("a")],
     lambda: norm_options("per_sheet", "bottom_center", alpha_threshold=100)),
    ("bulk_group_bottom_center_with_failure", "build_bulk_normalized_sprite_archive",
     lambda: [norm_source("a"), norm_source("bad"), norm_source("b")],
     lambda: norm_options("group", "bottom_center")),
]

NORMALIZATION_ERROR_CASES = [
    ("error_indivisible_grid", lambda: [norm_source("bad")], lambda: norm_options("per_sheet", "bottom_center")),
    ("error_custom_anchor_out_of_range", lambda: [norm_source("a", anchor=(33, 10))],
     lambda: norm_options("per_sheet", "custom")),
    ("error_all_transparent", lambda: [norm_source("transparent")], lambda: norm_options("per_sheet", "center")),
    ("error_group_with_one_bad_sheet", lambda: [norm_source("a"), norm_source("bad")],
     lambda: norm_options("group", "center")),
]


def source_record(source: media.SpriteNormalizationSource) -> dict:
    return {
        "input": rel(source.path),
        "source_name": source.source_name,
        "output_stem": source.output_stem,
        "relative_path": source.relative_path,
        "options": dataclasses.asdict(source.options),
    }


def run_normalization() -> tuple[list[dict], list[dict]]:
    base = clean_dir(OUT / "normalize")
    records = []
    for case_id, function_name, make_sources, make_options in NORMALIZATION_CASES:
        sources = make_sources()
        options = make_options()
        workspace = TMP / f"norm-{case_id}"
        workspace.mkdir()
        function = getattr(media, function_name)
        result = function(sources, workspace, options)
        archive_path = result if isinstance(result, Path) else result.path
        case_dir = clean_dir(base / case_id)
        outputs = []
        with zipfile.ZipFile(archive_path) as archive:
            entries = archive.namelist()
            for name in entries:
                target = case_dir / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(name))
                if target.suffix == ".png":
                    outputs.append(image_record(target))
                else:
                    outputs.append({"file": rel(target), "sha256": sha256_file(target)})
        record = {
            "id": case_id,
            "function": f"app.media.{function_name}(sources, workspace, options)",
            "sources": [source_record(s) for s in sources],
            "options": dataclasses.asdict(options),
            "zip_entries_in_order": entries,
            "outputs": outputs,
        }
        if not isinstance(result, Path):
            record["bulk_result"] = {"succeeded": result.succeeded, "failures": list(result.failures)}
        records.append(record)
    errors = []
    for case_id, make_sources, make_options in NORMALIZATION_ERROR_CASES:
        sources = make_sources()
        options = make_options()
        workspace = TMP / f"norm-{case_id}"
        workspace.mkdir()
        try:
            media.build_normalized_sprite_archive(sources, workspace, options)
            raise SystemExit(f"{case_id}: expected MediaError")
        except MediaError as error:
            errors.append({
                "id": case_id,
                "function": "app.media.build_normalized_sprite_archive",
                "sources": [source_record(s) for s in sources],
                "options": dataclasses.asdict(options),
                "raises": "MediaError",
                "message": str(error),
            })
    return records, errors


# ------------------------------------------------------------------ animation

def decoded_frames(path: Path) -> list[dict]:
    frames = []
    with Image.open(path) as image:
        for frame in ImageSequence.Iterator(image):
            rgba = frame.convert("RGBA")
            frames.append({
                "rgba_sha256": sha256_bytes(rgba.tobytes()),
                "size": list(rgba.size),
                "duration_ms": frame.info.get("duration"),
            })
    return frames


def run_animation() -> list[dict]:
    out_dir = clean_dir(OUT / "animation")
    sheet_name, grid = SHEETS["a"]
    records = []
    for fmt in ("gif", "webp", "mp4"):
        options = media.AnimationOptions(
            columns=grid["columns"], rows=grid["rows"], frame_count=grid["frame_count"],
            spacing=grid["input_spacing"], fps=8.0, output_format=fmt, background_color="#202020")
        workspace = TMP / f"anim-{fmt}"
        workspace.mkdir()
        _calls.clear()
        result = media.build_sprite_animation(INPUTS / sheet_name, workspace, options)
        target = out_dir / f"sheet_a.{result.extension}"
        shutil.copyfile(result.path, target)
        record = {
            "id": f"animation_{fmt}",
            "function": "app.media.build_sprite_animation(source, workspace, AnimationOptions(**options))",
            "input": rel(INPUTS / sheet_name),
            "options": dataclasses.asdict(options),
            "result": {"media_type": result.media_type, "extension": result.extension,
                       "frame_count": result.frame_count, "frame_width": result.frame_width,
                       "frame_height": result.frame_height},
            "duration_ms_per_frame": max(1, round(1000 / options.fps)),
            "outputs": [{"file": rel(target), "sha256": sha256_file(target)}],
        }
        if fmt == "mp4":
            meta = media.probe_video(target)
            record["probe"] = meta.to_dict()
            record["ffmpeg_calls"] = [placeholder_argv(c, {str(workspace): "{workspace}"}) for c in _calls]
            record["note"] = "libx264 output: byte equality NOT expected across builds; compare frame count / size / fps only"
        else:
            record["decoded_frames"] = decoded_frames(target)
            if fmt == "gif":
                record["note"] = ("Pillow quantize(colors=255) median-cut palette + alpha<128 -> index 255 transparent; "
                                  "a sharp/libvips port will not be byte- or pixel-identical, compare frame count, size, "
                                  "duration, and transparency mask (alpha<128) only")
            else:
                record["note"] = ("Pillow lossless animated WebP (quality=100, method=6, exact=False): RGB of alpha==0 "
                                  "pixels may be altered by the encoder; compare RGB only where alpha>0")
        records.append(record)
    return records


# ------------------------------------------------------------------ main

def main() -> None:
    clean_dir(FRAME_POOL)
    clean_dir(OUT / "sheets")
    sheets = [run_sheet_case(*case) for case in SHEET_CASES]
    sheet_errors = [run_sheet_error_case(*case) for case in SHEET_ERROR_CASES]
    despill = run_despill_units()
    normalization, normalization_errors = run_normalization()
    animation = run_animation()
    update_manifest("tools", {
        **tool_versions(),
        "python_sprite": sys.version.split()[0],
        "numpy": np.__version__,
        "pillow": Image.__version__,
    })
    update_manifest("sprite", {
        "original_app": "video-sprite-extractor/backend/app/media.py",
        "frame_pool": "sprite/frames (content-addressed, shared by cases; file = sha256(file)[:20].png)",
        "sheets": sheets,
        "sheet_errors": sheet_errors,
        "despill_unit": despill,
        "normalization": normalization,
        "normalization_errors": normalization_errors,
        "animation": animation,
    })
    shutil.rmtree(TMP, ignore_errors=True)
    print(f"sprite: {len(sheets)} sheets, {len(despill)} despill vectors, "
          f"{len(normalization)} normalization, {len(animation)} animation")


if __name__ == "__main__":
    main()

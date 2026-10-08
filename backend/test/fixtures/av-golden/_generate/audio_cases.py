"""Run the ORIGINAL stable-audio-sfx-manager code on the synthetic WAVs.

Run with the stable-audio-sfx-manager venv python (pydantic + fastapi; no
numpy needed). `sfx.audio.run` is wrapped in this process to record every
ffmpeg/ffprobe argv and the loudnorm measurement report; nothing in the
original package is modified. A throwaway SQLite (SFX_DATA_DIR in a temp
dir) is used only to drive service.export_plan for the collision vectors.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import shutil
import sqlite3
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (  # noqa: E402
    ROOT,
    SFX_APP_BACKEND,
    clean_dir,
    placeholder_argv,
    rel,
    setup_tool_path,
    sha256_file,
    tool_versions,
    update_manifest,
)

setup_tool_path()
TMP = Path(tempfile.mkdtemp(prefix="av-golden-audio-", dir=os.environ.get("AV_GOLDEN_TMP")))
os.environ["SFX_DATA_DIR"] = str(TMP / "sfx-data")
sys.path.insert(0, str(SFX_APP_BACKEND))

import pydantic  # noqa: E402
from fastapi import HTTPException  # noqa: E402

from sfx import audio, db, naming, service  # noqa: E402
from sfx.models import EditInput, ExportOptions  # noqa: E402

INPUTS = ROOT / "audio" / "inputs"
OUT = ROOT / "audio"

_calls: list[dict] = []
_original_run = audio.run


async def _recording_run(*args, timeout=90, stderr_output=False):
    output = await _original_run(*args, timeout=timeout, stderr_output=stderr_output)
    _calls.append({"argv": [str(a) for a in args], "stderr_output": stderr_output,
                   "stderr": output.decode(errors="replace") if stderr_output else None})
    return output


audio.run = _recording_run


# ------------------------------------------------------------------ WAV analysis (stdlib)

def read_wav(path: Path) -> dict:
    data = Path(path).read_bytes()
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("not a RIFF/WAVE file")
    pos = 12
    fmt = None
    pcm = None
    while pos + 8 <= len(data):
        cid, size = data[pos:pos + 4], struct.unpack("<I", data[pos + 4:pos + 8])[0]
        body = data[pos + 8:pos + 8 + size]
        if cid == b"fmt ":
            tag, channels, rate, _, block, bits = struct.unpack("<HHIIHH", body[:16])
            fmt = {"format_tag": tag, "channels": channels, "sample_rate": rate,
                   "block_align": block, "bits_per_sample": bits}
        elif cid == b"data":
            pcm = body
        pos += 8 + size + (size & 1)
    width = fmt["bits_per_sample"] // 8
    count = len(pcm) // width
    scale = float(1 << (fmt["bits_per_sample"] - 1))
    if width == 2:
        samples = [v / scale for v in struct.unpack(f"<{count}h", pcm[:count * 2])]
    elif width == 3:
        samples = [int.from_bytes(pcm[i:i + 3], "little", signed=True) / scale for i in range(0, count * 3, 3)]
    else:
        raise ValueError(f"unsupported width {width}")
    fmt["frames"] = count // fmt["channels"]
    fmt["samples"] = samples
    fmt["pcm_sha256"] = hashlib.sha256(pcm).hexdigest()
    return fmt


def level_profile(samples: list[float], channels: int, rate: int, window_s: float = 0.05) -> dict:
    window = int(round(rate * window_s)) * channels
    rms_db = []
    for start in range(0, len(samples), window):
        chunk = samples[start:start + window]
        if not chunk:
            break
        rms = math.sqrt(sum(v * v for v in chunk) / len(chunk))
        rms_db.append(round(20 * math.log10(rms), 2) if rms > 0 else None)
    peak = max((abs(v) for v in samples), default=0.0)
    return {
        "window_seconds": window_s,
        "window_frames": window // channels,
        "rms_dbfs_per_window": rms_db,
        "peak_dbfs": round(20 * math.log10(peak), 3) if peak > 0 else None,
        "note": "RMS over all channels' samples in each window, dBFS (full scale = 1.0); last window may be short",
    }


def wav_summary(path: Path) -> dict:
    info = read_wav(path)
    return {
        "format_tag": info["format_tag"],
        "channels": info["channels"],
        "sample_rate": info["sample_rate"],
        "bits_per_sample": info["bits_per_sample"],
        "frames": info["frames"],
        "pcm_sha256": info["pcm_sha256"],
        "duration_from_frames": info["frames"] / info["sample_rate"],
        "levels": level_profile(info["samples"], info["channels"], info["sample_rate"]),
    }


def decoded_summary(path: Path) -> dict:
    """Decode any audio with the pinned ffmpeg to s16 WAV and summarise (verification only)."""
    target = TMP / f"decoded-{path.stem}.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(path), "-c:a", "pcm_s16le", str(target)], check=True)
    return wav_summary(target)


def output_loudness(path: Path) -> dict:
    """Verification metric (NOT original code): loudnorm measurement of the produced file."""
    result = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "info", "-i", str(path), "-af",
         "apad=whole_dur=0.4,loudnorm=I=-16:LRA=7:TP=-1.5:print_format=json", "-f", "null", "-"],
        capture_output=True, text=True, check=True)
    report = result.stderr
    measured, _ = json.JSONDecoder().raw_decode(report[report.rfind("{"):])
    return {"input_i": measured["input_i"], "input_tp": measured["input_tp"], "input_lra": measured["input_lra"]}


def run(coro):
    return asyncio.run(coro)


# ------------------------------------------------------------------ edit filter strings

EDIT_DURATION_INPUT = "sweep_noise_mono44k.wav"
EDIT_CASES = [
    ("defaults_end_only", '{"end": 1.5}'),
    ("explicit_zeros_json_ints", '{"start": 0, "end": 1, "gain_db": 0, "speed": 1, "pitch_semitones": 0}'),
    ("trim_only", '{"start": 0.2, "end": 1.1}'),
    ("gain_minus6", '{"start": 0, "end": 1.5, "gain_db": -6}'),
    ("gain_plus3p5", '{"end": 1.5, "gain_db": 3.5}'),
    ("pitch_plus3", '{"end": 1.2, "pitch_semitones": 3}'),
    ("pitch_minus5_trim", '{"start": 0.1, "end": 1.4, "pitch_semitones": -5}'),
    ("pitch_fractional", '{"end": 1.5, "pitch_semitones": 0.5}'),
    ("speed_1p5_pitch_plus2", '{"end": 1.5, "speed": 1.5, "pitch_semitones": 2}'),
    ("speed_0p75_only", '{"end": 1.5, "speed": 0.75}'),
    ("fades", '{"start": 0.1, "end": 1.3, "fade_in": 0.05, "fade_out": 0.2}'),
    ("fades_zero", '{"end": 1.5, "fade_in": 0, "fade_out": 0}'),
    ("all_combined", '{"start": 0.05, "end": 1.45, "gain_db": -3, "pitch_semitones": -2, "speed": 0.8, "fade_in": 0.1, "fade_out": 0.25}'),
    ("end_within_overrun_tolerance", '{"start": 0.5, "end": 1.52}'),
    ("tiny_values", '{"start": 0.00001, "end": 0.1, "fade_in": 0.0001, "fade_out": 0.00002}'),
    ("error_start_after_end", '{"start": 1.0, "end": 0.5}'),
    ("error_end_past_duration", '{"end": 1.6}'),
    ("error_fades_longer_than_result", '{"start": 0, "end": 1.0, "speed": 2, "fade_in": 0.3, "fade_out": 0.3}'),
    ("error_validation_speed_out_of_range", '{"end": 1.0, "speed": 5}'),
]
RENDER_CASES = [
    ("trim_only", "sweep_noise_mono44k.wav", '{"start": 0.2, "end": 1.1}'),
    ("all_combined", "sweep_noise_mono44k.wav", EDIT_CASES[12][1]),
    ("speed_1p5_pitch_plus2_stereo48k", "tones_stereo48k.wav", '{"start": 0.25, "end": 1.75, "speed": 1.5, "pitch_semitones": 2, "gain_db": -2}'),
]


def edit_record(case_id: str, body: str, duration: float) -> dict:
    record = {"id": case_id, "request_json": body, "duration_arg": duration,
              "function": "sfx.audio.filters(EditInput.model_validate_json(request_json), duration_arg)"}
    try:
        edit = EditInput.model_validate_json(body)
    except pydantic.ValidationError as error:
        record["raises"] = "pydantic.ValidationError"
        record["errors"] = [{"loc": list(e["loc"]), "type": e["type"], "msg": e["msg"]} for e in error.errors()]
        return record
    record["edit_model_dump"] = edit.model_dump()
    record["edit_value_types"] = {k: type(v).__name__ for k, v in edit.model_dump().items()}
    record["fields_set"] = sorted(edit.model_fields_set)
    try:
        record["filter_chain"] = audio.filters(edit, duration)
    except HTTPException as error:
        record["raises"] = "HTTPException"
        record["status_code"] = error.status_code
        record["detail"] = error.detail
    return record


def run_edits() -> tuple[list[dict], list[dict]]:
    duration = run(audio.probe(INPUTS / EDIT_DURATION_INPUT))["duration"]
    strings = [edit_record(case_id, body, duration) for case_id, body in EDIT_CASES]
    out_dir = clean_dir(OUT / "renders")
    renders = []
    for case_id, input_name, body in RENDER_CASES:
        source = INPUTS / input_name
        meta = run(audio.probe(source))
        edit = EditInput.model_validate_json(body)
        target = out_dir / f"{case_id}.wav"
        _calls.clear()
        run(audio.render(source, target, edit, meta["duration"]))
        renders.append({
            "id": case_id,
            "function": "sfx.audio.render(source, destination, EditInput.model_validate_json(request_json), probe(source)['duration'])",
            "input": rel(source),
            "input_probe": meta,
            "request_json": body,
            "filter_chain": audio.filters(edit, meta["duration"]),
            "ffmpeg_calls": [placeholder_argv(c["argv"], {str(source): "{input}", str(target): "{output}"}) for c in _calls],
            "outputs": [{"file": rel(target), "sha256": sha256_file(target)}],
            "output_probe": run(audio.probe(target)),
            "output_wav": wav_summary(target),
            "note": "byte equality across ffmpeg/rubberband builds is NOT guaranteed; compare frames (+-1 block) and per-window RMS (+-0.5 dB)",
        })
    return strings, renders


# ------------------------------------------------------------------ export

EXPORT_CASES = [
    ("sweep_noise_default_ogg", "sweep_noise_mono44k.wav", {}),
    ("tones_stereo_default_ogg", "tones_stereo48k.wav", {}),
    ("near_silent_default_ogg", "near_silent_mono44k.wav", {}),
    ("peaky_clicks_default_ogg", "peaky_clicks_mono44k.wav", {}),
    ("short_blip_default_ogg", "short_blip_mono22k.wav", {}),
    ("tones_stereo_wav", "tones_stereo48k.wav", {"format": "wav"}),
    ("tones_stereo_mono_22050_ogg", "tones_stereo48k.wav", {"channels": 1, "sample_rate": 22050}),
    ("sweep_noise_no_normalize_ogg", "sweep_noise_mono44k.wav", {"normalize": False}),
]


def classify(options: ExportOptions, measured: dict | None, final_chain: str) -> dict:
    if not options.normalize:
        return {"branch": "no_normalize"}
    input_i, input_tp = float(measured["input_i"]), float(measured["input_tp"])
    if not (math.isfinite(input_i) and math.isfinite(input_tp)):
        return {"branch": "unmeasurable_no_gain", "reason": "input_i or input_tp not finite (silence / below gate)"}
    gain = options.target_lufs - input_i
    headroom = options.peak_db - input_tp
    reasons = {
        "gain_exceeds_peak_headroom": gain > headroom,
        "input_lra_exceeds_range": float(measured["input_lra"]) > options.loudness_range,
        "non_finite_measurement": not all(math.isfinite(float(measured[k])) for k in
                                          ("input_i", "input_lra", "input_tp", "input_thresh", "target_offset")),
    }
    branch = "two_pass_linear_loudnorm" if "loudnorm=" in final_chain else "linear_gain_fallback"
    return {"branch": branch, "gain_db": gain, "peak_headroom_db": headroom,
            "min_gain_headroom_db": min(gain, headroom), "fallback_reasons": reasons}


def run_exports() -> list[dict]:
    out_dir = clean_dir(OUT / "exports")
    records = []
    for case_id, input_name, overrides in EXPORT_CASES:
        source = INPUTS / input_name
        meta = run(audio.probe(source))
        options = ExportOptions(**overrides)
        target = out_dir / f"{case_id}.{options.format}"
        _calls.clear()
        run(audio.export(source, target, options, meta))
        measured = None
        measure_calls = [c for c in _calls if c["stderr_output"]]
        if measure_calls:
            report = measure_calls[0]["stderr"]
            measured, _ = json.JSONDecoder().raw_decode(report[report.rfind("{"):])
        final_argv = _calls[-1]["argv"]
        final_chain = final_argv[final_argv.index("-af") + 1]
        replacements = {str(source): "{input}", str(target): "{output}"}
        record = {
            "id": case_id,
            "function": "sfx.audio.export(source, destination, ExportOptions(**options), meta=probe(source))",
            "input": rel(source),
            "meta_arg": meta,
            "options": overrides,
            "options_resolved": options.model_dump(),
            "measure_filter_chain": (measure_calls[0]["argv"][measure_calls[0]["argv"].index("-af") + 1]
                                     if measure_calls else None),
            "loudnorm_measured": measured,
            "decision": classify(options, measured, final_chain),
            "final_filter_chain": final_chain,
            "ffmpeg_calls": [placeholder_argv(c["argv"], replacements) for c in _calls],
            "outputs": [{"file": rel(target), "sha256": sha256_file(target)}],
            "output_probe": run(audio.probe(target)),
            "output_decoded": decoded_summary(target),
            "verification_output_loudness": output_loudness(target),
            "note": "loudnorm numbers and encoded bytes depend on the ffmpeg build; compare the decision branch "
                    "exactly, the filter-chain structure exactly, and numbers with tolerance"
                    + ("; OGG file sha256 differs on EVERY run even with the same build (ogg muxer picks a random "
                       "stream serial, original passes no -fflags +bitexact) - use output_decoded.pcm_sha256 "
                       "(pinned-ffmpeg s16 decode) for same-build exactness" if options.format == "ogg" else ""),
            "file_sha256_is_run_specific": options.format == "ogg",
        }
        records.append(record)
    return records


# ------------------------------------------------------------------ naming

FILENAME_VECTORS = [
    ("boom_[00]", 1, 3, "wav"), ("boom_[00]", 12, 12, "wav"), ("boom_[0]", 7, 9, "wav"),
    ("boom_[0]", 12, 12, "wav"), ("hit[000]", 5, 5, "wav"), ("a_[00000000]", 3, 3, "wav"),
    ("[00]_lead", 2, 2, "wav"), ("[00]", 1, 1, "wav"), ("boom_[00]", 1, 1, "wav"),
    ("explosion", 1, 1, "wav"), ("explosion", 1, 3, "wav"), ("explosion", 3, 3, "wav"),
    ("explosion", 100, 100, "wav"), ("step_01", 1, 3, "wav"), ("step_01", 3, 3, "wav"),
    ("step_009", 2, 2, "wav"), ("step_9", 3, 3, "wav"), ("step_01", 1, 1, "wav"),
    ("x_99", 2, 2, "wav"), ("v2_take_5", 2, 2, "wav"), ("door 01", 2, 2, "wav"),
    ("door-01", 2, 2, "wav"), ("step_", 2, 2, "wav"), ("zap", 1, 2, "ogg"), ("Laser_[00]", 4, 4, "ogg"),
    ("  padded  ", 1, 1, "wav"), ("효과음_[00]", 2, 2, "ogg"), ("boom.ogg", 1, 1, "ogg"),
    ("lpt9_[00]", 1, 1, "wav"), ("snd_[00]_v2", 3, 3, "wav"), ("x" * 120, 1, 1, "wav"),
]
INVALID_LABELS = [
    "", "   ", "a/b", "a\\b", "a:b", 'a"b', "a|b", "a?b", "a*b", "a<b", "a>b", "tab\tx",
    "x" * 121, "boom_[00]_[00]", "boom_[000000000]", "boom_[01]", "boom[", "boom]", "boom_[]",
    "boom.", "boom. ", "..", ".", "sound.wav", "sound.WAV", "CON", "con.txt", "NUL", "AUX.ogg",
    "COM1", "LPT9_[00].x",
]


def run_naming() -> dict:
    filename_vectors = []
    for label, index, count, fmt in FILENAME_VECTORS:
        filename_vectors.append({"label": label, "index": index, "count": count, "format": fmt,
                                 "validated_label": naming.validate_label(label),
                                 "filename": naming.filename(label, index, count, fmt)})
    invalid = []
    for label in INVALID_LABELS:
        try:
            value = naming.validate_label(label)
            invalid.append({"label": label, "valid": True, "validated_label": value})
        except ValueError as error:
            invalid.append({"label": label, "valid": False, "error": str(error)})
    return {
        "function_filename": "sfx.naming.filename(label, index, count, format)",
        "function_validate": "sfx.naming.validate_label(label)",
        "filename_vectors": filename_vectors,
        "label_validation_vectors": invalid,
        "collision_vectors": run_collisions(),
    }


COLLISION_SCENARIOS = [
    ("token_vs_counted_label", "wav", [("Boom A", "boom_[00]", 2), ("Boom B", "boom_02", 1)]),
    ("casefold_collision", "wav", [("Hit A", "Hit", 2), ("Hit B", "hit_02", 1)]),
    ("no_collision_mixed_rules", "wav", [("Door", "door_[00]", 3), ("Door single", "door", 1),
                                          ("Steps", "step_09", 3), ("Zap", "zap", 2)]),
    ("ogg_format", "ogg", [("Laser", "laser_[000]", 2), ("Laser solo", "laser", 1)]),
    ("single_file_label_vs_token", "wav", [("One", "one_01", 1), ("Many", "one_[00]", 1)]),
]


def run_collisions() -> list[dict]:
    db.initialize()
    path = db.DATA / "sfx.sqlite3"
    results = []
    for number, (scenario, fmt, groups) in enumerate(COLLISION_SCENARIOS, start=1):
        conn = sqlite3.connect(path)
        conn.execute("PRAGMA foreign_keys=OFF")
        project_id = f"p{number}"
        conn.execute("INSERT INTO projects(id,name,created) VALUES(?,?,?)",
                     (project_id, f"project {number}", f"2026-01-01T00:00:0{number}.000Z"))
        for g_index, (name, label, count) in enumerate(groups, start=1):
            group_id = f"{project_id}g{g_index}"
            conn.execute("INSERT INTO groups(id,project_id,name,label,created) VALUES(?,?,?,?,?)",
                         (group_id, project_id, name, label, f"2026-01-01T00:00:{g_index:02d}.000Z"))
            for c_index in range(1, count + 1):
                conn.execute(
                    "INSERT INTO candidates(id,job_id,group_id,name,file,duration,sample_rate,channels,review,created)"
                    " VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (f"{group_id}c{c_index}", "job", group_id, f"{name} #{c_index}", f"{group_id}c{c_index}.wav",
                     1.0, 44100, 1, "selected", f"2026-01-01T00:01:{c_index:02d}.000Z"))
            # one non-selected candidate per group must not affect numbering
            conn.execute(
                "INSERT INTO candidates(id,job_id,group_id,name,file,duration,sample_rate,channels,review,created)"
                " VALUES(?,?,?,?,?,?,?,?,?,?)",
                (f"{group_id}rej", "job", group_id, "rejected", f"{group_id}rej.wav", 1.0, 44100, 1, "rejected",
                 "2026-01-01T00:00:30.000Z"))
        conn.commit()
        conn.close()
        record = {"id": scenario, "format": fmt,
                  "groups_in_creation_order": [{"name": n, "label": l, "selected_count": c} for n, l, c in groups]}
        try:
            plan = service.export_plan(project_id, None, ExportOptions(format=fmt))
            record["files"] = [{"group_label": f["label"], "filename": f["filename"]} for f in plan["files"]]
        except HTTPException as error:
            record["raises"] = "HTTPException"
            record["status_code"] = error.status_code
            record["detail"] = error.detail
        results.append(record)
    return results


# ------------------------------------------------------------------ main

def main() -> None:
    edit_strings, renders = run_edits()
    exports = run_exports()
    naming_vectors = run_naming()
    inputs = []
    for path in sorted(INPUTS.glob("*.wav")):
        inputs.append({"file": rel(path), "sha256": sha256_file(path), "probe": run(audio.probe(path)),
                       "wav": wav_summary(path)})
    for item in inputs:
        item["wav"]["levels"].pop("rms_dbfs_per_window")
    tools = {}
    manifest_path = ROOT / "manifest.json"
    if manifest_path.is_file():
        tools = json.loads(manifest_path.read_text(encoding="utf-8")).get("tools", {})
    update_manifest("tools", {**tools, **tool_versions(), "python_audio": sys.version.split()[0],
                              "pydantic": pydantic.VERSION})
    update_manifest("audio", {
        "original_app": "stable-audio-sfx-manager/backend/sfx (audio.py, models.py, naming.py, service.export_plan)",
        "inputs": inputs,
        "edit_filter_strings": edit_strings,
        "edit_renders": renders,
        "exports": exports,
        "naming": naming_vectors,
    })
    shutil.rmtree(TMP, ignore_errors=True)
    print(f"audio: {len(edit_strings)} filter strings, {len(renders)} renders, {len(exports)} exports, "
          f"{len(naming_vectors['filename_vectors'])} filename vectors")


if __name__ == "__main__":
    main()

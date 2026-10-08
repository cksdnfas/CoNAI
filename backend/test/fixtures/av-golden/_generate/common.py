"""Shared helpers for the av-golden fixture generators (stdlib only)."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # .../fixtures/av-golden
CONAI = ROOT.parents[3]  # repo root (backend/test/fixtures/av-golden -> repo)

SPRITE_APP_BACKEND = Path(
    os.environ.get(
        "SPRITE_APP_BACKEND",
        r"D:\Share\0_DEV\Tooling\Active\video-sprite-extractor\backend",
    )
)
SFX_APP_BACKEND = Path(
    os.environ.get(
        "SFX_APP_BACKEND",
        r"D:\Share\0_DEV\Tooling\Active\stable-audio-sfx-manager\backend",
    )
)

FFMPEG_DIR = CONAI / "node_modules" / "ffmpeg-static"
FFPROBE_DIR = CONAI / "node_modules" / "ffprobe-static" / "bin" / "win32" / "x64"


def setup_tool_path() -> None:
    """Put the pinned ffmpeg/ffprobe first on PATH.

    Both original apps call bare `ffmpeg` / `ffprobe`, so PATH decides which
    build runs. CPython on Windows propagates os.environ changes to the
    process environment that CreateProcess searches.
    """
    path = os.environ.get("PATH", "")
    os.environ["PATH"] = os.pathsep.join([str(FFMPEG_DIR), str(FFPROBE_DIR), path])
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or Path(ffmpeg).parent.resolve() != FFMPEG_DIR.resolve():
        raise SystemExit(f"pinned ffmpeg not first on PATH: {ffmpeg}")
    if not ffprobe or Path(ffprobe).parent.resolve() != FFPROBE_DIR.resolve():
        raise SystemExit(f"pinned ffprobe not first on PATH: {ffprobe}")


def tool_versions() -> dict[str, str]:
    out = {}
    for tool in ("ffmpeg", "ffprobe"):
        result = subprocess.run([tool, "-version"], capture_output=True, text=True, check=True)
        out[tool] = result.stdout.splitlines()[0]
    return out


def sha256_file(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def rel(path: Path) -> str:
    return Path(path).resolve().relative_to(ROOT.resolve()).as_posix()


def placeholder_argv(argv: list[str], replacements: dict[str, str]) -> list[str]:
    """Replace absolute temp/input paths in a command with stable tokens."""
    result = []
    for arg in argv:
        text = str(arg)
        for needle, token in sorted(replacements.items(), key=lambda kv: -len(kv[0])):
            text = text.replace(needle, token)
            text = text.replace(needle.replace("\\", "/"), token)
        result.append(text)
    return result


def update_manifest(section: str, payload: object) -> None:
    manifest_path = ROOT / "manifest.json"
    manifest = {}
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest.setdefault("schema", "conai-av-golden/1")
    manifest[section] = payload
    order = ["schema", "tools", "sprite", "audio"]
    ordered = {key: manifest[key] for key in order if key in manifest}
    ordered.update({k: v for k, v in manifest.items() if k not in ordered})
    manifest_path.write_text(
        json.dumps(ordered, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def clean_dir(path: Path) -> Path:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True)
    return path

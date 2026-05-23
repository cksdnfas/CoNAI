import os
import re
import shutil
from datetime import datetime
from pathlib import Path

import folder_paths


_SAFE_NAME_PATTERN = re.compile(r'[<>:"/\\|?*\x00-\x1F]')


def _safe_file_name(value: str, fallback: str = "artifact.bin") -> str:
    name = _SAFE_NAME_PATTERN.sub("_", os.path.basename(value.strip()))
    return name or fallback


def _safe_relative_subfolder(value: str) -> str:
    normalized = value.strip().replace("\\", "/").strip("/")
    parts = []
    for part in normalized.split("/"):
        if not part or part in {".", ".."}:
            continue
        parts.append(_SAFE_NAME_PATTERN.sub("_", part))
    return "/".join(parts)


def _available_target_path(directory: Path, file_name: str, overwrite: bool) -> Path:
    target = directory / file_name
    if overwrite or not target.exists():
        return target

    stem = target.stem
    suffix = target.suffix
    counter = 2
    while True:
        candidate = directory / f"{stem}-{counter}{suffix}"
        if not candidate.exists():
            return candidate
        counter += 1


def _available_target_directory(target: Path, overwrite: bool) -> Path:
    if overwrite:
        if target.is_dir():
            shutil.rmtree(target)
        elif target.exists():
            target.unlink()
        return target

    if not target.exists():
        return target

    counter = 2
    while True:
        candidate = target.parent / f"{target.name}-{counter}"
        if not candidate.exists():
            return candidate
        counter += 1


def _iter_files(root: Path):
    for child in sorted(root.iterdir(), key=lambda path: path.name.lower()):
        if child.is_dir():
            yield from _iter_files(child)
        elif child.is_file():
            yield child


def _is_within(root: Path, candidate: Path) -> bool:
    return os.path.commonpath([str(root), str(candidate)]) == str(root)


def _timestamp_prefix() -> str:
    return datetime.now().strftime("%Y-%m-%d_%H-%M-%S-%f")[:-3]


def _history_file_entries(output_root: Path, root: Path):
    entries = []
    for file_path in _iter_files(root):
        entries.append({
            "filename": file_path.name,
            "subfolder": file_path.parent.relative_to(output_root).as_posix(),
            "type": "output",
        })
    return entries


class CoNAIArtifactFileOutput:
    """Copy a file or its parent folder into ComfyUI output for CoNAI artifact collection."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "file_path": ("STRING", {"default": "", "multiline": False, "forceInput": True}),
                "subfolder": ("STRING", {"default": "conai_artifacts", "multiline": False}),
                "filename_override": ("STRING", {"default": "", "multiline": False}),
                "copy_parent_folder": ("BOOLEAN", {"default": True}),
                "overwrite": ("BOOLEAN", {"default": False}),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "copy_file"
    OUTPUT_NODE = True
    CATEGORY = "CoNAI Helper/artifacts"
    DESCRIPTION = "Copies a file or parent folder into ComfyUI output so CoNAI can collect it as an artifact."

    def copy_file(
        self,
        file_path: str,
        subfolder: str = "conai_artifacts",
        filename_override: str = "",
        copy_parent_folder: bool = True,
        overwrite: bool = False,
    ):
        raw_path = str(file_path or "").strip().strip('"')
        if not raw_path:
            raise ValueError("CoNAI Helper Artifact Output requires file_path.")

        source_path = Path(raw_path).expanduser().resolve()
        if not source_path.exists() or not source_path.is_file():
            raise FileNotFoundError(f"Artifact source file not found: {source_path}")

        output_root = Path(folder_paths.get_output_directory()).resolve()
        safe_subfolder = _safe_relative_subfolder(str(subfolder or "conai_artifacts"))
        target_parent = (output_root / safe_subfolder).resolve()
        if not _is_within(output_root, target_parent):
            raise ValueError("Artifact subfolder escapes ComfyUI output directory.")
        target_parent.mkdir(parents=True, exist_ok=True)

        if copy_parent_folder:
            source_root = source_path.parent
            base_name = _safe_file_name(filename_override.strip() if filename_override else source_root.name, source_root.name)
            target_name = f"{_timestamp_prefix()}_{base_name}"
            target_root = _available_target_directory((target_parent / target_name).resolve(), bool(overwrite))
            if not _is_within(output_root, target_root):
                raise ValueError("Artifact target escapes ComfyUI output directory.")
            shutil.copytree(str(source_root), str(target_root))
            return {"ui": {"files": _history_file_entries(output_root, target_root)}}

        target_name = _safe_file_name(filename_override.strip() if filename_override else source_path.name, source_path.name)
        target_path = _available_target_path(target_parent, target_name, bool(overwrite)).resolve()
        if not _is_within(output_root, target_path):
            raise ValueError("Artifact target escapes ComfyUI output directory.")
        shutil.copy2(str(source_path), str(target_path))
        return {
            "ui": {
                "files": [{
                    "filename": target_path.name,
                    "subfolder": target_path.parent.relative_to(output_root).as_posix(),
                    "type": "output",
                }]
            }
        }


NODE_CLASS_MAPPINGS = {
    "CoNAIArtifactFileOutput": CoNAIArtifactFileOutput,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CoNAIArtifactFileOutput": "CoNAI Helper: Artifact Output",
}


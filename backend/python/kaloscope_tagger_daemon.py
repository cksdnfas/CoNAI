#!/usr/bin/env python3
"""
Kaloscope ONNX Tagger Daemon - Long-running process for model persistence
Communicates via stdin/stdout for efficient repeated inference
"""
import csv
import gc
import json
import os
import sys
from pathlib import Path
from typing import Dict, Optional


def preload_windows_gpu_dlls() -> None:
    if os.name != "nt":
        return

    try:
        import torch

        torch_lib_dir = Path(torch.__file__).resolve().parent / "lib"
        if torch_lib_dir.is_dir():
            os.add_dll_directory(str(torch_lib_dir))
    except Exception:
        # Kaloscope can still run on CPU even if torch/DLL preload is unavailable.
        return


preload_windows_gpu_dlls()

import numpy as np
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from PIL import Image

# Global state
session: Optional[ort.InferenceSession] = None
current_model_name: Optional[str] = None
current_device_name: Optional[str] = None
current_repo_id: Optional[str] = None
current_model_file: Optional[str] = None
class_mapping: Dict[int, str] = {}


def load_mapping(repo_id: str, cache_dir: str | None = None) -> Dict[int, str]:
    candidates = ("class_mapping.csv", "v2.0/class_mapping.csv")
    mapping: Dict[int, str] = {}

    for filename in candidates:
        try:
            mapping_path = hf_hub_download(repo_id=repo_id, filename=filename, cache_dir=cache_dir)
        except Exception:
            continue

        try:
            with open(mapping_path, newline="", encoding="utf-8") as file_handle:
                reader = csv.DictReader(file_handle)
                if reader.fieldnames:
                    fieldnames = {name.lower(): name for name in reader.fieldnames}
                    id_key = next((fieldnames[key] for key in ("class_id", "id", "index", "class") if key in fieldnames), None)
                    label_key = next((fieldnames[key] for key in ("label", "name", "class_name") if key in fieldnames), None)
                    if id_key and label_key:
                        for row in reader:
                            try:
                                class_id = int(row[id_key])
                            except Exception:
                                continue
                            mapping[class_id] = (row.get(label_key, "") or "").strip()
                        if mapping:
                            return mapping

            with open(mapping_path, newline="", encoding="utf-8") as file_handle:
                simple_reader = csv.reader(file_handle)
                for row in simple_reader:
                    if len(row) < 2:
                        continue
                    try:
                        class_id = int(row[0])
                    except Exception:
                        continue
                    mapping[class_id] = row[1].strip()
                if mapping:
                    return mapping
        except Exception:
            continue

    return mapping


def preprocess_image(image_path: Path) -> np.ndarray:
    image = Image.open(image_path).convert("RGB")
    image = image.resize((448, 448), Image.Resampling.BILINEAR)
    array = np.asarray(image, dtype=np.float32) / 255.0
    array = np.transpose(array, (2, 0, 1))
    array = np.expand_dims(array, axis=0)
    return array


def resolve_providers(device: str) -> list[str]:
    available = ort.get_available_providers()

    if device == "cuda":
        if "CUDAExecutionProvider" not in available:
            raise RuntimeError(f"CUDAExecutionProvider is not available. Providers: {available}")
        providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
    elif device == "cpu":
        providers = ["CPUExecutionProvider"]
    else:
        providers = ["CUDAExecutionProvider", "CPUExecutionProvider"] if "CUDAExecutionProvider" in available else ["CPUExecutionProvider"]

    providers = [provider for provider in providers if provider in available]
    if not providers:
        providers = ["CPUExecutionProvider"]

    return providers


def normalize_device_name(providers: list[str]) -> str:
    if providers and providers[0] == "CUDAExecutionProvider":
        return "cuda"
    return "cpu"


def load_model_command(repo_id: str, model_file: str, cache_dir: str | None = None, device: str = "auto"):
    global session, current_model_name, current_device_name, current_repo_id, current_model_file, class_mapping

    try:
        model_path = hf_hub_download(repo_id=repo_id, filename=model_file, cache_dir=cache_dir)
        mapping = load_mapping(repo_id, cache_dir)
        providers = resolve_providers(device)

        unload_model_command()

        session = ort.InferenceSession(model_path, providers=providers)
        class_mapping = mapping
        current_model_name = "kaloscope-onnx"
        current_device_name = normalize_device_name(session.get_providers())
        current_repo_id = repo_id
        current_model_file = model_file

        return {
            "success": True,
            "model": current_model_name,
            "device": current_device_name,
        }
    except Exception as exc:
        return {
            "success": False,
            "error": str(exc),
            "error_type": type(exc).__name__,
        }


def unload_model_command():
    global session, current_model_name, current_device_name, current_repo_id, current_model_file, class_mapping

    try:
        session = None
        current_model_name = None
        current_device_name = None
        current_repo_id = None
        current_model_file = None
        class_mapping = {}
        gc.collect()

        return {"success": True}
    except Exception as exc:
        return {
            "success": False,
            "error": str(exc),
            "error_type": type(exc).__name__,
        }


def tag_image_command(image_path: str, topk: int = 15):
    global session, current_model_name, class_mapping

    try:
        if session is None:
            return {
                "success": False,
                "error": "Model not loaded. Call load_model first.",
                "error_type": "StateError",
            }

        image_path_obj = Path(image_path).resolve()
        if not image_path_obj.is_file():
            return {
                "success": False,
                "error": f"Image file not found: {image_path}",
                "error_type": "FileNotFoundError",
            }

        input_tensor = preprocess_image(image_path_obj)
        inputs = session.get_inputs()
        if not inputs:
            raise RuntimeError("Model has no input tensors")

        input_name = inputs[0].name
        outputs = session.run(None, {input_name: input_tensor})
        if not outputs:
            raise RuntimeError("Model returned no outputs")

        scores = np.asarray(outputs[0], dtype=np.float32).squeeze()
        if scores.ndim != 1:
            raise RuntimeError(f"Expected 1D class scores, got shape {scores.shape}")

        shifted = scores - np.max(scores)
        probs = np.exp(shifted)
        probs = probs / (np.sum(probs) + 1e-12)

        effective_topk = max(1, min(int(topk), probs.shape[0]))
        top_indices = np.argsort(probs)[::-1][:effective_topk]

        artists: Dict[str, float] = {}
        fallback_artists: Dict[str, float] = {}
        for idx in top_indices:
            score = float(probs[idx])
            label = class_mapping.get(int(idx), "").strip()
            if label:
                artists[label] = score
            else:
                fallback_artists[f"class_{int(idx)}"] = score

        if not artists:
            artists = fallback_artists

        taglist = ", ".join(artists.keys())

        return {
            "success": True,
            "model": current_model_name or "kaloscope-onnx",
            "topk": effective_topk,
            "artists": artists,
            "taglist": taglist,
        }
    except Exception as exc:
        return {
            "success": False,
            "error": str(exc),
            "error_type": type(exc).__name__,
        }


def get_status_command():
    global session, current_model_name, current_device_name

    return {
        "success": True,
        "model_loaded": session is not None,
        "current_model": current_model_name,
        "device": current_device_name,
    }


def send_response(response: dict):
    print(json.dumps(response, ensure_ascii=False))
    sys.stdout.flush()


def main():
    print(f"# Kaloscope Daemon starting (onnxruntime: {ort.__version__})", file=sys.stderr)
    print(f"# Providers: {ort.get_available_providers()}", file=sys.stderr)
    send_response({"success": True, "status": "ready"})

    for line in sys.stdin:
        try:
            line = line.strip()
            if not line:
                continue

            command = json.loads(line)
            action = command.get("action")

            if action == "load_model":
                response = load_model_command(
                    repo_id=command.get("repo", "DraconicDragon/Kaloscope-onnx"),
                    model_file=command.get("model_file", "v2.0/kaloscope_2-0.onnx"),
                    cache_dir=command.get("cache_dir"),
                    device=command.get("device", "auto"),
                )
                send_response(response)
            elif action == "unload_model":
                send_response(unload_model_command())
            elif action == "tag_image":
                response = tag_image_command(
                    image_path=command.get("image_path"),
                    topk=command.get("topk", 15),
                )
                send_response(response)
            elif action == "get_status":
                send_response(get_status_command())
            elif action == "shutdown":
                send_response({"success": True, "status": "shutdown"})
                break
            else:
                send_response({
                    "success": False,
                    "error": f"Unknown action: {action}",
                    "error_type": "InvalidAction",
                })
        except Exception as exc:
            send_response({
                "success": False,
                "error": str(exc),
                "error_type": type(exc).__name__,
            })


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({
            "success": False,
            "error": str(exc),
            "error_type": type(exc).__name__,
        }, ensure_ascii=False))
        sys.stdout.flush()

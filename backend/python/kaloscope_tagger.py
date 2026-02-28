#!/usr/bin/env python3
import argparse
import csv
import json
from pathlib import Path
from typing import Dict

import numpy as np
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Kaloscope ONNX artist tagger")
    parser.add_argument("--image", required=True, help="Input image path")
    parser.add_argument("--repo", default="DraconicDragon/Kaloscope-onnx", help="Hugging Face repo")
    parser.add_argument("--model-file", default="v2.0/kaloscope_2-0.onnx", help="Model file in repo")
    parser.add_argument("--topk", type=int, default=15, help="Top-K artist labels")
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto", help="Inference device")
    parser.add_argument("--cache-dir", default=None, help="HF cache directory")
    return parser.parse_args()


def load_mapping(repo_id: str, cache_dir: str | None = None) -> Dict[int, str]:
    candidates = ("class_mapping.csv", "v2.0/class_mapping.csv")
    mapping: Dict[int, str] = {}

    for filename in candidates:
        try:
            mapping_path = hf_hub_download(repo_id=repo_id, filename=filename, cache_dir=cache_dir)
        except Exception:
            continue

        try:
            with open(mapping_path, newline="", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                if reader.fieldnames:
                    fieldnames = {name.lower(): name for name in reader.fieldnames}
                    id_key = next((fieldnames[k] for k in ("class_id", "id", "index", "class") if k in fieldnames), None)
                    label_key = next((fieldnames[k] for k in ("label", "name", "class_name") if k in fieldnames), None)
                    if id_key and label_key:
                        for row in reader:
                            try:
                                class_id = int(row[id_key])
                            except Exception:
                                continue
                            mapping[class_id] = (row.get(label_key, "") or "").strip()
                        if mapping:
                            return mapping

            with open(mapping_path, newline="", encoding="utf-8") as f:
                simple_reader = csv.reader(f)
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
    arr = np.asarray(image, dtype=np.float32) / 255.0
    arr = np.transpose(arr, (2, 0, 1))
    arr = np.expand_dims(arr, axis=0)
    return arr


def run_inference(model_path: str, input_tensor: np.ndarray, device: str) -> np.ndarray:
    available = ort.get_available_providers()
    if device == "cuda":
        providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
    elif device == "cpu":
        providers = ["CPUExecutionProvider"]
    else:
        providers = ["CUDAExecutionProvider", "CPUExecutionProvider"] if "CUDAExecutionProvider" in available else ["CPUExecutionProvider"]

    providers = [p for p in providers if p in available]
    if not providers:
        providers = ["CPUExecutionProvider"]

    session = ort.InferenceSession(model_path, providers=providers)
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
    return probs


def main() -> None:
    args = parse_args()
    image_path = Path(args.image)

    if not image_path.exists():
        raise RuntimeError(f"Input image not found: {image_path}")

    model_path = hf_hub_download(repo_id=args.repo, filename=args.model_file, cache_dir=args.cache_dir)
    mapping = load_mapping(args.repo, args.cache_dir)

    input_tensor = preprocess_image(image_path)
    probs = run_inference(model_path, input_tensor, args.device)

    topk = max(1, min(int(args.topk), probs.shape[0]))
    top_indices = np.argsort(probs)[::-1][:topk]

    artists: Dict[str, float] = {}
    fallback_artists: Dict[str, float] = {}
    for idx in top_indices:
        score = float(probs[idx])
        label = mapping.get(int(idx), "").strip()
        if label:
            artists[label] = score
        else:
            fallback_artists[f"class_{int(idx)}"] = score

    if not artists:
        artists = fallback_artists

    taglist = ", ".join(artists.keys())

    response = {
        "success": True,
        "model": "kaloscope-onnx",
        "topk": topk,
        "artists": artists,
        "taglist": taglist,
    }
    print(json.dumps(response, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({
            "success": False,
            "error": str(exc),
            "error_type": type(exc).__name__,
        }, ensure_ascii=False))

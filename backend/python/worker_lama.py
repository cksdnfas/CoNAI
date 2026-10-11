"""Anime/manga LaMa (big-lama fine-tuned on anime and manga): fills a masked area from its surroundings.

The TorchScript weights come from the IOPaint model releases (pinned by MD5) and live in <HF_HOME>/lama/.
"""
import hashlib
import os
import time
import urllib.request
from pathlib import Path

import numpy as np
import torch
from PIL import Image

MODEL_URL = "https://github.com/Sanster/models/releases/download/AnimeMangaInpainting/anime-manga-big-lama.pt"
MODEL_MD5 = "29f284f36a0a510bcacf39ecf4c4d54f"
MODEL_FILE = "anime-manga-big-lama.pt"
PAD_MOD = 8


def model_dir() -> Path:
    base = os.environ.get("HF_HOME") or str(Path.home() / ".cache" / "huggingface")
    return Path(base) / "lama"


def file_md5(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def fetch_weights(announce) -> Path:
    """Download the weights once (verified by MD5); `announce(state, bytes, seconds)` reports the download."""
    target = model_dir() / MODEL_FILE
    if target.is_file():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(".part")
    started = time.time()
    with urllib.request.urlopen(MODEL_URL, timeout=60) as response:  # noqa: S310 (fixed https URL)
        size = int(response.headers.get("Content-Length") or 0) or None
        announce("start", size, None)
        with partial.open("wb") as handle:
            while True:
                block = response.read(1 << 20)
                if not block:
                    break
                handle.write(block)
    if file_md5(partial) != MODEL_MD5:
        partial.unlink(missing_ok=True)
        raise RuntimeError("LaMa weights failed the checksum; download again")
    partial.replace(target)
    announce("done", size, round(time.time() - started, 1))
    return target


def pad_to_mod(array: np.ndarray, mod: int) -> np.ndarray:
    height, width = array.shape[:2]
    pad_h = (mod - height % mod) % mod
    pad_w = (mod - width % mod) % mod
    if not pad_h and not pad_w:
        return array
    pads = ((0, pad_h), (0, pad_w)) + (((0, 0),) if array.ndim == 3 else ())
    return np.pad(array, pads, mode="symmetric")


class AnimeLama:
    def __init__(self, device, announce):
        path = fetch_weights(announce)
        self.device = device
        self.model = torch.jit.load(str(path), map_location=device).eval()

    @torch.no_grad()
    def inpaint(self, image_path: str, mask_path: str, output_path: str):
        with Image.open(image_path) as source:
            image = np.asarray(source.convert("RGB"))
        with Image.open(mask_path) as source:
            mask = np.asarray(source.convert("L"))
        if mask.shape != image.shape[:2]:
            raise ValueError("mask and image sizes differ")
        height, width = mask.shape
        padded_image = pad_to_mod(image, PAD_MOD).astype(np.float32) / 255.0
        padded_mask = (pad_to_mod(mask, PAD_MOD) > 127).astype(np.float32)
        image_tensor = torch.from_numpy(padded_image).permute(2, 0, 1).unsqueeze(0).to(self.device)
        mask_tensor = torch.from_numpy(padded_mask).unsqueeze(0).unsqueeze(0).to(self.device)
        result = self.model(image_tensor, mask_tensor)
        output = result[0].permute(1, 2, 0).detach().cpu().numpy()[:height, :width]
        output = np.clip(output * 255, 0, 255).astype(np.uint8)
        Image.fromarray(output).save(output_path, format="PNG")
        return {"width": width, "height": height}

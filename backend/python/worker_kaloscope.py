"""Kaloscope 3.0 preview: artist classifier + 256-d style vector on a DINOv3 ViT-B/16 (timm port of Meta's code).

Inference follows the model card (v1-artist-classifier/README.md): EXIF fix, white background, short side → 512,
center crop 512, ImageNet mean/std. Pooled = [CLS, mean(patch tokens)] (1536-d). Style vector = projector(pooled),
L2-normalized. Artist logits = head(normalize(pooled) * sqrt(1536)), softmax.
"""
import csv
from typing import Dict, List, Optional

import numpy as np
import torch
import torch.nn.functional as F
import timm
from timm.models.eva import checkpoint_filter_fn
from huggingface_hub import hf_hub_download
from safetensors.torch import load_file
from PIL import Image

REPO = "heathcliff01/Kaloscope3.0-preview"
# Preview weights may change upstream; results stay comparable only on a fixed revision.
REVISION = "5e4bfa229619b7c459ec126283827373df9de564"
FILES = [
    "v1-artist-classifier/model.safetensors",
    "v1-artist-classifier/class_mapping.csv",
    "v1-artist-classifier/config.json",
]
MODEL_NAME = "kaloscope-3.0-preview"
STYLE_DIM = 256
INPUT_SIZE = 512
MEAN = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
STD = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)


class Kaloscope3:
    def __init__(self, device: torch.device, fetch):
        self.device = device
        fetch(REPO, FILES, REVISION)
        state = load_file(hf_hub_download(REPO, FILES[0], revision=REVISION))
        backbone_state = {key[len("backbone."):]: value for key, value in state.items() if key.startswith("backbone.")}
        backbone = timm.create_model("vit_base_patch16_dinov3_qkvb", pretrained=False, num_classes=0, img_size=INPUT_SIZE)
        backbone.load_state_dict(checkpoint_filter_fn(backbone_state, backbone), strict=True)
        self.prefix_tokens = backbone.num_prefix_tokens
        self.backbone = backbone.eval().to(device)
        projector = torch.nn.Sequential(torch.nn.Linear(1536, 1536), torch.nn.GELU(), torch.nn.Linear(1536, STYLE_DIM))
        projector.load_state_dict({
            "0.weight": state["projector.0.weight"], "0.bias": state["projector.0.bias"],
            "2.weight": state["projector.2.weight"], "2.bias": state["projector.2.bias"],
        })
        self.projector = projector.eval().to(device)
        head = torch.nn.Linear(1536, state["head.weight"].shape[0])
        head.load_state_dict({"weight": state["head.weight"], "bias": state["head.bias"]})
        self.head = head.eval().to(device)
        names: Dict[int, str] = {}
        with open(hf_hub_download(REPO, FILES[1], revision=REVISION), newline="", encoding="utf-8") as handle:
            for row in csv.reader(handle):
                if row and row[0].strip().isdigit():
                    names[int(row[0])] = row[1].strip()
        self.names = names
        # bf16 on GPU matches fp32 top-5 per the card's verification; CPU stays fp32 (no speed gain there).
        self.autocast = device.type == "cuda"

    def _preprocess(self, image: Image.Image) -> torch.Tensor:
        width, height = image.size
        scale = INPUT_SIZE / min(width, height)
        resized = image.resize((max(INPUT_SIZE, round(width * scale)), max(INPUT_SIZE, round(height * scale))), Image.Resampling.BICUBIC)
        left = (resized.size[0] - INPUT_SIZE) // 2
        top = (resized.size[1] - INPUT_SIZE) // 2
        cropped = resized.crop((left, top, left + INPUT_SIZE, top + INPUT_SIZE))
        tensor = torch.from_numpy(np.asarray(cropped, dtype=np.float32) / 255.0).permute(2, 0, 1)
        return ((tensor - MEAN) / STD).unsqueeze(0)

    @torch.inference_mode()
    def analyze(self, images: List[Image.Image], topk: int, want_style: bool) -> Dict:
        """One result for all images (video frames are averaged: probabilities and style vectors)."""
        probs_sum: Optional[torch.Tensor] = None
        style_sum: Optional[torch.Tensor] = None
        for image in images:
            inputs = self._preprocess(image).to(self.device)
            with torch.autocast(device_type="cuda", dtype=torch.bfloat16, enabled=self.autocast):
                tokens = self.backbone.forward_features(inputs)
            tokens = tokens.float()
            pooled = torch.cat([tokens[:, 0], tokens[:, self.prefix_tokens:].mean(1)], dim=-1)
            probs = self.head(F.normalize(pooled, dim=-1) * (1536 ** 0.5)).softmax(-1)[0]
            probs_sum = probs if probs_sum is None else probs_sum + probs
            if want_style:
                style = F.normalize(self.projector(pooled), dim=-1)[0]
                style_sum = style if style_sum is None else style_sum + style
        assert probs_sum is not None
        probs = (probs_sum / len(images)).cpu()
        count = max(1, min(int(topk), probs.shape[0]))
        values, indices = probs.topk(count)
        artists = {self.names.get(int(index), f"class_{int(index)}"): float(value) for value, index in zip(values, indices)}
        result = {
            "success": True,
            "model": MODEL_NAME,
            "topk": count,
            "artists": artists,
            "taglist": ", ".join(artists.keys()),
        }
        if style_sum is not None:
            result["style"] = F.normalize(style_sum, dim=-1).cpu().tolist()
        return result

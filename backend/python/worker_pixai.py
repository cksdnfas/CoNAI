"""PixAI tagger v1.0 (GPU only): Danbooru tags in six categories, 1008px ViTDet backbone.

The model classes live in the repository's tagger_pipeline.py (adapted from Meta's SAM3 ViTDet). It is not copied into
CoNAI: the file is fetched with the weights at a pinned revision and only its two model classes are used, so what runs
is fixed. Preprocessing and thresholds follow that file: alpha on white, scale to fit 1008 and pad with black,
normalize to [-1, 1], sigmoid, per-category best thresholds from config.json.
"""
import importlib.util
import os
import sys
from typing import Dict

import torch
import torch.nn.functional as F
import torchvision.transforms.functional as vF
from huggingface_hub import hf_hub_download
from PIL import Image

REPO = "pixai-labs/pixai-tagger-v1.0"
REVISION = "9fe10addf9326e292da8a85a98ea74cd91b41771"
FILES = ["config.json", "preprocessor_config.json", "tagger_pipeline.py", "model.safetensors"]
MODEL_NAME = "pixai-v1"
RATING_KEYS = {"rating:g": "general", "rating:s": "sensitive", "rating:q": "questionable", "rating:e": "explicit"}


def load_model_classes(folder: str):
    """Import tagger_pipeline.py from the pinned snapshot under a private module name."""
    name = "conai_pixai_tagger_pipeline"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, os.path.join(folder, "tagger_pipeline.py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def rescale_pad(image: torch.Tensor, size: int) -> torch.Tensor:
    height, width = image.shape[-2:]
    if height == size and width == size:
        return image
    ratio = min(size / height, size / width)
    new_height, new_width = int(height * ratio), int(width * ratio)
    image = vF.resize(image, [new_height, new_width], antialias=True)
    pad_w, pad_h = size - new_width, size - new_height
    left, top = pad_w // 2, pad_h // 2
    return F.pad(image, (left, pad_w - left, top, pad_h - top), value=0.0)


class PixaiTagger:
    def __init__(self, device: torch.device, fetch):
        if device.type != "cuda":
            raise RuntimeError("PixAI tagger needs a CUDA GPU (it is too slow on CPU)")
        self.device = device
        fetch(REPO, FILES, REVISION)
        folder = os.path.dirname(hf_hub_download(REPO, "config.json", revision=REVISION))
        module = load_model_classes(folder)
        config = module.ViTDetClsConfig.from_pretrained(folder)
        model = module.ViTDetCls.from_pretrained(folder, config=config, torch_dtype=torch.bfloat16)
        self.model = model.eval().to(device)
        self.size = int(getattr(config, "img_size", 1008))
        self.tags = list(config.tags)
        self.split = [(category, int(count)) for category, count in config.tags_split]
        best = config.category_best_threshold or {}
        thresholds = []
        for category, count in self.split:
            thresholds.extend([float(best.get(category, 0.2))] * count)
        self.thresholds = torch.tensor(thresholds, dtype=torch.float32)
        self.category_thresholds = {category: float(best.get(category, 0.2)) for category, _ in self.split}

    @torch.inference_mode()
    def tag(self, image: Image.Image, _general_threshold: float = 0.0, _character_threshold: float = 0.0) -> Dict:
        """WD-shaped result; PixAI's own per-category thresholds apply (the WD sliders are tuned for WD)."""
        tensor = vF.to_tensor(image.convert("RGB"))
        tensor = vF.normalize(rescale_pad(tensor, self.size), [0.5, 0.5, 0.5], [0.5, 0.5, 0.5])
        logits = self.model(tensor.unsqueeze(0).to(self.device, torch.bfloat16))
        probs = torch.sigmoid(logits.float())[0].cpu()
        categories: Dict[str, Dict[str, float]] = {}
        start = 0
        for category, count in self.split:
            part = probs[start:start + count]
            if category == "rating":
                chosen = range(count)
            else:
                chosen = torch.nonzero(part > self.thresholds[start:start + count]).flatten().tolist()
            pairs = sorted(((self.tags[start + index], float(part[index])) for index in chosen), key=lambda item: item[1], reverse=True)
            categories[category] = dict(pairs)
            start += count

        rating = {RATING_KEYS.get(name, name): value for name, value in categories.get("rating", {}).items()}
        # Series names search like tags, so they join the general ones; artists and meta stay apart.
        general = dict(sorted({**categories.get("general", {}), **categories.get("copyright", {})}.items(), key=lambda item: item[1], reverse=True))
        character = categories.get("character", {})
        caption = ", ".join([*general.keys(), *character.keys()])
        taglist = caption.replace("_", " ").replace("(", "\\(").replace(")", "\\)")
        return {
            "success": True,
            "caption": caption,
            "taglist": taglist,
            "rating": rating,
            "general": general,
            "character": character,
            "artist": categories.get("style", {}),
            "meta": categories.get("meta", {}),
            "model": MODEL_NAME,
            "thresholds": {"general": self.category_thresholds.get("general", 0.2), "character": self.category_thresholds.get("character", 0.2)},
        }

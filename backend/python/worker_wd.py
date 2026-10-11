"""WD v3 tagger (SmilingWolf) on torch + timm."""
import csv
from typing import Dict, List, Optional

import numpy as np
import timm
import torch
from huggingface_hub import hf_hub_download
from PIL import Image
from timm.data import create_transform, resolve_data_config

from worker_dtypes import half_dtype
from worker_images import pad_square

WD_REPOS = {
    "vit": "SmilingWolf/wd-vit-tagger-v3",
    "swinv2": "SmilingWolf/wd-swinv2-tagger-v3",
    "convnext": "SmilingWolf/wd-convnext-tagger-v3",
}
CATEGORY_GENERAL = 0
CATEGORY_CHARACTER = 4
CATEGORY_RATING = 9


class WdTagger:
    def __init__(self, variant: str, device: torch.device, fetch):
        repo = WD_REPOS.get(variant)
        if not repo:
            raise ValueError(f"Unknown WD model: {variant}")
        self.variant = variant
        self.device = device
        fetch(repo, ["model.safetensors", "config.json", "selected_tags.csv"])
        model = timm.create_model("hf-hub:" + repo).eval()
        model.load_state_dict(timm.models.load_state_dict_from_hf(repo))
        # FP16 on CUDA: closest to FP32 (tags identical, probs within 5e-4).
        self.dtype = half_dtype(device, torch.float16)
        self.model = model.to(device, self.dtype)
        self.transform = create_transform(**resolve_data_config(model.pretrained_cfg, model=model))
        names: List[str] = []
        categories: List[int] = []
        with open(hf_hub_download(repo, "selected_tags.csv"), newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                names.append(row["name"])
                categories.append(int(row["category"]))
        self.names = names
        categories_array = np.asarray(categories)
        self.general_idx = np.where(categories_array == CATEGORY_GENERAL)[0]
        self.character_idx = np.where(categories_array == CATEGORY_CHARACTER)[0]
        self.rating_idx = np.where(categories_array == CATEGORY_RATING)[0]

    @torch.inference_mode()
    def tag(self, image: Image.Image, general_threshold: float, character_threshold: float) -> Dict:
        inputs = self.transform(pad_square(image)).unsqueeze(0)
        inputs = inputs[:, [2, 1, 0]]  # RGB -> BGR, as the model was trained
        probs = torch.sigmoid(self.model(inputs.to(self.device, self.dtype)).float()).cpu().numpy()[0]

        def pick(indices, threshold: Optional[float]):
            selected = [(self.names[i], float(probs[i])) for i in indices if threshold is None or probs[i] > threshold]
            return dict(sorted(selected, key=lambda item: item[1], reverse=True))

        rating = pick(self.rating_idx, None)
        general = pick(self.general_idx, general_threshold)
        character = pick(self.character_idx, character_threshold)
        caption = ", ".join([*general.keys(), *character.keys()])
        taglist = caption.replace("_", " ").replace("(", "\\(").replace(")", "\\)")
        return {
            "success": True,
            "caption": caption,
            "taglist": taglist,
            "rating": rating,
            "general": general,
            "character": character,
            "model": self.variant,
            "thresholds": {"general": general_threshold, "character": character_threshold},
        }

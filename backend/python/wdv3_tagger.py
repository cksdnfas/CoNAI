#!/usr/bin/env python3
"""
WD v3 Tagger - Modified for ComfyUI Image Manager Backend
Outputs JSON format for Node.js integration
"""
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

# Set cache directory BEFORE importing huggingface_hub
# This must be done before any huggingface imports to take effect
if len(sys.argv) > 5 and sys.argv[5]:
    cache_dir = sys.argv[5]
    os.environ['HF_HOME'] = cache_dir
    os.environ['HUGGINGFACE_HUB_CACHE'] = cache_dir
    os.environ['TRANSFORMERS_CACHE'] = cache_dir

import numpy as np
import pandas as pd
import timm
import torch
from huggingface_hub import hf_hub_download
from huggingface_hub.utils import HfHubHTTPError
from PIL import Image
from timm.data import create_transform, resolve_data_config
from torch import Tensor, nn
from torch.nn import functional as F

torch_device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
MODEL_REPO_MAP = {
    "vit": "SmilingWolf/wd-vit-tagger-v3",
    "swinv2": "SmilingWolf/wd-swinv2-tagger-v3",
    "convnext": "SmilingWolf/wd-convnext-tagger-v3",
}


def pil_ensure_rgb(image: Image.Image) -> Image.Image:
    """Convert image to RGB format"""
    if image.mode not in ["RGB", "RGBA"]:
        image = image.convert("RGBA") if "transparency" in image.info else image.convert("RGB")
    if image.mode == "RGBA":
        canvas = Image.new("RGBA", image.size, (255, 255, 255))
        canvas.alpha_composite(image)
        image = canvas.convert("RGB")
    return image


def pil_pad_square(image: Image.Image) -> Image.Image:
    """Pad image to square with white background"""
    w, h = image.size
    px = max(image.size)
    canvas = Image.new("RGB", (px, px), (255, 255, 255))
    canvas.paste(image, ((px - w) // 2, (px - h) // 2))
    return canvas


@dataclass
class LabelData:
    names: list[str]
    rating: list[np.int64]
    general: list[np.int64]
    character: list[np.int64]


def load_labels_hf(
    repo_id: str,
    revision: Optional[str] = None,
    token: Optional[str] = None,
) -> LabelData:
    """Load label data from Hugging Face Hub"""
    try:
        csv_path = hf_hub_download(
            repo_id=repo_id, filename="selected_tags.csv", revision=revision, token=token
        )
        csv_path = Path(csv_path).resolve()
    except HfHubHTTPError as e:
        raise FileNotFoundError(f"selected_tags.csv failed to download from {repo_id}") from e

    df: pd.DataFrame = pd.read_csv(csv_path, usecols=["name", "category"])
    tag_data = LabelData(
        names=df["name"].tolist(),
        rating=list(np.where(df["category"] == 9)[0]),
        general=list(np.where(df["category"] == 0)[0]),
        character=list(np.where(df["category"] == 4)[0]),
    )

    return tag_data


def get_tags(
    probs: Tensor,
    labels: LabelData,
    gen_threshold: float,
    char_threshold: float,
):
    """Extract tags from prediction probabilities"""
    probs_list = list(zip(labels.names, probs.numpy()))

    # Rating labels
    rating_labels = dict([probs_list[i] for i in labels.rating])

    # General labels (above threshold)
    gen_labels = [probs_list[i] for i in labels.general]
    gen_labels = dict([x for x in gen_labels if x[1] > gen_threshold])
    gen_labels = dict(sorted(gen_labels.items(), key=lambda item: item[1], reverse=True))

    # Character labels (above threshold)
    char_labels = [probs_list[i] for i in labels.character]
    char_labels = dict([x for x in char_labels if x[1] > char_threshold])
    char_labels = dict(sorted(char_labels.items(), key=lambda item: item[1], reverse=True))

    # Combine general and character labels
    combined_names = [x for x in gen_labels]
    combined_names.extend([x for x in char_labels])

    # Convert to comma-separated string
    caption = ", ".join(combined_names)
    taglist = caption.replace("_", " ").replace("(", r"\(").replace(")", r"\)")

    return caption, taglist, rating_labels, char_labels, gen_labels


def process_image(
    image_path: str,
    model_name: str = "vit",
    gen_threshold: float = 0.35,
    char_threshold: float = 0.75,
    models_cache_dir: Optional[str] = None
) -> dict:
    """
    Process image and return tagging results as JSON

    Args:
        image_path: Path to image file
        model_name: Model type (vit, swinv2, convnext)
        gen_threshold: Threshold for general tags
        char_threshold: Threshold for character tags
        models_cache_dir: Optional cache directory for models

    Returns:
        Dictionary with tagging results
    """
    try:
        # Validate inputs
        repo_id = MODEL_REPO_MAP.get(model_name)
        if not repo_id:
            raise ValueError(f"Unknown model: {model_name}. Available: {list(MODEL_REPO_MAP.keys())}")

        image_path_obj = Path(image_path).resolve()
        if not image_path_obj.is_file():
            raise FileNotFoundError(f"Image file not found: {image_path}")

        # Cache directory is already set via environment variables before imports
        # models_cache_dir parameter is kept for API compatibility

        # Load model
        model: nn.Module = timm.create_model("hf-hub:" + repo_id).eval()
        state_dict = timm.models.load_state_dict_from_hf(repo_id)
        model.load_state_dict(state_dict)

        # Load labels
        labels: LabelData = load_labels_hf(repo_id=repo_id)

        # Create transform
        transform = create_transform(**resolve_data_config(model.pretrained_cfg, model=model))

        # Load and preprocess image
        img_input: Image.Image = Image.open(image_path_obj)
        img_input = pil_ensure_rgb(img_input)
        img_input = pil_pad_square(img_input)

        # Transform and convert RGB to BGR
        inputs: Tensor = transform(img_input).unsqueeze(0)
        inputs = inputs[:, [2, 1, 0]]

        # Run inference
        with torch.inference_mode():
            if torch_device.type != "cpu":
                model = model.to(torch_device)
                inputs = inputs.to(torch_device)

            outputs = model.forward(inputs)
            outputs = F.sigmoid(outputs)

            if torch_device.type != "cpu":
                inputs = inputs.to("cpu")
                outputs = outputs.to("cpu")
                model = model.to("cpu")

        # Process results
        caption, taglist, ratings, character, general = get_tags(
            probs=outputs.squeeze(0),
            labels=labels,
            gen_threshold=gen_threshold,
            char_threshold=char_threshold,
        )

        # Format output
        result = {
            "success": True,
            "caption": caption,
            "taglist": taglist,
            "rating": {k: float(v) for k, v in ratings.items()},
            "general": {k: float(v) for k, v in general.items()},
            "character": {k: float(v) for k, v in character.items()},
            "model": model_name,
            "thresholds": {
                "general": gen_threshold,
                "character": char_threshold
            }
        }

        return result

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "error_type": type(e).__name__
        }


def main():
    """Main entry point for CLI usage"""
    if len(sys.argv) < 2:
        print(json.dumps({
            "success": False,
            "error": "Usage: python wdv3_tagger.py <image_path> [model] [gen_threshold] [char_threshold] [cache_dir]"
        }))
        sys.exit(1)

    image_path = sys.argv[1]
    model_name = sys.argv[2] if len(sys.argv) > 2 else "vit"
    gen_threshold = float(sys.argv[3]) if len(sys.argv) > 3 else 0.35
    char_threshold = float(sys.argv[4]) if len(sys.argv) > 4 else 0.75
    cache_dir = sys.argv[5] if len(sys.argv) > 5 else None

    result = process_image(
        image_path=image_path,
        model_name=model_name,
        gen_threshold=gen_threshold,
        char_threshold=char_threshold,
        models_cache_dir=cache_dir
    )

    # Output JSON to stdout
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()

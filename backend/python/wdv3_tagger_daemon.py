#!/usr/bin/env python3
"""
WD v3 Tagger Daemon - Long-running process for model persistence
Communicates via stdin/stdout for efficient batch processing
"""
import json
import os
import sys
from pathlib import Path
from typing import Optional

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

# Global state
torch_device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model: Optional[nn.Module] = None
current_model_name: Optional[str] = None
labels = None
transform = None

MODEL_REPO_MAP = {
    "vit": "SmilingWolf/wd-vit-tagger-v3",
    "swinv2": "SmilingWolf/wd-swinv2-tagger-v3",
    "convnext": "SmilingWolf/wd-convnext-tagger-v3",
}


class LabelData:
    def __init__(self, names, rating, general, character):
        self.names = names
        self.rating = rating
        self.general = general
        self.character = character


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


def load_labels_hf(repo_id: str, revision: Optional[str] = None, token: Optional[str] = None) -> LabelData:
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


def get_tags(probs: Tensor, label_data: LabelData, gen_threshold: float, char_threshold: float):
    """Extract tags from prediction probabilities"""
    probs_list = list(zip(label_data.names, probs.numpy()))

    # Rating labels
    rating_labels = dict([probs_list[i] for i in label_data.rating])

    # General labels (above threshold)
    gen_labels = [probs_list[i] for i in label_data.general]
    gen_labels = dict([x for x in gen_labels if x[1] > gen_threshold])
    gen_labels = dict(sorted(gen_labels.items(), key=lambda item: item[1], reverse=True))

    # Character labels (above threshold)
    char_labels = [probs_list[i] for i in label_data.character]
    char_labels = dict([x for x in char_labels if x[1] > char_threshold])
    char_labels = dict(sorted(char_labels.items(), key=lambda item: item[1], reverse=True))

    # Combine general and character labels
    combined_names = [x for x in gen_labels]
    combined_names.extend([x for x in char_labels])

    # Convert to comma-separated string
    caption = ", ".join(combined_names)
    taglist = caption.replace("_", " ").replace("(", r"\(").replace(")", r"\)")

    return caption, taglist, rating_labels, char_labels, gen_labels


def load_model_command(model_name: str, cache_dir: Optional[str] = None):
    """Load model into memory"""
    global model, current_model_name, labels, transform

    try:
        # Validate model
        repo_id = MODEL_REPO_MAP.get(model_name)
        if not repo_id:
            return {
                "success": False,
                "error": f"Unknown model: {model_name}",
                "error_type": "ValidationError"
            }

        # Set cache directory if provided
        if cache_dir:
            os.environ['HF_HOME'] = cache_dir
            os.environ['HUGGINGFACE_HUB_CACHE'] = cache_dir
            os.environ['TRANSFORMERS_CACHE'] = cache_dir

        # Load model
        model = timm.create_model("hf-hub:" + repo_id).eval()
        state_dict = timm.models.load_state_dict_from_hf(repo_id)
        model.load_state_dict(state_dict)

        # Move to device
        if torch_device.type != "cpu":
            model = model.to(torch_device)

        # Load labels
        labels = load_labels_hf(repo_id=repo_id)

        # Create transform
        transform = create_transform(**resolve_data_config(model.pretrained_cfg, model=model))

        current_model_name = model_name

        return {
            "success": True,
            "model": model_name,
            "device": str(torch_device)
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "error_type": type(e).__name__
        }


def unload_model_command():
    """Unload model from memory"""
    global model, current_model_name, labels, transform

    try:
        # Clear references
        model = None
        current_model_name = None
        labels = None
        transform = None

        # Clear CUDA cache if available
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        return {"success": True}

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "error_type": type(e).__name__
        }


def tag_image_command(image_path: str, gen_threshold: float, char_threshold: float):
    """Tag a single image using loaded model"""
    global model, current_model_name, labels, transform

    try:
        # Check if model is loaded
        if model is None or labels is None or transform is None:
            return {
                "success": False,
                "error": "Model not loaded. Call load_model first.",
                "error_type": "StateError"
            }

        # Validate image path
        image_path_obj = Path(image_path).resolve()
        if not image_path_obj.is_file():
            return {
                "success": False,
                "error": f"Image file not found: {image_path}",
                "error_type": "FileNotFoundError"
            }

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
                inputs = inputs.to(torch_device)

            outputs = model.forward(inputs)
            outputs = F.sigmoid(outputs)

            if torch_device.type != "cpu":
                inputs = inputs.to("cpu")
                outputs = outputs.to("cpu")

        # Process results
        caption, taglist, ratings, character, general = get_tags(
            probs=outputs.squeeze(0),
            label_data=labels,
            gen_threshold=gen_threshold,
            char_threshold=char_threshold,
        )

        # Format output
        return {
            "success": True,
            "caption": caption,
            "taglist": taglist,
            "rating": {k: float(v) for k, v in ratings.items()},
            "general": {k: float(v) for k, v in general.items()},
            "character": {k: float(v) for k, v in character.items()},
            "model": current_model_name,
            "thresholds": {
                "general": gen_threshold,
                "character": char_threshold
            }
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "error_type": type(e).__name__
        }


def get_status_command():
    """Get current daemon status"""
    global model, current_model_name

    return {
        "success": True,
        "model_loaded": model is not None,
        "current_model": current_model_name,
        "device": str(torch_device)
    }


def send_response(response: dict):
    """Send JSON response to stdout"""
    print(json.dumps(response, ensure_ascii=False))
    sys.stdout.flush()


def main():
    """Main daemon loop"""
    # Signal ready
    send_response({"success": True, "status": "ready"})

    # Process commands from stdin
    for line in sys.stdin:
        try:
            line = line.strip()
            if not line:
                continue

            command = json.loads(line)
            action = command.get("action")

            if action == "load_model":
                response = load_model_command(
                    model_name=command.get("model", "vit"),
                    cache_dir=command.get("cache_dir")
                )
                send_response(response)

            elif action == "unload_model":
                response = unload_model_command()
                send_response(response)

            elif action == "tag_image":
                response = tag_image_command(
                    image_path=command.get("image_path"),
                    gen_threshold=command.get("gen_threshold", 0.35),
                    char_threshold=command.get("char_threshold", 0.75)
                )
                send_response(response)

            elif action == "get_status":
                response = get_status_command()
                send_response(response)

            elif action == "shutdown":
                send_response({"success": True, "status": "shutdown"})
                break

            else:
                send_response({
                    "success": False,
                    "error": f"Unknown action: {action}",
                    "error_type": "InvalidAction"
                })

        except json.JSONDecodeError as e:
            send_response({
                "success": False,
                "error": f"Invalid JSON: {str(e)}",
                "error_type": "JSONDecodeError"
            })
        except Exception as e:
            send_response({
                "success": False,
                "error": str(e),
                "error_type": type(e).__name__
            })


if __name__ == "__main__":
    main()

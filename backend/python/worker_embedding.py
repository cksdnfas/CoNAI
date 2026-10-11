"""EmbeddingGemma 2 embeddings (CPU, bf16): text, and images when the vision tower is kept ("full" variant).

Inputs get the model card's task prefixes here, so callers send plain text:
  query       "task: search result | query: <text>"        (what is searched for)
  document    "title: <title|none> | text: <text>"          (what is searched)
  similarity  "task: sentence similarity | query: <text>"   (symmetric comparison)
Documents may be split into token windows (chunkTokens / overlapTokens); each chunk comes back with its character
span in the original text. Vectors are truncated to `dim` (Matryoshka) and L2-normalized, sent as base64 float32.
Images share the space with search queries (text -> image search) at IMAGE_TOKENS soft tokens each (140: 951 ms on
8 CPU threads, the same top hits as 280 in 5 of 6 test queries).
"""
import base64
import gc
import os
from typing import Dict, List, Optional

import numpy as np
import torch
from huggingface_hub import hf_hub_download

REPO = "google/embeddinggemma-2"
REVISION = "914f7f89142e33e77833254d9c9b90c3cef7303b"
FILES = [
    "modules.json",
    "config_sentence_transformers.json",
    "sentence_bert_config.json",
    "1_Pooling/config.json",
    "config.json",
    "tokenizer_config.json",
    "tokenizer.json",
    "tokenizer.model",
    "chat_template.jinja",
    "preprocessor_config.json",
    "processor_config.json",
    "model.safetensors",
]
MODEL_NAME = "embeddinggemma-2"
PREFIX = {
    "query": "task: search result | query: ",
    "similarity": "task: sentence similarity | query: ",
}
MAX_TOKENS = 2048
BATCH_SIZE = 16
IMAGE_TOKENS = 140


def document_prefix(title: Optional[str]) -> str:
    title = " ".join((title or "").split())[:200]
    return f"title: {title or 'none'} | text: "


class TextEmbedder:
    def __init__(self, device: torch.device, fetch, vision: bool = False):
        from sentence_transformers import SentenceTransformer

        self.device = device
        self.vision = vision
        fetch(REPO, FILES, REVISION)
        folder = os.path.dirname(hf_hub_download(REPO, "modules.json", revision=REVISION))
        # modules.json lists a Normalize module folder that holds no files, so the Hub never creates it.
        os.makedirs(os.path.join(folder, "2_Normalize"), exist_ok=True)
        dtype = torch.bfloat16 if device.type == "cpu" else torch.float16
        model = SentenceTransformer(folder, device=str(device), model_kwargs={"torch_dtype": dtype}, local_files_only=True)
        inner = model[0].auto_model
        # The vision and audio towers are 40% of the weights; text-only instances drop both, image ones keep vision.
        dropped = ("audio_tower", "embed_audio") if vision else ("vision_tower", "audio_tower", "embed_vision", "embed_audio")
        for name in dropped:
            if hasattr(inner, name):
                setattr(inner, name, None)
        gc.collect()
        if vision:
            processor = model[0].processor
            processor.image_processor.max_soft_tokens = IMAGE_TOKENS
            processor.image_processor.image_seq_length = IMAGE_TOKENS
            processor.image_seq_length = IMAGE_TOKENS
        model.max_seq_length = MAX_TOKENS
        self.model = model.eval()
        self.tokenizer = model.tokenizer

    def chunks(self, text: str, chunk_tokens: int, overlap_tokens: int, max_chunks: int) -> List[Dict]:
        """Character spans of token windows over `text` (one span for short text)."""
        if chunk_tokens <= 0:
            return [{"start": 0, "end": len(text)}]
        encoded = self.tokenizer(text, add_special_tokens=False, return_offsets_mapping=True)
        offsets = encoded["offset_mapping"]
        if len(offsets) <= chunk_tokens:
            return [{"start": 0, "end": len(text)}]
        step = max(1, chunk_tokens - max(0, min(overlap_tokens, chunk_tokens // 2)))
        spans = []
        for first in range(0, len(offsets), step):
            last = min(first + chunk_tokens, len(offsets)) - 1
            spans.append({"start": offsets[first][0], "end": offsets[last][1]})
            if last == len(offsets) - 1 or len(spans) >= max_chunks:
                break
        return spans

    def encode(self, inputs: List, dim: int, batch_size: int = BATCH_SIZE) -> np.ndarray:
        with torch.inference_mode():
            vectors = self.model.encode(inputs, batch_size=batch_size, convert_to_numpy=True, normalize_embeddings=False,
                                        show_progress_bar=False)
        vectors = vectors[:, :dim].astype(np.float32)
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        return vectors / np.maximum(norms, 1e-12)

    def embed(self, items: List[Dict], kind: str, dim: int, chunk_tokens: int = 0, overlap_tokens: int = 0,
              max_chunks: int = 64) -> List[List[Dict]]:
        """Per item, its chunks: [{start, end, vector}] (one chunk for queries and short text)."""
        inputs: List[str] = []
        owners: List[tuple] = []
        result: List[List[Dict]] = []
        for index, item in enumerate(items):
            text = str(item.get("text") or "")
            spans = self.chunks(text, chunk_tokens, overlap_tokens, max_chunks) if kind == "document" else [{"start": 0, "end": len(text)}]
            prefix = document_prefix(item.get("title")) if kind == "document" else PREFIX[kind]
            result.append([])
            for span in spans:
                inputs.append(prefix + text[span["start"]:span["end"]])
                owners.append((index, span))
        if not inputs:
            return result
        vectors = self.encode(inputs, dim)
        for (index, span), vector in zip(owners, vectors):
            result[index].append({**span, "vector": base64.b64encode(vector.tobytes()).decode("ascii")})
        return result

    def embed_images(self, images: List, dim: int) -> List[Dict]:
        """One vector per decoded image (None entries pass their error through): [{vector} | {error}]."""
        if not self.vision:
            raise RuntimeError("This embedding instance has no vision tower")
        result: List[Dict] = [{} for _ in images]
        valid = [(index, image) for index, image in enumerate(images) if not isinstance(image, Exception)]
        for index, image in enumerate(images):
            if isinstance(image, Exception):
                result[index] = {"error": str(image), "errorType": type(image).__name__}
        if valid:
            vectors = self.encode([{"image": image} for _, image in valid], dim, batch_size=4)
            for (index, _), vector in zip(valid, vectors):
                result[index] = {"vector": base64.b64encode(vector.tobytes()).decode("ascii")}
        return result

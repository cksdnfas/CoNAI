#!/usr/bin/env python3
"""CoNAI AI worker: a long-lived process hosting the image models (WD tagger, Kaloscope 3, LaMa) or text embeddings.

Protocol (stdin/stdout, UTF-8, one JSON object per line):
  request  {"id": "...", "op": "...", "threads"?: n, ...}
  reply    {"id": "...", "ok": true, "result": {...}} | {"id": "...", "ok": false, "error": "...", "errorType": "..."}
  event    {"event": "ready" | "download", ...}   (not a reply; "id" set when caused by a request)
Requests are handled one at a time in arrival order; the Node client owns queueing and priorities.
stdout is reserved for the protocol: anything a library prints goes to stderr.
"""
import gc
import json
import os
import sys
import time
import traceback

PROTOCOL_OUT = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1)
sys.stdout = sys.stderr

import torch  # noqa: E402

THREADS = int(os.environ.get("CONAI_AI_THREADS", "0") or 0)
if THREADS > 0:
    torch.set_num_threads(THREADS)
    torch.set_num_interop_threads(1)
DEFAULT_THREADS = torch.get_num_threads()

from huggingface_hub import HfApi, hf_hub_download  # noqa: E402

from worker_images import load_rgb  # noqa: E402

current_request_id = None
models = {}


def send(message):
    PROTOCOL_OUT.write(json.dumps(message, ensure_ascii=False) + "\n")
    PROTOCOL_OUT.flush()


def fetch(repo, files, revision=None):
    """Make sure files are in the HF cache, announcing each download (size from the Hub when it answers)."""
    for filename in files:
        try:
            hf_hub_download(repo, filename, revision=revision, local_files_only=True)
            continue
        except Exception:
            pass
        size = None
        try:
            info = HfApi().get_paths_info(repo, [filename], revision=revision)
            size = getattr(info[0], "size", None) if info else None
        except Exception:
            pass
        send({"event": "download", "id": current_request_id, "repo": repo, "file": filename, "state": "start", "bytes": size})
        started = time.time()
        hf_hub_download(repo, filename, revision=revision)
        send({"event": "download", "id": current_request_id, "repo": repo, "file": filename, "state": "done", "bytes": size,
              "seconds": round(time.time() - started, 1)})


def resolve_device(requested):
    available = torch.cuda.is_available()
    if requested == "cuda" and not available:
        raise RuntimeError(f"CUDA is not available (torch {torch.__version__}, CUDA {torch.version.cuda})")
    return torch.device("cuda" if requested in ("auto", "cuda") and available else "cpu")


def unload(name):
    entry = models.pop(name, None)
    if entry is None:
        return False
    del entry
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return True


def ensure_model(name, options):
    """Load (or reload when the variant/device changed) and return the model instance."""
    device = resolve_device(options.get("device", "auto"))
    key = (options.get("variant"), str(device))
    entry = models.get(name)
    if entry and entry["key"] == key:
        return entry["instance"]
    unload(name)
    if name == "wd" and (options.get("variant") or "").startswith("pixai"):
        from worker_pixai import PixaiTagger
        instance = PixaiTagger(device, fetch)
    elif name == "wd":
        from worker_wd import WdTagger
        instance = WdTagger(options.get("variant") or "vit", device, fetch)
    elif name == "kaloscope":
        from worker_kaloscope import Kaloscope3
        instance = Kaloscope3(device, fetch)
    elif name == "embedding":
        from worker_embedding import TextEmbedder
        instance = TextEmbedder(device, fetch, vision=options.get("variant") == "full")
    elif name == "lama":
        from worker_lama import MODEL_FILE, AnimeLama

        def announce(state, size, seconds):
            event = {"event": "download", "id": current_request_id, "repo": "Sanster/models", "file": MODEL_FILE, "state": state, "bytes": size}
            if seconds is not None:
                event["seconds"] = seconds
            send(event)

        instance = AnimeLama(device, announce)
    else:
        raise ValueError(f"Unknown model: {name}")
    models[name] = {"key": key, "instance": instance, "device": str(device), "variant": options.get("variant")}
    return instance


def op_status(_request):
    return {
        "torch": torch.__version__,
        "cudaAvailable": torch.cuda.is_available(),
        "deviceName": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "threads": torch.get_num_threads(),
        "models": {name: {"device": entry["device"], "variant": entry["variant"]} for name, entry in models.items()},
    }


def op_load(request):
    ensure_model(request["model"], request.get("options") or {})
    return op_status(request)


def op_unload(request):
    names = request.get("models") or list(models.keys())
    return {"unloaded": [name for name in names if unload(name)]}


def task_error(exc):
    return {"success": False, "error": str(exc), "error_type": type(exc).__name__}


def op_analyze(request):
    """Run the requested models over one image or a video's frames, decoding each file once."""
    frames = []
    for path in request["images"]:
        try:
            frames.append((load_rgb(path), None))
        except Exception as exc:  # noqa: BLE001
            frames.append((None, exc))
    result = {}

    wd_options = request.get("wd")
    if wd_options is not None:
        try:
            tagger = ensure_model("wd", wd_options)
            general = float(wd_options.get("general", 0.35))
            character = float(wd_options.get("character", 0.75))
            result["wd"] = [task_error(error) if image is None else tagger.tag(image, general, character) for image, error in frames]
        except Exception as exc:  # noqa: BLE001
            result["wd"] = [task_error(exc)]

    kaloscope_options = request.get("kaloscope")
    if kaloscope_options is not None:
        valid = [image for image, _ in frames if image is not None]
        try:
            if not valid:
                raise frames[0][1] if frames and frames[0][1] else ValueError("no images")
            classifier = ensure_model("kaloscope", kaloscope_options)
            result["kaloscope"] = classifier.analyze(valid, int(kaloscope_options.get("topk", 15)), bool(kaloscope_options.get("style", True)))
        except Exception as exc:  # noqa: BLE001
            result["kaloscope"] = task_error(exc)

    result["devices"] = {name: models[name]["device"] for name in ("wd", "kaloscope") if name in result and name in models}
    return result


def embedding_options(request):
    """Text-only instance, or "full" (vision tower kept) while image embeddings are on; one instance serves both."""
    return {"device": request.get("device", "cpu"), "variant": "full" if request.get("variant") == "full" else "text"}


def op_embed(request):
    """Text embeddings: {items: [{text, title?}], kind: query|document|similarity, dim, chunkTokens?, overlapTokens?}."""
    kind = request.get("kind", "document")
    if kind not in ("query", "document", "similarity"):
        raise ValueError(f"Unknown embedding kind: {kind}")
    embedder = ensure_model("embedding", embedding_options(request))
    vectors = embedder.embed(
        request.get("items") or [],
        kind,
        int(request.get("dim", 256)),
        int(request.get("chunkTokens", 0)),
        int(request.get("overlapTokens", 0)),
        int(request.get("maxChunks", 64)),
    )
    return {"model": "embeddinggemma-2", "device": models["embedding"]["device"], "items": vectors}


def op_chunk(request):
    """Character spans of token windows over each text (the embedding tokenizer), without embedding them."""
    embedder = ensure_model("embedding", embedding_options(request))
    return {"items": [embedder.chunks(str(text or ""), int(request.get("chunkTokens", 512)), int(request.get("overlapTokens", 64)),
                                      int(request.get("maxChunks", 64))) for text in request.get("texts") or []]}


def op_embed_images(request):
    """Image embeddings: {images: [path], dim} -> items [{vector} | {error}] in order (needs the "full" variant)."""
    images = []
    for path in request.get("images") or []:
        try:
            images.append(load_rgb(path))
        except Exception as exc:  # noqa: BLE001
            images.append(exc)
    embedder = ensure_model("embedding", {"device": request.get("device", "cpu"), "variant": "full"})
    items = embedder.embed_images(images, int(request.get("dim", 256)))
    return {"model": "embeddinggemma-2", "device": models["embedding"]["device"], "items": items}


def op_inpaint(request):
    """Fill the white part of `mask` in `image` (same-size PNGs) and write the result to `output` as PNG."""
    model = ensure_model("lama", {"device": request.get("device", "auto")})
    result = model.inpaint(request["image"], request["mask"], request["output"])
    return {**result, "device": models["lama"]["device"]}


OPS = {
    "status": op_status,
    "load": op_load,
    "unload": op_unload,
    "analyze": op_analyze,
    "embed": op_embed,
    "chunk": op_chunk,
    "embed_images": op_embed_images,
    "inpaint": op_inpaint,
}


def main():
    global current_request_id
    send({
        "event": "ready",
        "pid": os.getpid(),
        "torch": torch.__version__,
        "cudaAvailable": torch.cuda.is_available(),
        "threads": torch.get_num_threads(),
    })
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            send({"id": None, "ok": False, "error": f"Invalid JSON: {exc}", "errorType": "JSONDecodeError"})
            continue
        current_request_id = request.get("id")
        op = request.get("op")
        if op == "shutdown":
            send({"id": current_request_id, "ok": True, "result": {}})
            break
        handler = OPS.get(op)
        if handler is None:
            send({"id": current_request_id, "ok": False, "error": f"Unknown op: {op}", "errorType": "InvalidOp"})
            continue
        # A request may run on fewer threads (background work while another worker is busy); the rest get the default.
        threads = int(request.get("threads") or 0) or DEFAULT_THREADS
        if torch.get_num_threads() != threads:
            torch.set_num_threads(threads)
        try:
            send({"id": current_request_id, "ok": True, "result": handler(request)})
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc(file=sys.stderr)
            send({"id": current_request_id, "ok": False, "error": str(exc), "errorType": type(exc).__name__})
        finally:
            current_request_id = None


if __name__ == "__main__":
    main()

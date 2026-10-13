# CoNAI AI worker

`conai_worker.py` runs as two long-lived processes: the vision worker (taggers and Kaloscope, GPU or CPU) and the
embedding worker (EmbeddingGemma 2, always CPU), so a chat query never waits behind image tagging. The backend starts
each on first use, queues requests by priority and unloads each model after its idle setting.

Each worker admits at most 64 waiting requests. The normal ten-minute request deadline includes queue and startup
time; download events extend an active request's deadline. Cancellation removes waiting work immediately. Active
work keeps its slot until the worker replies or exits, so cancelled or timed-out requests never overlap the next
request on the same process. Embedding queries share pending batches; a cold query timeout may leave its model
warming for the next query, while disabling embeddings invalidates earlier requests.

| File | Role |
| --- | --- |
| `conai_worker.py` | stdin/stdout JSON-lines protocol, model registry, device choice, download events |
| `worker_images.py` | image loading shared by every model (EXIF transpose, alpha on white, size cap) |
| `worker_dtypes.py` | weight precision for WD / Kaloscope / embeddings: half on CUDA, BF16 on CPUs with native BF16, else FP32 |
| `worker_wd.py` | WD v3 tagger (SmilingWolf `wd-*-tagger-v3`, timm) |
| `worker_pixai.py` | PixAI tagger v1.0 (GPU only; model classes loaded from the pinned repository file) |
| `worker_kaloscope.py` | Kaloscope 3.0 preview: artist classifier + 256-d style vector (pinned revision) |
| `worker_lama.py` | anime/manga LaMa for the image editor's AI erase (TorchScript weights from the IOPaint releases, MD5-pinned, in `models/lama/`) |
| `worker_embedding.py` | EmbeddingGemma 2: text (task prefixes, token-window chunks) and, in the "full" variant, images |
| `ai_runtime_probe.py` | prints the Python / torch / CUDA / package report the settings page shows |
| `install-ai-env.sh` | Docker build helper: uv-managed Python 3.12 venv + torch for `TORCH_BACKEND` |

## Python environment

The app installs its own environment: 설정 › 자동 › AI 런타임. It uses uv to fetch Python 3.12 and a torch
build matched to the GPU (cpu, cu126, cu130, cu132), then `requirements-ai.txt`.

A custom Python works too (3.10+): install torch for your GPU from https://pytorch.org first, then

```bash
pip install -r requirements.txt
```

and point 설정 › 자동 › AI 런타임 › Python 경로 at it.

Models download from Hugging Face into the app's `models/` folder on first use.

## Protocol

```text
request  {"id": "1", "op": "analyze", "images": ["a.png"], "wd": {...}, "kaloscope": {...}}
reply    {"id": "1", "ok": true, "result": {...}}  |  {"id": "1", "ok": false, "error": "...", "errorType": "..."}
event    {"event": "ready" | "download", ...}
```

Ops: `status`, `load`, `unload`, `analyze` (taggers, Kaloscope), `embed` (text), `chunk` (token windows),
`embed_images`, `inpaint` (image + mask PNG → PNG), `shutdown`.

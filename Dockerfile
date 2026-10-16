# CoNAI Coolify deployment image.
FROM node:24-bookworm-slim AS build

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    g++ \
    make \
    python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY shared/package*.json ./shared/
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

RUN npm pkg delete devDependencies.lightningcss-win32-x64-msvc \
  && NODE_ENV=development npm install --include=dev --no-audit --no-fund lightningcss-linux-x64-gnu@1.32.0

COPY . .

RUN npm pkg delete devDependencies.lightningcss-win32-x64-msvc \
  && NODE_ENV=development npm install --include=dev --no-audit --no-fund lightningcss-linux-x64-gnu@1.32.0 \
  && npm run build:integrated

# The server loads only backend and shared production packages; the build stage also holds every workspace's tooling
# (vite, tsc, tailwind, the frontend's editor libraries…), which used to ship in the image.
FROM build AS prod-deps
RUN rm -rf node_modules backend/node_modules shared/node_modules frontend/node_modules backend/test   && npm install --omit=dev --no-audit --no-fund --workspace backend --workspace shared --include-workspace-root

FROM node:24-bookworm-slim AS runtime-base

WORKDIR /app/backend

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    python3-pip \
    python3 \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p \
    /app/data/user/uploads \
    /app/data/user/database \
    /app/data/user/logs \
    /app/data/user/temp \
    /app/data/user/models \
    /app/data/user/config \
    /app/data/user/codex \
    /app/data/user/claude \
    /app/data/user/RecycleBin

# Codex CLI for the Codex generation tab. Sign in from the app (admin) or `docker exec -it <container> codex login --device-auth`.
RUN npm install -g --no-audit --no-fund @openai/codex
RUN npm install -g --no-audit --no-fund @anthropic-ai/claude-code

COPY --from=prod-deps /app/package*.json /app/
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/shared /app/shared
COPY --from=prod-deps /app/backend /app/backend
# User guides the chat and MCP read with get_app_guide (backend/src/services/appGuides.ts).
COPY --from=build /app/docs/GUIDE /app/docs/GUIDE

ENV NODE_ENV=production \
    PORT=1666 \
    BIND_ADDRESS=0.0.0.0 \
    HOST=0.0.0.0 \
    RUNTIME_BASE_PATH=/app/data/user \
    CONAI_RUNTIME_ROLE=all \
    CONAI_WORKER_HTTP=false \
    TRUST_PROXY=1 \
    PYTHON_PATH=python3 \
    PYTHONUNBUFFERED=1 \
    CODEX_HOME=/app/data/user/codex \
    CODEX_NPM_PREFIX=/app/data/user/codex-cli \
    CLAUDE_CONFIG_DIR=/app/data/user/claude \
    CLAUDE_NPM_PREFIX=/app/data/user/claude-cli \
    CODEX_SANDBOX_MODE=danger-full-access

EXPOSE 1666

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:1666/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/backend/src/index.js"]

# CPU is the default and keeps the normal image free of CUDA libraries.
# The AI worker runs in a uv-managed CPython 3.12 venv (Debian's 3.11 is too old for the pinned libraries), the same
# layout the app's own installer (Settings › Auto › AI runtime) creates, so both run identical versions.
FROM runtime-base AS runtime-cpu

ARG TORCH_BACKEND=cpu
RUN AI_VENV=/opt/conai-ai TORCH_BACKEND="${TORCH_BACKEND}" sh /app/backend/python/install-ai-env.sh

ENV PYTHON_PATH=/opt/conai-ai/bin/python

# GPU users opt into this target explicitly. PyTorch wheels provide the CUDA runtime libraries, so a CUDA base
# image is not needed. TORCH_BACKEND: cu130 (Turing / RTX 20 and newer, R580+ driver) is the default; cu126 for
# Maxwell–Volta (GTX 900/1000, V100) or older drivers; cu132 also works on R580+.
FROM runtime-base AS runtime-gpu

ARG TORCH_BACKEND=cu130
RUN AI_VENV=/opt/conai-ai TORCH_BACKEND="${TORCH_BACKEND}" sh /app/backend/python/install-ai-env.sh

ENV PYTHON_PATH=/opt/conai-ai/bin/python \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility

# An ordinary `docker build .` ends here and therefore remains CPU-only.
FROM runtime-cpu AS runtime

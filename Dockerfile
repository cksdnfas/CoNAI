# CoNAI Coolify deployment image.
FROM node:20-bookworm-slim AS build

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

FROM node:20-bookworm-slim AS runtime

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
    /app/data/user/RecycleBin

COPY --from=build /app/package*.json /app/
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/shared /app/shared
COPY --from=build /app/backend /app/backend

RUN python3 -m pip install --break-system-packages --no-cache-dir \
    --index-url https://download.pytorch.org/whl/cpu \
    --extra-index-url https://pypi.org/simple \
    -r /app/backend/python/requirements.txt

ENV NODE_ENV=production \
    PORT=1666 \
    BIND_ADDRESS=0.0.0.0 \
    HOST=0.0.0.0 \
    RUNTIME_BASE_PATH=/app/data/user \
    CONAI_RUNTIME_ROLE=all \
    CONAI_WORKER_HTTP=false \
    TRUST_PROXY=1 \
    PYTHON_PATH=python3 \
    PYTHONUNBUFFERED=1

EXPOSE 1666

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:1666/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/backend/src/index.js"]

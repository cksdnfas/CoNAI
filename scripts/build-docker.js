#!/usr/bin/env node

/**
 * ComfyUI Image Manager - Docker Build Script
 * Creates optimized Docker build artifacts
 */

const fs = require('fs-extra');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const BACKEND_DIST = path.join(ROOT_DIR, 'backend', 'dist');
const BUNDLE_FILE = path.join(BACKEND_DIST, 'bundle.js');
const BUILD_OUTPUT_DIR = path.join(ROOT_DIR, 'build-output');
const DOCKER_OUTPUT_DIR = path.join(BUILD_OUTPUT_DIR, 'docker');

console.log('🐳 ComfyUI Image Manager - Docker Build\n');

// Step 1: Check prerequisites
console.log('Step 1: Checking prerequisites...');
if (!fs.existsSync(BUNDLE_FILE)) {
  console.error('❌ Bundle not found. Run "npm run build:bundle" first.');
  process.exit(1);
}
console.log('✅ Prerequisites OK\n');

// Step 2: Clean and create output directory
console.log('Step 2: Preparing Docker build directory...');
if (fs.existsSync(DOCKER_OUTPUT_DIR)) {
  fs.removeSync(DOCKER_OUTPUT_DIR);
}
fs.ensureDirSync(DOCKER_OUTPUT_DIR);
console.log('✅ Output directory ready\n');

// Step 3: Copy application bundle
console.log('Step 3: Copying application files...');

// Copy bundle.js
fs.copyFileSync(BUNDLE_FILE, path.join(DOCKER_OUTPUT_DIR, 'bundle.js'));
console.log('   ✅ Copied bundle.js');

// Copy migration files (compiled .js from dist)
const migrationsSource = path.join(ROOT_DIR, 'backend', 'dist', 'database', 'migrations');
const migrationsTarget = path.join(DOCKER_OUTPUT_DIR, 'migrations');

if (fs.existsSync(migrationsSource)) {
  fs.copySync(migrationsSource, migrationsTarget, {
    filter: (src) => {
      return src.endsWith('.js') || fs.statSync(src).isDirectory();
    }
  });
  const migrationFiles = fs.readdirSync(migrationsTarget).filter(f => f.endsWith('.js'));
  console.log(`   ✅ Copied ${migrationFiles.length} main migration files`);

  // Copy API generation migrations (SQL files from source)
  const apiGenMigrationsSource = path.join(ROOT_DIR, 'backend', 'src', 'database', 'migrations', 'api-generation');
  const apiGenMigrationsTarget = path.join(migrationsTarget, 'api-generation');

  if (fs.existsSync(apiGenMigrationsSource)) {
    fs.ensureDirSync(apiGenMigrationsTarget);
    fs.copySync(apiGenMigrationsSource, apiGenMigrationsTarget, {
      filter: (src) => {
        return src.endsWith('.sql') || fs.statSync(src).isDirectory();
      }
    });
    const apiGenFiles = fs.readdirSync(apiGenMigrationsTarget).filter(f => f.endsWith('.sql'));
    console.log(`   ✅ Copied ${apiGenFiles.length} API generation migration files`);
  }
} else {
  console.warn('   ⚠️  Migration source not found, skipping');
}

// Copy Python scripts
const pythonSource = path.join(ROOT_DIR, 'backend', 'python');
const pythonTarget = path.join(DOCKER_OUTPUT_DIR, 'python');

if (fs.existsSync(pythonSource)) {
  fs.ensureDirSync(pythonTarget);
  const pythonFiles = ['wdv3_tagger_daemon.py', 'requirements.txt', 'README.md'];
  let copiedCount = 0;

  for (const file of pythonFiles) {
    const src = path.join(pythonSource, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(pythonTarget, file));
      copiedCount++;
    }
  }
  console.log(`   ✅ Copied ${copiedCount} Python files`);
} else {
  console.warn('   ⚠️  Python source not found, skipping');
}

// Copy frontend assets
const frontendSource = path.join(BACKEND_DIST, 'frontend');
const frontendTarget = path.join(DOCKER_OUTPUT_DIR, 'frontend');

if (fs.existsSync(frontendSource)) {
  fs.copySync(frontendSource, frontendTarget, { dereference: true });
  const fileCount = fs.readdirSync(frontendTarget).length;
  console.log(`   ✅ Copied ${fileCount} frontend files/folders`);
} else {
  console.warn('   ⚠️  Frontend dist not found, skipping');
}

console.log('');

// Step 4: Create production package.json
console.log('Step 4: Creating production package.json...');
const productionPackageJson = {
  name: "comfyui-image-manager-docker",
  version: "1.0.0",
  private: true,
  description: "ComfyUI Image Manager - Docker Distribution",
  main: "bundle.js",
  dependencies: {
    "sharp": "^0.33.0",
    "better-sqlite3": "^9.4.0",
    "argon2": "^0.44.0",
    "blake2": "^5.0.0",
    "ffmpeg-static": "^5.2.0",
    "ffprobe-static": "^3.1.0"
  },
  engines: {
    "node": ">=20.0.0"
  }
};

fs.writeFileSync(
  path.join(DOCKER_OUTPUT_DIR, 'package.json'),
  JSON.stringify(productionPackageJson, null, 2),
  'utf8'
);
console.log('✅ Production package.json created\n');

// Step 5: Create Dockerfile
console.log('Step 5: Creating Dockerfile...');
const dockerfile = `# Multi-stage build for ComfyUI Image Manager
# Optimized for production deployment
# Note: Using Debian base for PyTorch compatibility (Alpine not supported)

# ============================================================================
# Stage 1: Dependencies
# ============================================================================
FROM node:20-slim AS deps

WORKDIR /app

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y --no-install-recommends \\
    python3 \\
    make \\
    g++ \\
    && rm -rf /var/lib/apt/lists/*

# Copy package.json
COPY package.json ./

# Install production dependencies and rebuild native modules
RUN npm install --production --no-package-lock && \\
    npm rebuild sharp better-sqlite3 argon2 blake2

# ============================================================================
# Stage 2: Runtime
# ============================================================================
FROM node:20-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \\
    ffmpeg \\
    python3 \\
    python3-pip \\
    python3-venv \\
    && ln -sf /usr/bin/python3 /usr/bin/python \\
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy application files
COPY bundle.js ./
COPY migrations ./migrations
COPY frontend ./frontend
COPY python ./python

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Install Python dependencies (CPU-only PyTorch for smaller image size)
RUN pip3 install --no-cache-dir --break-system-packages \\
    --extra-index-url https://download.pytorch.org/whl/cpu \\
    -r python/requirements.txt && \\
    find /usr/local/lib/python3* -name '*.pyc' -delete && \\
    find /usr/local/lib/python3* -name '__pycache__' -delete && \\
    rm -rf /root/.cache/pip

# Create data directories
RUN mkdir -p /app/data/uploads /app/data/database /app/data/logs /app/data/temp /app/data/models /app/data/config /app/data/RecycleBin

# Create non-root user
RUN groupadd -g 1001 appuser && \\
    useradd -u 1001 -g appuser -s /bin/bash -m appuser && \\
    chown -R appuser:appuser /app

USER appuser

# Environment variables
ENV NODE_ENV=production \\
    PORT=1566 \\
    HOST=0.0.0.0 \\
    DOCKER=true \\
    RUNTIME_BASE_PATH=/app/data \\
    PYTHON_PATH=python3

# Expose port
EXPOSE 1566

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \\
    CMD node -e "require('http').get('http://localhost:1566/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
CMD ["node", "bundle.js"]
`;

fs.writeFileSync(
  path.join(DOCKER_OUTPUT_DIR, 'Dockerfile'),
  dockerfile,
  'utf8'
);
console.log('✅ Dockerfile created\n');

// Step 6: Create docker-compose.yml
console.log('Step 6: Creating docker-compose.yml...');
const dockerCompose = `# ComfyUI Image Manager - Docker Compose Configuration
#
# This configuration uses a single named volume for all application data,
# making it easier to manage, backup, and upgrade.
#
# All data is stored in the 'comfyui-data' volume, which includes:
#   - uploads/      (original images and thumbnails)
#   - database/     (SQLite database)
#   - logs/         (application logs)
#   - temp/         (temporary files and generated thumbnails)
#   - models/       (AI model cache)
#   - config/       (settings and configuration)
#   - RecycleBin/   (deleted files, if delete protection is enabled)

services:
  comfyui-manager:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: comfyui-image-manager

    # Host 네트워크 모드 (네트워크 드라이브 접근 필요 시)
    # 주의: Windows/Mac에서는 제한적 지원, Linux에서만 완벽 작동
    # 활성화 시: 컨테이너가 호스트의 네트워크를 직접 사용 (포트 매핑 불필요)
    # 접속: http://localhost:1566 (포트는 동일, 매핑만 생략)
    # network_mode: "host"

    # ports 섹션 (host 모드 사용 시 주석 처리)
    ports:
      - "1566:1566"

    # Single volume for all application data
    volumes:
      - comfyui-data:/app/data

      # Alternative: Use bind mount to a specific host directory
      # Uncomment and modify the path below to use a host directory instead:
      # - /path/to/your/data:/app/data
      #
      # Examples:
      #   Linux/macOS:  - /home/user/comfyui-data:/app/data
      #   Windows WSL:  - /mnt/d/comfyui-data:/app/data
      #   Windows:      - D:/comfyui-data:/app/data
      #
      # If using bind mount, comment out the 'volumes:' section at the bottom

      # Windows 네트워크 드라이브 마운트 (UNC 경로)
      # 네트워크 공유 폴더를 컨테이너에 마운트하여 접근 가능
      # 예시: - "\\\\\\\\192.168.50.11\\\\Share\\\\Images:/network-images:ro"
      # 주의: Docker Desktop에서만 작동, Linux는 CIFS 마운트 필요

    environment:
      - NODE_ENV=production
      - PORT=1566
      - HOST=0.0.0.0
      - LOCALE=en
      # All data paths are automatically configured via RUNTIME_BASE_PATH=/app/data

    restart: unless-stopped

    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:1566/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 10s

# Named volume for persistent data storage
# Docker manages this volume automatically
volumes:
  comfyui-data:
    # Optional: Specify driver options for advanced configurations
    # driver: local
    # driver_opts:
    #   type: none
    #   o: bind
    #   device: /path/to/host/directory
`;

fs.writeFileSync(
  path.join(DOCKER_OUTPUT_DIR, 'docker-compose.yml'),
  dockerCompose,
  'utf8'
);
console.log('✅ docker-compose.yml created\n');

// Step 6.5: Create docker-compose.examples.yml
console.log('Step 6.5: Creating docker-compose.examples.yml...');
const dockerComposeExamples = `# ComfyUI Image Manager - Docker Compose Configuration Examples
#
# This file contains various configuration examples for different use cases.
# Copy the example you need to docker-compose.yml or docker-compose.override.yml

# ============================================================================
# Example 1: Simple Named Volume (Default - Recommended for most users)
# ============================================================================
# This is the default configuration. Docker manages the volume automatically.
# Data location varies by platform:
#   - Linux: /var/lib/docker/volumes/comfyui-data/_data
#   - Windows: \\\\wsl$\\docker-desktop-data\\data\\docker\\volumes\\comfyui-data\\_data
#   - macOS: ~/Library/Containers/com.docker.docker/Data/vms/0/

# services:
#   comfyui-manager:
#     image: comfyui-image-manager:latest
#     container_name: comfyui-manager
#     ports:
#       - "1566:1566"
#     volumes:
#       - comfyui-data:/app/data
#     environment:
#       - NODE_ENV=production
#       - LOCALE=en
#     restart: unless-stopped
#
# volumes:
#   comfyui-data:

# ============================================================================
# Example 2: Bind Mount to Specific Host Directory
# ============================================================================
# Use this when you want direct access to files from your host system.
# Good for development or when you want to easily browse/backup files.

# Linux/macOS Example:
# services:
#   comfyui-manager:
#     image: comfyui-image-manager:latest
#     container_name: comfyui-manager
#     ports:
#       - "1566:1566"
#     volumes:
#       - /home/user/comfyui-data:/app/data
#     environment:
#       - NODE_ENV=production
#     restart: unless-stopped

# Windows Example (Docker Desktop):
# services:
#   comfyui-manager:
#     image: comfyui-image-manager:latest
#     container_name: comfyui-manager
#     ports:
#       - "1566:1566"
#     volumes:
#       - D:/comfyui-data:/app/data
#     environment:
#       - NODE_ENV=production
#       - LOCALE=ko
#     restart: unless-stopped

# Windows WSL2 Example:
# services:
#   comfyui-manager:
#     image: comfyui-image-manager:latest
#     container_name: comfyui-manager
#     ports:
#       - "1566:1566"
#     volumes:
#       - /mnt/d/comfyui-data:/app/data
#     environment:
#       - NODE_ENV=production
#     restart: unless-stopped

# ============================================================================
# Example 3: External Image Library with Path Override
# ============================================================================
# Use this when you have an existing image collection you want to import.
# The app data (database, logs) stays in a Docker volume, while images
# are read from an external directory.

# services:
#   comfyui-manager:
#     image: comfyui-image-manager:latest
#     container_name: comfyui-manager
#     ports:
#       - "1566:1566"
#     volumes:
#       # Application data in Docker volume
#       - comfyui-app-data:/app/data
#       # External image library (can be read-only)
#       - /mnt/nas/ai-images:/data/external-images:ro
#     environment:
#       - NODE_ENV=production
#       # Override uploads directory to external storage
#       - RUNTIME_UPLOADS_DIR=/data/external-images
#       # Other paths remain in /app/data
#     restart: unless-stopped
#
# volumes:
#   comfyui-app-data:

# ============================================================================
# Example 4: Separate Volumes for Each Data Type
# ============================================================================
# Use this for fine-grained control over where each type of data is stored.
# Useful for advanced setups with different storage backends.

# services:
#   comfyui-manager:
#     image: comfyui-image-manager:latest
#     container_name: comfyui-manager
#     ports:
#       - "1566:1566"
#     volumes:
#       # Large files on external storage
#       - /mnt/storage/images:/data/uploads
#       - /mnt/storage/models:/data/models
#       # System data in Docker volumes
#       - comfyui-database:/data/database
#       - comfyui-config:/data/config
#       # Temporary data (can be ephemeral)
#       - comfyui-temp:/data/temp
#     environment:
#       - NODE_ENV=production
#       - RUNTIME_UPLOADS_DIR=/data/uploads
#       - RUNTIME_DATABASE_DIR=/data/database
#       - RUNTIME_LOGS_DIR=/data/database/logs
#       - RUNTIME_TEMP_DIR=/data/temp
#       - RUNTIME_MODELS_DIR=/data/models
#       - RUNTIME_RECYCLE_BIN_DIR=/data/uploads/RecycleBin
#     restart: unless-stopped
#
# volumes:
#   comfyui-database:
#   comfyui-config:
#   comfyui-temp:

# ============================================================================
# Example 5: NFS/Network Storage
# ============================================================================
# Use this when you want to store data on a network file server (NFS).
# Good for shared storage in multi-server setups.

# services:
#   comfyui-manager:
#     image: comfyui-image-manager:latest
#     container_name: comfyui-manager
#     ports:
#       - "1566:1566"
#     volumes:
#       - nfs-storage:/app/data
#     environment:
#       - NODE_ENV=production
#     restart: unless-stopped
#
# volumes:
#   nfs-storage:
#     driver: local
#     driver_opts:
#       type: nfs
#       o: addr=192.168.1.100,rw,nfsvers=4
#       device: ":/path/to/nfs/share"

# ============================================================================
# Example 6: Development Setup with Live Code Reload
# ============================================================================
# Use this for local development. Mounts source code for live editing.
# Run this with: docker-compose -f docker-compose.dev.yml up

# services:
#   comfyui-manager-dev:
#     build:
#       context: ../..
#       dockerfile: build-output/docker/Dockerfile
#     container_name: comfyui-manager-dev
#     ports:
#       - "1566:1566"
#     volumes:
#       # Bind mount for development
#       - ../../dev-data:/app/data
#       # Optional: Mount source code for debugging
#       # - ../../backend/src:/app/src:ro
#     environment:
#       - NODE_ENV=development
#       - PORT=1566
#       - LOCALE=ko
#       - DEBUG=*
#     restart: unless-stopped
#     # Enable TTY for better logging
#     stdin_open: true
#     tty: true

# ============================================================================
# Example 7: Custom Port and Environment Settings
# ============================================================================
# Use this to run multiple instances or change default settings.

# services:
#   comfyui-manager-custom:
#     image: comfyui-image-manager:latest
#     container_name: comfyui-manager-8080
#     ports:
#       - "8080:1566"  # Expose on host port 8080
#     volumes:
#       - comfyui-data-8080:/app/data
#     environment:
#       - NODE_ENV=production
#       - PORT=1566  # Internal container port (don't change)
#       - HOST=0.0.0.0
#       - LOCALE=ko
#       # Add custom environment variables here
#     restart: unless-stopped
#
# volumes:
#   comfyui-data-8080:

# ============================================================================
# Example 8: Resource Limits and Security
# ============================================================================
# Use this in production to limit resource usage and enhance security.

# services:
#   comfyui-manager-production:
#     image: comfyui-image-manager:latest
#     container_name: comfyui-manager-prod
#     ports:
#       - "1566:1566"
#     volumes:
#       - comfyui-data:/app/data
#     environment:
#       - NODE_ENV=production
#       - LOCALE=en
#     restart: unless-stopped
#     # Resource limits
#     deploy:
#       resources:
#         limits:
#           cpus: '2'
#           memory: 2G
#         reservations:
#           cpus: '0.5'
#           memory: 512M
#     # Security options
#     security_opt:
#       - no-new-privileges:true
#     # Read-only root filesystem (if applicable)
#     # read_only: true
#     # tmpfs:
#     #   - /tmp
#
# volumes:
#   comfyui-data:

# ============================================================================
# Notes
# ============================================================================
#
# Volume Backup:
#   docker run --rm -v comfyui-data:/data -v $(pwd):/backup \\
#     alpine tar czf /backup/backup.tar.gz -C /data .
#
# Volume Restore:
#   docker run --rm -v comfyui-data:/data -v $(pwd):/backup \\
#     alpine tar xzf /backup/backup.tar.gz -C /data
#
# View Volume Location:
#   docker volume inspect comfyui-data
#
# Remove Unused Volumes:
#   docker volume prune
#
# For more information, see README.md
`;

fs.writeFileSync(
  path.join(DOCKER_OUTPUT_DIR, 'docker-compose.examples.yml'),
  dockerComposeExamples,
  'utf8'
);
console.log('✅ docker-compose.examples.yml created\n');

// Step 7: Create .dockerignore
console.log('Step 7: Creating .dockerignore...');
const dockerignore = `node_modules
npm-debug.log
.git
.gitignore
.env
.env.local
*.md
README.txt
`;

fs.writeFileSync(
  path.join(DOCKER_OUTPUT_DIR, '.dockerignore'),
  dockerignore,
  'utf8'
);
console.log('✅ .dockerignore created\n');

// Step 8: Create README
console.log('Step 8: Creating Docker deployment guide...');
const readme = `# ComfyUI Image Manager - Docker Deployment

## 🚀 Quick Start

### Using Docker Compose (Recommended)

\`\`\`bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
\`\`\`

Access the application at: **http://localhost:1566**

## 📦 Image Details

- **Base Image**: node:20-slim (Debian-based for PyTorch compatibility)
- **Estimated Size**: ~1.5-2GB (includes FFmpeg and PyTorch)
- **Platform**: linux/amd64, linux/arm64
- **User**: Non-root (uid 1001)

## 💾 Data Storage

### Default Configuration

The default \`docker-compose.yml\` uses a **single named volume** (\`comfyui-data\`) for all application data:

\`\`\`
comfyui-data/
├── uploads/       # Original images and videos
├── database/      # SQLite database files
├── logs/          # Application logs
├── temp/          # Temporary files and thumbnails
├── models/        # AI model cache (WD Tagger)
├── config/        # Application settings (settings.json)
└── RecycleBin/    # Deleted files (if delete protection enabled)
\`\`\`

**Volume Location** (Docker managed):
- Linux: \`/var/lib/docker/volumes/comfyui-data/_data\`
- Windows: \`\\\\\\\\wsl$\\\\docker-desktop-data\\\\data\\\\docker\\\\volumes\\\\comfyui-data\\\\_data\`
- macOS: \`~/Library/Containers/com.docker.docker/Data/vms/0/\`

### Custom Storage Locations

See **docker-compose.examples.yml** for various configuration examples:

1. **Bind Mount** - Use a specific host directory
2. **External Library** - Import existing image collections
3. **Separate Volumes** - Split data across different storage
4. **NFS/Network Storage** - Shared storage for multi-server setups

#### Quick Example: Bind Mount

Edit \`docker-compose.yml\`:

\`\`\`yaml
services:
  comfyui-manager:
    volumes:
      # Replace this line:
      # - comfyui-data:/app/data

      # With your host path:
      - /path/to/your/data:/app/data

      # Windows example: D:/comfyui-data:/app/data
      # Linux example: /home/user/comfyui-data:/app/data
\`\`\`

## 🔧 Configuration

### Environment Variables

Available environment variables (set in \`docker-compose.yml\`):

\`\`\`yaml
environment:
  - NODE_ENV=production       # Environment mode
  - PORT=1566                 # Internal container port (don't change)
  - HOST=0.0.0.0             # Listen address
  - LOCALE=en                # Interface language (en, ko)

  # Optional: Override individual data paths
  # - RUNTIME_BASE_PATH=/app/data
  # - RUNTIME_UPLOADS_DIR=/custom/path
  # - RUNTIME_DATABASE_DIR=/custom/path
  # - RUNTIME_TEMP_DIR=/custom/path
  # - RUNTIME_MODELS_DIR=/custom/path
  # - RUNTIME_RECYCLE_BIN_DIR=/custom/path
\`\`\`

### Port Configuration

To change the host port (default 1566):

\`\`\`yaml
ports:
  - "8080:1566"  # Access via http://localhost:8080
\`\`\`

## 🎥 Features

- ✅ Image processing (Sharp)
- ✅ Video processing (FFmpeg)
- ✅ SQLite database
- ✅ WD v3 Tagger (Python + PyTorch CPU)
- ✅ Health checks
- ✅ Auto-restart
- ✅ Persistent data storage

## 🐛 Troubleshooting

### Container won't start

\`\`\`bash
# Check logs
docker-compose logs -f

# Or for specific container
docker logs comfyui-image-manager
\`\`\`

### Port already in use

\`\`\`yaml
# In docker-compose.yml
ports:
  - "8080:1566"  # Use port 8080 instead of 1566
\`\`\`

### Permission denied (bind mounts)

\`\`\`bash
# Linux: Set ownership to uid 1001
sudo chown -R 1001:1001 /path/to/host/directory

# Or: Create directory first with correct permissions
mkdir -p /path/to/data
chmod 755 /path/to/data
\`\`\`

### Database issues

\`\`\`bash
# Reset database and recreate
docker-compose down -v
docker-compose up -d
\`\`\`

### Access from host network

Make sure \`HOST=0.0.0.0\` in environment variables (default).

## 📊 Resource Requirements

- **CPU**: 1-2 cores recommended (4+ for WD Tagger)
- **RAM**: 1GB minimum, 2-4GB recommended (more for AI tagging)
- **Disk**: 2GB base + storage for images/videos

## 🔐 Security

- Non-root user (uid 1001, gid 1001)
- No privileged access required
- Health checks enabled (30s interval)
- Minimal attack surface (Debian Slim base)

## 📝 Maintenance

### Update container

\`\`\`bash
# Pull latest image
docker-compose pull

# Recreate container
docker-compose up -d
\`\`\`

### Backup all data

\`\`\`bash
# Backup entire volume to tar.gz
docker run --rm \\
  -v comfyui-data:/data \\
  -v \$(pwd):/backup \\
  alpine tar czf /backup/comfyui-backup-\$(date +%Y%m%d).tar.gz -C /data .
\`\`\`

### Restore data

\`\`\`bash
# Restore from backup
docker run --rm \\
  -v comfyui-data:/data \\
  -v \$(pwd):/backup \\
  alpine tar xzf /backup/comfyui-backup-YYYYMMDD.tar.gz -C /data
\`\`\`

### View volume information

\`\`\`bash
# Inspect volume details
docker volume inspect comfyui-data

# List all volumes
docker volume ls
\`\`\`

### Clean up unused volumes

\`\`\`bash
# Remove all unused volumes (CAUTION!)
docker volume prune
\`\`\`

## 🚀 Advanced Deployment

### Using Docker CLI

\`\`\`bash
# Build image
docker build -t comfyui-image-manager .

# Run with named volume
docker run -d \\
  --name comfyui-manager \\
  -p 1566:1566 \\
  -v comfyui-data:/app/data \\
  --restart unless-stopped \\
  comfyui-image-manager

# Run with bind mount
docker run -d \\
  --name comfyui-manager \\
  -p 1566:1566 \\
  -v /path/to/data:/app/data \\
  --restart unless-stopped \\
  comfyui-image-manager
\`\`\`

### Using Docker Swarm

\`\`\`bash
docker stack deploy -c docker-compose.yml comfyui
\`\`\`

### Resource Limits

Add to \`docker-compose.yml\`:

\`\`\`yaml
services:
  comfyui-manager:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 512M
\`\`\`

## 📚 Additional Resources

- **docker-compose.examples.yml** - Various configuration examples
- **Source Repository** - [GitHub](https://github.com/your-repo) (if applicable)
- **Documentation** - See project docs for detailed feature guides

---

**Build Date**: ${new Date().toISOString()}
**Version**: 1.0.0
**Docker Image**: comfyui-image-manager:latest
`;

fs.writeFileSync(
  path.join(DOCKER_OUTPUT_DIR, 'README.md'),
  readme,
  'utf8'
);
console.log('✅ Docker deployment guide created\n');

// Step 9: Display summary
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✨ Docker Build Complete!');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const getDirectorySize = (dirPath) => {
  let size = 0;
  if (!fs.existsSync(dirPath)) return 0;

  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      size += getDirectorySize(filePath);
    } else {
      size += stats.size;
    }
  }
  return size;
};

const totalSize = getDirectorySize(DOCKER_OUTPUT_DIR);

console.log(`\n📦 Build Artifacts:`);
console.log(`   Location: ${DOCKER_OUTPUT_DIR}`);
console.log(`   Size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
console.log(`   Files:`);
console.log(`     - Dockerfile`);
console.log(`     - docker-compose.yml`);
console.log(`     - docker-compose.examples.yml  (NEW!)`);
console.log(`     - README.md`);
console.log(`     - bundle.js`);
console.log(`     - migrations/`);
console.log(`     - frontend/`);
console.log(`     - python/`);
console.log(`     - package.json`);

console.log('\n✨ What\'s New:');
console.log('   ✅ Single volume configuration (comfyui-data)');
console.log('   ✅ Includes temp/ and RecycleBin/ in volume');
console.log('   ✅ docker-compose.examples.yml with 8 configuration examples');
console.log('   ✅ Enhanced README with volume configuration guide');

console.log('\n🐳 Next Steps:');
console.log(`   cd ${path.relative(ROOT_DIR, DOCKER_OUTPUT_DIR)}`);
console.log('   docker-compose up -d');
console.log('\n📚 Documentation:');
console.log('   - README.md: Deployment guide and troubleshooting');
console.log('   - docker-compose.examples.yml: Configuration examples');
console.log('   - docker-compose.yml: Default configuration (ready to use)\n');

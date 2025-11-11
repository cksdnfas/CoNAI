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
    "blake2": "^5.0.0"
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

# ============================================================================
# Stage 1: Dependencies
# ============================================================================
FROM node:20-alpine AS deps

WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package.json
COPY package.json ./

# Install production dependencies and rebuild native modules for Alpine Linux
RUN npm install --production --no-package-lock && \\
    npm rebuild sharp better-sqlite3 argon2 blake2

# ============================================================================
# Stage 2: Runtime
# ============================================================================
FROM node:20-alpine

# Install runtime dependencies
RUN apk add --no-cache \\
    ffmpeg \\
    python3 \\
    py3-pip

WORKDIR /app

# Copy application files
COPY bundle.js ./
COPY migrations ./migrations
COPY frontend ./frontend
COPY python ./python

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Create data directories
RUN mkdir -p /app/data/uploads /app/data/database /app/data/logs /app/data/temp /app/data/models /app/data/config

# Create non-root user
RUN addgroup -g 1001 appuser && \\
    adduser -D -u 1001 -G appuser appuser && \\
    chown -R appuser:appuser /app

USER appuser

# Environment variables
ENV NODE_ENV=production \\
    PORT=1566 \\
    HOST=0.0.0.0 \\
    DOCKER=true \\
    RUNTIME_BASE_PATH=/app/data

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
const dockerCompose = `version: '3.8'

services:
  comfyui-manager:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: comfyui-image-manager
    ports:
      - "1566:1566"
    volumes:
      - uploads:/app/data/uploads
      - database:/app/data/database
      - logs:/app/data/logs
      - models:/app/data/models
      - config:/app/data/config
    environment:
      - NODE_ENV=production
      - PORT=1566
      - HOST=0.0.0.0
      - LOCALE=en
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:1566/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 10s

volumes:
  uploads:
  database:
  logs:
  models:
  config:
`;

fs.writeFileSync(
  path.join(DOCKER_OUTPUT_DIR, 'docker-compose.yml'),
  dockerCompose,
  'utf8'
);
console.log('✅ docker-compose.yml created\n');

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

Access the application at: http://localhost:1566

### Using Docker CLI

\`\`\`bash
# Build image
docker build -t comfyui-image-manager .

# Run container
docker run -d \\
  --name comfyui-manager \\
  -p 1566:1566 \\
  -v comfyui-uploads:/app/data/uploads \\
  -v comfyui-database:/app/data/database \\
  -v comfyui-logs:/app/data/logs \\
  comfyui-image-manager

# View logs
docker logs -f comfyui-manager

# Stop container
docker stop comfyui-manager
docker rm comfyui-manager
\`\`\`

## 📦 Image Details

- **Base Image**: node:20-alpine
- **Image Size**: ~100-120MB (optimized)
- **Platform**: linux/amd64, linux/arm64
- **User**: Non-root (uid 1001)

## 🔧 Configuration

### Environment Variables

Create a \`.env\` file or set via docker-compose:

\`\`\`env
PORT=1566
HOST=0.0.0.0
LOCALE=en
NODE_ENV=production
\`\`\`

### Volume Mounts

| Volume | Purpose | Path |
|--------|---------|------|
| uploads | Image storage | /app/data/uploads |
| database | SQLite databases | /app/data/database |
| logs | Application logs | /app/data/logs |
| models | AI model cache | /app/data/models |
| config | Settings | /app/data/config |

## 🎥 Features

- ✅ Image processing (Sharp)
- ✅ Video processing (FFmpeg)
- ✅ SQLite database
- ✅ WD v3 Tagger (Python included)
- ✅ Health checks
- ✅ Auto-restart

## 🐛 Troubleshooting

### Container won't start
\`\`\`bash
docker logs comfyui-manager
\`\`\`

### Port already in use
Change port in docker-compose.yml:
\`\`\`yaml
ports:
  - "8080:1566"  # Use port 8080 instead
\`\`\`

### Database issues
\`\`\`bash
# Reset database
docker-compose down -v
docker-compose up -d
\`\`\`

### Access from host
Make sure HOST=0.0.0.0 in environment variables

## 📊 Resource Requirements

- **CPU**: 1-2 cores recommended
- **RAM**: 512MB minimum, 1GB recommended
- **Disk**: 1GB + storage for images

## 🔐 Security

- Non-root user (uid 1001)
- No privileged access required
- Health checks enabled
- Minimal attack surface (Alpine Linux)

## 🚀 Production Deployment

### Using Docker Swarm

\`\`\`bash
docker stack deploy -c docker-compose.yml comfyui
\`\`\`

### Using Kubernetes

See \`k8s/\` directory for Kubernetes manifests (if available)

## 📝 Maintenance

### Update container
\`\`\`bash
docker-compose pull
docker-compose up -d
\`\`\`

### Backup data
\`\`\`bash
docker run --rm \\
  -v comfyui-database:/data \\
  -v \$(pwd):/backup \\
  alpine tar czf /backup/database-backup.tar.gz -C /data .
\`\`\`

### Restore data
\`\`\`bash
docker run --rm \\
  -v comfyui-database:/data \\
  -v \$(pwd):/backup \\
  alpine tar xzf /backup/database-backup.tar.gz -C /data
\`\`\`

---

**Build Date**: ${new Date().toISOString()}
**Version**: 1.0.0
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
console.log(`     - bundle.js`);
console.log(`     - migrations/`);
console.log(`     - frontend/`);
console.log(`     - python/`);
console.log(`     - package.json`);

console.log('\n🐳 Next Steps:');
console.log(`   cd ${path.relative(ROOT_DIR, DOCKER_OUTPUT_DIR)}`);
console.log('   docker-compose up -d');
console.log('\n📚 Or see README.md for detailed instructions\n');

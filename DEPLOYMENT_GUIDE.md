# ComfyUI Image Manager - Deployment Guide

Complete guide for deploying ComfyUI Image Manager in various environments.

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Deployment Options](#deployment-options)
- [Portable Deployment](#portable-deployment)
- [Docker Deployment](#docker-deployment)
- [SEA Deployment](#sea-deployment)
- [Production Recommendations](#production-recommendations)
- [Troubleshooting](#troubleshooting)

---

## 🚀 Quick Start

### Interactive Deployment

```bash
npm run deploy
```

This launches an interactive menu to choose your deployment type.

### Direct Commands

```bash
# Portable package
npm run build:full

# Docker deployment
npm run deploy:docker:build

# Build everything
npm run build:all
```

---

## 🎯 Deployment Options

| Type | Use Case | Pros | Cons | Size |
|------|----------|------|------|------|
| **Portable** | End users, offline | No Docker needed, cross-platform | Larger size, manual updates | ~45MB |
| **Docker** | Servers, cloud | Isolated, easy updates, scalable | Requires Docker | ~100MB |
| **SEA** | Single file distribution | Smallest footprint | Experimental, limited features | ~80MB |

### Decision Matrix

```
Need Docker? ──┬── No ──┬── Want auto-updates? ── Yes ── Portable
               │        └── Want single file? ── Yes ── SEA
               │
               └── Yes ──┬── Production server? ── Yes ── Docker
                         └── Development? ── Yes ── Docker Compose
```

---

## 📦 Portable Deployment

### Build Process

```bash
# Step 1: Build integrated bundle
npm run build:integrated

# Step 2: Create esbuild bundle
npm run build:bundle

# Step 3: Create portable package
npm run build:portable

# Or all in one:
npm run build:full
```

### Output Structure

```
build-output/portable/
├── node.exe / node          # Node.js runtime (30MB)
├── start.bat / start.sh     # Startup scripts
├── app/
│   ├── bundle.js           # Application (2MB)
│   ├── bootstrap.js        # Dependency installer
│   ├── frontend/           # React app (5MB)
│   ├── migrations/         # SQL migrations
│   ├── python/             # WD Tagger scripts
│   ├── node_modules/       # Native dependencies
│   │   ├── sharp/
│   │   ├── better-sqlite3/
│   │   ├── ffmpeg-static/
│   │   ├── ffprobe-static/
│   │   ├── argon2/
│   │   └── blake2/
│   └── package.json
├── database/               # SQLite databases
├── uploads/                # Image storage
├── logs/                   # Application logs
├── config/                 # Settings
├── .env.example            # Configuration template
└── README.txt              # User instructions
```

### Distribution

#### Option 1: Zip Archive (Recommended)

```bash
# Windows
cd build-output
tar -a -c -f comfyui-manager-portable.zip portable

# Linux/Mac
cd build-output
tar czf comfyui-manager-portable.tar.gz portable
```

#### Option 2: Direct Copy

Copy the entire `build-output/portable/` folder to target machine.

### First Run

**Windows:**
```cmd
cd build-output\portable
start.bat
```

**Linux/Mac:**
```bash
cd build-output/portable
chmod +x start.sh
./start.sh
```

**First Launch:**
- Requires internet connection (one-time)
- Auto-downloads dependencies (~90MB)
- Takes 1-2 minutes
- Subsequent runs: offline, instant start

### Configuration

1. Copy `.env.example` to `.env`
2. Edit settings:
   ```env
   PORT=1566
   HOST=0.0.0.0
   LOCALE=en
   ```
3. Restart application

### Updates

To update portable deployment:

1. Download new portable package
2. Copy these folders from old to new:
   - `database/` (your data)
   - `uploads/` (your images)
   - `config/` (your settings)
   - `.env` (your configuration)
3. Run new version

---

## 🐳 Docker Deployment

### Build Process

```bash
# Step 1: Build application
npm run build:integrated

# Step 2: Create bundle
npm run build:bundle

# Step 3: Generate Docker artifacts
npm run build:docker
```

### Output Structure

```
build-output/docker/
├── Dockerfile              # Multi-stage optimized
├── docker-compose.yml      # Complete stack
├── .dockerignore
├── package.json            # Production dependencies
├── bundle.js               # Application
├── migrations/             # Database migrations
├── frontend/               # Static assets
├── python/                 # Tagger scripts
└── README.md               # Docker guide
```

### Deployment Methods

#### Method 1: Docker Compose (Recommended)

```bash
# Build and start
cd build-output/docker
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down

# Update
docker-compose pull
docker-compose up -d
```

#### Method 2: Docker CLI

```bash
# Build image
cd build-output/docker
docker build -t comfyui-image-manager .

# Run container
docker run -d \
  --name comfyui-manager \
  -p 1566:1566 \
  -v comfyui-uploads:/app/data/uploads \
  -v comfyui-database:/app/data/database \
  -v comfyui-logs:/app/data/logs \
  -v comfyui-models:/app/data/models \
  comfyui-image-manager

# Check status
docker ps
docker logs comfyui-manager

# Stop
docker stop comfyui-manager
docker rm comfyui-manager
```

#### Method 3: npm Scripts

```bash
# Build and deploy in one command
npm run deploy:docker:build

# Just deploy (if already built)
npm run deploy:docker

# Stop deployment
npm run deploy:docker:stop
```

### Configuration

Create `.env` file or modify `docker-compose.yml`:

```yaml
environment:
  - PORT=1566
  - HOST=0.0.0.0
  - LOCALE=en
  - NODE_ENV=production
```

### Volumes

| Volume | Purpose | Important |
|--------|---------|-----------|
| `uploads` | Image storage | ✅ **Critical** - your data |
| `database` | SQLite files | ✅ **Critical** - your data |
| `logs` | Application logs | ⚠️ Optional - debugging |
| `models` | AI model cache | ⚠️ Optional - redownloads if lost |
| `config` | Settings | ✅ **Important** - your preferences |

### Backup & Restore

#### Backup

```bash
# Backup database
docker run --rm \
  -v comfyui-database:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/database-backup.tar.gz -C /data .

# Backup uploads
docker run --rm \
  -v comfyui-uploads:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/uploads-backup.tar.gz -C /data .
```

#### Restore

```bash
# Restore database
docker run --rm \
  -v comfyui-database:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/database-backup.tar.gz -C /data

# Restore uploads
docker run --rm \
  -v comfyui-uploads:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/uploads-backup.tar.gz -C /data
```

### Resource Requirements

- **CPU**: 1-2 cores
- **RAM**: 512MB minimum, 1GB recommended
- **Disk**: 1GB + image storage
- **Network**: 80Mbps for video processing

### Security Features

- ✅ Non-root user (uid 1001)
- ✅ Minimal base image (Alpine Linux)
- ✅ No privileged access
- ✅ Health checks enabled
- ✅ Read-only filesystem (except data volumes)

---

## ⚡ SEA Deployment

### Build Process

```bash
npm run build:integrated
npm run build:bundle
npm run build:sea
```

### Output

```
build-output/sea/
└── comfyui-image-manager.exe / comfyui-image-manager
```

### Usage

```bash
# Windows
cd build-output\sea
comfyui-image-manager.exe

# Linux/Mac
cd build-output/sea
chmod +x comfyui-image-manager
./comfyui-image-manager
```

### Limitations

- ⚠️ Experimental Node.js feature
- ⚠️ Some native modules may not work
- ⚠️ Larger file size than expected
- ✅ Single file distribution
- ✅ No external dependencies

---

## 🏭 Production Recommendations

### For Small Deployments (1-10 users)

**Recommended: Portable**
- Easy to set up
- No Docker knowledge required
- Works on any platform
- Manual updates

**Setup:**
```bash
npm run build:full
# Distribute build-output/portable/
```

### For Medium Deployments (10-100 users)

**Recommended: Docker Compose**
- Easy management
- Automatic restarts
- Volume persistence
- Easy updates

**Setup:**
```bash
npm run deploy:docker:build
```

### For Large Deployments (100+ users)

**Recommended: Kubernetes**
- High availability
- Auto-scaling
- Load balancing
- Rolling updates

**Setup:**
1. Build Docker image
2. Push to registry
3. Deploy with Kubernetes manifests (TBD)

### Performance Tuning

#### Portable

```env
# .env
NODE_OPTIONS=--max-old-space-size=2048
```

#### Docker

```yaml
# docker-compose.yml
services:
  comfyui-manager:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
```

### Monitoring

#### Portable

- Check `logs/` directory
- Use `pm2` for process management:
  ```bash
  npm install -g pm2
  pm2 start app/bundle.js --name comfyui-manager
  pm2 monit
  ```

#### Docker

```bash
# View logs
docker-compose logs -f

# Check health
docker inspect comfyui-manager | grep Health

# Resource usage
docker stats comfyui-manager
```

---

## 🔧 Troubleshooting

### Portable Deployment

#### Dependencies not installing

**Problem:** Bootstrap fails to install dependencies

**Solution:**
```bash
cd app
npm install --production
```

#### Port already in use

**Problem:** Error: Port 1566 already in use

**Solution:**
```env
# .env
PORT=8080
```

#### FFmpeg not found

**Problem:** Video processing fails

**Solution:**
```bash
# Check if FFmpeg modules exist
cd app/node_modules
ls ffmpeg-static ffprobe-static

# Reinstall if missing
npm install ffmpeg-static ffprobe-static
```

### Docker Deployment

#### Container exits immediately

**Problem:** Container starts but stops immediately

**Solution:**
```bash
# Check logs
docker logs comfyui-manager

# Common fixes:
# 1. Port conflict
docker run -p 8080:1566 ...

# 2. Volume permissions
docker run --user 1001:1001 ...

# 3. Missing environment variables
docker run -e PORT=1566 -e HOST=0.0.0.0 ...
```

#### Cannot access from host

**Problem:** localhost:1566 not accessible

**Solution:**
```yaml
# docker-compose.yml
environment:
  - HOST=0.0.0.0  # Not 127.0.0.1!
```

#### Volumes not persisting

**Problem:** Data lost after container restart

**Solution:**
```bash
# Check volumes
docker volume ls | grep comfyui

# Inspect volume
docker volume inspect comfyui-database

# Verify mounts
docker inspect comfyui-manager | grep Mounts -A 20
```

### General Issues

#### Database corruption

**Problem:** Database errors on startup

**Solution:**
```bash
# Backup first!
cp database/images.db database/images.db.backup

# Reset database
npm run db:reset
```

#### Out of memory

**Problem:** Application crashes with OOM

**Solution:**
```bash
# Portable
export NODE_OPTIONS=--max-old-space-size=2048

# Docker
docker run -m 2g ...
```

#### Slow image processing

**Problem:** Image uploads are slow

**Solution:**
- Check CPU usage
- Reduce concurrent uploads
- Use optimized images (already WebP optimized)
- Consider GPU acceleration (future)

---

## 📊 Build Comparison

| Metric | Portable | Docker | SEA |
|--------|----------|--------|-----|
| Build time | 3-5 min | 4-6 min | 2-3 min |
| Final size | ~45MB zip | ~100MB image | ~80MB exe |
| Startup time | 2-5 min (first) | 5-10s | 10-15s |
| Memory usage | ~150MB | ~140MB | ~160MB |
| Update process | Manual copy | `docker pull` | Replace exe |
| Multi-platform | ✅ Yes | ✅ Yes | ⚠️ Per platform |
| Internet required | First run only | Build time | No |
| User-friendly | ✅✅✅ | ✅✅ | ✅✅✅ |
| Production-ready | ✅✅ | ✅✅✅ | ⚠️ Experimental |

---

## 🎯 Deployment Checklist

### Pre-Deployment

- [ ] Node.js 20+ installed (for building)
- [ ] All dependencies installed (`npm run install:all`)
- [ ] Tests passing (if applicable)
- [ ] Configuration reviewed

### Portable Deployment

- [ ] Run `npm run build:full`
- [ ] Test startup with `start.bat`/`start.sh`
- [ ] Verify all features work
- [ ] Create distribution archive
- [ ] Write user documentation
- [ ] Test on target platform

### Docker Deployment

- [ ] Docker installed and running
- [ ] Run `npm run build:docker`
- [ ] Review `docker-compose.yml`
- [ ] Set environment variables
- [ ] Configure volumes
- [ ] Test with `docker-compose up -d`
- [ ] Verify health checks
- [ ] Test backups
- [ ] Document for team

### Post-Deployment

- [ ] Monitor logs for errors
- [ ] Verify all features work
- [ ] Test backup/restore
- [ ] Document any issues
- [ ] Update user documentation
- [ ] Set up monitoring (if production)

---

## 📚 Additional Resources

- [Architecture Documentation](docs/development/architecture.md)
- [API Documentation](docs/development/api.md)
- [FFmpeg Guide](docs/development/ffmpeg.md)
- [Features Guide](docs/user/features.md)

---

**Last Updated:** 2024
**Version:** 1.0.0

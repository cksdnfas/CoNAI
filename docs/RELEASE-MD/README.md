# CoNAI

A powerful, modern AI image management system with advanced gallery features, metadata extraction, and seamless integration with ComfyUI and NovelAI workflows.

![Version](https://img.shields.io/badge/version-2.0.2-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

---

## Overview

CoNAI is a comprehensive image and video management solution designed for AI artists and creators. Built with React and Node.js, it provides an intuitive interface for organizing, analyzing, and managing AI-generated content with advanced features like automatic tagging, metadata extraction, and smart grouping.

---

## Key Features

### 🖼️ Advanced Gallery Views

**Masonry Gallery**
- Pinterest-style responsive masonry layout
- Dynamic image arrangement optimized for different aspect ratios
- Smooth infinite scrolling with lazy loading
- High-performance rendering for thousands of images

**Grid Gallery**
- Uniform grid layout with customizable columns
- Pagination support for organized browsing
- Batch selection and operations
- Responsive design adapting to screen sizes

### 📁 Smart Media Organization

**Auto-Folder Grouping**
- Automatic image classification based on folder structure
- Real-time monitoring of external folders
- Smart detection of new images and updates
- Folder-based batch operations

**Custom Media Groups**
- Create custom collections and albums
- Tag-based and metadata-based grouping
- Auto-collection rules with regex support
- Hierarchical group organization

**External Folder Support**
- Watch and sync external directories
- Support for network drives and cloud storage
- Automatic metadata extraction from external sources
- Preserve original file locations

### 🏷️ AI-Powered Metadata Extraction

**Multi-Format Support**
- **ComfyUI**: Full workflow metadata extraction
- **NovelAI**: Complete generation parameters
- **Stable Diffusion**: Prompt and model information
- **Custom AI Tools**: Extensible metadata parser

**Metadata Features**
- Automatic prompt extraction (positive/negative)
- Model and checkpoint detection
- Generation parameters (steps, CFG, sampler, etc.)
- EXIF and PNG chunk parsing
- Video metadata (duration, codec, fps, bitrate)

### 🤖 WD v3 Tagger AI Integration

**Automatic Image Tagging**
- Vision Transformer (ViT) model for accurate tag detection
- Rating classification (General, Sensitive, Questionable, Explicit)
- Character recognition with confidence scores
- General tag extraction with customizable thresholds

**Tag Management**
- Batch tagging for multiple images
- Tag filtering and search
- Synonym grouping and merging
- Export tags for training datasets

### 🎬 Video Processing

**Animated Thumbnails**
- Automatic WebP animated thumbnail generation
- Intelligent frame extraction based on video length
- Optimized playback speed for smooth previews
- Hardware-accelerated processing with FFmpeg

**Video Metadata**
- Duration, resolution, and codec detection
- Frame rate and bitrate analysis
- Audio track information
- Thumbnail generation strategies

### 🔍 Advanced Search & Filtering

**Powerful Search**
- Full-text search across prompts and metadata
- Tag-based filtering with AND/OR logic
- Date range and file type filters
- Model and workflow search

**Smart Filters**
- Filter by AI tool (ComfyUI, NovelAI, etc.)
- Resolution and aspect ratio filters
- Rating and tag-based filtering
- Custom metadata queries

### 🔄 ComfyUI & NovelAI Integration

**ComfyUI Workflow Integration**
- Direct workflow import from images
- Workflow execution tracking
- Metadata-based workflow templates
- Batch image generation monitoring

**NovelAI Support**
- Full NAI metadata extraction
- Anlas cost tracking
- Model version detection
- Prompt enhancement history

### 💾 Robust Data Management

**Storage Options**
- Local filesystem storage
- Configurable data paths
- Automatic directory structure
- Date-based organization (YYYY-MM-DD)

**Backup & Recovery**
- Database backup utilities
- Image integrity verification
- Recycle bin for deleted files
- Export/import functionality

---

## Quick Start

### System Requirements

**Minimum:**
- OS: Windows 10+, Linux (Ubuntu 20.04+), macOS 11+
- RAM: 2GB
- Disk: 10GB+ (excluding image storage)
- Port: 1666 available

**Recommended:**
- RAM: 4GB+
- Disk: SSD recommended
- GPU: CUDA-compatible for WD Tagger AI acceleration

### Installation

#### Portable Version (Recommended)

**Windows:**
```bash
# Extract the portable package
# Run the application
start.bat
```

**Linux/Mac:**
```bash
# Extract the portable package
# Make executable
chmod +x start.sh

# Run the application
./start.sh
```

**First Run:**
The application will automatically:
1. Create required directories (`uploads/`, `database/`, `models/`)
2. Initialize SQLite database
3. Install missing dependencies (Lite version only)
4. Start the server on port 1666

**Access the Application:**
```
Local:    http://localhost:1666
Network:  http://YOUR_IP:1666
```

#### Docker Deployment

**Using Docker Compose:**
```bash
# Navigate to docker directory
cd docker/

# Start the service
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the service
docker-compose down
```

**Docker Environment Variables:**
Create a `.env` file in the docker directory:
```env
PORT=1666
RUNTIME_BASE_PATH=/data
TAGGER_ENABLED=true
TAGGER_MODEL=vit
```

**Volume Mapping:**
The Docker container maps the following volumes:
- `/data/uploads` - Image storage
- `/data/database` - SQLite database
- `/data/models` - AI models (WD Tagger)
- `/data/logs` - Application logs

### Basic Configuration

**Environment Variables (`.env` file):**
```env
# Server Configuration
PORT=1666
NODE_ENV=production

# Storage Paths
RUNTIME_BASE_PATH=/path/to/data
RUNTIME_UPLOADS_DIR=/path/to/uploads
RUNTIME_DATABASE_DIR=/path/to/database

# WD v3 Tagger AI
TAGGER_ENABLED=true
TAGGER_MODEL=vit
TAGGER_GEN_THRESHOLD=0.35
TAGGER_CHAR_THRESHOLD=0.75
PYTHON_PATH=python

# External Access
PUBLIC_BASE_URL=http://YOUR_IP:1666
ENABLE_EXTERNAL_IP=true
```

---

## WD v3 Tagger AI Setup

### Enable AI Tagging

**1. Install Python Dependencies:**
```bash
# Portable version
cd app/python
pip install -r requirements.txt

# Docker version (included)
# No action needed
```

**2. Configure Environment:**
```env
TAGGER_ENABLED=true
TAGGER_MODEL=vit          # Options: vit, swinv2, convnext
TAGGER_GEN_THRESHOLD=0.35 # General tag threshold (0.0-1.0)
TAGGER_CHAR_THRESHOLD=0.75 # Character threshold (0.0-1.0)
```

**3. First Run:**
- AI model automatically downloads from Hugging Face (~600MB-1GB)
- Saved to `models/` directory
- One-time download, cached for future use

### Model Selection

**ViT (Vision Transformer) - Default:**
- Best balance of speed and accuracy
- Recommended for most users
- ~600MB model size

**SwinV2 (Swin Transformer V2):**
- Highest accuracy
- Slower processing
- ~1GB model size

**ConvNeXt:**
- Fast processing
- Good accuracy
- ~800MB model size

### Performance

**CPU Processing:**
- 2-5 seconds per image
- ~2-4GB RAM usage

**GPU Processing (CUDA):**
- 0.5-1 second per image
- ~2-4GB VRAM usage
- Requires CUDA-compatible GPU and drivers

---

## Usage Examples

### Image Upload

**Via Web Interface:**
1. Click "Upload" button
2. Select images or drag & drop
3. Automatic metadata extraction
4. Auto-tagging (if enabled)

**Via API:**
```bash
curl -X POST http://localhost:1666/api/images/upload \
  -F "file=@image.png" \
  -F "collection_type=comfyui"
```

### Create Custom Group

**Via Web Interface:**
1. Navigate to "Groups" page
2. Click "Create Group"
3. Configure auto-collection rules (optional)
4. Add images manually or via rules

**Auto-Collection Rule Example:**
```json
{
  "name": "Anime Characters",
  "rules": [
    {
      "field": "auto_tags.general",
      "operator": "contains",
      "value": "1girl"
    },
    {
      "field": "model",
      "operator": "regex",
      "value": ".*anime.*"
    }
  ]
}
```

### Batch AI Tagging

**Tag All Untagged Images:**
```bash
curl -X POST http://localhost:1666/api/images/batch-tag \
  -H "Content-Type: application/json" \
  -d '{"image_ids": [1, 2, 3, 4, 5]}'
```

### External Folder Monitoring

**Add Watch Folder:**
```bash
curl -X POST http://localhost:1666/api/folders/watch \
  -H "Content-Type: application/json" \
  -d '{
    "path": "/path/to/comfyui/output",
    "auto_import": true,
    "collection_type": "comfyui"
  }'
```

---

## Remote Access Setup

### Local Network Access

**Automatic Network Sharing:**
When the server starts, it displays:
```
🏠 Local:    http://localhost:1666
🌐 Network:  http://192.168.1.100:1666
```

Use the Network URL to access from other devices on the same Wi-Fi/LAN.

### External Internet Access

**1. Router Port Forwarding:**
- Access your router admin page (usually http://192.168.1.1)
- Forward port 1666 to your server's local IP
- Protocol: TCP

**2. Configure External Access:**
```env
PUBLIC_BASE_URL=http://YOUR_EXTERNAL_IP:1666
BACKEND_HOST=YOUR_EXTERNAL_IP
ENABLE_EXTERNAL_IP=true
```

**3. Get External IP:**
```bash
# Linux/Mac
curl https://api.ipify.org

# Windows PowerShell
Invoke-WebRequest -Uri "https://api.ipify.org"
```

**4. Use DDNS (Recommended):**
For dynamic IPs, use a DDNS service:
- No-IP: https://www.noip.com
- DuckDNS: https://www.duckdns.org

Then update `.env`:
```env
PUBLIC_BASE_URL=http://your-domain.ddns.net:1666
BACKEND_HOST=your-domain.ddns.net
```

### Security Recommendations

⚠️ **Important:** Current version has no built-in authentication.

**For External Access:**
1. Use VPN for secure remote access
2. Implement reverse proxy with authentication (Nginx + Basic Auth)
3. Configure firewall rules to limit access
4. Consider using Caddy for automatic HTTPS:

```bash
# Caddyfile
your-domain.ddns.net {
  reverse_proxy localhost:1666
}
```

---

## Data Management

### Backup Strategy

**Automated Backup Script (Linux/Mac):**
```bash
#!/bin/bash
BACKUP_DIR="$HOME/backups/comfyui-$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"
cp -r uploads "$BACKUP_DIR/"
cp -r database "$BACKUP_DIR/"
tar -czf "$BACKUP_DIR.tar.gz" "$BACKUP_DIR"
echo "Backup completed: $BACKUP_DIR.tar.gz"
```

**Automated Backup Script (Windows):**
```batch
@echo off
set BACKUP_DIR=D:\Backups\ComfyUI_%date:~0,4%%date:~5,2%%date:~8,2%
mkdir "%BACKUP_DIR%"
xcopy /E /I uploads "%BACKUP_DIR%\uploads"
xcopy /E /I database "%BACKUP_DIR%\database"
echo Backup completed: %BACKUP_DIR%
```

### Storage Structure

```
data/
├── uploads/
│   ├── images/
│   │   └── YYYY-MM-DD/
│   │       ├── Origin/
│   │       ├── thumbnails/
│   │       └── optimized/
│   └── videos/
│       └── YYYY-MM-DD/
│           ├── Origin/
│           └── optimized/
├── database/
│   └── images.db
├── models/
│   └── wd-v3-tagger/
└── logs/
    └── app.log
```

### Database Maintenance

**Reset Database:**
```bash
# Stop server first
rm -rf database/images.db
# Restart server (creates new database)
```

**Recover Corrupted Database:**
```bash
sqlite3 database/images.db ".recover" | sqlite3 database/images_recovered.db
```

---

## Troubleshooting

### Common Issues

**Port Already in Use:**
```bash
# Windows
netstat -ano | findstr :1666
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:1666 | xargs kill -9
```

Solution: Change port in `.env` file:
```env
PORT=3000
```

**FFmpeg Not Available:**
```
Error: FFmpeg is not available
```

Solution:
- **Portable:** FFmpeg is auto-bundled
- **Docker:** FFmpeg is included
- **Manual:** Install FFmpeg and add to PATH

**WD Tagger Dependencies Missing:**
```
Error: Python dependencies not found
```

Solution:
```bash
cd app/python  # or backend/python
pip install -r requirements.txt --force-reinstall
```

**External Access Not Working:**

Checklist:
- [ ] Port forwarding configured on router
- [ ] Firewall allows port 1666
- [ ] External IP is correct
- [ ] Server is running
- [ ] Router has been restarted

Test port: https://www.yougetsignal.com/tools/open-ports/

**Database Locked Error:**
```
Error: SQLITE_BUSY: database is locked
```

Solution: Stop all instances of the application, then restart.

---

## Performance Optimization

### Image Processing

**Optimize Upload Speed:**
```env
# Disable optional processing for faster uploads
GENERATE_THUMBNAILS=true
OPTIMIZE_IMAGES=true
AUTO_TAG_ON_UPLOAD=false  # Tag manually later
```

**Batch Processing:**
Use batch operations for multiple images instead of individual requests.

### Database Performance

**Vacuum Database Regularly:**
```bash
sqlite3 database/images.db "VACUUM;"
```

**Enable WAL Mode:**
WAL (Write-Ahead Logging) is enabled by default for better concurrent access.

### GPU Acceleration

**Enable CUDA for WD Tagger:**
```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

Verify GPU usage:
```python
import torch
print(torch.cuda.is_available())  # Should print True
```

---

## API Reference

### Core Endpoints

**Image Upload:**
```
POST /api/images/upload
Content-Type: multipart/form-data
Body: file, collection_type (optional)
```

**Get Images:**
```
GET /api/images?page=1&pageSize=25
Query: page, pageSize, search, tags, dateFrom, dateTo
```

**AI Tagging:**
```
POST /api/images/:id/tag
POST /api/images/batch-tag
Body: { image_ids: [1, 2, 3] }
```

**Group Management:**
```
GET /api/groups
POST /api/groups
PUT /api/groups/:id
DELETE /api/groups/:id
```

**Auto-Collection:**
```
POST /api/groups/:id/auto-collect
POST /api/groups/:id/rules
```

For complete API documentation, see: `/api/docs` (when running)

---

## Development & Building

### Build from Source

**Prerequisites:**
- Node.js 18+
- npm or yarn

**Clone and Build:**
```bash
git clone <repository>
cd conai
npm run install:all
npm run build:full
```

**Build Portable Package:**
```bash
npm run build:portable
# Output: build-output/portable/
```

**Build Docker Image:**
```bash
npm run build:docker
# Output: build-output/docker/
```

---

## Version History

### v2.0.2 (Current)
- Enhanced multi-language support (English/Korean)
- Improved group download functionality
- Fixed thumbnail path handling
- Performance optimizations

### v2.0.1-alpha
- Added custom group and auto-folder group downloads
- Improved metadata extraction
- Enhanced UI/UX

### v2.0.0
- Major rewrite with React frontend
- WD v3 Tagger AI integration
- Video processing support
- External folder monitoring
- Docker deployment support

---

## License

MIT License - See LICENSE file for details

---

## Support & Contributions

**Documentation:**
- Setup Guide: [SETUP.md](SETUP.md)
- API Documentation: [docs/development/api.md](docs/development/api.md)
- Architecture: [docs/development/architecture.md](docs/development/architecture.md)

**Issues & Bug Reports:**
Please use the issue tracker on GitHub.

**Contributing:**
Contributions are welcome! Please follow the development guidelines in CLAUDE.md.

---

## Credits

Built with:
- React + TypeScript
- Node.js + Express
- SQLite3
- Sharp (image processing)
- FFmpeg (video processing)
- WD v3 Tagger (AI tagging)
- Material-UI (UI components)

---

**Made for AI Artists and Creators**

Enjoy managing your AI-generated masterpieces!

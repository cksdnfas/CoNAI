# ComfyUI Image Manager v2.0.0-alpha

AI Image Management and Analysis System

## Major Changes (v2.0.0)

### New Features

**External Folder Support**
- Watch and manage folders from anywhere on your system
- Independent scan settings per folder (auto-scan interval, polling interval)
- Real-time file watching with periodic polling fallback
- Flexible runtime path configuration (`RUNTIME_BASE_PATH` environment variable)

**User Authentication System**
- Argon2-based secure authentication
- Session-based login/logout
- Multi-user support
- Automatic admin account creation on first run

### Core Features

**AI Image Analysis**
- Automatic metadata extraction (ComfyUI, NovelAI, Stable Diffusion)
- Auto-tagging with WD Tagger (optional)
- Automatic prompt collection and statistics
- Image similarity search (Perceptual Hash-based)

**Image Management**
- Automatic thumbnail generation and optimization
- Group-based auto-classification (regex/string matching)
- Rating and favorites management
- Recycle bin with recovery support
- Video file support (FFmpeg)

**Generation History**
- Real-time generation tracking via ComfyUI API integration
- Workflow and prompt history
- Automatic generation parameter storage

**Prompt Analysis**
- Prompt usage frequency statistics
- Synonym grouping
- Positive/Negative prompt separation analysis

## Tech Stack

- **Backend**: Node.js, TypeScript, Express, SQLite3
- **Frontend**: React 19, Material-UI, Vite
- **Image Processing**: Sharp, FFmpeg
- **AI Analysis**: WD Tagger (optional)

## Deployment Options

- **Portable**: Single executable (Windows/Linux)
- **Integrated**: Unified build (Frontend + Backend)
- **Docker**: Docker Compose support
- **Development**: Dev mode with hot reload

## System Requirements

- Node.js 18.0.0 or higher
- 4GB RAM or more recommended
- FFmpeg (for video support)

## Quick Start

```bash
# Install dependencies
npm run install:all

# Run in development mode
npm run dev

# Build for production
npm run build:full
```

## Security

- Password security with Argon2 hashing
- HTTPS support (auto-generated self-signed certificates)
- Session-based authentication
- Rate limiting enabled

## License

Personal Project

---

**Note**: This is an alpha release intended for testing purposes only.

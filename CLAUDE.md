# CLAUDE.md

Development guide for Claude Code when working with this repository.

## Project Overview

ComfyUI Image Manager is a personal AI image management service with a React frontend and Node.js/TypeScript backend. The project uses a monorepo structure with separate backend and frontend workspaces.

## Development Commands

### Initial Setup
```bash
npm run setup                    # Auto-create directories and .env files
npm run install:all             # Install all dependencies
```

### Development
```bash
npm run dev                     # Start backend + frontend concurrently
npm run dev:backend             # Start backend only (port 1566)
npm run dev:frontend            # Start frontend only
```

### Build & Production
```bash
npm run build                   # Build backend + frontend
npm run build:backend           # TypeScript compilation (tsc)
npm run build:frontend          # Vite build
npm run build:full              # Integrated + bundle + portable package
```

### Database Management
```bash
npm run db:reset                # Delete database and re-run migrations
cd backend && npm run db:migrate # Run database migrations manually
```

**⚠️ Breaking Change Notice**: The `optimized_path` column has been removed from the database schema. If you have an existing database, you must delete it and start fresh:
```bash
# Delete existing database
rm -rf backend/database/

# Restart the server to recreate the database with the new schema
npm run dev
```

### Maintenance
```bash
npm run clean                   # Remove all dist and node_modules folders
```

## Architecture Quick Reference

### Core System Components

**Image Processing Pipeline**:
- Upload → Sharp processing → Generate thumbnail → Extract AI metadata → Store in SQLite
- Supports ComfyUI, NovelAI, Stable Diffusion metadata
- Creates 2 versions: original, thumbnail (1080px)

**Auto-Collection System**:
- Automatically groups images based on configurable conditions
- Supports regex and string matching
- Runs on upload and can be triggered manually

**Prompt Management**:
- Collects and analyzes prompts from AI-generated images
- Synonym grouping and statistical analysis
- Separates positive/negative prompts

### Database Architecture

**Core Tables**:
- `images`: Main image records with AI metadata
- `groups`: Image grouping with auto-collection configuration
- `image_groups`: Many-to-many relationship
- `prompt_collections`: Prompt usage statistics
- `prompt_groups`: Hierarchical prompt organization

**Migration System**: `backend/src/database/migrations/` - automatic execution on startup

### API Structure

**REST Endpoints**:
- `/api/images/*`: Image CRUD, upload, search, download
- `/api/groups/*`: Group management and auto-collection
- `/api/prompt-collection/*`: Prompt analysis and search
- `/api/prompt-groups/*`: Prompt organization

**Key Services**:
- `ImageProcessor`: Sharp-based image processing with AI metadata extraction
- `AutoCollectionService`: Rule-based automatic image grouping
- `PromptCollectionService`: Prompt parsing and statistical analysis
- `SynonymService`: Prompt synonym management

### File Organization

```
backend/src/
├── database/           # SQLite setup and migrations
├── middleware/         # Express middleware (upload, error handling)
├── models/            # Database models with business logic
├── routes/            # Express route handlers
├── services/          # Business logic services
├── types/             # TypeScript interfaces
└── utils/             # Utility functions
```

### Key Configuration

- Port: 1566 (configurable via `PORT` env var)
- Rate limiting: 1000 requests/minute (development setting)

**Runtime Paths** (configurable via environment variables):
- All data paths default to executable location if not configured
- `RUNTIME_BASE_PATH`: Set base directory for all data (overrides default behavior)
- Individual path overrides (take precedence over `RUNTIME_BASE_PATH`):
  - `RUNTIME_UPLOADS_DIR`: Upload directory (default: `basePath/uploads/`)
  - `RUNTIME_DATABASE_DIR`: Database directory (default: `basePath/database/`)
  - `RUNTIME_LOGS_DIR`: Log directory (default: `basePath/logs/`)
  - `RUNTIME_TEMP_DIR`: Temporary files (default: `basePath/temp/`)
  - `RUNTIME_MODELS_DIR`: AI models (default: `basePath/models/`)
  - `RUNTIME_RECYCLE_BIN_DIR`: Deleted files (default: `basePath/RecycleBin/`)
- Path resolution managed by `backend/src/config/runtimePaths.ts`
- Initial watch folders (`uploads/images`, `uploads/API/images`, `uploads/videos`) auto-created at configured upload path

## Development Patterns

### Error Handling
All route handlers use `asyncHandler` wrapper with structured error responses and TypeScript error typing (`error as Error`).

### File Processing
Multi-step pipeline with non-critical error handling for prompt collection and auto-grouping to ensure uploads succeed even if secondary processing fails.

### Database Operations
Direct SQLite3 usage with Promise-wrapped queries. All models return strongly-typed results.

### Image Storage
Date-based directory structure (`YYYY-MM-DD/`) with UUID-based filenames to prevent conflicts.

## Key Development Notes

- Backend automatically creates required directories and database on startup
- Image metadata extraction supports multiple AI tools with extensible parsing
- Auto-collection runs asynchronously to avoid blocking uploads
- Prompt parsing includes weight removal and normalization for consistent matching
- All route handlers must return responses explicitly for TypeScript compliance
- Database queries use parameterized statements for SQL injection protection

## Documentation

For detailed documentation, see:

- **[Setup Guide](SETUP.md)** - Initial setup and configuration
- **[Architecture](docs/development/architecture.md)** - Complete architecture documentation
- **[API Documentation](docs/development/api.md)** - REST API reference
- **[Deployment Guide](docs/user/deployment.md)** - Deployment options
- **[Features Guide](docs/user/features.md)** - WD Tagger, video processing
- **[FFmpeg Guide](docs/development/ffmpeg.md)** - FFmpeg setup and bundling

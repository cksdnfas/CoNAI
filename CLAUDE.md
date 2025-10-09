# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ComfyUI Image Manager is a React-based image viewer and manager for ComfyUI, featuring a Node.js/TypeScript backend with Express.js and SQLite. The project is structured as a monorepo with separate backend and frontend workspaces.

**Note**: This appears to be a backend-only implementation currently - the frontend workspace is referenced in package.json but not present in the codebase.

## Development Commands

### Initial Setup
```bash
npm run setup                    # Auto-create directories and .env files
npm run install:all             # Install all dependencies (root, backend, frontend)
```

### Development
```bash
npm run dev                     # Start both backend and frontend concurrently
npm run dev:backend             # Start backend only (PORT 1566)
npm run dev:frontend            # Start frontend only (referenced but not implemented)
```

### Build & Production
```bash
npm run build                   # Build both backend and frontend
npm run build:backend           # TypeScript compilation (tsc)
npm run start                   # Start production servers
npm run start:backend           # Start built backend (node dist/index.js)
```

### Database Management
```bash
npm run db:reset                # Delete database and re-run migrations
cd backend && npm run db:migrate # Run database migrations manually
```

### Maintenance
```bash
npm run clean                   # Remove all dist and node_modules folders
```

## Architecture Overview

### Core System Components

**Image Processing Pipeline**:
- Upload → Sharp processing → Generate thumbnail + optimized versions → Extract AI metadata → Store in SQLite
- Supports AI tool metadata extraction (ComfyUI, NovelAI, Stable Diffusion, etc.)
- Creates 3 image versions: original, thumbnail (1080px), optimized (WebP, 95% quality)

**Auto-Collection System**:
- Automatically groups images based on configurable conditions (prompt patterns, AI tools, models)
- Supports regex and simple string matching
- Runs on new image uploads and can be triggered manually

**Prompt Management**:
- Collects and analyzes prompts from AI-generated images
- Supports synonym grouping and statistical analysis
- Separates positive and negative prompt collections

### Database Architecture

**Core Tables**:
- `images`: Main image records with AI metadata fields (steps, cfg_scale, sampler, etc.)
- `groups`: Image grouping with auto-collection configuration
- `image_groups`: Many-to-many relationship with manual/auto collection tracking
- `prompt_collections`: Prompt usage statistics and synonym management
- `prompt_groups`: Hierarchical prompt organization

**Migration System**: Located in `backend/src/database/migrations/` with automatic execution on startup.

### API Structure

**REST Endpoints**:
- `/api/images/*`: Image CRUD, upload, search, download
- `/api/groups/*`: Group management and auto-collection
- `/api/prompt-collection/*`: Prompt analysis and search
- `/api/prompt-groups/*`: Prompt organization
- `/api/negative-prompt-groups/*`: Negative prompt management

**Key Services**:
- `ImageProcessor`: Sharp-based image processing with AI metadata extraction
- `AutoCollectionService`: Rule-based automatic image grouping
- `PromptCollectionService`: Prompt parsing and statistical analysis
- `SynonymService`: Prompt synonym management and merging

### Type System

**Core Interfaces**:
- `ImageRecord`: Complete image database schema with AI metadata
- `GroupRecord`: Group configuration including auto-collection rules
- `AutoCollectCondition`: Flexible condition system for automatic grouping
- `PromptCollectionRecord`: Prompt usage tracking and statistics

### File Organization

**Backend Structure**:
```
backend/src/
├── database/           # SQLite setup and migrations
├── middleware/         # Express middleware (upload, error handling)
├── models/            # Database models with business logic
├── routes/            # Express route handlers
├── services/          # Business logic services
├── types/             # TypeScript interfaces
└── utils/             # Utility functions (prompt parsing)
```

**Key Configuration**:
- Port: 1566 (configurable via PORT env var)
- Upload path: `uploads/` directory (auto-created)
- Database: `database/images.db` (auto-created)
- Rate limiting: 1000 requests/minute (development setting)

### Development Patterns

**Error Handling**: All route handlers use `asyncHandler` wrapper with structured error responses and TypeScript error typing (`error as Error`).

**File Processing**: Multi-step pipeline with non-critical error handling for prompt collection and auto-grouping to ensure uploads succeed even if secondary processing fails.

**Database Operations**: Direct SQLite3 usage with Promise-wrapped queries. All models return strongly-typed results.

**Image Storage**: Date-based directory structure (`YYYY-MM-DD/`) with UUID-based filenames to prevent conflicts.

## Key Development Notes

- The backend automatically creates required directories and database on startup
- Image metadata extraction supports multiple AI tools with extensible parsing
- Auto-collection runs asynchronously to avoid blocking uploads
- Prompt parsing includes weight removal and normalization for consistent matching
- All route handlers must return responses explicitly for TypeScript compliance
- Database queries use parameterized statements for SQL injection protection
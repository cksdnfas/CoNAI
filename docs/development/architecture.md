# Architecture Guide

Complete architecture documentation for ComfyUI Image Manager covering system design, build process, and development patterns.

---

## 📋 Project Overview

**Purpose:** Personal AI image management service accessible anywhere, anytime

**Core Requirements:**
- ✅ Remote access via internal/external IP
- ✅ Web browser URL-based access
- ✅ Easy deployment (single executable)
- ✅ API for image upload/management
- ✅ ComfyUI workflow integration ready
- ✅ Multi-language support (Korean, English, Japanese, Chinese)

---

## 🏗️ System Architecture

### High-Level Structure

```
┌─────────────────────────────────────────────────┐
│         Single Executable (SEA)                 │
│  ┌───────────────────────────────────────────┐ │
│  │  Node.js Runtime + Application Bundle    │ │
│  │  ├─ Backend (Express + TypeScript)       │ │
│  │  ├─ Frontend (React + Vite) - Embedded   │ │
│  │  └─ Native Modules (Sharp, SQLite3)      │ │
│  └───────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
           │                    │
           ▼                    ▼
    ┌──────────┐         ┌──────────┐
    │ Database │         │ Uploads  │
    │ (SQLite) │         │ (Images) │
    └──────────┘         └──────────┘
```

### Deployment: Node.js SEA (Single Executable Application)

**Why SEA:**
- ✅ Official Node.js feature (v20+)
- ✅ More stable and maintainable than PKG
- ✅ True single executable (includes Node.js runtime)
- ✅ Can embed frontend static files
- ✅ Cross-platform support (Windows/Linux/macOS)

**Why Not Electron:**
- Electron is for desktop apps (window management, menu bar, etc.)
- Web browser access is the goal, so unnecessary overhead
- SEA is more suitable as a web server

---

## 📦 Build Process

### 1. Frontend-Backend Integrated Build

```bash
npm run build:integrated
```

Process:
1. Frontend build (React + Vite)
2. Backend build (TypeScript → JavaScript)
3. Copy frontend dist to backend dist/frontend

### 2. Dependency Bundling

```bash
npm run build:bundle
```

Process:
- Bundle all dependencies into single file with esbuild
- Exclude native modules (sharp, sqlite3)
- Final size: ~1.3MB

### 3. SEA Executable Creation

```bash
npm run build:sea
```

Process:
1. Generate SEA preparation blob
2. Copy Node.js binary
3. Inject blob into binary (postject)
4. Copy native modules
5. Copy frontend static files
6. Generate environment template and README

**Final Output:**
```
pkg-output/
├── comfyui-image-manager.exe    (82MB - Node.js + app)
├── node_modules/                 (Native modules)
│   ├── sharp/
│   └── sqlite3/
├── frontend/                     (React app)
│   ├── index.html
│   └── assets/
├── .env.example                  (Config template)
└── README.md                     (User guide)
```

### One-Step Full Build

```bash
npm run build:full
```

Executes all steps sequentially.

---

## 🌐 Network Architecture

### Access Layers

```
┌─────────────────────────────────────────────────┐
│  Level 1: Local Access (localhost:1566)        │
│  - Same computer only                          │
└─────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────┐
│  Level 2: Network Access (192.168.x.x:1566)    │
│  - All devices on same Wi-Fi/LAN               │
│  - Auto IP detection and display               │
└─────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────┐
│  Level 3: External Access (Public IP:1566)     │
│  - Port forwarding required                     │
│  - DDNS recommended (dynamic IP support)        │
│  - HTTPS recommended (security)                 │
└─────────────────────────────────────────────────┘
```

### Automatic IP Detection

**Implementation:** `backend/src/utils/networkInfo.ts`
- Local IP: Query OS network interfaces
- External IP: Call public API (optional)

**Server Startup Output:**
```
╔════════════════════════════════════════════════════════════════════════╗
║  🎉 ComfyUI Image Manager - Server Running!                           ║
╠────────────────────────────────────────────────────────────────────────╣
║  📡 Access URLs:                                                       ║
║                                                                        ║
║  🏠 Local:    http://localhost:1566                                   ║
║  🌐 Network:  http://192.168.1.100:1566                               ║
║  🌐 Network:  http://10.0.0.50:1566                                   ║
║  🌍 External: http://1.2.3.4:1566 (requires port forwarding)          ║
╠────────────────────────────────────────────────────────────────────────╣
║  📦 Data Root: D:\_Dev\Comfyui_Image_Manager_2                        ║
║  📁 Uploads: uploads                                                   ║
╚════════════════════════════════════════════════════════════════════════╝
```

---

## 🔌 API Architecture

### Core Endpoints

**Image Management:**
- `POST /api/images/upload` - Upload image (with AI metadata)
- `GET /api/images` - List all images (pagination)
- `GET /api/images/search` - Search images
- `GET /api/images/:id` - Get single image
- `PUT /api/images/:id` - Update image info
- `DELETE /api/images/:id` - Delete image
- `GET /api/images/:id/download` - Download image

**Group Management:**
- `POST /api/groups` - Create group (with auto-collection rules)
- `GET /api/groups` - List groups
- `GET /api/groups/:id` - Get group details (with images)
- `POST /api/groups/:id/auto-collect` - Run auto-collection

**Prompt Analysis:**
- `GET /api/prompt-collection` - Prompt statistics
- `GET /api/prompt-collection/search` - Search prompts
- `POST /api/prompt-collection/merge` - Merge synonyms

**ComfyUI Integration (Future):**
- `POST /api/comfyui/generate` - Execute workflow
- `GET /api/comfyui/status/:jobId` - Check generation status
- `GET /api/comfyui/connection` - Check connection status

**Detailed Documentation:** [api.md](api.md)

---

## 💾 Database Architecture

### Core Tables

**`images`**: Main image records with AI metadata
```sql
CREATE TABLE images (
  id INTEGER PRIMARY KEY,
  filename TEXT,
  original_path TEXT,
  thumbnail_path TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  size INTEGER,
  upload_date TEXT,

  -- AI metadata
  prompt TEXT,
  negative_prompt TEXT,
  model TEXT,
  steps INTEGER,
  cfg_scale REAL,
  sampler TEXT,
  seed INTEGER,
  ai_tool TEXT,

  -- Video metadata
  duration REAL,
  fps INTEGER,
  video_codec TEXT,
  audio_codec TEXT,

  metadata TEXT -- JSON for extended metadata
);
```

**`groups`**: Image grouping with auto-collection
```sql
CREATE TABLE groups (
  id INTEGER PRIMARY KEY,
  name TEXT,
  description TEXT,
  auto_collect_enabled INTEGER,
  auto_collect_conditions TEXT, -- JSON array
  created_at TEXT
);
```

**`image_groups`**: Many-to-many relationship
```sql
CREATE TABLE image_groups (
  image_id INTEGER,
  group_id INTEGER,
  added_by_auto_collect INTEGER,
  added_at TEXT,
  PRIMARY KEY (image_id, group_id)
);
```

**`prompt_collections`**: Prompt statistics
```sql
CREATE TABLE prompt_collections (
  id INTEGER PRIMARY KEY,
  prompt TEXT UNIQUE,
  usage_count INTEGER,
  synonyms TEXT, -- JSON array
  created_at TEXT,
  updated_at TEXT
);
```

**`prompt_groups`**: Hierarchical prompt organization
```sql
CREATE TABLE prompt_groups (
  id INTEGER PRIMARY KEY,
  name TEXT,
  parent_id INTEGER,
  created_at TEXT
);
```

### Migration System

Location: `backend/src/database/migrations/`

Automatic execution on startup with version tracking.

---

## 🎯 Core System Components

### Image Processing Pipeline

**Flow:**
```
Upload → Sharp Processing → Generate Thumbnail → Extract AI Metadata → Store in SQLite
```

**Features:**
- Supports AI tool metadata extraction (ComfyUI, NovelAI, Stable Diffusion, etc.)
- Creates 2 image versions:
  - Original
  - Thumbnail (1080px)

**Implementation:** `backend/src/services/imageProcessor.ts`

### Auto-Collection System

**Features:**
- Automatically groups images based on configurable conditions
- Supports regex and simple string matching
- Runs on new image uploads and can be triggered manually

**Condition Types:**
- Prompt patterns
- AI tools
- Models
- Date ranges

**Implementation:** `backend/src/services/autoCollectionService.ts`

### Prompt Management

**Features:**
- Collects and analyzes prompts from AI-generated images
- Supports synonym grouping and statistical analysis
- Separates positive and negative prompt collections

**Implementation:** `backend/src/services/promptCollectionService.ts`

### Video Processing

**Features:**
- Automatic animated thumbnail generation
- Intelligent frame extraction based on video duration
- WebP animation with auto-cleanup

**Frame Extraction:**
- ≤60s videos: 1 fps (1 frame/second)
- >60s videos: 0.2 fps (1 frame/5 seconds)

**Implementation:** `backend/src/services/videoProcessor.ts`

---

## 🔧 Key Services

### ImageProcessor
**Purpose:** Sharp-based image processing with AI metadata extraction

**Methods:**
- `processImage()`: Main processing pipeline
- `extractMetadata()`: AI metadata extraction
- `createThumbnail()`: Thumbnail generation

### AutoCollectionService
**Purpose:** Rule-based automatic image grouping

**Methods:**
- `evaluateConditions()`: Test conditions against image
- `autoCollectForGroup()`: Collect images for specific group
- `autoCollectAll()`: Collect for all enabled groups

### PromptCollectionService
**Purpose:** Prompt parsing and statistical analysis

**Methods:**
- `collectPrompt()`: Parse and store prompt
- `getStatistics()`: Get usage statistics
- `searchPrompts()`: Search with fuzzy matching

### SynonymService
**Purpose:** Prompt synonym management and merging

**Methods:**
- `addSynonym()`: Link synonyms
- `mergeSynonyms()`: Combine synonym groups
- `resolveSynonym()`: Get canonical form

---

## 📁 Project Structure

```
comfyui-image-manager/
├── frontend/                      # React Frontend
│   ├── src/
│   │   ├── components/
│   │   ├── utils/
│   │   │   └── backend.ts        # API communication util
│   │   └── types/
│   ├── package.json
│   └── vite.config.ts
│
├── backend/                       # Express Backend
│   ├── src/
│   │   ├── routes/               # API routes
│   │   ├── models/               # Database models
│   │   ├── services/             # Business logic
│   │   ├── middleware/           # Express middleware
│   │   ├── database/             # DB initialization and migrations
│   │   ├── utils/
│   │   │   ├── networkInfo.ts   # IP detection
│   │   │   └── httpsOptions.ts  # HTTPS config
│   │   ├── config/
│   │   │   └── runtimePaths.ts  # Path management
│   │   ├── i18n/                # Multi-language support
│   │   │   ├── index.ts
│   │   │   └── locales/
│   │   │       ├── en.json
│   │   │       └── ko.json
│   │   └── index.ts             # Entry point
│   └── package.json
│
├── scripts/                      # Build scripts
│   ├── setup.js                 # Initial setup
│   ├── build-integrated.js      # Integrated build
│   ├── build-bundle.js          # Bundling
│   └── build-sea.js             # SEA creation
│
├── sea-config.json              # SEA configuration
├── package.json                 # Root package.json
└── docs/                        # Documentation
    ├── user/
    │   ├── deployment.md
    │   └── features.md
    └── development/
        ├── architecture.md      # This file
        ├── api.md
        └── ffmpeg.md
```

---

## 🌍 Internationalization (i18n)

### Implementation

**Backend:** `backend/src/i18n/index.ts`

**Language Files:** `backend/src/i18n/locales/*.json`

**Auto-Detection:** Environment variable `LOCALE` or system locale

**Supported Languages:**
- English (en) - ✅ Complete
- Korean (ko) - ✅ Complete
- Japanese (ja) - ⏳ TODO
- Chinese (zh) - ⏳ TODO

**Usage Example:**
```typescript
import { t } from './i18n';

console.log(t('server.started'));
console.log(t('errors.port_in_use', { port: 1566 }));
```

---

## 💻 Development Patterns

### Error Handling

**Pattern:** All route handlers use `asyncHandler` wrapper

**Example:**
```typescript
router.post('/upload', asyncHandler(async (req, res) => {
  try {
    const result = await processUpload(req.file);
    res.json({ success: true, data: result });
  } catch (error) {
    throw new Error(`Upload failed: ${(error as Error).message}`);
  }
}));
```

**Features:**
- Structured error responses
- TypeScript error typing (`error as Error`)
- Automatic error propagation to error middleware

### File Processing

**Pattern:** Multi-step pipeline with non-critical error handling

**Strategy:**
- Ensure uploads succeed even if secondary processing fails
- Prompt collection errors don't block upload
- Auto-grouping runs asynchronously

### Database Operations

**Pattern:** Direct SQLite3 usage with Promise-wrapped queries

**Features:**
- All models return strongly-typed results
- Parameterized statements for SQL injection protection
- Automatic connection management

**Example:**
```typescript
const images = await db.all<ImageRecord>(
  'SELECT * FROM images WHERE ai_tool = ?',
  [aiTool]
);
```

### Image Storage

**Pattern:** Date-based directory structure with UUID filenames

**Structure:**
```
uploads/
├── images/YYYY-MM-DD/
│   ├── Origin/
│   └── thumbnails/
└── videos/YYYY-MM-DD/
    ├── Origin/
    └── thumbnails/{video-filename}/
```

**Features:**
- UUID-based filenames prevent conflicts
- Automatic folder creation
- Organized by upload date

---

## 📊 Performance Characteristics

### Build Sizes
- Frontend (gzip): ~240KB
- Backend bundle: ~1.3MB
- SEA executable: ~82MB (includes Node.js runtime)
- Total package: ~83MB

### Runtime Performance
- Server startup: ~2 seconds
- Image upload processing: ~500ms (1MB image)
- Thumbnail generation: ~200ms (Sharp)
- Search query: <50ms (SQLite indexes)

### Scalability
- Concurrent users: 10-50 (local network)
- Image storage: Unlimited (depends on disk space)
- Database: SQLite handles hundreds of thousands of records

---

## 🔒 Security

### Current Implementation
- ✅ Helmet.js (security headers)
- ✅ Rate limiting (1000 req/min)
- ✅ CORS configuration
- ✅ HTTPS support (self-signed certificates)
- ✅ SQL injection prevention (parameterized queries)

### Future Improvements
- ⏳ User authentication
- ⏳ API key management
- ⏳ Let's Encrypt HTTPS
- ⏳ Content Security Policy
- ⏳ Enhanced file upload validation

---

## 🎯 Roadmap

### Phase 1: ComfyUI Direct Integration (v1.1)
- WebSocket connection to ComfyUI server
- Workflow execution via API
- Auto-save generated images
- Real-time generation progress

### Phase 2: Authentication & Security (v1.2)
- JWT-based authentication
- API key management
- Permission management
- Rate limiting per user

### Phase 3: Real-time Features (v1.3)
- WebSocket API for live updates
- Upload progress indicators
- Generation completion notifications
- Collaborative features

### Phase 4: Cloud Integration (v1.4)
- S3-compatible storage support
- Local + cloud hybrid sync
- CDN integration

### Phase 5: Mobile App (v1.5)
- React Native iOS/Android apps
- Offline support with local caching
- Push notifications

---

## 🔧 Development Workflow

### Development Mode

```bash
npm run dev
```

- Frontend: http://localhost:5173 (Vite dev server)
- Backend: http://localhost:1566 (tsx watch mode)
- Hot reload support

### Production Build

```bash
npm run build:full
```

1. Frontend + Backend integrated build
2. Dependency bundling
3. SEA executable creation

### Testing

```bash
# Test integrated build
npm run build:integrated
cd backend
node dist/index.js

# Test SEA executable
cd pkg-output
./comfyui-image-manager.exe
```

---

## 📚 Related Documentation

- [API Documentation](api.md) - Complete API reference
- [Features Guide](../user/features.md) - WD Tagger, video features
- [Deployment Guide](../user/deployment.md) - Deployment options
- [FFmpeg Guide](ffmpeg.md) - FFmpeg setup and bundling
- [Setup Guide](../../SETUP.md) - Initial setup
- [Development Guide](../../CLAUDE.md) - Development environment

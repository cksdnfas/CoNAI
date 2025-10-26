# ComfyUI Image Manager

A powerful, self-hosted AI image management solution designed for AI art creators and ComfyUI users.

## Key Features

### 🎨 **Smart AI Metadata Management**
- Automatically extracts and preserves metadata from ComfyUI, NovelAI, and Stable Diffusion images
- Full prompt history tracking with positive/negative prompt separation
- Advanced prompt analysis with synonym grouping and statistical insights

### 🔍 **Intelligent Search & Organization**
- Powerful search across prompts, models, and metadata
- Auto-collection system that automatically groups images based on configurable rules
- Flexible tagging and manual grouping for custom organization

### ⚡ **Optimized Performance**
- Automatic image optimization (WebP conversion, thumbnail generation)
- Fast SQLite-based database with efficient indexing
- Responsive web interface for smooth browsing experience

### 📊 **Prompt Collection & Analysis**
- Collect and analyze all prompts from your AI-generated images
- View prompt usage statistics and popularity
- Synonym management for consistent prompt organization
- Export prompt collections for reuse

### 🖼️ **Comprehensive Image Processing**
- Support for multiple image formats (PNG, JPG, WebP)
- Video frame extraction (with FFmpeg integration)
- WD14 Tagger integration for automatic image tagging
- Batch operations for efficient workflow

### 🔒 **Privacy-Focused**
- 100% self-hosted - your images never leave your machine
- No cloud dependencies or external services
- Complete control over your data

## Perfect For

- ComfyUI users managing large image collections
- AI artists tracking prompt experiments and variations
- Creators building prompt libraries and workflows
- Anyone needing organized AI image management

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Node.js + Express + TypeScript
- **Database**: SQLite (lightweight, portable)
- **Image Processing**: Sharp + FFmpeg

## Getting Started

Visit the [GitHub repository](https://github.com/your-repo) for installation instructions and documentation.

---

**License**: MIT
**Platform**: Windows, Linux, macOS
**Requirements**: Node.js 18+, FFmpeg (optional for video processing)

# WD v3 Tagger Python Module

This module provides image tagging functionality using WD (Waifu Diffusion) v3 models.

## Installation

### 1. Install Python Dependencies

```bash
pip install -r requirements.txt
```

### 2. Model Download

Models are automatically downloaded from Hugging Face Hub on first use:

- **vit**: SmilingWolf/wd-vit-tagger-v3 (default)
- **swinv2**: SmilingWolf/wd-swinv2-tagger-v3
- **convnext**: SmilingWolf/wd-convnext-tagger-v3

Models are cached in the `models/` directory at the application root.

## Usage

### Command Line

```bash
python wdv3_tagger.py <image_path> [model] [gen_threshold] [char_threshold] [cache_dir]
```

**Example:**
```bash
python wdv3_tagger.py image.png vit 0.35 0.75 ../models
```

### From Node.js

The service is integrated via `imageTaggerService.ts` using child process:

```typescript
import { imageTaggerService } from '../services/imageTaggerService';

const result = await imageTaggerService.tagImage('/path/to/image.png');
```

## Output Format

```json
{
  "success": true,
  "caption": "1girl, solo, long hair, ...",
  "taglist": "1girl, solo, long hair, ...",
  "rating": {
    "general": 0.95,
    "sensitive": 0.03,
    "questionable": 0.01,
    "explicit": 0.01
  },
  "general": {
    "1girl": 0.98,
    "solo": 0.95,
    "long_hair": 0.89
  },
  "character": {
    "hatsune_miku": 0.85
  },
  "model": "vit",
  "thresholds": {
    "general": 0.35,
    "character": 0.75
  }
}
```

## Configuration

Environment variables in `.env`:

- `TAGGER_MODEL`: Model type (vit, swinv2, convnext)
- `TAGGER_GEN_THRESHOLD`: General tags threshold (0.0-1.0, default: 0.35)
- `TAGGER_CHAR_THRESHOLD`: Character tags threshold (0.0-1.0, default: 0.75)
- `PYTHON_PATH`: Python executable path (default: python)

## GPU Support

The tagger automatically uses CUDA if available for faster processing. CPU mode is used as fallback.

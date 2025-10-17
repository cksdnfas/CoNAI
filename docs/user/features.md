# Features Guide

Complete guide for ComfyUI Image Manager features including WD v3 Tagger AI and video thumbnail generation.

[한국어](#한국어) | [English](#english)

---

## 한국어

### 🎯 주요 기능

#### 1. AI 이미지 메타데이터 추출
- ComfyUI, Stable Diffusion, NovelAI 등 AI 도구 메타데이터 자동 추출
- 프롬프트, 모델, 생성 설정 자동 기록
- 검색 및 필터링 가능

#### 2. WD v3 Tagger AI 태깅
- 이미지에서 자동으로 태그 추출
- Rating, General, Character 태그 인식
- 커스터마이징 가능한 임계값

#### 3. 동영상 처리
- 자동 애니메이션 썸네일 생성
- 메타데이터 추출 (duration, fps, codec 등)
- WebP 포맷으로 최적화

#### 4. 스마트 그룹핑
- 자동 수집 규칙으로 이미지 분류
- 프롬프트, 모델, AI 도구 기반 분류
- Regex 및 문자열 매칭 지원

#### 5. 프롬프트 분석
- 자주 사용하는 프롬프트 통계
- 동의어 관리 및 병합
- Positive/Negative 프롬프트 분리

---

## WD v3 Tagger AI 태깅

### 📋 설치 및 설정

#### 1. Python 의존성 설치

```bash
# 개발 환경
cd backend/python
pip install -r requirements.txt

# Portable 배포
cd app/python
pip install -r requirements.txt
```

**필요한 패키지:**
- `torch` (PyTorch 2.0+)
- `timm` (PyTorch Image Models)
- `huggingface_hub` (모델 다운로드)
- `pillow`, `pandas`, `numpy`

#### 2. 환경 변수 설정

`.env` 파일:

```env
# WD v3 Tagger 설정
TAGGER_ENABLED=true
TAGGER_MODEL=vit                 # vit, swinv2, convnext
TAGGER_GEN_THRESHOLD=0.35       # General 태그 임계값 (0.0-1.0)
TAGGER_CHAR_THRESHOLD=0.75      # Character 태그 임계값 (0.0-1.0)
PYTHON_PATH=python              # Linux/Mac: python3
```

#### 3. 모델 자동 다운로드

첫 실행 시 Hugging Face에서 자동 다운로드:
- 저장 위치: `{프로젝트}/models/`
- 모델 크기: 600MB~1GB

### 🚀 API 사용법

#### Python 의존성 확인

```bash
GET /api/images/tagger/check
```

**응답:**
```json
{
  "success": true,
  "data": {
    "dependencies": {
      "available": true,
      "message": "All Python dependencies are available"
    },
    "model_info": {
      "model": "vit",
      "thresholds": {
        "general": 0.35,
        "character": 0.75
      }
    }
  }
}
```

#### 단일 이미지 태깅

```bash
POST /api/images/:id/tag
```

**응답:**
```json
{
  "success": true,
  "data": {
    "image_id": 123,
    "auto_tags": {
      "caption": "1girl, solo, long hair, blue eyes, ...",
      "taglist": "1girl, solo, long hair, blue eyes, ...",
      "rating": {
        "general": 0.95,
        "sensitive": 0.03,
        "questionable": 0.01,
        "explicit": 0.01
      },
      "general": {
        "1girl": 0.98,
        "solo": 0.95,
        "long_hair": 0.89,
        "blue_eyes": 0.82
      },
      "character": {
        "hatsune_miku": 0.85
      },
      "model": "vit",
      "tagged_at": "2025-01-15T10:30:00.000Z"
    }
  }
}
```

#### 일괄 이미지 태깅

```bash
POST /api/images/batch-tag
Content-Type: application/json

{
  "image_ids": [1, 2, 3, 4, 5]
}
```

### 🎨 모델 선택

**ViT (Vision Transformer) - 기본값:**
- 속도: 빠름
- 정확도: 높음
- 권장: 일반적인 사용

**SwinV2 (Swin Transformer V2):**
- 속도: 보통
- 정확도: 매우 높음
- 권장: 높은 정확도 필요 시

**ConvNeXt:**
- 속도: 빠름
- 정확도: 높음
- 권장: 빠른 처리 필요 시

### ⚙️ 임계값 조정

**General Threshold (기본값: 0.35):**
- 낮을수록: 더 많은 태그 (노이즈 증가)
- 높을수록: 더 정확한 태그 (태그 수 감소)

**Character Threshold (기본값: 0.75):**
- 낮을수록: 더 많은 캐릭터 인식 (오인식 증가)
- 높을수록: 확실한 캐릭터만 인식

### 🔧 문제 해결

#### Python 의존성 오류
```bash
cd backend/python  # 또는 app/python
pip install -r requirements.txt --force-reinstall
```

#### 모델 다운로드 실패
- 인터넷 연결 확인
- Hugging Face Hub 접근 가능 여부 확인
- 방화벽 설정 확인

#### GPU 사용 설정
```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

### 📊 성능

**처리 속도:**
- CPU: 이미지당 2-5초
- GPU (CUDA): 이미지당 0.5-1초

**메모리 사용:**
- CPU: 약 2-4GB RAM
- GPU: 약 2-4GB VRAM

---

## 동영상 처리

### 📋 기능 개요

#### 자동 애니메이션 썸네일
- WebP 애니메이션 썸네일 자동 생성
- 영상 길이에 따른 지능형 프레임 추출
- 자동 정리 및 최적화

### 🎬 처리 방식

#### 프레임 추출 전략

**1분 이하 영상:**
- 1초당 1프레임 (1 fps)
- 30초 영상 → 30프레임

**1분 초과 영상:**
- 5초당 1프레임 (0.2 fps)
- 120초 영상 → 24프레임

#### 애니메이션 썸네일
- 재생 속도: 0.5초 간격 (2 fps)
- 품질: WebP 95%
- 무한 반복
- 자동 정리: 개별 프레임 삭제

### 📁 폴더 구조

**이미지:**
```
uploads/images/YYYY-MM-DD/
├── Origin/
├── thumbnails/
└── optimized/
```

**동영상:**
```
uploads/videos/YYYY-MM-DD/
├── Origin/
│   └── video.mp4
└── optimized/
    └── video/
        └── video_animated.webp
```

### 🔧 FFmpeg 설정

#### 자동 번들링 (기본값)

Portable 빌드 시 자동으로 FFmpeg 다운로드 및 포함:
- Windows: ffmpeg.exe (약 100MB)
- Linux/Mac: ffmpeg 바이너리

#### 수동 설치

**Windows:**
1. https://ffmpeg.org/download.html 에서 다운로드
2. PATH 환경변수에 추가
3. `ffmpeg -version`으로 확인

**Linux:**
```bash
sudo apt update
sudo apt install ffmpeg
```

**macOS:**
```bash
brew install ffmpeg
```

### 📊 메타데이터

동영상 업로드 시 저장되는 정보:

```json
{
  "duration": 30.5,
  "fps": 30,
  "video_codec": "h264",
  "audio_codec": "aac",
  "bitrate": 5000,
  "metadata": {
    "frame_count": 30,
    "thumbnail_type": "animated-webp",
    "thumbnail_frame_rate": 2
  }
}
```

### 🚀 API 사용

```bash
# 동영상 업로드
POST /api/images/upload
Content-Type: multipart/form-data

file: video.mp4
```

**응답:**
```json
{
  "success": true,
  "data": {
    "id": 123,
    "filename": "2025_01_15_143030_xyz789.mp4",
    "thumbnail_url": "/uploads/videos/2025-01-15/optimized/2025_01_15_143030_xyz789/2025_01_15_143030_xyz789_animated.webp",
    "mime_type": "video/mp4",
    "width": 1920,
    "height": 1080,
    "duration": 30.5
  }
}
```

### 🔧 문제 해결

#### FFmpeg 없음 오류
```
Error: FFmpeg is not available
```

**해결:** FFmpeg 설치 (위의 수동 설치 참조)

#### 프레임 추출 실패
```
Error: No frames were extracted from the video
```

**원인:** 손상된 동영상 또는 지원하지 않는 코덱
**해결:** VLC 등으로 재인코딩

#### 애니메이션 WebP 생성 실패
```
Error: FFmpeg animated WebP creation failed
```

**원인:** FFmpeg WebP 지원 누락
**해결:** 전체 빌드 FFmpeg 설치

---

## English

### 🎯 Key Features

#### 1. AI Image Metadata Extraction
- Auto-extract metadata from ComfyUI, Stable Diffusion, NovelAI
- Automatic recording of prompts, models, generation settings
- Searchable and filterable

#### 2. WD v3 Tagger AI Tagging
- Automatic tag extraction from images
- Rating, General, Character tag recognition
- Customizable thresholds

#### 3. Video Processing
- Automatic animated thumbnail generation
- Metadata extraction (duration, fps, codec, etc.)
- WebP format optimization

#### 4. Smart Grouping
- Automatic image classification with collection rules
- Classification based on prompts, models, AI tools
- Regex and string matching support

#### 5. Prompt Analysis
- Statistics for frequently used prompts
- Synonym management and merging
- Separate positive/negative prompts

---

## WD v3 Tagger AI Tagging

### 📋 Installation and Setup

#### 1. Install Python Dependencies

```bash
# Development environment
cd backend/python
pip install -r requirements.txt

# Portable deployment
cd app/python
pip install -r requirements.txt
```

**Required packages:**
- `torch` (PyTorch 2.0+)
- `timm` (PyTorch Image Models)
- `huggingface_hub` (model download)
- `pillow`, `pandas`, `numpy`

#### 2. Environment Configuration

`.env` file:

```env
# WD v3 Tagger settings
TAGGER_ENABLED=true
TAGGER_MODEL=vit                 # vit, swinv2, convnext
TAGGER_GEN_THRESHOLD=0.35       # General tag threshold (0.0-1.0)
TAGGER_CHAR_THRESHOLD=0.75      # Character tag threshold (0.0-1.0)
PYTHON_PATH=python              # Linux/Mac: python3
```

#### 3. Automatic Model Download

First run automatically downloads from Hugging Face:
- Location: `{project}/models/`
- Model size: 600MB~1GB

### 🚀 API Usage

#### Check Python Dependencies

```bash
GET /api/images/tagger/check
```

**Response:**
```json
{
  "success": true,
  "data": {
    "dependencies": {
      "available": true,
      "message": "All Python dependencies are available"
    },
    "model_info": {
      "model": "vit",
      "thresholds": {
        "general": 0.35,
        "character": 0.75
      }
    }
  }
}
```

#### Tag Single Image

```bash
POST /api/images/:id/tag
```

**Response:**
```json
{
  "success": true,
  "data": {
    "image_id": 123,
    "auto_tags": {
      "caption": "1girl, solo, long hair, blue eyes, ...",
      "taglist": "1girl, solo, long hair, blue eyes, ...",
      "rating": {
        "general": 0.95,
        "sensitive": 0.03,
        "questionable": 0.01,
        "explicit": 0.01
      },
      "general": {
        "1girl": 0.98,
        "solo": 0.95,
        "long_hair": 0.89,
        "blue_eyes": 0.82
      },
      "character": {
        "hatsune_miku": 0.85
      },
      "model": "vit",
      "tagged_at": "2025-01-15T10:30:00.000Z"
    }
  }
}
```

#### Batch Tag Images

```bash
POST /api/images/batch-tag
Content-Type: application/json

{
  "image_ids": [1, 2, 3, 4, 5]
}
```

### 🎨 Model Selection

**ViT (Vision Transformer) - Default:**
- Speed: Fast
- Accuracy: High
- Recommended: General use

**SwinV2 (Swin Transformer V2):**
- Speed: Medium
- Accuracy: Very High
- Recommended: When high accuracy needed

**ConvNeXt:**
- Speed: Fast
- Accuracy: High
- Recommended: When fast processing needed

### ⚙️ Threshold Adjustment

**General Threshold (default: 0.35):**
- Lower: More tags (increased noise)
- Higher: More accurate tags (fewer tags)

**Character Threshold (default: 0.75):**
- Lower: More character recognition (increased false positives)
- Higher: Only confident character recognition

### 🔧 Troubleshooting

#### Python Dependency Error
```bash
cd backend/python  # or app/python
pip install -r requirements.txt --force-reinstall
```

#### Model Download Failed
- Check internet connection
- Verify Hugging Face Hub access
- Check firewall settings

#### GPU Usage Setup
```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

### 📊 Performance

**Processing Speed:**
- CPU: 2-5 seconds per image
- GPU (CUDA): 0.5-1 second per image

**Memory Usage:**
- CPU: ~2-4GB RAM
- GPU: ~2-4GB VRAM

---

## Video Processing

### 📋 Feature Overview

#### Automatic Animated Thumbnails
- Auto-generate WebP animated thumbnails
- Intelligent frame extraction based on video length
- Automatic cleanup and optimization

### 🎬 Processing Method

#### Frame Extraction Strategy

**Videos ≤1 minute:**
- 1 frame per second (1 fps)
- 30-second video → 30 frames

**Videos >1 minute:**
- 1 frame per 5 seconds (0.2 fps)
- 120-second video → 24 frames

#### Animated Thumbnail
- Playback speed: 0.5-second intervals (2 fps)
- Quality: WebP 95%
- Infinite loop
- Auto-cleanup: Individual frames deleted

### 📁 Folder Structure

**Images:**
```
uploads/images/YYYY-MM-DD/
├── Origin/
├── thumbnails/
└── optimized/
```

**Videos:**
```
uploads/videos/YYYY-MM-DD/
├── Origin/
│   └── video.mp4
└── optimized/
    └── video/
        └── video_animated.webp
```

### 🔧 FFmpeg Setup

#### Automatic Bundling (Default)

Portable builds automatically download and include FFmpeg:
- Windows: ffmpeg.exe (~100MB)
- Linux/Mac: ffmpeg binary

#### Manual Installation

**Windows:**
1. Download from https://ffmpeg.org/download.html
2. Add to PATH environment variable
3. Verify with `ffmpeg -version`

**Linux:**
```bash
sudo apt update
sudo apt install ffmpeg
```

**macOS:**
```bash
brew install ffmpeg
```

### 📊 Metadata

Information saved on video upload:

```json
{
  "duration": 30.5,
  "fps": 30,
  "video_codec": "h264",
  "audio_codec": "aac",
  "bitrate": 5000,
  "metadata": {
    "frame_count": 30,
    "thumbnail_type": "animated-webp",
    "thumbnail_frame_rate": 2
  }
}
```

### 🚀 API Usage

```bash
# Upload video
POST /api/images/upload
Content-Type: multipart/form-data

file: video.mp4
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 123,
    "filename": "2025_01_15_143030_xyz789.mp4",
    "thumbnail_url": "/uploads/videos/2025-01-15/optimized/2025_01_15_143030_xyz789/2025_01_15_143030_xyz789_animated.webp",
    "mime_type": "video/mp4",
    "width": 1920,
    "height": 1080,
    "duration": 30.5
  }
}
```

### 🔧 Troubleshooting

#### FFmpeg Not Available Error
```
Error: FFmpeg is not available
```

**Solution:** Install FFmpeg (see manual installation above)

#### Frame Extraction Failed
```
Error: No frames were extracted from the video
```

**Cause:** Corrupted video or unsupported codec
**Solution:** Re-encode with VLC

#### Animated WebP Creation Failed
```
Error: FFmpeg animated WebP creation failed
```

**Cause:** FFmpeg missing WebP support
**Solution:** Install full build FFmpeg

---

## 📚 Related Documentation

- [Deployment Guide](deployment.md) - Setup and configuration
- [API Documentation](../development/api.md) - Complete API reference
- [Architecture](../development/architecture.md) - System design
- [FFmpeg Guide](../development/ffmpeg.md) - FFmpeg setup and usage
- [Setup Guide](../../SETUP.md) - Initial setup

# WD v3 Tagger Integration Guide

ComfyUI Image Manager에 WD (Waifu Diffusion) v3 Tagger 기능이 통합되었습니다.

## 🎯 기능 개요

이미지에서 자동으로 태그를 추출하는 AI 기능:
- **Rating Tags**: 이미지의 안전 등급 (general, sensitive, questionable, explicit)
- **General Tags**: 일반적인 시각적 요소 (1girl, long_hair, blue_eyes 등)
- **Character Tags**: 캐릭터 이름 인식

## 📋 설치 및 설정

### 1. Python 의존성 설치

```bash
cd backend/python
pip install -r requirements.txt
```

**필요한 패키지:**
- `torch` (PyTorch 2.0+)
- `timm` (PyTorch Image Models)
- `huggingface_hub` (모델 다운로드)
- `pillow` (이미지 처리)
- `pandas`, `numpy`

### 2. 환경 변수 설정

`.env` 파일에 다음 설정 추가:

```env
# WD v3 Tagger 설정
TAGGER_ENABLED=true
TAGGER_MODEL=vit                 # 모델: vit, swinv2, convnext
TAGGER_GEN_THRESHOLD=0.35       # General 태그 임계값 (0.0-1.0)
TAGGER_CHAR_THRESHOLD=0.75      # Character 태그 임계값 (0.0-1.0)
PYTHON_PATH=python              # Python 실행 경로
```

### 3. 모델 자동 다운로드

첫 실행 시 Hugging Face Hub에서 모델이 자동으로 다운로드됩니다:
- 저장 위치: `{프로젝트루트}/models/`
- 모델 크기: 약 600MB~1GB (모델 타입에 따라 다름)

## 🚀 API 사용법

### 1. Python 의존성 확인

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
    },
    "models_dir": "D:\\_Dev\\Comfyui_Image_Manager_2\\models"
  }
}
```

### 2. 단일 이미지 태깅

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
      "thresholds": {
        "general": 0.35,
        "character": 0.75
      },
      "tagged_at": "2025-01-15T10:30:00.000Z"
    }
  }
}
```

### 3. 일괄 이미지 태깅

```bash
POST /api/images/batch-tag
Content-Type: application/json

{
  "image_ids": [1, 2, 3, 4, 5]
}
```

**응답:**
```json
{
  "success": true,
  "data": {
    "total": 5,
    "success_count": 4,
    "fail_count": 1,
    "results": [
      {
        "image_id": 1,
        "success": true,
        "auto_tags": { ... }
      },
      {
        "image_id": 2,
        "success": false,
        "error": "Image file not found"
      }
    ]
  }
}
```

### 4. 이미지 조회 (태그 포함)

```bash
GET /api/images/:id
```

응답의 `auto_tags` 필드에 태깅 정보가 포함됩니다.

## 🎨 모델 선택

### ViT (Vision Transformer) - 기본값
- **속도**: 빠름
- **정확도**: 높음
- **권장**: 일반적인 사용

### SwinV2 (Swin Transformer V2)
- **속도**: 보통
- **정확도**: 매우 높음
- **권장**: 높은 정확도가 필요한 경우

### ConvNeXt
- **속도**: 빠름
- **정확도**: 높음
- **권장**: 빠른 처리가 필요한 경우

## ⚙️ 임계값 조정

### General Threshold (기본값: 0.35)
- **낮을수록**: 더 많은 태그 추출 (노이즈 증가 가능)
- **높을수록**: 더 정확한 태그만 추출 (태그 수 감소)

### Character Threshold (기본값: 0.75)
- **낮을수록**: 더 많은 캐릭터 인식 (오인식 증가 가능)
- **높을수록**: 확실한 캐릭터만 인식

## 🔧 문제 해결

### Python 의존성 오류
```bash
# 모든 패키지 재설치
cd backend/python
pip install -r requirements.txt --force-reinstall
```

### 모델 다운로드 실패
- 인터넷 연결 확인
- Hugging Face Hub 접근 가능 여부 확인
- 방화벽 설정 확인

### GPU 사용 설정
- CUDA 지원 PyTorch 설치 필요:
```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

### 타임아웃 오류
`.env`에서 타임아웃 시간 조정 (기본값: 120초):
```typescript
// backend/src/services/imageTaggerService.ts
timeout: 180000  // 3분으로 증가
```

## 📊 성능

### 처리 속도 (예상)
- **CPU**: 이미지당 2-5초
- **GPU (CUDA)**: 이미지당 0.5-1초

### 메모리 사용
- **CPU**: 약 2-4GB RAM
- **GPU**: 약 2-4GB VRAM

## 🔐 보안 고려사항

- Python 스크립트는 Child Process로 격리 실행
- 사용자 입력 경로는 검증 후 사용
- 타임아웃 설정으로 무한 대기 방지

## 📝 데이터베이스 스키마

```sql
ALTER TABLE images ADD COLUMN auto_tags TEXT;
```

**auto_tags JSON 구조:**
```json
{
  "caption": "comma-separated tags",
  "taglist": "space-separated tags",
  "rating": { "general": 0.95, ... },
  "general": { "1girl": 0.98, ... },
  "character": { "hatsune_miku": 0.85 },
  "model": "vit",
  "thresholds": { "general": 0.35, "character": 0.75 },
  "tagged_at": "2025-01-15T10:30:00.000Z"
}
```

## 🎯 향후 개선 사항

- [ ] 업로드 시 자동 태깅 옵션 추가
- [ ] 태그 기반 검색 기능
- [ ] 태그 통계 및 분석
- [ ] 커스텀 모델 지원
- [ ] 배치 처리 병렬화
- [ ] 웹 UI 통합

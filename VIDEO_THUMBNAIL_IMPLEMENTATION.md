# 동영상 애니메이션 썸네일 구현 완료

## 📋 구현 개요

동영상 업로드 시 자동으로 애니메이션 WebP 썸네일을 생성하는 기능이 구현되었습니다.

## 🎯 핵심 기능

### 1. 폴더 구조 분리
- **이미지**: `uploads/images/YYYY-MM-DD/Origin|thumbnails|optimized/`
- **동영상**: `uploads/videos/YYYY-MM-DD/Origin|optimized/{video-filename}/`

### 2. 지능형 프레임 추출
- **1분 이하 영상**: 1초당 1장 (1 fps)
- **1분 초과 영상**: 5초당 1장 (0.2 fps)
- **형식**: WebP 95% 품질, 원본 크기 유지

### 3. 애니메이션 썸네일 생성
- **재생 속도**: 0.5초 간격 (2 fps)
- **품질**: WebP 95%
- **무한 반복**: loop=0
- **자동 정리**: 개별 프레임 이미지 삭제, 애니메이션 WebP만 보관

## 🔧 구현 세부사항

### ImageProcessor 변경사항
**파일**: `backend/src/services/imageProcessor.ts`

```typescript
// 변경 전: uploads/YYYY-MM-DD/
// 변경 후: uploads/images/YYYY-MM-DD/
static async createUploadFolders(baseUploadPath: string): Promise<{...}>
```

**주요 변경**:
- 이미지 전용 `images` 서브폴더 사용
- 기존 폴더 구조 유지 (Origin, thumbnails, optimized)

### VideoProcessor 변경사항
**파일**: `backend/src/services/videoProcessor.ts`

#### 1. 메타데이터 인터페이스 확장
```typescript
export interface VideoMetadata {
  // ... 기존 필드들
  frame_count?: number;           // 추출된 프레임 수
  thumbnail_type?: string;        // 'animated-webp'
  thumbnail_frame_rate?: number;  // 2 fps (0.5초 간격)
}
```

#### 2. 폴더 구조 변경
```typescript
// 변경 전: uploads/YYYY-MM-DD/
// 변경 후: uploads/videos/YYYY-MM-DD/Origin|optimized/{video-filename}/
static async createUploadFolders(
  baseUploadPath: string,
  videoFilename: string
): Promise<{...}>
```

#### 3. 새로운 메서드 추가

**extractFrames()**: 동영상에서 프레임 추출
```typescript
static async extractFrames(
  videoPath: string,
  outputFolder: string,
  duration: number
): Promise<string[]>
```
- Duration 기반 fps 자동 결정
- FFmpeg fps 필터 사용
- WebP 형식으로 프레임 저장

**createAnimatedWebP()**: 애니메이션 WebP 생성
```typescript
static async createAnimatedWebP(
  frameFiles: string[],
  outputPath: string,
  quality: number = 95
): Promise<void>
```
- FFmpeg로 애니메이션 WebP 생성
- 2 fps (0.5초 간격) 재생
- 무한 반복 (loop=0)

#### 4. processVideo() 워크플로우 개선
```typescript
1. 고유 파일명 생성
2. 폴더 구조 생성 (동영상명 기반 서브폴더)
3. 원본 파일 저장
4. 메타데이터 추출
5. 프레임 추출 (duration 기반)
6. 애니메이션 WebP 생성
7. 개별 프레임 삭제
8. 메타데이터 업데이트 (frame_count, thumbnail_type 등)
```

### upload.routes.ts 호환성
**파일**: `backend/src/routes/images/upload.routes.ts`

- 기존 코드 수정 없이 작동
- `VideoProcessor.processVideo()`가 모든 처리 담당
- 메타데이터 자동으로 DB에 저장

## 📁 파일 구조 예시

### 이미지 업로드
```
uploads/
└── images/
    └── 2025-01-15/
        ├── Origin/
        │   └── 2025_01_15_143020_abc123.png
        ├── thumbnails/
        │   └── 2025_01_15_143020_abc123.webp
        └── optimized/
            └── 2025_01_15_143020_abc123_opt.webp
```

### 동영상 업로드
```
uploads/
└── videos/
    └── 2025-01-15/
        ├── Origin/
        │   └── 2025_01_15_143030_xyz789.mp4
        └── optimized/
            └── 2025_01_15_143030_xyz789/
                └── 2025_01_15_143030_xyz789_animated.webp
```

## 🎬 처리 흐름

### 짧은 영상 (≤60초)
```
1. 업로드: sample_short.mp4 (30초)
2. 프레임 추출: 30장 (1초당 1장)
3. 애니메이션 생성: 30프레임 × 0.5초 = 15초 재생
4. 정리: frame_0001.webp ~ frame_0030.webp 삭제
5. 최종: sample_short_animated.webp 보관
```

### 긴 영상 (>60초)
```
1. 업로드: sample_long.mp4 (120초)
2. 프레임 추출: 24장 (5초당 1장)
3. 애니메이션 생성: 24프레임 × 0.5초 = 12초 재생
4. 정리: frame_0001.webp ~ frame_0024.webp 삭제
5. 최종: sample_long_animated.webp 보관
```

## 🔍 데이터베이스 저장

### ImageRecord 테이블
```typescript
{
  // ... 기본 필드들

  // 동영상 전용 메타데이터
  duration: 30.5,                    // 초
  fps: 30,                           // 원본 프레임레이트
  video_codec: 'h264',
  audio_codec: 'aac',
  bitrate: 5000,                     // kbps

  // 확장 메타데이터 (JSON)
  metadata: {
    frame_count: 30,
    thumbnail_type: 'animated-webp',
    thumbnail_frame_rate: 2
  }
}
```

## ✅ 테스트 체크리스트

### 기능 테스트
- [ ] 1분 이하 동영상 업로드 (예: 30초 mp4)
- [ ] 1분 초과 동영상 업로드 (예: 2분 mp4)
- [ ] 애니메이션 WebP 재생 확인 (브라우저)
- [ ] 프레임 개수 확인 (짧은 영상: ~duration초, 긴 영상: ~duration/5초)
- [ ] 임시 프레임 파일 삭제 확인
- [ ] 폴더 구조 확인 (videos/YYYY-MM-DD/...)

### 성능 테스트
- [ ] 대용량 동영상 (>100MB) 업로드
- [ ] 장시간 동영상 (>10분) 처리
- [ ] 동시 다중 업로드

### 에러 처리
- [ ] FFmpeg 미설치 상태 에러 메시지
- [ ] 손상된 동영상 파일 업로드
- [ ] 처리 중 중단 시 폴더 정리

### 호환성 테스트
- [ ] 기존 이미지 업로드 정상 작동
- [ ] 다중 이미지 업로드 정상 작동
- [ ] SSE 스트리밍 업로드 정상 작동

## 🚀 사용 방법

### 서버 시작
```bash
# FFmpeg 설치 확인
ffmpeg -version

# 백엔드 개발 서버 시작
npm run dev:backend
```

### API 호출
```bash
# 동영상 업로드
curl -X POST http://localhost:1566/api/images/upload \
  -F "file=@sample.mp4"

# 응답 예시
{
  "success": true,
  "data": {
    "id": 123,
    "filename": "2025_01_15_143030_xyz789.mp4",
    "thumbnail_url": "/uploads/videos/2025-01-15/optimized/2025_01_15_143030_xyz789/2025_01_15_143030_xyz789_animated.webp",
    "mime_type": "video/mp4",
    "width": 1920,
    "height": 1080,
    "upload_date": "2025-01-15T14:30:30.000Z"
  }
}
```

## 🛠️ 트러블슈팅

### FFmpeg 관련 오류
```
Error: FFmpeg is not available
```
**해결**: [FFMPEG_SETUP.md](./FFMPEG_SETUP.md) 참조하여 FFmpeg 설치

### 프레임 추출 실패
```
Error: No frames were extracted from the video
```
**원인**: 손상된 동영상 또는 지원하지 않는 코덱
**해결**: VLC 등으로 동영상 재인코딩

### 애니메이션 WebP 생성 실패
```
Error: FFmpeg animated WebP creation failed
```
**원인**: FFmpeg WebP 지원 누락
**해결**: 전체 빌드 FFmpeg 설치 (libwebp 포함)

## 📊 성능 최적화

### 현재 설정
- **프레임 추출**: WebP 95% 품질, compression_level=4
- **애니메이션**: 2 fps, loop=0
- **병렬 처리**: 프레임 삭제는 Promise.all로 병렬 처리

### 추가 최적화 가능 영역
- 프레임 추출과 애니메이션 생성 파이프라인화
- 대용량 동영상은 프레임 수 제한 (예: 최대 120프레임)
- 해상도 다운샘플링 옵션 추가

## 🔮 향후 개선사항

### 단기 (백엔드)
- [ ] 썸네일 생성 진행도 SSE 이벤트 추가
- [ ] 동영상 최적화 버전 생성 (optimizedPath 활용)
- [ ] 커스텀 썸네일 설정 (프레임 수, 재생 속도)

### 장기 (프론트엔드 통합)
- [ ] 동영상 플레이어 컴포넌트
- [ ] 애니메이션 썸네일 hover 미리보기
- [ ] 동영상 필터링 및 검색
- [ ] 동영상 편집 기능 (트림, 자르기)

## 📝 관련 파일

- `backend/src/services/videoProcessor.ts` - 동영상 처리 로직
- `backend/src/services/imageProcessor.ts` - 이미지 처리 로직
- `backend/src/routes/images/upload.routes.ts` - 업로드 API
- `backend/src/types/image.ts` - 타입 정의
- `FFMPEG_SETUP.md` - FFmpeg 설치 가이드

## 🎉 완료!

동영상 애니메이션 썸네일 생성 기능이 성공적으로 구현되었습니다. 백엔드 작업이 완료되었으므로 프론트엔드 통합 작업을 진행할 수 있습니다.

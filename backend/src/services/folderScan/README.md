# FolderScan Service - 모듈식 아키텍처

## 개요
원본 968줄의 `folderScanService.ts`를 6개의 독립 서비스로 분리한 모듈식 리팩토링.
각 서비스는 단일 책임 원칙(SRP)을 준수하며, Facade 패턴으로 통합됨.

## 서비스 구조

```
folderScan/
├── types.ts                    (공유 타입)
├── fileDiscoveryService.ts     (파일 검색)
├── fastRegistrationService.ts  (Phase 1: 빠른 등록)
├── hashGenerationService.ts    (Phase 2: 해시 생성)
├── thumbnailGenerationService.ts (썸네일 생성)
├── scanProgressTracker.ts      (진행률 추적)
├── duplicateDetectionService.ts (중복 감지)
├── index.ts                    (Facade 통합)
└── README.md                   (이 파일)
```

## 각 서비스 설명

### types.ts (528 bytes)
공유 타입 정의:
- `ScanResult`: 스캔 결과 인터페이스
- `ProcessedFileData`: 처리된 파일 데이터

### fileDiscoveryService.ts (2.9K)
**책임**: 파일 검색 및 수집

주요 메서드:
- `collectFiles()`: fast-glob을 사용한 병렬 파일 검색
- `getMimeType()`: 파일 확장자 기반 MIME 타입 추정

### fastRegistrationService.ts (4.3K)
**책임**: Phase 1 빠른 등록 처리

주요 메서드:
- `processFastRegistration()`: 기본 정보만 수집하여 DB에 빠르게 등록
- `determineFileType()`: 파일 타입 결정 (image/video/animated)
- `formatETA()`: 예상 완료 시간 계산

특징:
- composite_hash를 NULL로 설정하여 즉시 등록 가능
- 메타데이터 추출은 Phase 2에서 처리
- p-limit을 사용한 동시성 제어 (CPU 코어 * 4)

### hashGenerationService.ts (929 bytes)
**책임**: Phase 2 해시 생성

주요 메서드:
- `generateHashAndHistogram()`: 해시 및 히스토그램 생성
- `generateCompositeHash()`: Composite 해시만 생성
- `generateColorHistogram()`: 색상 히스토그램 생성
- `serializeHistogram()`: 히스토그램 직렬화

**역할**: ImageSimilarityService의 래퍼로 백그라운드 작업에서 호출됨

### thumbnailGenerationService.ts (714 bytes)
**책임**: 썸네일 생성

주요 메서드:
- `generateThumbnail()`: Sharp를 사용하여 1080px WebP 썸네일 생성

특징:
- 비디오 파일은 스킵 (원본 사용)
- 이미지만 처리하여 저장

### scanProgressTracker.ts (1.3K)
**책임**: 진행률 추적 및 ETA 계산

주요 메서드:
- `formatETA()`: 초 단위를 사람이 읽기 좋은 형식으로 변환
- `calculateProgress()`: 처리 속도, ETA, 완료율 계산

### duplicateDetectionService.ts (1.8K)
**책임**: 중복 이미지 감지 및 파일 상태 관리

주요 메서드:
- `checkExistingHashes()`: Bulk 쿼리로 기존 해시 검색 (SQLite 999 파라미터 제한 처리)
- `getExistingFileByPath()`: 경로로 기존 파일 확인
- `updateFileStatus()`: 재발견된 파일 상태 업데이트

### index.ts (11K - Facade)
**책임**: 모든 하위 서비스 통합 및 조정

주요 메서드:
- `scanFolder()`: 메인 스캔 실행
- `scanAllFolders()`: 모든 활성 폴더 스캔
- `runAutoScan()`: 자동 스캔 (워처 상태 확인)
- `getScanLogs()`: 스캔 로그 조회
- `getRecentScanLogs()`: 최근 스캔 로그

특징:
- 기존 FolderScanService의 공개 인터페이스 완벽 호환성 유지
- 하위 서비스들을 조율하는 오케스트레이터 역할
- 에러 처리 및 로깅 중앙화

## 호환성

### 기존 코드와의 호환성
- `backend/src/services/folderScanService.ts`: 새로운 `folderScan/index.ts`를 re-export
- 기존 import 경로 변경 불필요
- 모든 공개 메서드 시그니처 유지

### 마이그레이션 경로
```typescript
// 기존 (변경 불필요)
import { FolderScanService } from './services/folderScanService';

// 새로운 세분화된 서비스 직접 사용 가능
import { FileDiscoveryService } from './services/folderScan/fileDiscoveryService';
import { FastRegistrationService } from './services/folderScan/fastRegistrationService';
```

## 성능 특성

### 시간 복잡도
- Phase 1 (빠른 등록): O(n) - n은 파일 수
  - 동시성: CPU 코어 * 4 (I/O 바운드 작업)
  - 배치 크기: 동적 (CPU 코어 수 기반)

### 공간 복잡도
- 메모리 효율: 배치 처리로 메모리 사용량 제한
- 진행률 로그: 50개마다 출력

### 주요 최적화
1. p-limit으로 동시성 제어
2. fast-glob으로 병렬 파일 검색
3. SQLite 999 파라미터 제한 처리
4. Phase 1/2 분리로 초기 응답성 향상

## 테스트 가이드

```typescript
// 기본 폴더 스캔
const result = await FolderScanService.scanFolder(folderId);

// 특정 서비스 독립 테스트
const files = await FileDiscoveryService.collectFiles('/path/to/folder', {
  recursive: true,
  excludeExtensions: [],
  excludePatterns: null
});

// 진행률 추적
const progress = ScanProgressTracker.calculateProgress(
  processed,
  total,
  startTime
);
```

## 향후 개선

1. **캐싱**: 반복되는 파일 검색 결과 캐싱
2. **병렬화**: 여러 폴더를 동시에 스캔
3. **모니터링**: 스캔 성능 메트릭 수집
4. **타입 안정성**: 더 명확한 타입 정의

## 참고

- 원본 파일: `folderScanService.ts.backup`
- 모듈 분리 기준: 단일 책임 원칙 (SRP)
- 통합 패턴: Facade 패턴

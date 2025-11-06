/**
 * FolderScanService - 호환성 래퍼
 * 새로운 모듈식 아키텍처로의 마이그레이션
 *
 * folderScan/ 디렉토리의 독립 서비스들로 분리됨:
 * - fileDiscoveryService.ts: 파일 검색
 * - fastRegistrationService.ts: Phase 1 빠른 등록
 * - hashGenerationService.ts: Phase 2 해시 생성
 * - thumbnailGenerationService.ts: 썸네일 생성
 * - scanProgressTracker.ts: 진행률 추적
 * - duplicateDetectionService.ts: 중복 감지
 * - index.ts: Facade 통합
 */

// 새로운 구조에서 모든 것을 import
export {
  FolderScanService,
  FileDiscoveryService,
  FastRegistrationService,
  HashGenerationService,
  ThumbnailGenerationService,
  ScanProgressTracker,
  DuplicateDetectionService,
  ScanResult,
  ProcessedFileData
} from './folderScan/index';

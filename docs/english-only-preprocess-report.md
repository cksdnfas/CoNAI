# English-only Language Preprocess Report

Generated: 2026-04-30T02:03:43.446Z

## Summary

- Findings: 1063
- Files with findings: 73
- Unique normalized messages: 797
- Reusable exact groups: 130
- Similar groups: 141

## By Area

- backend: 1061
- shared: 2

## By Exposure / Priority

- p2-catalog-seed-candidate: 311
- p2-backend-runtime-candidate: 261
- p1-api-response-candidate: 259
- p4-dev-internal: 138
- p3-operational-log: 67
- p3-backend-internal-unknown: 25
- p1-shared-runtime: 2

## By Feature / Module

- backend/database: 414
- backend/services: 310
- backend/routes: 259
- backend/scripts: 46
- backend/utils: 29
- backend/index.ts: 3
- shared/types: 2

## Top Files

- backend/src/database/userSettingsBuiltinModules.ts: 311
- backend/src/routes/moduleDefinitions.ts: 122
- backend/src/services/fileWatcherService.ts: 48
- backend/src/routes/watchedFolders.ts: 44
- backend/src/routes/graph-workflows/schedule-routes.ts: 34
- backend/src/database/migrations/000_create_all_tables.ts: 32
- backend/src/scripts/resetDatabase.ts: 26
- backend/src/database/migrationManager.ts: 23
- backend/src/services/folderScan/index.ts: 23
- backend/src/services/thumbnailRegenerationService.ts: 22
- backend/src/services/backgroundQueue.ts: 21
- backend/src/scripts/cleanupFileSystem.ts: 20
- backend/src/database/migrations/003_create_civitai_tables.ts: 19
- backend/src/services/fileVerificationService.ts: 19
- backend/src/utils/versionCheck.ts: 18
- backend/src/database/migrations/001_create_auto_folder_groups.ts: 13
- backend/src/services/backupSourceService.ts: 13
- backend/src/routes/backupSources.ts: 12
- backend/src/routes/settings.ts: 11
- backend/src/services/watchedFolderService.ts: 11
- backend/src/services/autoScanScheduler.ts: 10
- backend/src/database/migrations/004_add_model_references_column.ts: 9
- backend/src/services/folderScan/fileDiscoveryService.ts: 9
- backend/src/services/kaloscopeTaggerService.ts: 9
- backend/src/services/llmProviderService.ts: 9

## Reusable Exact Groups

### 텍스트
- Count: 18
- Variants: 텍스트
- Exposure: p2-catalog-seed-candidate 16, p1-api-response-candidate 2
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:139 [string-literal/p2-catalog-seed-candidate] 텍스트
  - backend/src/database/userSettingsBuiltinModules.ts:149 [string-literal/p2-catalog-seed-candidate] 텍스트
  - backend/src/database/userSettingsBuiltinModules.ts:160 [string-literal/p2-catalog-seed-candidate] 텍스트
  - backend/src/database/userSettingsBuiltinModules.ts:166 [string-literal/p2-catalog-seed-candidate] 텍스트
  - backend/src/database/userSettingsBuiltinModules.ts:176 [string-literal/p2-catalog-seed-candidate] 텍스트

### 이미지
- Count: 15
- Variants: 이미지
- Exposure: p2-catalog-seed-candidate 13, p1-api-response-candidate 2
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:243 [string-literal/p2-catalog-seed-candidate] 이미지
  - backend/src/database/userSettingsBuiltinModules.ts:249 [string-literal/p2-catalog-seed-candidate] 이미지
  - backend/src/database/userSettingsBuiltinModules.ts:259 [string-literal/p2-catalog-seed-candidate] 이미지
  - backend/src/database/userSettingsBuiltinModules.ts:498 [string-literal/p2-catalog-seed-candidate] 이미지
  - backend/src/database/userSettingsBuiltinModules.ts:609 [string-literal/p2-catalog-seed-candidate] 이미지

### 프롬프트
- Count: 11
- Variants: 프롬프트
- Exposure: p2-catalog-seed-candidate 8, p1-api-response-candidate 2, p2-backend-runtime-candidate 1
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:471 [string-literal/p2-catalog-seed-candidate] 프롬프트
  - backend/src/database/userSettingsBuiltinModules.ts:591 [string-literal/p2-catalog-seed-candidate] 프롬프트
  - backend/src/database/userSettingsBuiltinModules.ts:740 [string-literal/p2-catalog-seed-candidate] 프롬프트
  - backend/src/database/userSettingsBuiltinModules.ts:892 [string-literal/p2-catalog-seed-candidate] 프롬프트
  - backend/src/database/userSettingsBuiltinModules.ts:1064 [string-literal/p2-catalog-seed-candidate] 프롬프트

### 유효하지 않은 폴더 ID입니다
- Count: 9
- Variants: 유효하지 않은 폴더 ID입니다
- Exposure: p1-api-response-candidate 9
- Examples:
  - backend/src/routes/watchedFolders.ts:52 [string-literal/p1-api-response-candidate] 유효하지 않은 폴더 ID입니다
  - backend/src/routes/watchedFolders.ts:177 [string-literal/p1-api-response-candidate] 유효하지 않은 폴더 ID입니다
  - backend/src/routes/watchedFolders.ts:254 [string-literal/p1-api-response-candidate] 유효하지 않은 폴더 ID입니다
  - backend/src/routes/watchedFolders.ts:275 [string-literal/p1-api-response-candidate] 유효하지 않은 폴더 ID입니다
  - backend/src/routes/watchedFolders.ts:319 [string-literal/p1-api-response-candidate] 유효하지 않은 폴더 ID입니다

### 결과
- Count: 7
- Variants: 결과
- Exposure: p2-catalog-seed-candidate 7
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:1384 [string-literal/p2-catalog-seed-candidate] 결과
  - backend/src/database/userSettingsBuiltinModules.ts:1400 [string-literal/p2-catalog-seed-candidate] 결과
  - backend/src/database/userSettingsBuiltinModules.ts:1415 [string-literal/p2-catalog-seed-candidate] 결과
  - backend/src/database/userSettingsBuiltinModules.ts:1431 [string-literal/p2-catalog-seed-candidate] 결과
  - backend/src/database/userSettingsBuiltinModules.ts:1455 [string-literal/p2-catalog-seed-candidate] 결과

### 메타데이터
- Count: 7
- Variants: 메타데이터
- Exposure: p2-catalog-seed-candidate 5, p1-api-response-candidate 2
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:568 [string-literal/p2-catalog-seed-candidate] 메타데이터
  - backend/src/database/userSettingsBuiltinModules.ts:1009 [string-literal/p2-catalog-seed-candidate] 메타데이터
  - backend/src/database/userSettingsBuiltinModules.ts:1045 [string-literal/p2-catalog-seed-candidate] 메타데이터
  - backend/src/database/userSettingsBuiltinModules.ts:1137 [string-literal/p2-catalog-seed-candidate] 메타데이터
  - backend/src/database/userSettingsBuiltinModules.ts:1247 [string-literal/p2-catalog-seed-candidate] 메타데이터

### 시스템 프롬프트
- Count: 7
- Variants: 시스템 프롬프트
- Exposure: p2-catalog-seed-candidate 4, p1-api-response-candidate 2, p2-backend-runtime-candidate 1
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:480 [string-literal/p2-catalog-seed-candidate] 시스템 프롬프트
  - backend/src/database/userSettingsBuiltinModules.ts:597 [string-literal/p2-catalog-seed-candidate] 시스템 프롬프트
  - backend/src/database/userSettingsBuiltinModules.ts:1073 [string-literal/p2-catalog-seed-candidate] 시스템 프롬프트
  - backend/src/database/userSettingsBuiltinModules.ts:1161 [string-literal/p2-catalog-seed-candidate] 시스템 프롬프트
  - backend/src/routes/moduleDefinitions.ts:46 [string-literal/p1-api-response-candidate] 시스템 프롬프트

### 모델
- Count: 6
- Variants: 모델
- Exposure: p2-catalog-seed-candidate 4, p1-api-response-candidate 2
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:516 [string-literal/p2-catalog-seed-candidate] 모델
  - backend/src/database/userSettingsBuiltinModules.ts:585 [string-literal/p2-catalog-seed-candidate] 모델
  - backend/src/database/userSettingsBuiltinModules.ts:1100 [string-literal/p2-catalog-seed-candidate] 모델
  - backend/src/database/userSettingsBuiltinModules.ts:1148 [string-literal/p2-catalog-seed-candidate] 모델
  - backend/src/routes/moduleDefinitions.ts:23 [string-literal/p1-api-response-candidate] 모델

### 인덱스
- Count: 6
- Variants: 인덱스
- Exposure: p2-catalog-seed-candidate 4, p1-api-response-candidate 2
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:880 [string-literal/p2-catalog-seed-candidate] 인덱스
  - backend/src/database/userSettingsBuiltinModules.ts:908 [string-literal/p2-catalog-seed-candidate] 인덱스
  - backend/src/database/userSettingsBuiltinModules.ts:941 [string-literal/p2-catalog-seed-candidate] 인덱스
  - backend/src/database/userSettingsBuiltinModules.ts:977 [string-literal/p2-catalog-seed-candidate] 인덱스
  - backend/src/routes/moduleDefinitions.ts:62 [string-literal/p1-api-response-candidate] 인덱스

### 컨텍스트
- Count: 6
- Variants: 컨텍스트
- Exposure: p2-catalog-seed-candidate 4, p1-api-response-candidate 2
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:489 [string-literal/p2-catalog-seed-candidate] 컨텍스트
  - backend/src/database/userSettingsBuiltinModules.ts:603 [string-literal/p2-catalog-seed-candidate] 컨텍스트
  - backend/src/database/userSettingsBuiltinModules.ts:1082 [string-literal/p2-catalog-seed-candidate] 컨텍스트
  - backend/src/database/userSettingsBuiltinModules.ts:1167 [string-literal/p2-catalog-seed-candidate] 컨텍스트
  - backend/src/routes/moduleDefinitions.ts:47 [string-literal/p1-api-response-candidate] 컨텍스트

### 컴포지트 해시
- Count: 6
- Variants: 컴포지트 해시
- Exposure: p2-catalog-seed-candidate 4, p1-api-response-candidate 2
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:871 [string-literal/p2-catalog-seed-candidate] 컴포지트 해시
  - backend/src/database/userSettingsBuiltinModules.ts:903 [string-literal/p2-catalog-seed-candidate] 컴포지트 해시
  - backend/src/database/userSettingsBuiltinModules.ts:932 [string-literal/p2-catalog-seed-candidate] 컴포지트 해시
  - backend/src/database/userSettingsBuiltinModules.ts:972 [string-literal/p2-catalog-seed-candidate] 컴포지트 해시
  - backend/src/routes/moduleDefinitions.ts:61 [string-literal/p1-api-response-candidate] 컴포지트 해시

### 폴더를 찾을 수 없습니다
- Count: 6
- Variants: 폴더를 찾을 수 없습니다
- Exposure: p1-api-response-candidate 6
- Examples:
  - backend/src/routes/watchedFolders.ts:58 [string-literal/p1-api-response-candidate] 폴더를 찾을 수 없습니다
  - backend/src/routes/watchedFolders.ts:194 [string-literal/p1-api-response-candidate] 폴더를 찾을 수 없습니다
  - backend/src/routes/watchedFolders.ts:281 [string-literal/p1-api-response-candidate] 폴더를 찾을 수 없습니다
  - backend/src/routes/watchedFolders.ts:300 [string-literal/p1-api-response-candidate] 폴더를 찾을 수 없습니다
  - backend/src/routes/watchedFolders.ts:377 [string-literal/p1-api-response-candidate] 폴더를 찾을 수 없습니다

### 값
- Count: 5
- Variants: 값
- Exposure: p2-catalog-seed-candidate 5
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:1331 [string-literal/p2-catalog-seed-candidate] 값
  - backend/src/database/userSettingsBuiltinModules.ts:1412 [string-literal/p2-catalog-seed-candidate] 값
  - backend/src/database/userSettingsBuiltinModules.ts:1475 [string-literal/p2-catalog-seed-candidate] 값
  - backend/src/database/userSettingsBuiltinModules.ts:1503 [string-literal/p2-catalog-seed-candidate] 값
  - backend/src/database/userSettingsBuiltinModules.ts:1646 [string-literal/p2-catalog-seed-candidate] 값

### 구조화 출력 JSON
- Count: 5
- Variants: 구조화 출력 JSON
- Exposure: p2-catalog-seed-candidate 4, p2-backend-runtime-candidate 1
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:525 [string-literal/p2-catalog-seed-candidate] 구조화 출력 JSON
  - backend/src/database/userSettingsBuiltinModules.ts:614 [string-literal/p2-catalog-seed-candidate] 구조화 출력 JSON
  - backend/src/database/userSettingsBuiltinModules.ts:1110 [string-literal/p2-catalog-seed-candidate] 구조화 출력 JSON
  - backend/src/database/userSettingsBuiltinModules.ts:1178 [string-literal/p2-catalog-seed-candidate] 구조화 출력 JSON
  - backend/src/services/graph-workflow-executor/system-llm-preset-operations.ts:17 [string-literal/p2-backend-runtime-candidate] 구조화 출력 JSON

### 불리언
- Count: 5
- Variants: 불리언
- Exposure: p2-catalog-seed-candidate 5
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:307 [string-literal/p2-catalog-seed-candidate] 불리언
  - backend/src/database/userSettingsBuiltinModules.ts:313 [string-literal/p2-catalog-seed-candidate] 불리언
  - backend/src/database/userSettingsBuiltinModules.ts:323 [string-literal/p2-catalog-seed-candidate] 불리언
  - backend/src/database/userSettingsBuiltinModules.ts:334 [string-literal/p2-catalog-seed-candidate] 불리언
  - backend/src/database/userSettingsBuiltinModules.ts:1572 [string-literal/p2-catalog-seed-candidate] 불리언

### 숫자
- Count: 5
- Variants: 숫자
- Exposure: p2-catalog-seed-candidate 5
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:272 [string-literal/p2-catalog-seed-candidate] 숫자
  - backend/src/database/userSettingsBuiltinModules.ts:278 [string-literal/p2-catalog-seed-candidate] 숫자
  - backend/src/database/userSettingsBuiltinModules.ts:288 [string-literal/p2-catalog-seed-candidate] 숫자
  - backend/src/database/userSettingsBuiltinModules.ts:299 [string-literal/p2-catalog-seed-candidate] 숫자
  - backend/src/database/userSettingsBuiltinModules.ts:1571 [string-literal/p2-catalog-seed-candidate] 숫자

### 이미지 참조
- Count: 5
- Variants: 이미지 참조
- Exposure: p2-catalog-seed-candidate 3, p1-api-response-candidate 2
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:961 [string-literal/p2-catalog-seed-candidate] 이미지 참조
  - backend/src/database/userSettingsBuiltinModules.ts:1001 [string-literal/p2-catalog-seed-candidate] 이미지 참조
  - backend/src/database/userSettingsBuiltinModules.ts:1239 [string-literal/p2-catalog-seed-candidate] 이미지 참조
  - backend/src/routes/moduleDefinitions.ts:63 [string-literal/p1-api-response-candidate] 이미지 참조
  - backend/src/routes/moduleDefinitions.ts:124 [string-literal/p1-api-response-candidate] 이미지 참조

### 잘못된 예약작업 ID야.
- Count: 5
- Variants: 잘못된 예약작업 ID야.
- Exposure: p1-api-response-candidate 5
- Examples:
  - backend/src/routes/graph-workflows/schedule-routes.ts:226 [string-literal/p1-api-response-candidate] 잘못된 예약작업 ID야.
  - backend/src/routes/graph-workflows/schedule-routes.ts:316 [string-literal/p1-api-response-candidate] 잘못된 예약작업 ID야.
  - backend/src/routes/graph-workflows/schedule-routes.ts:337 [string-literal/p1-api-response-candidate] 잘못된 예약작업 ID야.
  - backend/src/routes/graph-workflows/schedule-routes.ts:368 [string-literal/p1-api-response-candidate] 잘못된 예약작업 ID야.
  - backend/src/routes/graph-workflows/schedule-routes.ts:416 [string-literal/p1-api-response-candidate] 잘못된 예약작업 ID야.

### 그룹 이름
- Count: 4
- Variants: 그룹 이름
- Exposure: p1-api-response-candidate 2, p2-catalog-seed-candidate 2
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:701 [string-literal/p2-catalog-seed-candidate] 그룹 이름
  - backend/src/database/userSettingsBuiltinModules.ts:751 [string-literal/p2-catalog-seed-candidate] 그룹 이름
  - backend/src/routes/moduleDefinitions.ts:52 [string-literal/p1-api-response-candidate] 그룹 이름
  - backend/src/routes/moduleDefinitions.ts:110 [string-literal/p1-api-response-candidate] 그룹 이름

### 그룹 ID
- Count: 4
- Variants: 그룹 ID
- Exposure: p1-api-response-candidate 2, p2-catalog-seed-candidate 2
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:710 [string-literal/p2-catalog-seed-candidate] 그룹 ID
  - backend/src/database/userSettingsBuiltinModules.ts:757 [string-literal/p2-catalog-seed-candidate] 그룹 ID
  - backend/src/routes/moduleDefinitions.ts:53 [string-literal/p1-api-response-candidate] 그룹 ID
  - backend/src/routes/moduleDefinitions.ts:111 [string-literal/p1-api-response-candidate] 그룹 ID

### 네거티브 프롬프트
- Count: 4
- Variants: 네거티브 프롬프트
- Exposure: p1-api-response-candidate 2, p2-catalog-seed-candidate 2
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:1202 [string-literal/p2-catalog-seed-candidate] 네거티브 프롬프트
  - backend/src/database/userSettingsBuiltinModules.ts:1264 [string-literal/p2-catalog-seed-candidate] 네거티브 프롬프트
  - backend/src/routes/moduleDefinitions.ts:22 [string-literal/p1-api-response-candidate] 네거티브 프롬프트
  - backend/src/routes/moduleDefinitions.ts:81 [string-literal/p1-api-response-candidate] 네거티브 프롬프트

### 동작
- Count: 4
- Variants: 동작
- Exposure: p1-api-response-candidate 4
- Examples:
  - backend/src/routes/moduleDefinitions.ts:24 [string-literal/p1-api-response-candidate] 동작
  - backend/src/routes/moduleDefinitions.ts:67 [string-literal/p1-api-response-candidate] 동작
  - backend/src/routes/moduleDefinitions.ts:83 [string-literal/p1-api-response-candidate] 동작
  - backend/src/routes/moduleDefinitions.ts:128 [string-literal/p1-api-response-candidate] 동작

### 비율
- Count: 4
- Variants: 비율
- Exposure: p1-api-response-candidate 2, p2-catalog-seed-candidate 2
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:1211 [string-literal/p2-catalog-seed-candidate] 비율
  - backend/src/database/userSettingsBuiltinModules.ts:1270 [string-literal/p2-catalog-seed-candidate] 비율
  - backend/src/routes/moduleDefinitions.ts:65 [string-literal/p1-api-response-candidate] 비율
  - backend/src/routes/moduleDefinitions.ts:126 [string-literal/p1-api-response-candidate] 비율

### 시드
- Count: 4
- Variants: 시드
- Exposure: p1-api-response-candidate 2, p2-catalog-seed-candidate 2
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:729 [string-literal/p2-catalog-seed-candidate] 시드
  - backend/src/database/userSettingsBuiltinModules.ts:769 [string-literal/p2-catalog-seed-candidate] 시드
  - backend/src/routes/moduleDefinitions.ts:32 [string-literal/p1-api-response-candidate] 시드
  - backend/src/routes/moduleDefinitions.ts:91 [string-literal/p1-api-response-candidate] 시드

### 연결 이름
- Count: 4
- Variants: 연결 이름
- Exposure: p1-api-response-candidate 2, p2-catalog-seed-candidate 2
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:507 [string-literal/p2-catalog-seed-candidate] 연결 이름
  - backend/src/database/userSettingsBuiltinModules.ts:579 [string-literal/p2-catalog-seed-candidate] 연결 이름
  - backend/src/routes/moduleDefinitions.ts:48 [string-literal/p1-api-response-candidate] 연결 이름
  - backend/src/routes/moduleDefinitions.ts:104 [string-literal/p1-api-response-candidate] 연결 이름

### 온도
- Count: 4
- Variants: 온도
- Exposure: p1-api-response-candidate 2, p2-catalog-seed-candidate 2
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:534 [string-literal/p2-catalog-seed-candidate] 온도
  - backend/src/database/userSettingsBuiltinModules.ts:620 [string-literal/p2-catalog-seed-candidate] 온도
  - backend/src/routes/moduleDefinitions.ts:50 [string-literal/p1-api-response-candidate] 온도
  - backend/src/routes/moduleDefinitions.ts:106 [string-literal/p1-api-response-candidate] 온도

### 임계값
- Count: 4
- Variants: 임계값
- Exposure: p1-api-response-candidate 2, p2-catalog-seed-candidate 2
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:802 [string-literal/p2-catalog-seed-candidate] 임계값
  - backend/src/database/userSettingsBuiltinModules.ts:841 [string-literal/p2-catalog-seed-candidate] 임계값
  - backend/src/routes/moduleDefinitions.ts:57 [string-literal/p1-api-response-candidate] 임계값
  - backend/src/routes/moduleDefinitions.ts:118 [string-literal/p1-api-response-candidate] 임계값

### 참조
- Count: 4
- Variants: 참조
- Exposure: p1-api-response-candidate 2, p2-catalog-seed-candidate 2
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:862 [string-literal/p2-catalog-seed-candidate] 참조
  - backend/src/database/userSettingsBuiltinModules.ts:923 [string-literal/p2-catalog-seed-candidate] 참조
  - backend/src/routes/moduleDefinitions.ts:60 [string-literal/p1-api-response-candidate] 참조
  - backend/src/routes/moduleDefinitions.ts:121 [string-literal/p1-api-response-candidate] 참조

### 최대 토큰
- Count: 4
- Variants: 최대 토큰
- Exposure: p1-api-response-candidate 2, p2-catalog-seed-candidate 2
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:542 [string-literal/p2-catalog-seed-candidate] 최대 토큰
  - backend/src/database/userSettingsBuiltinModules.ts:625 [string-literal/p2-catalog-seed-candidate] 최대 토큰
  - backend/src/routes/moduleDefinitions.ts:51 [string-literal/p1-api-response-candidate] 최대 토큰
  - backend/src/routes/moduleDefinitions.ts:107 [string-literal/p1-api-response-candidate] 최대 토큰

### 프롬프트 포함
- Count: 4
- Variants: 프롬프트 포함
- Exposure: p1-api-response-candidate 2, p2-catalog-seed-candidate 2
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:812 [string-literal/p2-catalog-seed-candidate] 프롬프트 포함
  - backend/src/database/userSettingsBuiltinModules.ts:847 [string-literal/p2-catalog-seed-candidate] 프롬프트 포함
  - backend/src/routes/moduleDefinitions.ts:58 [string-literal/p1-api-response-candidate] 프롬프트 포함
  - backend/src/routes/moduleDefinitions.ts:119 [string-literal/p1-api-response-candidate] 프롬프트 포함

### 해상도
- Count: 4
- Variants: 해상도
- Exposure: p1-api-response-candidate 2, p2-catalog-seed-candidate 2
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:1220 [string-literal/p2-catalog-seed-candidate] 해상도
  - backend/src/database/userSettingsBuiltinModules.ts:1277 [string-literal/p2-catalog-seed-candidate] 해상도
  - backend/src/routes/moduleDefinitions.ts:66 [string-literal/p1-api-response-candidate] 해상도
  - backend/src/routes/moduleDefinitions.ts:127 [string-literal/p1-api-response-candidate] 해상도

### ✅ {value} 테이블 제거
- Count: 3
- Variants: ✅ ${table} 테이블 제거
- Exposure: p4-dev-internal 3
- Examples:
  - backend/src/database/migrations/000_create_all_tables.ts:537 [template-literal/p4-dev-internal] ✅ ${table} 테이블 제거
  - backend/src/database/migrations/001_create_auto_folder_groups.ts:95 [template-literal/p4-dev-internal] ✅ ${table} 테이블 제거
  - backend/src/database/migrations/003_create_civitai_tables.ts:162 [template-literal/p4-dev-internal] ✅ ${table} 테이블 제거

### 📊 생성된 테이블 요약:
- Count: 3
- Variants: 📊 생성된 테이블 요약:
- Exposure: p4-dev-internal 3
- Examples:
  - backend/src/database/migrations/000_create_all_tables.ts:502 [string-literal/p4-dev-internal] 📊 생성된 테이블 요약:
  - backend/src/database/migrations/001_create_auto_folder_groups.ts:78 [string-literal/p4-dev-internal] 📊 생성된 테이블 요약:
  - backend/src/database/migrations/003_create_civitai_tables.ts:142 [string-literal/p4-dev-internal] 📊 생성된 테이블 요약:

### 비디오
- Count: 3
- Variants: 비디오
- Exposure: p1-api-response-candidate 2, p2-catalog-seed-candidate 1
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:1029 [string-literal/p2-catalog-seed-candidate] 비디오
  - backend/src/routes/moduleDefinitions.ts:38 [string-literal/p1-api-response-candidate] 비디오
  - backend/src/routes/moduleDefinitions.ts:116 [string-literal/p1-api-response-candidate] 비디오

### 비디오 참조
- Count: 3
- Variants: 비디오 참조
- Exposure: p1-api-response-candidate 2, p2-catalog-seed-candidate 1
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:1037 [string-literal/p2-catalog-seed-candidate] 비디오 참조
  - backend/src/routes/moduleDefinitions.ts:64 [string-literal/p1-api-response-candidate] 비디오 참조
  - backend/src/routes/moduleDefinitions.ts:125 [string-literal/p1-api-response-candidate] 비디오 참조

### 알 수 없는 오류
- Count: 3
- Variants: 알 수 없는 오류
- Exposure: p2-backend-runtime-candidate 3
- Examples:
  - backend/src/services/fileVerificationService.ts:150 [string-literal/p2-backend-runtime-candidate] 알 수 없는 오류
  - backend/src/services/fileWatcherService.ts:357 [string-literal/p2-backend-runtime-candidate] 알 수 없는 오류
  - backend/src/services/thumbnailRegenerationService.ts:180 [string-literal/p2-backend-runtime-candidate] 알 수 없는 오류

### 작가 텍스트
- Count: 3
- Variants: 작가 텍스트
- Exposure: p1-api-response-candidate 2, p2-catalog-seed-candidate 1
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:1730 [string-literal/p2-catalog-seed-candidate] 작가 텍스트
  - backend/src/routes/moduleDefinitions.ts:74 [string-literal/p1-api-response-candidate] 작가 텍스트
  - backend/src/routes/moduleDefinitions.ts:135 [string-literal/p1-api-response-candidate] 작가 텍스트

### 작가 JSON
- Count: 3
- Variants: 작가 JSON
- Exposure: p1-api-response-candidate 2, p2-catalog-seed-candidate 1
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:1738 [string-literal/p2-catalog-seed-candidate] 작가 JSON
  - backend/src/routes/moduleDefinitions.ts:76 [string-literal/p1-api-response-candidate] 작가 JSON
  - backend/src/routes/moduleDefinitions.ts:137 [string-literal/p1-api-response-candidate] 작가 JSON

### 태그 텍스트
- Count: 3
- Variants: 태그 텍스트
- Exposure: p1-api-response-candidate 2, p2-catalog-seed-candidate 1
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:1304 [string-literal/p2-catalog-seed-candidate] 태그 텍스트
  - backend/src/routes/moduleDefinitions.ts:71 [string-literal/p1-api-response-candidate] 태그 텍스트
  - backend/src/routes/moduleDefinitions.ts:132 [string-literal/p1-api-response-candidate] 태그 텍스트

### 태그 JSON
- Count: 3
- Variants: 태그 JSON
- Exposure: p1-api-response-candidate 2, p2-catalog-seed-candidate 1
- Examples:
  - backend/src/database/userSettingsBuiltinModules.ts:1312 [string-literal/p2-catalog-seed-candidate] 태그 JSON
  - backend/src/routes/moduleDefinitions.ts:73 [string-literal/p1-api-response-candidate] 태그 JSON
  - backend/src/routes/moduleDefinitions.ts:134 [string-literal/p1-api-response-candidate] 태그 JSON

## Similar Message Groups

### Signature: 프롬프트
- Total occurrences: 12
- Normalized groups: 2
  - (11) 프롬프트
    - backend/src/database/userSettingsBuiltinModules.ts:471 [p2-catalog-seed-candidate] 프롬프트
    - backend/src/database/userSettingsBuiltinModules.ts:591 [p2-catalog-seed-candidate] 프롬프트
  - (1) - 프롬프트: {value}개
    - backend/src/utils/versionCheck.ts:112 [p4-dev-internal] - 프롬프트: ${check.promptCount.toLocaleString()}개

### Signature: 유효하지 않은 폴더 입니다
- Total occurrences: 11
- Normalized groups: 3
  - (9) 유효하지 않은 폴더 ID입니다
    - backend/src/routes/watchedFolders.ts:52 [p1-api-response-candidate] 유효하지 않은 폴더 ID입니다
    - backend/src/routes/watchedFolders.ts:177 [p1-api-response-candidate] 유효하지 않은 폴더 ID입니다
  - (1) 유효하지 않은 폴더 경로
    - backend/src/services/folderScan/index.ts:79 [p2-backend-runtime-candidate] 유효하지 않은 폴더 경로
  - (1) 유효하지 않은 source ID입니다
    - backend/src/routes/backupSources.ts:9 [p1-api-response-candidate] 유효하지 않은 source ID입니다

### Signature: 폴더를 찾을 수 없습니다
- Total occurrences: 8
- Normalized groups: 3
  - (6) 폴더를 찾을 수 없습니다
    - backend/src/routes/watchedFolders.ts:58 [p1-api-response-candidate] 폴더를 찾을 수 없습니다
    - backend/src/routes/watchedFolders.ts:194 [p1-api-response-candidate] 폴더를 찾을 수 없습니다
  - (1) ⚠️ 마이그레이션 폴더를 찾을 수 없습니다.
    - backend/src/database/migrationManager.ts:68 [p3-backend-internal-unknown] ⚠️ 마이그레이션 폴더를 찾을 수 없습니다.
  - (1) 폴더를 찾을 수 없습니다: {value}
    - backend/src/services/folderScan/index.ts:60 [p2-backend-runtime-candidate] 폴더를 찾을 수 없습니다: ${folderId}

### Signature: 시스템 프롬프트
- Total occurrences: 8
- Normalized groups: 2
  - (7) 시스템 프롬프트
    - backend/src/database/userSettingsBuiltinModules.ts:480 [p2-catalog-seed-candidate] 시스템 프롬프트
    - backend/src/database/userSettingsBuiltinModules.ts:597 [p2-catalog-seed-candidate] 시스템 프롬프트
  - (1) 시스템 프롬프트 프리셋
    - backend/src/routes/settings.ts:163 [p1-api-response-candidate] 시스템 프롬프트 프리셋

### Signature: 메타데이터
- Total occurrences: 7
- Normalized groups: 1
  - (7) 메타데이터
    - backend/src/database/userSettingsBuiltinModules.ts:568 [p2-catalog-seed-candidate] 메타데이터
    - backend/src/database/userSettingsBuiltinModules.ts:1009 [p2-catalog-seed-candidate] 메타데이터

### Signature: 자동 스캔 실패
- Total occurrences: 6
- Normalized groups: 6
  - (1) ❌ 자동 스캔 실패: {value}
    - backend/src/services/folderScan/index.ts:245 [p3-operational-log] ❌ 자동 스캔 실패: ${folder.folder_path}
  - (1) 🔍 자동 스캔: {value}
    - backend/src/services/folderScan/index.ts:240 [p3-operational-log] 🔍 자동 스캔: ${folder.folder_name}
  - (1) 🤖 자동 스캔 시작...
    - backend/src/services/folderScan/index.ts:234 [p3-operational-log] 🤖 자동 스캔 시작...
  - (1) 스캔 실패
    - backend/src/routes/watchedFolders.ts:261 [p1-api-response-candidate] 스캔 실패
  - (1) 전체 스캔 실패
    - backend/src/routes/watchedFolders.ts:141 [p1-api-response-candidate] 전체 스캔 실패
  - (1) 파일 스캔 실패: {value}
    - backend/src/services/folderScan/fileDiscoveryService.ts:76 [p3-operational-log] 파일 스캔 실패: ${dirPath}

### Signature: 노드 안에 넣어둔 텍스트를 그대로 꺼내서 다음 단계로 넘겨줘
- Total occurrences: 6
- Normalized groups: 5
  - (2) 노드 안에 넣어둔 텍스트를 그대로 꺼내서 다음 단계로 넘겨줘.
    - backend/src/database/userSettingsBuiltinModules.ts:134 [p2-catalog-seed-candidate] 노드 안에 넣어둔 텍스트를 그대로 꺼내서 다음 단계로 넘겨줘.
    - backend/src/database/userSettingsBuiltinModules.ts:171 [p2-catalog-seed-candidate] 노드 안에 넣어둔 텍스트를 그대로 꺼내서 다음 단계로 넘겨줘.
  - (1) 노드 안에 넣어둔 숫자 값을 그대로 꺼내서 다음 단계로 넘겨줘.
    - backend/src/database/userSettingsBuiltinModules.ts:273 [p2-catalog-seed-candidate] 노드 안에 넣어둔 숫자 값을 그대로 꺼내서 다음 단계로 넘겨줘.
  - (1) 노드 안에 넣어둔 이미지를 그대로 꺼내서 다음 단계로 넘겨줘.
    - backend/src/database/userSettingsBuiltinModules.ts:244 [p2-catalog-seed-candidate] 노드 안에 넣어둔 이미지를 그대로 꺼내서 다음 단계로 넘겨줘.
  - (1) 노드 안에 넣어둔 참/거짓 값을 그대로 꺼내서 다음 단계로 넘겨줘.
    - backend/src/database/userSettingsBuiltinModules.ts:308 [p2-catalog-seed-candidate] 노드 안에 넣어둔 참/거짓 값을 그대로 꺼내서 다음 단계로 넘겨줘.
  - (1) 노드 안에 넣어둔 JSON 값을 그대로 꺼내서 다음 단계로 넘겨줘.
    - backend/src/database/userSettingsBuiltinModules.ts:208 [p2-catalog-seed-candidate] 노드 안에 넣어둔 JSON 값을 그대로 꺼내서 다음 단계로 넘겨줘.

### Signature: 구조화 출력 json
- Total occurrences: 6
- Normalized groups: 2
  - (5) 구조화 출력 JSON
    - backend/src/database/userSettingsBuiltinModules.ts:525 [p2-catalog-seed-candidate] 구조화 출력 JSON
    - backend/src/database/userSettingsBuiltinModules.ts:614 [p2-catalog-seed-candidate] 구조화 출력 JSON
  - (1) 구조화 출력 JSON 프리셋
    - backend/src/routes/settings.ts:177 [p1-api-response-candidate] 구조화 출력 JSON 프리셋

### Signature: 컨텍스트
- Total occurrences: 6
- Normalized groups: 1
  - (6) 컨텍스트
    - backend/src/database/userSettingsBuiltinModules.ts:489 [p2-catalog-seed-candidate] 컨텍스트
    - backend/src/database/userSettingsBuiltinModules.ts:603 [p2-catalog-seed-candidate] 컨텍스트

### Signature: 컴포지트 해시
- Total occurrences: 6
- Normalized groups: 1
  - (6) 컴포지트 해시
    - backend/src/database/userSettingsBuiltinModules.ts:871 [p2-catalog-seed-candidate] 컴포지트 해시
    - backend/src/database/userSettingsBuiltinModules.ts:903 [p2-catalog-seed-candidate] 컴포지트 해시

### Signature: 데이터베이스 초기화 완료
- Total occurrences: 5
- Normalized groups: 5
  - (1) ✅ 데이터베이스 초기화 완료
    - backend/src/scripts/resetDatabase.ts:39 [p4-dev-internal] ✅ 데이터베이스 초기화 완료
  - (1) ✅ 데이터베이스 최적화 완료
    - backend/src/scripts/resetDatabase.ts:113 [p4-dev-internal] ✅ 데이터베이스 최적화 완료
  - (1) ✅ 초기화 완료
    - backend/src/scripts/resetDatabase.ts:203 [p4-dev-internal] ✅ 초기화 완료
  - (1) ❌ 데이터베이스 초기화 실패:
    - backend/src/scripts/resetDatabase.ts:52 [p4-dev-internal] ❌ 데이터베이스 초기화 실패:
  - (1) 🗄️ 데이터베이스 초기화 시작...
    - backend/src/scripts/resetDatabase.ts:30 [p4-dev-internal] 🗄️ 데이터베이스 초기화 시작...

### Signature: 마이그레이션 완료
- Total occurrences: 5
- Normalized groups: 5
  - (1) ✅ 마이그레이션 완료: {value}
    - backend/src/database/migrationManager.ts:122 [p3-operational-log] ✅ 마이그레이션 완료: ${migration.version}
  - (1) ❌ 마이그레이션 실패: {value}
    - backend/src/database/migrationManager.ts:124 [p3-backend-internal-unknown] ❌ 마이그레이션 실패: ${migration.version}
  - (1) 🎉 마이그레이션 완료!
    - backend/src/database/migrations/004_add_model_references_column.ts:25 [p4-dev-internal] 🎉 마이그레이션 완료!
  - (1) 🎉 통합 마이그레이션 완료!
    - backend/src/database/migrations/000_create_all_tables.ts:501 [p4-dev-internal] 🎉 통합 마이그레이션 완료!
  - (1) 📊 마이그레이션 상태:
    - backend/src/database/migrationManager.ts:198 [p3-backend-internal-unknown] 📊 마이그레이션 상태:

### Signature: 썸네일 재생성 완료
- Total occurrences: 5
- Normalized groups: 5
  - (1) ✅ 썸네일 재생성 완료
    - backend/src/services/thumbnailRegenerationService.ts:199 [p3-operational-log] ✅ 썸네일 재생성 완료
  - (1) ✅ 썸네일 재생성 완료:
    - backend/src/routes/thumbnails.ts:26 [p1-api-response-candidate] ✅ 썸네일 재생성 완료:
  - (1) ❌ 썸네일 재생성 실패:
    - backend/src/routes/thumbnails.ts:29 [p1-api-response-candidate] ❌ 썸네일 재생성 실패:
  - (1) 🔄 썸네일 재생성 시작...
    - backend/src/services/thumbnailRegenerationService.ts:80 [p3-operational-log] 🔄 썸네일 재생성 시작...
  - (1) 🖼️ 썸네일 재생성: {value}
    - backend/src/services/fileVerificationService.ts:273 [p2-backend-runtime-candidate] 🖼️ 썸네일 재생성: ${path.basename(file.original_file_path)}

### Signature: 파일 검증 완료
- Total occurrences: 5
- Normalized groups: 5
  - (1) ✅ 파일 검증 완료
    - backend/src/services/fileVerificationService.ts:169 [p3-operational-log] ✅ 파일 검증 완료
  - (1) ✅ Phase {number}: 파일 검증 완료
    - backend/src/services/thumbnailRegenerationService.ts:93 [p3-operational-log] ✅ Phase 1: 파일 검증 완료
  - (1) ❌ 파일 검증 오류: {value}
    - backend/src/services/fileVerificationService.ts:152 [p2-backend-runtime-candidate] ❌ 파일 검증 오류: ${file.original_file_path}
  - (1) 🔍 파일 검증 시작...
    - backend/src/services/fileVerificationService.ts:99 [p3-operational-log] 🔍 파일 검증 시작...
  - (1) 파일 검증 실패: {value}
    - backend/src/services/fileVerificationService.ts:244 [p2-backend-runtime-candidate] 파일 검증 실패: ${(error as Error).message}

### Signature: 폴더가 존재하지 않습니다
- Total occurrences: 5
- Normalized groups: 4
  - (2) 폴더가 존재하지 않습니다: {value}
    - backend/src/services/backupSourceService.ts:106 [p2-backend-runtime-candidate] 폴더가 존재하지 않습니다: ${sourcePath}
    - backend/src/services/watchedFolderService.ts:155 [p2-backend-runtime-candidate] 폴더가 존재하지 않습니다: ${absolutePath}
  - (1) ⚠️ 폴더가 존재하지 않습니다: {value}
    - backend/src/scripts/cleanupFileSystem.ts:77 [p4-dev-internal] ⚠️ 폴더가 존재하지 않습니다: ${mediaPath}
  - (1) ⚠️ temp 폴더가 존재하지 않습니다
    - backend/src/scripts/cleanupFileSystem.ts:178 [p4-dev-internal] ⚠️ temp 폴더가 존재하지 않습니다
  - (1) 경로가 존재하지 않습니다
    - backend/src/services/watchedFolderService.ts:367 [p2-backend-runtime-candidate] 경로가 존재하지 않습니다

### Signature: json 노드에는 json 값 개가 필요해
- Total occurrences: 5
- Normalized groups: 3
  - (2) JSON 노드에는 JSON 값 {number}개가 필요해
    - backend/src/services/graph-workflow-executor/system-constant-operations.ts:25 [p2-backend-runtime-candidate] JSON 노드에는 JSON 값 1개가 필요해
    - backend/src/services/graph-workflow-executor/system-constant-operations.ts:36 [p2-backend-runtime-candidate] JSON 노드에는 JSON 값 1개가 필요해
  - (2) JSON 추출 노드에는 JSON 입력이 필요해
    - backend/src/services/graph-workflow-executor/system-json-operations.ts:13 [p2-backend-runtime-candidate] JSON 추출 노드에는 JSON 입력이 필요해
    - backend/src/services/graph-workflow-executor/system-json-operations.ts:24 [p2-backend-runtime-candidate] JSON 추출 노드에는 JSON 입력이 필요해
  - (1) JSON 노드에는 올바른 JSON 텍스트가 필요해
    - backend/src/services/graph-workflow-executor/system-constant-operations.ts:31 [p2-backend-runtime-candidate] JSON 노드에는 올바른 JSON 텍스트가 필요해

### Signature: 알 수 없는 오류
- Total occurrences: 5
- Normalized groups: 2
  - (3) 알 수 없는 오류
    - backend/src/services/fileVerificationService.ts:150 [p2-backend-runtime-candidate] 알 수 없는 오류
    - backend/src/services/fileWatcherService.ts:357 [p2-backend-runtime-candidate] 알 수 없는 오류
  - (2) 알 수 없는 정규식 오류
    - backend/src/services/graph-workflow-executor/system-logic-operations.ts:261 [p2-backend-runtime-candidate] 알 수 없는 정규식 오류
    - backend/src/services/graph-workflow-executor/system-text-operations.ts:70 [p2-backend-runtime-candidate] 알 수 없는 정규식 오류

### Signature: 이미지 참조
- Total occurrences: 5
- Normalized groups: 1
  - (5) 이미지 참조
    - backend/src/database/userSettingsBuiltinModules.ts:961 [p2-catalog-seed-candidate] 이미지 참조
    - backend/src/database/userSettingsBuiltinModules.ts:1001 [p2-catalog-seed-candidate] 이미지 참조

### Signature: 잘못된 예약작업 야
- Total occurrences: 5
- Normalized groups: 1
  - (5) 잘못된 예약작업 ID야.
    - backend/src/routes/graph-workflows/schedule-routes.ts:226 [p1-api-response-candidate] 잘못된 예약작업 ID야.
    - backend/src/routes/graph-workflows/schedule-routes.ts:316 [p1-api-response-candidate] 잘못된 예약작업 ID야.

### Signature: 폴더 스캔
- Total occurrences: 4
- Normalized groups: 4
  - (1) ║ {number}. 📂 폴더 스캔 ║
    - backend/src/utils/versionCheck.ts:104 [p4-dev-internal] ║ 4. 📂 폴더 스캔 ║
  - (1) ❌ 폴더 스캔 실패: {value}
    - backend/src/services/folderScan/index.ts:172 [p3-operational-log] ❌ 폴더 스캔 실패: ${folder.folder_path}
  - (1) 📂 스캔 대상: {value}개 폴더
    - backend/src/services/folderScan/index.ts:235 [p3-operational-log] 📂 스캔 대상: ${folders.length}개 폴더
  - (1) 🔍 폴더 스캔 시작: {value} ({value})
    - backend/src/services/folderScan/index.ts:168 [p3-operational-log] 🔍 폴더 스캔 시작: ${folder.folder_name} (${folder.folder_path})

### Signature: 워처 중지 완료 folderid
- Total occurrences: 4
- Normalized groups: 4
  - (1) ✅ 워처 중지 완료: folderId={value}
    - backend/src/routes/watchedFolders.ts:291 [p1-api-response-candidate] ✅ 워처 중지 완료: folderId=${id}
  - (1) ❌ 워처 재시작 실패: folderId={value}
    - backend/src/routes/watchedFolders.ts:232 [p1-api-response-candidate] ❌ 워처 재시작 실패: folderId=${id}
  - (1) ❌ 워처 중지 실패: folderId={value}
    - backend/src/routes/watchedFolders.ts:224 [p1-api-response-candidate] ❌ 워처 중지 실패: folderId=${id}
  - (1) 🧹 상태 정리 완료: folderId={value}
    - backend/src/services/fileWatcherService.ts:130 [p3-operational-log] 🧹 상태 정리 완료: folderId=${folderId}

### Signature: 자동 폴더 그룹 마이그레이션 롤백 완료
- Total occurrences: 4
- Normalized groups: 4
  - (1) ✅ 자동 폴더 그룹 마이그레이션 롤백 완료
    - backend/src/database/migrations/001_create_auto_folder_groups.ts:98 [p4-dev-internal] ✅ 자동 폴더 그룹 마이그레이션 롤백 완료
  - (1) 🎉 자동 폴더 그룹 마이그레이션 완료!
    - backend/src/database/migrations/001_create_auto_folder_groups.ts:77 [p4-dev-internal] 🎉 자동 폴더 그룹 마이그레이션 완료!
  - (1) 🔄 자동 폴더 그룹 마이그레이션 롤백 시작...
    - backend/src/database/migrations/001_create_auto_folder_groups.ts:85 [p4-dev-internal] 🔄 자동 폴더 그룹 마이그레이션 롤백 시작...
  - (1) 🚀 자동 폴더 그룹 마이그레이션 시작...
    - backend/src/database/migrations/001_create_auto_folder_groups.ts:9 [p4-dev-internal] 🚀 자동 폴더 그룹 마이그레이션 시작...

### Signature: civitai integration 마이그레이션 롤백 완료
- Total occurrences: 4
- Normalized groups: 4
  - (1) ✅ Civitai Integration 마이그레이션 롤백 완료
    - backend/src/database/migrations/003_create_civitai_tables.ts:165 [p4-dev-internal] ✅ Civitai Integration 마이그레이션 롤백 완료
  - (1) 🎉 Civitai Integration 마이그레이션 완료!
    - backend/src/database/migrations/003_create_civitai_tables.ts:141 [p4-dev-internal] 🎉 Civitai Integration 마이그레이션 완료!
  - (1) 🔄 Civitai Integration 마이그레이션 롤백 시작...
    - backend/src/database/migrations/003_create_civitai_tables.ts:151 [p4-dev-internal] 🔄 Civitai Integration 마이그레이션 롤백 시작...
  - (1) 🚀 Civitai Integration 마이그레이션 시작...
    - backend/src/database/migrations/003_create_civitai_tables.ts:11 [p4-dev-internal] 🚀 Civitai Integration 마이그레이션 시작...

### Signature: 구조화 출력 json 양식이 올바른 json이 아니야
- Total occurrences: 4
- Normalized groups: 3
  - (2) 구조화 출력 JSON 양식이 올바른 JSON이 아니야
    - backend/src/services/codexMessageService.ts:57 [p2-backend-runtime-candidate] 구조화 출력 JSON 양식이 올바른 JSON이 아니야
    - backend/src/services/llmProviderService.ts:91 [p2-backend-runtime-candidate] 구조화 출력 JSON 양식이 올바른 JSON이 아니야
  - (1) 구조화 출력 JSON 양식은 올바른 JSON이어야 해.
    - backend/src/routes/settings.ts:69 [p1-api-response-candidate] 구조화 출력 JSON 양식은 올바른 JSON이어야 해.
  - (1) 구조화 출력 JSON 프리셋이 올바른 JSON이 아니야: {value}
    - backend/src/services/graph-workflow-executor/system-llm-preset-operations.ts:32 [p2-backend-runtime-candidate] 구조화 출력 JSON 프리셋이 올바른 JSON이 아니야: ${presetName}

### Signature: 원본 이미지 추가
- Total occurrences: 4
- Normalized groups: 3
  - (2) 원본 이미지 추가
    - backend/src/routes/moduleDefinitions.ts:42 [p1-api-response-candidate] 원본 이미지 추가
    - backend/src/routes/moduleDefinitions.ts:98 [p1-api-response-candidate] 원본 이미지 추가
  - (1) ║ {number}. 💾 원본 이미지 백업 ║
    - backend/src/utils/versionCheck.ts:93 [p4-dev-internal] ║ 1. 💾 원본 이미지 백업 ║
  - (1) 원본 이미지
    - backend/src/routes/moduleDefinitions.ts:96 [p1-api-response-candidate] 원본 이미지

### Signature: codex 이미지 생성
- Total occurrences: 4
- Normalized groups: 2
  - (3) Codex 이미지 생성
    - backend/src/database/userSettingsBuiltinModules.ts:1187 [p2-catalog-seed-candidate] Codex 이미지 생성
    - backend/src/services/codexGenerationExecutor.ts:419 [p2-backend-runtime-candidate] Codex 이미지 생성
  - (1) 생성 이미지
    - backend/src/routes/moduleDefinitions.ts:108 [p1-api-response-candidate] 생성 이미지

### Signature: novelai 인증이 필요합니다 먼저 토큰으로 로그인하세요
- Total occurrences: 4
- Normalized groups: 2
  - (3) NovelAI 인증이 필요합니다. 먼저 토큰으로 로그인하세요.
    - backend/src/routes/nai/generate.ts:80 [p1-api-response-candidate] NovelAI 인증이 필요합니다. 먼저 토큰으로 로그인하세요.
    - backend/src/routes/nai/generate.ts:155 [p1-api-response-candidate] NovelAI 인증이 필요합니다. 먼저 토큰으로 로그인하세요.
  - (1) NovelAI 인증이 필요합니다. 먼저 로그인하세요.
    - backend/src/routes/nai/user.ts:17 [p1-api-response-candidate] NovelAI 인증이 필요합니다. 먼저 로그인하세요.

### Signature: 기본 upload 폴더는 삭제할 수 없습니다
- Total occurrences: 4
- Normalized groups: 2
  - (2) 기본 Upload 폴더는 삭제할 수 없습니다
    - backend/src/routes/watchedFolders.ts:285 [p1-api-response-candidate] 기본 Upload 폴더는 삭제할 수 없습니다
    - backend/src/services/watchedFolderService.ts:301 [p2-backend-runtime-candidate] 기본 Upload 폴더는 삭제할 수 없습니다
  - (2) 기본 Upload 폴더를 조회할 수 없습니다
    - backend/src/services/watchedFolderService.ts:106 [p2-backend-runtime-candidate] 기본 Upload 폴더를 조회할 수 없습니다
    - backend/src/services/watchedFolderService.ts:131 [p2-backend-runtime-candidate] 기본 Upload 폴더를 조회할 수 없습니다

### Signature: 드롭다운 목록에 랜덤 선택할 항목이 없어
- Total occurrences: 4
- Normalized groups: 2
  - (2) 드롭다운 목록에 랜덤 선택할 항목이 없어: {value}
    - backend/src/services/workflowPromptValueResolver.ts:50 [p2-backend-runtime-candidate] 드롭다운 목록에 랜덤 선택할 항목이 없어: ${dropdownListName}
    - backend/src/services/workflowPromptValueResolver.ts:57 [p2-backend-runtime-candidate] 드롭다운 목록에 랜덤 선택할 항목이 없어: ${dropdownListName}
  - (2) 드롭다운 필드에 랜덤 선택할 항목이 없어: {value}
    - backend/src/services/workflowPromptValueResolver.ts:51 [p2-backend-runtime-candidate] 드롭다운 필드에 랜덤 선택할 항목이 없어: ${field.id}
    - backend/src/services/workflowPromptValueResolver.ts:58 [p2-backend-runtime-candidate] 드롭다운 필드에 랜덤 선택할 항목이 없어: ${field.id}

### Signature: 이미지에서 작가 추출
- Total occurrences: 4
- Normalized groups: 2
  - (2) 이미지에서 작가 추출
    - backend/src/database/userSettingsBuiltinModules.ts:1713 [p2-catalog-seed-candidate] 이미지에서 작가 추출
    - backend/src/routes/moduleDefinitions.ts:146 [p1-api-response-candidate] 이미지에서 작가 추출
  - (2) 이미지에서 태그 추출
    - backend/src/database/userSettingsBuiltinModules.ts:1287 [p2-catalog-seed-candidate] 이미지에서 태그 추출
    - backend/src/routes/moduleDefinitions.ts:145 [p1-api-response-candidate] 이미지에서 태그 추출

### Signature: 그룹 이름
- Total occurrences: 4
- Normalized groups: 1
  - (4) 그룹 이름
    - backend/src/database/userSettingsBuiltinModules.ts:701 [p2-catalog-seed-candidate] 그룹 이름
    - backend/src/database/userSettingsBuiltinModules.ts:751 [p2-catalog-seed-candidate] 그룹 이름

### Signature: 네거티브 프롬프트
- Total occurrences: 4
- Normalized groups: 1
  - (4) 네거티브 프롬프트
    - backend/src/database/userSettingsBuiltinModules.ts:1202 [p2-catalog-seed-candidate] 네거티브 프롬프트
    - backend/src/database/userSettingsBuiltinModules.ts:1264 [p2-catalog-seed-candidate] 네거티브 프롬프트

### Signature: 연결 이름
- Total occurrences: 4
- Normalized groups: 1
  - (4) 연결 이름
    - backend/src/database/userSettingsBuiltinModules.ts:507 [p2-catalog-seed-candidate] 연결 이름
    - backend/src/database/userSettingsBuiltinModules.ts:579 [p2-catalog-seed-candidate] 연결 이름

### Signature: 최대 토큰
- Total occurrences: 4
- Normalized groups: 1
  - (4) 최대 토큰
    - backend/src/database/userSettingsBuiltinModules.ts:542 [p2-catalog-seed-candidate] 최대 토큰
    - backend/src/database/userSettingsBuiltinModules.ts:625 [p2-catalog-seed-candidate] 최대 토큰

### Signature: 프롬프트 포함
- Total occurrences: 4
- Normalized groups: 1
  - (4) 프롬프트 포함
    - backend/src/database/userSettingsBuiltinModules.ts:812 [p2-catalog-seed-candidate] 프롬프트 포함
    - backend/src/database/userSettingsBuiltinModules.ts:847 [p2-catalog-seed-candidate] 프롬프트 포함

### Signature: 기존 데이터베이스가 감지되었습니다
- Total occurrences: 3
- Normalized groups: 3
  - (1) ║ 기존 데이터베이스가 감지되었습니다. ║
    - backend/src/utils/versionCheck.ts:84 [p4-dev-internal] ║ 기존 데이터베이스가 감지되었습니다. ║
  - (1) ✅ 기존 데이터베이스에 연결되었습니다.
    - backend/src/database/init.ts:33 [p3-backend-internal-unknown] ✅ 기존 데이터베이스에 연결되었습니다.
  - (1) ✅ 새로운 데이터베이스가 생성되었습니다.
    - backend/src/database/init.ts:35 [p3-backend-internal-unknown] ✅ 새로운 데이터베이스가 생성되었습니다.

### Signature: ️ 백업 소스 워처 시작 실패
- Total occurrences: 3
- Normalized groups: 3
  - (1) ⚠️ 백업 소스 워처 시작 실패: {value}
    - backend/src/services/backupSourceWatcherService.ts:162 [p3-operational-log] ⚠️ 백업 소스 워처 시작 실패: ${source.display_name || source.source_path}
  - (1) ❌ 워처 시작 실패: {value}
    - backend/src/services/fileWatcherService.ts:354 [p3-operational-log] ❌ 워처 시작 실패: ${folder.folder_name}
  - (1) 워처 시작 실패: {value}
    - backend/src/routes/watchedFolders.ts:398 [p1-api-response-candidate] 워처 시작 실패: ${error instanceof Error? error.message: 'Unknown error'}

### Signature: ️ 오류
- Total occurrences: 3
- Normalized groups: 3
  - (1) ⚠️ 오류:
    - backend/src/scripts/resetDatabase.ts:46 [p4-dev-internal] ⚠️ 오류:
  - (1) ⚠️ 오류: {value}개
    - backend/src/services/thumbnailRegenerationService.ts:203 [p2-backend-runtime-candidate] ⚠️ 오류: ${errors.length}개
  - (1) ❌ 오류: {value}개
    - backend/src/scripts/cleanupFileSystem.ts:53 [p4-dev-internal] ❌ 오류: ${result.errors.length}개

### Signature: 그룹 테이블 개 인덱스 기본 그룹 생성 완료
- Total occurrences: 3
- Normalized groups: 3
  - (1) ✅ 그룹 테이블 {number}개 + 인덱스 + 기본 그룹 생성 완료
    - backend/src/database/migrations/000_create_all_tables.ts:186 [p4-dev-internal] ✅ 그룹 테이블 2개 + 인덱스 + 기본 그룹 생성 완료
  - (1) ✅ 폴더 테이블 {number}개 + 인덱스 + 기본 폴더 {number}개 생성 완료
    - backend/src/database/migrations/000_create_all_tables.ts:444 [p4-dev-internal] ✅ 폴더 테이블 3개 + 인덱스 + 기본 폴더 1개 생성 완료
  - (1) ✅ 프롬프트 테이블 {number}개 + 인덱스 + LoRA 그룹 생성 완료
    - backend/src/database/migrations/000_create_all_tables.ts:127 [p4-dev-internal] ✅ 프롬프트 테이블 4개 + 인덱스 + LoRA 그룹 생성 완료

### Signature: 파일 시스템 정리 완료
- Total occurrences: 3
- Normalized groups: 3
  - (1) ✅ 파일 시스템 정리 완료
    - backend/src/scripts/cleanupFileSystem.ts:50 [p4-dev-internal] ✅ 파일 시스템 정리 완료
  - (1) ❌ 파일 시스템 정리 실패:
    - backend/src/scripts/cleanupFileSystem.ts:64 [p4-dev-internal] ❌ 파일 시스템 정리 실패:
  - (1) 🧹 파일 시스템 정리 시작...
    - backend/src/scripts/cleanupFileSystem.ts:32 [p4-dev-internal] 🧹 파일 시스템 정리 시작...

## Suggested English-only Conversion Order

1. Convert p0-visible-ui repeated exact/similar messages first so common UI copy stays consistent.
2. Convert shell/navigation/settings strings next because they establish global English-only behavior.
3. Convert the highest-count frontend feature modules one by one, keeping each batch buildable.
4. Treat backend strings as candidates, not automatic work: p1 API responses first, p2 catalog/runtime only when the current frontend consumes them, p3/p4 logs/scripts last or never.
5. Keep this report regenerated after each batch to shrink the remaining Korean string inventory.

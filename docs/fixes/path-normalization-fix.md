# Windows 드라이브 문자 대소문자 불일치 문제 해결

## 문제 요약

Windows 환경에서 `fast-glob` 라이브러리가 반환하는 절대 경로의 드라이브 문자가 일관되지 않게 대문자(`D:/`) 또는 소문자(`d:/`)로 반환되어 중복 이미지가 데이터베이스에 등록되는 문제가 발생했습니다.

## 근본 원인

1. **fast-glob 동작**: [fileDiscoveryService.ts:38](../backend/src/services/folderScan/fileDiscoveryService.ts#L38)에서 `absolute: true` 옵션으로 파일 경로를 반환할 때, Windows 드라이브 문자의 대소문자가 일관되지 않음
2. **경로 저장**: [fastRegistrationService.ts:102](../backend/src/services/folderScan/fastRegistrationService.ts#L102)에서 경로를 정규화 없이 그대로 DB에 저장
3. **중복 검사 실패**: [duplicateDetectionService.ts:38](../backend/src/services/folderScan/duplicateDetectionService.ts#L38)에서 경로 기반 중복 검사 시 `d:/path`와 `D:/path`를 다른 파일로 인식

## 해결 방법

### 1. 경로 정규화 유틸리티 추가

[pathResolver.ts](../backend/src/utils/pathResolver.ts#L28)에 `normalizeWindowsDriveLetter()` 함수 추가:

```typescript
export function normalizeWindowsDriveLetter(filePath: string): string {
  const driveLetterPattern = /^([a-z]):([\\/])/i;
  const match = filePath.match(driveLetterPattern);

  if (match) {
    return filePath.replace(driveLetterPattern, (_, letter, slash) =>
      `${letter.toUpperCase()}:${slash}`
    );
  }

  return filePath;
}
```

**특징**:
- Windows 드라이브 문자를 대문자로 통일
- Unix 경로는 그대로 유지 (크로스 플랫폼 호환)
- 네트워크 경로(`\\server\share`) 지원

### 2. 파일 검색 시 정규화 적용

[fileDiscoveryService.ts:56](../backend/src/services/folderScan/fileDiscoveryService.ts#L56):

```typescript
const filteredFiles = allFiles
  .filter(file => {
    const ext = path.extname(file).toLowerCase();
    return shouldProcessFileExtension(ext, options.excludeExtensions);
  })
  .map(file => normalizeWindowsDriveLetter(file)); // Windows 드라이브 문자 정규화
```

### 3. 중복 검사 시 정규화 적용

[duplicateDetectionService.ts:39](../backend/src/services/folderScan/duplicateDetectionService.ts#L39):

```typescript
static getExistingFileByPath(filePath: string): { id: number; composite_hash: string | null } | undefined {
  const normalizedPath = normalizeWindowsDriveLetter(filePath);
  return db.prepare(
    'SELECT id, composite_hash FROM image_files WHERE original_file_path = ?'
  ).get(normalizedPath) as { id: number; composite_hash: string | null } | undefined;
}
```

## 기존 데이터 정리

### 정리 스크립트

[normalize-paths.ts](../backend/scripts/normalize-paths.ts) 생성:

```bash
cd backend && npx ts-node scripts/normalize-paths.ts
```

**스크립트 동작**:
1. 중복 경로 검색 (대소문자 무시)
2. 중복 레코드 제거 (첫 번째 레코드 유지)
3. 모든 경로의 드라이브 문자를 대문자로 정규화

### 실행 결과

```
=== 데이터베이스 경로 정규화 스크립트 ===

🔍 중복 레코드 검사 시작...
⚠️ 43개의 중복 경로 발견
✅ 중복 제거 완료

🔄 image_files 테이블 경로 정규화 시작...
총 57개의 레코드 발견
✅ 정규화 완료:
  - 업데이트됨: 43개
  - 변경 없음: 14개

✅ 모든 작업 완료
```

## 테스트

### 단위 테스트

[test-path-normalization.ts](../backend/scripts/test-path-normalization.ts):

```bash
cd backend && npx ts-node scripts/test-path-normalization.ts
```

**테스트 케이스**:
- ✅ `d:\_Dev\test.png` → `D:\_Dev\test.png`
- ✅ `D:\_Dev\test.png` → `D:\_Dev\test.png`
- ✅ `c:/windows/path.jpg` → `C:/windows/path.jpg`
- ✅ `/unix/path/test.png` → `/unix/path/test.png`
- ✅ `\\network\share\file.png` → `\\network\share\file.png`

**결과**: Passed: 6/6

### 데이터베이스 검증

```bash
cd backend && npx ts-node -e "
import { db } from './src/database/init';
const result = db.prepare('SELECT COUNT(*) as count FROM image_files').get();
console.log('Total records:', result.count);
const dupes = db.prepare('SELECT original_file_path, COUNT(*) as count FROM image_files GROUP BY UPPER(original_file_path) HAVING count > 1').all();
console.log('Duplicate paths:', dupes.length);
"
```

**결과**:
- Total records: 57
- Duplicate paths: 0

## 영향 범위

### 수정된 파일

1. [backend/src/utils/pathResolver.ts](../backend/src/utils/pathResolver.ts)
   - `normalizeWindowsDriveLetter()` 함수 추가

2. [backend/src/services/folderScan/fileDiscoveryService.ts](../backend/src/services/folderScan/fileDiscoveryService.ts)
   - 파일 검색 결과에 경로 정규화 적용

3. [backend/src/services/folderScan/duplicateDetectionService.ts](../backend/src/services/folderScan/duplicateDetectionService.ts)
   - 경로 기반 중복 검사에 정규화 적용

### 생성된 파일

1. [backend/scripts/normalize-paths.ts](../backend/scripts/normalize-paths.ts)
   - 기존 데이터베이스 경로 정규화 및 중복 제거 스크립트

2. [backend/scripts/test-path-normalization.ts](../backend/scripts/test-path-normalization.ts)
   - 경로 정규화 함수 단위 테스트

## 향후 발생 가능성

### 이 문제가 다시 발생할 수 있는가?

**아니오**. 다음 이유로 향후 발생하지 않습니다:

1. **소스 수준 정규화**: `fast-glob`이 반환하는 모든 경로가 즉시 정규화됨
2. **중복 검사 강화**: 경로 비교 시 정규화된 경로 사용
3. **크로스 플랫폼 호환**: Unix 경로는 영향받지 않음
4. **자동 적용**: 모든 폴더 스캔 작업에 자동 적용

### 예방 조치

- ✅ 경로 저장 전 자동 정규화
- ✅ 경로 비교 시 정규화된 값 사용
- ✅ 단위 테스트로 정규화 로직 검증
- ✅ 기존 데이터 정리 스크립트 제공

## 결론

이 수정으로 인해:
1. ✅ 43개의 중복 레코드가 제거됨
2. ✅ 모든 경로가 일관된 형식(대문자 드라이브 문자)으로 통일됨
3. ✅ 향후 중복 등록이 자동으로 방지됨
4. ✅ 크로스 플랫폼 호환성 유지

**개발 단계이므로 DB 마이그레이션은 필요 없으며, 기존 데이터베이스를 삭제하고 새로 시작할 수 있습니다.**

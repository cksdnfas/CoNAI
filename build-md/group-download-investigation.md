# 그룹 다운로드 기능 조사 결과 및 수정 계획

## 조사 일시
2025-11-19

## 문제 현상
- **커스텀 그룹** 및 **자동폴더 그룹**에서 묶음 다운로드(그룹 전체, 선택된 항목) 실행 시 새 페이지가 열리면서 백엔드 응답이 텍스트로 표시됨
- **개별 다운로드**만 정상 동작
- 다운로드가 트리거되지 않고 JSON 응답 또는 에러 메시지가 브라우저 창에 표시됨

## 조사 결과

### 1. 프론트엔드 구현 차이

#### 커스텀 그룹 (Custom Groups)
**위치**: `frontend/src/pages/ImageGroups/components/GroupImageGridModal.tsx:235`

**현재 구현**:
```typescript
// startDownload 함수 (line 213-236)
const downloadUrl = groupApi.getDownloadUrl(currentGroup.id, type, compositeHashes);
window.open(downloadUrl, '_blank');  // ❌ 문제: 새 탭으로 열림
```

**문제점**:
- `window.open(downloadUrl, '_blank')`을 사용하여 새 탭/창에서 URL을 열음
- 백엔드에서 에러가 발생하거나 응답 헤더가 올바르지 않으면 JSON 응답이 브라우저에 텍스트로 표시됨
- 다운로드가 트리거되지 않고 응답 내용이 그대로 노출됨

#### 자동폴더 그룹 (Auto-Folder Groups)
**위치**: `frontend/src/services/api/autoFolderGroupsApi.ts:176-211`

**현재 구현**:
```typescript
// downloadGroup 함수
const response = await apiClient.get(`/api/auto-folder-groups/${groupId}/download`, {
  params,
  responseType: 'blob',  // ✅ Blob으로 응답 받음
});

// Blob URL 생성 후 다운로드
const url = window.URL.createObjectURL(new Blob([response.data]));
const link = document.createElement('a');
link.href = url;
link.setAttribute('download', filename);
document.body.appendChild(link);
link.click();  // ✅ 프로그래밍 방식으로 클릭
link.remove();
window.URL.revokeObjectURL(url);
```

**현재 상태**:
- API는 올바르게 구현되어 있지만, **GroupImageGridModal에서 사용되지 않음**
- 모달에서는 커스텀 그룹과 동일하게 `window.open()` 방식을 사용 중

### 2. 백엔드 구현 차이

#### 커스텀 그룹 다운로드 API
**위치**: `backend/src/routes/groups.ts:628-698`

**구현 방식**:
```typescript
// 파일 스트리밍 방식
res.setHeader('Content-Type', 'application/zip');
res.setHeader('Content-Disposition',
  `attachment; filename="${result.fileName}"; filename*=UTF-8''${encodedFilename}`
);

const fileStream = fs.createReadStream(result.zipPath);
return fileStream.pipe(res);
```

**특징**:
- 스트리밍 방식으로 파일 전송
- Content-Disposition 헤더 설정으로 다운로드 트리거

#### 자동폴더 그룹 다운로드 API
**위치**: `backend/src/routes/autoFolderGroups.ts:241-290`

**구현 방식**:
```typescript
// Express의 res.download() 사용
res.download(result.zipPath, result.fileName, (err) => {
  if (fs.existsSync(result.zipPath)) {
    fs.unlinkSync(result.zipPath);
  }
  if (err) {
    console.error('Error sending zip file:', err);
  }
});
```

**특징**:
- Express의 `res.download()` 헬퍼 함수 사용
- 자동으로 Content-Disposition 헤더 설정
- 콜백에서 파일 정리

### 3. 파라미터 전달 방식 차이

#### 커스텀 그룹
```typescript
// frontend/src/services/api/groupApi.ts:247-253
getDownloadUrl: (id, type, compositeHashes) => {
  let url = `${API_BASE_URL}/api/groups/${id}/download?type=${type}`;
  if (compositeHashes && compositeHashes.length > 0) {
    url += `&hashes=${encodeURIComponent(JSON.stringify(compositeHashes))}`;
  }
  return url;
}
```

**백엔드 파싱**:
```typescript
// backend/src/routes/groups.ts:635-644
if (req.query.hashes) {
  compositeHashes = JSON.parse(req.query.hashes as string);  // JSON 파싱
}
```

#### 자동폴더 그룹
```typescript
// frontend/src/services/api/autoFolderGroupsApi.ts:182-184
if (selectedHashes && selectedHashes.length > 0) {
  params.hashes = selectedHashes.join(',');  // 쉼표로 구분
}
```

**백엔드 파싱**:
```typescript
// backend/src/routes/autoFolderGroups.ts:248
const selectedHashes = hashesParam ? hashesParam.split(',') : undefined;
```

## 근본 원인 분석

### 주요 문제점

1. **프론트엔드 다운로드 메커니즘 불일치**
   - 커스텀 그룹: `window.open()` 사용 (새 창 열림)
   - 자동폴더 그룹: `window.open()` 사용 중 (원래는 Blob 다운로드 API가 있음)
   - **GroupImageGridModal**에서 양쪽 모두 `window.open()` 사용

2. **백엔드 응답 처리 방식 차이**
   - 커스텀 그룹: 스트리밍 방식 (`fileStream.pipe(res)`)
   - 자동폴더 그룹: Express의 `res.download()` 사용

3. **에러 처리 부족**
   - `window.open()`으로 열린 새 창에서 에러 발생 시 사용자에게 JSON 응답이 그대로 노출됨
   - 다운로드 실패 시 피드백 없음

4. **GroupImageGridModal의 구현 오류**
   - 자동폴더 그룹을 위한 올바른 API(`autoFolderGroupsApi.downloadGroup`)가 있지만 사용하지 않음
   - `startDownload` 함수에서 두 그룹 타입 모두 잘못된 방식 사용

## 수정 계획

### Phase 1: 프론트엔드 다운로드 메커니즘 통일

#### 1.1 groupApi에 Blob 기반 다운로드 함수 추가
**파일**: `frontend/src/services/api/groupApi.ts`

```typescript
/**
 * Download group images as ZIP (Blob-based)
 */
downloadGroupBlob: async (
  id: number,
  type: 'thumbnail' | 'original' | 'video',
  compositeHashes?: string[]
): Promise<void> => {
  let url = `/api/groups/${id}/download?type=${type}`;
  if (compositeHashes && compositeHashes.length > 0) {
    url += `&hashes=${encodeURIComponent(JSON.stringify(compositeHashes))}`;
  }

  const response = await apiClient.get(url, {
    responseType: 'blob',
  });

  // Create download link
  const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = blobUrl;

  // Extract filename from Content-Disposition header
  const contentDisposition = response.headers['content-disposition'];
  let filename = `group-${id}-${type}.zip`;
  if (contentDisposition) {
    const filenameMatch = contentDisposition.match(/filename\*=UTF-8''(.+)|filename="?(.+?)"?$/);
    if (filenameMatch) {
      filename = decodeURIComponent(filenameMatch[1] || filenameMatch[2]);
    }
  }

  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(blobUrl);
},
```

#### 1.2 GroupImageGridModal 수정
**파일**: `frontend/src/pages/ImageGroups/components/GroupImageGridModal.tsx`

**변경 내용**:
```typescript
// startDownload 함수 수정 (line 213-236)
const startDownload = async (type: 'thumbnail' | 'original' | 'video', scope: 'all' | 'selected') => {
  if (!currentGroup?.id) return;

  try {
    // 선택된 이미지의 composite_hash 추출
    let compositeHashes: string[] | undefined;
    if (scope === 'selected' && selectedIds.length > 0) {
      compositeHashes = selectedImages
        .map(img => img.composite_hash)
        .filter((hash): hash is string => hash !== null);
    }

    // 그룹 타입에 따라 다른 API 사용
    if (groupType === 'custom') {
      await groupApi.downloadGroupBlob(currentGroup.id, type, compositeHashes);
    } else {
      await autoFolderGroupsApi.downloadGroup(currentGroup.id, type, compositeHashes);
    }

    // 다운로드 성공 스낵바
    if (onShowSnackbar) {
      onShowSnackbar('다운로드가 시작되었습니다.', 'success');
    }
  } catch (error) {
    console.error('Download failed:', error);
    if (onShowSnackbar) {
      onShowSnackbar('다운로드에 실패했습니다.', 'error');
    }
  }
};
```

### Phase 2: 백엔드 응답 방식 통일 (선택사항)

#### 2.1 커스텀 그룹 다운로드를 res.download()로 변경
**파일**: `backend/src/routes/groups.ts:628-698`

**현재 구현**:
```typescript
// 스트리밍 방식
const fileStream = fs.createReadStream(result.zipPath);
fileStream.on('end', async () => {
  await GroupDownloadService.cleanupTempFile(result.zipPath);
});
return fileStream.pipe(res);
```

**변경 후** (자동폴더 그룹과 동일):
```typescript
// res.download() 사용
const encodedFilename = encodeURIComponent(result.fileName);
res.setHeader('Content-Disposition',
  `attachment; filename="${result.fileName}"; filename*=UTF-8''${encodedFilename}`
);

res.download(result.zipPath, result.fileName, (err) => {
  // 다운로드 완료 또는 실패 시 임시 파일 삭제
  GroupDownloadService.cleanupTempFile(result.zipPath);

  if (err) {
    console.error('Error sending zip file:', err);
  }
});

return;
```

**장점**:
- 두 API의 응답 방식 통일
- 파일 정리 로직 일관성 확보
- Express의 표준 메서드 사용으로 유지보수성 향상

### Phase 3: 에러 처리 및 사용자 피드백 개선

#### 3.1 다운로드 진행 상태 표시
```typescript
// GroupImageGridModal에 로딩 상태 추가
const [isDownloading, setIsDownloading] = useState(false);

const startDownload = async (...) => {
  setIsDownloading(true);
  try {
    // 다운로드 로직
  } finally {
    setIsDownloading(false);
  }
};
```

#### 3.2 백엔드 에러 응답 개선
- ZIP 생성 실패 시 명확한 에러 메시지
- 파일 개수 0개일 때 사전 검증

## 구현 우선순위

### 긴급 (Immediate)
1. ✅ **GroupImageGridModal.tsx 수정** - `startDownload` 함수를 Blob 기반으로 변경
2. ✅ **groupApi.ts에 downloadGroupBlob 추가**

### 중요 (High)
3. ✅ 에러 처리 및 사용자 피드백 (스낵바)
4. ✅ 다운로드 진행 상태 표시

### 선택 (Optional)
5. 백엔드 응답 방식 통일 (스트리밍 → res.download())
6. 파라미터 전달 방식 통일 (JSON vs 쉼표 구분)

## 테스트 계획

### 테스트 시나리오

1. **커스텀 그룹**
   - [ ] 전체 다운로드 (썸네일)
   - [ ] 전체 다운로드 (원본)
   - [ ] 전체 다운로드 (비디오)
   - [ ] 선택 다운로드 (썸네일)
   - [ ] 선택 다운로드 (원본)
   - [ ] 선택 다운로드 (비디오)

2. **자동폴더 그룹**
   - [ ] 전체 다운로드 (썸네일)
   - [ ] 전체 다운로드 (원본)
   - [ ] 전체 다운로드 (비디오)
   - [ ] 선택 다운로드 (썸네일)
   - [ ] 선택 다운로드 (원본)
   - [ ] 선택 다운로드 (비디오)

3. **에러 케이스**
   - [ ] 이미지가 없는 그룹 다운로드
   - [ ] 선택된 이미지가 없을 때
   - [ ] 백엔드 에러 발생 시
   - [ ] 네트워크 오류 시

4. **대용량 다운로드**
   - [ ] 100개 이상 이미지 다운로드 (확인 다이얼로그)
   - [ ] 파일명 한글/특수문자 처리

## 예상 영향

### 변경 파일
1. `frontend/src/services/api/groupApi.ts` - 새 함수 추가
2. `frontend/src/pages/ImageGroups/components/GroupImageGridModal.tsx` - 다운로드 로직 수정
3. (선택) `backend/src/routes/groups.ts` - 응답 방식 통일

### 호환성
- 기존 개별 다운로드 기능에는 영향 없음
- 백엔드 API 엔드포인트 변경 없음
- 프론트엔드만 수정으로 빠른 배포 가능

## 결론

현재 다운로드 기능이 동작하지 않는 주요 원인은:
1. **GroupImageGridModal에서 `window.open()` 사용** - 새 창에서 URL을 열어 에러 응답이 표시됨
2. **자동폴더 그룹의 올바른 API를 사용하지 않음** - Blob 기반 API가 있지만 모달에서 미사용

해결 방법:
1. 커스텀 그룹에도 Blob 기반 다운로드 API 추가 (`downloadGroupBlob`)
2. GroupImageGridModal에서 두 그룹 타입 모두 Blob 기반 API 사용
3. 에러 처리 및 사용자 피드백 개선

이 수정으로 **새 창이 열리는 문제 해결** 및 **다운로드가 정상적으로 트리거**되어야 합니다.

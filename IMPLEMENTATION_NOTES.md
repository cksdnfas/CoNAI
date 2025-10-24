# Group Assignment Feature Implementation Notes

## 완료된 작업

### Backend
1. ✅ 데이터베이스 마이그레이션 생성 (`003_add_group_assignment.sql`)
   - `assigned_group_id` 컬럼 추가
   - 인덱스 생성

2. ✅ GenerationHistory 모델 수정
   - `assigned_group_id` 필드 추가
   - CREATE 쿼리에 필드 포함

3. ✅ GenerationHistoryService 수정
   - `createNAIHistory()`: groupId 파라미터 추가
   - `createComfyUIHistory()`: groupId 파라미터 추가
   - `processAndUploadImage()`: 업로드 완료 후 그룹 할당 로직 추가
   - `processComfyUIHistoryMetadata()`: 그룹 할당 로직 추가

4. ✅ API 라우트 수정
   - `/api/nai/generate/image`: groupId 파라미터 수신 및 전달
   - `/api/workflows/:id/generate`: groupId 파라미터 수신 및 전달

### Frontend
1. ✅ NAI 이미지 생성 컴포넌트 (`NAIImageGeneratorV2.tsx`)
   - 그룹 선택 상태 관리
   - GroupAssignModal 통합
   - 그룹 선택 UI 추가 (Paper 섹션)
   - LocalStorage에 선택된 그룹 저장/복원
   - API 호출 시 groupId 전달

2. ✅ ComfyUI 워크플로우 생성 페이지 (`WorkflowGeneratePage.tsx`)
   - 그룹 선택 상태 관리
   - GroupAssignModal 통합
   - 그룹 선택 UI 추가 (Paper 섹션)
   - LocalStorage에 선택된 그룹 저장/복원
   - API 호출 시 groupId 전달

## 다국어 지원 TODO

현재 하드코딩된 한국어 텍스트:
- "그룹 할당" (제목)
- "그룹 선택" (버튼)
- "생성된 이미지가 선택한 그룹에 자동으로 추가됩니다" (설명)
- "반복 실행" 관련 텍스트

추후 다국어 지원 시 다음 키 추가 필요:
```json
{
  "imageGeneration": {
    "groupAssignment": {
      "title": "그룹 할당",
      "selectButton": "그룹 선택",
      "description": "생성된 이미지가 선택한 그룹에 자동으로 추가됩니다"
    }
  },
  "workflows": {
    "groupAssignment": {
      "title": "그룹 할당",
      "selectButton": "그룹 선택",
      "description": "생성된 이미지가 선택한 그룹에 자동으로 추가됩니다"
    }
  }
}
```

## 테스트 체크리스트

### NAI 이미지 생성
- [ ] 그룹 선택 없이 이미지 생성 (기존 동작 유지)
- [ ] 그룹 선택 후 이미지 생성 (자동 할당 확인)
- [ ] 선택한 그룹이 LocalStorage에 저장되는지 확인
- [ ] 페이지 새로고침 후 선택한 그룹 복원 확인
- [ ] 반복 실행 시 그룹 할당 동작 확인
- [ ] 그룹 제거 후 이미지 생성 (그룹 할당 없음)

### ComfyUI 워크플로우
- [ ] 그룹 선택 없이 이미지 생성 (기존 동작 유지)
- [ ] 그룹 선택 후 이미지 생성 (자동 할당 확인)
- [ ] 선택한 그룹이 LocalStorage에 저장되는지 확인
- [ ] 페이지 새로고침 후 선택한 그룹 복원 확인
- [ ] 서버별 반복 실행 시 그룹 할당 동작 확인
- [ ] 그룹 제거 후 이미지 생성 (그룹 할당 없음)

### 데이터 검증
- [ ] 데이터베이스에 assigned_group_id 저장 확인
- [ ] image_groups 테이블에 collection_type='manual'로 저장 확인
- [ ] 그룹이 삭제된 경우 에러 처리 확인

## 주요 설계 결정사항

1. **collection_type은 항상 'manual'**
   - 사용자가 직접 선택한 그룹이므로 수동 수집으로 처리
   - 자동 수집 조건과 구분하기 위함

2. **그룹 선택은 선택사항 (optional)**
   - groupId가 null이면 기존 동작 유지
   - 이미지는 정상적으로 생성되고 저장됨

3. **Non-critical 에러 처리**
   - 그룹 할당 실패 시 경고 로그만 출력
   - 이미지 생성/저장은 계속 진행
   - 히스토리는 completed 상태로 유지

4. **LocalStorage 사용**
   - 사용자 편의성을 위해 선택한 그룹을 세션 간 유지
   - NAI: `nai_selected_group_id`
   - Workflow: `workflow_selected_group_id`

## 실행 순서

1. 데이터베이스 마이그레이션 자동 실행 (서버 시작 시)
2. 사용자가 그룹 선택 (선택사항)
3. 이미지 생성 요청
4. GenerationHistory 생성 (assigned_group_id 포함)
5. 이미지 업로드
6. 메인 images DB에 저장
7. assigned_group_id가 있으면 ImageGroupModel.addImageToGroup() 호출
8. 업로드 완료 및 히스토리 새로고침

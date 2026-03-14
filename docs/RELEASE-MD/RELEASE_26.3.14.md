# Release Notes

## Version 26.3.14 (Draft / Ongoing)

26.3.14는 직전 대형 업데이트 이후 안정화 및 프롬프트 관리 고도화 중심으로 진행 중인 버전입니다.

> 상태: **작성 진행 중 (지속 업데이트 예정)**

---

### 핵심 변경 사항 (현재까지)

#### 1) MCP 프롬프트 조직화 도구 추가

MCP 서버에 프롬프트 분류/관리 전용 도구가 추가되었습니다.

- 구조/조회
  - `get_prompt_group_structure`
  - `get_unclassified_prompts`
  - `get_prompts_in_group`
- 분류/이동
  - `create_prompt_group`
  - `batch_create_groups`
  - `assign_prompts_to_group`
  - `move_prompts_between_groups`
- 백업/복원
  - `backup_prompt_data`
  - `restore_prompt_data`
  - `list_backups`

또한 `backend/src/mcp/server.ts`에 해당 도구 등록이 반영되었습니다.

---

#### 2) 프롬프트 백업 데이터 확장

`PromptCollectionModel`에 전체 프롬프트 백업용 내보내기 로직이 추가되었습니다.

- 추가 메서드: `exportAllPrompts(type)`
- 포함 항목: `prompt`, `usage_count`, `group_id`, `synonyms`

---

#### 3) NovelAI 프롬프트 파서 개선

NAI 문법을 ComfyUI 호환 포맷으로 변환하는 로직이 추가되었습니다.

- 인라인 가중치 변환: `value::tag::` → `(tag:value)`
- 강조/약화 변환: `{}` / `[]` 가중치 처리
- 중첩 가중치 단순화: `((text:w1):w2)` → `(text:w1*w2)`

이를 통해 검색/표시 시 프롬프트 일관성이 개선됩니다.

---

#### 4) 프롬프트 UI/UX 개선

- `PromptDisplay`에 **원본/가공 프롬프트 토글**(NAI raw 파라미터 기반) 추가
- 그룹 표시 토글 상태를 `localStorage`에 저장하여 사용자 선택 유지
- `PromptCard` 헤더 확장 슬롯(`headerExtra`) 추가로 토글 칩 배치 지원
- `ImageDetailSidebar`에서 `rawNaiParameters` 전달하도록 연결
- 다국어 리소스에 신규 키 추가
  - `showOriginal`, `showProcessed`, `showGrouped`
  - 적용 언어: `ko`, `en`, `ja`, `zh-CN`, `zh-TW`

---

#### 5) 문서 및 리소스 정리

- `docs/MCP_GUIDE.md`의 MCP 포트 예시 업데이트 (1677 → 1566)
- `.kombai/resources` 내 일부 이미지 리소스 정리(삭제)

---

### 진행 중 / 추후 추가 예정

아래 항목은 26.3.14 개발 진행에 따라 계속 누적 작성합니다.

- [ ] 기능별 상세 검증 결과 (MCP Tool 시나리오, 프롬프트 파싱 케이스)
- [ ] UI 변경 스크린샷/사용 예시
- [ ] 성능/안정성 개선 내역
- [ ] Breaking Changes 및 마이그레이션 가이드(필요 시)
- [ ] 최종 릴리즈 날짜 및 태그 정보

---

### 변경 이력 로그 (누적)

- 2026-02-18: 기존 3.0.1 릴리즈 노트 초안 생성
- 2026-03-14: 날짜 기반 버전 표기 `26.3.14`로 전환, 현재 작업 상태 기준 커밋 준비

> 이후 커밋 반영 시, 위 로그에 날짜 + 요약을 계속 추가해 관리합니다.

---

## Previous Releases

- [Version 3.0.1 Draft](RELEASE_3.0.1.md)
- [Version 3.0.0](RELEASE_3.0.0.md)
- [Version 2.1.0a](RELEASE_2.1.0a.md)

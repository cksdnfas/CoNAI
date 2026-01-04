# Release Notes

## Version 2.1.1a (2026-01-04)

### New Features

#### Search
- **검색 결과 셔플 (Shuffle Search)**: 검색 결과를 랜덤하게 섞어서 볼 수 있는 기능 추가
  - 검색바 우측에 셔플 토글 버튼 추가
  - 대량의 검색 결과 탐색 시 유용

#### Wildcard
- **와일드카드 그룹 옵션 (Recursive Trigger Prevention)**:
  - 와일드카드 수정/생성 시 "하위 와일드카드만 사용 (그룹용)" 옵션 추가
  - 체크 시 해당 와일드카드 자체의 아이템은 무시하고, 하위 와일드카드들의 아이템만 사용
  - 폴더나 그룹핑 용도의 와일드카드가 불필요하게 트리거되는 것을 방지
  - 적용 대상:
    - 수동 와일드카드 (Manual)
    - 전처리 와일드카드 (Chain/Pre-process)

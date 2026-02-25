# Placeholder Images

이 폴더는 빈 미디어 그룹에 표시할 플레이스홀더 이미지를 저장하는 곳입니다.

## 랜덤 플레이스홀더 기능

빈 그룹 카드가 로드될 때마다 여러 개의 플레이스홀더 이미지 중 하나를 랜덤으로 선택하여 표시합니다.

**현재 제공되는 이미지:**
- `folder-overlay-1.svg` - 갤러리/이미지 프레임 아이콘
- `folder-overlay-2.svg` - 빈 상자 일러스트
- `folder-overlay-3.svg` - 사진 더미 아이콘

**작동 방식:**
- 각 빈 그룹은 1~3 중 랜덤으로 하나의 이미지를 표시
- 페이지 새로고침 시 다른 이미지가 표시될 수 있음
- 그룹마다 다른 이미지가 표시됨 (다양성 증가)

## 이미지 파일 구조

```
placeholders/
├── config.json                 # 플레이스홀더 설정 파일
├── folder-overlay-1.svg        # 첫 번째 플레이스홀더
├── folder-overlay-2.svg        # 두 번째 플레이스홀더
├── folder-overlay-3.svg        # 세 번째 플레이스홀더
└── README.md                   # 이 파일
```

## 이미지 추가/수정 방법

### 1. 기존 이미지 교체

특정 번호의 이미지를 교체하려면:
1. 원하는 이미지를 준비 (SVG 또는 PNG)
2. 파일명을 `folder-overlay-N.svg`로 저장 (N은 1, 2, 3 등)
3. 기존 파일을 덮어쓰기

### 2. 새 이미지 추가

플레이스홀더 이미지를 추가하려면:

**단계 1: 이미지 파일 추가**
- 새 이미지를 `folder-overlay-4.svg`, `folder-overlay-5.svg` 등으로 저장
- 이 폴더에 복사

**단계 2: config.json 수정**
```json
{
  "count": 5,          // 이미지 개수를 업데이트 (3 → 5)
  "format": "svg",
  "pattern": "folder-overlay-{n}.svg"
}
```

**단계 3: 컴포넌트 코드 수정**
- [GroupCard.tsx](../../src/pages/ImageGroups/components/GroupCard.tsx:75) 수정:
  ```typescript
  const PLACEHOLDER_COUNT = 5; // 3 → 5로 변경
  ```
- [AutoFolderGroupCard.tsx](../../src/pages/ImageGroups/components/AutoFolderGroupCard.tsx:63) 수정:
  ```typescript
  const PLACEHOLDER_COUNT = 5; // 3 → 5로 변경
  ```

### 3. PNG 파일 사용

SVG 대신 PNG를 사용하려면:
1. 파일명을 `folder-overlay-1.png`, `folder-overlay-2.png` 등으로 저장
2. `config.json` 수정:
   ```json
   {
     "count": 3,
     "format": "png",
     "pattern": "folder-overlay-{n}.png"
   }
   ```
3. 컴포넌트 코드에서 `.svg`를 `.png`로 변경

## 이미지 사양

**권장 스펙:**
- **크기**: 200x200px ~ 300x300px
- **포맷**: SVG (권장) 또는 PNG
- **배경**: 투명 배경 권장 (배경 폴더 아이콘과 조화)
- **디자인**: 밝고 간결한 아이콘/일러스트

**표시 방식:**
- 배경: 회색 폴더 아이콘 (opacity 40%)
- 전경: 플레이스홀더 이미지 중앙 오버레이 (opacity 80%)
- 크기: 카드 너비의 60%로 자동 조절

## 빌드 포함

이 폴더의 모든 파일은 Vite 빌드 시 자동으로 포함됩니다.
별도의 설정이 필요하지 않습니다.

## 적용 위치

- **커스텀 그룹** (GroupCard.tsx): 이미지가 없는 커스텀 그룹
- **자동폴더 그룹** (AutoFolderGroupCard.tsx): 이미지가 없는 자동 폴더

## 예시 디자인 아이디어

- 📁 간단한 폴더 아이콘
- 📸 사진/이미지 아이콘
- 📦 빈 상자 일러스트
- 🎨 아트워크 관련 심볼
- ✨ 별이나 장식 요소
- 🌟 반짝이는 효과

투명 배경을 사용하면 배경의 폴더 아이콘과 자연스럽게 어우러집니다.

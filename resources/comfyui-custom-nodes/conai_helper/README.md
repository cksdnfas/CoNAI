# CoNAI Helper for ComfyUI

ComfyUI에서 생성된 파일이나 폴더 단위 결과물을 CoNAI 아티팩트로 넘기기 위한 커스텀 노드입니다.

## 설치

1. 이 폴더를 ComfyUI의 `custom_nodes` 아래에 복사합니다.
   - 예: `ComfyUI/custom_nodes/conai_helper`
2. ComfyUI를 재시작합니다.
3. 노드 검색에서 `CoNAI Helper: Artifact Output`을 찾습니다.

## 노드

### `CoNAI Helper: Artifact Output`

- 내부 class key: `CoNAIArtifactFileOutput`
- category: `CoNAI Helper/artifacts`
- 기존 workflow 호환을 위해 내부 class key는 유지합니다.

## 입력

- `file_path`: CoNAI로 넘길 파일 경로
- `subfolder`: ComfyUI output 아래 저장 폴더. 기본값 `conai_artifacts`
- `filename_override`: 저장 이름 override. 비우면 원본 이름 사용
- `copy_parent_folder`: 켜면 `file_path`의 부모 폴더 전체 복사
- `overwrite`: 켜면 동일 대상 덮어쓰기 허용

## 동작

노드는 선택한 파일 또는 부모 폴더를 ComfyUI output 폴더 아래로 복사하고, ComfyUI history에 output file entry로 등록합니다. CoNAI는 해당 history entry를 통해 결과 파일을 아티팩트로 수집합니다.

## 주의

- `file_path`는 실제 존재하는 파일이어야 합니다.
- `subfolder`는 ComfyUI output 폴더 밖으로 나갈 수 없습니다.
- `copy_parent_folder`를 켜면 부모 폴더 전체가 복사되므로 용량을 확인하세요.

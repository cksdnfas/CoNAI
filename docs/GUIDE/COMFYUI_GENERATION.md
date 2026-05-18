# ComfyUI 생성

ComfyUI 탭은 등록된 ComfyUI 서버와 워크플로우를 사용해 이미지를 생성합니다. CoNAI에서 서버, 워크플로우, 사용자 입력 필드, 큐 라우팅, 결과 보기 방식을 한 화면에서 관리합니다.

## 위치

`/generation?tab=comfyui`

## 핵심 구조

| 구성 | 역할 |
| --- | --- |
| 서버 | 실제 ComfyUI 또는 Modal ComfyUI 엔드포인트 |
| 워크플로우 | 실행할 ComfyUI API workflow JSON |
| Marked Fields | 사용자가 생성 화면에서 바꿀 입력값 |
| 드롭다운 목록 | 모델/LoRA/스타일 같은 선택지 목록 |
| 큐 | 실행 요청을 저장하고 서버로 분배 |
| 결과 보기 | 생성 이력 또는 artifact explorer |

## 기본 흐름

1. ComfyUI 서버를 등록합니다.
2. 서버 연결을 테스트합니다.
3. 워크플로우를 등록합니다.
4. 그래프 보기나 JSON 검색으로 바꿀 노드를 찾습니다.
5. 사용자가 입력할 값을 Marked Field로 추가합니다.
6. 워크플로우를 저장합니다.
7. 워크플로우를 선택합니다.
8. 필수 필드와 이미지 입력을 채웁니다.
9. 실행 대상과 큐 등록 개수를 선택합니다.
10. 생성 버튼으로 큐에 등록합니다.
11. 생성 이력이나 artifact explorer에서 결과를 확인합니다.

## 서버 등록

ComfyUI 탭의 서버 섹션에서 서버를 추가합니다.

| 필드 | 설명 |
| --- | --- |
| Name | 화면에 표시할 서버 이름 |
| Endpoint | 서버 주소. 예: `http://127.0.0.1:8188` |
| Backend | `Local ComfyUI API` 또는 `Modal ComfyUI /generate` |
| Capacity | 동시 실행 슬롯 수 |
| Description | 선택 설명 |
| Routing tags | 자동 분배용 태그. 쉼표로 구분 |

### Local ComfyUI API

일반 ComfyUI 서버입니다. 테스트 버튼은 연결 상태, idle/busy, 실행/대기 개수, 응답 시간을 확인합니다.

권장 확인:

- ComfyUI가 켜져 있는지
- CoNAI 서버에서 Endpoint에 접근 가능한지
- 방화벽/포트가 막혀 있지 않은지
- 필요한 커스텀 노드와 모델이 서버에 있는지

### Modal ComfyUI /generate

Modal로 감싼 ComfyUI 엔드포인트입니다. 테스트 호출이 원격 비용을 만들 수 있어 UI에서 별도로 표시합니다.

Modal 서버는 일반 ComfyUI의 idle 상태 확인과 다르게 동작할 수 있습니다.

## 서버 라우팅

워크플로우 실행 화면에서 실행 대상을 고릅니다.

| 대상 | 동작 |
| --- | --- |
| 자동 분산 | 연결된 일반 ComfyUI 서버 중 사용 가능한 서버로 큐 등록 |
| 특정 서버 | 선택한 서버로 큐 등록 |
| 태그 | 해당 routing tag를 가진 서버로 큐 등록 |

큐 등록 개수는 1~32 범위입니다. 같은 입력으로 여러 작업을 큐에 넣고 싶을 때 사용합니다.

## 워크플로우 등록

워크플로우 섹션에서 등록 버튼을 누릅니다.

### 1. 기본 정보 입력

| 필드 | 설명 |
| --- | --- |
| 이름 | 워크플로우 목록에 표시할 이름 |
| 설명 | 용도, 모델, 입력 규칙 등을 적는 선택 설명 |
| 공용 페이지 사용 | 로그인 없는 공개 실행 페이지를 열지 여부 |
| 공용 slug | 공개 페이지 URL 식별자 |
| 공용 1회 요청 상한 | 공개 페이지에서 한 번에 등록 가능한 큐 상한. 1~32 |
| 결과 표시 방식 | 히스토리 뷰어 또는 탐색형 뷰어 |
| 결과 저장 방식 | 공유 폴더 또는 실행별 폴더 |
| 결과 저장 루트 경로 | artifact explorer를 쓸 때 결과 저장 루트 |

공용 페이지는 외부 사용자가 큐를 만들 수 있는 경로가 될 수 있으니 공개 범위와 권한을 먼저 확인합니다.

### 2. Workflow JSON 넣기

업로드 버튼으로 ComfyUI workflow JSON을 선택하거나, JSON 탭에 직접 붙여 넣습니다.

권장 형식은 ComfyUI API workflow JSON입니다. 일반 UI workflow와 다르면 실행 시 실패할 수 있습니다.

JSON이 유효하면 그래프 보기에서 노드가 표시됩니다.

### 3. 그래프에서 입력 노드 찾기

그래프 보기에서 다음 기준으로 검색할 수 있습니다.

- 노드 title
- `class_type`
- node id

검색 결과 이동 버튼으로 노드를 빠르게 찾습니다.

### 4. Marked Field 추가

그래프의 입력값 중 사용자가 바꿀 값을 Marked Field로 추가합니다.

Marked Field는 생성 화면에 노출되는 입력칸입니다. 너무 많이 열면 사용이 어려워지므로 자주 바꾸는 값만 노출합니다.

좋은 후보:

- positive prompt
- negative prompt
- seed
- steps
- CFG
- sampler / scheduler
- checkpoint
- LoRA
- 입력 이미지
- ControlNet 이미지
- denoise / strength

## Marked Field 설정

각 필드는 펼쳐서 세부 설정을 바꿀 수 있습니다.

| 설정 | 설명 |
| --- | --- |
| Label | 생성 화면에 표시할 이름 |
| Type | text, textarea, number, select, image, node |
| Description | 사용자가 볼 설명 |
| Default | 기본값 |
| required | 비어 있으면 실행을 막음 |
| collapsed by default | 생성 화면에서 기본 접힘 처리 |
| simple upload mode | 이미지 필드에서 간단 업로드 모드 사용 |
| Min / Max / Step | number 필드 입력 범위 |
| Dropdown List | select 필드에 연결할 목록 |
| Manual Options | select 필드 직접 선택지 |

필드 순서는 드래그로 바꿀 수 있습니다. 자주 쓰는 입력을 위로 올립니다.

## 드롭다운 목록

ComfyUI 모델 파일명처럼 사용자가 직접 타이핑하기 어려운 값은 드롭다운 목록으로 관리합니다.

### 커스텀 목록

직접 이름과 항목을 입력합니다. 항목은 줄바꿈 또는 쉼표로 구분합니다.

예:

```text
realistic.safetensors
anime_v5.safetensors
product_photo.safetensors
```

### 자동수집 목록

ComfyUI 모델 폴더를 선택하면 CoNAI가 알려진 모델 파일 확장자를 스캔해 목록을 만듭니다.

대상 예:

- checkpoints
- clip
- clip_vision
- controlnet
- diffusion_models
- embeddings
- ipadapter
- style_models
- text_encoders
- unet
- upscale_models
- vae

LoRA 폴더는 자동수집 대상에서 제외됩니다. 필요한 경우 커스텀 목록으로 관리합니다.

옵션:

| 옵션 | 설명 |
| --- | --- |
| 하위 폴더 통합 | 하위 폴더를 하나의 목록으로 합침 |
| 통합 + 개별 생성 | 통합 목록과 폴더별 목록을 함께 생성 |

## 워크플로우 실행

워크플로우를 선택하면 실행 화면으로 들어갑니다.

1. 실행 대상 선택: 자동, 태그, 특정 서버
2. 큐 등록 개수 입력
3. Marked Field 값 입력
4. 이미지 필드가 있으면 이미지 선택
5. 생성 실행

실행 전 검증:

- 워크플로우가 선택되어 있어야 합니다.
- required 필드는 비어 있으면 안 됩니다.
- 일반 ComfyUI 서버는 연결 테스트가 성공해야 합니다.
- 태그 실행은 해당 태그의 사용 가능한 서버가 있어야 합니다.

## 결과 보기

워크플로우 설정의 결과 표시 방식에 따라 달라집니다.

| 방식 | 설명 |
| --- | --- |
| 히스토리 뷰어 | 생성 이력 패널에서 결과를 확인 |
| 탐색형 뷰어 | workflow artifact explorer에서 실행 산출물을 탐색 |

artifact explorer를 쓰면 결과 저장 루트와 저장 방식이 중요합니다.

| 저장 방식 | 설명 |
| --- | --- |
| 공유 폴더 | 같은 워크플로우 결과를 한 폴더에 모음 |
| 실행별 폴더 | 실행마다 별도 폴더를 만들어 산출물 분리 |

## 워크플로우를 모듈로 저장

워크플로우 목록의 저장 아이콘으로 ComfyUI 워크플로우를 모듈 그래프용 모듈로 만들 수 있습니다.

사용 흐름:

1. 저장 아이콘을 누릅니다.
2. 모듈 이름과 설명을 정합니다.
3. 외부에서 입력 가능하게 열 필드를 선택합니다.
4. 새 모듈로 저장하거나 기존 모듈을 덮어씁니다.

자주 쓰는 ComfyUI 파이프라인을 모듈 그래프 워크플로우 안에서 재사용할 때 유용합니다.

## 운영 팁

- 처음에는 prompt, negative, seed, 입력 이미지만 Marked Field로 엽니다.
- 모델 파일명은 select + 드롭다운 목록으로 만듭니다.
- seed는 number 필드로 열고 기본값을 고정하거나 비워 둡니다.
- 실험용 서버와 운영용 서버는 routing tag를 분리합니다.
- 대형 워크플로우는 큐 등록 개수를 낮게 시작합니다.
- artifact explorer를 쓸 워크플로우는 저장 루트를 명확히 정합니다.
- 공개 페이지는 큐 상한을 낮게 잡고 권한을 확인합니다.

## 실패 시 확인

| 증상 | 확인 |
| --- | --- |
| 서버 테스트 실패 | Endpoint, 포트, 방화벽, ComfyUI 실행 상태 |
| Modal 호출 실패 | `/generate` 엔드포인트, 인증, 원격 로그, 비용 제한 |
| 워크플로우 저장 실패 | JSON 형식, API workflow 여부, 이름 입력 여부 |
| 실행 버튼 후 실패 | required 필드, 이미지 입력, 선택 서버 연결 상태 |
| 모델을 찾지 못함 | 서버의 모델 폴더와 드롭다운 값이 실제 파일명과 일치하는지 |
| 커스텀 노드 오류 | 해당 서버에 필요한 ComfyUI 커스텀 노드가 설치되어 있는지 |
| 결과가 안 보임 | 결과 표시 방식, 저장 루트, artifact directory 설정 |
| 큐가 밀림 | 서버 capacity, running/pending 수, 예약작업 상태 |

## 함께 보기

- [이미지 생성 개요](./GENERATION_OVERVIEW.md)
- [Codex 생성](./CODEX_GENERATION.md)
- [워크플로우 편집](./WORKFLOW_EDITOR.md)

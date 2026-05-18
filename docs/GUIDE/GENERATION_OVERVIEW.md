# 이미지 생성 개요

이미지 생성 페이지는 NAI, Codex, ComfyUI, 모듈 워크플로우, 예약작업을 한곳에서 다룹니다.

## 위치

`/generation`

## 탭 구조

| 탭 | 설명 | 자세히 |
| --- | --- | --- |
| NAI | NovelAI 기반 생성 | [NAI 생성](./NAI_GENERATION.md) |
| Codex | Codex CLI 기반 생성·편집·인페인트 | [Codex 생성](./CODEX_GENERATION.md) |
| ComfyUI | ComfyUI 워크플로우 실행 | [ComfyUI 생성](./COMFYUI_GENERATION.md) |
| 워크플로우 | 모듈 그래프 기반 워크플로우 편집 | [워크플로우 편집](./WORKFLOW_EDITOR.md) |
| 예약작업 | 예약 실행과 큐 정책 관리 | 설정/예약 화면에서 관리 |

## 화면 구조

데스크톱에서는 왼쪽 컨트롤 패널과 오른쪽 결과 패널이 나뉘어 표시됩니다.

모바일에서는 결과를 먼저 보고, 하단 컨트롤 드로어로 생성 설정을 엽니다.

## 어떤 탭을 써야 하나

| 목적 | 추천 탭 |
| --- | --- |
| NovelAI와 비슷한 방식으로 빠르게 생성 | NAI |
| 자연어 지시로 생성·편집·인페인트 | Codex |
| 고정된 모델/노드/파이프라인으로 반복 생성 | ComfyUI |
| 여러 도구와 조건을 엮은 자동화 흐름 | 워크플로우 |
| 특정 시간이나 반복 조건으로 실행 | 예약작업 |

## 생성 이력

NAI, Codex, ComfyUI 생성 결과는 생성 이력 패널에서 확인합니다.

확인 항목:

- 생성 상태
- 결과 이미지/비디오
- 실패/취소 여부
- 워크플로우 결과물
- 재실행 가능 여부

ComfyUI 워크플로우가 탐색형 결과 보기를 사용하면 artifact explorer에서 산출물을 확인합니다.

## 큐와 예약작업

CoNAI는 생성 작업을 큐로 관리합니다.

- 사용자 직접 생성 큐
- Codex 생성 큐
- ComfyUI 서버 라우팅 큐
- 워크플로우 실행 큐
- 예약작업 큐
- 동시 실행 수와 휴식 시간 정책

관련 설정은 설정 → 미디어 생성/저장에서 관리합니다.

## 다음 문서

- [NAI 생성](./NAI_GENERATION.md)
- [Codex 생성](./CODEX_GENERATION.md)
- [ComfyUI 생성](./COMFYUI_GENERATION.md)
- [워크플로우 편집](./WORKFLOW_EDITOR.md)
- [설정 전체 지도](./SETTINGS_OVERVIEW.md)

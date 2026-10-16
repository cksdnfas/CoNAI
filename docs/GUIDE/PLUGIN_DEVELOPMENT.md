# 플러그인 제작 가이드

확인: 2026-10-16, 현재 작업 트리 기준.

CoNAI의 화면·내부 자료·AI·백그라운드 작업을 연결하는 플러그인을 만드는 개발자와 AI를 위한 안내입니다. 이 문서는 Git으로 공유하며, 개인 플러그인 제작 중 추가한 **메인 앱의 공용 연결**도 여기에서 관리합니다. 현재 작업 트리의 연결이 과거 배포 버전에도 있다고 가정하지 말고 설치할 호스트의 구현을 확인하세요.

| 문서 | 역할 |
| --- | --- |
| [AI 개발 가이드](../../AI_Guidelines.md) | 개발 정책과 필수 기준 |
| 이 문서 | 제작 순서, 연결 선택, 공용 확장 기록 |
| [플러그인 SDK 계약](../../plugins/README.md) | 메서드·입출력·제한·실행 경계의 상세 명세 |
| [개발 구조](../../DEVELOPMENT.md#선택-설치-확장) | 메인 코드 탐색 지도 |
| [선택 설치 확장](./PLUGINS.md) | 사용자의 설치·실행·설정 방법 |

## 1. 소스 위치와 구현 범위

| 대상 | 위치와 원칙 |
| --- | --- |
| 공개 플러그인·개발 예제 | `plugins/<id>/`. Git에 포함합니다. |
| 개인 플러그인 | `local-plugins/<id>/`. Git과 기본 Docker 빌드에서 제외합니다. |
| 개인 전용 렌더러·테스트·문서 | `local-plugins/` 아래에 별도로 보관합니다. 공개 코드·테스트가 이 파일을 요구하면 안 됩니다. |
| 공용 SDK·호스트 연결 | `plugins/sdk/`, `shared/`, `backend/`, `frontend/`의 기존 플러그인 경로를 확장합니다. Git에 포함하고 이 문서에 기록합니다. |

플러그인의 화면, 템플릿, 제작 규칙, 외부 엔진별 처리는 패키지에 둡니다. 메인 앱은 다른 플러그인도 재사용할 파일·미디어·AI·작업 연결과 기존 도메인 검증을 담당합니다. 필요하지 않은 범용 계층을 미리 만들지 않습니다.

기존 SDK와 네이티브 도구/API로 요청을 완성할 수 있는지 먼저 확인합니다. 연결이 없으면 필요한 공용 경로를 최소한으로 확장합니다. 플러그인 화면을 메인 React 번들에 직접 삽입하거나 플러그인별 별도 저장·LLM 실행 엔진을 만드는 방식은 피합니다.

## 2. 패키지 만들기

작업과 가까운 실행 예제부터 읽으세요.

| 예제 | 참고할 기능 |
| --- | --- |
| [text-editor](../../plugins/text-editor/plugin.json) | 파일 읽기, 초안, 페이지 어시스턴트, 저장 검토 |
| [app-workbench](../../plugins/app-workbench/README.md) | 기존 앱 도구, 프로젝트 연결, 화면 없는 서버 작업 |
| [chat-instructions](../../plugins/chat-instructions/server.mjs) | Node 서버 모듈, 전용 DB, 훅, MCP 도구 등록 |
| [generation-helper](../../plugins/generation-helper/plugin.json) | 기존 화면의 레이아웃 블록·생성 버튼과 큐 이벤트 |

패키지 루트에는 `plugin.json`, 진입 HTML, 외부 JS/CSS 파일을 둡니다. 서버 처리가 필요하면 manifest에 `"server": { "entry": "server.mjs" }`를 선언하고 `activate(conai)`를 내보냅니다. 페이지 스크립트는 `connectPlugin(handlers)`로 연결하고 공용 `conai-plugin.css`와 `--conai-*` 테마 변수를 사용합니다. 한국어 UI 문구는 반말로 작성합니다.

Manifest의 `id`와 페이지 ID는 안정적으로 유지하고, 업데이트할 때 `version`을 올립니다. 페이지 작업은 `<pluginId>.<action>` ID, 설명, 입력 스키마, `effect: 'draft'`, `tier: 'view' | 'draft'`를 등록합니다. `pages[].actions`의 스키마는 **CoNAI 페이지 스키마**입니다. 정수는 `{ "type": "number", "integer": true }`로 표현합니다. 서버의 `conai.tools.register`가 받는 JSON Schema와 혼동하지 마세요. 실제 검증기는 [chatPageAction.ts](../../shared/src/utils/chatPageAction.ts)에 있습니다.

저장소 루트에서 패키지를 만듭니다.

```sh
# 공개 예제
node scripts/build-plugin.mjs text-editor
# 개인 플러그인: local-plugins/my-plugin/
node scripts/build-plugin.mjs --local my-plugin
```

출력은 각각 `build-output/plugins/`, `build-output/local-plugins/`입니다. 빌드 스크립트가 SDK JS/CSS를 함께 넣습니다. 현재 스크립트는 패키지 폴더에서 Markdown만 제외하므로 `node_modules`, 테스트, 실행 바이너리, Docker 빌드 문맥은 ZIP 대상 폴더 밖에 두세요. ZIP은 압축 8MiB·해제 16MiB·개별 파일 4MiB·256개 항목 제한이 있으며 패키지 관리자 설치 훅은 실행하지 않습니다. 상세 허용 형식은 [Package contract](../../plugins/README.md#package-contract)를 따릅니다.

관리자가 **설정 → 플러그인**에서 ZIP을 설치·활성화한 뒤 **확장**에서 실행합니다. 기존 ID에 업로드하면 업데이트되며 데이터가 유지됩니다. 제거는 전용 데이터도 삭제하므로 업데이트 전에 제거하지 않습니다. 메인 연결도 바꿨다면 호스트 빌드·재시작과 플러그인 ZIP 업데이트를 함께 안내하세요.

## 3. 필요한 연결 선택하기

브라우저의 `api`와 서버 모듈의 `conai`는 서로 다른 실행 문맥입니다.

| 필요 | 우선 사용할 연결 |
| --- | --- |
| 현재 화면을 AI가 조회·선택·편집 | manifest의 페이지 작업 + `connectPlugin(handlers)` + `api.publish` |
| 기존 앱 도구 실행 | 브라우저 `api.app.tools/call/run`, 서버 `conai.tools.list/call` |
| 기존 HTTP 기능·업로드·스트리밍 | 브라우저 `api.app.fetch`, 다운로드는 `api.app.download` |
| 파일·연결 프로젝트 편집 | `files.*`, `workspace.*`, 기존 파일/프로젝트 도구와 리비전 검사 |
| 작은 설정·변경 이벤트·이동 | `api.storage`, `api.events`, `api.navigation` |
| 모델의 단일 답변 | `api.llm` 또는 `conai.llm`의 기본 `text` 모드 |
| AI가 도구를 골라 실제 작업 | 같은 LLM API의 `mode: 'profile'` |
| 플러그인 고유 서버 기능을 AI/MCP에 노출 | `conai.tools.register`; 등록 이름은 `p_<pluginId>_<name>` 형식이며 pluginId의 `-`를 `_`로 변환 |
| 오래 걸리는 처리 | `conai.onJob` + `conai.jobs.start/get/cancel` |
| 처리에 내부 원본 사용·결과 등록 | 서버 `conai.media.resolve/save`; 화면 재생은 `api.media.open`, `files.media`, `workspace.media` |

`serverActions`는 manifest에서 기존 앱 도구에 입력을 연결하는 계약입니다. `conai.tools.register`는 실행 중인 서버 모듈의 함수를 도구로 등록합니다. 등록 시점과 입력 계약이 다르므로 서로 대체 가능한 선언으로 가정하지 마세요.

화면은 `sandbox="allow-scripts"`인 격리 iframe입니다. 직접 인증 API 요청, 외부 CDN, 내부 iframe, 브라우저 worker, localStorage/IndexedDB를 사용할 수 있다고 가정하면 안 됩니다. 의존성은 로컬 정적 자산으로 번들하고, 네이티브 호출은 호스트 브리지를 사용합니다. 상세 경계는 [Browser boundary](../../plugins/README.md#browser-boundary)를 참고하세요.

## 4. AI가 실제 기능을 사용할 수 있게 만들기

화면의 **조회 → 대상 선택 → 입력/편집 → 실행 → 결과 확인**을 같은 도메인 처리에 연결합니다. 페이지 제목이나 이동 링크만 제공한 상태를 AI 지원 완료로 기록하지 않습니다.

- 화면 상태에는 안정된 대상 ID, 현재 리비전, `dirty`, 필요한 발췌·작업 ID만 제공합니다. 원문 전체·바이너리·비밀값·인증 URL을 반복 전송하지 않습니다.
- 조회는 `view`, 초안 변경은 `draft`로 선언합니다. 플러그인이 `direct`를 선언할 수는 없습니다. 저장·실행은 기존 호스트/API 경로를 사용하고 페이지 어시스턴트가 요청한 변경과 명시적 `propose*` 검토를 유지합니다.
- UI와 도구가 같은 함수·검증을 호출하게 합니다. 서버 도구에는 실제 입력 검증과 기능 권한 확인이 필요합니다. `scope` 선언만으로 인자·소유권 검증이 끝나지 않습니다.
- 화면 없이 실행할 기능은 서버 도구와 상태 조회를 제공합니다. 브라우저 작업에는 현재 페이지 연결이 필요하다는 점을 명시합니다.
- `mode: 'profile'`은 기존 채팅 엔진·도구 카탈로그·프로필 권한·검토를 사용합니다. 별도 에이전트 루프를 만들지 말고 `profileRun`의 실제 도구 결과와 작업 상태로 성공을 판단합니다.
- 도구·임베딩·외부 렌더러가 없는 경우 필요한 설정과 다음 행동을 알립니다. 실제 설치되지 않은 기능을 기본 제공으로 설명하지 않습니다.

설치·활성화한 플러그인은 앱 기능입니다. `capabilities`·`appTools`는 별도 권한 부여 목록이 아니며, 서버 모듈이 없어도 기존 권한으로 앱 API와 LLM을 사용할 수 있습니다. 개인 채팅·세션·작업의 계정 경계와 인스턴스 공용 파일함의 정책은 [보안과 권한](./SECURITY_AND_PERMISSIONS.md)을 따릅니다.

## 5. 내부 이미지·영상·오디오 사용하기

검색과 원본 해석, 화면 미리보기를 구분합니다.

1. 기존 `search_images`로 프롬프트·그룹·`media_type`을 지정해 필요한 범위만 검색합니다. 태그는 `search_images_by_tags`, 장면 설명은 임베딩이 준비된 경우 `search_images_by_meaning`을 사용합니다. 파일함은 `search_files`, 오디오는 기존 오디오 조회 도구를 사용합니다.
2. 검색된 실제 ID로 후보를 확인합니다. 필요하면 `get_image_metadata`, `view_images`, `view_media_frames`를 사용하며 프로필·모델·도구 지원 범위를 확인합니다. 검색 결과의 짧은 설명만으로 시각 내용을 확인했다고 보고하지 않습니다.
3. 프로젝트에는 `{source:'library', compositeHash}`, `{source:'files', fileId}`, `{source:'audio', candidateId}` 같은 안정된 참조를 저장합니다. 만료되는 재생 URL과 원본 절대 경로를 영구 참조로 사용하지 않습니다.
4. 신뢰된 서버 모듈은 `conai.media.resolve(reference)`로 현재 권한에 맞는 원본과 `fingerprint`를 얻습니다. 반환된 경로는 서버 내부에만 두고 원본 복사·사용 전후 및 결과 등록 전에 변경 여부를 검사합니다. 이 함수 자체가 원본 복사나 원본 버전 고정을 수행하지는 않습니다.
5. 처리 결과는 플러그인 데이터 폴더에 만든 뒤 `conai.media.save({path, groupPath?})`로 기존 라이브러리에 등록합니다. 원본을 보존하고 결과와 사용한 원본 참조·리비전을 연결합니다.

서버의 `conai.media`와 브라우저의 `api.media.open`을 혼동하지 마세요. `resolve`는 현재 계정의 해당 소재 조회 권한을 검사하며, `save`는 `images.view`, `images.upload`, `images.edit`를 요구합니다. `save`의 `path`는 해당 패키지 데이터 폴더 내부 상대 경로이고 링크·경로 탈출·크기 제한 검사를 거칩니다. 세부 형식과 한도는 [Server processing jobs and internal media](../../plugins/README.md#server-processing-jobs-and-internal-media)에 있습니다.

## 6. 긴 작업과 외부 실행 환경

`conai.onJob(async (data, { signal, jobId, account, report }) => result)`에 처리를 등록하고 `conai.jobs.start({requestId, data})`로 시작합니다. 즉시 반환된 ID로 `get/cancel`을 사용하고 `report({percent, phase?, message?})`로 진행률을 전달합니다. 현재 `conai.jobs`는 `generation.execute` 권한이 필요합니다.

동일 입력을 복구 조회할 때 같은 요청 ID를 유지하고, 의도적인 새 실행에만 새 ID를 사용합니다. 실패·취소·만료를 자동 재실행으로 바꾸지 않습니다. 저장 충돌은 최신 리비전을 다시 읽어 해결하고, 응답을 기다리는 요청 취소와 이미 접수된 영구 작업 취소를 구분합니다. 취소는 이미 완료한 저장·외부 비용을 되돌리지 않습니다.

Node 서버 모듈은 파일·네트워크·프로세스 접근이 가능한 신뢰된 앱 코드이며 보안 샌드박스가 아닙니다. 모델이 만든 코드나 외부 프로젝트를 실행하는 렌더러는 별도 격리 환경에 필요한 자료만 전달합니다. 설치 파일·대용량 의존성을 ZIP에 억지로 넣지 말고 별도 런타임 설치 방법, 지원 OS, 호스트/Docker 간 경로 매핑, 준비 상태 확인을 패키지 문서에 적습니다. 자식 프로세스에도 동시 실행·메모리·시간 상한과 중단·임시 파일 정리를 구현합니다.

## 7. 메인 공용 연결을 확장할 때의 기록 규칙

**플러그인 작업 때문에 메인 코드를 확장하거나 기존 공용 계약을 바꾸면, 같은 작업에서 이 문서의 공용 연결 목록과 해당 설명을 반드시 갱신합니다.** 개인 플러그인이 계기여도 공용 변경 기록은 Git 문서에 남깁니다. 개인 패키지의 README나 최종 작업 보고만으로 대체하지 않습니다.

대상은 신규 HTTP 라우트뿐 아니라 SDK 메서드, MessageChannel 브리지, 공유 타입·검증, MCP 도구, 서버 서비스, 저장·미디어 접근, 작업 실행·취소·종료 경로를 포함합니다. 구현 없이 문서만 바꿔 권한·승인 정책을 확장하지 않습니다.

공용 연결을 추가·수정할 때 다음 내용을 해당 항목에 반영합니다. 별도의 작업별 보고서를 늘리지 말고 기존 설명을 최신 상태로 고칩니다.

| 기록할 내용 | 포함할 정보 |
| --- | --- |
| 필요와 책임 | 기존 연결로 부족했던 점, 메인이 담당하는 공용 기능과 패키지에 남는 기능 |
| 호출 계약 | 브라우저/서버 메서드 또는 도구 이름, 핵심 입력·결과, SDK 상세 항목 링크 |
| 구현 위치 | 변경한 공유 타입·브리지·라우트·서비스·호출부 링크 |
| 실행 경계 | 계정·기능 권한, 승인, 경로, 리비전, 중복 방지, 실패·취소·재시작 의미 |
| 호환성과 배포 | 호스트/SDK 업데이트 필요 여부, 지원 확인 방법, 이전 버전에서의 동작과 미지원 범위 |
| 검증 | 관련 기존 테스트 또는 중요한 영구 회귀 테스트, 실제 확인한 경로와 미검증 범위 |

세부 API는 [SDK 계약](../../plugins/README.md), 코드 탐색 지점은 [DEVELOPMENT.md](../../DEVELOPMENT.md), 사용자가 겪는 변경은 [PLUGINS.md](./PLUGINS.md)도 함께 갱신합니다. 비밀값·개인 파일 경로·개인 플러그인 소스는 공용 기록에 넣지 않습니다.

### 현재 공용 연결 목록

현재 목록은 기능별 계약의 색인입니다. 새로운 연결은 행을 추가하고, 기존 연결을 바꿨다면 해당 행과 설명을 수정합니다. 일회성 작업 이력이나 출시 완료 목록으로 사용하지 않습니다.

| 공용 연결과 책임 | 호출 계약 | 메인 구현·검증 |
| --- | --- | --- |
| 격리 화면·페이지 어시스턴트 | `connectPlugin`, `api.publish`, manifest 페이지 작업. 화면 리비전·검토 경계를 호스트에서 관리 | [공유 타입](../../shared/src/types/plugin.ts), [페이지 호스트](../../frontend/src/features/plugins/plugin-page.tsx), [서버 호스트](../../backend/src/services/plugins/pluginHost.ts), [경계 테스트](../../backend/test/plugins.test.ts) |
| 기존 앱 도구·HTTP·스트림 | `api.app.*`, `conai.tools.*`, `serverActions`. 기존 도메인 서비스와 계정 권한을 재사용 | [HTTP 경로 정책](../../shared/src/utils/pluginNativeApi.ts), [네이티브 연결](../../frontend/src/features/plugins/plugin-native-api.ts), [앱 도구 브리지](../../backend/src/services/plugins/pluginAppBridge.ts), [앱 작업](../../backend/src/services/plugins/pluginAppActions.ts), [SDK 테스트](../../frontend/test/plugin-sdk.test.ts) |
| 연결 프로젝트·저장 | `workspace.*`. 실제 공용 프로젝트의 리비전·쓰기 잠금·검토를 재사용 | [프로젝트 연결](../../backend/src/services/plugins/pluginWorkspace.ts), [WorkspaceService](../../backend/src/services/workspaceService.ts), [경계 테스트](../../backend/test/plugins.test.ts) |
| AI 프로필 실행 | `api.llm` / `conai.llm`, `text`와 `profile`. 기존 모델 실행·사용량·도구·대화 경계를 재사용 | [LLM 연결](../../backend/src/services/plugins/pluginLlm.ts), [프로필 실행](../../backend/src/services/plugins/pluginProfileRun.ts), [서버 테스트](../../backend/test/plugin-server.test.ts) |
| 서버의 긴 처리 작업 | `conai.onJob`, `conai.jobs.start/get/cancel`. 별도 큐 없이 `plugin-task` 런타임 작업 사용 | [작업 서비스](../../backend/src/services/plugins/pluginTasks.ts), [서버 실행·종료](../../backend/src/services/plugins/pluginServerRuntime.ts), [작업 타입](../../shared/src/types/runtimeJob.ts), [서버 테스트](../../backend/test/plugin-server.test.ts) |
| 내부 원본 처리·결과 등록 | `conai.media.resolve/save`. 프로젝트의 원본 해석과 네이티브 미디어 등록을 재사용. 화면에는 `api.media.open` 등으로 재생 링크만 전달 | [서버 미디어 연결](../../backend/src/services/plugins/pluginServerMedia.ts), [공유 원본 해석](../../backend/src/services/plugins/pluginWorkspace.ts), [화면 결과 미디어](../../backend/src/services/plugins/pluginArtifactMedia.ts), [서버 테스트](../../backend/test/plugin-server.test.ts) |
| 설정·변경 이벤트·이동 | `api.storage/events/navigation`. 설정 CAS, 기존 SSE와 호스트 이동 경로 사용 | [설정 저장](../../backend/src/services/plugins/pluginStorage.ts), [SDK](../../plugins/sdk/conai-plugin.js), [페이지 호스트](../../frontend/src/features/plugins/plugin-page.tsx), [SDK 테스트](../../frontend/test/plugin-sdk.test.ts) |

긴 처리와 내부 미디어 연결은 영상 렌더링처럼 브라우저 요청 하나로 끝내기 어려운 기능을 위해 추가한 공용 경로입니다. 엔진 선택·명령 인자·제작 화면은 플러그인이 담당하고, 메인은 요청 계정과 작업 상태·중복 실행·원본 접근·라이브러리 등록을 담당합니다. 이를 사용하는 패키지는 해당 메서드를 포함한 호스트가 필요하며 `apiVersion: 1`만으로 지원 여부를 판단하지 않습니다. 브라우저 기능은 `api.host.features`/`api.supports`를 확인하고, 서버 전용 연결은 메서드 존재와 실행 준비 상태를 확인해 업데이트 필요를 안내합니다.

현재 공용 회귀 테스트는 계정 경계, 동일 작업 재요청, 실행 겹침, 취소, 파일 원본 접근과 권한 회수, 결과 경로 탈출 거부를 포함합니다. 외부 렌더러의 실제 출력과 개별 패키지의 UI·모델 호출은 패키지별로 별도 검증합니다. 공개 테스트의 통과만으로 개인 플러그인의 전체 실행을 검증했다고 보고하지 않습니다.

## 8. 검증과 전달

변경 범위에 해당하는 기존 검사만 실행합니다.

| 변경 | 확인 방법 |
| --- | --- |
| 패키지·권한·저장·서버 연결 | `npx tsx --test backend/test/plugins.test.ts backend/test/plugin-server.test.ts` |
| 브라우저 SDK 프로토콜 | frontend 디렉터리에서 `npx tsx --test test/plugin-sdk.test.ts` |
| 공유 타입·호스트 코드 | `npm run build:shared`, 영향받은 backend/frontend 타입 검사·린트·빌드 |
| 문서 | 링크와 실제 계약 대조, `npm run docs:build` |
| 개인 엔진·미디어 출력 | 개인 패키지의 중요한 회귀 검사와 실제 실행. 공개 테스트는 개인 파일에 의존하지 않음 |

실제 흐름에서 소재 조회·선택, 저장 충돌, 작업 ID와 완료 결과, 취소·원본 변경을 확인합니다. 필요한 외부 비용은 사용자가 허용한 범위에서만 사용합니다. 낮은 가치의 일회성 테스트·하네스를 만들지 않습니다.

전달할 때는 ZIP, 필요한 호스트·런타임 업데이트, 설치·활성화 방법, AI에 허용해야 할 도구, 검증 결과와 남은 제약을 짧게 안내합니다. 메인 공용 연결도 바꿨다면 이 문서에서 갱신한 항목을 함께 알려주세요.

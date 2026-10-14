# Docker로 실행

CoNAI는 저장소 루트의 `Dockerfile`과 `compose.yaml`로 컨테이너 하나에 백엔드·프론트엔드·태거를 함께 띄울 수 있습니다. 기본 이미지는 **CPU 전용**이고, NVIDIA GPU는 별도 빌드로 선택합니다.

## 요구사항

| 항목 | 기준 |
| --- | --- |
| Docker | Docker Engine 또는 Docker Desktop, Compose v2 |
| 디스크 | 이미지 빌드용 수 GB + 미디어 저장 공간 |
| 네트워크 | 첫 실행 시 태거 모델을 Hugging Face에서 내려받음 |
| GPU (선택) | NVIDIA 드라이버, Linux는 NVIDIA Container Toolkit, Windows는 Docker Desktop WSL2 백엔드 |

## CPU로 실행 (기본)

```bash
docker compose up -d --build
```

- 접속 주소: `http://localhost:1666` (프론트엔드도 같은 포트에서 제공)
- 데이터: `conai-data` 볼륨 → 컨테이너의 `/app/data/user`
- 상태 확인: `docker compose ps`에서 `healthy`, 로그는 `docker compose logs -f conai`

태그 추출(WD Tagger)과 작가 추출(Kaloscope 3)은 CPU에서도 동작합니다. 한 장씩 올리는 용도로는 충분하지만, 기존 이미지 수천 장을 처음 등록하면 자동 태깅이 끝날 때까지 몇 시간이 걸릴 수 있습니다. 8스레드 CPU 기준으로 WD는 장당 약 0.3초, Kaloscope 3은 약 0.6초입니다. PixAI 태거는 GPU 이미지에서만 고를 수 있습니다.

이미지 안의 Python 환경(`/opt/conai-ai`)은 **설정 › 자동 › AI 런타임**에서 앱이 직접 설치하는 환경과 같은 구성(uv가 받은 Python 3.12 + PyTorch)입니다.

## NVIDIA GPU로 실행 (선택)

GPU 이미지는 `runtime-gpu` 빌드 단계를 사용합니다. 일반 `docker build .`나 `compose.yaml`만으로는 CPU 이미지가 만들어집니다.

```bash
docker compose -f compose.yaml -f compose.gpu.yaml up -d --build
```

### GPU 세대에 맞는 CUDA 빌드 고르기

`runtime-gpu`는 빌드 인자 `TORCH_BACKEND`로 PyTorch CUDA 빌드를 고릅니다. compose에서는 환경 변수 `CONAI_TORCH_BACKEND`로 넘깁니다.

| 값 | 대상 GPU | 드라이버 |
| --- | --- | --- |
| `cu130` (기본) | RTX 20 시리즈 이상 (RTX 50 시리즈 포함) | 580 이상 |
| `cu126` | GTX 900/1000, V100, 또는 드라이버를 580 이상으로 올릴 수 없을 때 | 560 이상 |
| `cu132` | `cu130`과 같은 범위 (직접 고를 때만) | 580 이상 |

```bash
CONAI_TORCH_BACKEND=cu126 docker compose -f compose.yaml -f compose.gpu.yaml up -d --build
```

### GPU가 실제로 쓰이는지 확인

```bash
docker compose exec conai nvidia-smi
docker compose exec conai /opt/conai-ai/bin/python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_arch_list())"
```

| 확인 항목 | 정상 | CPU로 떨어진 상태 |
| --- | --- | --- |
| `nvidia-smi` | GPU 이름 표시 | 명령 실패 → 컨테이너에 GPU가 전달되지 않음 |
| `torch` | `True`, 버전에 `+cu` 포함, 목록에 GPU의 `sm_` 번호 포함 | `+cpu` 또는 `False` → CPU 이미지이거나 CUDA 빌드가 GPU와 맞지 않음 |

설정 → 태거·Kaloscope의 장치가 `auto`이면 GPU를 먼저 쓰고, GPU를 쓸 수 없을 때 CPU로 넘어갑니다. 로그의 `[AiVisionWorker] ready (… cuda true …)` 줄로도 확인할 수 있습니다. 임베딩(채팅 의미 검색·이미지 검색)은 GPU 이미지에서도 CPU로 돕니다.

## 처음 관리자 계정 만들기

관리자 계정이 없을 때 초기 설정은 **컨테이너 내부(루프백)** 요청만 받습니다. Docker 네트워크를 거친 브라우저 요청은 외부 요청으로 취급되므로, 처음 한 번은 컨테이너 안에서 계정을 만듭니다.

```bash
docker compose exec conai sh
# 컨테이너 안에서
curl -s -X POST http://127.0.0.1:1666/api/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"충분히-긴-비밀번호"}'
exit
```

원격에서 만들어야 하면 `CONAI_SETUP_TOKEN` 환경 변수를 설정하고, 같은 요청에 `x-conai-setup-token` 헤더를 붙입니다. 계정을 만든 뒤에는 토큰을 지우세요.

## Codex 로그인

이미지에 Codex CLI가 들어 있습니다. 관리자 계정으로 생성 → Codex 탭을 열고, `로그인 필요` 옆 로그인 버튼을 누르면 일회용 코드와 인증 페이지 링크가 뜹니다. 아무 브라우저에서 인증 페이지를 열어 코드를 입력하면 자동으로 적용됩니다.

앱 대신 터미널에서 해도 됩니다.

```bash
docker compose exec conai codex login --device-auth
```

로그인 정보는 볼륨의 `/app/data/user/codex`(`CODEX_HOME`)에 저장되므로 이미지를 다시 빌드해도 유지됩니다. 이 폴더에는 계정 토큰이 들어 있으니 볼륨 백업을 다룰 때 주의하세요.

CLI 업데이트는 Codex 탭 상태 옆의 업데이트 버튼(관리자, 새 버전이 있을 때)으로 합니다. 업데이트본은 볼륨의 `/app/data/user/codex-cli`에 설치되어 컨테이너를 다시 만들어도 남습니다.

::: warning Codex sandbox
Docker 기본 설정은 Codex의 Linux sandbox(bwrap)가 쓰는 user namespace를 막습니다. 그래서 이미지는 `CODEX_SANDBOX_MODE=danger-full-access`로 Codex를 sandbox 없이 실행하고, 컨테이너 자체를 격리 경계로 씁니다. 이 상태에서 Codex는 컨테이너 안 파일(`/app/data/user` 포함)에 접근할 수 있으므로, Codex 생성 권한은 신뢰하는 계정에만 주세요.
:::

## Claude Code 로그인과 업데이트

이미지에 Claude Code CLI도 포함됩니다. 관리자 계정으로 **설정 → LLM → CLI 인증과 업데이트**에서 설치 버전·인증 상태를 확인하고 로그인합니다. 인증 페이지가 코드를 표시하면 로그인 창에 붙여넣습니다. 터미널에서도 로그인할 수 있습니다.

```bash
docker compose exec conai claude auth login --claudeai
```

로그인 정보는 `CLAUDE_CONFIG_DIR=/app/data/user/claude`에 보관합니다. 앱에서 설치·업데이트한 CLI는 `/app/data/user/claude-cli`에 저장하므로 기존 데이터 볼륨 하나로 유지됩니다. 이미지 설치본과 업데이트본 중 최신 버전을 실행합니다. 진행 중인 Claude 작업이나 로그인이 있으면 업데이트를 거절합니다. CLI 자체 업데이트는 비활성화하고 앱의 업데이트 기능으로 관리합니다.

자동화용 OAuth 토큰은 `claude setup-token`으로 발급해 `CLAUDE_CODE_OAUTH_TOKEN` 환경 변수에 넣을 수도 있습니다. API 인증은 `ANTHROPIC_API_KEY`를 사용합니다. 키·토큰을 이미지나 저장소에 포함하지 않습니다. OAuth 토큰의 만료·교체는 관리자가 처리합니다. 제3자 제품에서 claude.ai 로그인·구독 한도를 제공하는 사용에는 Anthropic 사전 승인이 필요하다는 [공식 연동 안내](https://code.claude.com/docs/en/agent-sdk/overview#get-started)를 확인하세요.

Claude 채팅은 별도의 전용 홈에서 기본 파일·셸 도구를 끄고 허용된 CoNAI 도구만 제공합니다. Codex 이미지 생성의 `CODEX_SANDBOX_MODE`는 Claude 채팅에 적용하지 않습니다.

## 감시 폴더 연결

컨테이너는 호스트 폴더를 직접 볼 수 없습니다. 감시할 폴더를 `compose.yaml`의 `volumes`에 추가하고, CoNAI의 감시 폴더에는 **컨테이너 안 경로**를 등록합니다.

```yaml
services:
  conai:
    volumes:
      - conai-data:/app/data/user
      - D:/AI/outputs:/mnt/outputs   # 호스트 경로:컨테이너 경로
```

설정 → 감시 폴더에서 `/mnt/outputs`를 등록합니다.

## 환경 변수

컨테이너 환경 변수는 저장소의 `.env`가 아니라 `compose.yaml`의 `environment`(또는 배포 도구의 환경 변수 설정)에서 지정합니다.

| 변수 | 이미지 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `1666` | 컨테이너 안 포트 |
| `RUNTIME_BASE_PATH` | `/app/data/user` | 데이터 루트. 볼륨 경로와 맞춰야 함 |
| `TRUST_PROXY` | `1` | 앞단 리버스 프록시 신뢰 단계. 프록시 없이 포트를 바로 공개하면 `false`로 설정 |
| `PUBLIC_BASE_URL` | 없음 | 외부 공개 주소. 허용 origin과 외부 접속 판단에 사용 |
| `CONAI_SETUP_TOKEN` | 없음 | 원격 초기 관리자 생성용 일회성 토큰 |
| `HF_TOKEN` | 없음 | Hugging Face 모델 다운로드 속도 제한 완화(선택) |
| `CODEX_HOME` | `/app/data/user/codex` | Codex CLI 로그인 정보·설정 위치 |
| `CLAUDE_CONFIG_DIR` | `/app/data/user/claude` | Claude Code 로그인 정보·설정 위치 |
| `CLAUDE_NPM_PREFIX` | `/app/data/user/claude-cli` | 앱에서 설치·업데이트한 Claude Code 위치 |
| `CODEX_NPM_PREFIX` | `/app/data/user/codex-cli` | 앱에서 업데이트한 Codex CLI 설치 위치 |
| `CODEX_SANDBOX_MODE` | `danger-full-access` | `codex exec --sandbox` 값. 컨테이너 밖 기본값은 `workspace-write` |

::: warning 프록시 없이 공개할 때
`TRUST_PROXY=1`인 상태에서 리버스 프록시 없이 포트를 바로 열면, 클라이언트가 `X-Forwarded-For` 헤더로 IP를 속일 수 있습니다. 또 Docker Desktop의 브리지 네트워크에서는 모든 접속이 같은 게이트웨이 IP(예: `172.x.0.1`)로 보여서, IP 기준 속도 제한이 방문자 전체에 함께 걸립니다. 방문자별 IP가 필요하면 클라이언트 IP를 넘겨주는 프록시(cloudflared, Caddy, Traefik 등)를 앞에 두고 `TRUST_PROXY=1`을 유지하세요.
:::

## Coolify로 배포

| 항목 | CPU | GPU |
| --- | --- | --- |
| Build Pack | `Dockerfile` | `Dockerfile` |
| Dockerfile Location | `/Dockerfile` | `/Dockerfile` |
| Docker Build Stage Target | 비워 둠 (`runtime` = CPU) | `runtime-gpu` |
| Build Variable | 없음 | 필요할 때만 `TORCH_BACKEND=cu126` (기본 `cu130`) |
| Custom Docker Options | 없음 | `--gpus all` |
| Ports Exposes | `1666` | `1666` |
| Persistent Storage | `/app/data/user` | `/app/data/user` |

빌드 단계 대상을 비워 두면 GPU가 있는 서버에서도 CPU 이미지가 만들어집니다. 배포 후에는 위의 [GPU 확인 명령](#gpu가-실제로-쓰이는지-확인)으로 확인하세요.

## 업데이트와 백업

### 별도 테스트 인스턴스

파일함·작업 공간·확장과 채팅 엔진 검증에는 운영 Compose와 분리된 설정을 사용합니다.

```bash
docker compose -f compose.qa.yaml up -d --build
docker compose -f compose.qa.yaml ps
```

- 주소는 `http://localhost:17666`이며 호스트의 루프백에만 공개합니다. 운영 서버의 포트와 데이터는 사용하지 않습니다.
- `conai-qa-data` 볼륨에 테스트 DB·파일·프로젝트·확장과 Codex/Claude 인증을 보존합니다. Codex는 `/app/data/user/codex`, Claude는 `/app/data/user/claude`입니다.
- 처음 관리자 계정은 위의 초기 설정 절차에서 `docker compose -f compose.qa.yaml exec conai`를 사용해 만듭니다. 로그인 후 **설정 → LLM**에서 Codex와 Claude Code 인증을 진행합니다. 로그인 진행 중에는 컨테이너를 교체하지 않습니다.
- 코드 수정 후 같은 `up -d --build` 명령으로 업데이트합니다. 볼륨을 유지하면 인증과 테스트 자료도 남습니다. `down -v` 또는 볼륨 삭제는 사용하지 않습니다. 인증 취소·토큰 갱신 실패 시에는 다시 로그인해야 합니다.
- 컨테이너에서 Windows 호스트의 API에 연결할 때는 `host.docker.internal`을 사용합니다. 다른 PC의 API는 해당 PC의 주소를 사용합니다. Pi와 직접 API 방식은 테스트 앱의 LLM 연결·모델을 별도로 지정합니다.
- 문서 편집 확장은 호스트에서 `node scripts/build-plugin.mjs text-editor`로 만든 ZIP을 테스트 앱에 설치합니다. 개별 확장은 Docker 이미지에 자동 설치하지 않습니다.

테스트 컨테이너는 고정 호스트 이름 `conai-qa`를 사용합니다. 이는 컨테이너 교체 시 이름 변경으로 인한 중단 작업 판정 문제를 줄이기 위한 설정이며, 다른 호스트의 실행 종료를 자동으로 증명하거나 임의 잠금을 해제하는 기능은 아닙니다. 실제 모델 호출, 브라우저의 저장 승인·충돌 처리, 컨테이너 재생성 후 자료·인증 유지 여부는 각각 확인해야 합니다.

로컬 접속 정보와 테스트 보조 자료를 둔 `local-docs/`는 Git과 Docker 빌드 문맥에서 제외합니다. 실제 인증 파일은 프로젝트 문서나 이미지에 복사하지 않습니다.

### 운영 인스턴스 업데이트

```bash
git pull
docker compose up -d --build        # GPU는 -f compose.yaml -f compose.gpu.yaml 추가
```

데이터는 볼륨에 남으므로 이미지를 다시 빌드해도 유지됩니다. 백업은 [데이터 경로와 백업](./DATA_PATHS_AND_BACKUP.md)을 참고하고, Docker에서는 `/app/data/user` 볼륨 전체를 백업 대상으로 잡습니다.

다음 문서: [초기 설정](./INITIAL_SETUP.md)

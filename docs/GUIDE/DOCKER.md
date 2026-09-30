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

태그 추출(WD Tagger)과 작가 추출(Kaloscope)은 CPU에서도 동작합니다. 한 장씩 올리는 용도로는 충분하지만, 기존 이미지 수천 장을 처음 등록하면 자동 태깅이 끝날 때까지 몇 시간이 걸릴 수 있습니다. 참고로 32코어 PC에서 태그와 작가 추출을 함께 돌리면 분당 약 12장이 처리됩니다.

## NVIDIA GPU로 실행 (선택)

GPU 이미지는 `runtime-gpu` 빌드 단계를 사용합니다. 일반 `docker build .`나 `compose.yaml`만으로는 CPU 이미지가 만들어집니다.

```bash
docker compose -f compose.yaml -f compose.gpu.yaml up -d --build
```

### RTX 50 시리즈는 CUDA 인덱스를 바꿔야 함

`runtime-gpu`의 기본 PyTorch 인덱스는 `cu121`입니다. 이 빌드에는 RTX 50 시리즈(Blackwell) 커널이 없어서 태거가 GPU에서 돌지 않습니다. RTX 50 시리즈는 `cu128` 인덱스로 빌드하세요. NVIDIA 드라이버 570 이상이 필요합니다.

```bash
docker compose -f compose.yaml -f compose.gpu.yaml build \
  --build-arg PYTORCH_CUDA_INDEX_URL=https://download.pytorch.org/whl/cu128
docker compose -f compose.yaml -f compose.gpu.yaml up -d
```

RTX 40 시리즈 이하는 기본값(`cu121`)으로 충분합니다.

### GPU가 실제로 쓰이는지 확인

```bash
docker compose exec conai nvidia-smi
docker compose exec conai python3 -c "import torch; print(torch.__version__, torch.cuda.is_available())"
docker compose exec conai python3 -c "import onnxruntime as o; print(o.get_available_providers())"
```

| 확인 항목 | 정상 | CPU로 떨어진 상태 |
| --- | --- | --- |
| `nvidia-smi` | GPU 이름 표시 | 명령 실패 → 컨테이너에 GPU가 전달되지 않음 |
| `torch` | `True`, 버전에 `+cu` 포함 | `+cpu` 또는 `False` → CPU 이미지이거나 CUDA 인덱스가 GPU와 맞지 않음 |
| `onnxruntime` | `CUDAExecutionProvider` 포함 | `CPUExecutionProvider`만 있음 → Kaloscope가 CPU로 동작 |

설정 → 태거의 장치가 `auto`이면 GPU를 먼저 쓰고, GPU를 쓸 수 없을 때 CPU로 넘어갑니다. 로그의 `[TaggerDaemon] Model loaded: vit on cpu` 줄로도 확인할 수 있습니다.

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
| Build Variable | 없음 | RTX 50 시리즈면 `PYTORCH_CUDA_INDEX_URL=https://download.pytorch.org/whl/cu128` |
| Custom Docker Options | 없음 | `--gpus all` |
| Ports Exposes | `1666` | `1666` |
| Persistent Storage | `/app/data/user` | `/app/data/user` |

빌드 단계 대상을 비워 두면 GPU가 있는 서버에서도 CPU 이미지가 만들어집니다. 배포 후에는 위의 [GPU 확인 명령](#gpu가-실제로-쓰이는지-확인)으로 확인하세요.

## 업데이트와 백업

```bash
git pull
docker compose up -d --build        # GPU는 -f compose.yaml -f compose.gpu.yaml 추가
```

데이터는 볼륨에 남으므로 이미지를 다시 빌드해도 유지됩니다. 백업은 [데이터 경로와 백업](./DATA_PATHS_AND_BACKUP.md)을 참고하고, Docker에서는 `/app/data/user` 볼륨 전체를 백업 대상으로 잡습니다.

다음 문서: [초기 설정](./INITIAL_SETUP.md)

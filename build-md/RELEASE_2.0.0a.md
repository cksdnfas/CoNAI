# ComfyUI Image Manager v2.0.0-alpha

AI 이미지 관리 및 분석 시스템

## 주요 변경사항 (v2.0.0)

### 새로운 기능

**외부 폴더 지원**
- 시스템의 어느 위치에 있는 폴더든 감시 및 관리 가능
- 폴더별 독립적인 스캔 설정 (자동 스캔 주기, 폴링 간격)
- 실시간 파일 감시와 주기적 폴링 방식 병행 지원
- 유연한 런타임 경로 설정 (`RUNTIME_BASE_PATH` 환경변수)

**사용자 인증 시스템**
- Argon2 기반 보안 인증
- 세션 기반 로그인/로그아웃
- 다중 사용자 지원
- 최초 실행 시 관리자 계정 자동 생성

### 핵심 기능

**AI 이미지 분석**
- ComfyUI, NovelAI, Stable Diffusion 메타데이터 자동 추출
- WD Tagger를 통한 자동 태깅 (선택적)
- 프롬프트 자동 수집 및 통계 분석
- 이미지 유사도 검색 (Perceptual Hash 기반)

**이미지 관리**
- 자동 썸네일 생성 및 최적화
- 그룹 기반 자동 분류 (정규식/문자열 매칭)
- 평점 및 즐겨찾기 관리
- 휴지통 기능 (복구 가능한 삭제)
- 비디오 파일 지원 (FFmpeg)

**생성 이력 관리**
- ComfyUI API 연동을 통한 실시간 생성 이력 추적
- 워크플로우 및 프롬프트 히스토리
- 생성 파라미터 자동 저장

**프롬프트 분석**
- 프롬프트 사용 빈도 통계
- 유의어 그룹핑
- Positive/Negative 프롬프트 분리 분석

## 기술 스택

- **Backend**: Node.js, TypeScript, Express, SQLite3
- **Frontend**: React 19, Material-UI, Vite
- **이미지 처리**: Sharp, FFmpeg
- **AI 분석**: WD Tagger (선택적)

## 보안

- Argon2 해싱을 통한 패스워드 보안
- HTTPS 지원 (자체 서명 인증서 자동 생성)
- 세션 기반 인증
- Rate limiting 적용

**Note**: 이 버전은 알파 릴리스로, 테스트 목적으로만 사용하시기 바랍니다.

# CoNAI 한눈에 보기

<div class="onepage-intro">
  <p><strong>이 문서는 원페이지 전시형 가이드</strong>로 구성합니다.</p>
  <p>위에서 아래로 읽으면서, 항목을 누르면 바로 펼쳐지고, 그 안에서 해당 영역에서 할 수 있는 기능이 주르륵 보이게 잡았습니다.</p>
  <p><strong>순서도 중요합니다.</strong> 먼저 화면에 잘 안 보이는 핵심 시스템을 두고, 그 다음에 실제 페이지를 배치했습니다.</p>
</div>

## 숨은 핵심 시스템

<div id="core-systems" class="section-anchor"></div>

<div class="onepage-grid">
  <div id="system-media-metadata" class="section-anchor"></div>
  <details class="accordion-item" open>
    <summary>미디어 메타데이터 엔진</summary>
    <div class="accordion-body">
      <p>CoNAI의 검색, 필터, 정렬, 프롬프트 분석을 떠받치는 중심 엔진입니다.</p>
      <div class="tag-row">
        <span class="tag">숨은 핵심 시스템</span>
        <span class="tag">검색 기반</span>
        <span class="tag">composite hash 중심</span>
      </div>
      <h3>여기서 담당하는 일</h3>
      <ul>
        <li>이미지와 비디오 메타데이터 저장</li>
        <li>프롬프트, 모델, 태그, 생성 파라미터 조회</li>
        <li>prompt similarity용 정규화 필드와 fingerprint 관리</li>
        <li>상세 보기와 수정 페이지의 기준 데이터 제공</li>
      </ul>
      <h3>직접 연결되는 화면</h3>
      <ul>
        <li>Home</li>
        <li>Groups</li>
        <li>Prompts</li>
        <li>Image Detail</li>
        <li>Metadata Edit</li>
      </ul>
    </div>
  </details>

  <div id="system-folder-watch" class="section-anchor"></div>
  <details class="accordion-item">
    <summary>감시폴더 등록과 스캔</summary>
    <div class="accordion-body">
      <p>실제 파일이 라이브러리에 들어오는 첫 관문입니다.</p>
      <div class="tag-row">
        <span class="tag">숨은 핵심 시스템</span>
        <span class="tag">watched folder</span>
        <span class="tag">빠른 등록</span>
      </div>
      <h3>여기서 담당하는 일</h3>
      <ul>
        <li>감시폴더 파일 탐색</li>
        <li>신규 파일 1차 빠른 등록</li>
        <li>기존 파일 상태와 수정 시각 재검증</li>
        <li>폴더 기반 자동 그룹 구조 연결</li>
      </ul>
      <h3>직접 연결되는 화면</h3>
      <ul>
        <li>Settings의 Folders 탭</li>
        <li>Groups의 폴더 그룹 뷰</li>
        <li>Home 피드 반영</li>
      </ul>
    </div>
  </details>

  <div id="system-generation-pipeline" class="section-anchor"></div>
  <details class="accordion-item">
    <summary>생성 저장 파이프라인</summary>
    <div class="accordion-body">
      <p>생성 결과를 어떤 포맷과 품질로 저장하고, 운영 파일을 어떻게 보존할지 통일하는 축입니다.</p>
      <div class="tag-row">
        <span class="tag">숨은 핵심 시스템</span>
        <span class="tag">저장 옵션</span>
        <span class="tag">RecycleBin 전략</span>
      </div>
      <h3>여기서 담당하는 일</h3>
      <ul>
        <li>포맷, 품질, 리사이즈 정책 반영</li>
        <li>다운로드용 재작성과 운영 저장 구분</li>
        <li>메타 수정 저장과 실제 파일 교체 연결</li>
        <li>보존 전략과 RecycleBin 흐름 유지</li>
      </ul>
      <h3>직접 연결되는 화면</h3>
      <ul>
        <li>Image Generation</li>
        <li>Upload</li>
        <li>Metadata Edit</li>
        <li>Settings의 Image Save 탭</li>
      </ul>
    </div>
  </details>

  <div id="system-workflow-engine" class="section-anchor"></div>
  <details class="accordion-item">
    <summary>워크플로우 실행 엔진</summary>
    <div class="accordion-body">
      <p>Workflow 기능의 진짜 본체입니다. 단순 캔버스 UI가 아니라 저장, 실행, 결과물 관리까지 맡습니다.</p>
      <div class="tag-row">
        <span class="tag">숨은 핵심 시스템</span>
        <span class="tag">그래프 실행</span>
        <span class="tag">결과물 관리</span>
      </div>
      <h3>여기서 담당하는 일</h3>
      <ul>
        <li>워크플로우 그래프 저장/불러오기</li>
        <li>노드와 엣지 연결 검증</li>
        <li>워크플로우 실행, 재실행, 재시도, 취소</li>
        <li>실행 이력과 산출물 조회</li>
        <li>폴더 단위 브라우즈와 관리</li>
      </ul>
      <h3>직접 연결되는 화면</h3>
      <ul>
        <li>Image Generation의 Workflow 탭</li>
        <li>graph 진입 경로</li>
      </ul>
    </div>
  </details>

  <div id="system-mcp-automation" class="section-anchor"></div>
  <details class="accordion-item">
    <summary>MCP와 자동화 인터페이스</summary>
    <div class="accordion-body">
      <p>화면 밖에서 CoNAI를 호출하게 해주는 자동화 접점입니다.</p>
      <div class="tag-row">
        <span class="tag">숨은 핵심 시스템</span>
        <span class="tag">외부 연동</span>
        <span class="tag">자동화</span>
      </div>
      <h3>여기서 담당하는 일</h3>
      <ul>
        <li>이미지 검색과 프롬프트 검색의 외부 호출</li>
        <li>생성 기능 자동화 연결</li>
        <li>AI 클라이언트와 에이전트 연동 기반 제공</li>
      </ul>
      <h3>왜 앞쪽에 둬야 하나</h3>
      <ul>
        <li>사용자 화면에는 덜 보여도 제품 가치 설명에서 핵심이기 때문</li>
        <li>CoNAI를 단순 로컬 뷰어가 아니라 플랫폼으로 보이게 하기 때문</li>
      </ul>
    </div>
  </details>
</div>

## 실제 페이지에서 할 수 있는 일

<div id="page-map" class="section-anchor"></div>

<div class="onepage-grid">
  <div id="page-home" class="section-anchor"></div>
  <details class="accordion-item" open>
    <summary>Home</summary>
    <div class="accordion-body">
      <p>전체 라이브러리를 가장 빠르게 훑는 기본 피드입니다.</p>
      <h3>할 수 있는 기능</h3>
      <ul>
        <li>전체 이미지 피드 보기</li>
        <li>검색 칩 기반 결과 보기</li>
        <li>무한 스크롤로 추가 이미지 로드</li>
        <li>이미지 다중 선택</li>
        <li>선택 이미지 다운로드</li>
        <li>선택 이미지를 그룹에 추가</li>
        <li>이미지 상세 페이지로 이동</li>
      </ul>
      <h3>연결 시스템</h3>
      <ul>
        <li>미디어 메타데이터 엔진</li>
        <li>생성 저장 파이프라인</li>
      </ul>
    </div>
  </details>

  <div id="page-groups" class="section-anchor"></div>
  <details class="accordion-item">
    <summary>Groups</summary>
    <div class="accordion-body">
      <p>커스텀 그룹과 감시폴더 그룹을 나눠 탐색하고 정리하는 공간입니다.</p>
      <h3>할 수 있는 기능</h3>
      <ul>
        <li>커스텀 그룹과 폴더 그룹 전환</li>
        <li>루트 그룹, 하위 그룹 탐색</li>
        <li>그룹 생성, 수정, 삭제</li>
        <li>전체 자동수집 실행</li>
        <li>감시폴더 재구축 실행</li>
        <li>현재 그룹 다운로드</li>
        <li>선택 이미지 다운로드</li>
        <li>선택 이미지를 커스텀 그룹에 추가</li>
        <li>현재 그룹에서 선택 이미지 제거</li>
      </ul>
      <h3>연결 시스템</h3>
      <ul>
        <li>감시폴더 등록과 스캔</li>
        <li>미디어 메타데이터 엔진</li>
        <li>생성 저장 파이프라인</li>
      </ul>
    </div>
  </details>

  <div id="page-prompts" class="section-anchor"></div>
  <details class="accordion-item">
    <summary>Prompts</summary>
    <div class="accordion-body">
      <p>프롬프트를 타입별로 모아 보고, 그룹화하고, 정리하는 페이지입니다.</p>
      <h3>할 수 있는 기능</h3>
      <ul>
        <li>positive, negative, auto 프롬프트 전환</li>
        <li>프롬프트 검색</li>
        <li>정렬 기준과 방향 변경</li>
        <li>프롬프트 그룹 탐색</li>
        <li>프롬프트 그룹 생성, 수정, 삭제, 순서 변경</li>
        <li>프롬프트 그룹 import/export</li>
        <li>프롬프트 요약 보기</li>
        <li>프롬프트 수집 실행</li>
        <li>단일 또는 다중 프롬프트 그룹 할당</li>
        <li>프롬프트 삭제와 복사</li>
      </ul>
      <h3>연결 시스템</h3>
      <ul>
        <li>미디어 메타데이터 엔진</li>
        <li>MCP와 자동화 인터페이스</li>
      </ul>
    </div>
  </details>

  <div id="page-generation" class="section-anchor"></div>
  <details class="accordion-item">
    <summary>Image Generation</summary>
    <div class="accordion-body">
      <p>생성 자체와 생성 이력, 그리고 Workflow 기반 실행 구성을 묶은 페이지입니다.</p>
      <h3>할 수 있는 기능</h3>
      <ul>
        <li>NAI 생성</li>
        <li>ComfyUI 생성</li>
        <li>Wildcard 생성</li>
        <li>생성 이력 확인</li>
        <li>모바일에서 컨트롤 드로어 열기</li>
        <li>Workflow 탭 진입</li>
        <li>워크플로우 목록 탐색</li>
        <li>노드와 연결 관리</li>
        <li>워크플로우 실행, 재실행, 재시도, 취소</li>
        <li>실행 결과와 산출물 확인</li>
      </ul>
      <h3>연결 시스템</h3>
      <ul>
        <li>생성 저장 파이프라인</li>
        <li>워크플로우 실행 엔진</li>
        <li>MCP와 자동화 인터페이스</li>
      </ul>
    </div>
  </details>

  <div id="page-upload" class="section-anchor"></div>
  <details class="accordion-item">
    <summary>Upload</summary>
    <div class="accordion-body">
      <p>파일 업로드와 메타 추출 실험, 변환 작업을 한곳에서 다룹니다.</p>
      <h3>할 수 있는 기능</h3>
      <ul>
        <li>이미지와 비디오 업로드</li>
        <li>업로드 진행률 확인</li>
        <li>업로드 전 저장 옵션 확인</li>
        <li>단일 이미지 메타 미리보기</li>
        <li>태거 자동 추출 실행</li>
        <li>Kaloscope 추출 실행</li>
        <li>통합 추출 실행</li>
        <li>WebP 변환 다운로드</li>
        <li>메타 수정 파일 다운로드</li>
        <li>드래그 앤 드롭 업로드/추출</li>
      </ul>
      <h3>연결 시스템</h3>
      <ul>
        <li>생성 저장 파이프라인</li>
        <li>미디어 메타데이터 엔진</li>
      </ul>
    </div>
  </details>

  <div id="page-settings" class="section-anchor"></div>
  <details class="accordion-item">
    <summary>Settings</summary>
    <div class="accordion-body">
      <p>폴더, 화면, 자동추출, 메타, 저장 정책을 관리하는 제어실입니다.</p>
      <h3>할 수 있는 기능</h3>
      <ul>
        <li>watched folder 설정 관리</li>
        <li>appearance 설정 저장, 초기화, 취소</li>
        <li>appearance preset slot 저장</li>
        <li>테마 패키지 import/export</li>
        <li>커스텀 폰트 업로드</li>
        <li>tagger 설정 저장</li>
        <li>Kaloscope 설정 저장</li>
        <li>tagger 의존성 확인</li>
        <li>자동 테스트 대상 찾기 또는 랜덤 선택</li>
        <li>tagger 자동 테스트 실행</li>
        <li>Kaloscope 자동 테스트 실행</li>
        <li>metadata 추출 설정 저장</li>
        <li>image save 설정 저장</li>
      </ul>
      <h3>연결 시스템</h3>
      <ul>
        <li>감시폴더 등록과 스캔</li>
        <li>생성 저장 파이프라인</li>
        <li>미디어 메타데이터 엔진</li>
        <li>MCP와 자동화 인터페이스</li>
      </ul>
    </div>
  </details>

  <div id="page-image-detail" class="section-anchor"></div>
  <details class="accordion-item">
    <summary>Image Detail</summary>
    <div class="accordion-body">
      <p>개별 이미지 한 장의 상세 정보와 액션을 보는 페이지입니다.</p>
      <h3>할 수 있는 기능</h3>
      <ul>
        <li>이미지 상세 보기</li>
        <li>파일 다운로드</li>
        <li>새로고침</li>
        <li>이전 화면 또는 홈으로 돌아가기</li>
        <li>메타 수정 페이지 진입</li>
      </ul>
    </div>
  </details>

  <div id="page-metadata-edit" class="section-anchor"></div>
  <details class="accordion-item">
    <summary>Metadata Edit</summary>
    <div class="accordion-body">
      <p>기존 이미지 메타데이터를 수정하고, 다운로드용 재작성 또는 실제 운영 저장을 수행합니다.</p>
      <h3>할 수 있는 기능</h3>
      <ul>
        <li>rewrite draft 확인</li>
        <li>포맷 선택</li>
        <li>메타 수정 파일 다운로드</li>
        <li>실제 운영 파일과 라이브러리 DB에 저장</li>
        <li>이미지 상세 페이지로 돌아가기</li>
      </ul>
    </div>
  </details>

  <div id="page-system-pages" class="section-anchor"></div>
  <details class="accordion-item">
    <summary>Login / Not Found</summary>
    <div class="accordion-body">
      <p>이 두 페이지는 핵심 기능 페이지라기보다 시스템 보조 페이지입니다.</p>
      <h3>할 수 있는 기능</h3>
      <ul>
        <li>Login: 현재는 예약 라우트와 준비 상태 안내</li>
        <li>Not Found: 잘못된 경로에서 홈으로 복귀</li>
      </ul>
    </div>
  </details>
</div>

## 현재 방향 정리

- 네가 원한 방향대로, <strong>멀티페이지 문서 책자형</strong>이 아니라 <strong>원페이지 전시형</strong>으로 바꾸는 게 맞습니다.
- 항목을 누르면 아래로 펼쳐지면서, 그 안에서 무엇을 할 수 있는지 바로 보이게 구성합니다.
- 숨은 핵심 시스템은 사용자 페이지보다 앞쪽에 배치합니다.

<!-- Pages deploy trigger: keep this comment so docs pushes retrigger deployment safely. -->

## 다음 확장

다음 단계에서는 각 항목 안을 더 세분화해서 아래까지 넣을 수 있습니다.

- 탭별 기능
- 버튼별 액션
- 모달에서 할 수 있는 일
- 페이지 간 이동 흐름
- 관련 핵심 시스템 연결선

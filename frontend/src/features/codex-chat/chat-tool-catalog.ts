import type { useI18n } from '@/i18n'
import type { ChatScope, ChatToolInfo } from '@/lib/api-codex-chat'
import { matchesSearch } from '@/lib/text-search'

type TranslateFn = ReturnType<typeof useI18n>['t']
type Copy = { ko: string; en: string }

/**
 * How the tool picker shows the MCP tools: one group level under each scope, a plain label per tool and a
 * description in the UI language. Tools the server adds later land in a scope's "other" group with their server
 * description, so nothing is hidden by an outdated catalog.
 */
export type ChatToolGroupId =
  | 'images' | 'history' | 'prompts' | 'workflows' | 'files' | 'emoticons' | 'audio' | 'backups' | 'pages'
  | 'image-gen' | 'workflow-run' | 'audio-gen'
  | 'configure'
  | 'image-groups' | 'prompt-groups' | 'file-ops' | 'emoticon-ops' | 'audio-ops'
  | 'sprites' | 'sprite-ops'
  | 'other'

const GROUPS: Array<{ id: ChatToolGroupId; scope: ChatScope; label: Copy }> = [
  { id: 'pages', scope: 'read', label: { ko: '현재 화면', en: 'Current page' } },
  { id: 'images', scope: 'read', label: { ko: '이미지 보기', en: 'Images' } },
  { id: 'history', scope: 'read', label: { ko: '생성 기록·작업', en: 'History and jobs' } },
  { id: 'prompts', scope: 'read', label: { ko: '프롬프트', en: 'Prompts' } },
  { id: 'workflows', scope: 'read', label: { ko: '워크플로·서버', en: 'Workflows and servers' } },
  { id: 'files', scope: 'read', label: { ko: '파일 보관함', en: 'File store' } },
  { id: 'emoticons', scope: 'read', label: { ko: '이모티콘', en: 'Emoticons' } },
  { id: 'audio', scope: 'read', label: { ko: '오디오', en: 'Audio' } },
  { id: 'backups', scope: 'read', label: { ko: '백업', en: 'Backups' } },
  { id: 'sprites', scope: 'read', label: { ko: '스프라이트', en: 'Sprite' } },
  { id: 'image-gen', scope: 'generate', label: { ko: '이미지 생성', en: 'Image generation' } },
  { id: 'workflow-run', scope: 'generate', label: { ko: '워크플로 실행', en: 'Workflow runs' } },
  { id: 'audio-gen', scope: 'generate', label: { ko: '오디오 생성', en: 'Audio generation' } },
  { id: 'sprite-ops', scope: 'generate', label: { ko: '스프라이트', en: 'Sprite' } },
  { id: 'image-groups', scope: 'organize', label: { ko: '이미지 그룹', en: 'Image groups' } },
  { id: 'prompt-groups', scope: 'organize', label: { ko: '프롬프트 정리', en: 'Prompt organizing' } },
  { id: 'file-ops', scope: 'organize', label: { ko: '파일 변경', en: 'File changes' } },
  { id: 'emoticon-ops', scope: 'organize', label: { ko: '이모티콘 설정', en: 'Emoticon setup' } },
  { id: 'audio-ops', scope: 'organize', label: { ko: '오디오 정리', en: 'Audio organizing' } },
  { id: 'configure', scope: 'configure', label: { ko: '설정', en: 'Setup' } },
]

const TOOLS: Record<string, { group: ChatToolGroupId; label: Copy; ko: string }> = {
  get_current_page: { group: 'pages', label: { ko: '현재 페이지 읽기', en: 'Read current page' }, ko: '네가 연결한 CoNAI 페이지와 등록된 입력값을 읽어.' },
  read_page_data: { group: 'pages', label: { ko: '페이지 목록·선택 내용 읽기', en: 'Read page contents' }, ko: '현재 페이지에 등록된 목록과 선택 항목을 읽어.' },
  page_act: { group: 'pages', label: { ko: '페이지 이동·조작', en: 'Move and operate pages' }, ko: '페이지·탭 이동, 항목 선택, 편집기 열기, 입력 초안 같은 등록된 작업을 바로 실행해. 저장은 하지 않아.' },
  page_fill: { group: 'pages', label: { ko: '입력 채우기', en: 'Fill inputs' }, ko: '연결된 페이지의 입력값을 바로 채워. 저장은 하지 않고 네가 되돌릴 수 있어.' },
  propose_page_action: { group: 'pages', label: { ko: '저장 작업 제안', en: 'Propose save' }, ko: '생성·수정·등록 같은 저장 작업을 카드로 제안해. 검토 후 네가 적용해.' },
  get_workflow_editor: { group: 'pages', label: { ko: '노드 편집기 읽기', en: 'Read workflow editor' }, ko: '연결한 워크플로 초안의 노드와 연결을 읽어.' },
  list_workflow_modules: { group: 'pages', label: { ko: '워크플로 모듈 조회', en: 'List workflow modules' }, ko: '등록된 활성 모듈의 입력과 출력 포트를 확인해.' },
  workflow_edit: { group: 'pages', label: { ko: '노드 워크플로 편집', en: 'Edit node workflow' }, ko: '열린 노드 편집기에 노드 추가·삭제·입력·연결을 바로 반영해. 저장은 네가 해.' },
  search_images: { group: 'images', label: { ko: '이미지 검색', en: 'Search images' }, ko: '프롬프트 글, 도구, 모델, 크기, 날짜, 그룹으로 이미지·영상을 찾아.' },
  search_images_by_tags: { group: 'images', label: { ko: '태그로 이미지 검색', en: 'Search by tags' }, ko: '자동 태그(WD Tagger)로 이미지를 찾아. 캐릭터·등급 필터도 돼.' },
  get_image_metadata: { group: 'images', label: { ko: '이미지 정보', en: 'Image metadata' }, ko: '이미지 하나의 프롬프트·모델·크기 같은 상세 정보를 읽어.' },
  view_images: { group: 'images', label: { ko: '이미지 보기', en: 'View images' }, ko: '이미지나 보관함 파일을 작은 미리보기로 실제로 봐. 비전 모델에서만 의미 있어.' },
  list_image_groups: { group: 'images', label: { ko: '이미지 그룹 목록', en: 'List image groups' }, ko: '라이브러리의 그룹(폴더)과 경로, 이미지 수를 나열해.' },
  get_image_group: { group: 'images', label: { ko: '그룹 설정 보기', en: 'Group settings' }, ko: '그룹 하나의 설명·이미지 수·자동수집 조건을 읽어.' },
  get_image_groups: { group: 'images', label: { ko: '이미지가 속한 그룹', en: 'Groups of an image' }, ko: '이미지 하나가 어느 그룹에 들어 있는지 알려줘.' },
  get_generation_history: { group: 'history', label: { ko: '생성 기록', en: 'Generation history' }, ko: '이미지 생성 기록을 서비스·상태로 걸러 읽어.' },
  get_generation_history_request: { group: 'history', label: { ko: '생성 요청 내용', en: 'History request' }, ko: '생성 결과 뒤에 저장된 프롬프트·모델·설정을 그대로 읽어.' },
  get_generation_job: { group: 'history', label: { ko: '작업 상태', en: 'Job status' }, ko: '생성 작업 하나의 상태와 결과 기록을 읽어.' },
  wait_generation_job: { group: 'history', label: { ko: '작업 완료 대기', en: 'Wait for a job' }, ko: '생성 작업이 끝날 때까지 기다렸다가 결과를 돌려줘.' },
  get_generation_artifacts: { group: 'history', label: { ko: '결과물 받기', en: 'Job artifacts' }, ko: '생성 작업의 결과 파일과 다운로드 링크를 받아.' },
  refresh_artifact_download: { group: 'history', label: { ko: '다운로드 링크 갱신', en: 'Refresh download link' }, ko: '결과물의 다운로드 링크를 새로 발급해.' },
  search_prompts: { group: 'prompts', label: { ko: '프롬프트 검색', en: 'Search prompts' }, ko: '저장된 프롬프트를 글로 찾아.' },
  get_most_used_prompts: { group: 'prompts', label: { ko: '자주 쓴 프롬프트', en: 'Most used prompts' }, ko: '사용 횟수가 많은 프롬프트를 순서대로 읽어.' },
  list_prompt_groups: { group: 'prompts', label: { ko: '프롬프트 그룹 목록', en: 'List prompt groups' }, ko: '프롬프트 그룹과 각 그룹의 개수를 나열해.' },
  get_prompt_group_structure: { group: 'prompts', label: { ko: '프롬프트 그룹 구조', en: 'Prompt group tree' }, ko: '프롬프트 그룹의 전체 계층과 미분류 개수를 읽어.' },
  get_unclassified_prompts: { group: 'prompts', label: { ko: '미분류 프롬프트', en: 'Unclassified prompts' }, ko: '아직 그룹에 안 들어간 프롬프트를 묶음으로 읽어.' },
  get_prompts_in_group: { group: 'prompts', label: { ko: '그룹의 프롬프트', en: 'Prompts in a group' }, ko: '특정 그룹에 든 프롬프트를 모두 읽어.' },
  list_prompt_presets: { group: 'prompts', label: { ko: '프롬프트 프리셋', en: 'Prompt presets' }, ko: '저장된 프롬프트 프리셋과 전체 글을 읽어.' },
  search_wildcards: { group: 'prompts', label: { ko: '와일드카드 검색', en: 'Search wildcards' }, ko: '와일드카드를 이름으로 찾거나 계층을 둘러봐.' },
  list_custom_dropdown_lists: { group: 'prompts', label: { ko: '드롭다운 목록', en: 'Dropdown lists' }, ko: 'LoRA·체크포인트 같은 사용자 목록의 이름과 개수를 읽어.' },
  search_custom_dropdown_items: { group: 'prompts', label: { ko: '드롭다운 항목 검색', en: 'Search dropdown items' }, ko: '사용자 목록 안에서 LoRA·체크포인트 같은 항목을 찾아.' },
  list_workflows: { group: 'workflows', label: { ko: 'ComfyUI 워크플로 목록', en: 'ComfyUI workflows' }, ko: '등록된 ComfyUI 워크플로를 나열해.' },
  get_workflow_details: { group: 'workflows', label: { ko: 'ComfyUI 워크플로 상세', en: 'ComfyUI workflow details' }, ko: '워크플로 하나의 입력 항목과 설정을 읽어.' },
  list_graph_workflows: { group: 'workflows', label: { ko: '그래프 워크플로 목록', en: 'Graph workflows' }, ko: '생성 탭에서 직접 만든 워크플로를 나열해.' },
  get_graph_workflow_details: { group: 'workflows', label: { ko: '그래프 워크플로 상세', en: 'Graph workflow details' }, ko: '직접 만든 워크플로의 입력 형식을 읽어.' },
  get_graph_workflow_execution: { group: 'workflows', label: { ko: '그래프 워크플로 결과', en: 'Graph workflow run' }, ko: '직접 만든 워크플로 실행의 상태와 결과를 읽어.' },
  list_comfyui_servers: { group: 'workflows', label: { ko: 'ComfyUI 서버 목록', en: 'ComfyUI servers' }, ko: '설정된 ComfyUI 서버와 상태, 라우팅 태그를 나열해.' },
  get_generation_routing_options: { group: 'workflows', label: { ko: '생성 라우팅 옵션', en: 'Routing options' }, ko: '어느 서버로 생성이 가는지와 고를 수 있는 대상을 설명해.' },
  get_codex_generation_options: { group: 'workflows', label: { ko: 'Codex 생성 옵션', en: 'Codex generation options' }, ko: 'Codex 이미지 생성의 요청 형식과 모델을 읽어.' },
  list_files: { group: 'files', label: { ko: '파일 목록', en: 'List files' }, ko: '채팅 파일 보관함의 폴더와 파일을 둘러봐.' },
  get_file_info: { group: 'files', label: { ko: '파일 정보', en: 'File info' }, ko: '보관함 파일 하나의 이름·크기·종류를 읽어.' },
  read_file_text: { group: 'files', label: { ko: '파일 내용 읽기', en: 'Read file text' }, ko: '보관함의 텍스트 파일을 잘라 가며 읽어.' },
  list_emoticon_groups: { group: 'emoticons', label: { ko: '이모티콘 그룹 목록', en: 'Emoticon groups' }, ko: '이모티콘 그룹과 이미지·키워드 수를 나열해.' },
  list_emoticons: { group: 'emoticons', label: { ko: '이모티콘 목록', en: 'List emoticons' }, ko: '그룹 안의 이모티콘 이미지와 키워드를 읽어.' },
  get_video_info: { group: 'sprites', label: { ko: '영상 정보', en: 'Video info' }, ko: '라이브러리 영상의 크기·fps·길이·프레임 수를 읽어.' },
  get_sprite_job: { group: 'sprites', label: { ko: '스프라이트 작업 상태', en: 'Sprite job status' }, ko: '스프라이트 작업의 진행 상태와 저장된 결과를 읽어.' },
  wait_sprite_job: { group: 'sprites', label: { ko: '스프라이트 작업 대기', en: 'Wait for sprite job' }, ko: '스프라이트 작업이 끝날 때까지 기다려. 채팅에선 안 쓰여.' },
  download_sprite_frames: { group: 'sprites', label: { ko: '프레임 ZIP 받기', en: 'Download frames ZIP' }, ko: '추출한 프레임을 낱장 이미지 ZIP으로 묶어 다운로드 링크를 줘.' },
  list_backups: { group: 'backups', label: { ko: '백업 목록', en: 'List backups' }, ko: '프롬프트 백업 파일을 나열해.' },
  submit_generation_job: { group: 'image-gen', label: { ko: '생성 작업 접수', en: 'Submit generation job' }, ko: 'NovelAI·ComfyUI·Codex 생성을 백그라운드 작업으로 접수해. 생성의 기본 도구야.' },
  generate_nai: { group: 'image-gen', label: { ko: 'NovelAI 바로 생성', en: 'Generate with NovelAI' }, ko: 'NovelAI로 바로 생성하고 끝날 때까지 기다려. 한 번에 한 장만.' },
  generate_comfyui: { group: 'image-gen', label: { ko: 'ComfyUI 바로 생성', en: 'Generate with ComfyUI' }, ko: 'ComfyUI 워크플로로 바로 생성하고 끝날 때까지 기다려.' },
  generate_comfyui_all_servers: { group: 'image-gen', label: { ko: '모든 서버에서 생성', en: 'Generate on all servers' }, ko: '활성 ComfyUI 서버 전부에서 한 번씩 생성해.' },
  cancel_generation_job: { group: 'image-gen', label: { ko: '생성 작업 취소', en: 'Cancel generation job' }, ko: '진행 중인 생성 작업을 취소해.' },
  resize_images: { group: 'image-gen', label: { ko: '이미지 크기 변경', en: 'Resize images' }, ko: '라이브러리 이미지를 정한 크기로 바꿔 새 이미지로 저장해. 원본은 그대로 둬.' },
  execute_graph_workflow: { group: 'workflow-run', label: { ko: '그래프 워크플로 실행', en: 'Run graph workflow' }, ko: '직접 만든 워크플로를 실행하고 결과를 기다려.' },
  extract_sprite_sheet: { group: 'sprite-ops', label: { ko: '스프라이트 시트 추출', en: 'Extract sprite sheet' }, ko: '영상에서 프레임을 뽑아 배경색을 빼고 시트로 만들어 라이브러리에 저장해.' },
  extract_sprite_sheets_batch: { group: 'sprite-ops', label: { ko: '스프라이트 일괄 추출', en: 'Batch extract sprites' }, ko: '여러 영상을 같은 설정으로 시트로 만들어 저장해.' },
  normalize_sprite_sheets: { group: 'sprite-ops', label: { ko: '스프라이트 정규화', en: 'Normalize sprite sheets' }, ko: '시트의 프레임을 같은 셀 크기와 기준점으로 맞춰 저장해.' },
  create_sprite_animation: { group: 'sprite-ops', label: { ko: '스프라이트 애니메이션', en: 'Sprite animation' }, ko: '시트를 WebP·GIF·MP4 애니메이션으로 만들어 저장해.' },
  resolve_image_group_path: { group: 'image-groups', label: { ko: '그룹 경로 찾기·만들기', en: 'Resolve group path' }, ko: '"프로젝트/효과" 같은 경로를 그룹으로 바꿔. 없으면 만들 수도 있어.' },
  add_images_to_group: { group: 'image-groups', label: { ko: '그룹에 이미지 추가', en: 'Add images to group' }, ko: '이미지를 그룹에 넣어. 다른 그룹 소속은 그대로 둬.' },
  move_images_between_groups: { group: 'image-groups', label: { ko: '그룹 간 이미지 이동', en: 'Move images between groups' }, ko: '이미지를 한 그룹에서 다른 그룹으로 옮겨.' },
  create_image_group: { group: 'image-groups', label: { ko: '그룹 만들기', en: 'Create group' }, ko: '새 그룹을 만들어. 자동수집 조건을 같이 넣으면 바로 모으기 시작해.' },
  update_image_group: { group: 'image-groups', label: { ko: '그룹 설정 바꾸기', en: 'Update group' }, ko: '그룹 이름·설명·색과 자동수집 조건을 바꿔.' },
  run_group_auto_collect: { group: 'image-groups', label: { ko: '자동수집 다시 실행', en: 'Run auto-collect' }, ko: '자동수집이 켜진 그룹을 한 번 더 모아.' },
  remove_images_from_group: { group: 'image-groups', label: { ko: '그룹에서 이미지 빼기', en: 'Remove images from group' }, ko: '그룹 소속만 풀어. 파일은 지우지 않아.' },
  create_prompt_group: { group: 'prompt-groups', label: { ko: '프롬프트 그룹 만들기', en: 'Create prompt group' }, ko: '프롬프트 그룹을 하나 만들어. 하위 그룹도 돼.' },
  batch_create_groups: { group: 'prompt-groups', label: { ko: '프롬프트 그룹 여러 개 만들기', en: 'Create prompt groups' }, ko: '프롬프트 그룹을 한 번에 여러 개 만들어.' },
  create_prompt_preset: { group: 'prompt-groups', label: { ko: '프롬프트 프리셋 저장', en: 'Save prompt preset' }, ko: '프롬프트를 이름 붙여 프리셋으로 저장해. 같은 이름은 덮어쓰지 않아.' },
  assign_prompts_to_group: { group: 'prompt-groups', label: { ko: '프롬프트 그룹 지정', en: 'Assign prompts to group' }, ko: '프롬프트를 그룹에 넣거나 미분류로 되돌려.' },
  move_prompts_between_groups: { group: 'prompt-groups', label: { ko: '프롬프트 그룹 이동', en: 'Move prompts between groups' }, ko: '프롬프트를 한 그룹에서 다른 그룹으로 옮겨.' },
  create_file_folder: { group: 'file-ops', label: { ko: '폴더 만들기', en: 'Create folder' }, ko: '파일 보관함에 폴더를 만들어.' },
  rename_file: { group: 'file-ops', label: { ko: '이름 바꾸기', en: 'Rename file' }, ko: '보관함의 파일이나 폴더 이름을 바꿔.' },
  move_files: { group: 'file-ops', label: { ko: '파일 이동', en: 'Move files' }, ko: '보관함의 파일·폴더를 다른 폴더로 옮겨.' },
  delete_files: { group: 'file-ops', label: { ko: '파일 삭제', en: 'Delete files' }, ko: '보관함의 파일이나 빈 폴더를 영구히 지워. 채팅에 붙은 파일은 보호돼.' },
  set_emoticon_keywords: { group: 'emoticon-ops', label: { ko: '이모티콘 키워드 설정', en: 'Set emoticon keywords' }, ko: '그룹 안 이미지의 이모티콘 키워드를 정해.' },
  set_emoticon_group: { group: 'emoticon-ops', label: { ko: '이모티콘 그룹 지정', en: 'Set emoticon group' }, ko: '그룹을 이모티콘 그룹으로 만들거나 되돌려.' },
  list_audio_projects: { group: 'audio', label: { ko: '오디오 프로젝트 목록', en: 'List audio projects' }, ko: '오디오 프로젝트와 그룹·후보 수, 받은 파일 그룹을 나열해.' },
  list_audio_groups: { group: 'audio', label: { ko: '오디오 그룹 목록', en: 'List audio groups' }, ko: '프로젝트의 효과음 그룹과 파일명 규칙, 채택·코멘트 수를 나열해.' },
  list_audio_candidates: { group: 'audio', label: { ko: '후보 목록', en: 'List candidates' }, ko: '그룹의 생성 후보·업로드·편집본을 검수 상태와 함께 나열해.' },
  get_audio_candidate: { group: 'audio', label: { ko: '후보 읽기', en: 'Read candidate' }, ko: '후보 하나의 출처(프롬프트, seed, 워크플로)와 검수 메모를 읽어.' },
  list_audio_group_comments: { group: 'audio', label: { ko: '그룹 코멘트 읽기', en: 'Read group comments' }, ko: '그룹에 남긴 작업 요청 코멘트를 읽어.' },
  create_audio_project: { group: 'audio-ops', label: { ko: '프로젝트 만들기', en: 'Create audio project' }, ko: '오디오 프로젝트를 만들어. 받은 파일 그룹이 같이 생겨.' },
  update_audio_project: { group: 'audio-ops', label: { ko: '프로젝트 수정', en: 'Update audio project' }, ko: '오디오 프로젝트 이름이나 설명을 바꿔.' },
  create_audio_group: { group: 'audio-ops', label: { ko: '그룹 만들기', en: 'Create audio group' }, ko: '효과음 그룹을 만들어. 라벨이 내보내기 파일명 규칙이야.' },
  update_audio_group: { group: 'audio-ops', label: { ko: '그룹 수정', en: 'Update audio group' }, ko: '그룹 이름·라벨·설명을 바꿔.' },
  move_audio_candidates: { group: 'audio-ops', label: { ko: '후보 옮기기', en: 'Move candidates' }, ko: '후보를 같은 프로젝트의 다른 그룹으로 옮겨.' },
  import_audio: { group: 'audio-ops', label: { ko: '오디오 가져오기', en: 'Import audio' }, ko: '오디오 파일(data URL 또는 보관함 파일)을 후보로 넣어.' },
  list_audio_workflows: { group: 'audio', label: { ko: '오디오 워크플로 목록', en: 'List audio workflows' }, ko: '오디오 생성에 연결된 워크플로와 기본값, 서버 호환 결과를 나열해.' },
  get_audio_order: { group: 'audio', label: { ko: '오디오 주문 읽기', en: 'Read audio order' }, ko: '오디오 주문의 작업별 상태와 만들어진 후보를 읽어.' },
  order_audio: { group: 'audio-gen', label: { ko: '효과음 생성 주문', en: 'Order sound effects' }, ko: '그룹에 효과음 후보를 여러 개 생성해. seed는 하나씩 늘어나.' },
  wait_audio_order: { group: 'audio-gen', label: { ko: '오디오 주문 기다리기', en: 'Wait for audio order' }, ko: '주문이 끝날 때까지 기다렸다가 결과를 돌려줘.' },
  cancel_audio_order: { group: 'audio-gen', label: { ko: '오디오 주문 취소', en: 'Cancel audio order' }, ko: '주문에서 아직 안 끝난 작업을 취소해.' },
  retry_audio_order_job: { group: 'audio-gen', label: { ko: '오디오 작업 다시', en: 'Retry audio job' }, ko: '실패한 작업 하나를 같은 seed로 다시 돌려.' },
  set_audio_group_comment_status: { group: 'audio-ops', label: { ko: '코멘트 완료 처리', en: 'Complete comment' }, ko: '작업 요청 코멘트를 완료로 표시하거나 다시 열어.' },
  edit_audio_candidate: { group: 'audio-ops', label: { ko: '편집본 저장', en: 'Save audio edit' }, ko: '후보를 자르고 음량·피치·속도·페이드를 바꾼 편집본을 새 후보로 저장해. 원본은 그대로야.' },
  delete_unselected_audio_candidates: { group: 'audio-ops', label: { ko: '미채택 정리', en: 'Clear unselected takes' }, ko: '그룹의 미채택 후보를 휴지통으로 보내. 채택된 후보는 지우지 않아.' },
  export_audio_selected: { group: 'audio-ops', label: { ko: '채택본 내보내기', en: 'Export selected takes' }, ko: '채택된 효과음을 그룹 라벨 파일명으로 WAV·OGG 또는 ZIP으로 내보내.' },
  get_audio_download: { group: 'audio', label: { ko: '오디오 내려받기', en: 'Download audio' }, ko: '후보 파일이나 내보내기 결과의 다운로드 링크를 받아.' },
  get_chat_setup_guide: { group: 'configure', label: { ko: '설정 안내 읽기', en: 'Read setup guide' }, ko: '프로필·표시 블록을 어떻게 짜는지 안내를 읽어.' },
  list_chat_profiles: { group: 'configure', label: { ko: '프로필 목록', en: 'List profiles' }, ko: '채팅 프로필을 나열해.' },
  get_chat_profile: { group: 'configure', label: { ko: '프로필 읽기', en: 'Read profile' }, ko: '프로필 하나의 설정을 읽어.' },
  list_display_blocks: { group: 'configure', label: { ko: '표시 블록 목록', en: 'List display blocks' }, ko: '공유 표시 블록을 나열해.' },
  get_display_block: { group: 'configure', label: { ko: '표시 블록 읽기', en: 'Read display block' }, ko: '표시 블록 하나의 설계를 읽어.' },
  propose_display_block: { group: 'configure', label: { ko: '표시 블록 제안', en: 'Propose display block' }, ko: '새 표시 블록을 제안해. 저장은 답변 밑 카드에서 네가 눌러.' },
  propose_chat_profile: { group: 'configure', label: { ko: '프로필 제안', en: 'Propose profile' }, ko: '새 프로필을 제안해. 저장은 답변 밑 카드에서 네가 눌러.' },
  propose_profile_update: { group: 'configure', label: { ko: '프로필 수정 제안', en: 'Propose profile update' }, ko: '기존 프로필의 수정을 제안해. 저장은 답변 밑 카드에서 네가 눌러.' },
  propose_profile_assets: { group: 'configure', label: { ko: '캐릭터 이미지 제안', en: 'Propose character images' }, ko: '캐릭터 이미지 생성이나 고른 후보 적용을 제안해. 저장은 답변 밑 카드에서 네가 눌러.' },
  get_asset_batch: { group: 'configure', label: { ko: '캐릭터 이미지 진행 읽기', en: 'Read character image batch' }, ko: '캐릭터 이미지 생성 진행과 후보·검토 결과를 읽어.' },
}

export type ChatToolEntry = {
  name: string
  scope: ChatScope
  /** What the picker shows in place of the tool name. */
  label: string
  /** Tooltip, in the UI language (English falls back to the server's own description). */
  description: string
  /** What a search reads, in both languages: the name and labels (initials match), and the descriptions. */
  search: { keys: string[]; prose: string[] }
}

export type ChatToolGroup = { id: ChatToolGroupId; scope: ChatScope; label: string; tools: ChatToolEntry[] }

/** The server's tools (chat scopes only) as groups under each scope, in catalog order; unknown tools close each scope. */
export function groupChatTools(tools: ChatToolInfo[], t: TranslateFn): ChatToolGroup[] {
  const groups = new Map<string, ChatToolGroup>()
  for (const group of GROUPS) groups.set(group.id, { id: group.id, scope: group.scope, label: t(group.label), tools: [] })
  const other = new Map<ChatScope, ChatToolGroup>()
  for (const tool of tools) {
    if (tool.scope === null) continue
    const entry = TOOLS[tool.name]
    const label = entry ? t(entry.label) : tool.name
    const description = entry ? t({ ko: entry.ko, en: tool.description || entry.label.en }) : tool.description
    const search = { keys: entry ? [tool.name, entry.label.ko, entry.label.en] : [tool.name], prose: entry ? [entry.ko, tool.description] : [tool.description] }
    const target = entry && groups.get(entry.group)?.scope === tool.scope ? groups.get(entry.group) : null
    if (target) {
      target.tools.push({ name: tool.name, scope: tool.scope, label, description, search })
      continue
    }
    let fallback = other.get(tool.scope)
    if (!fallback) {
      fallback = { id: 'other', scope: tool.scope, label: t({ ko: '기타', en: 'Other' }), tools: [] }
      other.set(tool.scope, fallback)
    }
    fallback.tools.push({ name: tool.name, scope: tool.scope, label, description, search })
  }
  const ordered: ChatToolGroup[] = []
  for (const scope of ['read', 'generate', 'organize', 'configure'] as ChatScope[]) {
    for (const group of groups.values()) if (group.scope === scope && group.tools.length > 0) ordered.push(group)
    const fallback = other.get(scope)
    if (fallback) ordered.push(fallback)
  }
  return ordered
}

/** The picker label of one tool, for summaries outside the picker. */
export function chatToolLabel(name: string, t: TranslateFn) {
  const entry = TOOLS[name]
  return entry ? t(entry.label) : name
}

/** Whether a picker search finds this tool (Korean-aware: spacing, 초성 on names and labels, half-typed syllables). */
export function matchesChatTool(tool: Pick<ChatToolEntry, 'search'>, query: string) {
  return matchesSearch(tool.search.keys, query) || matchesSearch(tool.search.prose, query, { initials: false })
}

/** One tool, or a `prefix*` pattern, a judge item can offer or withhold. */
export type JudgeToolEntry = Pick<ChatToolEntry, 'name' | 'label' | 'description' | 'search'> & { pattern: boolean }
export type JudgeToolGroup = { id: string; label: string; tools: JudgeToolEntry[] }

type FixedTool = { name: string; label: Copy; description: Copy }

/** The chat's own tools: offered by the chat itself, not by a scope, so the server's tool list never has them. */
const CHAT_TOOLS: FixedTool[] = [
  { name: 'save_lore', label: { ko: '로어 저장 제안', en: 'Propose lore entry' }, description: { ko: '대화에서 나온 설정을 이 채팅 로어북에 남기자고 제안해. 저장은 네가 해.', en: "Proposes an entry for this chat's lorebook; you save it." } },
  { name: 'read_lore_file', label: { ko: '로어 자료 읽기', en: 'Read lore file' }, description: { ko: '로어북 항목에 연결된 텍스트 파일을 읽어.', en: 'Reads the text file a lorebook entry links.' } },
  { name: 'chat_reply_to', label: { ko: '답장 대상 지정', en: 'Set reply target' }, description: { ko: '답변이 인용할 메시지와 받을 멤버를 정해.', en: 'Sets the quote and recipients of the reply.' } },
  { name: 'room_call_member', label: { ko: '멤버 부르기', en: 'Call members' }, description: { ko: '그룹 채팅에서 다른 멤버가 이어서 답하게 불러.', en: 'Asks other group members to answer next.' } },
  { name: 'room_history_search', label: { ko: '대화 기록 검색', en: 'Search room history' }, description: { ko: '그룹 채팅의 이전 메시지를 글로 찾아.', en: 'Searches earlier messages of the group room.' } },
  { name: 'room_history_read', label: { ko: '대화 기록 읽기', en: 'Read room history' }, description: { ko: '그룹 채팅에서 메시지 하나 주변의 대화를 읽어.', en: 'Reads the group conversation around one message.' } },
  { name: 'task_propose', label: { ko: '작업 계획 제안', en: 'Propose task' }, description: { ko: '여러 턴이 걸리는 작업을 계획 카드로 제안해.', en: 'Proposes a multi-step task as a plan card.' } },
  { name: 'task_status', label: { ko: '작업 상태 읽기', en: 'Task status' }, description: { ko: '진행 중인 작업의 단계와 상태를 읽어.', en: "Reads the current task's steps and status." } },
  { name: 'task_update', label: { ko: '작업 단계 표시', en: 'Update task step' }, description: { ko: '작업 단계 하나를 진행 중·완료·건너뜀으로 표시해.', en: 'Marks one task step doing, done or skipped.' } },
  { name: 'task_wait', label: { ko: '작업 잠시 멈추기', en: 'Pause task' }, description: { ko: '승인·생성·답을 기다리는 동안 작업을 멈춰.', en: 'Pauses the task until something outside the reply happens.' } },
  { name: 'task_finish', label: { ko: '작업 끝내기', en: 'Finish task' }, description: { ko: '작업을 완료나 실패로 끝내.', en: 'Ends the task as done or failed.' } },
  { name: 'get_proposal_status', label: { ko: '카드 처리 결과 읽기', en: 'Proposal status' }, description: { ko: '제안 카드를 저장했는지, 넘겼는지 읽어.', en: 'Reads what happened to review cards.' } },
]

/** Tools whose names vary, picked as a pattern: one generate_image tool per preset a profile links. */
const IMAGE_GEN_PATTERNS: FixedTool[] = [
  { name: 'generate_image*', label: { ko: '생성 프리셋 전부', en: 'Every generation preset' }, description: { ko: '프로필에 연결된 생성 프리셋 도구 전부 (generate_image, generate_image_2…).', en: 'Every generation preset tool a profile links (generate_image, generate_image_2…).' } },
  { name: 'generate_comfyui*', label: { ko: 'ComfyUI 생성 전부', en: 'Every ComfyUI generation' }, description: { ko: 'ComfyUI로 바로 생성하는 도구 전부.', en: 'Every direct ComfyUI generation tool.' } },
]

function fixedEntry(tool: FixedTool, t: TranslateFn): JudgeToolEntry {
  return { name: tool.name, label: t(tool.label), description: t(tool.description), search: { keys: [tool.name, tool.label.ko, tool.label.en], prose: [tool.description.ko, tool.description.en] }, pattern: tool.name.endsWith('*') }
}

/**
 * What a judge item can steer: the chat's own tools first, then image generation led by its patterns, then every
 * other group of the server's tools. A group label that repeats under another scope gets the scope added.
 */
export function judgeToolGroups(groups: ChatToolGroup[], t: TranslateFn, scopeLabel: (scope: ChatScope) => string): JudgeToolGroup[] {
  const repeated = new Set(groups.map((group) => group.label).filter((label, index, labels) => labels.indexOf(label) !== index))
  const serverGroups = groups.map((group): JudgeToolGroup => ({
    id: `${group.scope}:${group.id}`,
    label: repeated.has(group.label) ? `${group.label} · ${scopeLabel(group.scope)}` : group.label,
    tools: [
      ...(group.id === 'image-gen' ? IMAGE_GEN_PATTERNS.map((tool) => fixedEntry(tool, t)) : []),
      ...group.tools.map((tool) => ({ name: tool.name, label: tool.label, description: tool.description, search: tool.search, pattern: false })),
    ],
  }))
  return [
    { id: 'chat', label: t({ ko: '채팅', en: 'Chat' }), tools: CHAT_TOOLS.map((tool) => fixedEntry(tool, t)) },
    ...serverGroups.filter((group) => group.id === 'generate:image-gen'),
    ...serverGroups.filter((group) => group.id !== 'generate:image-gen'),
  ]
}

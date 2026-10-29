/** Safe, delegable settings exposed beside a page. Paths are an explicit allowlist, never client supplied paths. */
export interface PageSettingField {
  id: string;
  path?: string;
  label: { ko: string; en: string };
  type: 'boolean' | 'number' | 'string';
  options?: readonly (string | number)[];
  min?: number;
  max?: number;
  integer?: boolean;
}
const flag = (id: string, ko: string, en: string): PageSettingField => ({ id, label: { ko, en }, type: 'boolean' });
const number = (id: string, ko: string, en: string, min: number, max?: number, integer = true): PageSettingField => ({ id, label: { ko, en }, type: 'number', min, max, integer });
const choice = (id: string, ko: string, en: string, options: readonly (string | number)[]): PageSettingField => ({ id, label: { ko, en }, type: typeof options[0] === 'number' ? 'number' : 'string', options });
export interface PageSettingsScope {
  label: { ko: string; en: string };
  permission: string;
  section: string;
  fields: readonly PageSettingField[];
}
const pacing = (provider: string, label: string): PageSettingField[] => [
  number(`${provider}.maxConcurrentJobs`, `${label} 동시 실행`, `${label} concurrent jobs`, 1, 8),
  number(`${provider}.scheduleWindowMinutes`, `${label} 실행 구간(분)`, `${label} window (minutes)`, 1, 1440),
  number(`${provider}.scheduleJobCount`, `${label} 구간당 생성 수`, `${label} jobs per window`, 1, 10000),
  choice(`${provider}.scheduleMode`, `${label} 실행 분산`, `${label} scheduling`, ['even', 'random']),
  number(`${provider}.minStartIntervalSeconds`, `${label} 최소 간격(초)`, `${label} minimum interval (seconds)`, 0, 3600),
];
export const PAGE_SETTINGS_SCOPES = {
  appearance: { label: { ko: '공용 화면', en: 'Shared appearance' }, permission: 'settings.appearance.manage', section: 'general', fields: [
    choice('themeMode', '테마', 'Theme', ['system', 'dark', 'light']),
    choice('accentPreset', '강조색', 'Accent', ['conai', 'ocean', 'forest', 'custom']),
    choice('surfacePreset', '배경', 'Surface', ['studio', 'midnight', 'paper', 'custom']),
    choice('density', '화면 밀도', 'Density', ['ultra-compact', 'compact', 'comfortable', 'spacious']),
    choice('radiusPreset', '모서리', 'Corners', ['sharp', 'balanced', 'soft']),
    choice('glassPreset', '반투명 효과', 'Translucency', ['subtle', 'balanced', 'immersive']),
    choice('shadowPreset', '그림자', 'Shadows', ['soft', 'balanced', 'dramatic']),
  ] },
  general: { label: { ko: '라이브러리 표시', en: 'Library display' }, permission: 'settings.library.manage', section: 'general', fields: [
    flag('enableGallery', '갤러리 기능 사용', 'Enable gallery features'), flag('showRatingBadges', '등급 배지 표시', 'Show rating badges'),
    choice('imageSimilarityCheckMode', '중복 검사', 'Duplicate checks', ['manual', 'always']),
  ] },
  similarity: { label: { ko: '유사도', en: 'Similarity' }, permission: 'settings.library.manage', section: 'library', fields: [
    flag('autoGenerateHashOnUpload', '업로드 시 유사도 해시 생성', 'Build similarity hashes on upload'),
    number('detailSimilarThreshold', '이미지 유사도 거리', 'Image similarity distance', 1, 64),
    number('detailSimilarLimit', '유사 이미지 개수', 'Similar image count', 1, 12),
    flag('detailSimilarIncludeColorSimilarity', '색상 유사도 사용', 'Include color similarity'),
    flag('detailSimilarUseMetadataFilter', '메타데이터 필터', 'Metadata filter'),
    choice('detailSimilarSortBy', '정렬 기준', 'Sort by', ['similarity', 'upload_date', 'file_size']),
    choice('detailSimilarSortOrder', '정렬 방향', 'Sort order', ['ASC', 'DESC']),
    flag('promptSimilarity.enabled', '프롬프트 유사도', 'Prompt similarity'),
    choice('promptSimilarity.algorithm', '프롬프트 비교 방식', 'Prompt comparison', ['simhash', 'minhash']),
    flag('promptSimilarity.autoBuildOnMetadataUpdate', '메타데이터 변경 시 색인', 'Index on metadata changes'),
    number('promptSimilarity.resultLimit', '유사 프롬프트 개수', 'Similar prompt count', 1, 12),
    number('promptSimilarity.combinedThreshold', '프롬프트 유사도 기준', 'Prompt similarity threshold', 0, 100, false),
  ] },
  metadata: { label: { ko: '메타데이터 추출', en: 'Metadata extraction' }, permission: 'settings.library.manage', section: 'library', fields: [
    flag('enableSecondaryExtraction', '숨은 메타데이터 추출', 'Extract hidden metadata'),
    choice('stealthScanMode', '탐색 방식', 'Scan mode', ['fast', 'full', 'skip']),
    number('stealthMaxFileSizeMB', '최대 파일 크기(MB)', 'Maximum file size (MB)', 1, undefined, false),
    number('stealthMaxResolutionMP', '최대 해상도(MP)', 'Maximum resolution (MP)', 1, undefined, false),
    flag('skipStealthForComfyUI', 'ComfyUI 숨은 정보 탐색 생략', 'Skip hidden scan for ComfyUI'),
    flag('skipStealthForWebUI', 'WebUI 숨은 정보 탐색 생략', 'Skip hidden scan for WebUI'),
  ] },
  'image-save': { label: { ko: '이미지 저장', en: 'Image saving' }, permission: 'settings.media.manage', section: 'media', fields: [
    choice('defaultFormat', '저장 형식', 'Format', ['original', 'png', 'jpeg', 'webp']),
    number('quality', '품질', 'Quality', 1, 100), flag('resizeEnabled', '크기 조절', 'Resize'),
    number('maxWidth', '최대 너비', 'Maximum width', 64, 16384), number('maxHeight', '최대 높이', 'Maximum height', 64, 16384),
    flag('alwaysShowDialog', '저장 옵션 항상 확인', 'Always ask for save options'),
    flag('applyToGenerationAttachments', '생성 첨부에 적용', 'Apply to generation attachments'),
    flag('applyToEditorSave', '생성 입력 편집에 적용', 'Apply to input edits'),
    flag('applyToCanvasSave', '라이브러리 편집본에 적용', 'Apply to library edits'),
    flag('applyToUpload', '업로드에 적용', 'Apply to uploads'), flag('applyToWorkflowOutputs', '워크플로 출력에 적용', 'Apply to workflow outputs'),
  ] },
  thumbnail: { label: { ko: '썸네일', en: 'Thumbnails' }, permission: 'settings.media.manage', section: 'media', fields: [
    choice('size', '썸네일 크기', 'Thumbnail size', ['original', '2048', '1080', '720', '512']), number('quality', '품질', 'Quality', 60, 100),
  ] },
  'video-optimization': { label: { ko: '영상 저장', en: 'Video saving' }, permission: 'settings.media.manage', section: 'media', fields: [
    flag('enabled', '영상 최적화', 'Optimize videos'), choice('preset', '최적화 프리셋', 'Optimization preset', ['high-quality', 'balanced', 'economy']),
    number('crf', 'CRF', 'CRF', 18, 40), number('audioBitrateKbps', '오디오 비트레이트(kbps)', 'Audio bitrate (kbps)', 32, 320),
    flag('applyToUpload', '업로드에 적용', 'Apply to uploads'), flag('applyToGeneratedOutputs', '생성 결과에 적용', 'Apply to generated outputs'), flag('applyToBackupImports', '백업 가져오기에 적용', 'Apply to backup imports'),
  ] },
  'generation-throttle': { label: { ko: '생성 실행', en: 'Generation pacing' }, permission: 'settings.generation.manage', section: 'generation', fields: [
    ...pacing('novelai', 'NovelAI'), ...pacing('codex', 'Codex'),
    number('reservations.maxConcurrentJobs', '예약 동시 실행', 'Concurrent reservations', 1, 12),
    choice('reservations.userQueuePolicy', '사용자 대기열 처리', 'User queue policy', ['continue_limited', 'hold_until_empty']),
  ] },
  tagger: { label: { ko: '자동 태그', en: 'Automatic tags' }, permission: 'settings.analysis.manage', section: 'auto', fields: [
    flag('enabled', '태거 활성화', 'Enable tagger'), flag('autoTagOnUpload', '업로드 시 자동 태그', 'Tag on upload'),
    choice('model', '태거 모델', 'Tagger model', ['vit', 'swinv2', 'convnext', 'pixai-v1']), choice('device', '연산 장치', 'Device', ['auto', 'cpu', 'cuda']),
    number('generalThreshold', '일반 태그 기준', 'General tag threshold', 0, 1, false), number('characterThreshold', '캐릭터 태그 기준', 'Character tag threshold', 0, 1, false),
    flag('keepModelLoaded', '모델 메모리 유지', 'Keep model loaded'), number('autoUnloadMinutes', '미사용 해제(분)', 'Unload after idle minutes', 1, 1440),
  ] },
  kaloscope: { label: { ko: '작가·화풍 분석', en: 'Artist and style analysis' }, permission: 'settings.analysis.manage', section: 'auto', fields: [
    flag('enabled', '작가 분석 활성화', 'Enable artist analysis'), flag('autoTagOnUpload', '업로드 시 분석', 'Analyze on upload'),
    choice('device', '연산 장치', 'Device', ['auto', 'cpu', 'cuda']), number('topK', '후보 작가 수', 'Artist candidates', 1, 200),
    flag('styleVectors', '화풍 벡터 저장', 'Store style vectors'), flag('keepModelLoaded', '모델 메모리 유지', 'Keep model loaded'), number('autoUnloadMinutes', '미사용 해제(분)', 'Unload after idle minutes', 1, 1440),
  ] },
  embedding: { label: { ko: '의미 검색', en: 'Semantic search' }, permission: 'settings.analysis.manage', section: 'auto', fields: [
    flag('enabled', '임베딩 활성화', 'Enable embeddings'), flag('imageSearch', '이미지 의미 검색', 'Image semantic search'),
    flag('fileSearch', '파일 의미 검색', 'File semantic search'), flag('postSearch', '지식 문서 의미 검색', 'Knowledge semantic search'),
    flag('chatRecall', '채팅 기억 회상', 'Chat recall'), flag('lorebook', '로어북 의미 발동', 'Semantic lorebook triggers'), flag('chatHistory', '채팅 기록 의미 검색', 'Chat history semantic search'),
    flag('keepModelLoaded', '모델 메모리 유지', 'Keep model loaded'), number('autoUnloadMinutes', '미사용 해제(분)', 'Unload after idle minutes', 1, 1440),
  ] },
  posts: { label: { ko: '게시판·지식', en: 'Posts and knowledge' }, permission: 'settings.posts.manage', section: 'posts', fields: [
    choice('layout', '기본 목록', 'Default layout', ['feed', 'cards', 'sns']), choice('botPostStatus', '봇 게시글 기본 상태', 'Bot post status', ['published', 'draft']),
    flag('safety.summonEnabled', '댓글 봇 호출', 'Summon bots in comments'),
    number('safety.chainDepth', '봇 호출 단계', 'Bot chain depth', 0, 20), number('safety.botsPerComment', '댓글당 봇 수', 'Bots per comment', 1, 30),
    number('safety.repliesPerPostPerHour', '게시글 시간당 답글', 'Replies per post per hour', 1, 5000), number('safety.callsPerProfilePerDay', '봇 하루 호출', 'Calls per bot per day', 1, 50000), number('safety.summonsPerAccountPerHour', '계정 시간당 호출', 'Summons per account per hour', 1, 5000),
    flag('knowledge.enabled', '지식 문서', 'Knowledge documents'), flag('knowledge.rankingEnabled', '지식 순위 반영', 'Knowledge ranking'), flag('knowledge.autoEvaluationEnabled', '지식 자동 평가', 'Automatic knowledge evaluation'),
    number('knowledge.dailyCallLimit', '지식 평가 하루 호출 상한', 'Daily knowledge evaluation calls', 0, 10000), { ...number('knowledge.dailyTok', '지식 평가 하루 토큰 상한', 'Daily knowledge evaluation tokens', 0, 100000000), path: 'knowledge.dailyTokenLimit' },
    flag('topicEvaluation.autoEnabled', '주제 관련도 평가', 'Topic relevance evaluation'),
  ] },
  chat: { label: { ko: '채팅 공통', en: 'Shared chat settings' }, permission: 'settings.chat.manage', section: 'chat', fields: [
    flag('enabled', '채팅 활성화', 'Enable chat'), flag('loreAutoSave', '로어 자동 저장', 'Automatically save lore'),
    flag('diagnostics.enabled', '답변 진단', 'Answer diagnostics'),
  ] },
} satisfies Record<string, PageSettingsScope>;
export type PageSettingsScopeId = keyof typeof PAGE_SETTINGS_SCOPES;
export interface SettingRowDefinition {
  id: string;
  label: { ko: string; en: string };
  description: { ko: string; en: string };
  synonyms: readonly string[];
  section: string;
  group: string;
  scope: 'mine' | 'shared';
  permission: string;
  advanced: boolean;
}

/** The API scope/field allowlist above stays independent of navigation and keeps its wire IDs. */
const SETTING_SCOPE_LOCATION: Record<PageSettingsScopeId, { section: string; group: string; prefix: string }> = {
  appearance: { section: 'general', group: 'appearance', prefix: 'appearance.' },
  general: { section: 'general', group: 'display', prefix: '' },
  similarity: { section: 'library', group: 'similarity', prefix: '' },
  metadata: { section: 'library', group: 'metadata', prefix: 'metadata.' },
  'image-save': { section: 'media', group: 'image-save', prefix: 'imageSave.' },
  thumbnail: { section: 'media', group: 'thumbnail', prefix: 'thumbnail.' },
  'video-optimization': { section: 'media', group: 'video-optimization', prefix: 'videoOptimization.' },
  'generation-throttle': { section: 'generation', group: 'pacing', prefix: 'generationThrottle.' },
  tagger: { section: 'auto', group: 'tagger', prefix: 'tagger.' },
  kaloscope: { section: 'auto', group: 'kaloscope', prefix: 'kaloscope.' },
  embedding: { section: 'auto', group: 'embedding', prefix: 'embedding.' },
  posts: { section: 'posts', group: 'general', prefix: 'posts.' },
  chat: { section: 'chat', group: 'memory', prefix: 'chat.' },
};

/** No description: the label says it all. Rows render a description only when one is written. */
const NO_DESCRIPTION = { ko: '', en: '' };

const registeredPageRows: SettingRowDefinition[] = (Object.keys(PAGE_SETTINGS_SCOPES) as PageSettingsScopeId[]).flatMap((scope) => {
  const definition = PAGE_SETTINGS_SCOPES[scope];
  const location = SETTING_SCOPE_LOCATION[scope];
  return (definition.fields as readonly PageSettingField[]).map((field) => ({
    id: `${location.prefix}${field.path ?? field.id}`,
    label: field.label,
    description: scope === 'thumbnail' && field.id === 'quality'
      ? { ko: '기존 썸네일은 유지보수의 데이터 재매칭에서 새 품질로 다시 만들어야 해.', en: 'Rebuild existing thumbnails at Maintenance → Data rematch to apply the new quality.' }
      : NO_DESCRIPTION,
    synonyms: [scope, field.id, definition.label.ko, definition.label.en],
    section: field.id === 'diagnostics.enabled' ? 'llm' : field.id === 'imageSimilarityCheckMode' ? 'library' : location.section,
    group: scope === 'posts' ? (field.id.startsWith('knowledge.') ? 'knowledge' : field.id.startsWith('topicEvaluation.') ? 'topics' : 'general')
      : field.id === 'diagnostics.enabled' ? 'log'
        : field.id === 'imageSimilarityCheckMode' ? 'similarity' : scope === 'generation-throttle' && field.id.startsWith('reservations.') ? 'schedules' : location.group,
    scope: 'shared',
    permission: definition.permission,
    advanced: scope === 'posts' && field.id.startsWith('knowledge.daily'),
  }));
});

function setting(id: string, ko: string, en: string, description: { ko: string; en: string }, section: string, group: string, permission: string, advanced = false, scope: 'mine' | 'shared' = 'shared', synonyms: string[] = []): SettingRowDefinition {
  return { id, label: { ko, en }, description, section, group, permission, advanced, scope, synonyms };
}

const advancedKnowledgeRows = [
  ['maxDocumentsPerExecution', '작업당 문서', 'Documents per execution'], ['maxSegmentsPerDocument', '문서당 근거 구간', 'Evidence segments per document'],
  ['maxInputCharacters', '입력 글자 수', 'Input characters'], ['maxRetries', '재시도', 'Retries'],
  ['aiBundleCap', '같은 작업', 'Per execution'], ['aiDailyFamilyLimit', '문서·계정·모델당 하루', 'Per document, account and model per day'],
  ['aiGlobalMinimumCap', '사람 평가 없을 때', 'Without human feedback'], ['aiGlobalHumanRatio', '사람 대비 비율', 'Ratio to human feedback'],
  ['historyWeight', '이전 판 참고 비율', 'Earlier version weight'], ['historyCap', '이전 판 참고 상한', 'Earlier version cap'],
  ['privateRetentionDays', '작업 근거', 'Private evidence'], ['diagnosticRetentionDays', '진단 자료', 'Diagnostics'],
].map(([id, ko, en]) => setting(`posts.knowledge.${id}`, ko, en, NO_DESCRIPTION, 'posts', 'knowledge', 'settings.posts.manage', true, 'shared', ['지식 평가', 'knowledge evaluation']));
const advancedTopicRows = [
  ['dailyCallLimit', '계정당 하루 호출', 'Daily calls per account'], ['dailyTokenLimit', '계정당 하루 토큰', 'Daily tokens per account'],
  ['maxInputCharacters', '입력 글자 수', 'Input characters'], ['maxRetries', '재시도', 'Retries'],
].map(([id, ko, en]) => setting(`posts.topicEvaluation.${id}`, ko, en, NO_DESCRIPTION, 'posts', 'topics', 'settings.posts.manage', true, 'shared', ['주제 관련도', 'topic evaluation']));

function settingGroup(section: string, group: string, prefix: string, labels: string[][]): SettingRowDefinition[] {
  return labels.map(([id, ko, en]) => setting(`${prefix}${id}`, ko, en, NO_DESCRIPTION, section, group, 'page.settings.view'));
}
const appearanceRows = settingGroup('general', 'appearance', 'appearance.', [
  ['customPrimaryColor', '기본 강조색', 'Primary accent'], ['customSecondaryColor', '보조 강조색', 'Secondary accent'],
  ['customSurfaceBackgroundColor', '배경 색상', 'Background color'], ['customSurfaceLowestColor', '사이드바 바탕', 'Sidebar background'],
  ['customSurfaceContainerColor', '컨테이너 1', 'Container 1'], ['customSurfaceLowColor', '컨테이너 2', 'Container 2'], ['customSurfaceHighColor', '호버·활성 색상', 'Hover and active color'],
  ['fontPreset', '폰트', 'Font'], ['fontScalePercent', 'UI 배율 (%)', 'UI scale (%)'], ['textScalePercent', '글자 크기 (%)', 'Text size (%)'],
  ['bodyFontWeightPreset', '본문 굵기', 'Body weight'], ['emphasisFontWeightPreset', '강조 굵기', 'Emphasis weight'],
  ['desktopPageColumnsMinWidth', '데스크톱 본문 2칼럼 전환폭 (px)', 'Desktop content two-column breakpoint (px)'],
  ['selectionOutlineWidth', '선택 테두리 두께 (px)', 'Selection border width (px)'], ['groupExplorerCardStyle', '그룹 카드 스타일', 'Group card style'],
  ['detailRelatedImageMobileColumns', '유사 이미지 한 줄 카드 수 (모바일)', 'Similar images per row (mobile)'],
  ['detailRelatedImageColumns', '유사 이미지 한 줄 카드 수 (데스크톱)', 'Similar images per row (desktop)'], ['detailRelatedImageAspectRatio', '유사 이미지 카드 비율', 'Similar image card ratio'],
  ['positiveBadgeColor', '포지티브 배지', 'Positive badge'], ['negativeBadgeColor', '네거티브 배지', 'Negative badge'], ['autoBadgeColor', '오토 배지', 'Auto badge'], ['ratingBadgeColor', '평가 배지', 'Rating badge'],
]);

/** One name for the full page, contextual sheet, search and assistant. IDs are also deep-link anchors. */
export const SETTINGS_ROWS: readonly SettingRowDefinition[] = [
  ...registeredPageRows,
  ...advancedKnowledgeRows,
  ...advancedTopicRows,
  ...appearanceRows.map((row) => ({ ...row, advanced: row.id.startsWith('appearance.custom') })),
  setting('accounts.access', '계정·권한', 'Accounts and access', { ko: '계정, 권한 그룹과 복구 정보를 관리해.', en: 'Manage accounts, permission groups and recovery information.' }, 'accounts', 'access', 'page.settings.view'),
  setting('plugins.management', '플러그인', 'Plugins', { ko: '확장 기능을 설치하고 관리해.', en: 'Install and manage extensions.' }, 'plugins', 'management', 'page.settings.view'),
  setting('maintenance.operations', '유지보수', 'Maintenance', { ko: '파일 스캔·검증·재추출과 데이터 정비를 실행해.', en: 'Scan, verify, re-extract and maintain existing data.' }, 'maintenance', 'operations', 'page.settings.view'),
  setting('library.folders', '감시 폴더·백업 소스', 'Watched folders and backup sources', { ko: '라이브러리에 가져올 폴더와 백업 소스를 관리해.', en: 'Manage folders and backup sources imported into the library.' }, 'library', 'folders', 'page.settings.view'),
  setting('system.mcp', 'MCP', 'MCP', { ko: '외부 도구 연결과 API 키를 관리해.', en: 'Manage external tool access and API keys.' }, 'system', 'mcp', 'page.settings.view'),
  setting('mcpHttp.enabled', 'HTTP MCP 사용', 'Enable HTTP MCP', { ko: '권한 그룹이 지정된 API 키로 외부 도구의 접속을 허용해.', en: 'Allow external tools to connect using permission-group API keys.' }, 'system', 'mcp', 'page.settings.view'),
  setting('headerNavigation', '상단 고정 페이지', 'Pinned pages', { ko: '누른 페이지는 상단에 이름과 함께 늘 보이고(휴대폰은 앞 4개가 하단 탭), 나머지는 라이브러리·만들기·확장 메뉴에 들어가. 끌어서 순서를 바꿔. 공용 설정이야.', en: 'Pinned pages stay in the top bar with their names (the first four are the phone’s bottom tabs); the rest sit in the Library, Create and Extensions menus. Drag to reorder. Shared for everyone.' }, 'general', 'display', 'page.settings.view', false, 'shared', ['상단 메뉴', '고정', '핀', '하단 탭', 'navigation', 'pin', 'header menu']),
  setting('headerTools', '오른쪽 고정 메뉴', 'Fixed right-side menu', { ko: '헤더 오른쪽에 고정되는 메뉴야. 눌러서 표시 여부를 바꿔.', en: 'These controls stay on the right of the header. Click to show or hide them.' }, 'general', 'display', 'page.settings.view'),
  setting('chat.piCodemode', 'pi codemode', 'pi codemode', { ko: 'pi 프로필이 짧은 스크립트로 도구 여러 개를 호출해. 도구 호출 반복 한도가 적용돼.', en: 'Let pi profiles call tools through short scripts. The tool round limit applies.' }, 'llm', 'connections', 'page.settings.view'),
  setting('contentEvaluation.modelSlotId', '주제 관련도 판단 모델', 'Topic relevance judge model', { ko: '등록한 주제의 관련도를 평가할 모델이야.', en: 'The model that evaluates relevance to registered topics.' }, 'posts', 'topics', 'page.settings.view'),
  setting('posts.knowledge.judgeSlotId', '지식 판단 모델', 'Knowledge judge model', { ko: '지식 문서의 근거와 품질을 평가할 모델이야.', en: 'The model that evaluates knowledge evidence and quality.' }, 'posts', 'knowledge', 'settings.posts.manage'),
  setting('posts.knowledge.weights', '평가 비중', 'Feedback weights', { ko: '사람·사용 AI·판단 모델의 평가 비중을 정해.', en: 'Set the weights of human, use-AI and judge feedback.' }, 'posts', 'knowledge', 'settings.posts.manage', true),
  ...settingGroup('auto', 'runtime', 'aiRuntime.', [['torchBackend', 'AI 런타임 빌드', 'AI runtime build'], ['pythonSource', 'Python 환경', 'Python environment'], ['customPythonPath', '직접 지정 Python 경로', 'Custom Python path'], ['cpuThreads', 'CPU 스레드', 'CPU threads']]),
  ...settingGroup('auto', 'kaloscope', 'kaloscope.', [['artistLinkUrlTemplate', 'Artist 링크 URL', 'Artist link URL']]),
  ...settingGroup('auto', 'ratings', 'ratingWeights.', [['general_weight', 'General 가중치', 'General weight'], ['sensitive_weight', 'Sensitive 가중치', 'Sensitive weight'], ['questionable_weight', 'Questionable 가중치', 'Questionable weight'], ['explicit_weight', 'Explicit 가중치', 'Explicit weight']]),
  ...settingGroup('system', 'safety', '', [['deleteProtection.enabled', '삭제할 때 휴지통으로 보호', 'Protect deleted files with the recycle bin'], ['deleteProtection.recycleBinRetentionDays', '휴지통 보관 기간 (일)', 'Recycle bin retention (days)'], ['generationHistoryMaxItems', '생성 히스토리 최대 항목 수', 'Generation history maximum items'], ['autoCleanupCanvasOnShutdown', '종료 시 캔버스 임시 데이터 자동 정리', 'Clean up temporary canvas data on exit'], ['applyRatingSafetyToGenerationHistory', '생성 히스토리에도 등급 표시 규칙 적용', 'Apply rating visibility rules to generation history']]),
  ...settingGroup('posts', 'topics', 'posts.topicEvaluation.', [['reevaluateOnEdit', '수정하면 다시 평가', 'Re-evaluate after edits'], ['minimumScore', '목록 최소 관련도 (%)', 'Minimum list score (%)'], ['maximumTopics', '목록 주제 수', 'Maximum topics in lists']]),
  setting('language', '기본 언어', 'Default language', { ko: '앱 공용 기본 언어야. 브라우저의 계정 메뉴에서 선택한 언어가 우선해.', en: 'The shared default language. The browser’s account-menu override takes precedence.' }, 'general', 'display', 'page.settings.view'),
  setting('promptForDownloadLocation', '다운로드할 때 파일명과 위치 확인', 'Ask for file name and save location', { ko: '다운로드 전에 저장 위치를 확인해.', en: 'Ask for a destination before downloading.' }, 'general', 'display', 'page.settings.view'),
  setting('mine.persona', '채팅 사용자 프로필', 'Chat personas', { ko: '이 계정으로 대화할 때 쓸 이름과 페르소나야.', en: 'Your account’s names and personas for conversations.' }, 'mine', 'persona', 'page.chat.view', false, 'mine', ['사용자 프로필', 'user profile', '페르소나']),
  setting('mine.flags', '플래그', 'Flags', { ko: '내 플래그와 공용 플래그의 내 사본을 관리해. 관리자가 만든 원본은 공용이야.', en: 'Manage your flags and personal copies of shared flags. Administrator-created originals are shared.' }, 'mine', 'flags', 'page.chat.view', false, 'mine', ['flag', '상황']),
  setting('generation.nai', 'NovelAI 인증', 'NovelAI authentication', { ko: '모든 사용자가 쓸 서버 API 토큰을 연결해.', en: 'Connect the server API token used by all users.' }, 'generation', 'nai', 'settings.generation.manage', false, 'shared', ['NAI', '토큰', '인증', 'token']),
  setting('generation.comfyui', 'ComfyUI 서버', 'ComfyUI servers', { ko: '생성 서버를 등록하고 연결을 확인해.', en: 'Register generation servers and check connections.' }, 'generation', 'comfyui', 'settings.generation.manage', false, 'shared', ['endpoint', '엔드포인트']),
  setting('llm.connections', 'AI 연결·모델 슬롯', 'AI connections and model slots', { ko: '연결과 대표 모델을 관리해.', en: 'Manage connections and representative models.' }, 'llm', 'connections', 'page.settings.view', false, 'shared', ['LLM', '모델', 'Codex', 'Claude', 'pi']),
  setting('llm.dashboard', 'AI 사용량', 'AI usage', { ko: '연결별 사용량을 확인해.', en: 'Review usage by connection.' }, 'llm', 'dashboard', 'page.settings.view'),
  setting('llm.prompts', 'AI 프롬프트', 'AI prompts', { ko: '워크플로에서 쓸 프롬프트를 관리해.', en: 'Manage workflow prompts.' }, 'llm', 'prompts', 'page.settings.view'),
  setting('llm.log', 'AI 기록', 'AI log', { ko: '답변 진단과 판단 기록을 확인해.', en: 'Review answer diagnostics and judge logs.' }, 'llm', 'log', 'page.settings.view'),
  setting('chat.toolRoundLimit', '도구 호출 반복 한도', 'Tool round limit', { ko: '한 답변에서 모델이 도구를 부르고 결과를 받는 왕복의 최대 횟수야.', en: 'Maximum model/tool round trips in one reply.' }, 'chat', 'tools', 'settings.chat.manage', false, 'shared', ['tool', '도구', '반복']),
  setting('chat.flags', '공용 플래그', 'Shared flags', { ko: '관리자가 만든 원본은 모든 계정에 공유돼. 개인 사본은 내 설정에서 바꿔.', en: 'Administrator-created originals are shared with every account. Edit personal copies in My settings.' }, 'chat', 'flags', 'page.settings.view', false, 'shared', ['flag', '플래그']),
  setting('chat.loreSelectionLimit', '선택 로어 상위 개수', 'Top lore entries kept', { ko: '항상 적용 로어를 제외하고 키워드가 잘 맞는 로어를 이 개수까지 넣어.', en: 'Keep this many matching keyword lore entries, excluding always-on lore.' }, 'chat', 'memory', 'settings.chat.manage'),
  setting('chat.loreKeyLanguage', '로어북 추가 키 언어', 'Lorebook second key language', { ko: '영어 키와 함께 찾을 언어야.', en: 'The keyword language to match alongside English.' }, 'chat', 'memory', 'settings.chat.manage', true),
  setting('chat.webResearch.engine', '웹 검색 담당', 'Web search by', { ko: '채팅의 웹 검색을 맡을 엔진이야.', en: 'The engine responsible for chat web search.' }, 'chat', 'web', 'settings.chat.manage', false, 'shared', ['web', '검색']),
  setting('chat.webResearch.model', '웹 검색 모델', 'Web search model', { ko: '비워 두면 엔진의 기본 모델을 써.', en: 'Leave empty to use the engine default.' }, 'chat', 'web', 'settings.chat.manage'),
  setting('chat.webResearch.dailyLimit', '계정당 하루 검색', 'Searches per account a day', { ko: '비워 두면 검색 횟수를 제한하지 않아.', en: 'Leave empty for unlimited searches.' }, 'chat', 'web', 'settings.chat.manage'),
  setting('chat.diagnostics.captureRaw', '원문 기록', 'Capture raw requests', { ko: '진단할 때 요청 원문도 보관해.', en: 'Keep raw requests for diagnostics.' }, 'llm', 'log', 'settings.chat.manage', true),
  setting('chat.diagnostics.captureLimit', '채팅당 보관', 'Keep per chat', { ko: '채팅마다 보관할 진단 기록 수야.', en: 'Number of diagnostic records retained per chat.' }, 'llm', 'log', 'settings.chat.manage', true),
];
export const SETTINGS_ROW_BY_ID: Readonly<Record<string, SettingRowDefinition>> = Object.fromEntries(SETTINGS_ROWS.map((row) => [row.id, row]));
export function pageSettingRow(scope: PageSettingsScopeId, field: PageSettingField): SettingRowDefinition {
  return SETTINGS_ROW_BY_ID[`${SETTING_SCOPE_LOCATION[scope].prefix}${field.path ?? field.id}`];
}
export function settingRowHref(row: Pick<SettingRowDefinition, 'id' | 'section' | 'group'>): string {
  return `/settings?${new URLSearchParams({ section: row.section, group: row.group, setting: row.id })}`;
}
export function searchSettingsRows(query: string, access: { isAdmin?: boolean; permissionKeys?: readonly string[] }): SettingRowDefinition[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return SETTINGS_ROWS.filter((row) => {
    if (row.scope === 'shared' && !access.isAdmin) return false;
    if (!access.permissionKeys?.includes(row.permission)) return false;
    const text = [row.label.ko, row.label.en, row.description.ko, row.description.en, ...row.synonyms].join(' ').toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
export type PageSettingValue = boolean | number | string;
export interface PageSettingsSnapshot { values: Record<string, PageSettingValue>; revision: string }
/** Response metadata only; never part of the persisted settings file. */
export interface PageSettingsVersions { pageSettingsRevisions?: Partial<Record<PageSettingsScopeId, string>> }
export function isPageSettingsScope(value: string): value is PageSettingsScopeId {
  return Object.prototype.hasOwnProperty.call(PAGE_SETTINGS_SCOPES, value);
}
/** Only pages with existing applicable settings participate; public/runtime pages never inherit a scope. */
export function pageSettingsScopes(path: string): PageSettingsScopeId[] {
  const scopes = featureSettingsScopes(path);
  return scopes.length || ['/audio', '/wallpaper', '/wildcards'].includes(path) ? [...scopes.filter((id) => id !== 'appearance'), 'appearance'] : [];
}
function featureSettingsScopes(path: string): PageSettingsScopeId[] {
  if (path === '/settings') return Object.keys(PAGE_SETTINGS_SCOPES) as PageSettingsScopeId[];
  if (path === '/' || /^\/groups(?:\/[^/]+)?$/.test(path)) return ['general', 'similarity', 'thumbnail', 'embedding'];
  if (/^\/images\/[^/]+(?:\/metadata)?$/.test(path)) return ['similarity', 'metadata', 'image-save', 'tagger', 'kaloscope'];
  if (path === '/upload') return ['image-save', 'video-optimization', 'metadata', 'tagger', 'kaloscope'];
  if (path === '/generation') return ['generation-throttle', 'image-save', 'video-optimization'];
  if (path === '/posts') return ['posts', 'embedding'];
  if (path === '/chat') return ['chat', 'embedding'];
  if (path === '/prompts') return ['similarity'];
  if (path === '/files') return ['embedding'];
  if (path === '/sprite') return ['image-save'];
  return [];
}
export function pageSettingsPermission(scope: PageSettingsScopeId) { return PAGE_SETTINGS_SCOPES[scope].permission; }
export function selectPageSettings(scope: PageSettingsScopeId, source: unknown): Record<string, PageSettingValue> {
  return Object.fromEntries((PAGE_SETTINGS_SCOPES[scope].fields as readonly PageSettingField[]).map((field) => {
    const value = (field.path ?? field.id).split('.').reduce<unknown>((node, key) => node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined, source);
    return [field.id, typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : field.type === 'boolean' ? false : ''];
  }));
}
/** Validate the allowlisted flat values and build the native route's nested patch. */
export function pageSettingsPatch(scope: PageSettingsScopeId, input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length === 0) throw new Error('변경할 설정을 확인해줘.');
  const fields: readonly PageSettingField[] = PAGE_SETTINGS_SCOPES[scope].fields;
  const patch: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(input)) {
    const field = fields.find((item) => item.id === id);
    if (!field || typeof value !== field.type || (field.options && !field.options.includes(value as string | number)) || (typeof value === 'number' && (!Number.isFinite(value) || (field.integer && !Number.isSafeInteger(value)) || (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)))) throw new Error(`허용되지 않은 설정 값이야: ${id}`);
    const keys = (field.path ?? field.id).split('.');
    let node = patch;
    for (const key of keys.slice(0, -1)) { node[key] ??= {}; node = node[key] as Record<string, unknown>; }
    node[keys[keys.length - 1]] = value;
  }
  return patch;
}

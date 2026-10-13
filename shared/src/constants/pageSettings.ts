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
    flag('enableGallery', '갤러리', 'Gallery'), flag('showRatingBadges', '등급 배지', 'Rating badges'),
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
    flag('enabled', '채팅 활성화', 'Enable chat'), flag('loreAutoSave', '로어북 자동 저장', 'Automatically save lore'),
    flag('diagnostics.enabled', '답변 진단', 'Answer diagnostics'),
  ] },
} satisfies Record<string, PageSettingsScope>;
export type PageSettingsScopeId = keyof typeof PAGE_SETTINGS_SCOPES;
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

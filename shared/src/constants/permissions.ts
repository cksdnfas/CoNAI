/**
 * The one permission catalog. Each area has view / edit; only areas that destroy real files keep a separate delete.
 * Administration (settings, accounts, servers, chat setup) has no key: it belongs to administrators.
 */
export const PERMISSION_CATALOG = [
  { key: 'images.view', section: 'images', anonymous: true, label: { ko: '이미지 보기', en: 'View images' }, description: 'List and view images, videos and animated images everywhere, including chat.' },
  { key: 'images.edit', section: 'images', label: { ko: '이미지 편집·그룹 정리', en: 'Edit images and groups' }, description: 'Edit tags and metadata, process images, create groups and assign images.' },
  { key: 'images.delete', section: 'images', label: { ko: '이미지·그룹 삭제', en: 'Delete images and groups' }, description: 'Delete library images and groups.' },
  { key: 'images.upload', section: 'images', label: { ko: '이미지 업로드', en: 'Upload images' }, description: 'Upload images and videos into the library.' },
  { key: 'prompts.view', section: 'prompts', label: { ko: '프롬프트·프리셋 보기', en: 'View prompts and presets' }, description: 'Read prompt collections, groups and presets.' },
  { key: 'prompts.edit', section: 'prompts', label: { ko: '프롬프트·프리셋 편집', en: 'Edit prompts and presets' }, description: 'Add, edit, delete and import prompts, groups and presets.' },
  { key: 'wildcards.view', section: 'prompts', label: { ko: '와일드카드 보기', en: 'View wildcards' }, description: 'Read and expand wildcards.' },
  { key: 'wildcards.edit', section: 'prompts', label: { ko: '와일드카드 편집', en: 'Edit wildcards' }, description: 'Add, edit and delete wildcards and scan the LoRA folder.' },
  { key: 'generation.execute', section: 'generation', label: { ko: '이미지 생성', en: 'Generate images' }, description: 'Queue NovelAI, ComfyUI and workflow generations.' },
  { key: 'workflows.view', section: 'generation', label: { ko: '워크플로 보기', en: 'View workflows' }, description: 'Read workflows, graphs, modules and dropdown lists.' },
  { key: 'workflows.edit', section: 'generation', label: { ko: '워크플로 편집', en: 'Edit workflows' }, description: 'Create and edit workflows, graphs and schedules.' },
  { key: 'files.view', section: 'files', label: { ko: '내 파일 보기', en: 'View my files' }, description: 'Browse and download files in your own file store.' },
  { key: 'files.edit', section: 'files', label: { ko: '내 파일 올리기·정리', en: 'Upload and organize my files' }, description: 'Upload files, create folders, rename and move in your own file store.' },
  { key: 'files.delete', section: 'files', label: { ko: '내 파일 삭제', en: 'Delete my files' }, description: 'Delete files and folders in your own file store.' },
  { key: 'audio.view', section: 'audio', label: { ko: '음향 보기', en: 'View audio' }, description: 'Browse sound projects, groups and candidates, play and download them, read group comments.' },
  { key: 'audio.edit', section: 'audio', label: { ko: '음향 편집·검수', en: 'Edit and review audio' }, description: 'Create and organize sound projects and groups, upload and import sounds, review candidates and manage comments.' },
  { key: 'chat.use', section: 'chat', label: { ko: '채팅', en: 'Chat' }, description: 'Chat with API model profiles.' },
  { key: 'chat.agent.use', section: 'chat', label: { ko: '서버 에이전트 채팅 (Codex·Claude Code, 서버 계정 사용량 공유)', en: 'Server agent chat (Codex, Claude Code; shares server account usage)' }, description: 'Chat with profiles that run on the server Codex or Claude Code account.' },
  { key: 'chat.diagnostics.view', section: 'chat', label: { ko: '채팅 진단 보기', en: 'View chat diagnostics' }, description: 'Inspect how your own replies were composed.' },
  { key: 'auth.guest.create', section: 'account', anonymousOnly: true, anonymous: true, label: { ko: '게스트 가입', en: 'Guest signup' }, description: 'Create a guest account from the login page.' },
] as const satisfies ReadonlyArray<{
  key: string
  section: 'images' | 'prompts' | 'generation' | 'files' | 'audio' | 'chat' | 'account'
  label: { ko: string; en: string }
  description: string
  /** Visitors who are not signed in can use it. */
  anonymous?: boolean
  /** Only meaningful for visitors who are not signed in. */
  anonymousOnly?: boolean
}>

export type PermissionKey = (typeof PERMISSION_CATALOG)[number]['key']
export type PermissionSection = (typeof PERMISSION_CATALOG)[number]['section']

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSION_CATALOG.map((permission) => permission.key)

/**
 * Pages are not granted: each page opens for whoever holds the features it shows. These keys are derived when access
 * is resolved, so menus, route guards and chat page links keep reading one `page.*` key per page.
 */
export const PAGE_PERMISSION_RULES = {
  'page.home.view': { all: ['images.view'] },
  'page.groups.view': { all: ['images.view'] },
  'page.image-detail.view': { all: ['images.view'] },
  'page.metadata-editor.view': { all: ['images.view', 'images.edit'] },
  'page.wallpaper.view': { all: ['images.view'] },
  'page.wallpaper.runtime.view': { all: ['images.view'] },
  'page.upload.view': { all: ['images.upload'] },
  'page.prompts.view': { all: ['prompts.view'] },
  'page.wildcards.view': { all: ['wildcards.view'] },
  'page.generation.view': { any: ['generation.execute', 'workflows.view'] },
  'page.files.view': { all: ['files.view'] },
  'page.chat.view': { any: ['chat.use', 'chat.agent.use'] },
  'page.settings.view': { admin: true },
} as const satisfies Record<string, { all?: readonly PermissionKey[]; any?: readonly PermissionKey[]; admin?: true }>

export type PagePermissionKey = keyof typeof PAGE_PERMISSION_RULES

/** Add the page keys that the held feature keys open. */
export function withPagePermissions(permissionKeys: readonly string[], isAdmin: boolean): string[] {
  const held = new Set(permissionKeys)
  const pages = (Object.entries(PAGE_PERMISSION_RULES) as Array<[string, { all?: readonly string[]; any?: readonly string[]; admin?: true }]>)
    .filter(([, rule]) => rule.admin ? isAdmin : (rule.all ?? []).every((key) => held.has(key)) && (!rule.any || rule.any.some((key) => held.has(key))))
    .map(([page]) => page)
  return [...permissionKeys.filter((key) => !key.startsWith('page.')), ...pages]
}

/**
 * The one permission catalog. Administrators grant pages and three basic rights; every other app feature is open to
 * signed-in accounts, and chat bots are bounded by their profile's tool settings. Server administration stays admin-only.
 */
const page = <Id extends string>(id: Id, ko: string, en: string, anonymous = false) => ({
  key: `page.${id}.view` as const, section: 'pages' as const, label: { ko, en }, description: `Open the ${en} page.`,
  ...(anonymous ? { anonymous: true as const } : {}),
})

export const PERMISSION_CATALOG = [
  // The menu pages. Signed-out visitors can only read images, so only the image pages can be opened for them.
  page('home', '갤러리', 'Gallery', true),
  page('groups', '그룹', 'Groups', true),
  page('upload', '업로드', 'Upload'),
  page('files', '파일 보관함', 'Files'),
  page('prompts', '프롬프트', 'Prompts'),
  page('wildcards', '와일드카드', 'Wildcards'),
  page('characters', '캐릭터', 'Characters'),
  page('generation', '생성', 'Generate'),
  page('audio', '오디오', 'Audio'),
  page('sprite', '스프라이트', 'Sprites'),
  page('chat', '채팅', 'Chat'),
  page('posts', '게시판', 'Posts'),
  page('wallpaper', '월페이퍼', 'Wallpaper', true),
  page('wallpaper.runtime', '월페이퍼 런타임', 'Wallpaper runtime', true),
  page('extensions', '플러그인', 'Plugins'),
  { key: 'content.read', section: 'content', anonymous: true, label: { ko: '읽기', en: 'Read' }, description: 'View all data (images, prompts, workflows, files, audio, posts) in pages, chat and plugins. Signed-out visitors can only read images.' },
  { key: 'content.edit', section: 'content', label: { ko: '수정', en: 'Edit' }, description: 'Create, upload, change and organize shared data. Includes reading.' },
  { key: 'content.delete', section: 'content', label: { ko: '삭제', en: 'Delete' }, description: 'Delete shared data. Includes reading.' },
  { key: 'auth.guest.create', section: 'account', anonymousOnly: true, anonymous: true, label: { ko: '게스트 가입', en: 'Guest signup' }, description: 'Create a guest account from the login page.' },
] as const satisfies ReadonlyArray<{
  key: string
  section: 'pages' | 'content' | 'account'
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

/** The settings page is never granted: it follows the administrator role. */
export const ADMIN_PAGE_PERMISSION = 'page.settings.view'
/** Pages reached from the menu pages, never granted on their own (see resolvePermissionKeys). */
export const IMAGE_DETAIL_PAGE_PERMISSION = 'page.image-detail.view'
export const METADATA_EDITOR_PAGE_PERMISSION = 'page.metadata-editor.view'

export type ContentRight = 'read' | 'edit' | 'delete'
export const CONTENT_PERMISSIONS = { read: 'content.read', edit: 'content.edit', delete: 'content.delete' } as const satisfies Record<ContentRight, PermissionKey>

/**
 * Stored grants → the keys an account holds. Edit and delete include reading; image detail opens from the gallery or
 * groups, the metadata editor from image detail with editing; administrators hold everything and the settings page.
 */
export function resolvePermissionKeys(storedKeys: readonly string[], isAdmin: boolean): string[] {
  const held = new Set<string>(isAdmin ? [...PERMISSION_KEYS, ADMIN_PAGE_PERMISSION] : storedKeys)
  if (held.has(CONTENT_PERMISSIONS.edit) || held.has(CONTENT_PERMISSIONS.delete)) held.add(CONTENT_PERMISSIONS.read)
  if (held.has('page.home.view') || held.has('page.groups.view')) held.add(IMAGE_DETAIL_PAGE_PERMISSION)
  if (held.has(IMAGE_DETAIL_PAGE_PERMISSION) && held.has(CONTENT_PERMISSIONS.edit)) held.add(METADATA_EDITOR_PAGE_PERMISSION)
  return [...held]
}

export function hasContentRight(permissionKeys: readonly string[], right: ContentRight): boolean {
  return permissionKeys.includes(CONTENT_PERMISSIONS[right])
}

/**
 * What the account needs for a tool or page action of one scope: a basic right, sign-in only (generation makes new
 * things), or the administrator role. Unknown scopes need the administrator.
 */
export function scopeRequirement(scope: string): ContentRight | 'signedIn' | 'admin' {
  switch (scope) {
    case 'read': case 'backup': return 'read'
    case 'generate': return 'signedIn'
    case 'organize': case 'restore': return 'edit'
    case 'delete': return 'delete'
    default: return 'admin'
  }
}

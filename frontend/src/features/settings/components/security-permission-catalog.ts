import type { TranslationInput } from '@/i18n'
import type { PageAccessPermissionItem } from '@/lib/api-auth'

interface PermissionCatalogEntry {
  key: string
  /** Page permissions reuse the navigation label key so both screens always name a page the same way. */
  label: TranslationInput
  /** Action permissions that only work while this page permission is on. */
  children?: Array<{ key: string; label: TranslationInput }>
}

interface PermissionCatalogSection {
  id: string
  label: TranslationInput
  entries: PermissionCatalogEntry[]
}

export interface PermissionSectionRow {
  key: string
  label: TranslationInput
  parentKey: string | null
}

export interface PermissionSection {
  id: string
  label: TranslationInput
  rows: PermissionSectionRow[]
}

/** Grouping, order, and names of every permission the group editor can grant. */
const PERMISSION_CATALOG: PermissionCatalogSection[] = [
  {
    id: 'gallery',
    label: { ko: '갤러리', en: 'Gallery' },
    entries: [
      { key: 'page.home.view', label: 'pageAccessCatalog.home' },
      { key: 'page.image-detail.view', label: { ko: '이미지 상세', en: 'Image detail' } },
      { key: 'page.metadata-editor.view', label: { ko: '메타데이터 편집', en: 'Metadata editor' } },
      { key: 'page.groups.view', label: 'pageAccessCatalog.groups' },
      {
        key: 'page.upload.view',
        label: 'pageAccessCatalog.upload',
        children: [{ key: 'upload.create', label: { ko: '파일 업로드', en: 'Upload files' } }],
      },
    ],
  },
  {
    id: 'generation',
    label: { ko: '생성', en: 'Generation' },
    entries: [
      {
        key: 'page.generation.view',
        label: 'pageAccessCatalog.generation',
        children: [{ key: 'workflows.update', label: { ko: '워크플로 편집', en: 'Edit workflows' } }],
      },
      {
        key: 'page.prompts.view',
        label: 'pageAccessCatalog.prompts',
        children: [
          { key: 'prompts.create', label: { ko: '프리셋 추가', en: 'Add presets' } },
          { key: 'prompts.update', label: { ko: '프리셋 수정', en: 'Edit presets' } },
          { key: 'prompts.delete', label: { ko: '프리셋 삭제', en: 'Delete presets' } },
        ],
      },
      {
        key: 'page.wildcards.view',
        label: 'pageAccessCatalog.wildcards',
        children: [
          { key: 'wildcards.edit', label: { ko: '와일드카드 추가·수정', en: 'Add and edit wildcards' } },
          { key: 'wildcards.delete', label: { ko: '와일드카드 삭제', en: 'Delete wildcards' } },
          { key: 'wildcards.lora.scan', label: { ko: 'LoRA 폴더 스캔', en: 'Scan LoRA folder' } },
        ],
      },
    ],
  },
  {
    id: 'wallpaper',
    label: { ko: '월페이퍼', en: 'Wallpaper' },
    entries: [
      { key: 'page.wallpaper.view', label: 'pageAccessCatalog.wallpaper' },
      { key: 'page.wallpaper.runtime.view', label: 'pageAccessCatalog.wallpaperRuntime' },
    ],
  },
  {
    id: 'administration',
    label: { ko: '관리', en: 'Administration' },
    entries: [
      { key: 'auth.guest.create', label: { ko: '게스트 회원가입', en: 'Guest signup' } },
      { key: 'page.settings.view', label: 'pageAccessCatalog.settings' },
    ],
  },
]

/** Page permission → the action permissions nested under it. */
const CHILD_PERMISSION_KEYS = new Map(
  PERMISSION_CATALOG.flatMap((section) => section.entries)
    .filter((entry) => entry.children)
    .map((entry) => [entry.key, entry.children!.map((child) => child.key)]),
)

/** Action permissions nested under a page permission, dropped with it when the page permission is turned off. */
export function getChildPermissionKeys(permissionKey: string): string[] {
  return CHILD_PERMISSION_KEYS.get(permissionKey) ?? []
}

/**
 * Lay the server's grantable permissions out in the catalog's sections. Keys the catalog doesn't know yet land in a
 * trailing section under the server label, so a newly added permission still shows up.
 */
export function buildPermissionSections(available: PageAccessPermissionItem[]): PermissionSection[] {
  const availableKeys = new Set(available.map((permission) => permission.permissionKey))
  const knownKeys = new Set<string>()

  const sections = PERMISSION_CATALOG.map((section) => ({
    id: section.id,
    label: section.label,
    rows: section.entries.flatMap((entry) => {
      knownKeys.add(entry.key)
      entry.children?.forEach((child) => knownKeys.add(child.key))
      if (!availableKeys.has(entry.key)) {
        return []
      }
      return [
        { key: entry.key, label: entry.label, parentKey: null },
        ...(entry.children ?? [])
          .filter((child) => availableKeys.has(child.key))
          .map((child) => ({ key: child.key, label: child.label, parentKey: entry.key })),
      ]
    }),
  })).filter((section) => section.rows.length > 0)

  const unknownRows = available
    .filter((permission) => !knownKeys.has(permission.permissionKey))
    .map((permission) => ({ key: permission.permissionKey, label: permission.label || permission.permissionKey, parentKey: null }))

  return unknownRows.length > 0
    ? [...sections, { id: 'other', label: { ko: '기타', en: 'Other' }, rows: unknownRows }]
    : sections
}

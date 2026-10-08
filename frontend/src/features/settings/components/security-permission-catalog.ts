import type { TranslationInput } from '@/i18n'
import type { PageAccessPermissionItem } from '@/lib/api-auth'
import { PERMISSION_CATALOG, type PermissionSection as CatalogSection } from '@conai/shared'

export interface PermissionSectionRow {
  key: string
  label: TranslationInput
}

export interface PermissionSection {
  id: string
  label: TranslationInput
  rows: PermissionSectionRow[]
}

const SECTION_LABELS: Record<CatalogSection, TranslationInput> = {
  images: { ko: '이미지', en: 'Images' },
  prompts: { ko: '프롬프트', en: 'Prompts' },
  generation: { ko: '생성', en: 'Generation' },
  files: { ko: '파일 보관함', en: 'Files' },
  chat: { ko: '채팅', en: 'Chat' },
  account: { ko: '계정', en: 'Account' },
}

/**
 * Lay the server's grantable permissions out in the shared catalog's sections. The anonymous group only lists keys a
 * signed-out visitor can use; other groups leave out keys that only mean something to visitors. Keys the catalog doesn't
 * know yet land in a trailing section under the server label.
 */
export function buildPermissionSections(available: PageAccessPermissionItem[], groupKey: string | null): PermissionSection[] {
  const availableKeys = new Set(available.map((permission) => permission.permissionKey))
  const fits = (permission: (typeof PERMISSION_CATALOG)[number]) => groupKey === 'anonymous' ? 'anonymous' in permission : !('anonymousOnly' in permission)
  const sections = (Object.keys(SECTION_LABELS) as CatalogSection[]).map((id) => ({
    id,
    label: SECTION_LABELS[id],
    rows: PERMISSION_CATALOG.filter((permission) => permission.section === id && availableKeys.has(permission.key) && fits(permission))
      .map((permission) => ({ key: permission.key, label: permission.label })),
  })).filter((section) => section.rows.length > 0)

  const knownKeys = new Set<string>(PERMISSION_CATALOG.map((permission) => permission.key))
  const unknownRows = groupKey === 'anonymous' ? [] : available
    .filter((permission) => !knownKeys.has(permission.permissionKey))
    .map((permission) => ({ key: permission.permissionKey, label: permission.label || permission.permissionKey }))
  return unknownRows.length > 0 ? [...sections, { id: 'other', label: { ko: '기타', en: 'Other' }, rows: unknownRows }] : sections
}

/** A toggle changes only its own explicit grant. */
export function setPermissionGrant(keys: string[], key: string, enabled: boolean) {
  return enabled ? Array.from(new Set([...keys, key])) : keys.filter((current) => current !== key)
}

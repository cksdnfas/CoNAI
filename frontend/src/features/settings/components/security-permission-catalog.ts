import type { TranslationInput } from '@/i18n'
import type { PageAccessPermissionItem } from '@/lib/api-auth'
import { PERMISSION_CATALOG } from '@conai/shared'

export interface PermissionRow {
  key: string
  label: TranslationInput
  info?: TranslationInput
}

/** The basic rights (switches) and the menu pages (checkboxes) a group can be granted. */
export interface PermissionLayout {
  rights: PermissionRow[]
  pages: PermissionRow[]
}

const RIGHT_INFO: Partial<Record<string, TranslationInput>> = {
  'content.edit': { ko: '만들기·올리기·고치기·정리', en: 'Create, upload, change and organize' },
}

/**
 * Lay the server's grantable permissions out in catalog order. The anonymous group only lists what a signed-out visitor
 * can use (reading, guest signup, the image pages); other groups never see guest signup.
 */
export function buildPermissionLayout(available: PageAccessPermissionItem[], groupKey: string | null): PermissionLayout {
  const availableKeys = new Set(available.map((permission) => permission.permissionKey))
  const granted = PERMISSION_CATALOG.filter((permission) => availableKeys.has(permission.key)
    && (groupKey === 'anonymous' ? 'anonymous' in permission : !('anonymousOnly' in permission)))
  const toRow = (permission: (typeof granted)[number]): PermissionRow => ({ key: permission.key, label: permission.label, info: RIGHT_INFO[permission.key] })
  return {
    rights: granted.filter((permission) => permission.section !== 'pages').map(toRow),
    pages: granted.filter((permission) => permission.section === 'pages').map(toRow),
  }
}

/** A toggle changes only its own explicit grant. */
export function setPermissionGrant(keys: string[], key: string, enabled: boolean) {
  return enabled ? Array.from(new Set([...keys, key])) : keys.filter((current) => current !== key)
}

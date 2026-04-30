import type { AppLanguage } from '@/i18n'

type LocalizedMap = Record<string, Partial<Record<AppLanguage, string>>>

const BUILT_IN_GROUP_LABELS: LocalizedMap = {
  anonymous: { ko: '익명', en: 'Anonymous' },
  guest: { ko: '게스트', en: 'Guest' },
  admin: { ko: '관리자', en: 'Admin' },
}

const ACCOUNT_TYPE_LABELS: LocalizedMap = {
  admin: { ko: '관리자', en: 'Admin' },
  guest: { ko: '게스트', en: 'Guest' },
}

const ACCOUNT_STATUS_LABELS: LocalizedMap = {
  active: { ko: '활성', en: 'Active' },
  disabled: { ko: '비활성', en: 'Disabled' },
  inactive: { ko: '비활성', en: 'Inactive' },
  invited: { ko: '초대', en: 'Invited' },
  locked: { ko: '잠김', en: 'Locked' },
}

const PAGE_PERMISSION_LABELS: LocalizedMap = {
  'page.home.view': { ko: '홈', en: 'Home' },
  'page.groups.view': { ko: '그룹', en: 'Groups' },
  'page.prompts.view': { ko: '프롬프트', en: 'Prompts' },
  'page.generation.view': { ko: '생성', en: 'Generation' },
  'page.image-detail.view': { ko: '이미지 상세', en: 'Image detail' },
  'page.metadata-editor.view': { ko: '메타데이터 편집', en: 'Metadata editor' },
  'page.upload.view': { ko: '업로드', en: 'Upload' },
  'page.settings.view': { ko: '설정', en: 'Settings' },
  'page.wallpaper.view': { ko: '월페이퍼 편집', en: 'Wallpaper editor' },
  'page.wallpaper.runtime.view': { ko: '월페이퍼 런타임', en: 'Wallpaper runtime' },
}

function resolveLabel(map: LocalizedMap, key: string, language: AppLanguage) {
  return map[key]?.[language] ?? map[key]?.ko ?? null
}

export function getPermissionGroupDisplayName(language: AppLanguage, groupKey?: string | null, fallbackName?: string | null) {
  if (groupKey) {
    const label = resolveLabel(BUILT_IN_GROUP_LABELS, groupKey, language)
    if (label) {
      return label
    }
  }

  return fallbackName?.trim() || groupKey || '-'
}

export function getPermissionGroupKindLabel(language: AppLanguage, systemGroup: boolean) {
  return systemGroup
    ? (resolveLabel({ system: { ko: '시스템', en: 'System' } }, 'system', language) ?? 'System')
    : (resolveLabel({ custom: { ko: '커스텀', en: 'Custom' } }, 'custom', language) ?? 'Custom')
}

export function getAccountTypeLabel(language: AppLanguage, accountType?: string | null) {
  if (!accountType) {
    return language === 'en' ? 'None' : '없음'
  }

  return resolveLabel(ACCOUNT_TYPE_LABELS, accountType, language) ?? accountType
}

export function getAccountStatusLabel(language: AppLanguage, status?: string | null) {
  if (!status) {
    return '-'
  }

  return resolveLabel(ACCOUNT_STATUS_LABELS, status, language) ?? status
}

export function getPagePermissionLabel(language: AppLanguage, permissionKey: string, fallbackLabel?: string | null) {
  return resolveLabel(PAGE_PERMISSION_LABELS, permissionKey, language) ?? fallbackLabel?.trim() ?? permissionKey
}

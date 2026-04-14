const BUILT_IN_GROUP_LABELS: Record<string, string> = {
  anonymous: '익명',
  guest: '게스트',
  admin: '관리자',
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  admin: '관리자',
  guest: '게스트',
}

const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  active: '활성',
  disabled: '비활성',
  inactive: '비활성',
  invited: '초대',
  locked: '잠김',
}

const PAGE_PERMISSION_LABELS: Record<string, string> = {
  'page.home.view': '홈',
  'page.groups.view': '그룹',
  'page.prompts.view': '프롬프트',
  'page.generation.view': '생성',
  'page.image-detail.view': '이미지 상세',
  'page.metadata-editor.view': '메타데이터 편집',
  'page.upload.view': '업로드',
  'page.settings.view': '설정',
  'page.wallpaper.view': '월페이퍼 편집',
  'page.wallpaper.runtime.view': '월페이퍼 런타임',
}

export function getPermissionGroupDisplayName(groupKey?: string | null, fallbackName?: string | null) {
  if (groupKey && BUILT_IN_GROUP_LABELS[groupKey]) {
    return BUILT_IN_GROUP_LABELS[groupKey]
  }

  return fallbackName?.trim() || groupKey || '-'
}

export function getPermissionGroupKindLabel(systemGroup: boolean) {
  return systemGroup ? '시스템' : '커스텀'
}

export function getAccountTypeLabel(accountType?: string | null) {
  if (!accountType) {
    return '없음'
  }

  return ACCOUNT_TYPE_LABELS[accountType] ?? accountType
}

export function getAccountStatusLabel(status?: string | null) {
  if (!status) {
    return '-'
  }

  return ACCOUNT_STATUS_LABELS[status] ?? status
}

export function getPagePermissionLabel(permissionKey: string, fallbackLabel?: string | null) {
  return PAGE_PERMISSION_LABELS[permissionKey] ?? fallbackLabel?.trim() ?? permissionKey
}

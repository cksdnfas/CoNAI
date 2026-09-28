import type { TranslationInput, TranslationParams } from '@/i18n'
import type { GroupBulkAddResult, GroupBulkRemoveResult } from '@/types/group'

type Translate = (input: TranslationInput, params?: TranslationParams) => string
type FormatNumber = (value: number) => string

interface GroupBulkResultNotice {
  message: string
  tone: 'info' | 'error'
}

function withDetails(head: string, details: string[]) {
  return details.length > 0 ? `${head} (${details.join(', ')})` : head
}

/** Build a localized notice from bulk-add counts instead of showing the backend's English summary. */
export function formatGroupBulkAddNotice(result: GroupBulkAddResult, t: Translate, formatNumber: FormatNumber): GroupBulkResultNotice {
  const failedCount = result.errors?.length ?? 0
  const head = result.added_count > 0
    ? t({ ko: '{count}개 추가', en: 'Added {count}' }, { count: formatNumber(result.added_count) })
    : t({ ko: '새로 추가된 이미지 없음', en: 'No new images added' })
  const details: string[] = []

  if (result.converted_count > 0) {
    details.push(t(
      { ko: '{count}개는 자동 수집에서 직접 추가로 전환', en: '{count} switched from auto-collected to added' },
      { count: formatNumber(result.converted_count) },
    ))
  }

  if (result.skipped_count > 0) {
    details.push(t({ ko: '{count}개는 이미 그룹에 있음', en: '{count} already in the group' }, { count: formatNumber(result.skipped_count) }))
  }

  if (failedCount > 0) {
    details.push(t({ ko: '{count}개 실패', en: '{count} failed' }, { count: formatNumber(failedCount) }))
  }

  const changedCount = result.added_count + result.converted_count
  return {
    message: withDetails(head, details),
    tone: failedCount > 0 && changedCount === 0 ? 'error' : 'info',
  }
}

/**
 * Build a localized notice from bulk-remove counts.
 *
 * The server only removes direct memberships, so images shown here through a subgroup come back as
 * skipped; say so instead of letting them silently stay.
 */
export function formatGroupBulkRemoveNotice(result: GroupBulkRemoveResult, t: Translate, formatNumber: FormatNumber): GroupBulkResultNotice {
  const failedCount = result.errors?.length ?? 0
  const head = result.removed_count > 0
    ? t({ ko: '{count}개 제거', en: 'Removed {count}' }, { count: formatNumber(result.removed_count) })
    : t({ ko: '제거된 이미지 없음', en: 'No images removed' })
  const details: string[] = []

  if (result.skipped_count > 0) {
    details.push(t(
      { ko: '하위 그룹 이미지 {count}개는 그 하위 그룹에서 빼야 해', en: '{count} subgroup images must be removed from their own subgroup' },
      { count: formatNumber(result.skipped_count) },
    ))
  }

  if (failedCount > 0) {
    details.push(t({ ko: '{count}개 실패', en: '{count} failed' }, { count: formatNumber(failedCount) }))
  }

  return {
    message: withDetails(head, details),
    tone: failedCount > 0 && result.removed_count === 0 ? 'error' : 'info',
  }
}

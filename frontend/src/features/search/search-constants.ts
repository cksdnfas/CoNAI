import type { SearchScope } from './search-types'

export const SEARCH_SCOPE_TABS: Array<{ value: SearchScope; label: string }> = [
  { value: 'positive', label: '긍정' },
  { value: 'auto', label: '오토' },
  { value: 'negative', label: '부정' },
  { value: 'rating', label: '평가' },
]

export const SEARCH_SCOPE_LABELS: Record<SearchScope, string> = {
  positive: '긍정',
  negative: '부정',
  auto: '오토',
  rating: '평가',
}

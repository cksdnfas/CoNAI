import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/i18n'
import { POSTS_QUERY_KEY, getPostKnowledgeSearchStatus } from '@/lib/api-posts'

/** The search box's hint on the 지식 tab: which search runs (keyword only, or keyword + semantic, and indexing progress). */
export function useKnowledgeSearchHint(enabled: boolean) {
  const { t } = useI18n()
  const query = useQuery({ queryKey: [POSTS_QUERY_KEY, 'knowledge-search-status'], queryFn: getPostKnowledgeSearchStatus, enabled, staleTime: 30_000, refetchInterval: (current) => current.state.data?.state === 'indexing' ? 5000 : false })
  const status = query.data
  if (!enabled || !status) return null
  return status.state === 'ready' ? t({ ko: '키워드 + 의미 검색', en: 'Keyword + semantic search' })
    : status.state === 'indexing' || status.state === 'partial' ? t({ ko: '키워드 검색 · 의미 색인 {indexed}/{total}', en: 'Keyword search · semantic index {indexed}/{total}' }, { indexed: status.indexed, total: status.total })
      : status.state === 'unavailable' ? t({ ko: '키워드 검색 · 의미 검색 준비 안 됨', en: 'Keyword search · semantic search unavailable' })
        : t({ ko: '키워드 검색', en: 'Keyword search' })
}

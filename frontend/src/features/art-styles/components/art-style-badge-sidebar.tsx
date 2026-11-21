import { Layers, Tag } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { SidebarGroupLabel, SidebarItem, SidebarNav } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n'
import type { ArtStyleBadgeCount } from '@/lib/api-art-styles'

/**
 * The badges on the listed styles (search and favorites apply, the badge filter does not) with their counts; a click
 * toggles a badge in the filter (every chosen badge must be on a style). 전체 clears it.
 */
export function ArtStyleBadgeSidebar({ badges, selected, loading, error, onRetry, onToggle, onClear }: {
  badges: ArtStyleBadgeCount[]
  selected: string[]
  loading: boolean
  error: unknown
  onRetry: () => void
  onToggle: (badge: string) => void
  onClear: () => void
}) {
  const { t, formatNumber } = useI18n()
  return (
    <SidebarNav aria-label={t({ ko: '배지', en: 'Badges' })}>
      <SidebarItem icon={Layers} label={t({ ko: '전체', en: 'All' })} active={!selected.length} onClick={onClear} />
      <SidebarGroupLabel>{t({ ko: '배지', en: 'Badges' })}</SidebarGroupLabel>
      {loading && !badges.length ? Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} radius="sm" className="h-9 w-full" />)
        : error && !badges.length ? <ErrorState size="compact" title={t({ ko: '배지를 불러오지 못했어', en: 'Could not load badges' })} error={error} onRetry={onRetry} />
          : !badges.length ? <EmptyState size="compact" title={t({ ko: '아직 배지가 없어', en: 'No badges yet' })} />
            : badges.map((entry) => (
              <SidebarItem key={entry.badge} icon={Tag} label={entry.badge} title={entry.badge} count={formatNumber(entry.count)} active={selected.includes(entry.badge)} aria-pressed={selected.includes(entry.badge)} onClick={() => onToggle(entry.badge)} />
            ))}
    </SidebarNav>
  )
}

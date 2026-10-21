import { useQuery } from '@tanstack/react-query'
import { TextTabs } from '@/components/common/text-tabs'
import { ListRow } from '@/components/ui/list-row'
import { useI18n } from '@/i18n'
import { getDanbooruBrowserTags } from '@/lib/api-danbooru-browser'
import { searchPromptCollection } from '@/lib/api-prompts'
import { wildcardItemsQueryOptions } from '@/lib/api-wildcards'
import { cn } from '@/lib/utils'
import type { PromptTypeFilter } from '@/types/prompt'
import type { PromptRandomTokenSource } from './prompt-random-token'
import type { PromptRandomSourceEntry } from './use-prompt-random-sources'
import { formatPromptAutocompleteCount } from './use-prompt-inline-autocomplete'
import type { PromptWildcardTool } from './wildcard-inline-picker-helpers'

export type PromptPaletteTab = 'all' | PromptRandomTokenSource

export const PROMPT_PALETTE_TABS: PromptPaletteTab[] = ['all', 'wildcard', 'tag', 'my']
const PALETTE_LIST_LIMIT = 30
const PEEK_LIMIT = 10

/** Chip/badge tone per source: tag group = info, wildcard = warning, my group = success. */
export const PROMPT_RANDOM_SOURCE_TONE: Record<PromptRandomTokenSource, string> = {
  tag: 'bg-info-soft text-info-soft-foreground',
  wildcard: 'bg-warning-soft text-warning-soft-foreground',
  my: 'bg-success-soft text-success-soft-foreground',
}

export function usePromptRandomSourceLabels() {
  const { t } = useI18n()
  return {
    all: t({ ko: '전체', en: 'All' }),
    wildcard: t({ ko: '와일드카드', en: 'Wildcard' }),
    tag: t({ ko: '태그 그룹', en: 'Tag group' }),
    my: t({ ko: '내 그룹', en: 'My group' }),
  } satisfies Record<PromptPaletteTab, string>
}

const RECENT_KEY_PREFIX = 'conai.prompt-palette.recent.'
const MAX_RECENT_ENTRIES = 8

/** Stable identity of a source across reloads (ids of tag nodes and groups can change on re-import). */
export function getPromptPaletteEntryKey(entry: Pick<PromptRandomSourceEntry, 'source' | 'name'>) {
  return `${entry.source}:${entry.name}`
}

export function readPromptPaletteRecents(tool: PromptWildcardTool): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(`${RECENT_KEY_PREFIX}${tool}`) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string').slice(0, MAX_RECENT_ENTRIES) : []
  } catch {
    return []
  }
}

/** Move one entry to the front of the tool's recent list and persist it. */
export function rememberPromptPaletteEntry(tool: PromptWildcardTool, recents: string[], entry: PromptRandomSourceEntry) {
  const key = getPromptPaletteEntryKey(entry)
  const next = [key, ...recents.filter((recent) => recent !== key)].slice(0, MAX_RECENT_ENTRIES)
  window.localStorage.setItem(`${RECENT_KEY_PREFIX}${tool}`, JSON.stringify(next))
  return next
}

/**
 * Entries for one palette tab. Without a query recently used sources come first; with a query starts-with beats
 * contains, then recent use, then larger sources.
 */
export function filterPromptPaletteEntries(entries: PromptRandomSourceEntry[], tab: PromptPaletteTab, query: string, recents: string[]) {
  const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, '_')
  const recentRank = (entry: PromptRandomSourceEntry) => {
    const index = recents.indexOf(getPromptPaletteEntryKey(entry))
    return index < 0 ? Number.POSITIVE_INFINITY : index
  }
  return entries
    .filter((entry) => tab === 'all' || entry.source === tab)
    .map((entry) => {
      const haystacks = [entry.name, entry.translatedName ?? ''].map((text) => text.toLowerCase().replace(/\s+/g, '_'))
      const score = !normalizedQuery ? 1 : haystacks.some((text) => text.startsWith(normalizedQuery)) ? 2 : haystacks.some((text) => text.includes(normalizedQuery)) ? 1 : 0
      return { entry, score, recent: recentRank(entry) }
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => (
      right.score - left.score
      || (left.recent === right.recent ? 0 : left.recent < right.recent ? -1 : 1)
      || right.entry.count - left.entry.count
      || left.entry.name.localeCompare(right.entry.name)
    ))
    .slice(0, PALETTE_LIST_LIMIT)
    .map(({ entry }) => entry)
}

function usePaletteEntryPeek(entry: PromptRandomSourceEntry | null, tool: PromptWildcardTool, promptType: PromptTypeFilter) {
  const wildcardQuery = useQuery(wildcardItemsQueryOptions(entry?.wildcard?.id ?? null, tool, PEEK_LIMIT))
  const tagQuery = useQuery({
    queryKey: ['prompt-palette-peek', 'tag', entry?.taxonomyNodeId],
    queryFn: () => getDanbooruBrowserTags({ taxonomyNodeId: entry?.taxonomyNodeId, page: 1, limit: PEEK_LIMIT }),
    enabled: entry?.source === 'tag' && entry.taxonomyNodeId !== undefined,
    staleTime: 60_000,
    retry: false,
  })
  const myQuery = useQuery({
    queryKey: ['prompt-palette-peek', 'my', promptType, entry?.groupId],
    queryFn: () => searchPromptCollection({ query: '', type: promptType, page: 1, limit: PEEK_LIMIT, sortBy: 'usage_count', sortOrder: 'DESC', groupId: entry?.groupId }),
    enabled: entry?.source === 'my' && entry.groupId !== undefined,
    staleTime: 30_000,
  })

  if (!entry) {
    return { items: [] as string[], isLoading: false, isError: false }
  }
  if (entry.source === 'wildcard' && entry.wildcard) {
    return {
      items: (wildcardQuery.data ?? []).map((item) => item.content.trim()).filter(Boolean).slice(0, PEEK_LIMIT),
      isLoading: wildcardQuery.isLoading,
      isError: wildcardQuery.isError,
    }
  }
  if (entry.source === 'tag') {
    return { items: (tagQuery.data?.items ?? []).map((tag) => tag.displayName), isLoading: tagQuery.isLoading, isError: tagQuery.isError }
  }
  return { items: (myQuery.data?.items ?? []).map((item) => item.prompt), isLoading: myQuery.isLoading, isError: myQuery.isError }
}

/** `@` palette: one list for wildcards, Danbooru tag groups and my prompt groups, with a peek of the highlighted source. */
export function PromptRandomPalette({ tab, entries, recents, activeIndex, isLoading, tool, promptType, onChangeTab, onHoverIndex, onInsert }: {
  tab: PromptPaletteTab
  entries: PromptRandomSourceEntry[]
  /** Recently inserted entry keys, newest first. */
  recents: string[]
  activeIndex: number
  isLoading: boolean
  tool: PromptWildcardTool
  promptType: PromptTypeFilter
  onChangeTab: (tab: PromptPaletteTab) => void
  onHoverIndex: (index: number) => void
  onInsert: (entry: PromptRandomSourceEntry, openEditor: boolean) => void
}) {
  const { t } = useI18n()
  const labels = usePromptRandomSourceLabels()
  const activeEntry = entries[activeIndex] ?? null
  const peek = usePaletteEntryPeek(activeEntry, tool, promptType)

  return (
    <div className="flex max-h-[inherit] min-h-0 flex-col">
      <div className="shrink-0" onMouseDown={(event) => event.preventDefault()}>
        <TextTabs
          value={tab}
          items={PROMPT_PALETTE_TABS.map((paletteTab) => ({ value: paletteTab, label: labels[paletteTab] }))}
          onChange={onChangeTab}
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-2">
        <div role="listbox" className="min-h-0 overflow-y-auto p-1">
          {entries.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">
              {isLoading ? t({ ko: '불러오는 중…', en: 'Loading…' }) : t({ ko: '맞는 소스가 없어요.', en: 'No matching sources.' })}
            </div>
          ) : entries.map((entry, index) => (
            <ListRow
              key={entry.id}
              asChild
              interactive
              size="sm"
              selected={index === activeIndex}
              leading={<span className={cn('rounded-sm px-1 text-2xs', PROMPT_RANDOM_SOURCE_TONE[entry.source])}>{labels[entry.source]}</span>}
              trailing={<span className="font-mono text-2xs tabular-nums">{formatPromptAutocompleteCount(entry.count)}</span>}
            >
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
                onMouseEnter={() => onHoverIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault()
                  onInsert(entry, event.shiftKey)
                }}
              >
                <span className="truncate">
                  {entry.name}
                  {entry.translatedName ? <span className="ml-1.5 text-xs text-muted-foreground">{entry.translatedName}</span> : null}
                </span>
                {recents.includes(getPromptPaletteEntryKey(entry)) ? (
                  <span className="shrink-0 rounded-sm bg-surface-container px-1 text-2xs text-muted-foreground">{t('image-generation.components.wildcard.inline.picker.field.recent')}</span>
                ) : null}
              </button>
            </ListRow>
          ))}
        </div>

        <div className="hidden min-h-0 overflow-y-auto border-l border-line p-2 sm:block">
          {activeEntry ? (
            <>
              <div className="mb-1.5 truncate text-2xs text-muted-foreground">
                {activeEntry.count > 0
                  ? t({ ko: `${labels[activeEntry.source]} · ${activeEntry.count}개 중 일부`, en: `${labels[activeEntry.source]} · sample of ${activeEntry.count}` })
                  : t({ ko: `${labels[activeEntry.source]} · 비어 있음`, en: `${labels[activeEntry.source]} · empty` })}
              </div>
              {peek.isLoading ? (
                <div className="text-xs text-muted-foreground">{t({ ko: '불러오는 중…', en: 'Loading…' })}</div>
              ) : peek.isError ? (
                <div className="text-xs text-destructive">{t({ ko: '미리보기를 불러오지 못했어.', en: 'Could not load the preview.' })}</div>
              ) : peek.items.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {peek.items.map((item, index) => (
                    <span key={`${activeEntry.id}:${index}`} className="max-w-full truncate rounded-sm bg-surface-container px-1.5 py-0.5 text-2xs">{item}</span>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">{t({ ko: '항목이 없어요.', en: 'No items.' })}</div>
              )}
            </>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap gap-x-3 bg-surface-high px-3 py-1 text-2xs text-muted-foreground">
        <span>{t({ ko: '↑↓ 이동', en: '↑↓ move' })}</span>
        <span>{t({ ko: 'Tab 탭 전환', en: 'Tab switch tab' })}</span>
        <span>{t({ ko: 'Enter 넣기', en: 'Enter insert' })}</span>
        <span>{t({ ko: 'Shift+Enter 옵션 정하고 넣기', en: 'Shift+Enter insert with options' })}</span>
      </div>
    </div>
  )
}

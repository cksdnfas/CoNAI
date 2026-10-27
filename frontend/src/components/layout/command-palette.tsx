import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Search, Settings2, Zap, type LucideIcon } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { searchSettingsRows, settingRowHref } from '@conai/shared'
import { SearchField } from '@/components/common/search-field'
import { ListRow } from '@/components/ui/list-row'
import { Modal } from '@/components/ui/modal'
import { RowGroup } from '@/components/ui/row-group'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { listAccessiblePageAccessItems } from '@/features/auth/page-access-catalog'
import { SETTINGS_TAB_LABELS, type SettingsTab } from '@/features/settings/settings-tabs'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useChatPage } from '@/features/codex-chat/chat-page-context'
import { authCatalog } from '@/i18n/resources/auth'
import { useI18n } from '@/i18n'
import { formatShortcut } from '@/lib/keyboard-shortcut'

type PaletteItem = { id: string; label: string; terms: string[]; icon: LucideIcon; current?: boolean; run: () => void }
type PaletteGroup = { id: string; heading: string; items: PaletteItem[] }

/** Higher is better, -1 when the query's letters do not appear in order. A contiguous hit near the start ranks first. */
function fuzzyScore(text: string, query: string) {
  const haystack = text.toLowerCase()
  const index = haystack.indexOf(query)
  if (index >= 0) return 1000 - index
  let position = 0
  let gaps = 0
  for (const char of query.replace(/\s+/g, '')) {
    const next = haystack.indexOf(char, position)
    if (next < 0) return -1
    gaps += next - position
    position = next + 1
  }
  return 500 - gaps
}

function filterItems(items: PaletteItem[], query: string) {
  if (!query) return items
  return items
    .map((item) => ({ item, score: Math.max(...item.terms.map((term) => fuzzyScore(term, query))) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item)
}

/**
 * Ctrl/⌘+K palette: open a page the account may view, or run one of the current screen's registered `view` operations
 * (the same page actions the assistant uses, through the same checks). Saves never run from here.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n()
  return (
    <Modal open={open} onClose={onClose} title={t({ ko: '빠른 실행', en: 'Command palette' })} size="md" height="medium">
      <CommandPaletteBody onClose={onClose} />
    </Modal>
  )
}

/** Mounted only while the dialog is open, so every open starts with an empty query. */
function CommandPaletteBody({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const { showSnackbar } = useSnackbar()
  const auth = useAuthStatusQuery().data
  const permissionKeys = auth?.permissionKeys ?? []
  const page = useChatPage()
  const watchCommandActions = page?.watchCommandActions
  const runCommandAction = page?.runCommandAction
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()

  // Pages list their operations only while someone (a connected chat or this palette) needs them.
  useEffect(() => watchCommandActions?.(), [watchCommandActions])

  // Closing first returns focus to the opener before the operation moves it; the extra watch keeps the screen's
  // operations registered until the run is over.
  const run = (action: () => void | Promise<void>) => {
    const release = watchCommandActions?.()
    onClose()
    Promise.resolve().then(action).catch((error: unknown) => {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '작업을 실행하지 못했어.', en: 'Could not run the operation.' }), tone: 'error' })
    }).finally(release)
  }

  const actionItems: PaletteItem[] = (page?.commandActions ?? []).map((action) => ({
    id: `action:${action.id}`,
    label: action.label,
    terms: [action.label, action.id],
    icon: Zap,
    run: () => run(() => runCommandAction?.(action.id)),
  }))
  const pageItems: PaletteItem[] = listAccessiblePageAccessItems(permissionKeys).map((item) => {
    const labels = authCatalog[item.labelKey] ?? {}
    return {
      id: `page:${item.path}`,
      label: t(item.labelKey),
      // Korean and English names both match, whichever language the screen shows.
      terms: [labels.ko ?? '', labels.en ?? '', item.path],
      icon: item.icon,
      current: item.path === location.pathname,
      run: () => run(() => navigate(item.path)),
    }
  })
  const normalizedQuery = query.trim().toLowerCase()
  const groups: PaletteGroup[] = [
    { id: 'actions', heading: t({ ko: '이 화면', en: 'This screen' }), items: filterItems(actionItems, normalizedQuery) },
    { id: 'settings', heading: t({ ko: '설정', en: 'Settings' }), items: normalizedQuery ? searchSettingsRows(normalizedQuery, auth ?? {}).map((row) => ({
      id: `setting:${row.id}`, label: `${t(row.label)} · ${t(SETTINGS_TAB_LABELS[row.section as SettingsTab])}`, terms: [], icon: Settings2, run: () => run(() => navigate(settingRowHref(row))),
    })) : [] },
    { id: 'pages', heading: t({ ko: '페이지 이동', en: 'Go to page' }), items: filterItems(pageItems, normalizedQuery) },
  ].filter((group) => group.items.length > 0)
  const items = groups.flatMap((group) => group.items)
  const offsets = groups.map((_, groupIndex) => groups.slice(0, groupIndex).reduce((count, group) => count + group.items.length, 0))
  const activeIndex = Math.min(active, Math.max(items.length - 1, 0))
  const activeItem = items[activeIndex]
  const optionId = (index: number) => `${listId}-${index}`

  useEffect(() => {
    document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, listId])

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (items.length) setActive((activeIndex + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length)
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <SearchField
        autoFocus
        value={query}
        onChange={(value) => { setQuery(value); setActive(0) }}
        onSubmit={() => activeItem?.run()}
        onKeyDown={handleKeyDown}
        placeholder={t({ ko: '페이지나 작업 찾기', en: 'Search pages and actions' })}
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeItem ? optionId(activeIndex) : undefined}
      />
      <div id={listId} role="listbox" aria-label={t({ ko: '결과', en: 'Results' })} className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        {groups.map((group, groupIndex) => (
          <RowGroup key={group.id} heading={group.heading} headingAs="div" role="group" aria-label={group.heading}>
            {group.items.map((item, position) => {
              const itemIndex = offsets[groupIndex] + position
              const Icon = item.icon
              return (
                <ListRow key={item.id} asChild interactive size="sm" selected={itemIndex === activeIndex} leading={<Icon className="size-4 text-muted-foreground" />} trailing={item.current ? <span className="text-xs">{t({ ko: '현재', en: 'Current' })}</span> : null}>
                  <button type="button" id={optionId(itemIndex)} role="option" aria-selected={itemIndex === activeIndex} tabIndex={-1} onMouseMove={() => setActive(itemIndex)} onClick={item.run}>
                    <span className="truncate">{item.label}</span>
                  </button>
                </ListRow>
              )
            })}
          </RowGroup>
        ))}
        {items.length === 0 ? <EmptyState size="compact" icon={Search} title={t({ ko: '맞는 항목이 없어', en: 'Nothing matches' })} /> : null}
      </div>
      <p className="text-xs text-muted-foreground">{t({ ko: '↑↓ 이동 · Enter 실행 · Esc 닫기 · {keys} 열기', en: '↑↓ move · Enter run · Esc close · {keys} open' }, { keys: formatShortcut('Mod+K') })}</p>
    </div>
  )
}

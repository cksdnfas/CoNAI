import { useEffect, useRef, useState, type PropsWithChildren } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { SETTINGS_ROW_BY_ID, searchSettingsRows, settingRowHref } from '@conai/shared'
import { SearchField } from '@/components/common/search-field'
import { Button } from '@/components/ui/button'
import { ListRow } from '@/components/ui/list-row'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { SETTINGS_TAB_LABELS, type SettingsTab } from '../settings-tabs'

export function SettingsSearch() {
  const { t } = useI18n()
  const auth = useAuthStatusQuery().data
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const results = query.trim() ? searchSettingsRows(query, auth ?? {}) : []
  return <div className="min-w-0 flex-1">
    <SearchField value={query} onChange={setQuery} placeholder={t({ ko: '설정 검색', en: 'Search settings' })} onSubmit={() => { if (results[0]) { navigate(settingRowHref(results[0])); setQuery('') } }} />
    {query.trim() ? <div className="absolute z-20 max-h-80 overflow-y-auto border border-line bg-surface-low shadow-elevation-2">
      {results.map((row) => <ListRow key={row.id} asChild interactive><Link to={settingRowHref(row)} onClick={() => setQuery('')}><span>{t(row.label)} <span className="text-xs text-muted-foreground">· {t(SETTINGS_TAB_LABELS[row.section as SettingsTab])}</span></span>{t(row.description) ? <span className="text-xs text-muted-foreground">{t(row.description)}</span> : null}</Link></ListRow>)}
      {!results.length ? <p className="p-3 text-sm">{t({ ko: '맞는 설정이 없어.', en: 'No matching settings.' })}</p> : null}
    </div> : null}
  </div>
}

export function SettingsGroup({ id, title, children }: PropsWithChildren<{ id: string; title: string }>) {
  // The margin clears the fixed header and the sticky page toolbar when a link aligns the group to the top.
  return <section data-settings-group={id} className="scroll-mt-36 space-y-4"><h2 className="text-sm font-semibold">{title}</h2>{children}</section>
}

export function RegistrySettingsGroup({ id, contents = false, children }: PropsWithChildren<{ id: string; contents?: boolean }>) {
  const { t } = useI18n()
  const row = SETTINGS_ROW_BY_ID[id]
  return <div className="space-y-4">
    {contents ? <SettingsContents groups={[{ id: row.group, label: t(row.label) }]} /> : null}
    <SettingsGroup id={row.group} title={t(row.label)}><div data-setting-id={id}><p className="mb-4 text-sm text-muted-foreground">{t(row.description)}</p>{children}</div></SettingsGroup>
  </div>
}

export function SettingsContents({ groups }: { groups: Array<{ id: string; label: string }> }) {
  const { t } = useI18n()
  const [params] = useSearchParams()
  return <nav className="flex flex-wrap gap-1" aria-label={t({ ko: '설정 목차', en: 'Settings contents' })}>{groups.map((group) => {
    const next = new URLSearchParams(params); next.set('group', group.id); next.delete('setting')
    return <Button key={group.id} asChild variant="ghost" size="sm"><Link to={`?${next}`}>{group.label}</Link></Button>
  })}</nav>
}

/** Input that means the user is moving on their own: the jump stops holding its target. */
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const

/**
 * Bring the addressed group or row into view and keep it there while lazy sections and their data load above it
 * (each mount or resize re-aligns it), until the user scrolls or types. No polling or guessed render timeout.
 */
export function SettingsJumpTarget({ children }: PropsWithChildren) {
  const ref = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const [params] = useSearchParams()
  const setting = params.get('setting')
  const group = params.get('group')
  useEffect(() => {
    const root = ref.current
    if (!root || (!setting && !group)) return
    const selector = setting ? `[data-setting-id="${CSS.escape(setting)}"]` : `[data-settings-group="${CSS.escape(group!)}"]`
    let animation: Animation | undefined
    const align = () => {
      const target = root.querySelector<HTMLElement>(selector)
      if (!target) return
      for (let parent = target.parentElement; parent && parent !== root; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true
      }
      target.scrollIntoView({ block: setting ? 'center' : 'start' })
      if (setting && !animation) animation = target.animate([{ backgroundColor: 'var(--color-fill)' }, { backgroundColor: 'transparent' }], { duration: 1800 })
    }
    const mounts = new MutationObserver(align)
    const resizes = new ResizeObserver(align)
    const release = () => {
      mounts.disconnect()
      resizes.disconnect()
      for (const type of USER_SCROLL_EVENTS) window.removeEventListener(type, release)
    }
    mounts.observe(root, { childList: true, subtree: true })
    resizes.observe(root)
    for (const type of USER_SCROLL_EVENTS) window.addEventListener(type, release, { passive: true })
    align()
    return () => { release(); animation?.cancel() }
  }, [setting, group, location.key])
  return <div ref={ref}>{children}</div>
}

export function SettingsAdvanced({ count, children }: PropsWithChildren<{ count: number }>) {
  const { t } = useI18n()
  return <details className="border-t border-line py-3"><summary className="cursor-pointer text-sm text-muted-foreground">{t({ ko: '고급 설정 {count}개', en: '{count} advanced settings' }, { count })}</summary><div className="mt-4">{children}</div></details>
}

/** Scrolling groups stay mounted; only the addressed group's assistant adapter owns the page snapshot. */
export function useSettingsGroupActive(group: string, defaultGroup: string) {
  const [params] = useSearchParams()
  return (params.get('group') ?? defaultGroup) === group
}

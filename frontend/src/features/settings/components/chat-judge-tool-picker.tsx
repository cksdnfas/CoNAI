import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Plus, Search, X } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { ListRow } from '@/components/ui/list-row'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tip } from '@/components/ui/tooltip'
import { getChatScopeCopy } from '@/features/codex-chat/chat-scope-copy'
import { judgeToolGroups, matchesChatTool, type JudgeToolEntry, type JudgeToolGroup } from '@/features/codex-chat/chat-tool-catalog'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { useChatToolGroups } from './chat-tool-picker'

/** What the server accepts as a judge tool: a tool name, or a prefix ending in `*`. */
const TOOL_PATTERN = /^[a-z0-9_]{1,64}\*?$/

/** The tools and patterns a judge item can steer, grouped, plus a lookup by name (null while the list loads). */
function useJudgeTools() {
  const { t } = useI18n()
  const { groups: serverGroups, isPending } = useChatToolGroups(true)
  return useMemo(() => {
    const groups = judgeToolGroups(serverGroups, t, (scope) => getChatScopeCopy(scope, t).label)
    const byName = new Map(groups.flatMap((group) => group.tools.map((tool) => [tool.name, tool] as const)))
    return { groups, byName: isPending ? null : byName }
  }, [serverGroups, isPending, t])
}

/** Whether a pattern typed by hand still reaches a listed tool (a `prefix*` covering one, or a listed name). */
function reachesListed(pattern: string, byName: Map<string, JudgeToolEntry>) {
  if (byName.has(pattern)) return true
  if (!pattern.endsWith('*')) return false
  const prefix = pattern.slice(0, -1)
  return [...byName.keys()].some((name) => name.startsWith(prefix))
}

/** One chosen tool as a chip: its label (the name in the tooltip), or the raw name when the list has no label for it. */
function ToolChip({ name, byName, struck = false, onRemove }: { name: string; byName: Map<string, JudgeToolEntry> | null; struck?: boolean; onRemove?: () => void }) {
  const { t } = useI18n()
  const entry = byName?.get(name)
  const missing = byName !== null && !reachesListed(name, byName)
  const tone = struck ? 'muted' : missing ? 'warning' : entry?.pattern || (!entry && name.endsWith('*')) ? 'primary' : 'success'
  const tip = (
    <span className="block max-w-72">
      {entry ? <span className="block">{entry.description}</span> : missing ? <span className="block">{t({ ko: '지금 도구 목록에 없어.', en: 'Not in the tool list now.' })}</span> : null}
      <span className={cn('block font-mono text-2xs', (entry || missing) && 'mt-1 opacity-70')}>{name}</span>
    </span>
  )
  return (
    <Tip content={tip} side="bottom" align="start">
      <Chip size="sm" tone={tone} className={cn(!entry && 'font-mono', struck && 'line-through')}>
        {entry?.label ?? name}
        {onRemove ? <IconButton size="icon-xs" variant="ghost" className="-mr-1 size-4" tooltip={false} onClick={onRemove} label={t({ ko: '빼기', en: 'Remove' })}><X /></IconButton> : null}
      </Chip>
    </Tip>
  )
}

/**
 * The search list behind the add button: every tool grouped, toggled by click or by arrows + Enter while the search
 * box keeps focus. A search that reads as a tool name the list lacks offers it as typed, last.
 */
function ToolMenu({ groups, byName, tools, onToggle }: { groups: JudgeToolGroup[]; byName: Map<string, JudgeToolEntry> | null; tools: string[]; onToggle: (name: string) => void }) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const visible = useMemo(
    () => groups.map((group) => ({ ...group, tools: group.tools.filter((tool) => matchesChatTool(tool, query)) })).filter((group) => group.tools.length > 0),
    [groups, query],
  )
  const typed = query.trim()
  const raw = TOOL_PATTERN.test(typed) && !byName?.has(typed) ? typed : null
  const options = [...visible.flatMap((group) => group.tools.map((tool) => tool.name)), ...(raw ? [raw] : [])]
  const current = Math.min(active, options.length - 1)

  useEffect(() => {
    listRef.current?.querySelector(`[data-option="${current}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [current])

  let index = 0
  const option = (name: string, label: ReactNode, trailing?: ReactNode) => {
    const at = index++
    const chosen = tools.includes(name)
    return (
      <ListRow
        asChild
        interactive
        size="sm"
        leading={<span className="flex size-3.5 text-primary">{chosen ? <Check className="size-3.5" /> : null}</span>}
        trailing={trailing}
        className={cn('min-h-8 gap-2 rounded-sm border-b-0 text-xs', at === current && 'bg-fill')}
      >
        <button type="button" role="option" aria-selected={chosen} data-option={at} onMouseMove={() => setActive(at)} onClick={() => onToggle(name)}>
          {label}
        </button>
      </ListRow>
    )
  }

  return (
    <>
      <div className="relative border-b border-line">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          className="h-10 rounded-none border-0 bg-transparent pl-9 text-xs focus-visible:ring-0"
          placeholder={t({ ko: '도구 찾기', en: 'Find a tool' })}
          aria-label={t({ ko: '도구 찾기', en: 'Find a tool' })}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (options.length > 0) setActive((current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
            } else if (event.key === 'Enter') {
              event.preventDefault()
              if (options[current]) onToggle(options[current])
            }
          }}
        />
      </div>
      <div ref={listRef} role="listbox" aria-multiselectable className="max-h-80 overflow-y-auto p-1">
        {visible.map((group) => (
          <div key={group.id} role="group" aria-label={group.label}>
            <div className="px-2 pt-2 pb-0.5 text-2xs font-semibold text-muted-foreground">{group.label}</div>
            {group.tools.map((tool) => (
              <Tip key={tool.name} content={<span className="block max-w-72">{tool.description}</span>} side="right" align="start">
                {option(
                  tool.name,
                  <span className={cn('truncate', tool.pattern && 'text-primary')}>{tool.label}</span>,
                  <span className="font-mono text-2xs">{tool.name}</span>,
                )}
              </Tip>
            ))}
          </div>
        ))}
        {options.length === 0 ? <p className="px-2 py-3 text-xs text-muted-foreground">{t({ ko: '맞는 도구가 없어.', en: 'No matching tool.' })}</p> : null}
      </div>
      {raw ? (
        <div className="border-t border-line p-1">
          {option(raw, <span className="truncate text-muted-foreground">{t({ ko: '이름 그대로 넣기', en: 'Add as typed' })} <span className="font-mono text-foreground">{raw}</span></span>)}
        </div>
      ) : null}
    </>
  )
}

/** "On yes" tools of a before-reply judge item: chips by label, and an add button opening the searchable list. */
export function JudgeToolPicker({ tools, onChange }: { tools: string[]; onChange: (tools: string[]) => void }) {
  const { t } = useI18n()
  const { groups, byName } = useJudgeTools()
  const toggle = (name: string) => onChange(tools.includes(name) ? tools.filter((entry) => entry !== name) : [...tools, name])
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tools.map((tool) => <ToolChip key={tool} name={tool} byName={byName} onRemove={() => onChange(tools.filter((entry) => entry !== tool))} />)}
      <Popover>
        <PopoverTrigger asChild>
          <IconButton size="icon-sm" variant="ghost" label={t({ ko: '도구 추가', en: 'Add tool' })}><Plus /></IconButton>
        </PopoverTrigger>
        <PopoverContent align="start" collisionPadding={12} className="flex w-80 flex-col overflow-hidden p-0">
          <ToolMenu groups={groups} byName={byName} tools={tools} onToggle={toggle} />
        </PopoverContent>
      </Popover>
    </div>
  )
}

/** The same tools struck through: what a no withholds. */
export function JudgeWithheldTools({ tools }: { tools: string[] }) {
  const { byName } = useJudgeTools()
  return <>{tools.map((tool) => <ToolChip key={tool} name={tool} byName={byName} struck />)}</>
}

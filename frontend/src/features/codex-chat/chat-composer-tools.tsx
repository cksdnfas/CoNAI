import { useMemo, useRef, useState, type RefObject } from 'react'
import { skipToken, useQuery } from '@tanstack/react-query'
import { Check, Wrench } from 'lucide-react'
import { SearchField } from '@/components/common/search-field'
import { Checkbox } from '@/components/ui/checkbox'
import { ToggleChip } from '@/components/ui/chip'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow } from '@/components/ui/list-row'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { getChatComposerTools, type ChatComposerPreset, type ChatComposerToolsTarget, type ChatToolInfo } from '@/lib/api-codex-chat'
import type { ChatToolDirectiveSnapshot } from '@conai/shared'
import { cn } from '@/lib/utils'
import { chatToolLabel, groupChatTools, matchesChatTool, scopeRepeatedGroups, type ChatToolGroup } from './chat-tool-catalog'
import { getChatScopeCopy } from './chat-scope-copy'
import { useTrayDismiss } from './chat-tray'
import { codexChatComposerToolsQueryKey } from './codex-chat-context'

const PRESET_KIND_LABEL: Record<ChatComposerPreset['kind'], string> = { nai: 'NAI', comfyui: 'ComfyUI' }
const NO_PRESETS: ChatComposerPreset[] = []
const NO_TOOLS: ChatToolInfo[] = []

/**
 * What the chat offers for directing a message: its profile's generation presets, and its tools as the tray lists them
 * (the chat's own tools, which no scope offers, are not on the list). Asked once per chat (the new chat being prepared
 * by its profile) and kept. No presets and no listed tools: the composer has no tools item.
 */
export function useChatComposerTools(target: ChatComposerToolsTarget | null) {
  const { t } = useI18n()
  const { data } = useQuery({
    queryKey: target ? codexChatComposerToolsQueryKey(target) : ['codex-chat-composer-tools', 'none'],
    queryFn: target ? () => getChatComposerTools(target) : skipToken,
    staleTime: 5 * 60_000,
  })
  return useMemo(() => {
    const presets = data?.presets ?? NO_PRESETS
    const groups = scopeRepeatedGroups(groupChatTools(data?.tools ?? NO_TOOLS, t), (scope) => getChatScopeCopy(scope, t).label)
    return { presets, groups, available: presets.length > 0 || groups.length > 0 }
  }, [data, t])
}

const sameDirective = (a: ChatToolDirectiveSnapshot | null, b: ChatToolDirectiveSnapshot) => a !== null && ('presetId' in a ? 'presetId' in b && a.presetId === b.presetId : 'tool' in b && a.tool === b.tool)

/** The tools item's key: opens the tray. A pick shows as its own chip in the row, not on this key. */
export function ChatToolsButton({ buttonRef, open, disabled, onToggle }: {
  buttonRef: RefObject<HTMLButtonElement | null>
  open: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  const { t } = useI18n()
  return (
    <IconButton ref={buttonRef} variant="ghost" size="icon-sm" aria-expanded={open} disabled={disabled} onClick={onToggle} label={t({ ko: '도구', en: 'Tools' })}>
      <Wrench className={cn('transition-transform duration-300 ease-out motion-reduce:transition-none', open && '-rotate-12 scale-110')} />
    </IconButton>
  )
}

/** The picked preset or tool in the key row: worded, and pressing it turns it off. */
export function ChatToolsChip({ pick, keep, onClear }: { pick: ChatToolDirectiveSnapshot; keep: boolean; onClear: () => void }) {
  const { t } = useI18n()
  const name = chatToolPickLabel(pick, t)
  return (
    <Tip content={t({ ko: '다시 누르면 꺼져', en: 'Press again to turn off' })}>
      <ToggleChip pressed onClick={onClear} aria-label={t({ ko: '{name} 지정 끄기', en: 'Turn off {name}' }, { name })}>
        <Wrench />
        <span className="truncate">{name}</span>
        {keep ? <span className="rounded-full bg-foreground/10 px-1.5 text-2xs text-foreground">{t({ ko: '유지', en: 'Kept' })}</span> : null}
      </ToggleChip>
    </Tip>
  )
}

/** A picked preset by its name, a picked tool by its picker label (the one the tray row shows). */
export function chatToolPickLabel(pick: ChatToolDirectiveSnapshot, t: ReturnType<typeof useI18n>['t']) {
  return 'presetId' in pick ? pick.name : chatToolLabel(pick.tool, t)
}

/** Under a sent message, beside its flags: the preset or tool it directed. */
export function ChatToolDirectiveTag({ directive }: { directive: ChatToolDirectiveSnapshot }) {
  const { t } = useI18n()
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line px-1.5 text-2xs leading-4.5 text-muted-foreground">
      <Wrench className="size-3" aria-hidden />
      {t({ ko: '도구 지정 · {name}', en: 'Directed · {name}' }, { name: chatToolPickLabel(directive, t) })}
    </span>
  )
}

/**
 * The presets and tools to pick from, popped up over the composer like the reply suggestions: a search, the generation
 * presets first, then the tools by group. Names only; what each does is its tooltip. One pick at a time; the picked
 * row again clears it. Closes on Esc or a click elsewhere (not on its own key, which toggles).
 */
export function ChatToolsTray({ open, ...props }: ChatToolsTrayProps & { open: boolean }) {
  return open ? <ChatToolsTrayBody {...props} /> : null
}

type ChatToolsTrayProps = {
  presets: ChatComposerPreset[]
  groups: ChatToolGroup[]
  pick: ChatToolDirectiveSnapshot | null
  keep: boolean
  buttonRef: RefObject<HTMLElement | null>
  onPick: (pick: ChatToolDirectiveSnapshot | null) => void
  onKeep: (keep: boolean) => void
  onClose: () => void
}

/** Mounted only while open, so every opening starts with an empty search. */
function ChatToolsTrayBody({ presets, groups, pick, keep, buttonRef, onPick, onKeep, onClose }: ChatToolsTrayProps) {
  const { t } = useI18n()
  const trayRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  useTrayDismiss({ open: true, trayRef, buttonRef, onClose })

  const shownPresets = presets.filter((preset) => matchesChatTool({ search: { keys: [preset.name, PRESET_KIND_LABEL[preset.kind]], prose: [preset.instruction] } }, query))
  const shownGroups = groups.map((group) => ({ ...group, tools: group.tools.filter((tool) => matchesChatTool(tool, query)) })).filter((group) => group.tools.length > 0)
  const choose = (next: ChatToolDirectiveSnapshot) => onPick(sameDirective(pick, next) ? null : next)
  const row = (key: string, next: ChatToolDirectiveSnapshot, name: string, description: string, kind?: string) => {
    const on = sameDirective(pick, next)
    return (
      <Tip key={key} content={description} side="right" align="start">
        <ListRow asChild interactive size="sm" selected={on} leading={<span className="flex size-3.5 text-primary-text">{on ? <Check className="size-3.5" /> : null}</span>} trailing={kind ? <span className="text-2xs">{kind}</span> : undefined}>
          <button type="button" aria-pressed={on} onClick={() => choose(next)}>
            <span className="truncate">{name}</span>
          </button>
        </ListRow>
      </Tip>
    )
  }

  return (
    <div ref={trayRef} role="group" aria-label={t({ ko: '도구 고르기', en: 'Choose a tool' })} className="absolute bottom-full left-0 z-10 mb-1.5 flex max-h-80 w-[22rem] max-w-full animate-in flex-col overflow-hidden fade-in-0 zoom-in-95 rounded-lg border border-line bg-background/90 shadow-lg backdrop-blur-md motion-reduce:animate-none">
      <div className="border-b border-line p-1.5">
        <SearchField autoFocus value={query} onChange={setQuery} placeholder={t({ ko: '프리셋·도구 검색', en: 'Search presets and tools' })} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {shownPresets.length > 0 ? (
          <div role="group" aria-label={t({ ko: '생성 프리셋', en: 'Generation presets' })}>
            <div className="px-2 pt-2 pb-0.5 text-2xs font-semibold text-muted-foreground">{t({ ko: '생성 프리셋', en: 'Generation presets' })}</div>
            {shownPresets.map((preset) => row(`preset:${preset.id}`, { presetId: preset.id, name: preset.name }, preset.name, preset.instruction, PRESET_KIND_LABEL[preset.kind]))}
          </div>
        ) : null}
        {shownGroups.map((group) => (
          <div key={`${group.scope}:${group.id}`} role="group" aria-label={group.label}>
            <div className="px-2 pt-2 pb-0.5 text-2xs font-semibold text-muted-foreground">{group.label}</div>
            {group.tools.map((tool) => row(`tool:${tool.name}`, { tool: tool.name }, tool.label, tool.description))}
          </div>
        ))}
        {shownPresets.length === 0 && shownGroups.length === 0 ? <EmptyState size="compact" title={t({ ko: '맞는 프리셋이나 도구가 없어', en: 'No matching preset or tool' })} /> : null}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line px-2.5 py-1.5 text-xs text-muted-foreground">
        <label className="flex cursor-pointer items-center gap-2 text-foreground">
          <Checkbox checked={keep} onCheckedChange={(checked) => onKeep(checked === true)} />
          {t({ ko: '보낸 뒤에도 유지', en: 'Keep after sending' })}
        </label>
        <span className="tabular-nums">{t({ ko: '프리셋 {presets} · 도구 {tools}', en: 'Presets {presets} · Tools {tools}' }, { presets: presets.length, tools: groups.reduce((sum, group) => sum + group.tools.length, 0) })}</span>
      </div>
    </div>
  )
}

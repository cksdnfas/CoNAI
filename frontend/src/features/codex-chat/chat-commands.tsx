import type { ReactNode } from 'react'
import { floatingSurfaceClassName } from '@/components/ui/floating-surface'
import { ListRow } from '@/components/ui/list-row'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

export const CHAT_COMMANDS = [
  { name: 'new', label: { ko: '새 채팅', en: 'New chat' }, argument: true },
  { name: 'clear', label: { ko: '대화 비우기', en: 'Clear chat' } },
  { name: 'compact', label: { ko: '대화 압축', en: 'Compact chat' } },
  { name: 'note', label: { ko: '작가 노트 바꾸기 (비우면 지움)', en: "Set author's note (empty clears)" }, argument: true },
  { name: 'retry', label: { ko: '마지막 답변 다시 생성', en: 'Regenerate last answer' } },
  { name: 'edit', label: { ko: '마지막 내 메시지 수정', en: 'Edit last message' } },
  { name: 'export', label: { ko: '대화 내보내기', en: 'Export chat' } },
  { name: 'search', label: { ko: '채팅 검색', en: 'Search chats' }, argument: true },
  { name: 'help', label: { ko: '커맨드 목록', en: 'Commands' } },
] as const

export type ChatCommand = typeof CHAT_COMMANDS[number]

/** The autocomplete popup above the composer (slash commands, `@` mentions). Width and side with `className`. */
export function ComposerSuggestList({ id, label, className, children }: { id: string; label: string; className?: string; children: ReactNode }) {
  return <div id={id} role="listbox" aria-label={label} data-surface="high" className={cn(floatingSurfaceClassName, 'absolute bottom-full left-3 z-10 mb-1 max-h-72 overflow-y-auto p-1.5', className)}>{children}</div>
}

/** One option row of ComposerSuggestList; pressing it keeps the composer focused. */
export function ComposerSuggestOption({ id, selected, onSelect, className, children }: { id: string; selected: boolean; onSelect: () => void; className?: string; children: ReactNode }) {
  return <ListRow asChild interactive selected={selected} size="sm" className={className}><button id={id} type="button" role="option" aria-selected={selected} onMouseDown={(event) => event.preventDefault()} onClick={onSelect}>{children}</button></ListRow>
}

export function ChatCommandList({ commands, selected, onSelect, id }: { commands: readonly ChatCommand[]; selected: number; onSelect: (command: ChatCommand) => void; id: string }) {
  const { t } = useI18n()
  return <ComposerSuggestList id={id} label={t({ ko: '채팅 커맨드', en: 'Chat commands' })} className="right-3">
    {commands.map((command, index) => <ComposerSuggestOption key={command.name} id={`${id}-${index}`} selected={selected === index} onSelect={() => onSelect(command)}>
      <span className="w-20 shrink-0 text-left font-mono text-xs">/{command.name}</span><span className="text-xs">{t(command.label)}</span>
    </ComposerSuggestOption>)}
  </ComposerSuggestList>
}

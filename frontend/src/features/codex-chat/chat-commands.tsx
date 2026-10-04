import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

export const CHAT_COMMANDS = [
  { name: 'new', label: { ko: '새 채팅', en: 'New chat' }, argument: true },
  { name: 'clear', label: { ko: '대화 비우기', en: 'Clear chat' } },
  { name: 'compact', label: { ko: '대화 압축', en: 'Compact chat' } },
  { name: 'retry', label: { ko: '마지막 답변 다시 생성', en: 'Regenerate last answer' } },
  { name: 'edit', label: { ko: '마지막 내 메시지 수정', en: 'Edit last message' } },
  { name: 'export', label: { ko: '대화 내보내기', en: 'Export chat' } },
  { name: 'search', label: { ko: '채팅 검색', en: 'Search chats' }, argument: true },
  { name: 'help', label: { ko: '커맨드 목록', en: 'Commands' } },
] as const

export type ChatCommand = typeof CHAT_COMMANDS[number]

export function ChatCommandList({ commands, selected, onSelect, id }: { commands: readonly ChatCommand[]; selected: number; onSelect: (command: ChatCommand) => void; id: string }) {
  const { t } = useI18n()
  return <div id={id} role="listbox" aria-label={t({ ko: '채팅 커맨드', en: 'Chat commands' })} className="absolute bottom-full left-3 right-3 z-10 mb-1 max-h-72 overflow-y-auto rounded-md bg-surface-high p-1.5 shadow-elevation-2">
    {commands.map((command, index) => <Button key={command.name} id={`${id}-${index}`} role="option" aria-selected={selected === index} variant="ghost" size="sm" className={cn('w-full justify-start gap-4', selected === index && 'bg-fill')} onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(command)}>
      <span className="w-20 shrink-0 text-left font-mono text-xs">/{command.name}</span><span className="text-xs">{t(command.label)}</span>
    </Button>)}
  </div>
}

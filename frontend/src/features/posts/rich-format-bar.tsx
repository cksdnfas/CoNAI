import type { ReactNode } from 'react'
import { Bold, ChevronDown, Code, Italic, Link, List, ListOrdered, ListTodo, Minus, Quote, Redo2, SquareCode, Strikethrough, Table, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import { formatShortcut, withShortcut } from '@/lib/keyboard-shortcut'
import { cn } from '@/lib/utils'
import type { RichFormatAction, RichFormatState } from './post-rich-editor-engine'

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6]

/**
 * The visual editor's formatting bar: the same controls, in the same order, as Crepe's top bar it replaces, drawn
 * with the app's icon buttons so they read in every theme and carry tooltips with their shortcuts. Buttons never take
 * focus from the text, so a command applies to the selection the person made. `stickyTop` keeps the bar under the app
 * header while a long text scrolls the page (it is painted opaque for that).
 */
export function RichFormatBar({ state, disabled, onFormat, stickyTop }: {
  state: RichFormatState
  disabled: boolean
  onFormat: (action: RichFormatAction) => void
  stickyTop?: string
}) {
  const { t } = useI18n()
  const headingLabel = (level: number | null) => level === null ? t({ ko: '본문', en: 'Paragraph' }) : t({ ko: '제목 {level}', en: 'Heading {level}' }, { level })
  const tool = (action: RichFormatAction & string, label: string, icon: ReactNode, options: { active?: boolean; enabled?: boolean } = {}) => (
    <IconButton
      key={action}
      variant="ghost"
      size="icon-sm"
      label={label}
      active={options.active}
      disabled={disabled || options.enabled === false}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onFormat(action)}
    >
      {icon}
    </IconButton>
  )
  const divider = (key: string) => <span key={key} aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" />

  return (
    <div
      role="toolbar"
      aria-label={t({ ko: '서식', en: 'Formatting' })}
      style={stickyTop ? { top: stickyTop } : undefined}
      className={cn(
        'flex min-w-0 items-center gap-0.5 scroll-x theme-nav-scroll border-b border-line px-2 py-1',
        stickyTop && 'sticky z-10 rounded-t-sm bg-background bg-linear-to-r from-field to-field',
      )}
    >
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <Button variant="ghost" size="sm" aria-label={t({ ko: '문단 형식: {format}', en: 'Block format: {format}' }, { format: headingLabel(state.heading) })} className="w-24 shrink-0 justify-between" onMouseDown={(event) => { if (event.button === 0) event.preventDefault() }}>
            <span className="truncate">{headingLabel(state.heading)}</span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onCloseAutoFocus={(event) => event.preventDefault()}>
          <DropdownMenuRadioGroup value={String(state.heading ?? 0)} onValueChange={(value) => onFormat({ heading: Number(value) || null })}>
            {[0, ...HEADING_LEVELS].map((level) => (
              <DropdownMenuRadioItem key={level} value={String(level)}>
                <span className={cn(level === 1 && 'text-lg font-bold', level === 2 && 'text-base font-bold', level >= 3 && 'font-semibold')}>{headingLabel(level || null)}</span>
                <span className="ml-auto pl-4"><DropdownMenuShortcut>{formatShortcut(`Mod+Alt+${level}`)}</DropdownMenuShortcut></span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {divider('formatting')}
      {tool('bold', withShortcut(t({ ko: '굵게', en: 'Bold' }), 'Mod+B'), <Bold />, { active: state.bold })}
      {tool('italic', withShortcut(t({ ko: '기울임', en: 'Italic' }), 'Mod+I'), <Italic />, { active: state.italic })}
      {tool('strike', withShortcut(t({ ko: '취소선', en: 'Strikethrough' }), 'Mod+Alt+X'), <Strikethrough />, { active: state.strike })}
      {tool('code', withShortcut(t({ ko: '인라인 코드', en: 'Inline code' }), 'Mod+E'), <Code />, { active: state.code })}
      {divider('list')}
      {tool('bulletList', withShortcut(t({ ko: '글머리 목록', en: 'Bullet list' }), 'Mod+Alt+8'), <List />, { active: state.list === 'bulletList' })}
      {tool('orderedList', withShortcut(t({ ko: '번호 목록', en: 'Ordered list' }), 'Mod+Alt+7'), <ListOrdered />, { active: state.list === 'orderedList' })}
      {tool('taskList', t({ ko: '체크 목록', en: 'Task list' }), <ListTodo />, { active: state.list === 'taskList' })}
      {divider('insert')}
      {tool('link', t({ ko: '링크', en: 'Link' }), <Link />, { active: state.link })}
      {tool('table', t({ ko: '표', en: 'Table' }), <Table />)}
      {divider('block')}
      {tool('codeBlock', withShortcut(t({ ko: '코드 블록', en: 'Code block' }), 'Mod+Alt+C'), <SquareCode />, { active: state.codeBlock })}
      {tool('quote', withShortcut(t({ ko: '인용', en: 'Quote' }), 'Mod+Shift+B'), <Quote />, { active: state.quote })}
      {tool('divider', t({ ko: '구분선', en: 'Divider' }), <Minus />)}
      <span className="min-w-2 flex-1" />
      {tool('undo', withShortcut(t({ ko: '실행 취소', en: 'Undo' }), 'Mod+Z'), <Undo2 />, { enabled: state.canUndo })}
      {tool('redo', withShortcut(t({ ko: '다시 실행', en: 'Redo' }), 'Mod+Shift+Z'), <Redo2 />, { enabled: state.canRedo })}
    </div>
  )
}

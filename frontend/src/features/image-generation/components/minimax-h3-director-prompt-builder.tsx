import { useRef, type ReactNode } from 'react'
import { ListPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import {
  buildMiniMaxH3DirectorPromptTemplate,
  type MiniMaxH3DirectorBuilderState,
  type MiniMaxH3DirectorGraphInputKey,
  type MiniMaxH3DirectorTimelineItem,
} from './minimax-h3-director-dasiwa-utils'

type MiniMaxH3DirectorPromptBuilderProps = {
  state: MiniMaxH3DirectorBuilderState
  items: MiniMaxH3DirectorTimelineItem[]
  invalid?: boolean
  onChange: (state: MiniMaxH3DirectorBuilderState) => void
  renderInputPort?: (inputKey: MiniMaxH3DirectorGraphInputKey) => ReactNode
}

/** The Director prompt: one text field, with the mode's section headings insertable at the cursor. */
export function MiniMaxH3DirectorPromptBuilder({
  state,
  items,
  invalid = false,
  onChange,
  renderInputPort,
}: MiniMaxH3DirectorPromptBuilderProps) {
  const { t } = useI18n()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const insertTemplate = () => {
    const area = textareaRef.current
    const text = state.simple_prompt
    const start = area?.selectionStart ?? text.length
    const end = area?.selectionEnd ?? text.length
    const template = buildMiniMaxH3DirectorPromptTemplate(state, items)
    onChange({ ...state, simple_prompt: `${text.slice(0, start)}${template}${text.slice(end)}` })
    area?.focus()
  }

  return (
    <section className="ui-tone-plinth space-y-4 rounded-sm p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Text as="div" variant="title">{t({ ko: '프롬프트', en: 'Prompt' })}</Text>
        <Button type="button" size="sm" variant="secondary" onClick={insertTemplate}>
          <ListPlus className="h-3.5 w-3.5" />
          {t({ ko: '프롬프트 구조 넣기', en: 'Insert prompt structure' })}
        </Button>
      </div>

      <div className="space-y-1" data-panel-focus="prompt.simple_prompt">
        {renderInputPort?.('prompt.simple_prompt')}
        <Textarea
          ref={textareaRef}
          rows={10}
          value={state.simple_prompt}
          aria-label={t({ ko: '프롬프트', en: 'Prompt' })}
          placeholder={t({ ko: '전체 프롬프트', en: 'Full prompt' })}
          aria-invalid={invalid}
          onChange={(event) => onChange({ ...state, simple_prompt: event.target.value })}
        />
      </div>
    </section>
  )
}

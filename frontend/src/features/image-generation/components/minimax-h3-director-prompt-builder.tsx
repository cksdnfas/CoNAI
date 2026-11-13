import { useState, type ReactNode } from 'react'
import { Copy, Eye, ListChecks } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { useI18n } from '@/i18n'
import { copyTextToClipboard } from '@/lib/clipboard'
import { Field } from '@/components/ui/field'
import {
  buildMiniMaxH3DirectorPrompt,
  prefillMiniMaxH3DirectorRefBuilder,
  type MiniMaxH3DirectorBuilderState,
  type MiniMaxH3DirectorGraphInputKey,
  type MiniMaxH3DirectorTimelineItem,
} from './minimax-h3-director-dasiwa-utils'
import { setMiniMaxH3DirectorPromptMode } from './minimax-h3-director-node-state'

type MiniMaxH3DirectorPromptBuilderProps = {
  state: MiniMaxH3DirectorBuilderState
  items: MiniMaxH3DirectorTimelineItem[]
  invalid?: boolean
  onChange: (state: MiniMaxH3DirectorBuilderState) => void
  onStatus: (status: string) => void
  renderInputPort?: (inputKey: MiniMaxH3DirectorGraphInputKey) => ReactNode
}

/** Mode-specific DaSiWa prompt builder with canonical preview and REF scaffolding. */
export function MiniMaxH3DirectorPromptBuilder({
  state,
  items,
  invalid = false,
  onChange,
  onStatus,
  renderInputPort,
}: MiniMaxH3DirectorPromptBuilderProps) {
  const { t } = useI18n()
  const [previewOpen, setPreviewOpen] = useState(false)
  const preview = buildMiniMaxH3DirectorPrompt(state)
  const patchState = (patch: Partial<MiniMaxH3DirectorBuilderState>) => onChange({ ...state, ...patch })
  const patchRef = (patch: Partial<MiniMaxH3DirectorBuilderState['ref']>) => onChange({ ...state, ref: { ...state.ref, ...patch } })
  const renderPortedField = (inputKey: MiniMaxH3DirectorGraphInputKey, content: ReactNode) => (
    <div className="space-y-1" data-panel-focus={inputKey}>
      {renderInputPort?.(inputKey)}
      {content}
    </div>
  )
  const setPromptMode = (nextPromptMode: string) => {
    if (nextPromptMode !== 'simple' && nextPromptMode !== 'structured') return
    if (nextPromptMode === state.prompt_mode) return
    onChange(setMiniMaxH3DirectorPromptMode(state, nextPromptMode))
  }

  return <>
    <section className="ui-tone-plinth space-y-4 rounded-sm p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Text as="div" variant="title">{t({ ko: '프롬프트 빌더', en: 'Prompt builder' })}</Text>
        <div className="flex flex-wrap gap-1">
          {state.mode === 'REF2VA' ? (
            <IconButton size="icon-sm" variant="secondary" label={t({ ko: '라벨·요약 자동 채우기', en: 'Auto-fill labels & summary' })} onClick={() => onChange(prefillMiniMaxH3DirectorRefBuilder(state, items))}>
              <ListChecks className="h-3.5 w-3.5" />
            </IconButton>
          ) : null}
          <IconButton size="icon-sm" variant="secondary" label={t({ ko: '최종 프롬프트 미리보기', en: 'Preview final prompt' })} onClick={() => setPreviewOpen(true)}>
            <Eye className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {renderInputPort?.('prompt.mode')}
        <SegmentedControl
          size="xs"
          ariaLabel={t({ ko: '프롬프트 모드', en: 'Prompt mode' })}
          value={state.prompt_mode}
          items={[
            { value: 'simple', label: t({ ko: '간단', en: 'Simple' }) },
            { value: 'structured', label: t({ ko: '구조화', en: 'Structured' }) },
          ]}
          onChange={setPromptMode}
        />
      </div>

      {state.prompt_mode === 'simple' ? (
        renderPortedField('prompt.simple_prompt', <Textarea
          rows={10}
          value={state.simple_prompt}
          aria-label={t({ ko: '프롬프트', en: 'Prompt' })}
          placeholder={t({ ko: '전체 프롬프트', en: 'Full prompt' })}
          aria-invalid={invalid}
          onChange={(event) => patchState({ simple_prompt: event.target.value })}
        />)
      ) : state.mode === 'REF2VA' ? (
        <div className="grid gap-4">
          {renderPortedField('prompt.subject_definitions', <Field label={t({ ko: '주체 정의', en: 'Subject definitions' })}>
            <Textarea rows={4} value={state.ref.subject_definitions} placeholder="<Subject 1> ... / <Picture 1> ..." onChange={(event) => patchRef({ subject_definitions: event.target.value })} />
          </Field>)}
          {renderPortedField('prompt.summary', <Field label={t({ ko: '요약', en: 'Summary' })}>
            <Textarea rows={3} value={state.ref.summary} placeholder="[reference generation] Use <Picture 1> ..." onChange={(event) => patchRef({ summary: event.target.value })} />
          </Field>)}
          {renderPortedField('prompt.retention_analysis', <Field label={t({ ko: '참조 유지 분석', en: 'Retention analysis' })}>
            <Textarea rows={4} value={state.ref.retention_analysis} placeholder="<Subject 1>: fully_preserved - ..." onChange={(event) => patchRef({ retention_analysis: event.target.value })} />
          </Field>)}
          {renderPortedField('prompt.detailed_description', <Field label={t({ ko: '상세 묘사', en: 'Detailed description' })}>
            <Textarea rows={6} value={state.ref.detailed_description} placeholder="[Shot 1] ... [Shot 2] At 00:04.500, ..." aria-invalid={invalid} onChange={(event) => patchRef({ detailed_description: event.target.value })} />
          </Field>)}
          <div className="grid gap-4 sm:grid-cols-2">
            {renderPortedField('prompt.soundscape', <Field label={t({ ko: '전체 사운드', en: 'Soundscape' })}>
              <Textarea rows={3} value={state.ref.soundscape} onChange={(event) => patchRef({ soundscape: event.target.value })} />
            </Field>)}
            {renderPortedField('prompt.music', <Field label={t({ ko: '배경 음악', en: 'Background music' })}>
              <Textarea rows={3} value={state.ref.music} onChange={(event) => patchRef({ music: event.target.value })} />
            </Field>)}
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {renderPortedField('prompt.imd', <Field label={t({ ko: '장면 묘사', en: 'Scene description' })}>
            <Textarea rows={6} value={state.imd} placeholder="[Shot 1] Start your scene description here..." aria-invalid={invalid} onChange={(event) => patchState({ imd: event.target.value })} />
          </Field>)}
          <div className="grid gap-4 sm:grid-cols-2">
            {renderPortedField('prompt.soundscape', <Field label={t({ ko: '전체 사운드', en: 'Soundscape' })}>
              <Textarea rows={3} value={state.soundscape} onChange={(event) => patchState({ soundscape: event.target.value })} />
            </Field>)}
            {renderPortedField('prompt.music', <Field label={t({ ko: '배경 음악', en: 'Background music' })}>
              <Textarea rows={3} value={state.music} onChange={(event) => patchState({ music: event.target.value })} />
            </Field>)}
          </div>
        </div>
      )}
    </section>

    <Modal
      open={previewOpen}
      title={t({ ko: '프롬프트 미리보기', en: 'Prompt preview' })}
      size="lg"
      onClose={() => setPreviewOpen(false)}
    >
      <div className="space-y-3">
        <Textarea rows={18} readOnly value={preview} aria-label={t({ ko: '최종 프롬프트', en: 'Final prompt' })} mono textSize="xs" />
        <ModalFooter>
          <IconButton variant="secondary" label={t({ ko: '프롬프트 복사', en: 'Copy prompt' })} onClick={() => void copyTextToClipboard(preview).then(
            () => onStatus(t({ ko: '프롬프트를 복사했어.', en: 'Prompt copied.' })),
            () => onStatus(t({ ko: '프롬프트 복사에 실패했어.', en: 'Failed to copy prompt.' })),
          )}>
            <Copy className="h-4 w-4" />
          </IconButton>
          <span className="flex-1" />
          <Button type="button" variant="ghost" onClick={() => setPreviewOpen(false)}>{t({ ko: '닫기', en: 'Close' })}</Button>
        </ModalFooter>
      </div>
    </Modal>
  </>
}

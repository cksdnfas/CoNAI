import { useState, type ReactNode } from 'react'
import { Copy, Eye, Plus, Sparkles } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Text } from '@/components/ui/text'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { FormField } from '../image-generation-shared'
import {
  buildMiniMaxH3DirectorPrompt,
  prefillMiniMaxH3DirectorRefBuilder,
  type MiniMaxH3DirectorBuilderState,
  type MiniMaxH3DirectorGraphInputKey,
  type MiniMaxH3DirectorTimelineItem,
} from './minimax-h3-director-dasiwa-utils'

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
  // Draft shot number for the [Shot N] marker; null while its dialog is closed.
  const [shotNumberDraft, setShotNumberDraft] = useState<string | null>(null)
  const preview = buildMiniMaxH3DirectorPrompt(state)
  const patchState = (patch: Partial<MiniMaxH3DirectorBuilderState>) => onChange({ ...state, ...patch })
  const patchRef = (patch: Partial<MiniMaxH3DirectorBuilderState['ref']>) => onChange({ ...state, ref: { ...state.ref, ...patch } })
  const renderPortedField = (inputKey: MiniMaxH3DirectorGraphInputKey, content: ReactNode) => (
    <div className="space-y-1">
      {renderInputPort?.(inputKey)}
      {content}
    </div>
  )
  const insertShotMarker = (shotNumber: string) => {
    if (!shotNumber) return
    const marker = `[Shot ${shotNumber}] `
    if (state.prompt_mode === 'simple') {
      patchState({ simple_prompt: `${state.simple_prompt}${state.simple_prompt ? '\n' : ''}${marker}` })
    } else if (state.mode === 'REF2VA') {
      patchRef({ detailed_description: `${state.ref.detailed_description}${state.ref.detailed_description ? '\n' : ''}${marker}` })
    } else {
      patchState({ imd: `${state.imd}${state.imd ? '\n' : ''}${marker}` })
    }
  }
  const setPromptMode = (nextPromptMode: string) => {
    if (nextPromptMode !== 'simple' && nextPromptMode !== 'structured') return
    if (nextPromptMode === state.prompt_mode) return
    if (nextPromptMode === 'simple') {
      onChange({
        ...state,
        prompt_mode: 'simple',
        simple_prompt: buildMiniMaxH3DirectorPrompt({ ...state, prompt_mode: 'structured' }),
      })
      return
    }
    patchState({ prompt_mode: 'structured' })
  }

  return <>
    <section className="ui-tone-plinth space-y-4 rounded-sm p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Text as="div" variant="title">{t({ ko: '프롬프트 빌더', en: 'Prompt builder' })}</Text>
        <div className="flex flex-wrap gap-1">
          <IconButton size="icon-sm" variant="secondary" label={t({ ko: '샷 마커 삽입 [Shot N]', en: 'Insert shot marker [Shot N]' })} onClick={() => setShotNumberDraft('1')}>
            <Plus className="h-3.5 w-3.5" />
          </IconButton>
          {state.mode === 'REF2VA' ? (
            <IconButton size="icon-sm" variant="secondary" label={t({ ko: '라벨·요약 자동 채우기', en: 'Auto-fill labels & summary' })} onClick={() => onChange(prefillMiniMaxH3DirectorRefBuilder(state, items))}>
              <Sparkles className="h-3.5 w-3.5" />
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
            { value: 'simple', label: t({ ko: '간단', en: 'Simple' }), ariaLabel: t({ ko: '간단: 프롬프트 한 칸에 전부 적기', en: 'Simple: write the whole prompt in one box' }) },
            { value: 'structured', label: t({ ko: '구조화', en: 'Structured' }), ariaLabel: t({ ko: '구조화: 항목별로 나눠 적으면 합쳐 줘', en: 'Structured: fill sections that get merged' }) },
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
          className={cn(invalid && 'border-destructive')}
          onChange={(event) => patchState({ simple_prompt: event.target.value })}
        />)
      ) : state.mode === 'REF2VA' ? (
        <div className="grid gap-4">
          {renderPortedField('prompt.subject_definitions', <FormField label="subject_definitions">
            <Textarea rows={4} value={state.ref.subject_definitions} placeholder="<Subject 1> ... / <Picture 1> ..." onChange={(event) => patchRef({ subject_definitions: event.target.value })} />
          </FormField>)}
          {renderPortedField('prompt.summary', <FormField label="summary">
            <Textarea rows={3} value={state.ref.summary} placeholder="[reference generation] Use <Picture 1> ..." onChange={(event) => patchRef({ summary: event.target.value })} />
          </FormField>)}
          {renderPortedField('prompt.retention_analysis', <FormField label="retention_analysis">
            <Textarea rows={4} value={state.ref.retention_analysis} placeholder="<Subject 1>: fully_preserved - ..." onChange={(event) => patchRef({ retention_analysis: event.target.value })} />
          </FormField>)}
          {renderPortedField('prompt.detailed_description', <FormField label="detailed_description">
            <Textarea rows={6} value={state.ref.detailed_description} placeholder="[Shot 1] ... [Shot 2] At 00:04.500, ..." className={cn(invalid && 'border-destructive')} onChange={(event) => patchRef({ detailed_description: event.target.value })} />
          </FormField>)}
          <div className="grid gap-4 sm:grid-cols-2">
            {renderPortedField('prompt.soundscape', <FormField label="overall_soundscape">
              <Textarea rows={3} value={state.ref.soundscape} onChange={(event) => patchRef({ soundscape: event.target.value })} />
            </FormField>)}
            {renderPortedField('prompt.music', <FormField label="non_diegetic_music">
              <Textarea rows={3} value={state.ref.music} onChange={(event) => patchRef({ music: event.target.value })} />
            </FormField>)}
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {renderPortedField('prompt.imd', <FormField label="integrated_multimodal_description">
            <Textarea rows={6} value={state.imd} placeholder="[Shot 1] Start your scene description here..." className={cn(invalid && 'border-destructive')} onChange={(event) => patchState({ imd: event.target.value })} />
          </FormField>)}
          <div className="grid gap-4 sm:grid-cols-2">
            {renderPortedField('prompt.soundscape', <FormField label="overall_soundscape">
              <Textarea rows={3} value={state.soundscape} onChange={(event) => patchState({ soundscape: event.target.value })} />
            </FormField>)}
            {renderPortedField('prompt.music', <FormField label="non_diegetic_music">
              <Textarea rows={3} value={state.music} onChange={(event) => patchState({ music: event.target.value })} />
            </FormField>)}
          </div>
        </div>
      )}
    </section>

    <Modal
      open={previewOpen}
      title={t({ ko: '프롬프트 미리보기', en: 'Prompt preview' })}
      widthClassName="max-w-3xl"
      onClose={() => setPreviewOpen(false)}
    >
      <div className="space-y-3">
        <Textarea rows={18} readOnly value={preview} aria-label={t({ ko: '최종 프롬프트', en: 'Final prompt' })} className="font-mono text-xs" />
        <ModalFooter>
          <IconButton variant="secondary" label={t({ ko: '프롬프트 복사', en: 'Copy prompt' })} onClick={() => void navigator.clipboard.writeText(preview).then(
            () => onStatus(t({ ko: '프롬프트를 복사했어.', en: 'Prompt copied.' })),
            () => onStatus(t({ ko: '프롬프트 복사에 실패했어.', en: 'Failed to copy prompt.' })),
          )}>
            <Copy className="h-4 w-4" />
          </IconButton>
          <Button type="button" onClick={() => setPreviewOpen(false)}>{t({ ko: '완료', en: 'Done' })}</Button>
        </ModalFooter>
      </div>
    </Modal>

    <Modal
      open={shotNumberDraft !== null}
      title={t({ ko: '샷 마커 추가', en: 'Add shot marker' })}
      widthClassName="max-w-md"
      onClose={() => setShotNumberDraft(null)}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          insertShotMarker(shotNumberDraft?.trim() ?? '')
          setShotNumberDraft(null)
        }}
      >
        <label className="block space-y-2">
          <span className="text-sm text-muted-foreground">{t({ ko: '샷 번호', en: 'Shot number' })}</span>
          <Input autoFocus value={shotNumberDraft ?? ''} onChange={(event) => setShotNumberDraft(event.target.value)} />
        </label>
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={() => setShotNumberDraft(null)}>{t({ ko: '취소', en: 'Cancel' })}</Button>
          <Button type="submit" disabled={!shotNumberDraft?.trim()}>{t({ ko: '추가', en: 'Add' })}</Button>
        </ModalFooter>
      </form>
    </Modal>
  </>
}

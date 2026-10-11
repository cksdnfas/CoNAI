import type { ReactNode } from 'react'
import type { EmbeddingServerStatus, EmbeddingSettings } from '@conai/shared'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { RowGroup } from '@/components/ui/row-group'
import { SettingRow } from '@/components/ui/setting-row'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { useI18n, type TranslationInput } from '@/i18n'
import { AiStatusPill, type AiStatusTone } from './ai-status-pill'
import { ChatFilledLabel } from './settings-filled-label'
import { SETTINGS_CONTROL_CLASS, SettingsRowsSkeleton } from './settings-rows'

interface EmbeddingSettingsCardProps {
  heading: ReactNode
  actions?: ReactNode
  draft: EmbeddingSettings | null
  status: EmbeddingServerStatus | undefined
  onPatch: (patch: Partial<EmbeddingSettings>) => void
}

const SPACE_LABELS: Record<string, TranslationInput> = {
  'chat-recall': { ko: '요약', en: 'summaries' },
  'chat-lore': { ko: '로어', en: 'lore' },
  'chat-message': { ko: '메시지', en: 'messages' },
  file: { ko: '파일', en: 'files' },
  'media-image': { ko: '이미지', en: 'images' },
}

function statusPill(status: EmbeddingServerStatus | undefined, t: (input: TranslationInput) => string): { tone: AiStatusTone; text: string } {
  if (!status) return { tone: 'muted', text: t({ ko: '확인 중', en: 'Checking' }) }
  if (!status.enabled) return { tone: 'muted', text: t({ ko: '꺼짐', en: 'Off' }) }
  if (!status.dependenciesAvailable) return { tone: 'error', text: t({ ko: 'AI 런타임 필요', en: 'Needs the AI runtime' }) }
  if (status.download) return { tone: 'busy', text: t({ ko: '모델 받는 중', en: 'Downloading model' }) }
  if (status.indexing) return { tone: 'busy', text: t({ ko: '색인 중 · CPU', en: 'Indexing · CPU' }) }
  if (status.modelLoaded) return { tone: 'ok', text: t({ ko: '올라감 · CPU', en: 'Loaded · CPU' }) }
  return { tone: 'ok', text: t({ ko: '대기 · CPU', en: 'Idle · CPU' }) }
}

export function EmbeddingSettingsCard({ heading, actions, draft, status, onPatch }: EmbeddingSettingsCardProps) {
  const { t } = useI18n()
  const isEnabled = draft?.enabled === true
  const pill = statusPill(status, t)
  const unloadLabel = t({ ko: '자동 언로드(분)', en: 'Auto unload (minutes)' })
  const indexed = (status?.indexed ?? [])
    .filter((entry) => entry.space !== 'media-image' || draft?.imageSearch || entry.items > 0)
    .map((entry) => `${t(SPACE_LABELS[entry.space] ?? { ko: entry.space, en: entry.space })} ${entry.items.toLocaleString()}`)
    .join(' · ')

  return (
    <RowGroup
      heading={heading}
      actions={(
        <>
          {actions}
          <AiStatusPill tone={pill.tone}>{pill.text}</AiStatusPill>
        </>
      )}
    >
      {draft ? (
        <>
          <SettingsSwitchRow
            checked={draft.enabled}
            onCheckedChange={(checked) => onPatch({ enabled: checked })}
            label={<ChatFilledLabel fieldId="embedding.enabled">{t({ ko: '임베딩 사용', en: 'Use embeddings' })}</ChatFilledLabel>}
          />
          <SettingsSwitchRow
            checked={draft.chatRecall}
            disabled={!isEnabled}
            onCheckedChange={(checked) => onPatch({ chatRecall: checked })}
            label={<ChatFilledLabel fieldId="embedding.chatRecall">{t({ ko: '채팅 기억 회상', en: 'Chat memory recall' })}</ChatFilledLabel>}
            info={t({ ko: '같은 단어가 없어도 뜻이 가까운 지난 일을 떠올려.', en: 'Brings back past episodes close in meaning, not only by shared words.' })}
          />
          <SettingsSwitchRow
            checked={draft.lorebook}
            disabled={!isEnabled}
            onCheckedChange={(checked) => onPatch({ lorebook: checked })}
            label={<ChatFilledLabel fieldId="embedding.lorebook">{t({ ko: '로어북 의미 발동', en: 'Lorebook by meaning' })}</ChatFilledLabel>}
            info={t({ ko: '키워드가 안 맞아도 뜻이 가까우면 항목을 넣어.', en: 'Adds an entry when the talk is about it, even without its keyword.' })}
          />
          <SettingsSwitchRow
            checked={draft.chatHistory}
            disabled={!isEnabled}
            onCheckedChange={(checked) => onPatch({ chatHistory: checked })}
            label={<ChatFilledLabel fieldId="embedding.chatHistory">{t({ ko: '채팅 기록 검색', en: 'Chat history search' })}</ChatFilledLabel>}
          />
          <SettingsSwitchRow
            checked={draft.fileSearch}
            disabled={!isEnabled}
            onCheckedChange={(checked) => onPatch({ fileSearch: checked })}
            label={<ChatFilledLabel fieldId="embedding.fileSearch">{t({ ko: '파일·회의록 검색', en: 'File and minutes search' })}</ChatFilledLabel>}
          />
          <SettingsSwitchRow
            checked={draft.imageSearch}
            disabled={!isEnabled}
            onCheckedChange={(checked) => onPatch({ imageSearch: checked })}
            label={<ChatFilledLabel fieldId="embedding.imageSearch">{t({ ko: '이미지 임베딩', en: 'Image embeddings' })}</ChatFilledLabel>}
            info={t({ ko: '설명으로 이미지 찾기와 내용이 비슷한 이미지. 라이브러리를 CPU로 장당 약 1초씩 색인하고, 모델 메모리가 1.3GB에서 2.2GB로 늘어.', en: 'Find images by a description and by what they show. Indexes the library on the CPU (about 1 s per image) and raises model memory from 1.3 GB to 2.2 GB.' })}
          />
          <SettingsSwitchRow
            checked={draft.keepModelLoaded}
            disabled={!isEnabled}
            onCheckedChange={(checked) => onPatch({ keepModelLoaded: checked })}
            label={<ChatFilledLabel fieldId="embedding.keepModelLoaded">{t({ ko: '모델 메모리 유지', en: 'Keep model in memory' })}</ChatFilledLabel>}
          />
          <SettingRow label={<ChatFilledLabel fieldId="embedding.autoUnloadMinutes">{unloadLabel}</ChatFilledLabel>} controlClassName={SETTINGS_CONTROL_CLASS}>
            <NumberStepperInput min={1} max={1440} variant="settings" aria-label={unloadLabel} disabled={!isEnabled || draft.keepModelLoaded} value={draft.autoUnloadMinutes} onValueCommit={(nextValue) => onPatch({ autoUnloadMinutes: Math.min(1440, Math.max(1, Math.round(Number(nextValue) || 1))) })} />
          </SettingRow>
          <SettingRow
            label={t({ ko: '색인', en: 'Indexed' })}
            info={status?.statusMessage && !status.dependenciesAvailable ? status.statusMessage : undefined}
            controlClassName="flex min-w-0 justify-end"
          >
            <span className="font-mono text-xs text-muted-foreground tabular-nums">{indexed || '—'}</span>
          </SettingRow>
        </>
      ) : (
        <SettingsRowsSkeleton rows={5} />
      )}
    </RowGroup>
  )
}

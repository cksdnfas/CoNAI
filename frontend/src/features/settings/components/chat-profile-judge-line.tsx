import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link2, Scale } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { CHAT_JUDGE_PRESETS_QUERY_KEY, listChatJudgePresets } from '@/lib/api-chat-judge'
import type { Draft, PatchDraft } from './chat-profile-editor-fields'
import { JudgeConnectionSelect } from './chat-judge-connection-select'

/**
 * The profile's judge preset (none: the chat behaves as without a judge) and, behind the link button, a judge
 * connection of its own instead of the preset's. Every engine is judged; a Codex profile gets the directives and
 * status fields only (its tools stay fixed).
 */
export function ChatProfileJudgeLine({ open, draft, patch }: { open: boolean; draft: Draft; patch: PatchDraft }) {
  const { t } = useI18n()
  const presetsQuery = useQuery({ queryKey: CHAT_JUDGE_PRESETS_QUERY_KEY, queryFn: listChatJudgePresets, enabled: open })
  const presets = presetsQuery.data ?? []
  const preset = presets.find((item) => item.id === draft.judgePresetId)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const showOverride = draft.judgePresetId !== null && (overrideOpen || draft.judgeProviderName !== null)
  const label = t({ ko: '판단 프리셋', en: 'Judge preset' })

  return (
    <div className="space-y-2">
      <div className="flex min-h-10 items-center gap-3 text-sm">
        <span className="flex flex-1 items-center gap-1.5"><Scale className="size-4 text-resource-judge" aria-hidden="true" />{label}</span>
        <div className="flex w-64 max-w-[60%] items-center gap-1">
          <Select
            variant="settings"
            aria-label={label}
            value={draft.judgePresetId !== null ? String(draft.judgePresetId) : ''}
            onChange={(event) => patch(event.target.value ? { judgePresetId: Number(event.target.value) } : { judgePresetId: null, judgeProviderName: null, judgeModel: '' })}
          >
            <option value="">{t({ ko: '없음', en: 'None' })}</option>
            {presets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            {draft.judgePresetId !== null && !preset && presetsQuery.isSuccess ? <option value={draft.judgePresetId} disabled>{t({ ko: '프리셋 #{id}', en: 'Preset #{id}' }, { id: draft.judgePresetId })}</option> : null}
          </Select>
          {draft.judgePresetId !== null ? (
            <IconButton size="icon-sm" variant={showOverride ? 'secondary' : 'ghost'} onClick={() => {
              if (showOverride) {
                setOverrideOpen(false)
                patch({ judgeProviderName: null, judgeModel: '' })
              } else setOverrideOpen(true)
            }} label={showOverride ? t({ ko: '프리셋 연결 쓰기', en: 'Use the preset’s connection' }) : t({ ko: '이 프로필만 다른 판단 연결', en: 'Own judge connection for this profile' })}><Link2 /></IconButton>
          ) : null}
        </div>
      </div>
      {showOverride ? (
        <div className="flex min-h-10 items-center gap-3 pl-5.5 text-sm">
          <span className="flex-1 text-muted-foreground">{t({ ko: '판단 연결', en: 'Judge connection' })}</span>
          <div className="w-80 max-w-[70%]">
            <JudgeConnectionSelect
              enabled={open}
              ariaLabel={t({ ko: '판단 연결', en: 'Judge connection' })}
              providerName={draft.judgeProviderName}
              model={draft.judgeModel}
              emptyLabel={preset?.providerName ? t({ ko: '프리셋 따름 · {name}', en: 'Preset’s · {name}' }, { name: preset.providerName }) : t({ ko: '프리셋 따름', en: 'Preset’s' })}
              onChange={({ providerName, model }) => patch({ judgeProviderName: providerName, judgeModel: model })}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

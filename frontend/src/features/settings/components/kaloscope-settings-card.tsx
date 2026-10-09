import type { ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { RowGroup } from '@/components/ui/row-group'
import { Select } from '@/components/ui/select'
import { SettingRow } from '@/components/ui/setting-row'
import type { KaloscopeServerStatus, KaloscopeSettings } from '@conai/shared'
import { DEFAULT_ARTIST_LINK_URL_TEMPLATE } from '@/lib/settings-defaults'
import { useI18n, type TranslationInput } from '@/i18n'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { ChatFilledLabel } from './settings-filled-label'
import { SETTINGS_CONTROL_CLASS, SETTINGS_WIDE_CONTROL_CLASS, SettingsRowsSkeleton, SettingsStatLine } from './settings-rows'

interface KaloscopeSettingsCardProps {
  heading: ReactNode
  actions?: ReactNode
  kaloscopeDraft: KaloscopeSettings | null
  kaloscopeStatus: KaloscopeServerStatus | undefined
  onPatchKaloscope: (patch: Partial<KaloscopeSettings>) => void
}

function formatKaloscopeDependencyLabel(status: KaloscopeServerStatus | undefined, t: (input: TranslationInput) => string) {
  if (!status) return t({ ko: '확인 중…', en: 'Checking…' })
  return status.scriptExists && status.dependenciesAvailable ? t({ ko: '준비 OK', en: 'Ready' }) : t({ ko: '확인 필요', en: 'Needs attention' })
}

export function KaloscopeSettingsCard({
  heading,
  actions,
  kaloscopeDraft,
  kaloscopeStatus,
  onPatchKaloscope,
}: KaloscopeSettingsCardProps) {
  const { t } = useI18n()
  const isEnabled = kaloscopeDraft?.enabled === true
  const dependenciesReady = kaloscopeStatus ? kaloscopeStatus.scriptExists && kaloscopeStatus.dependenciesAvailable : null
  const labels = {
    device: t({ ko: '실행 장치', en: 'Device' }),
    topK: t({ ko: '작가 후보 수', en: 'Artist candidates' }),
    unload: t({ ko: '자동 언로드(분)', en: 'Auto unload (minutes)' }),
    artistLink: t({ ko: 'Artist 링크 URL', en: 'Artist link URL' }),
  }

  return (
    <RowGroup heading={heading} actions={actions}>
      <SettingsStatLine
        className="pb-2"
        items={[
          { label: t({ ko: '의존성', en: 'Dependencies' }), value: formatKaloscopeDependencyLabel(kaloscopeStatus, t), tone: dependenciesReady === null ? 'muted' : dependenciesReady ? 'success' : 'danger' },
          { label: t({ ko: '분석 프로세스', en: 'Analyzer process' }), value: kaloscopeStatus?.isRunning ? t({ ko: '실행 중', en: 'running' }) : t({ ko: '꺼짐', en: 'stopped' }) },
          { label: t({ ko: '모델 메모리 적재', en: 'Model in memory' }), value: kaloscopeStatus?.modelLoaded ? t({ ko: '예', en: 'yes' }) : t({ ko: '아니오', en: 'no' }) },
          { label: t({ ko: '모델 파일', en: 'Model files' }), value: kaloscopeStatus?.modelCached ? t({ ko: '받아 둠', en: 'downloaded' }) : t({ ko: '없음 (첫 실행 때 받음)', en: 'not yet (downloaded on first run)' }) },
        ]}
      />

      {kaloscopeDraft ? (
        <>
          <SettingsSwitchRow
            checked={kaloscopeDraft.enabled}
            onCheckedChange={(checked) => onPatchKaloscope({ enabled: checked })}
            label={<ChatFilledLabel fieldId="kaloscope.enabled">{t({ ko: 'Kaloscope 활성화', en: 'Enable Kaloscope' })}</ChatFilledLabel>}
          />

          <SettingsSwitchRow
            checked={kaloscopeDraft.autoTagOnUpload}
            disabled={!isEnabled}
            onCheckedChange={(checked) => onPatchKaloscope({ autoTagOnUpload: checked })}
            label={<ChatFilledLabel fieldId="kaloscope.autoTagOnUpload">{t({ ko: '새 이미지 자동 처리', en: 'Process new images automatically' })}</ChatFilledLabel>}
          />

          <SettingRow label={<ChatFilledLabel fieldId="kaloscope.device">{labels.device}</ChatFilledLabel>} controlClassName={SETTINGS_CONTROL_CLASS}>
            <Select variant="settings" aria-label={labels.device} value={kaloscopeDraft.device} disabled={!isEnabled} onChange={(event) => onPatchKaloscope({ device: event.target.value as KaloscopeSettings['device'] })}>
              <option value="auto">{t({ ko: '자동 (GPU 우선)', en: 'Auto (GPU if available)' })}</option>
              <option value="cpu">{t({ ko: 'CPU (느림, GPU 불필요)', en: 'CPU (slower, no GPU needed)' })}</option>
              <option value="cuda">{t({ ko: 'GPU (NVIDIA CUDA)', en: 'GPU (NVIDIA CUDA)' })}</option>
            </Select>
          </SettingRow>

          <SettingRow label={<ChatFilledLabel fieldId="kaloscope.topK">{labels.topK}</ChatFilledLabel>} controlClassName={SETTINGS_CONTROL_CLASS}>
            <NumberStepperInput min={1} max={200} variant="settings" aria-label={labels.topK} disabled={!isEnabled} value={kaloscopeDraft.topK} onValueCommit={(nextValue) => onPatchKaloscope({ topK: Number(nextValue) || 1 })} />
          </SettingRow>

          <SettingsSwitchRow
            checked={kaloscopeDraft.keepModelLoaded}
            disabled={!isEnabled}
            onCheckedChange={(checked) => onPatchKaloscope({ keepModelLoaded: checked })}
            label={<ChatFilledLabel fieldId="kaloscope.keepModelLoaded">{t({ ko: '모델 메모리 유지', en: 'Keep model in memory' })}</ChatFilledLabel>}
          />

          <SettingRow label={<ChatFilledLabel fieldId="kaloscope.autoUnloadMinutes">{labels.unload}</ChatFilledLabel>} controlClassName={SETTINGS_CONTROL_CLASS}>
            <NumberStepperInput
              min={1}
              variant="settings"
              aria-label={labels.unload}
              disabled={!isEnabled || kaloscopeDraft.keepModelLoaded}
              value={kaloscopeDraft.autoUnloadMinutes}
              onValueCommit={(nextValue) => onPatchKaloscope({ autoUnloadMinutes: Number(nextValue) || 1 })}
            />
          </SettingRow>

          <SettingRow label={<ChatFilledLabel fieldId="kaloscope.artistLinkUrlTemplate">{labels.artistLink}</ChatFilledLabel>} controlClassName={SETTINGS_WIDE_CONTROL_CLASS}>
            <Input
              variant="settings"
              aria-label={labels.artistLink}
              className="min-w-0 flex-1"
              value={kaloscopeDraft.artistLinkUrlTemplate}
              onChange={(event) => onPatchKaloscope({ artistLinkUrlTemplate: event.target.value })}
              placeholder={DEFAULT_ARTIST_LINK_URL_TEMPLATE}
            />
            <IconButton size="icon-sm" variant="ghost" label={t({ ko: '기본값', en: 'Default' })} onClick={() => onPatchKaloscope({ artistLinkUrlTemplate: DEFAULT_ARTIST_LINK_URL_TEMPLATE })}>
              <RotateCcw className="h-4 w-4" />
            </IconButton>
          </SettingRow>
        </>
      ) : (
        <SettingsRowsSkeleton rows={4} />
      )}
    </RowGroup>
  )
}

import type { ReactNode } from 'react'
import { RefreshCw, RotateCcw } from 'lucide-react'
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
import { SettingsRowsSkeleton, SettingsStatLine } from './settings-rows'

interface KaloscopeSettingsCardProps {
  heading: ReactNode
  actions?: ReactNode
  kaloscopeDraft: KaloscopeSettings | null
  kaloscopeStatus: KaloscopeServerStatus | undefined
  onPatchKaloscope: (patch: Partial<KaloscopeSettings>) => void
  /** Send results of the older Kaloscope back to the auto-tag queue (saved settings must allow auto tagging). */
  onRequeueOutdated: () => void
  isRequeueingOutdated: boolean
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
  onRequeueOutdated,
  isRequeueingOutdated,
}: KaloscopeSettingsCardProps) {
  const { t } = useI18n()
  const isEnabled = kaloscopeDraft?.enabled === true
  const dependenciesReady = kaloscopeStatus ? kaloscopeStatus.scriptExists && kaloscopeStatus.dependenciesAvailable : null
  const labels = {
    device: t({ ko: '실행 장치', en: 'Device' }),
    topK: t({ ko: '작가 후보 수', en: 'Artist candidates' }),
    unload: t({ ko: '자동 언로드(분)', en: 'Auto unload (minutes)' }),
    artistLink: t({ ko: 'Artist 링크 URL', en: 'Artist link URL' }),
    requeue: t({ ko: '이전 결과 다시 추출', en: 'Re-extract older results' }),
  }
  const outdated = kaloscopeStatus?.outdatedResults ?? 0
  // The scheduler re-extracts, so the saved settings (not the draft) decide whether it can run now.
  const canRequeue = outdated > 0 && kaloscopeStatus?.enabled === true && kaloscopeStatus.autoTagOnUpload === true

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

          <SettingRow label={t({ ko: '모델', en: 'Model' })} controlClassName="flex min-w-0 justify-end">
            <span className="text-sm">3.0 preview</span>
          </SettingRow>

          <SettingRow label={<ChatFilledLabel fieldId="kaloscope.device">{labels.device}</ChatFilledLabel>} controlWidth="standard">
            <Select variant="settings" aria-label={labels.device} value={kaloscopeDraft.device} disabled={!isEnabled} onChange={(event) => onPatchKaloscope({ device: event.target.value as KaloscopeSettings['device'] })}>
              <option value="auto">{t({ ko: '자동 (GPU 우선)', en: 'Auto (GPU if available)' })}</option>
              <option value="cpu">{t({ ko: 'CPU (느림, GPU 불필요)', en: 'CPU (slower, no GPU needed)' })}</option>
              <option value="cuda">{t({ ko: 'GPU (NVIDIA CUDA)', en: 'GPU (NVIDIA CUDA)' })}</option>
            </Select>
          </SettingRow>

          <SettingRow label={<ChatFilledLabel fieldId="kaloscope.topK">{labels.topK}</ChatFilledLabel>} controlWidth="standard">
            <NumberStepperInput min={1} max={200} variant="settings" aria-label={labels.topK} disabled={!isEnabled} value={kaloscopeDraft.topK} onValueCommit={(nextValue) => onPatchKaloscope({ topK: Number(nextValue) || 1 })} />
          </SettingRow>

          <SettingsSwitchRow
            checked={kaloscopeDraft.styleVectors !== false}
            disabled={!isEnabled}
            onCheckedChange={(checked) => onPatchKaloscope({ styleVectors: checked })}
            label={<ChatFilledLabel fieldId="kaloscope.styleVectors">{t({ ko: '화풍 벡터 저장', en: 'Keep style vectors' })}</ChatFilledLabel>}
            info={t({ ko: '비슷한 화풍 찾기에 쓰는 256차원 벡터.', en: 'The 256-d vector used to find images in a similar style.' })}
          />

          <SettingRow
            label={labels.requeue}
            info={outdated > 0 && !canRequeue
              ? t({ ko: 'v2로 뽑은 작가를 3.0으로 다시 뽑아. Kaloscope와 새 이미지 자동 처리를 켜고 저장해야 돌아가.', en: 'Extracts v2 artist results again with 3.0. Needs Kaloscope and automatic processing on (saved).' })
              : t({ ko: 'v2로 뽑은 작가를 3.0으로 다시 뽑아.', en: 'Extracts v2 artist results again with 3.0.' })}
          >
            <span className="font-mono text-xs text-muted-foreground tabular-nums">{t({ ko: '{count}장', en: '{count} items' }, { count: outdated.toLocaleString() })}</span>
            <IconButton size="icon-sm" variant="ghost" label={t({ ko: '다시 추출', en: 'Re-extract' })} disabled={!canRequeue || isRequeueingOutdated} onClick={onRequeueOutdated}>
              <RefreshCw className="h-4 w-4" />
            </IconButton>
          </SettingRow>

          <SettingsSwitchRow
            checked={kaloscopeDraft.keepModelLoaded}
            disabled={!isEnabled}
            onCheckedChange={(checked) => onPatchKaloscope({ keepModelLoaded: checked })}
            label={<ChatFilledLabel fieldId="kaloscope.keepModelLoaded">{t({ ko: '모델 메모리 유지', en: 'Keep model in memory' })}</ChatFilledLabel>}
          />

          <SettingRow label={<ChatFilledLabel fieldId="kaloscope.autoUnloadMinutes">{labels.unload}</ChatFilledLabel>} controlWidth="standard">
            <NumberStepperInput
              min={1}
              variant="settings"
              aria-label={labels.unload}
              disabled={!isEnabled || kaloscopeDraft.keepModelLoaded}
              value={kaloscopeDraft.autoUnloadMinutes}
              onValueCommit={(nextValue) => onPatchKaloscope({ autoUnloadMinutes: Number(nextValue) || 1 })}
            />
          </SettingRow>

          <SettingRow label={<ChatFilledLabel fieldId="kaloscope.artistLinkUrlTemplate">{labels.artistLink}</ChatFilledLabel>} controlWidth="wide">
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

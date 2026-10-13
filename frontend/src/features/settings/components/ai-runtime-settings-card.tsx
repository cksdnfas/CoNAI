import { useState, type ReactNode } from 'react'
import { Download, RefreshCw, ScrollText, X } from 'lucide-react'
import type { AiRuntimeInstallStep, AiRuntimeSettings, AiRuntimeStatus, AiTorchBackend, AiTorchBackendPreference } from '@conai/shared'
import { CodeBlock } from '@/components/ui/code-block'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Progress } from '@/components/ui/progress'
import { RowGroup } from '@/components/ui/row-group'
import { Select } from '@/components/ui/select'
import { SettingRow } from '@/components/ui/setting-row'
import { useI18n, type TranslationInput } from '@/i18n'
import { cn } from '@/lib/utils'
import { AiStatusPill } from './ai-status-pill'
import { ChatFilledLabel } from './settings-filled-label'
import { SETTINGS_CONTROL_CLASS, SETTINGS_WIDE_CONTROL_CLASS, SettingsRowsSkeleton } from './settings-rows'

interface AiRuntimeSettingsCardProps {
  heading: ReactNode
  /** Extra heading actions (the unsaved badge). */
  actions?: ReactNode
  draft: AiRuntimeSettings | null
  status: AiRuntimeStatus | undefined
  onPatch: (patch: Partial<AiRuntimeSettings>) => void
  onRefresh: () => void
  isRefreshing: boolean
  onInstall: (backend: AiTorchBackendPreference) => void
  onCancelInstall: () => void
  isInstallPending: boolean
}

const STEPS: AiRuntimeInstallStep[] = ['uv', 'python', 'venv', 'packages', 'verify', 'activate']

function backendLabel(backend: AiTorchBackend, t: (input: TranslationInput) => string) {
  switch (backend) {
    case 'cpu': return 'CPU'
    case 'cu126': return t({ ko: 'CUDA 12.6 · GTX 900–RTX 40', en: 'CUDA 12.6 · GTX 900–RTX 40' })
    case 'cu130': return t({ ko: 'CUDA 13.0 · RTX 20 이상', en: 'CUDA 13.0 · RTX 20 and newer' })
    case 'cu132': return t({ ko: 'CUDA 13.2 · RTX 20 이상', en: 'CUDA 13.2 · RTX 20 and newer' })
  }
}

function stepLabel(step: AiRuntimeInstallStep, t: (input: TranslationInput) => string) {
  switch (step) {
    case 'uv': return 'uv'
    case 'python': return 'Python 3.12'
    case 'venv': return t({ ko: '환경', en: 'Environment' })
    case 'packages': return 'torch'
    case 'verify': return t({ ko: '검증', en: 'Check' })
    case 'activate': return t({ ko: '교체', en: 'Switch' })
  }
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

export function AiRuntimeSettingsCard({
  heading,
  actions,
  draft,
  status,
  onPatch,
  onRefresh,
  isRefreshing,
  onInstall,
  onCancelInstall,
  isInstallPending,
}: AiRuntimeSettingsCardProps) {
  const { t } = useI18n()
  const [logOpen, setLogOpen] = useState(true)
  const install = status?.install
  const installing = install?.status === 'running'
  const failed = install?.status === 'failed'
  const active = status?.active ?? null
  const probe = active?.probe ?? null
  const gpu = status?.gpus[0] ?? null
  const blocked = status?.recommendation.blocked === 'driver-too-old'
  const labels = {
    build: t({ ko: '빌드', en: 'Build' }),
    python: 'Python',
    pythonPath: t({ ko: 'Python 경로', en: 'Python path' }),
    threads: t({ ko: 'CPU 스레드', en: 'CPU threads' }),
  }

  const stateCell = () => {
    if (!status) return <AiStatusPill tone="muted">{t({ ko: '확인 중', en: 'Checking' })}</AiStatusPill>
    if (installing) {
      return (
        <>
          <AiStatusPill tone="busy">{t({ ko: '설치 중', en: 'Installing' })}</AiStatusPill>
          <span className="font-mono text-xs tabular-nums">{active ? `${active.backend} → ${install?.backend}` : install?.backend}</span>
        </>
      )
    }
    if (status.settings.pythonSource === 'custom') {
      return (
        <>
          <AiStatusPill tone={failed ? 'error' : 'ok'}>{t({ ko: '직접 지정', en: 'Custom Python' })}</AiStatusPill>
          <span className="min-w-0 truncate font-mono text-xs">{status.resolvedPython.command}</span>
        </>
      )
    }
    if (active) {
      const gpuBroken = probe?.cudaAvailable && (probe.gpuSupported === false || probe.gpuComputeOk === false)
      return (
        <>
          <AiStatusPill tone={failed || gpuBroken ? 'warn' : 'ok'}>{failed ? t({ ko: '설치 실패 · 이전 환경 사용', en: 'Install failed · previous kept' }) : gpuBroken ? t({ ko: 'GPU 안 맞음', en: 'GPU unsupported' }) : t({ ko: '준비됨', en: 'Ready' })}</AiStatusPill>
          <span className="font-mono text-xs tabular-nums">{active.backend}{probe?.torch ? ` · torch ${probe.torch.split('+')[0]}` : ''}</span>
        </>
      )
    }
    // Nothing installed yet: the workers fall back to the custom / PYTHON_PATH Python.
    return (
      <>
        <AiStatusPill tone={failed ? 'error' : 'warn'}>{failed ? t({ ko: '설치 실패', en: 'Install failed' }) : t({ ko: '설치 안 됨', en: 'Not installed' })}</AiStatusPill>
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{status.resolvedPython.command}</span>
      </>
    )
  }

  const headingActions = (
    <>
      {actions}
      {installing ? (
        <>
          <IconButton size="icon-sm" variant="ghost" active={logOpen} label={logOpen ? t({ ko: '로그 접기', en: 'Hide log' }) : t({ ko: '로그 보기', en: 'Show log' })} onClick={() => setLogOpen((open) => !open)}>
            <ScrollText className="h-4 w-4" />
          </IconButton>
          <IconButton size="icon-sm" variant="ghost" label={t({ ko: '설치 취소', en: 'Cancel install' })} onClick={onCancelInstall}>
            <X className="h-4 w-4" />
          </IconButton>
        </>
      ) : (
        <>
          <IconButton size="icon-sm" variant="ghost" label={t({ ko: '다시 검사', en: 'Check again' })} disabled={isRefreshing} onClick={onRefresh}>
            <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin motion-reduce:animate-none')} />
          </IconButton>
          <IconButton
            size="icon-sm"
            variant="ghost"
            className="text-primary"
            label={active ? t({ ko: '다시 설치', en: 'Reinstall' }) : t({ ko: '설치', en: 'Install' })}
            disabled={!status?.installSupported || !draft || blocked || isInstallPending}
            onClick={() => draft && onInstall(draft.torchBackend)}
          >
            <Download className="h-4 w-4" />
          </IconButton>
        </>
      )}
    </>
  )

  const stepIndex = install?.step ? STEPS.indexOf(install.step) : -1
  const log = install?.log ?? []

  return (
    <RowGroup heading={heading} actions={headingActions}>
      {draft && status ? (
        <>
          <SettingRow label={t({ ko: '상태', en: 'Status' })} controlClassName="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{stateCell()}</div>
          </SettingRow>

          {installing || (failed && log.length > 0) ? (
            <div className="grid gap-2 border-b border-line py-2.5">
              {installing ? (
                <>
                  <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
                    {STEPS.map((step, index) => (
                      <span key={step} className={cn(index < stepIndex && 'text-success', index === stepIndex && 'font-semibold text-foreground')}>
                        {stepLabel(step, t)}{index < stepIndex ? ' ✓' : ''}
                        {index === stepIndex && step === 'packages' && install && install.downloadedBytes > 0 ? ` ${formatBytes(install.downloadedBytes)}` : ''}
                      </span>
                    ))}
                  </div>
                  <Progress size="sm" value={stepIndex >= 0 ? ((stepIndex + 0.5) / STEPS.length) * 100 : null} />
                </>
              ) : null}
              {logOpen || failed ? (
                <CodeBlock size="2xs" maxHeight="xs" className="text-muted-foreground">
                  {[...log.slice(-12), ...(failed && install?.error ? [install.error] : [])].join('\n')}
                </CodeBlock>
              ) : null}
            </div>
          ) : null}

          <SettingRow label={t({ ko: 'GPU', en: 'GPU' })} controlClassName="flex min-w-0 flex-wrap items-center justify-end gap-2">
            {gpu ? (
              <div className="flex min-w-0 flex-wrap items-baseline justify-end gap-x-2 text-sm">
                <span>{gpu.name}{status.gpus.length > 1 ? ` +${status.gpus.length - 1}` : ''}</span>
                <span className="font-mono text-xs text-muted-foreground">{gpu.computeCapability} · {t({ ko: '드라이버', en: 'driver' })} {gpu.driverVersion}</span>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">{t({ ko: '없음', en: 'None' })}</span>
            )}
          </SettingRow>

          <SettingRow
            label={<ChatFilledLabel fieldId="aiRuntime.torchBackend">{labels.build}</ChatFilledLabel>}
            info={blocked
              ? t({ ko: '이 GPU는 CUDA 13이 필요한데 드라이버가 낮아. 드라이버를 580 이상으로 올려줘.', en: 'This GPU needs CUDA 13 and the driver is too old. Update the driver to 580 or newer.' })
              : t({ ko: '자동은 GPU 세대와 드라이버를 보고 골라. 바꾼 빌드는 설치해야 적용돼.', en: 'Auto picks from the GPU generation and driver. A changed build applies after installing.' })}
            controlClassName={SETTINGS_CONTROL_CLASS}
          >
            <Select variant="settings" aria-label={labels.build} value={draft.torchBackend} disabled={installing} onChange={(event) => onPatch({ torchBackend: event.target.value as AiTorchBackendPreference })}>
              <option value="auto">{t({ ko: '자동', en: 'Auto' })} ({backendLabel(status.effectiveBackend, t).split(' · ')[0]})</option>
              {(['cpu', 'cu126', 'cu130', 'cu132'] as const).map((backend) => (
                <option key={backend} value={backend}>{backendLabel(backend, t)}</option>
              ))}
            </Select>
          </SettingRow>

          <SettingRow
            label={<ChatFilledLabel fieldId="aiRuntime.pythonSource">{labels.python}</ChatFilledLabel>}
            info={t({ ko: '직접 지정하면 앱이 설치한 환경 대신 그 Python을 써.', en: 'A custom Python is used instead of the app-installed environment.' })}
            controlClassName={SETTINGS_CONTROL_CLASS}
          >
            <Select variant="settings" aria-label={labels.python} value={draft.pythonSource} onChange={(event) => onPatch({ pythonSource: event.target.value as AiRuntimeSettings['pythonSource'] })}>
              <option value="auto">{t({ ko: '앱이 설치한 환경', en: 'App-installed environment' })}</option>
              <option value="custom">{t({ ko: '직접 지정', en: 'Custom' })}</option>
            </Select>
          </SettingRow>

          {draft.pythonSource === 'custom' ? (
            <SettingRow label={labels.pythonPath} controlClassName={SETTINGS_WIDE_CONTROL_CLASS}>
              <Input variant="settings" aria-label={labels.pythonPath} className="min-w-0 flex-1 font-mono" value={draft.customPythonPath} placeholder="python" onChange={(event) => onPatch({ customPythonPath: event.target.value })} />
            </SettingRow>
          ) : null}

          <SettingRow
            label={<ChatFilledLabel fieldId="aiRuntime.cpuThreads">{labels.threads}</ChatFilledLabel>}
            info={t({ ko: '모델 프로세스 하나가 쓰는 CPU 스레드. 0이면 코어 절반(최대 8).', en: 'CPU threads per model process. 0 = half the cores (at most 8).' })}
            controlClassName={SETTINGS_CONTROL_CLASS}
          >
            <NumberStepperInput min={0} max={256} variant="settings" aria-label={labels.threads} value={draft.cpuThreads} onValueCommit={(nextValue) => onPatch({ cpuThreads: Math.max(0, Math.round(Number(nextValue) || 0)) })} />
          </SettingRow>
        </>
      ) : (
        <SettingsRowsSkeleton rows={4} />
      )}
    </RowGroup>
  )
}

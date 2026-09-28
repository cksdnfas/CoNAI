import type { ReactNode } from 'react'
import { AlertTriangle, FileSearch, RefreshCcw, ScanSearch, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { useConfirm, type ConfirmOptions } from '@/components/ui/confirm-dialog'
import { RuntimeJobProgress } from '@/components/common/runtime-job-progress'
import type { RuntimeJobRecord } from '@/types/runtime-job'
import type { ScanAllSummary } from '@/types/folder'
import { useI18n } from '@/i18n'
import { AutoTestCard } from './auto-test-card'
import type { AutoTabProps } from './auto-tab-types'
import { DataRematchSection } from './data-rematch-section'

interface MaintenanceActionRowProps {
  icon: ReactNode
  title: string
  description: string
  actionLabel: string
  busyLabel: string
  isBusy: boolean
  /** Asked with the shared confirm dialog before `onRun` fires. */
  confirmOptions: ConfirmOptions
  onRun: () => void
  children?: ReactNode
}

/** One maintenance action: what it does, what it touches, and a confirmed trigger. */
function MaintenanceActionRow({ icon, title, description, actionLabel, busyLabel, isBusy, confirmOptions, onRun, children }: MaintenanceActionRowProps) {
  const confirm = useConfirm()

  return (
    <div className="space-y-3 rounded-sm bg-surface-container/70 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-semibold text-foreground">{title}</div>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant={confirmOptions.tone === 'destructive' ? 'destructive' : 'secondary'}
          className="shrink-0 self-start"
          disabled={isBusy}
          onClick={async () => {
            if (await confirm(confirmOptions)) {
              onRun()
            }
          }}
        >
          {isBusy ? <RefreshCcw className="h-4 w-4 animate-spin" /> : null}
          {isBusy ? busyLabel : actionLabel}
        </Button>
      </div>
      {children}
    </div>
  )
}

interface MaintenanceTabProps {
  onScanAll: () => void
  isScanningAll: boolean
  scanAllJob: RuntimeJobRecord<ScanAllSummary> | undefined
  onCancelScanAll: () => void
  isCancellingScanAll: boolean
  onVerifyAllFiles: () => void
  isVerifyingAllFiles: boolean
  onReextractAll: () => void
  isReextracting: boolean
  autoTabProps: AutoTabProps
}

/** Gather library-wide jobs and diagnostics in one danger zone, each behind a confirmation. */
export function MaintenanceTab({
  onScanAll,
  isScanningAll,
  scanAllJob,
  onCancelScanAll,
  isCancellingScanAll,
  onVerifyAllFiles,
  isVerifyingAllFiles,
  onReextractAll,
  isReextracting,
  autoTabProps,
}: MaintenanceTabProps) {
  const { t } = useI18n()

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-sm bg-destructive-soft/25 p-4">
        <div className="flex gap-3">
          <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-destructive" />
          <div className="min-w-0 space-y-1">
            <Heading level={2}>{t({ ko: '유지보수', en: 'Maintenance' })}</Heading>
            <p className="text-sm text-muted-foreground">
              {t({
                ko: '라이브러리 전체를 다시 훑거나 고치는 작업이야. 오래 걸리거나 되돌릴 수 없는 것도 있으니 설명을 읽고 실행해.',
                en: 'Jobs that re-read or repair the whole library. Some take a long time or cannot be undone, so read each description first.',
              })}
            </p>
          </div>
        </div>

        <MaintenanceActionRow
          icon={<ScanSearch className="h-4 w-4" />}
          title={t({ ko: '전체 스캔', en: 'Full scan' })}
          description={t({ ko: '모든 감시 폴더를 처음부터 훑어서 새 파일을 등록해. 폴더가 크면 몇 분 이상 걸려.', en: 'Walk every watched folder and register new files. Large folders take several minutes or more.' })}
          actionLabel={t({ ko: '전체 스캔', en: 'Scan all' })}
          busyLabel={t({ ko: '스캔 중', en: 'Scanning' })}
          isBusy={isScanningAll}
          confirmOptions={{
            title: t({ ko: '전체 스캔', en: 'Full scan' }),
            description: t({ ko: '모든 감시 폴더를 스캔할까? 도중에 취소할 수 있어.', en: 'Scan every watched folder? You can cancel it midway.' }),
            confirmLabel: t({ ko: '스캔 시작', en: 'Start scan' }),
          }}
          onRun={onScanAll}
        >
          <RuntimeJobProgress job={scanAllJob} cancel={onCancelScanAll} isCancelling={isCancellingScanAll} />
        </MaintenanceActionRow>

        <MaintenanceActionRow
          icon={<ShieldCheck className="h-4 w-4" />}
          title={t({ ko: '전체 파일 검증', en: 'Verify all files' })}
          description={t({ ko: '등록된 파일이 디스크에 그대로 있는지 확인하고, 사라진 파일의 기록은 정리해.', en: 'Check that every registered file still exists on disk and clean up records of missing files.' })}
          actionLabel={t({ ko: '검증 실행', en: 'Verify' })}
          busyLabel={t({ ko: '검증 중', en: 'Verifying' })}
          isBusy={isVerifyingAllFiles}
          confirmOptions={{
            title: t({ ko: '전체 파일 검증', en: 'Verify all files' }),
            description: t({ ko: '디스크에서 찾지 못한 파일의 기록은 라이브러리에서 지워져. 외장 드라이브가 빠져 있으면 먼저 연결해. 계속할까?', en: 'Records of files that cannot be found on disk are removed from the library. Connect any external drives first. Continue?' }),
            confirmLabel: t({ ko: '검증 실행', en: 'Verify' }),
            tone: 'destructive',
          }}
          onRun={onVerifyAllFiles}
        />

        <MaintenanceActionRow
          icon={<FileSearch className="h-4 w-4" />}
          title={t({ ko: '메타데이터 전체 재추출', en: 'Re-extract all metadata' })}
          description={t({ ko: '모든 이미지의 AI 메타데이터를 파일에서 다시 읽어 기존 값을 갱신해. 백그라운드 큐가 한동안 바빠질 수 있어.', en: 'Read AI metadata from every image again and update stored values. The background queue may stay busy for a while.' })}
          actionLabel={t({ ko: '재추출', en: 'Re-extract' })}
          busyLabel={t({ ko: '등록 중', en: 'Queuing' })}
          isBusy={isReextracting}
          confirmOptions={{
            title: t({ ko: 'AI 메타데이터 다시 추출', en: 'Re-extract AI metadata' }),
            description: t('metadataTab.reExtractAiMetadataFor'),
            confirmLabel: t({ ko: '다시 추출', en: 'Re-extract' }),
          }}
          onRun={onReextractAll}
        />
      </section>

      <DataRematchSection />

      <AutoTestCard
        heading={t({ ko: '개발자 도구', en: 'Developer tools' })}
        description={t({ ko: '특정 이미지로 Kaloscope·WD Tagger 결과를 바로 확인하는 점검용 도구야.', en: 'Diagnostic tool for checking Kaloscope and WD Tagger output on a specific image.' })}
        actions={(
          <>
            <Button size="sm" variant="secondary" onClick={autoTabProps.onResolveAutoTestMedia} disabled={!autoTabProps.autoTestHashInput.trim() || autoTabProps.isResolvingAutoTestMedia}>
              {t({ ko: '해시 확인', en: 'Check hash' })}
            </Button>
            <Button size="sm" variant="secondary" onClick={autoTabProps.onRandomAutoTestMedia} disabled={autoTabProps.isPickingRandomAutoTestMedia}>
              {t({ ko: '랜덤 선택', en: 'Random pick' })}
            </Button>
          </>
        )}
        autoTestHashInput={autoTabProps.autoTestHashInput}
        autoTestMedia={autoTabProps.autoTestMedia}
        autoTestImage={autoTabProps.autoTestImage}
        isLoadingAutoTestImage={autoTabProps.isLoadingAutoTestImage}
        taggerTestResult={autoTabProps.taggerTestResult}
        kaloscopeTestResult={autoTabProps.kaloscopeTestResult}
        onAutoTestHashInputChange={autoTabProps.onAutoTestHashInputChange}
        onResolveAutoTestMedia={autoTabProps.onResolveAutoTestMedia}
        onRunTaggerAutoTest={autoTabProps.onRunTaggerAutoTest}
        onRunKaloscopeAutoTest={autoTabProps.onRunKaloscopeAutoTest}
        isRunningTaggerAutoTest={autoTabProps.isRunningTaggerAutoTest}
        isRunningKaloscopeAutoTest={autoTabProps.isRunningKaloscopeAutoTest}
      />
    </div>
  )
}

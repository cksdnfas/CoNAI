import type { ReactNode } from 'react'
import { FileSearch, LoaderCircle, Play, RefreshCcw, ScanSearch, Search, ShieldCheck, Shuffle, X } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Progress } from '@/components/ui/progress'
import { RowGroup } from '@/components/ui/row-group'
import { useConfirm, type ConfirmOptions } from '@/components/ui/confirm-dialog'
import { RuntimeJobProgress } from '@/components/common/runtime-job-progress'
import type { RuntimeJobRecord } from '@/types/runtime-job'
import type { ScanAllSummary } from '@/types/folder'
import type { FileVerificationRunResult, MetadataReextractAllResult } from '@/lib/api-settings'
import { useI18n } from '@/i18n'
import { AutoTestCard } from './auto-test-card'
import type { AutoTabProps } from './auto-tab-types'
import { DataRematchSection } from './data-rematch-section'
import { DatabaseMaintenanceSection } from './database-maintenance-section'
import { MaintenanceRow } from './maintenance-row'
import { SettingsStatLine } from './settings-rows'

interface MaintenanceActionRowProps {
  icon: ReactNode
  title: string
  actionLabel: string
  busyLabel: string
  isBusy: boolean
  /** Asked with the shared confirm dialog before `onRun` fires. */
  confirmOptions: ConfirmOptions
  onRun: () => void
  children?: ReactNode
}

/** One maintenance action: a title and a confirmed trigger; the confirm dialog carries the warning. */
function MaintenanceActionRow({ icon, title, actionLabel, busyLabel, isBusy, confirmOptions, onRun, children }: MaintenanceActionRowProps) {
  const confirm = useConfirm()

  return (
    <MaintenanceRow
      icon={icon}
      title={title}
      actions={(
        <IconButton
          size="icon-sm"
          variant={confirmOptions.tone === 'destructive' ? 'destructive' : 'secondary'}
          disabled={isBusy}
          label={isBusy ? busyLabel : actionLabel}
          onClick={async () => {
            if (await confirm(confirmOptions)) {
              onRun()
            }
          }}
        >
          {isBusy ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        </IconButton>
      )}
    >
      {children}
    </MaintenanceRow>
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
  verifyAllFilesJob: RuntimeJobRecord<FileVerificationRunResult> | undefined
  onCancelVerifyAllFiles: () => void
  isCancellingVerifyAllFiles: boolean
  onReextractAll: () => void
  isReextracting: boolean
  reextractJob: RuntimeJobRecord<MetadataReextractAllResult> | undefined
  onCancelReextractAll: () => void
  isCancellingReextractAll: boolean
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
  verifyAllFilesJob,
  onCancelVerifyAllFiles,
  isCancellingVerifyAllFiles,
  onReextractAll,
  isReextracting,
  reextractJob,
  onCancelReextractAll,
  isCancellingReextractAll,
  autoTabProps,
}: MaintenanceTabProps) {
  const { t, formatNumber } = useI18n()

  return (
    <div className="space-y-8">
      <RowGroup heading={t({ ko: '라이브러리 작업', en: 'Library jobs' })}>

        <MaintenanceActionRow
          icon={<ScanSearch className="h-4 w-4" />}
          title={t({ ko: '전체 스캔', en: 'Full scan' })}
          actionLabel={t({ ko: '전체 스캔 실행: 모든 감시 폴더를 다시 훑어', en: 'Run full scan: rescan every watched folder' })}
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
          actionLabel={t({ ko: '검증 실행: 디스크에 없는 파일 기록 정리', en: 'Run verification: clean up records of missing files' })}
          busyLabel={t({ ko: '검증 중', en: 'Verifying' })}
          isBusy={isVerifyingAllFiles}
          confirmOptions={{
            title: t({ ko: '전체 파일 검증', en: 'Verify all files' }),
            description: t({ ko: '디스크에서 찾지 못한 파일의 기록은 라이브러리에서 지워져. 외장 드라이브가 빠져 있으면 먼저 연결해. 계속할까?', en: 'Records of files that cannot be found on disk are removed from the library. Connect any external drives first. Continue?' }),
            confirmLabel: t({ ko: '검증 실행', en: 'Verify' }),
            tone: 'destructive',
          }}
          onRun={onVerifyAllFiles}
        >
          <RuntimeJobProgress job={verifyAllFilesJob} cancel={onCancelVerifyAllFiles} isCancelling={isCancellingVerifyAllFiles} />
        </MaintenanceActionRow>

        <MaintenanceActionRow
          icon={<FileSearch className="h-4 w-4" />}
          title={t({ ko: '메타데이터 전체 재추출', en: 'Re-extract all metadata' })}
          actionLabel={t({ ko: '메타데이터 재추출 실행', en: 'Run metadata re-extraction' })}
          busyLabel={t({ ko: '다시 추출 중', en: 'Re-extracting' })}
          isBusy={isReextracting}
          confirmOptions={{
            title: t({ ko: 'AI 메타데이터 다시 추출', en: 'Re-extract AI metadata' }),
            description: t({ ko: '모든 이미지의 AI 메타데이터를 다시 추출할까? 중단해도 이미 등록한 항목은 마저 처리해.', en: 'Re-extract AI metadata for every image? Already queued items finish if you stop.' }),
            confirmLabel: t({ ko: '다시 추출', en: 'Re-extract' }),
          }}
          onRun={onReextractAll}
        >
          {reextractJob ? (
            <div className="space-y-2">
              <SettingsStatLine items={[
                { label: reextractJob.status === 'queued' || reextractJob.status === 'running' ? t({ ko: '지금까지 찾은', en: 'Found so far' }) : t({ ko: '찾은', en: 'Found' }), value: formatNumber(reextractJob.progress.total) },
                { label: t({ ko: '등록', en: 'Queued' }), value: formatNumber(reextractJob.progress.total - reextractJob.progress.skipped) },
                { label: t({ ko: '누락', en: 'Missing' }), value: formatNumber(reextractJob.progress.skipped) },
                { label: t({ ko: '처리', en: 'Processed' }), value: formatNumber(reextractJob.progress.succeeded + reextractJob.progress.failed) },
              ]} />
              {reextractJob.status === 'queued' || reextractJob.status === 'running' ? (
                <div className="space-y-2">
                  <div className="flex justify-end">
                    <IconButton
                      size="icon-xs"
                      variant="ghost"
                      disabled={isCancellingReextractAll}
                      label={isCancellingReextractAll ? t({ ko: '취소하는 중...', en: 'Cancelling...' }) : t({ ko: '취소', en: 'Cancel' })}
                      onClick={onCancelReextractAll}
                    >
                      {isCancellingReextractAll ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                    </IconButton>
                  </div>
                  <Progress size="lg" value={null} />
                </div>
              ) : <RuntimeJobProgress job={reextractJob} />}
            </div>
          ) : null}
        </MaintenanceActionRow>
      </RowGroup>

      <DatabaseMaintenanceSection />

      <DataRematchSection />

      <AutoTestCard
        heading={t({ ko: '개발자 도구', en: 'Developer tools' })}
        actions={(
          <>
            <IconButton variant="ghost" label={t({ ko: '해시 확인', en: 'Check hash' })} onClick={autoTabProps.onResolveAutoTestMedia} disabled={!autoTabProps.autoTestHashInput.trim() || autoTabProps.isResolvingAutoTestMedia}>
              <Search className="h-4 w-4" />
            </IconButton>
            <IconButton variant="ghost" label={t({ ko: '랜덤 선택', en: 'Random pick' })} onClick={autoTabProps.onRandomAutoTestMedia} disabled={autoTabProps.isPickingRandomAutoTestMedia}>
              <Shuffle className="h-4 w-4" />
            </IconButton>
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

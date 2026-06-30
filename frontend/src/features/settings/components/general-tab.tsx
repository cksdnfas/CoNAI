import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, DatabaseZap, RotateCw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { getDataRematchStatus, startDataRematchJob, type DataRematchJobSnapshot, type DataRematchOptions } from '@/lib/api-settings'
import { useI18n } from '@/i18n'
import { DEFAULT_HEADER_NAVIGATION_SETTINGS, type GeneralSettings, type HeaderNavigationItemKey } from '@/types/settings'
import { cn } from '@/lib/utils'
import { SettingsField, SettingsInsetBlock, SettingsSection, SettingsToggleRow, SettingsValueTile } from './settings-primitives'

interface GeneralTabProps {
  generalDraft: GeneralSettings | null
  onPatchGeneral: (patch: Partial<GeneralSettings>) => void
  onPatchDeleteProtection: (patch: Partial<GeneralSettings['deleteProtection']>) => void
  onSave: () => void
  isSaving: boolean
  hasChanges: boolean
}

const DEFAULT_DATA_REMATCH_OPTIONS: DataRematchOptions = {
  thumbnail: false,
  metadata: false,
  hash: false,
}

const HEADER_NAVIGATION_OPTIONS: Array<{ key: HeaderNavigationItemKey; label: { ko: string; en: string } }> = [
  { key: 'access', label: { ko: '페이지 목록', en: 'Page list' } },
  { key: 'home', label: { ko: '홈', en: 'Home' } },
  { key: 'groups', label: { ko: '그룹', en: 'Groups' } },
  { key: 'prompts', label: { ko: '프롬프트', en: 'Prompts' } },
  { key: 'generation', label: { ko: '생성', en: 'Generation' } },
  { key: 'upload', label: { ko: '업로드', en: 'Upload' } },
  { key: 'wallpaper', label: { ko: '월페이퍼', en: 'Wallpaper' } },
  { key: 'settings', label: { ko: '설정', en: 'Settings' } },
  { key: 'search', label: { ko: '검색', en: 'Search' } },
  { key: 'queue', label: { ko: '대기열', en: 'Queue' } },
  { key: 'account', label: { ko: '사용자', en: 'User' } },
]

function formatCount(value: number) {
  return Number.isFinite(value) ? value.toLocaleString() : '0'
}

function getPhaseLabel(status: DataRematchJobSnapshot | undefined, locale: 'ko' | 'en') {
  if (!status) return locale === 'ko' ? '확인 중' : 'Checking'

  const labels: Record<DataRematchJobSnapshot['phase'], { ko: string; en: string }> = {
    idle: { ko: '대기', en: 'Idle' },
    'selecting-targets': { ko: '대상 선별', en: 'Selecting' },
    'regenerating-thumbnails': { ko: '썸네일 재생성', en: 'Thumbnails' },
    'queueing-metadata': { ko: '메타데이터 큐 등록', en: 'Metadata queue' },
    'rebuilding-hashes': { ko: '해시 재생성', en: 'Hash rebuild' },
    'remapping-references': { ko: 'DB 참조 리매칭', en: 'Reference rematch' },
    completed: { ko: '완료', en: 'Completed' },
    failed: { ko: '실패', en: 'Failed' },
  }

  return labels[status.phase][locale]
}

/** Render app-wide defaults that should be easy to find from the first settings tab. */
export function GeneralTab({ generalDraft, onPatchGeneral, onPatchDeleteProtection, onSave, isSaving, hasChanges }: GeneralTabProps) {
  const { t, language } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [dataRematchOptions, setDataRematchOptions] = useState<DataRematchOptions>(DEFAULT_DATA_REMATCH_OPTIONS)
  const [hashConfirmed, setHashConfirmed] = useState(false)

  const dataRematchStatusQuery = useQuery({
    queryKey: ['data-rematch-status'],
    queryFn: getDataRematchStatus,
    refetchInterval: (query) => query.state.data?.status === 'running' ? 2000 : false,
  })

  const dataRematchMutation = useMutation({
    mutationFn: () => startDataRematchJob({
      ...dataRematchOptions,
      confirmHashRegeneration: dataRematchOptions.hash && hashConfirmed,
    }),
    onSuccess: (status) => {
      queryClient.setQueryData(['data-rematch-status'], status)
      showSnackbar({ message: t({ ko: '데이터 재매칭 작업을 시작했어.', en: 'Data rematch job started.' }), tone: 'info' })
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : t({ ko: '데이터 재매칭을 시작하지 못했어.', en: 'Failed to start data rematch.' }),
        tone: 'error',
      })
    },
  })

  const status = dataRematchStatusQuery.data
  const isDataRematchRunning = status?.status === 'running'
  const isDataRematchBusy = dataRematchMutation.isPending || isDataRematchRunning
  const hasSelectedDataRematchOption = dataRematchOptions.thumbnail || dataRematchOptions.metadata || dataRematchOptions.hash
  const dataRematchProgress = status && status.total > 0 ? Math.round((status.processed / status.total) * 100) : 0
  const latestErrors = status?.errors.slice(-3) ?? []

  const updateDataRematchOption = (key: keyof DataRematchOptions, checked: boolean) => {
    if (key === 'hash') {
      setDataRematchOptions(checked ? { thumbnail: false, metadata: false, hash: true } : { ...dataRematchOptions, hash: false })
      setHashConfirmed(false)
      return
    }

    setDataRematchOptions((previous) => ({
      ...previous,
      [key]: checked,
      hash: checked ? false : previous.hash,
    }))

    if (checked) {
      setHashConfirmed(false)
    }
  }

  const updateHeaderNavigationItem = (key: HeaderNavigationItemKey, checked: boolean) => {
    if (!generalDraft) {
      return
    }

    onPatchGeneral({
      headerNavigation: {
        ...DEFAULT_HEADER_NAVIGATION_SETTINGS,
        ...generalDraft.headerNavigation,
        [key]: checked,
      },
    })
  }

  const startDataRematch = () => {
    if (!hasSelectedDataRematchOption) {
      showSnackbar({ message: t({ ko: '재생성 범위를 먼저 선택해.', en: 'Select a rematch scope first.' }), tone: 'error' })
      return
    }

    dataRematchMutation.mutate()
  }

  return (
    <div className="space-y-6">
      <section>
        <SettingsSection
          heading={t({ ko: '일반 설정', en: 'General settings' })}
          actions={(
            <Button
              size="icon-sm"
              onClick={onSave}
              disabled={!generalDraft || isSaving || !hasChanges}
              aria-label={hasChanges ? t({ ko: '일반 설정 저장', en: 'Save general settings' }) : t({ ko: '일반 설정 변경 없음', en: 'No general settings changes' })}
              title={hasChanges ? t({ ko: '일반 설정 저장', en: 'Save general settings' }) : t({ ko: '저장할 변경 없음', en: 'No changes to save' })}
            >
              <Save className="h-4 w-4" />
            </Button>
          )}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {generalDraft ? (
              <>
                <SettingsInsetBlock className="text-sm text-muted-foreground md:col-span-2">
                  {t({
                    ko: '기본 동작과 삭제 보호를 여기서 먼저 조절해. RecycleBin은 user 폴더 기준 경로를 사용해.',
                    en: 'Adjust default behavior and delete protection here first. RecycleBin uses a path relative to the user folder.',
                  })}
                </SettingsInsetBlock>

                <SettingsField label={t({ ko: '언어', en: 'Language' })}>
                  <Select
                    variant="settings"
                    value={generalDraft.language}
                    onChange={(event) => onPatchGeneral({ language: event.target.value as GeneralSettings['language'] })}
                  >
                    <option value="ko">{t({ ko: '한국어', en: 'Korean' })}</option>
                    <option value="en">{t({ ko: '영어', en: 'English' })}</option>
                  </Select>
                </SettingsField>

                <SettingsField label={t({ ko: 'RecycleBin 경로', en: 'RecycleBin path' })}>
                  <Input
                    variant="settings"
                    value={generalDraft.deleteProtection.recycleBinPath}
                    onChange={(event) => onPatchDeleteProtection({ recycleBinPath: event.target.value })}
                    placeholder="RecycleBin"
                  />
                </SettingsField>

                <SettingsField label={t({ ko: '유사/중복 검사', en: 'Similar/duplicate check' })}>
                  <Select
                    variant="settings"
                    value={generalDraft.imageSimilarityCheckMode ?? 'always'}
                    onChange={(event) => onPatchGeneral({ imageSimilarityCheckMode: event.target.value as GeneralSettings['imageSimilarityCheckMode'] })}
                  >
                    <option value="manual">{t({ ko: '수동 실행', en: 'Manual' })}</option>
                    <option value="always">{t({ ko: '상세 열 때 자동 실행', en: 'Auto on detail open' })}</option>
                  </Select>
                </SettingsField>

                <SettingsToggleRow className="md:col-span-2">
                  <input
                    type="checkbox"
                    checked={generalDraft.deleteProtection.enabled}
                    onChange={(event) => onPatchDeleteProtection({ enabled: event.target.checked })}
                  />
                  {t({ ko: '삭제 시 RecycleBin 보호 사용', en: 'Use RecycleBin protection when deleting' })}
                </SettingsToggleRow>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={generalDraft.enableGallery ?? true}
                    onChange={(event) => onPatchGeneral({ enableGallery: event.target.checked })}
                  />
                  {t({ ko: '갤러리 기능 사용', en: 'Enable gallery features' })}
                </SettingsToggleRow>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={generalDraft.showRatingBadges ?? true}
                    onChange={(event) => onPatchGeneral({ showRatingBadges: event.target.checked })}
                  />
                  {t({ ko: '등급 배지 표시', en: 'Show rating badges' })}
                </SettingsToggleRow>

                <SettingsToggleRow className="md:col-span-2">
                  <input
                    type="checkbox"
                    checked={generalDraft.autoCleanupCanvasOnShutdown ?? false}
                    onChange={(event) => onPatchGeneral({ autoCleanupCanvasOnShutdown: event.target.checked })}
                  />
                  {t({ ko: '종료 시 캔버스 임시 데이터를 자동 정리', en: 'Automatically clean up temporary canvas data on exit' })}
                </SettingsToggleRow>

                <SettingsInsetBlock className="md:col-span-2">
                  <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {t({ ko: '상단 네비 표시', en: 'Header navigation' })}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {HEADER_NAVIGATION_OPTIONS.map((option) => (
                      <SettingsToggleRow key={option.key}>
                        <input
                          type="checkbox"
                          checked={(generalDraft.headerNavigation ?? DEFAULT_HEADER_NAVIGATION_SETTINGS)[option.key] ?? true}
                          onChange={(event) => updateHeaderNavigationItem(option.key, event.target.checked)}
                        />
                        {t(option.label)}
                      </SettingsToggleRow>
                    ))}
                  </div>
                </SettingsInsetBlock>
              </>
            ) : (
              <Skeleton className="h-56 w-full rounded-sm md:col-span-2" />
            )}
          </div>
        </SettingsSection>
      </section>

      <SettingsSection
        heading={t({ ko: '데이터 재매칭', en: 'Data rematch' })}
        actions={(
          <Button
            size="sm"
            variant={dataRematchOptions.hash ? 'destructive' : 'secondary'}
            onClick={startDataRematch}
            disabled={isDataRematchBusy || !hasSelectedDataRematchOption || (dataRematchOptions.hash && !hashConfirmed)}
          >
            {isDataRematchBusy ? <RotateCw className="h-4 w-4 animate-spin" /> : <DatabaseZap className="h-4 w-4" />}
            {isDataRematchBusy ? t({ ko: '진행 중', en: 'Running' }) : t({ ko: '실행', en: 'Run' })}
          </Button>
        )}
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.82fr)]">
          <div className="space-y-3">
            <SettingsToggleRow>
              <input
                type="checkbox"
                checked={dataRematchOptions.thumbnail}
                disabled={isDataRematchBusy || dataRematchOptions.hash}
                onChange={(event) => updateDataRematchOption('thumbnail', event.target.checked)}
              />
              {t({ ko: '썸네일 재생성', en: 'Regenerate thumbnails' })}
            </SettingsToggleRow>

            <SettingsToggleRow>
              <input
                type="checkbox"
                checked={dataRematchOptions.metadata}
                disabled={isDataRematchBusy || dataRematchOptions.hash}
                onChange={(event) => updateDataRematchOption('metadata', event.target.checked)}
              />
              {t({ ko: '메타데이터 재추출', en: 'Re-extract metadata' })}
            </SettingsToggleRow>

            <SettingsToggleRow>
              <input
                type="checkbox"
                checked={dataRematchOptions.hash}
                disabled={isDataRematchBusy}
                onChange={(event) => updateDataRematchOption('hash', event.target.checked)}
              />
              {t({ ko: '해시 재생성', en: 'Regenerate hashes' })}
            </SettingsToggleRow>

            {dataRematchOptions.hash ? (
              <SettingsInsetBlock className="border-[#BA1A1A]/50 bg-[#410002]/25 text-sm text-[#FFDAD6]">
                <div className="flex gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="space-y-2">
                    <p>{t({ ko: '해시 재생성은 composite_hash를 다시 계산하고 DB 참조를 리매칭해.', en: 'Hash regeneration recalculates composite_hash and rematches DB references.' })}</p>
                    <p>{t({ ko: '기존 그룹, 자동 폴더 그룹, 모델, 임시 URL, 생성 히스토리 연결은 새 해시에 복사하지 않고 해제해.', en: 'Existing group, auto-folder group, model, temp URL, and generation-history links are detached instead of copied to the new hash.' })}</p>
                    <p>{t({ ko: '이미지/GIF만 처리하고 비디오는 제외. 작업 중 자동 스캔, 백그라운드 해시 생성, 자동 태그/작가 추출은 대기해.', en: 'Only images/GIFs are processed; videos are excluded. Auto scan, background hashing, auto tag/artist extraction wait during the job.' })}</p>
                    <p>{t({ ko: '자동 태그/작가 추출은 여기서 실행하지 않음. 완료 후 시스템이 DB를 확인해 순차 처리해.', en: 'Auto tag/artist extraction is not run here. After completion, the system checks DB state and processes it sequentially.' })}</p>
                    <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em]">
                      <input
                        type="checkbox"
                        checked={hashConfirmed}
                        disabled={isDataRematchBusy}
                        onChange={(event) => setHashConfirmed(event.target.checked)}
                      />
                      {t({ ko: '위험 작업 확인', en: 'Confirm risky job' })}
                    </label>
                  </div>
                </div>
              </SettingsInsetBlock>
            ) : null}
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <SettingsValueTile label={t({ ko: '상태', en: 'Status' })} value={getPhaseLabel(status, language)} />
              <SettingsValueTile
                label={t({ ko: '진행', en: 'Progress' })}
                value={status ? `${formatCount(status.processed)} / ${formatCount(status.total)}` : '-'}
              />
              <SettingsValueTile label={t({ ko: '큐', en: 'Queued' })} value={formatCount(status?.queued ?? 0)} />
              <SettingsValueTile
                label={t({ ko: '오류/제외', en: 'Errors/skipped' })}
                value={`${formatCount(status?.failed ?? 0)} / ${formatCount(status?.skipped ?? 0)}`}
              />
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-surface-low">
              <div
                className={cn('h-full rounded-full transition-all', status?.status === 'failed' ? 'bg-destructive' : 'bg-primary')}
                style={{ width: `${Math.min(100, Math.max(0, dataRematchProgress))}%` }}
              />
            </div>

            {status?.currentFile ? (
              <div className="truncate text-xs text-muted-foreground" title={status.currentFile}>{status.currentFile}</div>
            ) : null}

            {status?.maintenanceLock.active ? (
              <SettingsInsetBlock className="text-xs text-muted-foreground">
                {status.maintenanceLock.message ?? t({ ko: '시스템 유지보수 잠금 활성', en: 'System maintenance lock active' })}
              </SettingsInsetBlock>
            ) : null}

            {latestErrors.length > 0 ? (
              <SettingsInsetBlock className="space-y-1 text-xs text-[#FFDAD6] border-[#BA1A1A]/40 bg-[#410002]/20">
                {latestErrors.map((error) => (
                  <div key={`${error.target}-${error.error}`} className="truncate" title={`${error.target}: ${error.error}`}>
                    {error.target}: {error.error}
                  </div>
                ))}
              </SettingsInsetBlock>
            ) : null}
          </div>
        </div>
      </SettingsSection>
    </div>
  )
}

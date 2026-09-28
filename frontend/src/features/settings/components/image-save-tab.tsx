import type { ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { CodexIcon, NovelAIIcon } from '@/components/common/provider-icons'
import { ToggleChip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { RowGroup } from '@/components/ui/row-group'
import { Select } from '@/components/ui/select'
import { SettingRow } from '@/components/ui/setting-row'
import type { GenerationThrottleSettings, ImageSaveSettings, ThumbnailSettings, VideoOptimizationSettings } from '@conai/shared'
import { useI18n } from '@/i18n'
import { VideoOptimizationTab } from './video-optimization-tab'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SectionDirtyBadge } from './settings-section-status'
import { SettingsSwitchRow } from './settings-switch-row'
import { SettingsLabelTip } from './settings-label-tip'
import { SETTINGS_CONTROL_CLASS, SettingsRowsSkeleton } from './settings-rows'

const IMAGE_SAVE_SIZE_PRESETS = [
  { label: '720p', width: 1280, height: 720 },
  { label: '1080p', width: 1920, height: 1080 },
  { label: '1440p', width: 2560, height: 1440 },
  { label: '4K', width: 3840, height: 2160 },
] as const

const DEFAULT_GENERATION_THROTTLE_SETTINGS: GenerationThrottleSettings = {
  novelai: {
    maxConcurrentJobs: 1,
    scheduleWindowMinutes: 1,
    scheduleJobCount: 20,
    scheduleMode: 'even',
    minStartIntervalSeconds: 1,
  },
  codex: {
    maxConcurrentJobs: 3,
    scheduleWindowMinutes: 3,
    scheduleJobCount: 3,
    scheduleMode: 'even',
    minStartIntervalSeconds: 1,
  },
  reservations: {
    maxConcurrentJobs: 3,
    userQueuePolicy: 'continue_limited',
  },
}

type GenerationThrottleDraftPatch = {
  novelai?: Partial<GenerationThrottleSettings['novelai']>
  codex?: Partial<GenerationThrottleSettings['codex']>
  reservations?: Partial<GenerationThrottleSettings['reservations']>
}

interface ImageSaveTabProps {
  showGenerationThrottle?: boolean
  showMediaSettings?: boolean
  imageSaveDraft: ImageSaveSettings | null
  onPatchImageSave: (patch: Partial<ImageSaveSettings>) => void
  hasImageSaveChanges: boolean
  thumbnailDraft: ThumbnailSettings | null
  onPatchThumbnail: (patch: Partial<ThumbnailSettings>) => void
  hasThumbnailChanges: boolean
  generationThrottleDraft: GenerationThrottleSettings | null
  onPatchGenerationThrottle: (patch: GenerationThrottleDraftPatch) => void
  hasGenerationThrottleChanges: boolean
  videoOptimizationDraft: VideoOptimizationSettings | null
  onPatchVideoOptimization: (patch: Partial<VideoOptimizationSettings>) => void
  hasVideoOptimizationChanges: boolean
}

type Translate = ReturnType<typeof useI18n>['t']

/** Rows of one provider's pacing (concurrency, window, count, distribution, min gap). */
function ProviderPacingRows({
  value,
  maxConcurrent,
  onPatch,
  t,
}: {
  value: GenerationThrottleSettings['novelai']
  maxConcurrent: number
  onPatch: (patch: Partial<GenerationThrottleSettings['novelai']>) => void
  t: Translate
}) {
  const labels = {
    concurrent: t({ ko: '동시 실행 수', en: 'Concurrent jobs' }),
    window: t({ ko: '기간(분)', en: 'Window (minutes)' }),
    count: t({ ko: '생성횟수', en: 'Job count' }),
    mode: t({ ko: '분배', en: 'Distribution' }),
    gap: t({ ko: '최소 간격(초)', en: 'Min gap (seconds)' }),
  }

  return (
    <>
      <SettingRow label={labels.concurrent} controlClassName={SETTINGS_CONTROL_CLASS}>
        <NumberStepperInput min={1} max={maxConcurrent} variant="settings" aria-label={labels.concurrent} value={value.maxConcurrentJobs} onValueCommit={(nextValue) => onPatch({ maxConcurrentJobs: Number(nextValue) || 1 })} />
      </SettingRow>
      <SettingRow label={labels.window} controlClassName={SETTINGS_CONTROL_CLASS}>
        <NumberStepperInput min={1} max={1440} variant="settings" aria-label={labels.window} value={value.scheduleWindowMinutes} onValueCommit={(nextValue) => onPatch({ scheduleWindowMinutes: Number(nextValue) || 1 })} />
      </SettingRow>
      <SettingRow label={labels.count} controlClassName={SETTINGS_CONTROL_CLASS}>
        <NumberStepperInput min={1} max={10000} variant="settings" aria-label={labels.count} value={value.scheduleJobCount} onValueCommit={(nextValue) => onPatch({ scheduleJobCount: Number(nextValue) || 1 })} />
      </SettingRow>
      <SettingRow label={labels.mode} controlClassName={SETTINGS_CONTROL_CLASS}>
        <Select
          variant="settings"
          aria-label={labels.mode}
          value={value.scheduleMode}
          onChange={(event) => onPatch({ scheduleMode: event.target.value as GenerationThrottleSettings['novelai']['scheduleMode'] })}
        >
          <option value="even">{t({ ko: '균등', en: 'Even' })}</option>
          <option value="random">{t({ ko: '비균등', en: 'Random' })}</option>
        </Select>
      </SettingRow>
      <SettingRow label={labels.gap} controlClassName={SETTINGS_CONTROL_CLASS}>
        <NumberStepperInput min={0} max={3600} variant="settings" aria-label={labels.gap} value={value.minStartIntervalSeconds} onValueCommit={(nextValue) => onPatch({ minStartIntervalSeconds: Number(nextValue) || 0 })} />
      </SettingRow>
    </>
  )
}

function ProviderHeading({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      {icon}
      {children}
    </span>
  )
}

/** Render generation pacing and media-processing sections for settings composition. */
export function ImageSaveTab({
  showGenerationThrottle = true,
  showMediaSettings = true,
  imageSaveDraft,
  onPatchImageSave,
  hasImageSaveChanges,
  thumbnailDraft,
  onPatchThumbnail,
  hasThumbnailChanges,
  generationThrottleDraft,
  onPatchGenerationThrottle,
  hasGenerationThrottleChanges,
  videoOptimizationDraft,
  onPatchVideoOptimization,
  hasVideoOptimizationChanges,
}: ImageSaveTabProps) {
  const { t } = useI18n()
  const labels = {
    reservationConcurrency: t({ ko: '예약 동시 실행 수', en: 'Reservation concurrency' }),
    userQueuePolicy: t({ ko: '사용자 대기열이 있을 때', en: 'When a user queue exists' }),
    format: t({ ko: '기본 포맷', en: 'Default format' }),
    quality: t({ ko: '품질', en: 'Quality' }),
    maxWidth: t({ ko: '최대 가로', en: 'Max width' }),
    maxHeight: t({ ko: '최대 세로', en: 'Max height' }),
    applyMode: t({ ko: '적용 방식', en: 'Apply mode' }),
    thumbnailSize: t({ ko: '썸네일 크기', en: 'Thumbnail size' }),
    thumbnailQuality: t({ ko: '썸네일 품질', en: 'Thumbnail quality' }),
  }

  return (
    <div className="space-y-8">
      {showGenerationThrottle ? (
        generationThrottleDraft ? (
          <>
            <RowGroup
              heading={t({ ko: '예약 작업', en: 'Reservations' })}
              actions={(
                <>
                  <SectionDirtyBadge dirty={hasGenerationThrottleChanges} />
                  <IconButton
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => onPatchGenerationThrottle({ reservations: DEFAULT_GENERATION_THROTTLE_SETTINGS.reservations })}
                    label={t({ ko: '예약작업 실행 정책 초기값으로 되돌리기', en: 'Restore reservation policy defaults' })}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </IconButton>
                </>
              )}
            >
              <SettingRow label={labels.reservationConcurrency} controlClassName={SETTINGS_CONTROL_CLASS}>
                <NumberStepperInput min={1} max={12} variant="settings" aria-label={labels.reservationConcurrency} value={generationThrottleDraft.reservations.maxConcurrentJobs} onValueCommit={(nextValue) => onPatchGenerationThrottle({ reservations: { maxConcurrentJobs: Number(nextValue) || 1 } })} />
              </SettingRow>
              <SettingRow label={labels.userQueuePolicy} controlClassName={SETTINGS_CONTROL_CLASS}>
                <Select
                  variant="settings"
                  aria-label={labels.userQueuePolicy}
                  value={generationThrottleDraft.reservations.userQueuePolicy}
                  onChange={(event) => onPatchGenerationThrottle({ reservations: { userQueuePolicy: event.target.value as GenerationThrottleSettings['reservations']['userQueuePolicy'] } })}
                >
                  <option value="continue_limited">{t({ ko: '예약은 1개만 계속', en: 'Keep only 1 reservation running' })}</option>
                  <option value="hold_until_empty">{t({ ko: '새 예약 시작 보류', en: 'Hold new reservations until empty' })}</option>
                </Select>
              </SettingRow>
            </RowGroup>

            <RowGroup
              heading={<ProviderHeading icon={<NovelAIIcon className="size-4" />}>{t({ ko: 'NovelAI 생성 텀', en: 'NovelAI pacing' })}</ProviderHeading>}
              actions={(
                <IconButton
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => onPatchGenerationThrottle({ novelai: DEFAULT_GENERATION_THROTTLE_SETTINGS.novelai })}
                  label={t({ ko: 'NovelAI 생성 텀 초기값으로 되돌리기', en: 'Restore NovelAI pacing defaults' })}
                >
                  <RefreshCw className="h-4 w-4" />
                </IconButton>
              )}
            >
              <ProviderPacingRows value={generationThrottleDraft.novelai} maxConcurrent={8} onPatch={(patch) => onPatchGenerationThrottle({ novelai: patch })} t={t} />
            </RowGroup>

            <RowGroup
              heading={<ProviderHeading icon={<CodexIcon className="size-4" />}>{t({ ko: 'Codex 생성 텀', en: 'Codex pacing' })}</ProviderHeading>}
              actions={(
                <IconButton
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => onPatchGenerationThrottle({ codex: DEFAULT_GENERATION_THROTTLE_SETTINGS.codex })}
                  label={t({ ko: 'Codex 생성 텀 초기값으로 되돌리기', en: 'Restore Codex pacing defaults' })}
                >
                  <RefreshCw className="h-4 w-4" />
                </IconButton>
              )}
            >
              <ProviderPacingRows value={generationThrottleDraft.codex} maxConcurrent={8} onPatch={(patch) => onPatchGenerationThrottle({ codex: patch })} t={t} />
            </RowGroup>
          </>
        ) : (
          <RowGroup heading={t({ ko: '예약 작업', en: 'Reservations' })}>
            <SettingsRowsSkeleton rows={4} />
          </RowGroup>
        )
      ) : null}

      {showMediaSettings ? (
        <>
          <RowGroup heading={t({ ko: '이미지 저장', en: 'Image saving' })} actions={<SectionDirtyBadge dirty={hasImageSaveChanges} />}>
            {imageSaveDraft ? (
              <>
                <SettingRow label={labels.format} controlClassName={SETTINGS_CONTROL_CLASS}>
                  <Select
                    variant="settings"
                    aria-label={labels.format}
                    value={imageSaveDraft.defaultFormat}
                    onChange={(event) => onPatchImageSave({ defaultFormat: event.target.value as ImageSaveSettings['defaultFormat'] })}
                  >
                    <option value="original">{t({ ko: '원본 유지', en: 'Keep original' })}</option>
                    <option value="png">PNG</option>
                    <option value="jpeg">JPEG</option>
                    <option value="webp">WebP</option>
                  </Select>
                </SettingRow>

                <SettingRow label={labels.quality} controlClassName={SETTINGS_CONTROL_CLASS}>
                  <NumberStepperInput min={1} max={100} variant="settings" aria-label={labels.quality} value={imageSaveDraft.quality} onValueCommit={(nextValue) => onPatchImageSave({ quality: Number(nextValue) || 1 })} />
                </SettingRow>

                <SettingsSwitchRow
                  checked={imageSaveDraft.resizeEnabled}
                  onCheckedChange={(checked) => onPatchImageSave({ resizeEnabled: checked })}
                  label={t({ ko: '저장 전에 크기 조정', en: 'Resize before saving' })}
                />

                <SettingRow label={t({ ko: '크기 프리셋', en: 'Size presets' })} controlClassName="justify-start sm:justify-end">
                  {IMAGE_SAVE_SIZE_PRESETS.map((preset) => (
                    <ToggleChip
                      key={preset.label}
                      pressed={imageSaveDraft.resizeEnabled && imageSaveDraft.maxWidth === preset.width && imageSaveDraft.maxHeight === preset.height}
                      onClick={() => onPatchImageSave({ maxWidth: preset.width, maxHeight: preset.height, resizeEnabled: true })}
                    >
                      {preset.label}
                    </ToggleChip>
                  ))}
                </SettingRow>

                <SettingRow label={labels.maxWidth} controlClassName={SETTINGS_CONTROL_CLASS}>
                  <NumberStepperInput min={64} max={16384} variant="settings" aria-label={labels.maxWidth} disabled={!imageSaveDraft.resizeEnabled} value={imageSaveDraft.maxWidth} onValueCommit={(nextValue) => onPatchImageSave({ maxWidth: Number(nextValue) || 64 })} />
                </SettingRow>

                <SettingRow label={labels.maxHeight} controlClassName={SETTINGS_CONTROL_CLASS}>
                  <NumberStepperInput min={64} max={16384} variant="settings" aria-label={labels.maxHeight} disabled={!imageSaveDraft.resizeEnabled} value={imageSaveDraft.maxHeight} onValueCommit={(nextValue) => onPatchImageSave({ maxHeight: Number(nextValue) || 64 })} />
                </SettingRow>

                <SettingRow label={labels.applyMode} controlClassName={SETTINGS_CONTROL_CLASS}>
                  <Select
                    variant="settings"
                    aria-label={labels.applyMode}
                    value={imageSaveDraft.alwaysShowDialog ? 'dialog' : 'auto'}
                    onChange={(event) => onPatchImageSave({ alwaysShowDialog: event.target.value === 'dialog' })}
                  >
                    <option value="auto">{t({ ko: '설정값 자동 적용', en: 'Apply settings automatically' })}</option>
                    <option value="dialog">{t({ ko: '매번 팝업으로 확인', en: 'Confirm with a dialog every time' })}</option>
                  </Select>
                </SettingRow>

                <SettingsSwitchRow
                  checked={imageSaveDraft.applyToGenerationAttachments}
                  onCheckedChange={(checked) => onPatchImageSave({ applyToGenerationAttachments: checked })}
                  label={t({ ko: '생성 첨부에 적용', en: 'Apply to generation attachments' })}
                />
                <SettingsSwitchRow
                  checked={imageSaveDraft.applyToEditorSave}
                  onCheckedChange={(checked) => onPatchImageSave({ applyToEditorSave: checked })}
                  label={t({ ko: '에디터 저장에 적용', en: 'Apply to editor saves' })}
                />
                <SettingsSwitchRow
                  checked={imageSaveDraft.applyToCanvasSave}
                  onCheckedChange={(checked) => onPatchImageSave({ applyToCanvasSave: checked })}
                  label={t({ ko: '캔버스 저장에 적용', en: 'Apply to canvas saves' })}
                />
                <SettingsSwitchRow
                  checked={imageSaveDraft.applyToUpload}
                  onCheckedChange={(checked) => onPatchImageSave({ applyToUpload: checked })}
                  label={t({ ko: '업로드에 적용', en: 'Apply to uploads' })}
                />
                <SettingsSwitchRow
                  checked={imageSaveDraft.applyToWorkflowOutputs}
                  onCheckedChange={(checked) => onPatchImageSave({ applyToWorkflowOutputs: checked })}
                  label={t({ ko: '워크플로 출력에 적용', en: 'Apply to workflow outputs' })}
                />
              </>
            ) : (
              <SettingsRowsSkeleton rows={5} />
            )}
          </RowGroup>

          <RowGroup heading={t({ ko: '썸네일', en: 'Thumbnail' })} actions={<SectionDirtyBadge dirty={hasThumbnailChanges} />}>
            {thumbnailDraft ? (
              <>
                <SettingRow label={labels.thumbnailSize} controlClassName={SETTINGS_CONTROL_CLASS}>
                  <Select
                    variant="settings"
                    aria-label={labels.thumbnailSize}
                    value={thumbnailDraft.size}
                    onChange={(event) => onPatchThumbnail({ size: event.target.value as ThumbnailSettings['size'] })}
                  >
                    <option value="original">{t({ ko: '원본', en: 'Original' })}</option>
                    <option value="2048">2048px</option>
                    <option value="1080">1080px</option>
                    <option value="720">720px</option>
                    <option value="512">512px</option>
                  </Select>
                </SettingRow>

                <SettingRow
                  label={<SettingsLabelTip label={labels.thumbnailQuality} tip={t({ ko: '기존 썸네일은 재생성 필요. 유지보수 탭의 데이터 재매칭에서 새 품질로 다시 만들 수 있어.', en: 'Existing thumbnails need regeneration. Rebuild them from Data rematch in the Maintenance tab.' })} />}
                  controlClassName={SETTINGS_CONTROL_CLASS}
                >
                  <NumberStepperInput min={60} max={100} variant="settings" aria-label={labels.thumbnailQuality} value={thumbnailDraft.quality} onValueCommit={(nextValue) => onPatchThumbnail({ quality: Number(nextValue) || 60 })} />
                </SettingRow>
              </>
            ) : (
              <SettingsRowsSkeleton rows={2} />
            )}
          </RowGroup>

          <VideoOptimizationTab
            videoOptimizationDraft={videoOptimizationDraft}
            onPatchVideoOptimization={onPatchVideoOptimization}
            hasChanges={hasVideoOptimizationChanges}
          />
        </>
      ) : null}
    </div>
  )
}

import { RefreshCw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { GenerationThrottleSettings, ImageSaveSettings, ThumbnailSettings, VideoOptimizationSettings } from '@/types/settings'
import { useI18n } from '@/i18n'
import { SettingsField, SettingsSection, SettingsToggleRow } from './settings-primitives'
import { VideoOptimizationTab } from './video-optimization-tab'

const IMAGE_SAVE_SIZE_PRESETS = [
  { label: '720p', width: 1280, height: 720 },
  { label: '1080p', width: 1920, height: 1080 },
  { label: '1440p', width: 2560, height: 1440 },
  { label: '4K', width: 3840, height: 2160 },
] as const

const DEFAULT_GENERATION_THROTTLE_SETTINGS: GenerationThrottleSettings = {
  novelai: {
    maxConcurrentJobs: 1,
    cooldownAfterCompletions: 1,
    cooldownSeconds: 3,
  },
  codex: {
    maxConcurrentJobs: 3,
    cooldownAfterCompletions: 3,
    cooldownSeconds: 60,
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
  imageSaveDraft: ImageSaveSettings | null
  onPatchImageSave: (patch: Partial<ImageSaveSettings>) => void
  onSave: () => void
  isSaving: boolean
  hasImageSaveChanges: boolean
  thumbnailDraft: ThumbnailSettings | null
  onPatchThumbnail: (patch: Partial<ThumbnailSettings>) => void
  onSaveThumbnail: () => void
  isSavingThumbnail: boolean
  hasThumbnailChanges: boolean
  generationThrottleDraft: GenerationThrottleSettings | null
  onPatchGenerationThrottle: (patch: GenerationThrottleDraftPatch) => void
  onSaveGenerationThrottle: () => void
  isSavingGenerationThrottle: boolean
  hasGenerationThrottleChanges: boolean
  videoOptimizationDraft: VideoOptimizationSettings | null
  onPatchVideoOptimization: (patch: Partial<VideoOptimizationSettings>) => void
  onSaveVideoOptimization: () => void
  isSavingVideoOptimization: boolean
  hasVideoOptimizationChanges: boolean
}

/** Render media save defaults used by save dialogs and attachment flows. */
export function ImageSaveTab({
  imageSaveDraft,
  onPatchImageSave,
  onSave,
  isSaving,
  hasImageSaveChanges,
  thumbnailDraft,
  onPatchThumbnail,
  onSaveThumbnail,
  isSavingThumbnail,
  hasThumbnailChanges,
  generationThrottleDraft,
  onPatchGenerationThrottle,
  onSaveGenerationThrottle,
  isSavingGenerationThrottle,
  hasGenerationThrottleChanges,
  videoOptimizationDraft,
  onPatchVideoOptimization,
  onSaveVideoOptimization,
  isSavingVideoOptimization,
  hasVideoOptimizationChanges,
}: ImageSaveTabProps) {
  const { t } = useI18n()

  return (
    <div className="space-y-6">
      <section>
        <SettingsSection
          heading={t({ ko: '생성 텀 / 쓰로틀', en: 'Generation pacing / throttle' })}
          actions={
            <Button
              size="icon-sm"
              onClick={onSaveGenerationThrottle}
              disabled={!generationThrottleDraft || isSavingGenerationThrottle || !hasGenerationThrottleChanges}
              aria-label={hasGenerationThrottleChanges ? t({ ko: '생성 텀 설정 저장', en: 'Save generation throttle settings' }) : t({ ko: '생성 텀 설정 변경 없음', en: 'No generation throttle changes' })}
              title={hasGenerationThrottleChanges ? t({ ko: '생성 텀 설정 저장', en: 'Save generation throttle settings' }) : t({ ko: '저장할 변경 없음', en: 'No changes to save' })}
            >
              <Save className="h-4 w-4" />
            </Button>
          }
        >
          {generationThrottleDraft ? (
            <div className="space-y-5">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-base font-semibold text-foreground">{t({ ko: '예약작업', en: 'Reservations' })}</div>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => onPatchGenerationThrottle({ reservations: DEFAULT_GENERATION_THROTTLE_SETTINGS.reservations })}
                    aria-label={t({ ko: '예약작업 실행 정책 초기값으로 되돌리기', en: 'Restore reservation policy defaults' })}
                    title={t({ ko: '예약작업 초기값', en: 'Reservation defaults' })}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <SettingsField label={t({ ko: '예약 동시 실행 수', en: 'Reservation concurrency' })}>
                    <Input type="number" min={1} max={12} variant="settings" value={generationThrottleDraft.reservations.maxConcurrentJobs} onChange={(event) => onPatchGenerationThrottle({ reservations: { maxConcurrentJobs: Number(event.target.value) || 1 } })} />
                  </SettingsField>
                  <SettingsField label={t({ ko: '사용자 대기열이 있을 때', en: 'When a user queue exists' })}>
                    <Select
                      variant="settings"
                      value={generationThrottleDraft.reservations.userQueuePolicy}
                      onChange={(event) => onPatchGenerationThrottle({ reservations: { userQueuePolicy: event.target.value as GenerationThrottleSettings['reservations']['userQueuePolicy'] } })}
                    >
                      <option value="continue_limited">{t({ ko: '예약은 1개만 계속', en: 'Keep only 1 reservation running' })}</option>
                      <option value="hold_until_empty">{t({ ko: '새 예약 시작 보류', en: 'Hold new reservations until empty' })}</option>
                    </Select>
                  </SettingsField>
                </div>
              </div>

              <div className="px-3 py-1">
                <div className="h-px bg-border/70" />
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-base font-semibold text-foreground">NovelAI</div>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => onPatchGenerationThrottle({ novelai: DEFAULT_GENERATION_THROTTLE_SETTINGS.novelai })}
                    aria-label={t({ ko: 'NovelAI 생성 텀 초기값으로 되돌리기', en: 'Restore NovelAI pacing defaults' })}
                    title={t({ ko: 'NovelAI 초기값', en: 'NovelAI defaults' })}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <SettingsField label={t({ ko: '동시 실행 수', en: 'Concurrent jobs' })}>
                    <Input type="number" min={1} max={8} variant="settings" value={generationThrottleDraft.novelai.maxConcurrentJobs} onChange={(event) => onPatchGenerationThrottle({ novelai: { maxConcurrentJobs: Number(event.target.value) || 1 } })} />
                  </SettingsField>
                  <SettingsField label={t({ ko: '몇 건마다 쉬기', en: 'Pause after every N jobs' })}>
                    <Input type="number" min={1} max={50} variant="settings" value={generationThrottleDraft.novelai.cooldownAfterCompletions} onChange={(event) => onPatchGenerationThrottle({ novelai: { cooldownAfterCompletions: Number(event.target.value) || 1 } })} />
                  </SettingsField>
                  <SettingsField label={t({ ko: '휴식 시간(초)', en: 'Cooldown (seconds)' })}>
                    <Input type="number" min={0} max={3600} variant="settings" value={generationThrottleDraft.novelai.cooldownSeconds} onChange={(event) => onPatchGenerationThrottle({ novelai: { cooldownSeconds: Number(event.target.value) || 0 } })} />
                  </SettingsField>
                </div>
              </div>

              <div className="px-3 py-1">
                <div className="h-px bg-border/70" />
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-base font-semibold text-foreground">Codex</div>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => onPatchGenerationThrottle({ codex: DEFAULT_GENERATION_THROTTLE_SETTINGS.codex })}
                    aria-label={t({ ko: 'Codex 생성 텀 초기값으로 되돌리기', en: 'Restore Codex pacing defaults' })}
                    title={t({ ko: 'Codex 초기값', en: 'Codex defaults' })}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <SettingsField label={t({ ko: '동시 실행 수', en: 'Concurrent jobs' })}>
                    <Input type="number" min={1} max={8} variant="settings" value={generationThrottleDraft.codex.maxConcurrentJobs} onChange={(event) => onPatchGenerationThrottle({ codex: { maxConcurrentJobs: Number(event.target.value) || 1 } })} />
                  </SettingsField>
                  <SettingsField label={t({ ko: '몇 건마다 쉬기', en: 'Pause after every N jobs' })}>
                    <Input type="number" min={1} max={50} variant="settings" value={generationThrottleDraft.codex.cooldownAfterCompletions} onChange={(event) => onPatchGenerationThrottle({ codex: { cooldownAfterCompletions: Number(event.target.value) || 1 } })} />
                  </SettingsField>
                  <SettingsField label={t({ ko: '휴식 시간(초)', en: 'Cooldown (seconds)' })}>
                    <Input type="number" min={0} max={3600} variant="settings" value={generationThrottleDraft.codex.cooldownSeconds} onChange={(event) => onPatchGenerationThrottle({ codex: { cooldownSeconds: Number(event.target.value) || 0 } })} />
                  </SettingsField>
                </div>
              </div>
            </div>
          ) : (
            <Skeleton className="h-72 w-full rounded-sm" />
          )}
        </SettingsSection>
      </section>

      <section>
        <SettingsSection
          heading={t({ ko: '이미지 저장', en: 'Image saving' })}
          actions={
            <Button
              size="icon-sm"
              onClick={onSave}
              disabled={!imageSaveDraft || isSaving || !hasImageSaveChanges}
              aria-label={hasImageSaveChanges ? t({ ko: '이미지 저장 설정 저장', en: 'Save image saving settings' }) : t({ ko: '이미지 저장 설정 변경 없음', en: 'No image saving settings changes' })}
              title={hasImageSaveChanges ? t({ ko: '이미지 저장 설정 저장', en: 'Save image saving settings' }) : t({ ko: '저장할 변경 없음', en: 'No changes to save' })}
            >
              <Save className="h-4 w-4" />
            </Button>
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            {imageSaveDraft ? (
              <>
                <SettingsField label={t({ ko: '기본 포맷', en: 'Default format' })}>
                  <Select
                    variant="settings"
                    value={imageSaveDraft.defaultFormat}
                    onChange={(event) => onPatchImageSave({ defaultFormat: event.target.value as ImageSaveSettings['defaultFormat'] })}
                  >
                    <option value="original">{t({ ko: '원본 유지', en: 'Keep original' })}</option>
                    <option value="png">PNG</option>
                    <option value="jpeg">JPEG</option>
                    <option value="webp">WebP</option>
                  </Select>
                </SettingsField>

                <SettingsField label={t({ ko: '품질', en: 'Quality' })}>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    variant="settings"
                    value={imageSaveDraft.quality}
                    onChange={(event) => onPatchImageSave({ quality: Number(event.target.value) || 1 })}
                  />
                </SettingsField>

                <SettingsToggleRow className="md:col-span-2">
                  <input
                    type="checkbox"
                    checked={imageSaveDraft.resizeEnabled}
                    onChange={(event) => onPatchImageSave({ resizeEnabled: event.target.checked })}
                  />
                  {t({ ko: '저장 전에 크기 조정', en: 'Resize before saving' })}
                </SettingsToggleRow>

                <SettingsField label={t({ ko: '크기 프리셋', en: 'Size presets' })}>
                  <div className="flex flex-wrap gap-2">
                    {IMAGE_SAVE_SIZE_PRESETS.map((preset) => (
                      <Button
                        key={preset.label}
                        type="button"
                        size="sm"
                        variant={imageSaveDraft.maxWidth === preset.width && imageSaveDraft.maxHeight === preset.height ? 'secondary' : 'outline'}
                        onClick={() => onPatchImageSave({ maxWidth: preset.width, maxHeight: preset.height, resizeEnabled: true })}
                      >
                        {preset.label}
                      </Button>
                    ))}
                  </div>
                </SettingsField>

                <SettingsField label={t({ ko: '최대 가로', en: 'Max width' })}>
                  <Input
                    type="number"
                    min={64}
                    max={16384}
                    variant="settings"
                    value={imageSaveDraft.maxWidth}
                    onChange={(event) => onPatchImageSave({ maxWidth: Number(event.target.value) || 64 })}
                  />
                </SettingsField>

                <SettingsField label={t({ ko: '최대 세로', en: 'Max height' })}>
                  <Input
                    type="number"
                    min={64}
                    max={16384}
                    variant="settings"
                    value={imageSaveDraft.maxHeight}
                    onChange={(event) => onPatchImageSave({ maxHeight: Number(event.target.value) || 64 })}
                  />
                </SettingsField>

                <SettingsField label={t({ ko: '적용 방식', en: 'Apply mode' })}>
                  <Select
                    variant="settings"
                    value={imageSaveDraft.alwaysShowDialog ? 'dialog' : 'auto'}
                    onChange={(event) => onPatchImageSave({ alwaysShowDialog: event.target.value === 'dialog' })}
                  >
                    <option value="auto">{t({ ko: '설정값 자동 적용', en: 'Apply settings automatically' })}</option>
                    <option value="dialog">{t({ ko: '매번 팝업으로 확인', en: 'Confirm with a dialog every time' })}</option>
                  </Select>
                </SettingsField>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={imageSaveDraft.applyToGenerationAttachments}
                    onChange={(event) => onPatchImageSave({ applyToGenerationAttachments: event.target.checked })}
                  />
                  {t({ ko: '생성 첨부에 적용', en: 'Apply to generation attachments' })}
                </SettingsToggleRow>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={imageSaveDraft.applyToEditorSave}
                    onChange={(event) => onPatchImageSave({ applyToEditorSave: event.target.checked })}
                  />
                  {t({ ko: '에디터 저장에 적용', en: 'Apply to editor saves' })}
                </SettingsToggleRow>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={imageSaveDraft.applyToCanvasSave}
                    onChange={(event) => onPatchImageSave({ applyToCanvasSave: event.target.checked })}
                  />
                  {t({ ko: '캔버스 저장에 적용', en: 'Apply to canvas saves' })}
                </SettingsToggleRow>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={imageSaveDraft.applyToUpload}
                    onChange={(event) => onPatchImageSave({ applyToUpload: event.target.checked })}
                  />
                  {t({ ko: '업로드에 적용', en: 'Apply to uploads' })}
                </SettingsToggleRow>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={imageSaveDraft.applyToWorkflowOutputs}
                    onChange={(event) => onPatchImageSave({ applyToWorkflowOutputs: event.target.checked })}
                  />
                  {t({ ko: '워크플로 출력에 적용', en: 'Apply to workflow outputs' })}
                </SettingsToggleRow>
              </>
            ) : (
              <Skeleton className="h-64 w-full rounded-sm md:col-span-2" />
            )}
          </div>
        </SettingsSection>
      </section>

      <section>
        <SettingsSection
          heading={t({ ko: '썸네일', en: 'Thumbnail' })}
          actions={
            <Button
              size="icon-sm"
              onClick={onSaveThumbnail}
              disabled={!thumbnailDraft || isSavingThumbnail || !hasThumbnailChanges}
              aria-label={hasThumbnailChanges ? t({ ko: '썸네일 설정 저장', en: 'Save thumbnail settings' }) : t({ ko: '썸네일 설정 변경 없음', en: 'No thumbnail settings changes' })}
              title={hasThumbnailChanges ? t({ ko: '썸네일 설정 저장', en: 'Save thumbnail settings' }) : t({ ko: '저장할 변경 없음', en: 'No changes to save' })}
            >
              <Save className="h-4 w-4" />
            </Button>
          }
        >
          {thumbnailDraft ? (
            <div className="grid gap-4 md:grid-cols-2">
              <SettingsField label={t({ ko: '썸네일 크기', en: 'Thumbnail size' })}>
                <Select
                  variant="settings"
                  value={thumbnailDraft.size}
                  onChange={(event) => onPatchThumbnail({ size: event.target.value as ThumbnailSettings['size'] })}
                >
                  <option value="original">{t({ ko: '원본', en: 'Original' })}</option>
                  <option value="2048">2048px</option>
                  <option value="1080">1080px</option>
                  <option value="720">720px</option>
                  <option value="512">512px</option>
                </Select>
              </SettingsField>

              <SettingsField label={t({ ko: '썸네일 품질', en: 'Thumbnail quality' })}>
                <Input
                  type="number"
                  min={60}
                  max={100}
                  variant="settings"
                  value={thumbnailDraft.quality}
                  onChange={(event) => onPatchThumbnail({ quality: Number(event.target.value) || 60 })}
                />
              </SettingsField>

              <p className="md:col-span-2 text-sm text-muted-foreground">
                {t({ ko: '기존 썸네일은 재생성 필요. 일반 탭의 썸네일 재생성을 실행하면 새 품질로 다시 만들어져.', en: 'Existing thumbnails need regeneration. Run thumbnail regeneration in the General tab to rebuild them with the new quality.' })}
              </p>
            </div>
          ) : (
            <Skeleton className="h-36 w-full rounded-sm" />
          )}
        </SettingsSection>
      </section>

      <VideoOptimizationTab
        videoOptimizationDraft={videoOptimizationDraft}
        onPatchVideoOptimization={onPatchVideoOptimization}
        onSave={onSaveVideoOptimization}
        isSaving={isSavingVideoOptimization}
        hasChanges={hasVideoOptimizationChanges}
      />
    </div>
  )
}

import { RefreshCw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { GenerationThrottleSettings, ImageSaveSettings, VideoOptimizationSettings } from '@/types/settings'
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
  generationThrottleDraft: GenerationThrottleSettings | null
  onPatchGenerationThrottle: (patch: GenerationThrottleDraftPatch) => void
  onSaveGenerationThrottle: () => void
  isSavingGenerationThrottle: boolean
  videoOptimizationDraft: VideoOptimizationSettings | null
  onPatchVideoOptimization: (patch: Partial<VideoOptimizationSettings>) => void
  onSaveVideoOptimization: () => void
  isSavingVideoOptimization: boolean
}

/** Render media save defaults used by save dialogs and attachment flows. */
export function ImageSaveTab({
  imageSaveDraft,
  onPatchImageSave,
  onSave,
  isSaving,
  generationThrottleDraft,
  onPatchGenerationThrottle,
  onSaveGenerationThrottle,
  isSavingGenerationThrottle,
  videoOptimizationDraft,
  onPatchVideoOptimization,
  onSaveVideoOptimization,
  isSavingVideoOptimization,
}: ImageSaveTabProps) {
  return (
    <div className="space-y-6">
      <section>
        <SettingsSection
          heading="생성 텀 / 쓰로틀"
          actions={
            <Button
              size="icon-sm"
              onClick={onSaveGenerationThrottle}
              disabled={!generationThrottleDraft || isSavingGenerationThrottle}
              aria-label="생성 텀 설정 저장"
              title="생성 텀 설정 저장"
            >
              <Save className="h-4 w-4" />
            </Button>
          }
        >
          {generationThrottleDraft ? (
            <div className="space-y-5">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-base font-semibold text-foreground">예약작업</div>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => onPatchGenerationThrottle({ reservations: DEFAULT_GENERATION_THROTTLE_SETTINGS.reservations })}
                    aria-label="예약작업 실행 정책 초기값으로 되돌리기"
                    title="예약작업 초기값"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <SettingsField label="예약 동시 실행 수">
                    <Input type="number" min={1} max={12} variant="settings" value={generationThrottleDraft.reservations.maxConcurrentJobs} onChange={(event) => onPatchGenerationThrottle({ reservations: { maxConcurrentJobs: Number(event.target.value) || 1 } })} />
                  </SettingsField>
                  <SettingsField label="사용자 대기열이 있을 때">
                    <Select
                      variant="settings"
                      value={generationThrottleDraft.reservations.userQueuePolicy}
                      onChange={(event) => onPatchGenerationThrottle({ reservations: { userQueuePolicy: event.target.value as GenerationThrottleSettings['reservations']['userQueuePolicy'] } })}
                    >
                      <option value="continue_limited">예약은 1개만 계속</option>
                      <option value="hold_until_empty">새 예약 시작 보류</option>
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
                    aria-label="NovelAI 생성 텀 초기값으로 되돌리기"
                    title="NovelAI 초기값"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <SettingsField label="동시 실행 수">
                    <Input type="number" min={1} max={8} variant="settings" value={generationThrottleDraft.novelai.maxConcurrentJobs} onChange={(event) => onPatchGenerationThrottle({ novelai: { maxConcurrentJobs: Number(event.target.value) || 1 } })} />
                  </SettingsField>
                  <SettingsField label="몇 건마다 쉬기">
                    <Input type="number" min={1} max={50} variant="settings" value={generationThrottleDraft.novelai.cooldownAfterCompletions} onChange={(event) => onPatchGenerationThrottle({ novelai: { cooldownAfterCompletions: Number(event.target.value) || 1 } })} />
                  </SettingsField>
                  <SettingsField label="휴식 시간(초)">
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
                    aria-label="Codex 생성 텀 초기값으로 되돌리기"
                    title="Codex 초기값"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <SettingsField label="동시 실행 수">
                    <Input type="number" min={1} max={8} variant="settings" value={generationThrottleDraft.codex.maxConcurrentJobs} onChange={(event) => onPatchGenerationThrottle({ codex: { maxConcurrentJobs: Number(event.target.value) || 1 } })} />
                  </SettingsField>
                  <SettingsField label="몇 건마다 쉬기">
                    <Input type="number" min={1} max={50} variant="settings" value={generationThrottleDraft.codex.cooldownAfterCompletions} onChange={(event) => onPatchGenerationThrottle({ codex: { cooldownAfterCompletions: Number(event.target.value) || 1 } })} />
                  </SettingsField>
                  <SettingsField label="휴식 시간(초)">
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
          heading="이미지 저장"
          actions={
            <Button
              size="icon-sm"
              onClick={onSave}
              disabled={!imageSaveDraft || isSaving}
              aria-label="이미지 저장 설정 저장"
              title="이미지 저장 설정 저장"
            >
              <Save className="h-4 w-4" />
            </Button>
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            {imageSaveDraft ? (
              <>
                <SettingsField label="기본 포맷">
                  <Select
                    variant="settings"
                    value={imageSaveDraft.defaultFormat}
                    onChange={(event) => onPatchImageSave({ defaultFormat: event.target.value as ImageSaveSettings['defaultFormat'] })}
                  >
                    <option value="original">원본 유지</option>
                    <option value="png">PNG</option>
                    <option value="jpeg">JPEG</option>
                    <option value="webp">WebP</option>
                  </Select>
                </SettingsField>

                <SettingsField label="품질">
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
                  저장 전에 크기 조정
                </SettingsToggleRow>

                <SettingsField label="크기 프리셋">
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

                <SettingsField label="최대 가로">
                  <Input
                    type="number"
                    min={64}
                    max={16384}
                    variant="settings"
                    value={imageSaveDraft.maxWidth}
                    onChange={(event) => onPatchImageSave({ maxWidth: Number(event.target.value) || 64 })}
                  />
                </SettingsField>

                <SettingsField label="최대 세로">
                  <Input
                    type="number"
                    min={64}
                    max={16384}
                    variant="settings"
                    value={imageSaveDraft.maxHeight}
                    onChange={(event) => onPatchImageSave({ maxHeight: Number(event.target.value) || 64 })}
                  />
                </SettingsField>

                <SettingsField label="적용 방식">
                  <Select
                    variant="settings"
                    value={imageSaveDraft.alwaysShowDialog ? 'dialog' : 'auto'}
                    onChange={(event) => onPatchImageSave({ alwaysShowDialog: event.target.value === 'dialog' })}
                  >
                    <option value="auto">설정값 자동 적용</option>
                    <option value="dialog">매번 팝업으로 확인</option>
                  </Select>
                </SettingsField>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={imageSaveDraft.applyToGenerationAttachments}
                    onChange={(event) => onPatchImageSave({ applyToGenerationAttachments: event.target.checked })}
                  />
                  생성 첨부에 적용
                </SettingsToggleRow>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={imageSaveDraft.applyToEditorSave}
                    onChange={(event) => onPatchImageSave({ applyToEditorSave: event.target.checked })}
                  />
                  에디터 저장에 적용
                </SettingsToggleRow>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={imageSaveDraft.applyToCanvasSave}
                    onChange={(event) => onPatchImageSave({ applyToCanvasSave: event.target.checked })}
                  />
                  캔버스 저장에 적용
                </SettingsToggleRow>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={imageSaveDraft.applyToUpload}
                    onChange={(event) => onPatchImageSave({ applyToUpload: event.target.checked })}
                  />
                  업로드에 적용
                </SettingsToggleRow>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={imageSaveDraft.applyToWorkflowOutputs}
                    onChange={(event) => onPatchImageSave({ applyToWorkflowOutputs: event.target.checked })}
                  />
                  워크플로 출력에 적용
                </SettingsToggleRow>
              </>
            ) : (
              <Skeleton className="h-64 w-full rounded-sm md:col-span-2" />
            )}
          </div>
        </SettingsSection>
      </section>

      <VideoOptimizationTab
        videoOptimizationDraft={videoOptimizationDraft}
        onPatchVideoOptimization={onPatchVideoOptimization}
        onSave={onSaveVideoOptimization}
        isSaving={isSavingVideoOptimization}
      />
    </div>
  )
}

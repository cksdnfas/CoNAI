import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { Select } from '@/components/ui/select'
import { SettingsField } from '@/features/settings/components/settings-primitives'
import {
  WallpaperHoverInteractionEditorFields,
  WallpaperInspectorSectionCard,
  WallpaperMotionEasingEditorField,
  WallpaperTransitionAnimationEditorField,
  clampWallpaperInspectorNumber,
  type WallpaperWidgetSettingsPatchUpdater,
} from './wallpaper-widget-inspector-editor-shared'
import type { WallpaperWidgetInstance } from './wallpaper-types'
import { getWallpaperMotionStrengthMultiplier } from './wallpaper-widget-utils'

type WallpaperImageWidgetInstance = Extract<WallpaperWidgetInstance, { type: 'group-image-view' | 'image-showcase' | 'floating-collage' }>

interface WallpaperImageWidgetEditorFieldsProps {
  selectedWidget: WallpaperImageWidgetInstance
  updateWidgetSettings: WallpaperWidgetSettingsPatchUpdater
}

/** Render editor fields for image-driven widgets that share layout, motion, and interaction controls. */
export function WallpaperImageWidgetEditorFields({
  selectedWidget,
  updateWidgetSettings,
}: WallpaperImageWidgetEditorFieldsProps) {
  switch (selectedWidget.type) {
    case 'image-showcase': {
      const playbackMode = selectedWidget.settings.playbackMode ?? 'carousel'

      return (
        <>
          <WallpaperInspectorSectionCard title="레이아웃">
            <SettingsField label="채우기 방식">
              <Select
                value={selectedWidget.settings.fitMode}
                onChange={(event) => {
                  updateWidgetSettings({ fitMode: event.target.value === 'contain' ? 'contain' : 'cover' })
                }}
              >
                <option value="cover">채우기</option>
                <option value="contain">맞춤</option>
              </Select>
            </SettingsField>
          </WallpaperInspectorSectionCard>

          <WallpaperInspectorSectionCard title="재생">
            <SettingsField label="재생 방식">
              <Select
                value={playbackMode}
                onChange={(event) => {
                  updateWidgetSettings({
                    playbackMode: event.target.value === 'static'
                      ? 'static'
                      : event.target.value === 'ken-burns'
                        ? 'ken-burns'
                        : 'carousel',
                  })
                }}
              >
                <option value="carousel">캐러셀</option>
                <option value="ken-burns">켄 번즈</option>
                <option value="static">고정</option>
              </Select>
            </SettingsField>

            {playbackMode !== 'static' ? (
              <SettingsField label="간격">
                <Select
                  value={String(selectedWidget.settings.slideshowIntervalSec ?? 20)}
                  onChange={(event) => {
                    updateWidgetSettings({ slideshowIntervalSec: Number(event.target.value) })
                  }}
                >
                  {[5, 10, 15, 20, 30, 60].map((seconds) => (
                    <option key={seconds} value={seconds}>{seconds}s</option>
                  ))}
                </Select>
              </SettingsField>
            ) : null}
          </WallpaperInspectorSectionCard>

          {playbackMode !== 'static' ? (
            <WallpaperInspectorSectionCard title="전환">
              <WallpaperTransitionAnimationEditorField
                transitionStyle={selectedWidget.settings.imageTransitionStyle}
                transitionSpeed={selectedWidget.settings.imageTransitionSpeed}
                transitionDurationMs={selectedWidget.settings.imageTransitionDurationMs}
                transitionEasing={selectedWidget.settings.imageTransitionEasing}
                onTransitionStyleChange={(nextValue) => {
                  updateWidgetSettings({ imageTransitionStyle: nextValue })
                }}
                onTransitionDurationChange={(nextValue) => {
                  updateWidgetSettings({ imageTransitionDurationMs: nextValue })
                }}
                onTransitionEasingChange={(nextValue) => {
                  updateWidgetSettings({ imageTransitionEasing: nextValue })
                }}
              />
            </WallpaperInspectorSectionCard>
          ) : null}

          <WallpaperInspectorSectionCard title="상호작용">
            <WallpaperHoverInteractionEditorFields
              hoverMotion={selectedWidget.settings.imageHoverMotion}
              hoverEasing={selectedWidget.settings.hoverEasing}
              onHoverMotionChange={(nextValue) => {
                updateWidgetSettings({ imageHoverMotion: nextValue })
              }}
              onHoverEasingChange={(nextValue) => {
                updateWidgetSettings({ hoverEasing: nextValue })
              }}
            />
          </WallpaperInspectorSectionCard>
        </>
      )
    }

    case 'group-image-view':
      return (
        <>
          <WallpaperInspectorSectionCard title="레이아웃">
            <SettingsField label="표시 개수">
              <Select
                className="w-full"
                value={String(selectedWidget.settings.visibleCount)}
                onChange={(event) => {
                  updateWidgetSettings({ visibleCount: Number(event.target.value) })
                }}
              >
                {[1, 2, 4, 6, 9].map((count) => (
                  <option key={count} value={count}>{count}</option>
                ))}
              </Select>
            </SettingsField>
          </WallpaperInspectorSectionCard>

          <WallpaperInspectorSectionCard title="재생">
            <SettingsField label="교체 간격">
              <Select
                value={String(selectedWidget.settings.slideshowIntervalSec ?? 12)}
                onChange={(event) => {
                  updateWidgetSettings({ slideshowIntervalSec: Number(event.target.value) })
                }}
              >
                {[5, 8, 10, 12, 15, 20, 30, 60].map((seconds) => (
                  <option key={seconds} value={seconds}>{seconds}s</option>
                ))}
              </Select>
            </SettingsField>
          </WallpaperInspectorSectionCard>

          <WallpaperInspectorSectionCard title="모션">
            <SettingsField label="움직임">
              <Select
                value={selectedWidget.settings.motionMode ?? 'static'}
                onChange={(event) => {
                  updateWidgetSettings({
                    motionMode: event.target.value === 'pointer' ? 'pointer' : event.target.value === 'ambient' ? 'ambient' : 'static',
                  })
                }}
              >
                <option value="static">고정</option>
                <option value="ambient">앰비언트</option>
                <option value="pointer">반응형</option>
              </Select>
            </SettingsField>

            {(selectedWidget.settings.motionMode ?? 'static') !== 'static' ? (
              <WallpaperMotionEasingEditorField
                easing={selectedWidget.settings.motionEasing}
                fallbackPreset="easeOutCubic"
                motionStrength={selectedWidget.settings.motionStrength}
                editorContent={(
                  <div className="theme-settings-panel rounded-sm bg-surface-container p-3">
                    <div className="mb-2 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">모션 옵션</div>
                    <SettingsField label="강도">
                      <ScrubbableNumberInput
                        variant="settings"
                        min={0}
                        max={2.5}
                        step={0.1}
                        scrubRatio={0.45}
                        value={getWallpaperMotionStrengthMultiplier(selectedWidget.settings.motionStrength ?? 1)}
                        onChange={(nextValue) => {
                          updateWidgetSettings({
                            motionStrength: clampWallpaperInspectorNumber(nextValue, 1, 0, 2.5),
                          })
                        }}
                      />
                    </SettingsField>
                  </div>
                )}
                onEasingChange={(nextValue) => {
                  updateWidgetSettings({ motionEasing: nextValue })
                }}
              />
            ) : null}
          </WallpaperInspectorSectionCard>

          <WallpaperInspectorSectionCard title="전환">
            <WallpaperTransitionAnimationEditorField
              transitionStyle={selectedWidget.settings.imageTransitionStyle}
              transitionSpeed={selectedWidget.settings.imageTransitionSpeed}
              transitionDurationMs={selectedWidget.settings.imageTransitionDurationMs}
              transitionEasing={selectedWidget.settings.imageTransitionEasing}
              onTransitionStyleChange={(nextValue) => {
                updateWidgetSettings({ imageTransitionStyle: nextValue })
              }}
              onTransitionDurationChange={(nextValue) => {
                updateWidgetSettings({ imageTransitionDurationMs: nextValue })
              }}
              onTransitionEasingChange={(nextValue) => {
                updateWidgetSettings({ imageTransitionEasing: nextValue })
              }}
            />
          </WallpaperInspectorSectionCard>

          <WallpaperInspectorSectionCard title="상호작용">
            <WallpaperHoverInteractionEditorFields
              hoverMotion={selectedWidget.settings.imageHoverMotion}
              hoverEasing={selectedWidget.settings.hoverEasing}
              onHoverMotionChange={(nextValue) => {
                updateWidgetSettings({ imageHoverMotion: nextValue })
              }}
              onHoverEasingChange={(nextValue) => {
                updateWidgetSettings({ hoverEasing: nextValue })
              }}
            />
          </WallpaperInspectorSectionCard>
        </>
      )

    case 'floating-collage':
      return (
        <>
          <WallpaperInspectorSectionCard title="레이아웃">
            <SettingsField label="표시 개수">
              <Select
                className="w-full"
                value={String(selectedWidget.settings.visibleCount)}
                onChange={(event) => {
                  updateWidgetSettings({ visibleCount: Number(event.target.value) })
                }}
              >
                {[2, 3, 4, 5, 6].map((count) => (
                  <option key={count} value={count}>{count}</option>
                ))}
              </Select>
            </SettingsField>

            <SettingsField label="이미지 크기(%)">
              <ScrubbableNumberInput
                variant="settings"
                min={50}
                max={200}
                step={1}
                scrubRatio={0.35}
                value={selectedWidget.settings.imageScalePercent ?? 100}
                onChange={(nextValue) => {
                  const parsed = Number(nextValue)
                  updateWidgetSettings({
                    imageScalePercent: Number.isFinite(parsed) ? Math.min(200, Math.max(50, Math.round(parsed))) : 100,
                  })
                }}
              />
            </SettingsField>

            <SettingsField label="비율 기준">
              <Select
                value={selectedWidget.settings.aspectMode ?? 'image'}
                onChange={(event) => {
                  updateWidgetSettings({
                    aspectMode: event.target.value === 'slot' ? 'slot' : 'image',
                  })
                }}
              >
                <option value="image">이미지 비율</option>
                <option value="slot">슬롯 고정</option>
              </Select>
            </SettingsField>

            <SettingsField label="채우기 방식">
              <Select
                value={selectedWidget.settings.fitMode ?? 'cover'}
                onChange={(event) => {
                  updateWidgetSettings({
                    fitMode: event.target.value === 'contain' ? 'contain' : 'cover',
                  })
                }}
              >
                <option value="cover">채우기</option>
                <option value="contain">맞춤</option>
              </Select>
            </SettingsField>
          </WallpaperInspectorSectionCard>

          <WallpaperInspectorSectionCard title="모션">
            <WallpaperMotionEasingEditorField
              easing={selectedWidget.settings.motionEasing}
              fallbackPreset="linear"
              motionStrength={selectedWidget.settings.motionStrength}
              motionSpeed={selectedWidget.settings.motionSpeed}
              editorContent={(
                <div className="theme-settings-panel rounded-sm bg-surface-container p-3">
                  <div className="mb-2 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">모션 옵션</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SettingsField label="움직임 강도">
                      <ScrubbableNumberInput
                        variant="settings"
                        min={0}
                        max={2.5}
                        step={0.1}
                        scrubRatio={0.45}
                        value={getWallpaperMotionStrengthMultiplier(selectedWidget.settings.motionStrength ?? 1)}
                        onChange={(nextValue) => {
                          updateWidgetSettings({
                            motionStrength: clampWallpaperInspectorNumber(nextValue, 1, 0, 2.5),
                          })
                        }}
                      />
                    </SettingsField>
                    <SettingsField label="이동 속도">
                      <ScrubbableNumberInput
                        variant="settings"
                        min={0.2}
                        max={20}
                        step={0.1}
                        scrubRatio={0.45}
                        value={selectedWidget.settings.motionSpeed ?? 1}
                        onChange={(nextValue) => {
                          const parsed = Number(nextValue)
                          updateWidgetSettings({
                            motionSpeed: Number.isFinite(parsed) ? Math.min(20, Math.max(0.2, parsed)) : 1,
                          })
                        }}
                      />
                    </SettingsField>
                  </div>
                </div>
              )}
              onEasingChange={(nextValue) => {
                updateWidgetSettings({ motionEasing: nextValue })
              }}
            />
          </WallpaperInspectorSectionCard>

          <WallpaperInspectorSectionCard title="교체">
            <WallpaperTransitionAnimationEditorField
              label="교체 애니메이션"
              transitionStyle={selectedWidget.settings.imageTransitionStyle}
              transitionSpeed={undefined}
              transitionDurationMs={selectedWidget.settings.imageTransitionDurationMs}
              transitionEasing={selectedWidget.settings.imageTransitionEasing}
              onTransitionStyleChange={(nextValue) => {
                updateWidgetSettings({ imageTransitionStyle: nextValue })
              }}
              onTransitionDurationChange={(nextValue) => {
                updateWidgetSettings({ imageTransitionDurationMs: nextValue })
              }}
              onTransitionEasingChange={(nextValue) => {
                updateWidgetSettings({ imageTransitionEasing: nextValue })
              }}
              editorContent={(
                <div className="theme-settings-panel rounded-sm bg-surface-container p-3">
                  <div className="mb-2 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">교체 옵션</div>
                  <div className="space-y-3">
                    <SettingsField label="이미지 교체 기준">
                      <Select
                        value={selectedWidget.settings.imageSwapMode ?? 'bounce'}
                        onChange={(event) => {
                          updateWidgetSettings({
                            imageSwapMode: event.target.value === 'time' ? 'time' : 'bounce',
                          })
                        }}
                      >
                        <option value="bounce">튕김 횟수</option>
                        <option value="time">시간</option>
                      </Select>
                    </SettingsField>

                    {selectedWidget.settings.imageSwapMode === 'time' ? (
                      <SettingsField label="교체 간격(초)">
                        <ScrubbableNumberInput
                          variant="settings"
                          min={2}
                          max={60}
                          step={1}
                          scrubRatio={0.35}
                          value={selectedWidget.settings.swapIntervalSec ?? 12}
                          onChange={(nextValue) => {
                            const parsed = Number(nextValue)
                            updateWidgetSettings({
                              swapIntervalSec: Number.isFinite(parsed) ? Math.min(60, Math.max(2, Math.round(parsed))) : 12,
                            })
                          }}
                        />
                      </SettingsField>
                    ) : (
                      <SettingsField label="교체까지 튕김 수">
                        <ScrubbableNumberInput
                          variant="settings"
                          min={1}
                          max={12}
                          step={1}
                          scrubRatio={0.35}
                          value={selectedWidget.settings.swapBounceCount ?? 3}
                          onChange={(nextValue) => {
                            const parsed = Number(nextValue)
                            updateWidgetSettings({
                              swapBounceCount: Number.isFinite(parsed) ? Math.min(12, Math.max(1, Math.round(parsed))) : 3,
                            })
                          }}
                        />
                      </SettingsField>
                    )}
                  </div>
                </div>
              )}
            />
          </WallpaperInspectorSectionCard>

          <WallpaperInspectorSectionCard title="상호작용">
            <WallpaperHoverInteractionEditorFields
              hoverMotion={selectedWidget.settings.imageHoverMotion}
              hoverEasing={selectedWidget.settings.hoverEasing}
              onHoverMotionChange={(nextValue) => {
                updateWidgetSettings({ imageHoverMotion: nextValue })
              }}
              onHoverEasingChange={(nextValue) => {
                updateWidgetSettings({ hoverEasing: nextValue })
              }}
            />
          </WallpaperInspectorSectionCard>
        </>
      )

    default:
      return null
  }
}

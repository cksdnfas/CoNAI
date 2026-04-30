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
import { useI18n } from '@/i18n'

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
  const { t } = useI18n()

  switch (selectedWidget.type) {
    case 'image-showcase': {
      const playbackMode = selectedWidget.settings.playbackMode ?? 'carousel'

      return (
        <>
          <WallpaperInspectorSectionCard title={t({ ko: '레이아웃', en: 'Layout' })}>
            <SettingsField label={t({ ko: '채우기 방식', en: 'Fit mode' })}>
              <Select
                value={selectedWidget.settings.fitMode}
                onChange={(event) => {
                  updateWidgetSettings({ fitMode: event.target.value === 'contain' ? 'contain' : 'cover' })
                }}
              >
                <option value="cover">{t({ ko: '채우기', en: 'Cover' })}</option>
                <option value="contain">{t({ ko: '맞춤', en: 'Contain' })}</option>
              </Select>
            </SettingsField>
          </WallpaperInspectorSectionCard>

          <WallpaperInspectorSectionCard title={t({ ko: '재생', en: 'Playback' })}>
            <SettingsField label={t({ ko: '재생 방식', en: 'Playback mode' })}>
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
                <option value="carousel">{t({ ko: '캐러셀', en: 'Carousel' })}</option>
                <option value="ken-burns">{t({ ko: '켄 번즈', en: 'Ken Burns' })}</option>
                <option value="static">{t({ ko: '고정', en: 'Static' })}</option>
              </Select>
            </SettingsField>

            {playbackMode !== 'static' ? (
              <SettingsField label={t({ ko: '간격', en: 'Interval' })}>
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
            <WallpaperInspectorSectionCard title={t({ ko: '전환', en: 'Transition' })}>
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

          <WallpaperInspectorSectionCard title={t({ ko: '상호작용', en: 'Interaction' })}>
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
          <WallpaperInspectorSectionCard title={t({ ko: '레이아웃', en: 'Layout' })}>
            <SettingsField label={t({ ko: '표시 개수', en: 'Visible count' })}>
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

          <WallpaperInspectorSectionCard title={t({ ko: '재생', en: 'Playback' })}>
            <SettingsField label={t({ ko: '교체 간격', en: 'Swap interval' })}>
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

          <WallpaperInspectorSectionCard title={t({ ko: '모션', en: 'Motion' })}>
            <SettingsField label={t({ ko: '움직임', en: 'Movement' })}>
              <Select
                value={selectedWidget.settings.motionMode ?? 'static'}
                onChange={(event) => {
                  updateWidgetSettings({
                    motionMode: event.target.value === 'pointer' ? 'pointer' : event.target.value === 'ambient' ? 'ambient' : 'static',
                  })
                }}
              >
                <option value="static">{t({ ko: '고정', en: 'Static' })}</option>
                <option value="ambient">{t({ ko: '앰비언트', en: 'Ambient' })}</option>
                <option value="pointer">{t({ ko: '반응형', en: 'Reactive' })}</option>
              </Select>
            </SettingsField>

            {(selectedWidget.settings.motionMode ?? 'static') !== 'static' ? (
              <WallpaperMotionEasingEditorField
                easing={selectedWidget.settings.motionEasing}
                fallbackPreset="easeOutCubic"
                motionStrength={selectedWidget.settings.motionStrength}
                editorContent={(
                  <div className="theme-settings-panel rounded-sm bg-surface-container p-3">
                    <div className="mb-2 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">{t({ ko: '모션 옵션', en: 'Motion options' })}</div>
                    <SettingsField label={t({ ko: '강도', en: 'Strength' })}>
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

          <WallpaperInspectorSectionCard title={t({ ko: '전환', en: 'Transition' })}>
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

          <WallpaperInspectorSectionCard title={t({ ko: '상호작용', en: 'Interaction' })}>
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
          <WallpaperInspectorSectionCard title={t({ ko: '레이아웃', en: 'Layout' })}>
            <SettingsField label={t({ ko: '표시 개수', en: 'Visible count' })}>
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

            <SettingsField label={t({ ko: '이미지 크기(%)', en: 'Image size (%)' })}>
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

            <SettingsField label={t({ ko: '비율 기준', en: 'Aspect basis' })}>
              <Select
                value={selectedWidget.settings.aspectMode ?? 'image'}
                onChange={(event) => {
                  updateWidgetSettings({
                    aspectMode: event.target.value === 'slot' ? 'slot' : 'image',
                  })
                }}
              >
                <option value="image">{t({ ko: '이미지 비율', en: 'Image ratio' })}</option>
                <option value="slot">{t({ ko: '슬롯 고정', en: 'Fixed slot' })}</option>
              </Select>
            </SettingsField>

            <SettingsField label={t({ ko: '채우기 방식', en: 'Fit mode' })}>
              <Select
                value={selectedWidget.settings.fitMode ?? 'cover'}
                onChange={(event) => {
                  updateWidgetSettings({
                    fitMode: event.target.value === 'contain' ? 'contain' : 'cover',
                  })
                }}
              >
                <option value="cover">{t({ ko: '채우기', en: 'Cover' })}</option>
                <option value="contain">{t({ ko: '맞춤', en: 'Contain' })}</option>
              </Select>
            </SettingsField>
          </WallpaperInspectorSectionCard>

          <WallpaperInspectorSectionCard title={t({ ko: '모션', en: 'Motion' })}>
            <WallpaperMotionEasingEditorField
              easing={selectedWidget.settings.motionEasing}
              fallbackPreset="linear"
              motionStrength={selectedWidget.settings.motionStrength}
              motionSpeed={selectedWidget.settings.motionSpeed}
              editorContent={(
                <div className="theme-settings-panel rounded-sm bg-surface-container p-3">
                  <div className="mb-2 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">{t({ ko: '모션 옵션', en: 'Motion options' })}</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SettingsField label={t({ ko: '움직임 강도', en: 'Motion strength' })}>
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
                    <SettingsField label={t({ ko: '이동 속도', en: 'Movement speed' })}>
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

          <WallpaperInspectorSectionCard title={t({ ko: '교체', en: 'Swap' })}>
            <WallpaperTransitionAnimationEditorField
              label={t({ ko: '교체 애니메이션', en: 'Swap animation' })}
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
                  <div className="mb-2 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">{t({ ko: '교체 옵션', en: 'Swap options' })}</div>
                  <div className="space-y-3">
                    <SettingsField label={t({ ko: '이미지 교체 기준', en: 'Image swap trigger' })}>
                      <Select
                        value={selectedWidget.settings.imageSwapMode ?? 'bounce'}
                        onChange={(event) => {
                          updateWidgetSettings({
                            imageSwapMode: event.target.value === 'time' ? 'time' : 'bounce',
                          })
                        }}
                      >
                        <option value="bounce">{t({ ko: '튕김 횟수', en: 'Bounce count' })}</option>
                        <option value="time">{t({ ko: '시간', en: 'Time' })}</option>
                      </Select>
                    </SettingsField>

                    {selectedWidget.settings.imageSwapMode === 'time' ? (
                      <SettingsField label={t({ ko: '교체 간격(초)', en: 'Swap interval (sec)' })}>
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
                      <SettingsField label={t({ ko: '교체까지 튕김 수', en: 'Bounces before swap' })}>
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

          <WallpaperInspectorSectionCard title={t({ ko: '상호작용', en: 'Interaction' })}>
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

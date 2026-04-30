import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { Select } from '@/components/ui/select'
import { SettingsField } from '@/features/settings/components/settings-primitives'
import {
  WallpaperInspectorSectionCard,
  WallpaperHoverInteractionEditorFields,
  WallpaperTransitionAnimationEditorField,
  clampWallpaperInspectorNumber,
  type WallpaperWidgetSettingsPatchUpdater,
} from './wallpaper-widget-inspector-editor-shared'
import type { WallpaperWidgetInstance } from './wallpaper-types'
import { getWallpaperMotionStrengthMultiplier } from './wallpaper-widget-utils'
import { useI18n } from '@/i18n'

type WallpaperStatusWidgetInstance = Extract<WallpaperWidgetInstance, { type: 'queue-status' | 'recent-results' | 'activity-pulse' }>

interface WallpaperStatusWidgetEditorFieldsProps {
  selectedWidget: WallpaperStatusWidgetInstance
  updateWidgetSettings: WallpaperWidgetSettingsPatchUpdater
}

/** Render editor fields for status and activity widgets that share the same data-oriented domain. */
export function WallpaperStatusWidgetEditorFields({
  selectedWidget,
  updateWidgetSettings,
}: WallpaperStatusWidgetEditorFieldsProps) {
  const { t } = useI18n()

  switch (selectedWidget.type) {
    case 'queue-status':
      return (
        <WallpaperInspectorSectionCard title={t({ ko: '데이터', en: 'Data' })}>
          <SettingsField label={t({ ko: '데이터 새로고침', en: 'Data refresh' })}>
            <Select
              value={String(selectedWidget.settings.refreshIntervalSec)}
              onChange={(event) => {
                updateWidgetSettings({ refreshIntervalSec: Number(event.target.value) })
              }}
            >
              {[5, 10, 15, 30].map((seconds) => (
                <option key={seconds} value={seconds}>{seconds}s</option>
              ))}
            </Select>
          </SettingsField>

          <SettingsField label={t({ ko: '표시 방식', en: 'Display mode' })}>
            <Select
              value={selectedWidget.settings.visualMode ?? 'tiles'}
              onChange={(event) => {
                updateWidgetSettings({
                  visualMode: event.target.value === 'bars' ? 'bars' : event.target.value === 'rings' ? 'rings' : 'tiles',
                })
              }}
            >
              <option value="tiles">{t({ ko: '타일', en: 'Tiles' })}</option>
              <option value="bars">{t({ ko: '막대', en: 'Bars' })}</option>
              <option value="rings">{t({ ko: '링', en: 'Rings' })}</option>
            </Select>
          </SettingsField>
        </WallpaperInspectorSectionCard>
      )

    case 'recent-results':
      return (
        <>
          <WallpaperInspectorSectionCard title={t({ ko: '레이아웃', en: 'Layout' })}>
            <SettingsField label={t({ ko: '데이터 새로고침', en: 'Data refresh' })}>
              <Select
                value={String(selectedWidget.settings.refreshIntervalSec)}
                onChange={(event) => {
                  updateWidgetSettings({ refreshIntervalSec: Number(event.target.value) })
                }}
              >
                {[5, 10, 15, 30, 60].map((seconds) => (
                  <option key={seconds} value={seconds}>{seconds}s</option>
                ))}
              </Select>
            </SettingsField>

            <SettingsField label={t({ ko: '배치', en: 'Arrangement' })}>
              <Select
                value={selectedWidget.settings.displayMode ?? 'grid'}
                onChange={(event) => {
                  updateWidgetSettings({ displayMode: event.target.value === 'stack' ? 'stack' : 'grid' })
                }}
              >
                <option value="grid">{t({ ko: '그리드', en: 'Grid' })}</option>
                <option value="stack">{t({ ko: '스택', en: 'Stack' })}</option>
              </Select>
            </SettingsField>

            <SettingsField label={t({ ko: '표시 개수', en: 'Visible count' })}>
              <Select
                value={String(selectedWidget.settings.visibleCount)}
                onChange={(event) => {
                  updateWidgetSettings({ visibleCount: Number(event.target.value) })
                }}
              >
                {[1, 2, 3, 4, 6].map((count) => (
                  <option key={count} value={count}>{count}</option>
                ))}
              </Select>
            </SettingsField>
          </WallpaperInspectorSectionCard>

          <WallpaperInspectorSectionCard title={t({ ko: '전환', en: 'Transition' })}>
            <SettingsField label={t({ ko: '화면 전환 간격', en: 'Screen transition interval' })}>
              <Select
                value={String(selectedWidget.settings.shiftIntervalSec ?? 8)}
                onChange={(event) => {
                  updateWidgetSettings({ shiftIntervalSec: Number(event.target.value) })
                }}
              >
                {[4, 6, 8, 12, 16].map((seconds) => (
                  <option key={seconds} value={seconds}>{seconds}s</option>
                ))}
              </Select>
            </SettingsField>

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

    case 'activity-pulse':
      return (
        <WallpaperInspectorSectionCard title={t({ ko: '모션', en: 'Motion' })}>
          <SettingsField label={t({ ko: '데이터 새로고침', en: 'Data refresh' })}>
            <Select
              value={String(selectedWidget.settings.refreshIntervalSec)}
              onChange={(event) => {
                updateWidgetSettings({ refreshIntervalSec: Number(event.target.value) })
              }}
            >
              {[3, 5, 10, 15, 30].map((seconds) => (
                <option key={seconds} value={seconds}>{seconds}s</option>
              ))}
            </Select>
          </SettingsField>

          <SettingsField label={t({ ko: '강조 대상', en: 'Emphasis target' })}>
            <Select
              value={selectedWidget.settings.emphasis ?? 'mixed'}
              onChange={(event) => {
                updateWidgetSettings({
                  emphasis: event.target.value === 'queue' ? 'queue' : event.target.value === 'results' ? 'results' : 'mixed',
                })
              }}
            >
              <option value="mixed">{t({ ko: '혼합', en: 'Mixed' })}</option>
              <option value="queue">{t({ ko: '실행', en: 'Queue' })}</option>
              <option value="results">{t({ ko: '결과', en: 'Results' })}</option>
            </Select>
          </SettingsField>

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
        </WallpaperInspectorSectionCard>
      )

    default:
      return null
  }
}

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
  switch (selectedWidget.type) {
    case 'queue-status':
      return (
        <WallpaperInspectorSectionCard title="데이터">
          <SettingsField label="데이터 새로고침">
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

          <SettingsField label="표시 방식">
            <Select
              value={selectedWidget.settings.visualMode ?? 'tiles'}
              onChange={(event) => {
                updateWidgetSettings({
                  visualMode: event.target.value === 'bars' ? 'bars' : event.target.value === 'rings' ? 'rings' : 'tiles',
                })
              }}
            >
              <option value="tiles">타일</option>
              <option value="bars">막대</option>
              <option value="rings">링</option>
            </Select>
          </SettingsField>
        </WallpaperInspectorSectionCard>
      )

    case 'recent-results':
      return (
        <>
          <WallpaperInspectorSectionCard title="레이아웃">
            <SettingsField label="데이터 새로고침">
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

            <SettingsField label="배치">
              <Select
                value={selectedWidget.settings.displayMode ?? 'grid'}
                onChange={(event) => {
                  updateWidgetSettings({ displayMode: event.target.value === 'stack' ? 'stack' : 'grid' })
                }}
              >
                <option value="grid">그리드</option>
                <option value="stack">스택</option>
              </Select>
            </SettingsField>

            <SettingsField label="표시 개수">
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

          <WallpaperInspectorSectionCard title="전환">
            <SettingsField label="화면 전환 간격">
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

    case 'activity-pulse':
      return (
        <WallpaperInspectorSectionCard title="모션">
          <SettingsField label="데이터 새로고침">
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

          <SettingsField label="강조 대상">
            <Select
              value={selectedWidget.settings.emphasis ?? 'mixed'}
              onChange={(event) => {
                updateWidgetSettings({
                  emphasis: event.target.value === 'queue' ? 'queue' : event.target.value === 'results' ? 'results' : 'mixed',
                })
              }}
            >
              <option value="mixed">혼합</option>
              <option value="queue">실행</option>
              <option value="results">결과</option>
            </Select>
          </SettingsField>

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
        </WallpaperInspectorSectionCard>
      )

    default:
      return null
  }
}

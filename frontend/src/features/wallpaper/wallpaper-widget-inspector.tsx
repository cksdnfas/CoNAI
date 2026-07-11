import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SettingsField, SettingsToggleRow } from '@/features/settings/components/settings-primitives'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import {
  WallpaperInspectorDisclosure,
  WallpaperInspectorSectionCard,
  WallpaperPreviewCloseAnimationEditorField,
  WallpaperPreviewOpenAnimationEditorField,
} from './wallpaper-widget-inspector-editor-shared'
import { WallpaperWidgetTypeEditorFields } from './wallpaper-widget-inspector-editors'
import { isWallpaperGroupSourceWidget, isWallpaperPreviewableImageWidget, type WallpaperWidgetInstance } from './wallpaper-types'

interface WallpaperWidgetInspectorPatch {
  x?: number
  y?: number
  w?: number
  h?: number
  zIndex?: number
  locked?: boolean
  hidden?: boolean
  settings?: WallpaperWidgetInstance['settings']
}

interface WallpaperWidgetInspectorProps {
  selectedWidget: WallpaperWidgetInstance | null
  groups: Array<{ id: number; name: string; depth?: number | null }>
  onPatchWidget: (widgetId: string, patch: WallpaperWidgetInspectorPatch) => void
}

/** Render the editor inspector for one selected wallpaper widget. */
export function WallpaperWidgetInspector({ selectedWidget, groups, onPatchWidget }: WallpaperWidgetInspectorProps) {
  const { t } = useI18n()
  if (!selectedWidget) {
    return (
      <div className={cn('rounded-sm border border-dashed border-border bg-surface-low px-4 py-8 text-center text-sm text-muted-foreground')}>
        {t({ ko: '위젯을 선택해.', en: 'Select a widget.' })}
      </div>
    )
  }

  const updateWidgetSettings = (settingsPatch: Partial<WallpaperWidgetInstance['settings']>) => {
    onPatchWidget(selectedWidget.id, {
      settings: {
        ...selectedWidget.settings,
        ...settingsPatch,
      } as WallpaperWidgetInstance['settings'],
    })
  }

  const isGroupSourceWidget = isWallpaperGroupSourceWidget(selectedWidget)
  const isPreviewableImageWidget = isWallpaperPreviewableImageWidget(selectedWidget)

  return (
    <div className="space-y-3">
      <WallpaperInspectorSectionCard title={t({ ko: '기본', en: 'Basics' })}>
        <SettingsField label={t({ ko: '제목', en: 'Title' })}>
          <Input
            variant="settings"
            value={selectedWidget.settings.title}
            onChange={(event) => {
              updateWidgetSettings({ title: event.target.value })
            }}
          />
        </SettingsField>

        {isGroupSourceWidget ? (
          <>
            <SettingsField label={t({ ko: '그룹', en: 'Group' })}>
              <Select
                value={selectedWidget.settings.groupId !== null ? String(selectedWidget.settings.groupId) : ''}
                onChange={(event) => {
                  const nextValue = event.target.value
                  updateWidgetSettings({ groupId: nextValue ? Number(nextValue) : null })
                }}
              >
                <option value="">{t({ ko: '그룹 선택', en: 'Select group' })}</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>{`${'　'.repeat(group.depth ?? 0)}${group.name}`}</option>
                ))}
              </Select>
            </SettingsField>

            <SettingsToggleRow>
              <span className="flex-1">{t({ ko: '하위 그룹 포함', en: 'Include child groups' })}</span>
              <input
                type="checkbox"
                checked={selectedWidget.settings.includeChildren !== false}
                onChange={(event) => {
                  updateWidgetSettings({ includeChildren: event.target.checked })
                }}
              />
            </SettingsToggleRow>
          </>
        ) : null}

        <WallpaperInspectorDisclosure
          title={t({ ko: '표시', en: 'Display' })}
          defaultOpen={false}
        >
          <SettingsToggleRow>
            <span className="flex-1">{t({ ko: '제목 표시', en: 'Show title' })}</span>
            <input
              type="checkbox"
              checked={selectedWidget.settings.showTitle === true}
              onChange={(event) => {
                updateWidgetSettings({ showTitle: event.target.checked })
              }}
            />
          </SettingsToggleRow>

          <SettingsToggleRow>
            <span className="flex-1">{t({ ko: '배경 표시', en: 'Show background' })}</span>
            <input
              type="checkbox"
              checked={selectedWidget.settings.showBackground === true}
              onChange={(event) => {
                updateWidgetSettings({ showBackground: event.target.checked })
              }}
            />
          </SettingsToggleRow>

          <SettingsToggleRow>
            <span className="flex-1">{t({ ko: '경계선 표시', en: 'Show border' })}</span>
            <input
              type="checkbox"
              checked={selectedWidget.settings.showBorder === true}
              onChange={(event) => {
                updateWidgetSettings({ showBorder: event.target.checked })
              }}
            />
          </SettingsToggleRow>

          {isPreviewableImageWidget ? (
            <>
              <SettingsField label={t({ ko: '이미지 클릭', en: 'Image click' })}>
                <Select
                  value={selectedWidget.settings.imageClickAction ?? 'preview'}
                  onChange={(event) => {
                    updateWidgetSettings({ imageClickAction: event.target.value === 'none' ? 'none' : 'preview' })
                  }}
                >
                  <option value="preview">{t({ ko: '확대 미리보기', en: 'Open preview' })}</option>
                  <option value="none">{t({ ko: '동작 없음', en: 'No action' })}</option>
                </Select>
              </SettingsField>

              {selectedWidget.type === 'group-image-view' || selectedWidget.type === 'image-showcase' ? (
                <SettingsToggleRow>
                  <span className="flex-1">{t({ ko: '호버 시 자동재생 일시정지', en: 'Pause autoplay on hover' })}</span>
                  <input
                    type="checkbox"
                    checked={selectedWidget.settings.pauseOnHover !== false}
                    onChange={(event) => {
                      updateWidgetSettings({ pauseOnHover: event.target.checked })
                    }}
                  />
                </SettingsToggleRow>
              ) : null}

              <WallpaperPreviewOpenAnimationEditorField
                scalePercent={selectedWidget.settings.imagePreviewOpenScalePercent}
                durationMs={selectedWidget.settings.imagePreviewOpenDurationMs}
                easing={selectedWidget.settings.imagePreviewOpenEasing}
                onScalePercentChange={(nextValue) => {
                  updateWidgetSettings({ imagePreviewOpenScalePercent: nextValue })
                }}
                onDurationMsChange={(nextValue) => {
                  updateWidgetSettings({ imagePreviewOpenDurationMs: nextValue })
                }}
                onEasingChange={(nextValue) => {
                  updateWidgetSettings({ imagePreviewOpenEasing: nextValue })
                }}
              />

              <WallpaperPreviewCloseAnimationEditorField
                scalePercent={selectedWidget.settings.imagePreviewCloseScalePercent}
                durationMs={selectedWidget.settings.imagePreviewCloseDurationMs}
                easing={selectedWidget.settings.imagePreviewCloseEasing}
                onScalePercentChange={(nextValue) => {
                  updateWidgetSettings({ imagePreviewCloseScalePercent: nextValue })
                }}
                onDurationMsChange={(nextValue) => {
                  updateWidgetSettings({ imagePreviewCloseDurationMs: nextValue })
                }}
                onEasingChange={(nextValue) => {
                  updateWidgetSettings({ imagePreviewCloseEasing: nextValue })
                }}
              />
            </>
          ) : null}

          <SettingsToggleRow>
            <span className="flex-1">{t({ ko: '위젯 숨김', en: 'Hide widget' })}</span>
            <input
              type="checkbox"
              checked={selectedWidget.hidden}
              onChange={(event) => {
                onPatchWidget(selectedWidget.id, { hidden: event.target.checked })
              }}
            />
          </SettingsToggleRow>

          <SettingsToggleRow>
            <span className="flex-1">{t({ ko: '위젯 잠금', en: 'Lock widget' })}</span>
            <input
              type="checkbox"
              checked={selectedWidget.locked}
              onChange={(event) => {
                onPatchWidget(selectedWidget.id, { locked: event.target.checked })
              }}
            />
          </SettingsToggleRow>
        </WallpaperInspectorDisclosure>
      </WallpaperInspectorSectionCard>

      <WallpaperWidgetTypeEditorFields selectedWidget={selectedWidget} updateWidgetSettings={updateWidgetSettings} />
    </div>
  )
}

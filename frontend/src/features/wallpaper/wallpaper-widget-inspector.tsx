import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/ui/field'
import { ToggleRow } from '@/components/ui/toggle-row'
import { useI18n } from '@/i18n'
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
    return null
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
        <Field label={t({ ko: '제목', en: 'Title' })}>
          <Input
            variant="settings"
            value={selectedWidget.settings.title}
            onChange={(event) => {
              updateWidgetSettings({ title: event.target.value })
            }}
          />
        </Field>

        {isGroupSourceWidget ? (
          <>
            <Field label={t({ ko: '그룹', en: 'Group' })}>
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
            </Field>

            <ToggleRow>
              <span className="flex-1">{t({ ko: '하위 그룹 포함', en: 'Include child groups' })}</span>
              <Switch
                checked={selectedWidget.settings.includeChildren !== false}
                onCheckedChange={(checked) => {
                  updateWidgetSettings({ includeChildren: checked })
                }}
              />
            </ToggleRow>
          </>
        ) : null}

        <WallpaperInspectorDisclosure
          title={t({ ko: '표시', en: 'Display' })}
          defaultOpen={false}
        >
          <ToggleRow>
            <span className="flex-1">{t({ ko: '제목 표시', en: 'Show title' })}</span>
            <Switch
              checked={selectedWidget.settings.showTitle === true}
              onCheckedChange={(checked) => {
                updateWidgetSettings({ showTitle: checked })
              }}
            />
          </ToggleRow>

          <ToggleRow>
            <span className="flex-1">{t({ ko: '배경 표시', en: 'Show background' })}</span>
            <Switch
              checked={selectedWidget.settings.showBackground === true}
              onCheckedChange={(checked) => {
                updateWidgetSettings({ showBackground: checked })
              }}
            />
          </ToggleRow>

          <ToggleRow>
            <span className="flex-1">{t({ ko: '경계선 표시', en: 'Show border' })}</span>
            <Switch
              checked={selectedWidget.settings.showBorder === true}
              onCheckedChange={(checked) => {
                updateWidgetSettings({ showBorder: checked })
              }}
            />
          </ToggleRow>

          {isPreviewableImageWidget ? (
            <>
              <Field label={t({ ko: '이미지 클릭', en: 'Image click' })}>
                <Select
                  value={selectedWidget.settings.imageClickAction ?? 'preview'}
                  onChange={(event) => {
                    updateWidgetSettings({ imageClickAction: event.target.value === 'none' ? 'none' : 'preview' })
                  }}
                >
                  <option value="preview">{t({ ko: '확대 미리보기', en: 'Open preview' })}</option>
                  <option value="none">{t({ ko: '동작 없음', en: 'No action' })}</option>
                </Select>
              </Field>

              {selectedWidget.type === 'group-image-view' || selectedWidget.type === 'image-showcase' ? (
                <ToggleRow>
                  <span className="flex-1">{t({ ko: '호버 시 자동재생 일시정지', en: 'Pause autoplay on hover' })}</span>
                  <Switch
                    checked={selectedWidget.settings.pauseOnHover !== false}
                    onCheckedChange={(checked) => {
                      updateWidgetSettings({ pauseOnHover: checked })
                    }}
                  />
                </ToggleRow>
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

          <ToggleRow>
            <span className="flex-1">{t({ ko: '위젯 숨김', en: 'Hide widget' })}</span>
            <Switch
              checked={selectedWidget.hidden}
              onCheckedChange={(checked) => {
                onPatchWidget(selectedWidget.id, { hidden: checked })
              }}
            />
          </ToggleRow>

          <ToggleRow>
            <span className="flex-1">{t({ ko: '위젯 잠금', en: 'Lock widget' })}</span>
            <Switch
              checked={selectedWidget.locked}
              onCheckedChange={(checked) => {
                onPatchWidget(selectedWidget.id, { locked: checked })
              }}
            />
          </ToggleRow>
        </WallpaperInspectorDisclosure>
      </WallpaperInspectorSectionCard>

      <WallpaperWidgetTypeEditorFields selectedWidget={selectedWidget} updateWidgetSettings={updateWidgetSettings} />
    </div>
  )
}

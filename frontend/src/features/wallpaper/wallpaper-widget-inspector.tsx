import { useState, type ReactNode } from 'react'
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, Eye, EyeOff, Lock, LockOpen, PaintRoller, Paintbrush } from 'lucide-react'
import { TextTabs } from '@/components/common/text-tabs'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import {
  InspectorColor,
  InspectorHeading,
  InspectorNumber,
  InspectorRow,
  InspectorSegments,
  InspectorSlider,
  InspectorSwitch,
} from './wallpaper-inspector-controls'
import type { WallpaperAlignMode } from './wallpaper-layout-utils'
import { WallpaperWidgetTypeEditorFields, type WallpaperInspectorGroupOption } from './wallpaper-widget-inspector-editors'
import type { WallpaperWidgetFrame, WallpaperWidgetInstance, WallpaperWidgetStyle } from './wallpaper-types'
import { getWallpaperWidgetDefinition, getWallpaperWidgetDisplayTitle } from './wallpaper-widget-registry'

export interface WallpaperWidgetPatch extends Partial<WallpaperWidgetFrame> {
  rotation?: number
  locked?: boolean
  hidden?: boolean
  style?: Partial<WallpaperWidgetStyle>
  settings?: Record<string, unknown>
}

type InspectorTab = 'layout' | 'style' | 'widget'

interface WallpaperWidgetInspectorProps {
  selectedWidgets: WallpaperWidgetInstance[]
  groups: WallpaperInspectorGroupOption[]
  /** One patch onto every listed widget as one undo step; `key` groups bursts (typing, slider drags). */
  onPatchWidgets: (widgetIds: string[], patch: WallpaperWidgetPatch, key: string) => void
  onAlign: (mode: WallpaperAlignMode) => void
  onDistribute: (axis: 'x' | 'y') => void
  onCopyStyle: () => void
  /** null while nothing has been copied. */
  onPasteStyle: (() => void) | null
}

/** Copy the look of one widget, paste it onto every selected one. */
function StyleClipboardButtons({ onCopyStyle, onPasteStyle }: { onCopyStyle?: () => void; onPasteStyle: (() => void) | null }) {
  const { t } = useI18n()
  return (
    <>
      {onCopyStyle ? (
        <IconButton variant="ghost" size="icon-sm" label={t({ ko: '스타일 복사 (Ctrl+Alt+C)', en: 'Copy style (Ctrl+Alt+C)' })} onClick={onCopyStyle}><Paintbrush /></IconButton>
      ) : null}
      <IconButton variant="ghost" size="icon-sm" disabled={!onPasteStyle} label={t({ ko: '스타일 붙여넣기 (Ctrl+Alt+V)', en: 'Paste style (Ctrl+Alt+V)' })} onClick={() => onPasteStyle?.()}><PaintRoller /></IconButton>
    </>
  )
}

function AlignButtons({ onAlign, onDistribute, canDistribute }: { onAlign: (mode: WallpaperAlignMode) => void; onDistribute: (axis: 'x' | 'y') => void; canDistribute: boolean }) {
  const { t } = useI18n()
  const items: Array<{ mode: WallpaperAlignMode; label: string; icon: ReactNode }> = [
    { mode: 'left', label: t({ ko: '왼쪽 정렬', en: 'Align left' }), icon: <AlignStartVertical /> },
    { mode: 'hcenter', label: t({ ko: '가로 가운데', en: 'Center horizontally' }), icon: <AlignCenterVertical /> },
    { mode: 'right', label: t({ ko: '오른쪽 정렬', en: 'Align right' }), icon: <AlignEndVertical /> },
    { mode: 'top', label: t({ ko: '위 정렬', en: 'Align top' }), icon: <AlignStartHorizontal /> },
    { mode: 'vcenter', label: t({ ko: '세로 가운데', en: 'Center vertically' }), icon: <AlignCenterHorizontal /> },
    { mode: 'bottom', label: t({ ko: '아래 정렬', en: 'Align bottom' }), icon: <AlignEndHorizontal /> },
  ]
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      {items.map((item) => (
        <IconButton key={item.mode} variant="ghost" size="icon-sm" label={item.label} onClick={() => onAlign(item.mode)}>{item.icon}</IconButton>
      ))}
      {canDistribute ? (
        <>
          <span className="mx-1 h-4 w-px bg-line" />
          <IconButton variant="ghost" size="icon-sm" label={t({ ko: '가로 간격 균등', en: 'Distribute horizontally' })} onClick={() => onDistribute('x')}><AlignHorizontalDistributeCenter /></IconButton>
          <IconButton variant="ghost" size="icon-sm" label={t({ ko: '세로 간격 균등', en: 'Distribute vertically' })} onClick={() => onDistribute('y')}><AlignVerticalDistributeCenter /></IconButton>
        </>
      ) : null}
    </div>
  )
}

/** One field across the selection: the first widget's value, and whether any other widget disagrees. */
function sharedValue<T>(widgets: WallpaperWidgetInstance[], read: (widget: WallpaperWidgetInstance) => T): { value: T; mixed: boolean } {
  const value = read(widgets[0])
  return { value, mixed: widgets.some((widget) => read(widget) !== value) }
}

function StyleFields({ widgets, patchStyle }: { widgets: WallpaperWidgetInstance[]; patchStyle: (patch: Partial<WallpaperWidgetStyle>, field: string) => void }) {
  const { t } = useI18n()
  const field = <K extends keyof WallpaperWidgetStyle>(key: K) => sharedValue(widgets, (widget) => widget.style[key])
  const variant = field('variant')
  const backgroundColor = field('backgroundColor')
  const backgroundOpacity = field('backgroundOpacity')
  const blur = field('blur')
  const radius = field('radius')
  const shadow = field('shadow')
  const padding = field('padding')
  const fontFamily = field('fontFamily')
  const fontWeight = field('fontWeight')
  const textColor = field('textColor')
  const accentColor = field('accentColor')
  const textAlign = field('textAlign')
  const entrance = field('entrance')
  const depth = field('depth')
  const showFrom = field('showFrom')
  const showUntil = field('showUntil')
  const mixedOption = <option value="" disabled>{t({ ko: '혼합', en: 'Mixed' })}</option>
  const hasFill = widgets.some((widget) => widget.style.variant === 'card' || widget.style.variant === 'glass')
  const hasFrame = widgets.some((widget) => widget.style.variant !== 'none')
  return (
    <div className="space-y-3">
      <InspectorSegments
        label={t({ ko: '외형', en: 'Look' })}
        value={variant.mixed ? '' : variant.value}
        items={[
          { value: 'none', label: t({ ko: '없음', en: 'None' }) },
          { value: 'card', label: t({ ko: '카드', en: 'Card' }) },
          { value: 'glass', label: t({ ko: '글래스', en: 'Glass' }) },
          { value: 'outline', label: t({ ko: '윤곽', en: 'Outline' }) },
        ]}
        onChange={(value) => patchStyle({ variant: value }, 'variant')}
        stacked
      />
      {hasFill ? (
        <>
          <InspectorColor label={t({ ko: '배경색', en: 'Fill' })} value={backgroundColor.value} mixed={backgroundColor.mixed} fallback="#201f1f" themeVariable="--surface-container" nullable onChange={(value) => patchStyle({ backgroundColor: value }, 'backgroundColor')} />
          <InspectorSlider label={t({ ko: '배경 농도', en: 'Fill opacity' })} value={backgroundOpacity.value} mixed={backgroundOpacity.mixed} min={0} max={100} unit="%" onChange={(value) => patchStyle({ backgroundOpacity: value }, 'backgroundOpacity')} />
          <InspectorSlider label={t({ ko: '배경 흐림', en: 'Backdrop blur' })} value={blur.value} mixed={blur.mixed} min={0} max={40} unit="px" onChange={(value) => patchStyle({ blur: value }, 'blur')} />
        </>
      ) : null}
      {hasFrame ? (
        <>
          <InspectorSlider label={t({ ko: '모서리', en: 'Radius' })} value={radius.value} mixed={radius.mixed} min={0} max={64} onChange={(value) => patchStyle({ radius: value }, 'radius')} />
          <InspectorSegments
            label={t({ ko: '그림자', en: 'Shadow' })}
            value={shadow.mixed ? '' : shadow.value}
            items={[
              { value: 'none', label: t({ ko: '없음', en: 'None' }) },
              { value: 'sm', label: t({ ko: '약', en: 'S' }) },
              { value: 'md', label: t({ ko: '중', en: 'M' }) },
              { value: 'lg', label: t({ ko: '강', en: 'L' }) },
            ]}
            onChange={(value) => patchStyle({ shadow: value }, 'shadow')}
          />
        </>
      ) : null}
      <InspectorSlider label={t({ ko: '여백', en: 'Padding' })} value={padding.value} mixed={padding.mixed} min={0} max={80} onChange={(value) => patchStyle({ padding: value }, 'padding')} />

      <InspectorHeading>{t({ ko: '글자', en: 'Text' })}</InspectorHeading>
      <InspectorRow label={t({ ko: '글꼴', en: 'Font' })}>
        <Select value={fontFamily.mixed ? '' : fontFamily.value} onChange={(event) => patchStyle({ fontFamily: event.target.value as WallpaperWidgetStyle['fontFamily'] }, 'fontFamily')}>
          {fontFamily.mixed ? mixedOption : null}
          <option value="inherit">{t({ ko: '앱 글꼴', en: 'App font' })}</option>
          <option value="sans">{t({ ko: '고딕', en: 'Sans' })}</option>
          <option value="serif">{t({ ko: '명조', en: 'Serif' })}</option>
          <option value="mono">{t({ ko: '고정폭', en: 'Mono' })}</option>
          <option value="display">{t({ ko: '디스플레이', en: 'Display' })}</option>
        </Select>
      </InspectorRow>
      <InspectorSegments
        label={t({ ko: '굵기', en: 'Weight' })}
        value={fontWeight.mixed ? '' : fontWeight.value}
        items={[
          { value: 'light', label: t({ ko: '얇게', en: 'Light' }) },
          { value: 'regular', label: t({ ko: '보통', en: 'Regular' }) },
          { value: 'bold', label: t({ ko: '굵게', en: 'Bold' }) },
        ]}
        onChange={(value) => patchStyle({ fontWeight: value }, 'fontWeight')}
      />
      <InspectorColor label={t({ ko: '글자색', en: 'Color' })} value={textColor.value} mixed={textColor.mixed} fallback="#e5e2e1" themeVariable="--foreground" nullable onChange={(value) => patchStyle({ textColor: value }, 'textColor')} />
      <InspectorColor label={t({ ko: '강조색', en: 'Accent' })} value={accentColor.value} mixed={accentColor.mixed} fallback="#f95e14" themeVariable="--primary" nullable onChange={(value) => patchStyle({ accentColor: value }, 'accentColor')} />
      <InspectorSegments
        label={t({ ko: '정렬', en: 'Align' })}
        value={textAlign.mixed ? '' : textAlign.value}
        items={[
          { value: 'left', label: t({ ko: '왼쪽', en: 'Left' }) },
          { value: 'center', label: t({ ko: '가운데', en: 'Center' }) },
          { value: 'right', label: t({ ko: '오른쪽', en: 'Right' }) },
        ]}
        onChange={(value) => patchStyle({ textAlign: value }, 'textAlign')}
      />
      <InspectorSwitch label={t({ ko: '제목 표시', en: 'Show title' })} checked={widgets.every((widget) => widget.style.showTitle)} onChange={(checked) => patchStyle({ showTitle: checked }, 'showTitle')} />

      <InspectorHeading>{t({ ko: '등장', en: 'Entrance' })}</InspectorHeading>
      <InspectorRow label={t({ ko: '애니메이션', en: 'Animation' })}>
        <Select value={entrance.mixed ? '' : entrance.value} onChange={(event) => patchStyle({ entrance: event.target.value as WallpaperWidgetStyle['entrance'] }, 'entrance')}>
          {entrance.mixed ? mixedOption : null}
          <option value="none">{t({ ko: '없음', en: 'None' })}</option>
          <option value="fade">{t({ ko: '페이드', en: 'Fade' })}</option>
          <option value="rise">{t({ ko: '아래에서 페이드', en: 'Rise' })}</option>
          <option value="zoom">{t({ ko: '줌', en: 'Zoom' })}</option>
        </Select>
      </InspectorRow>
      <InspectorSlider label={t({ ko: '패럴랙스 깊이', en: 'Parallax depth' })} value={depth.value} mixed={depth.mixed} min={0} max={100} unit="%" onChange={(value) => patchStyle({ depth: value }, 'depth')} />

      <InspectorHeading>{t({ ko: '표시 시간', en: 'Shown' })}</InspectorHeading>
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="time"
          aria-label={t({ ko: '표시 시작', en: 'Shown from' })}
          value={showFrom.mixed ? '' : showFrom.value ?? ''}
          onChange={(event) => patchStyle({ showFrom: event.target.value || null }, 'showFrom')}
        />
        <Input
          type="time"
          aria-label={t({ ko: '표시 끝', en: 'Shown until' })}
          value={showUntil.mixed ? '' : showUntil.value ?? ''}
          onChange={(event) => patchStyle({ showUntil: event.target.value || null }, 'showUntil')}
        />
      </div>
    </div>
  )
}

/** Right column of the editor for the selected widget(s); several widgets edit together and disagreeing fields read "mixed". */
export function WallpaperWidgetInspector({ selectedWidgets, groups, onPatchWidgets, onAlign, onDistribute, onCopyStyle, onPasteStyle }: WallpaperWidgetInspectorProps) {
  const { t } = useI18n()
  const [tab, setTab] = useState<InspectorTab>('widget')

  if (selectedWidgets.length === 0) return null

  const widget = selectedWidgets[0]
  const isMulti = selectedWidgets.length > 1
  const ids = selectedWidgets.map((item) => item.id)
  // Widget settings only make sense when every selected widget is the same kind.
  const sameType = selectedWidgets.every((item) => item.type === widget.type)
  const activeTab: InspectorTab = tab === 'widget' && !sameType ? 'layout' : tab
  const definition = getWallpaperWidgetDefinition(widget.type)
  const patch = (next: WallpaperWidgetPatch, field: string) => onPatchWidgets(ids, next, `${field}:${ids.join(',')}`)
  const patchStyle = (next: Partial<WallpaperWidgetStyle>, field: string) => patch({ style: next }, `style.${field}`)
  const updateWidgetSettings = (next: Partial<WallpaperWidgetInstance['settings']>) => patch({ settings: next as Record<string, unknown> }, `settings.${Object.keys(next).join(',')}`)
  const allHidden = selectedWidgets.every((item) => item.hidden)
  const allLocked = selectedWidgets.every((item) => item.locked)
  const frame = (read: (item: WallpaperWidgetInstance) => number) => sharedValue(selectedWidgets, read)
  const x = frame((item) => item.x)
  const y = frame((item) => item.y)
  const w = frame((item) => item.w)
  const h = frame((item) => item.h)
  const rotation = frame((item) => item.rotation)
  const opacity = frame((item) => item.style.opacity)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 truncate text-base font-semibold">
          {isMulti ? t({ ko: '위젯 {count}개', en: '{count} widgets' }, { count: selectedWidgets.length }) : getWallpaperWidgetDisplayTitle(widget, t)}
        </div>
        <StyleClipboardButtons onCopyStyle={isMulti ? undefined : onCopyStyle} onPasteStyle={onPasteStyle} />
        <IconButton variant="ghost" size="icon-sm" label={allHidden ? t({ ko: '보이기', en: 'Show' }) : t({ ko: '숨기기', en: 'Hide' })} onClick={() => patch({ hidden: !allHidden }, 'hidden')}>
          {allHidden ? <EyeOff /> : <Eye />}
        </IconButton>
        <IconButton variant="ghost" size="icon-sm" active={allLocked} label={allLocked ? t({ ko: '잠금 해제', en: 'Unlock' }) : t({ ko: '잠금', en: 'Lock' })} onClick={() => patch({ locked: !allLocked }, 'locked')}>
          {allLocked ? <Lock /> : <LockOpen />}
        </IconButton>
      </div>

      <TextTabs<InspectorTab>
        value={activeTab}
        onChange={setTab}
        ariaLabel={t({ ko: '위젯 설정', en: 'Widget settings' })}
        items={[
          { value: 'layout', label: t({ ko: '배치', en: 'Layout' }) },
          { value: 'style', label: t({ ko: '스타일', en: 'Style' }) },
          ...(sameType ? [{ value: 'widget' as const, label: t(definition.title) }] : []),
        ]}
      />

      {activeTab === 'layout' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <InspectorNumber label="X" value={x.value} mixed={x.mixed} min={0} onCommit={(value) => patch({ x: value }, 'x')} />
            <InspectorNumber label="Y" value={y.value} mixed={y.mixed} min={0} onCommit={(value) => patch({ y: value }, 'y')} />
            <InspectorNumber label="W" value={w.value} mixed={w.mixed} min={1} onCommit={(value) => patch({ w: value }, 'w')} />
            <InspectorNumber label="H" value={h.value} mixed={h.mixed} min={1} onCommit={(value) => patch({ h: value }, 'h')} />
            <InspectorNumber label="↻" ariaLabel={t({ ko: '회전', en: 'Rotation' })} value={rotation.value} mixed={rotation.mixed} min={-360} max={360} suffix="°" onCommit={(value) => patch({ rotation: value }, 'rotation')} />
            <InspectorNumber label="%" ariaLabel={t({ ko: '불투명도', en: 'Opacity' })} value={opacity.value} mixed={opacity.mixed} min={5} max={100} onCommit={(value) => patchStyle({ opacity: value }, 'opacity')} />
          </div>
          <AlignButtons onAlign={onAlign} onDistribute={onDistribute} canDistribute={selectedWidgets.length >= 3} />
          {isMulti ? null : (
            <InspectorRow label={t({ ko: '제목', en: 'Title' })}>
              <Input variant="settings" placeholder={t(definition.title)} value={widget.settings.title} onChange={(event) => updateWidgetSettings({ title: event.target.value })} />
            </InspectorRow>
          )}
        </div>
      ) : activeTab === 'style' ? (
        <StyleFields widgets={selectedWidgets} patchStyle={patchStyle} />
      ) : (
        <WallpaperWidgetTypeEditorFields selectedWidget={widget} groups={groups} updateWidgetSettings={updateWidgetSettings} />
      )}
    </div>
  )
}

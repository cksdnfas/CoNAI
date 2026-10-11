import { useState, type ReactNode } from 'react'
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, Eye, EyeOff, Lock, LockOpen } from 'lucide-react'
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
  /** `key` groups bursts (typing, slider drags) into one undo step. */
  onPatchWidget: (widgetId: string, patch: WallpaperWidgetPatch, key: string) => void
  onAlign: (mode: WallpaperAlignMode) => void
  onDistribute: (axis: 'x' | 'y') => void
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

function StyleFields({ widget, patchStyle }: { widget: WallpaperWidgetInstance; patchStyle: (patch: Partial<WallpaperWidgetStyle>, field: string) => void }) {
  const { t } = useI18n()
  const { style } = widget
  const hasFill = style.variant === 'card' || style.variant === 'glass'
  return (
    <div className="space-y-3">
      <InspectorSegments
        label={t({ ko: '외형', en: 'Look' })}
        value={style.variant}
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
          <InspectorColor label={t({ ko: '배경색', en: 'Fill' })} value={style.backgroundColor} fallback="#201f1f" nullable onChange={(value) => patchStyle({ backgroundColor: value }, 'backgroundColor')} />
          <InspectorSlider label={t({ ko: '배경 농도', en: 'Fill opacity' })} value={style.backgroundOpacity} min={0} max={100} unit="%" onChange={(value) => patchStyle({ backgroundOpacity: value }, 'backgroundOpacity')} />
          <InspectorSlider label={t({ ko: '배경 흐림', en: 'Backdrop blur' })} value={style.blur} min={0} max={40} unit="px" onChange={(value) => patchStyle({ blur: value }, 'blur')} />
        </>
      ) : null}
      {style.variant !== 'none' ? (
        <>
          <InspectorSlider label={t({ ko: '모서리', en: 'Radius' })} value={style.radius} min={0} max={64} onChange={(value) => patchStyle({ radius: value }, 'radius')} />
          <InspectorSegments
            label={t({ ko: '그림자', en: 'Shadow' })}
            value={style.shadow}
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
      <InspectorSlider label={t({ ko: '여백', en: 'Padding' })} value={style.padding} min={0} max={80} onChange={(value) => patchStyle({ padding: value }, 'padding')} />

      <InspectorHeading>{t({ ko: '글자', en: 'Text' })}</InspectorHeading>
      <InspectorRow label={t({ ko: '글꼴', en: 'Font' })}>
        <Select value={style.fontFamily} onChange={(event) => patchStyle({ fontFamily: event.target.value as WallpaperWidgetStyle['fontFamily'] }, 'fontFamily')}>
          <option value="inherit">{t({ ko: '앱 글꼴', en: 'App font' })}</option>
          <option value="sans">{t({ ko: '고딕', en: 'Sans' })}</option>
          <option value="serif">{t({ ko: '명조', en: 'Serif' })}</option>
          <option value="mono">{t({ ko: '고정폭', en: 'Mono' })}</option>
          <option value="display">{t({ ko: '디스플레이', en: 'Display' })}</option>
        </Select>
      </InspectorRow>
      <InspectorSegments
        label={t({ ko: '굵기', en: 'Weight' })}
        value={style.fontWeight}
        items={[
          { value: 'light', label: t({ ko: '얇게', en: 'Light' }) },
          { value: 'regular', label: t({ ko: '보통', en: 'Regular' }) },
          { value: 'bold', label: t({ ko: '굵게', en: 'Bold' }) },
        ]}
        onChange={(value) => patchStyle({ fontWeight: value }, 'fontWeight')}
      />
      <InspectorColor label={t({ ko: '글자색', en: 'Color' })} value={style.textColor} fallback="#e5e2e1" nullable onChange={(value) => patchStyle({ textColor: value }, 'textColor')} />
      <InspectorColor label={t({ ko: '강조색', en: 'Accent' })} value={style.accentColor} fallback="#f95e14" nullable onChange={(value) => patchStyle({ accentColor: value }, 'accentColor')} />
      <InspectorSegments
        label={t({ ko: '정렬', en: 'Align' })}
        value={style.textAlign}
        items={[
          { value: 'left', label: t({ ko: '왼쪽', en: 'Left' }) },
          { value: 'center', label: t({ ko: '가운데', en: 'Center' }) },
          { value: 'right', label: t({ ko: '오른쪽', en: 'Right' }) },
        ]}
        onChange={(value) => patchStyle({ textAlign: value }, 'textAlign')}
      />
      <InspectorSwitch label={t({ ko: '제목 표시', en: 'Show title' })} checked={style.showTitle} onChange={(checked) => patchStyle({ showTitle: checked }, 'showTitle')} />

      <InspectorHeading>{t({ ko: '등장', en: 'Entrance' })}</InspectorHeading>
      <InspectorRow label={t({ ko: '애니메이션', en: 'Animation' })}>
        <Select value={style.entrance} onChange={(event) => patchStyle({ entrance: event.target.value as WallpaperWidgetStyle['entrance'] }, 'entrance')}>
          <option value="none">{t({ ko: '없음', en: 'None' })}</option>
          <option value="fade">{t({ ko: '페이드', en: 'Fade' })}</option>
          <option value="rise">{t({ ko: '아래에서 페이드', en: 'Rise' })}</option>
          <option value="zoom">{t({ ko: '줌', en: 'Zoom' })}</option>
        </Select>
      </InspectorRow>
      <InspectorSlider label={t({ ko: '패럴랙스 깊이', en: 'Parallax depth' })} value={style.depth} min={0} max={100} unit="%" onChange={(value) => patchStyle({ depth: value }, 'depth')} />

      <InspectorHeading>{t({ ko: '표시 시간', en: 'Shown' })}</InspectorHeading>
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="time"
          aria-label={t({ ko: '표시 시작', en: 'Shown from' })}
          value={style.showFrom ?? ''}
          onChange={(event) => patchStyle({ showFrom: event.target.value || null }, 'showFrom')}
        />
        <Input
          type="time"
          aria-label={t({ ko: '표시 끝', en: 'Shown until' })}
          value={style.showUntil ?? ''}
          onChange={(event) => patchStyle({ showUntil: event.target.value || null }, 'showUntil')}
        />
      </div>
    </div>
  )
}

/** Right column of the editor for the selected widget(s). */
export function WallpaperWidgetInspector({ selectedWidgets, groups, onPatchWidget, onAlign, onDistribute }: WallpaperWidgetInspectorProps) {
  const { t } = useI18n()
  const [tab, setTab] = useState<InspectorTab>('widget')

  if (selectedWidgets.length === 0) return null

  if (selectedWidgets.length > 1) {
    const allLocked = selectedWidgets.every((widget) => widget.locked)
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-base font-semibold">{t({ ko: '위젯 {count}개', en: '{count} widgets' }, { count: selectedWidgets.length })}</div>
          <IconButton variant="ghost" size="icon-sm" label={allLocked ? t({ ko: '모두 잠금 해제', en: 'Unlock all' }) : t({ ko: '모두 잠금', en: 'Lock all' })} onClick={() => selectedWidgets.forEach((widget) => onPatchWidget(widget.id, { locked: !allLocked }, `lock:${widget.id}`))}>
            {allLocked ? <Lock /> : <LockOpen />}
          </IconButton>
        </div>
        <AlignButtons onAlign={onAlign} onDistribute={onDistribute} canDistribute={selectedWidgets.length >= 3} />
      </div>
    )
  }

  const widget = selectedWidgets[0]
  const definition = getWallpaperWidgetDefinition(widget.type)
  const patch = (next: WallpaperWidgetPatch, field: string) => onPatchWidget(widget.id, next, `${field}:${widget.id}`)
  const patchStyle = (next: Partial<WallpaperWidgetStyle>, field: string) => patch({ style: next }, `style.${field}`)
  const updateWidgetSettings = (next: Partial<WallpaperWidgetInstance['settings']>) => patch({ settings: next as Record<string, unknown> }, `settings.${Object.keys(next).join(',')}`)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 truncate text-base font-semibold">{getWallpaperWidgetDisplayTitle(widget, t)}</div>
        <IconButton variant="ghost" size="icon-sm" label={widget.hidden ? t({ ko: '보이기', en: 'Show' }) : t({ ko: '숨기기', en: 'Hide' })} onClick={() => patch({ hidden: !widget.hidden }, 'hidden')}>
          {widget.hidden ? <EyeOff /> : <Eye />}
        </IconButton>
        <IconButton variant="ghost" size="icon-sm" active={widget.locked} label={widget.locked ? t({ ko: '잠금 해제', en: 'Unlock' }) : t({ ko: '잠금', en: 'Lock' })} onClick={() => patch({ locked: !widget.locked }, 'locked')}>
          {widget.locked ? <Lock /> : <LockOpen />}
        </IconButton>
      </div>

      <TextTabs<InspectorTab>
        value={tab}
        onChange={setTab}
        ariaLabel={t({ ko: '위젯 설정', en: 'Widget settings' })}
        items={[
          { value: 'layout', label: t({ ko: '배치', en: 'Layout' }) },
          { value: 'style', label: t({ ko: '스타일', en: 'Style' }) },
          { value: 'widget', label: t(definition.title) },
        ]}
      />

      {tab === 'layout' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <InspectorNumber label="X" value={widget.x} min={0} onCommit={(value) => patch({ x: value }, 'x')} />
            <InspectorNumber label="Y" value={widget.y} min={0} onCommit={(value) => patch({ y: value }, 'y')} />
            <InspectorNumber label="W" value={widget.w} min={1} onCommit={(value) => patch({ w: value }, 'w')} />
            <InspectorNumber label="H" value={widget.h} min={1} onCommit={(value) => patch({ h: value }, 'h')} />
            <InspectorNumber label="↻" value={widget.rotation} min={-360} max={360} suffix="°" onCommit={(value) => patch({ rotation: value }, 'rotation')} />
            <InspectorNumber label="%" value={widget.style.opacity} min={5} max={100} onCommit={(value) => patchStyle({ opacity: value }, 'opacity')} />
          </div>
          <AlignButtons onAlign={onAlign} onDistribute={onDistribute} canDistribute={false} />
          <InspectorRow label={t({ ko: '제목', en: 'Title' })}>
            <Input variant="settings" placeholder={t(definition.title)} value={widget.settings.title} onChange={(event) => updateWidgetSettings({ title: event.target.value })} />
          </InspectorRow>
        </div>
      ) : tab === 'style' ? (
        <StyleFields widget={widget} patchStyle={patchStyle} />
      ) : (
        <WallpaperWidgetTypeEditorFields selectedWidget={widget} groups={groups} updateWidgetSettings={updateWidgetSettings} />
      )}
    </div>
  )
}

import { Blend, Contrast, Eye, LockOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { SliderRow } from '@/components/ui/slider-row'
import { useI18n } from '@/i18n'
import { NEUTRAL_ADJUSTMENTS, type Adjustments } from '../engine/adjust'
import type { EditorEngine, EditorSnapshot } from '../engine/editor-engine'

type NumericKey = 'brightness' | 'contrast' | 'saturation' | 'hue' | 'temperature'

const SLIDERS: Array<{ key: NumericKey; range: number; label: { ko: string; en: string } }> = [
  { key: 'brightness', range: 100, label: { ko: '밝기', en: 'Brightness' } },
  { key: 'contrast', range: 100, label: { ko: '대비', en: 'Contrast' } },
  { key: 'saturation', range: 100, label: { ko: '채도', en: 'Saturation' } },
  { key: 'hue', range: 180, label: { ko: '색조', en: 'Hue' } },
  { key: 'temperature', range: 100, label: { ko: '색온도', en: 'Temperature' } },
]

/** Colour adjustment of the active layer (inside the selection, if any); previewed live, kept with 적용. */
export function AdjustPanel({ engine, snapshot }: { engine: EditorEngine; snapshot: EditorSnapshot }) {
  const { t } = useI18n()
  const value = snapshot.adjust?.value ?? NEUTRAL_ADJUSTMENTS
  const active = snapshot.layers.find((layer) => layer.id === (snapshot.adjust?.layerId ?? snapshot.activeLayerId) && layer.kind === 'paint') ?? null
  const blocked = !active || active.locked || !active.visible
  const pending = Boolean(snapshot.adjust)
  const change = (patch: Partial<Adjustments>) => engine.previewAdjust(patch)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 pr-2 pl-4">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {active ? active.name : t({ ko: '레이어를 골라', en: 'Pick a layer' })}
          {snapshot.hasSelection ? ` · ${t({ ko: '선택 영역', en: 'Selection' })}` : ''}
        </span>
        {active && active.locked ? (
          <IconButton size="icon-sm" variant="ghost" label={t({ ko: '잠금 풀기', en: 'Unlock' })} onClick={() => engine.setLayerLocked(active.id, false)}>
            <LockOpen className="size-4" />
          </IconButton>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4">
        {SLIDERS.map((item) => (
          <SliderRow
            key={item.key}
            className="h-12 shrink-0"
            label={t(item.label)}
            min={-item.range}
            max={item.range}
            disabled={blocked}
            value={value[item.key]}
            readout={`${value[item.key] > 0 ? '+' : ''}${value[item.key]}`}
            onChange={(next) => change({ [item.key]: next })}
          />
        ))}
        <div className="flex shrink-0 items-center gap-0.5 pt-1.5">
          <IconButton size="icon-sm" variant="ghost" active={value.grayscale} disabled={blocked} label={t({ ko: '흑백', en: 'Grayscale' })} onClick={() => change({ grayscale: !value.grayscale })}>
            <Contrast className="size-4" />
          </IconButton>
          <IconButton size="icon-sm" variant="ghost" active={value.invert} disabled={blocked} label={t({ ko: '색 반전', en: 'Invert colors' })} onClick={() => change({ invert: !value.invert })}>
            <Blend className="size-4" />
          </IconButton>
          <IconButton
            size="icon-sm"
            variant="ghost"
            disabled={!pending}
            label={t({ ko: '누르는 동안 원본 보기', en: 'Hold to compare' })}
            onPointerDown={() => engine.setAdjustCompare(true)}
            onPointerUp={() => engine.setAdjustCompare(false)}
            onPointerLeave={() => engine.setAdjustCompare(false)}
          >
            <Eye className="size-4" />
          </IconButton>
        </div>
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t border-line px-4 py-3">
        <Button variant="ghost" size="sm" disabled={!pending} onClick={() => engine.cancelAdjust()}>
          {t({ ko: '초기화', en: 'Reset' })}
        </Button>
        <Button variant="secondary" size="sm" className="font-bold" disabled={!pending} onClick={() => engine.commitAdjust()}>
          {t({ ko: '적용', en: 'Apply' })}
        </Button>
      </div>
    </div>
  )
}

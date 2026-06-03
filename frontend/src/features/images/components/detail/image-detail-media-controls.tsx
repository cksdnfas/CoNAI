import { ChevronLeft, ChevronRight, Grid2X2, ImageIcon, Lock, RotateCcw, RotateCw, ScanSearch, Undo2, Unlock, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ImageDetailRenderMode } from './image-detail-utils'
import type { PixelPreviewMode, PixelPreviewSettings } from './image-detail-pixel-preview-utils'

interface ImageDetailAuxiliaryControlsProps {
  canToggleRenderMode: boolean
  canUsePixelPreview: boolean
  renderMode: ImageDetailRenderMode
  pixelPreviewMode: PixelPreviewMode
  isPixelPreviewEnabled: boolean
  isPixelPreviewPanelOpen: boolean
  activePixelPreviewSettings: PixelPreviewSettings
  onToggleRenderMode: () => void
  onTogglePixelPreviewPanel: () => void
  onTogglePixelPreviewEnabled: () => void
  onSetPixelPreviewMode: (mode: PixelPreviewMode) => void
  onUpdatePixelPreviewSettings: (patch: Partial<PixelPreviewSettings>) => void
}

interface ImageDetailTransformControlsProps {
  canZoomIn: boolean
  canZoomOut: boolean
  isControlsCollapsed: boolean
  isDefaultView: boolean
  isWheelZoomEnabled: boolean
  transformSummary: string
  onToggleWheelZoomEnabled: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onRotateLeft: () => void
  onRotateRight: () => void
  onResetView: () => void
  onToggleControlsCollapsed: () => void
}

function usePixelPreviewModeLabels() {
  const { t } = useI18n()

  return {
    off: t({ ko: '꺼짐', en: 'Off' }),
    soft: t({ ko: '약', en: 'Soft' }),
    medium: t('images.components.detail.image.detail.media.medium'),
    strong: t('images.components.detail.image.detail.media.high'),
    custom: t('images.components.detail.image.detail.media.custom'),
  } satisfies Record<PixelPreviewMode, string>
}

export function ImageDetailAuxiliaryControls({
  canToggleRenderMode,
  canUsePixelPreview,
  renderMode,
  pixelPreviewMode,
  isPixelPreviewEnabled,
  isPixelPreviewPanelOpen,
  activePixelPreviewSettings,
  onToggleRenderMode,
  onTogglePixelPreviewPanel,
  onTogglePixelPreviewEnabled,
  onSetPixelPreviewMode,
  onUpdatePixelPreviewSettings,
}: ImageDetailAuxiliaryControlsProps) {
  const { t } = useI18n()
  const pixelPreviewModeLabels = usePixelPreviewModeLabels()

  if (!canToggleRenderMode && !canUsePixelPreview) {
    return null
  }

  return (
    <div className="absolute bottom-3 left-3 z-30 flex flex-col items-start gap-2" onPointerDown={(event) => event.stopPropagation()}>
      {canUsePixelPreview ? (
        <div className="relative">
          <Button
            size="icon-sm"
            type="button"
            variant="outline"
            className={cn('relative bg-background text-foreground shadow-[0_16px_36px_rgba(0,0,0,0.38)] hover:bg-surface-high', pixelPreviewMode !== 'off' && 'border-primary/45 text-primary')}
            onClick={onTogglePixelPreviewPanel}
            title={t({ ko: '필터: {mode}', en: 'Filter: {mode}' }, { mode: pixelPreviewModeLabels[pixelPreviewMode] })}
            aria-label={t({ ko: '필터 설정 열기: {mode}', en: 'Open filter settings: {mode}' }, { mode: pixelPreviewModeLabels[pixelPreviewMode] })}
          >
            <Grid2X2 className="h-4 w-4 stroke-[2.5]" />
            {pixelPreviewMode !== 'off' ? (
              <span className="absolute -right-1 -top-1 rounded-full border border-background bg-primary px-1 text-[9px] font-semibold leading-3 text-primary-foreground">{pixelPreviewModeLabels[pixelPreviewMode]}</span>
            ) : null}
          </Button>

          {isPixelPreviewPanelOpen ? (
            <div className="absolute bottom-full left-0 mb-2 w-72 rounded-md border border-border bg-background p-3 text-xs text-foreground shadow-[0_18px_42px_rgba(0,0,0,0.45)]">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="font-semibold">{t('images.components.detail.image.detail.media.filter')}</div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isPixelPreviewEnabled}
                  className={cn(
                    'flex h-7 items-center gap-2 rounded-full border px-1.5 text-[11px] font-medium transition-colors',
                    isPixelPreviewEnabled ? 'border-primary/60 bg-primary/18 text-primary' : 'border-border bg-surface-container text-muted-foreground',
                  )}
                  onClick={onTogglePixelPreviewEnabled}
                >
                  <span className="min-w-8 text-center">{isPixelPreviewEnabled ? 'ON' : 'OFF'}</span>
                  <span className={cn('h-4 w-7 rounded-full p-0.5 transition-colors', isPixelPreviewEnabled ? 'bg-primary' : 'bg-muted-foreground/35')}>
                    <span className={cn('block size-3 rounded-full bg-background transition-transform', isPixelPreviewEnabled && 'translate-x-3')} />
                  </span>
                </button>
              </div>
              <div className="mb-3 grid grid-cols-3 gap-1.5">
                {(['soft', 'medium', 'strong'] as const).map((mode) => (
                  <Button key={mode} size="sm" type="button" variant={pixelPreviewMode === mode ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => onSetPixelPreviewMode(mode)}>
                    {pixelPreviewModeLabels[mode]}
                  </Button>
                ))}
              </div>
              <div className="space-y-2.5">
                <label className="block">
                  <div className="mb-1 flex justify-between text-muted-foreground"><span>{t('images.components.detail.image.detail.media.resolution')}</span><span>{activePixelPreviewSettings.targetLongEdge}px</span></div>
                  <input className="w-full accent-primary" type="range" min={64} max={1024} step={64} value={activePixelPreviewSettings.targetLongEdge} onChange={(event) => onUpdatePixelPreviewSettings({ targetLongEdge: Number(event.currentTarget.value) })} />
                </label>
                <label className="block">
                  <div className="mb-1 flex justify-between text-muted-foreground"><span>{t('images.components.detail.image.detail.media.colors')}</span><span>{activePixelPreviewSettings.colorCount}</span></div>
                  <input className="w-full accent-primary" type="range" min={32} max={256} step={8} value={activePixelPreviewSettings.colorCount} onChange={(event) => onUpdatePixelPreviewSettings({ colorCount: Number(event.currentTarget.value) })} />
                </label>
                <label className="block">
                  <div className="mb-1 flex justify-between text-muted-foreground"><span>{t('images.components.detail.image.detail.media.dithering')}</span><span>{Math.round(activePixelPreviewSettings.ditherStrength * 100)}</span></div>
                  <input className="w-full accent-primary" type="range" min={0} max={60} step={2} value={Math.round(activePixelPreviewSettings.ditherStrength * 100)} onChange={(event) => onUpdatePixelPreviewSettings({ ditherStrength: Number(event.currentTarget.value) / 100 })} />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-sm border border-border/70 bg-surface-container/50 px-2.5 py-2 text-muted-foreground">
                  <span>{t('images.components.detail.image.detail.media.smooth.downscale')}</span>
                  <input type="checkbox" className="size-4 accent-primary" checked={activePixelPreviewSettings.smoothing} onChange={(event) => onUpdatePixelPreviewSettings({ smoothing: event.currentTarget.checked })} />
                </label>
                <label className="block">
                  <div className="mb-1 flex justify-between text-muted-foreground"><span>{t('images.components.detail.image.detail.media.edge.boost')}</span><span>{Math.round(activePixelPreviewSettings.edgeBoost * 100)}</span></div>
                  <input className="w-full accent-primary" type="range" min={0} max={24} step={1} value={Math.round(activePixelPreviewSettings.edgeBoost * 100)} onChange={(event) => onUpdatePixelPreviewSettings({ edgeBoost: Number(event.currentTarget.value) / 100 })} />
                </label>
                <label className="block">
                  <div className="mb-1 flex justify-between text-muted-foreground"><span>{t('images.components.detail.image.detail.media.sharpening')}</span><span>{Math.round(activePixelPreviewSettings.sharpness * 100)}</span></div>
                  <input className="w-full accent-primary" type="range" min={0} max={50} step={2} value={Math.round(activePixelPreviewSettings.sharpness * 100)} onChange={(event) => onUpdatePixelPreviewSettings({ sharpness: Number(event.currentTarget.value) / 100 })} />
                </label>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {canToggleRenderMode ? (
        <Button
          size="icon-sm"
          type="button"
          variant="outline"
          className="bg-background shadow-[0_16px_36px_rgba(0,0,0,0.38)] hover:bg-surface-high"
          onClick={onToggleRenderMode}
          title={renderMode === 'original' ? t('images.components.detail.image.detail.media.view.thumbnails') : t('images.components.detail.image.detail.media.view.original')}
          aria-label={renderMode === 'original' ? t('images.components.detail.image.detail.media.view.thumbnails') : t('images.components.detail.image.detail.media.view.original')}
        >
          {renderMode === 'original' ? <ImageIcon className="h-4 w-4" /> : <ScanSearch className="h-4 w-4" />}
        </Button>
      ) : null}
    </div>
  )
}

export function ImageDetailTransformControls({
  canZoomIn,
  canZoomOut,
  isControlsCollapsed,
  isDefaultView,
  isWheelZoomEnabled,
  transformSummary,
  onToggleWheelZoomEnabled,
  onZoomIn,
  onZoomOut,
  onRotateLeft,
  onRotateRight,
  onResetView,
  onToggleControlsCollapsed,
}: ImageDetailTransformControlsProps) {
  const { t } = useI18n()

  return (
    <div className="absolute bottom-3 right-3 z-30 flex items-end gap-2" onPointerDown={(event) => event.stopPropagation()}>
      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5 rounded-sm border border-border bg-background p-2 text-foreground shadow-[0_16px_36px_rgba(0,0,0,0.38)] transition-all duration-200 ease-out',
          isControlsCollapsed ? 'pointer-events-none translate-x-3 opacity-0' : 'translate-x-0 opacity-100',
        )}
      >
        {!isDefaultView ? <div className="hidden px-2 text-[11px] text-muted-foreground sm:block">{transformSummary}</div> : null}
        <Button
          size="icon-sm"
          type="button"
          variant="outline"
          className={cn('bg-surface-container hover:bg-surface-high', isWheelZoomEnabled && 'border-primary/40 text-primary')}
          onClick={onToggleWheelZoomEnabled}
          title={isWheelZoomEnabled ? t('images.components.detail.image.detail.media.lock.zoom') : t('images.components.detail.image.detail.media.enable.zoom')}
          aria-label={isWheelZoomEnabled ? t('images.components.detail.image.detail.media.lock.zoom.in.out') : t('images.components.detail.image.detail.media.enable.zoom.in.out')}
        >
          {isWheelZoomEnabled ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
        </Button>
        <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={onZoomOut} title={t('images.components.detail.image.detail.media.zoom.out')} aria-label={t('images.components.detail.image.detail.media.zoom.out')} disabled={!canZoomOut}>
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={onZoomIn} title={t('images.components.detail.image.detail.media.zoom.in')} aria-label={t('images.components.detail.image.detail.media.zoom.in')} disabled={!canZoomIn}>
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={onRotateLeft} title={t('images.components.detail.image.detail.media.rotate.left')} aria-label={t('images.components.detail.image.detail.media.rotate.left')}>
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={onRotateRight} title={t('images.components.detail.image.detail.media.rotate.right')} aria-label={t('images.components.detail.image.detail.media.rotate.right')}>
          <RotateCw className="h-4 w-4" />
        </Button>
        {!isDefaultView ? (
          <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={onResetView} title={t('images.components.detail.image.detail.media.reset')} aria-label={t('images.components.detail.image.detail.media.reset')}>
            <Undo2 className="h-4 w-4" />
          </Button>
        ) : null}
        <Button size="icon-sm" type="button" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={onToggleControlsCollapsed} title={t('images.components.detail.image.detail.media.collapse.controls')} aria-label={t('images.components.detail.image.detail.media.collapse.controls')}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {isControlsCollapsed ? (
        <Button
          size="icon-sm"
          type="button"
          variant="outline"
          className="border-primary/55 bg-primary text-primary-foreground shadow-[0_16px_36px_rgba(0,0,0,0.38)] hover:bg-primary/92 hover:text-primary-foreground"
          onClick={onToggleControlsCollapsed}
          title={t('images.components.detail.image.detail.media.expand.controls')}
          aria-label={t('images.components.detail.image.detail.media.expand.controls')}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  )
}

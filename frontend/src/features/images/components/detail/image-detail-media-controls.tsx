import { ChevronLeft, ChevronRight, Grid2X2, ImageIcon, Lock, RotateCcw, RotateCw, ScanSearch, Undo2, Unlock, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { Panel } from '@/components/ui/panel'
import { Switch } from '@/components/ui/switch'
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
    <Panel
      tone="high"
      padding="none"
      className="absolute bottom-3 left-3 z-30 flex flex-col items-start gap-1 p-1 shadow-elevation-2"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {canUsePixelPreview ? (
        <div className="relative">
          <IconButton
            {...toolbarButtonProps}
            className={cn('relative', pixelPreviewMode !== 'off' && 'text-primary')}
            onClick={onTogglePixelPreviewPanel}
            aria-expanded={isPixelPreviewPanelOpen}
            label={t({ ko: '필터: {mode}', en: 'Filter: {mode}' }, { mode: pixelPreviewModeLabels[pixelPreviewMode] })}
            tooltipSide="right"
          >
            <Grid2X2 className="h-4 w-4 stroke-[2.5]" />
            {pixelPreviewMode !== 'off' ? <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" aria-hidden /> : null}
          </IconButton>

          {isPixelPreviewPanelOpen ? (
            <Panel tone="high" radius="md" padding="none" className="absolute bottom-full left-0 mb-2 w-72 p-3 text-xs text-foreground shadow-elevation-2">
              <div className="mb-2 flex items-center justify-between gap-3">
                <label htmlFor="pixel-preview-enabled" className="font-semibold">{t('images.components.detail.image.detail.media.filter')}</label>
                <Switch id="pixel-preview-enabled" size="sm" checked={isPixelPreviewEnabled} onCheckedChange={() => onTogglePixelPreviewEnabled()} />
              </div>
              <div className="mb-3 grid grid-cols-3 gap-1.5">
                {(['soft', 'medium', 'strong'] as const).map((mode) => (
                  <Button key={mode} size="xs" type="button" variant={pixelPreviewMode === mode ? 'default' : 'secondary'} onClick={() => onSetPixelPreviewMode(mode)}>
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
                <label className="flex items-center justify-between gap-3 py-0.5 text-muted-foreground">
                  <span>{t('images.components.detail.image.detail.media.smooth.downscale')}</span>
                  <Checkbox checked={activePixelPreviewSettings.smoothing} onCheckedChange={(checked) => onUpdatePixelPreviewSettings({ smoothing: checked === true })} />
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
            </Panel>
          ) : null}
        </div>
      ) : null}

      {canToggleRenderMode ? (
        <IconButton
          {...toolbarButtonProps}
          onClick={onToggleRenderMode}
          label={renderMode === 'original' ? t('images.components.detail.image.detail.media.view.thumbnails') : t('images.components.detail.image.detail.media.view.original')}
          tooltipSide="right"
        >
          {renderMode === 'original' ? <ImageIcon className="h-4 w-4" /> : <ScanSearch className="h-4 w-4" />}
        </IconButton>
      ) : null}
    </Panel>
  )
}

/** Viewer toolbars share one size and tone so every icon control lines up. */
const toolbarButtonProps = { size: 'icon-sm', variant: 'ghost', tooltipSide: 'top' } as const

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
      <Panel
        tone="high"
        padding="none"
        className={cn(
          'flex flex-wrap items-center gap-1 p-1 text-foreground shadow-elevation-2 transition-all duration-200 ease-out',
          isControlsCollapsed ? 'pointer-events-none translate-x-3 opacity-0' : 'translate-x-0 opacity-100',
        )}
      >
        {!isDefaultView ? <div className="hidden px-2 text-2xs text-muted-foreground tabular-nums sm:block">{transformSummary}</div> : null}
        <IconButton
          {...toolbarButtonProps}
          className="aria-pressed:bg-primary/12 aria-pressed:text-primary"
          aria-pressed={isWheelZoomEnabled}
          onClick={onToggleWheelZoomEnabled}
          label={isWheelZoomEnabled ? t('images.components.detail.image.detail.media.lock.zoom') : t('images.components.detail.image.detail.media.enable.zoom')}
        >
          {isWheelZoomEnabled ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
        </IconButton>
        <IconButton {...toolbarButtonProps} onClick={onZoomOut} label={t('images.components.detail.image.detail.media.zoom.out')} disabled={!canZoomOut}>
          <ZoomOut className="h-4 w-4" />
        </IconButton>
        <IconButton {...toolbarButtonProps} onClick={onZoomIn} label={t('images.components.detail.image.detail.media.zoom.in')} disabled={!canZoomIn}>
          <ZoomIn className="h-4 w-4" />
        </IconButton>
        <IconButton {...toolbarButtonProps} onClick={onRotateLeft} label={t('images.components.detail.image.detail.media.rotate.left')}>
          <RotateCcw className="h-4 w-4" />
        </IconButton>
        <IconButton {...toolbarButtonProps} onClick={onRotateRight} label={t('images.components.detail.image.detail.media.rotate.right')}>
          <RotateCw className="h-4 w-4" />
        </IconButton>
        {!isDefaultView ? (
          <IconButton {...toolbarButtonProps} onClick={onResetView} label={t('images.components.detail.image.detail.media.reset')}>
            <Undo2 className="h-4 w-4" />
          </IconButton>
        ) : null}
        <IconButton {...toolbarButtonProps} onClick={onToggleControlsCollapsed} label={t('images.components.detail.image.detail.media.collapse.controls')}>
          <ChevronRight className="h-4 w-4" />
        </IconButton>
      </Panel>

      {isControlsCollapsed ? (
        <Panel tone="high" padding="none" className="p-1 shadow-elevation-2">
          <IconButton {...toolbarButtonProps} onClick={onToggleControlsCollapsed} label={t('images.components.detail.image.detail.media.expand.controls')}>
            <ChevronLeft className="h-4 w-4" />
          </IconButton>
        </Panel>
      ) : null}
    </div>
  )
}

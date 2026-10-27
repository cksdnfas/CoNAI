import type { CSSProperties } from 'react'
import { Modal } from '@/components/ui/modal'
import { MediaCard } from '@/components/common/media-card'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { getWallpaperWidgetIcon } from './wallpaper-widget-library-sidebar'
import { getWallpaperTemplatePreview, WALLPAPER_TEMPLATES, type WallpaperTemplateDefinition, type WallpaperTemplatePreview } from './wallpaper-templates'

interface WallpaperTemplateModalProps {
  open: boolean
  onClose: () => void
  onApply: (template: WallpaperTemplateDefinition) => void
}

function previewBackground({ background, themeMode }: WallpaperTemplatePreview): string {
  switch (background.kind) {
    case 'gradient':
      return `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})`
    case 'color':
      return background.color
    default:
      return themeMode === 'light' ? '#f1efea' : 'var(--background)'
  }
}

/** The template's widgets as blocks on its background (landscape). */
function TemplateThumbnail({ preview }: { preview: WallpaperTemplatePreview }) {
  const ink = preview.themeMode === 'light' ? '0 0 0' : '255 255 255'
  return (
    <div className="relative aspect-video overflow-hidden" style={{ background: previewBackground(preview) }}>
      {preview.widgets.map((widget, index) => {
        const [x, y, w, h] = widget.spot
        const Icon = getWallpaperWidgetIcon(widget.type)
        const look: CSSProperties = widget.variant === 'none'
          ? { border: `1px dashed rgb(${ink} / 0.22)` }
          : widget.variant === 'outline'
            ? { border: `1px solid rgb(${ink} / 0.35)` }
            : { background: `rgb(${ink} / ${widget.variant === 'glass' ? 0.12 : 0.16})` }
        return (
          <div
            key={`${widget.type}-${index}`}
            className="absolute flex items-center justify-center rounded-xs"
            style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%`, color: `rgb(${ink} / 0.5)`, ...look }}
          >
            <Icon className="size-3.5" />
          </div>
        )
      })}
    </div>
  )
}

export function WallpaperTemplateModal({ open, onClose, onApply }: WallpaperTemplateModalProps) {
  const { t } = useI18n()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t({ ko: '빠른 시작 템플릿', en: 'Quick-start templates' })}
      size="lg"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {WALLPAPER_TEMPLATES.map((template) => (
          <Tip key={template.id} content={t(template.description)}>
            <MediaCard
              variant="boxed"
              onClick={() => onApply(template)}
              media={<TemplateThumbnail preview={getWallpaperTemplatePreview(template.id)} />}
              title={t(template.name)}
            />
          </Tip>
        ))}
      </div>
    </Modal>
  )
}

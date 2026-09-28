import { LayoutTemplate } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Panel } from '@/components/ui/panel'
import { useI18n } from '@/i18n'
import { WALLPAPER_TEMPLATES, type WallpaperTemplateDefinition } from './wallpaper-templates'

interface WallpaperTemplateModalProps {
  open: boolean
  onClose: () => void
  onApply: (template: WallpaperTemplateDefinition) => void
}

export function WallpaperTemplateModal({ open, onClose, onApply }: WallpaperTemplateModalProps) {
  const { t } = useI18n()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t({ ko: '빠른 시작 템플릿', en: 'Quick-start templates' })}
      widthClassName="max-w-3xl"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {WALLPAPER_TEMPLATES.map((template) => (
          <Panel key={template.id} asChild tone="low" padding="none" interactive className="group overflow-hidden text-left">
            <button type="button" onClick={() => onApply(template)}>
              <div className="relative h-28 overflow-hidden" style={{ background: template.accent }}>
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(255,255,255,0.17),transparent_42%)]" />
                <LayoutTemplate className="absolute right-4 bottom-4 h-8 w-8 text-white/45 transition group-hover:text-white/70" />
              </div>
              <div className="p-4">
                <div className="font-semibold text-foreground">{t(template.name)}</div>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">{t(template.description)}</p>
              </div>
            </button>
          </Panel>
        ))}
      </div>
    </Modal>
  )
}

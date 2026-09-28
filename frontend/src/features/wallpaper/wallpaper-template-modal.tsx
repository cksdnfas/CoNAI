import { LayoutTemplate } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
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
      description={t({ ko: '검증된 기존 위젯 조합으로 시작해. 적용 후 모든 요소를 자유롭게 바꿀 수 있어.', en: 'Start with proven widget combinations. Every element remains editable.' })}
      widthClassName="max-w-3xl"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {WALLPAPER_TEMPLATES.map((template) => (
          // eslint-disable-next-line no-restricted-syntax -- rich template card (preview art + copy); Button's inline sizing does not fit
          <button
            key={template.id}
            type="button"
            className="group cursor-pointer overflow-hidden rounded-sm bg-surface-low text-left transition-colors hover:bg-surface-high focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            onClick={() => onApply(template)}
          >
            <div className="relative h-28 overflow-hidden" style={{ background: template.accent }}>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(255,255,255,0.17),transparent_42%)]" />
              <LayoutTemplate className="absolute right-4 bottom-4 h-8 w-8 text-white/45 transition group-hover:text-white/70" />
            </div>
            <div className="p-4">
              <div className="font-semibold text-foreground">{t(template.name)}</div>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">{t(template.description)}</p>
              <span className="mt-3 inline-block text-sm font-medium text-secondary group-hover:underline underline-offset-4">
                {t({ ko: '이 템플릿 사용', en: 'Use this template' })}
              </span>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  )
}

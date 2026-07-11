import { LayoutTemplate } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SettingsModal } from '@/features/settings/components/settings-modal'
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
    <SettingsModal
      open={open}
      onClose={onClose}
      title={t({ ko: '빠른 시작 템플릿', en: 'Quick-start templates' })}
      description={t({ ko: '검증된 기존 위젯 조합으로 시작해. 적용 후 모든 요소를 자유롭게 바꿀 수 있어.', en: 'Start with proven widget combinations. Every element remains editable.' })}
      widthClassName="max-w-3xl"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {WALLPAPER_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            className="group overflow-hidden rounded-sm border border-border bg-surface-low text-left transition hover:border-secondary/70 hover:bg-surface-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
            onClick={() => onApply(template)}
          >
            <div className="relative h-28 overflow-hidden" style={{ background: template.accent }}>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(255,255,255,0.17),transparent_42%)]" />
              <LayoutTemplate className="absolute right-4 bottom-4 h-8 w-8 text-white/45 transition group-hover:text-white/70" />
            </div>
            <div className="p-4">
              <div className="font-semibold text-foreground">{t(template.name)}</div>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">{t(template.description)}</p>
              <Button type="button" variant="ghost" size="sm" className="mt-3 pointer-events-none px-0 text-secondary">
                {t({ ko: '이 템플릿 사용', en: 'Use this template' })}
              </Button>
            </div>
          </button>
        ))}
      </div>
    </SettingsModal>
  )
}

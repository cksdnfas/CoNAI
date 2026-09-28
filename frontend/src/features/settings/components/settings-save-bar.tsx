import { LoaderCircle, Save, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useI18n } from '@/i18n'
import type { SettingsDraftSection } from '../settings-draft-sections'
import type { SettingsTab } from '../settings-tabs'

interface SettingsSaveBarProps {
  dirtySections: SettingsDraftSection[]
  isSaving: boolean
  onSave: () => void
  onDiscard: () => void
  onOpenTab: (tab: SettingsTab) => void
}

/** Sticky page-wide bar that saves or discards every edited settings section at once. */
export function SettingsSaveBar({ dirtySections, isSaving, onSave, onDiscard, onOpenTab }: SettingsSaveBarProps) {
  const { t, formatNumber } = useI18n()
  const confirm = useConfirm()

  if (dirtySections.length === 0 && !isSaving) {
    return null
  }

  const handleDiscard = async () => {
    const confirmed = await confirm({
      title: t({ ko: '변경 취소', en: 'Discard changes' }),
      description: t(
        { ko: '저장하지 않은 변경 {count}건을 모두 되돌릴까?', en: 'Revert all {count} unsaved changes?' },
        { count: formatNumber(dirtySections.length) },
      ),
      confirmLabel: t({ ko: '되돌리기', en: 'Revert' }),
      cancelLabel: t({ ko: '계속 편집', en: 'Keep editing' }),
      tone: 'destructive',
    })
    if (confirmed) {
      onDiscard()
    }
  }

  return (
    <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-30" role="region" aria-label={t({ ko: '설정 저장', en: 'Save settings' })}>
      <div className="theme-floating-panel flex flex-col gap-3 rounded-sm bg-surface-high px-4 py-3 shadow-elevation-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1" aria-live="polite">
          <div className="text-sm font-semibold text-foreground">
            {t({ ko: '변경 {count}건', en: '{count} unsaved changes' }, { count: formatNumber(dirtySections.length) })}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {dirtySections.map((section) => (
              <Button
                key={section.id}
                type="button"
                size="xs"
                variant="subtle"
                onClick={() => onOpenTab(section.tab)}
              >
                {section.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={isSaving || dirtySections.length === 0} onClick={() => void handleDiscard()}>
            <Undo2 className="h-4 w-4" />
            {t({ ko: '취소', en: 'Cancel' })}
          </Button>
          <Button type="button" size="sm" disabled={isSaving || dirtySections.length === 0} onClick={onSave}>
            {isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isSaving ? t({ ko: '저장 중', en: 'Saving' }) : t({ ko: '저장', en: 'Save' })}
          </Button>
        </div>
      </div>
    </div>
  )
}

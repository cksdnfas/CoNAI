import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { FloatingSaveBar } from '@/components/ui/floating-save-bar'
import { useI18n } from '@/i18n'
import { usePageSaveShortcut } from '@/lib/keyboard-shortcut'
import type { SettingsDraftSection } from '../settings-draft-sections'
import type { SettingsTab } from '../settings-tabs'

interface SettingsSaveBarProps {
  dirtySections: SettingsDraftSection[]
  isSaving: boolean
  onSave: () => void
  onDiscard: () => void
  onOpenTab: (tab: SettingsTab) => void
}

/** Floating page-wide bar (the one surface with a shadow on the page) that saves or discards every edited settings section at once. */
export function SettingsSaveBar({ dirtySections, isSaving, onSave, onDiscard, onOpenTab }: SettingsSaveBarProps) {
  const { t, formatNumber } = useI18n()
  const confirm = useConfirm()
  usePageSaveShortcut(dirtySections.length ? onSave : undefined, isSaving)

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
    <FloatingSaveBar
      ariaLabel={t({ ko: '설정 저장', en: 'Save settings' })}
      label={t({ ko: '변경 {count}건', en: '{count} unsaved changes' }, { count: formatNumber(dirtySections.length) })}
      saving={isSaving}
      canSave={dirtySections.length > 0}
      onSave={onSave}
      onDiscard={dirtySections.length ? () => void handleDiscard() : undefined}
    >
      {dirtySections.map((section) => (
        <Button key={section.id} type="button" size="xs" variant="subtle" onClick={() => onOpenTab(section.tab)}>
          {section.label}
        </Button>
      ))}
    </FloatingSaveBar>
  )
}

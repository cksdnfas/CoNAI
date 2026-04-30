import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsField, SettingsInsetBlock, SettingsModalBody, SettingsModalFooter } from '@/features/settings/components/settings-primitives'
import { useI18n } from '@/i18n'
import { DEFAULT_ARTIST_LINK_URL_TEMPLATE } from '@/types/settings'

interface ArtistPromptLinkSettingsModalProps {
  open: boolean
  initialTemplate: string
  isSaving?: boolean
  onClose: () => void
  onSave: (template: string) => void
}

export function ArtistPromptLinkSettingsModal({ open, initialTemplate, isSaving = false, onClose, onSave }: ArtistPromptLinkSettingsModalProps) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(initialTemplate || DEFAULT_ARTIST_LINK_URL_TEMPLATE)

  useEffect(() => {
    if (!open) {
      return
    }

    setDraft(initialTemplate || DEFAULT_ARTIST_LINK_URL_TEMPLATE)
  }, [initialTemplate, open])

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={t('images.components.detail.artist.prompt.link.settings.modal.artist.prompt.link.settings')}
      description={t('images.components.detail.artist.prompt.link.settings.modal.value.will.be.replaced.with.the.badge', { key: '{key}' })}
      widthClassName="max-w-2xl"
    >
      <SettingsModalBody>
        <SettingsField label="URL template">
          <Input
            variant="detail"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={DEFAULT_ARTIST_LINK_URL_TEMPLATE}
          />
        </SettingsField>

        <SettingsInsetBlock className="text-xs text-muted-foreground">
          {t({ ko: '예시', en: 'Example' })}: {DEFAULT_ARTIST_LINK_URL_TEMPLATE}
        </SettingsInsetBlock>

        <SettingsModalFooter className="justify-between">
          <Button type="button" variant="outline" onClick={() => setDraft(DEFAULT_ARTIST_LINK_URL_TEMPLATE)}>
            <RotateCcw className="h-4 w-4" />
            {t('images.components.image.list.image.list.column.floating.control.reset.to.default')}
          </Button>

          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t({ ko: '취소', en: 'Cancel' })}
            </Button>
            <Button type="button" onClick={() => onSave(draft.trim() || DEFAULT_ARTIST_LINK_URL_TEMPLATE)} disabled={isSaving}>
              {t({ ko: '저장', en: 'Save' })}
            </Button>
          </div>
        </SettingsModalFooter>
      </SettingsModalBody>
    </SettingsModal>
  )
}

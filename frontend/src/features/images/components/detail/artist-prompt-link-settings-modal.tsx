import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useI18n } from '@/i18n'
import { DEFAULT_ARTIST_LINK_URL_TEMPLATE } from '@/lib/settings-defaults'

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
    <Modal
      open={open}
      onClose={onClose}
      title={t('images.components.detail.artist.prompt.link.settings.modal.artist.prompt.link.settings')}
      widthClassName="max-w-2xl"
    >
      <ModalBody>
        <Field label="URL template" info={t('images.components.detail.artist.prompt.link.settings.modal.value.will.be.replaced.with.the.badge', { key: '{key}' })}>
          <Input
            variant="detail"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={DEFAULT_ARTIST_LINK_URL_TEMPLATE}
          />
        </Field>

        <ModalFooter className="justify-between">
          <IconButton variant="ghost" onClick={() => setDraft(DEFAULT_ARTIST_LINK_URL_TEMPLATE)} label={t('images.components.image.list.image.list.column.floating.control.reset.to.default')}>
            <RotateCcw className="h-4 w-4" />
          </IconButton>

          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t({ ko: '취소', en: 'Cancel' })}
            </Button>
            <Button type="button" onClick={() => onSave(draft.trim() || DEFAULT_ARTIST_LINK_URL_TEMPLATE)} disabled={isSaving}>
              {t({ ko: '저장', en: 'Save' })}
            </Button>
          </div>
        </ModalFooter>
      </ModalBody>
    </Modal>
  )
}

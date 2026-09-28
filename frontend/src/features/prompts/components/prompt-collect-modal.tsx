import { useEffect, useState, type FormEvent } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useI18n } from '@/i18n'

interface PromptCollectModalProps {
  open: boolean
  isSubmitting?: boolean
  onClose: () => void
  onSubmit: (input: { prompt: string; negativePrompt: string }) => Promise<void>
}

export function PromptCollectModal({ open, isSubmitting = false, onClose, onSubmit }: PromptCollectModalProps) {
  const { t } = useI18n()
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    setPrompt('')
    setNegativePrompt('')
    setFormError(null)
  }, [open])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedPrompt = prompt.trim()
    const trimmedNegativePrompt = negativePrompt.trim()

    if (!trimmedPrompt && !trimmedNegativePrompt) {
      setFormError(t('prompts.components.prompt.collect.modal.enter.either.a.positive.or.negative.prompt'))
      return
    }

    setFormError(null)
    await onSubmit({ prompt: trimmedPrompt, negativePrompt: trimmedNegativePrompt })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('prompts.components.prompt.collect.modal.collect.prompts.manually')}
      widthClassName="max-w-3xl"
    >
      <form onSubmit={(event) => void handleSubmit(event)}>
        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>{t('prompts.components.prompt.collect.modal.check.your.input')}</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <ModalBody className="space-y-5">
          <Field label="Positive prompt">
            <Textarea rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t('prompts.components.prompt.collect.modal.enter.the.positive.prompt.here')} />
          </Field>

          <Field label="Negative prompt">
            <Textarea rows={6} value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} placeholder={t('prompts.components.prompt.collect.modal.enter.the.negative.prompt.here')} />
          </Field>

          <ModalFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
              {t({ ko: '취소', en: 'Cancel' })}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('prompts.components.prompt.collect.modal.collecting') : t('prompts.components.prompt.collect.modal.run.collect')}
            </Button>
          </ModalFooter>
        </ModalBody>
      </form>
    </Modal>
  )
}

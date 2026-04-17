import { useEffect, useState, type FormEvent } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsField, SettingsModalBody, SettingsModalFooter } from '@/features/settings/components/settings-primitives'

interface PromptCollectModalProps {
  open: boolean
  isSubmitting?: boolean
  onClose: () => void
  onSubmit: (input: { prompt: string; negativePrompt: string }) => Promise<void>
}

export function PromptCollectModal({ open, isSubmitting = false, onClose, onSubmit }: PromptCollectModalProps) {
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
      setFormError('positive나 negative 중 하나는 넣어줘야 해.')
      return
    }

    setFormError(null)
    await onSubmit({ prompt: trimmedPrompt, negativePrompt: trimmedNegativePrompt })
  }

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title="프롬프트 수동 수집"
      widthClassName="max-w-3xl"
    >
      <form onSubmit={(event) => void handleSubmit(event)}>
        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>입력 확인이 필요해</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <SettingsModalBody className="space-y-5">
          <SettingsField label="Positive prompt">
            <Textarea rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="positive prompt를 여기에 넣어줘" />
          </SettingsField>

          <SettingsField label="Negative prompt">
            <Textarea rows={6} value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} placeholder="negative prompt를 여기에 넣어줘" />
          </SettingsField>

          <SettingsModalFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
              취소
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? '수집 중…' : '수집 실행'}
            </Button>
          </SettingsModalFooter>
        </SettingsModalBody>
      </form>
    </SettingsModal>
  )
}

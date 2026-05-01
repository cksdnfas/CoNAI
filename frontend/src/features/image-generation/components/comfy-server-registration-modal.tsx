import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsModalBody, SettingsModalFooter } from '@/features/settings/components/settings-primitives'
import { useI18n } from '@/i18n'
import { FormField, type ComfyUIServerFormDraft } from '../image-generation-shared'

type ComfyServerRegistrationModalProps = {
  open: boolean
  form: ComfyUIServerFormDraft
  mode?: 'create' | 'edit'
  isSubmitting: boolean
  onClose: () => void
  onReset: () => void
  onFieldChange: (field: keyof ComfyUIServerFormDraft, value: string) => void
  onSubmit: () => void
}

export function ComfyServerRegistrationModal({
  open,
  form,
  mode = 'create',
  isSubmitting,
  onClose,
  onReset,
  onFieldChange,
  onSubmit,
}: ComfyServerRegistrationModalProps) {
  const { t } = useI18n()
  const title = mode === 'edit' ? t({ ko: 'ComfyUI 서버 수정', en: 'Edit ComfyUI server' }) : t({ ko: 'ComfyUI 서버 등록', en: 'Register ComfyUI server' })
  const submitLabel = mode === 'edit' ? t({ ko: '서버 저장', en: 'Save server' }) : t({ ko: '서버 등록', en: 'Register server' })

  return (
    <SettingsModal open={open} onClose={onClose} title={title} widthClassName="max-w-2xl">
      <SettingsModalBody>
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Name">
            <Input value={form.name} onChange={(event) => onFieldChange('name', event.target.value)} placeholder="Local ComfyUI" />
          </FormField>
          <FormField label="Endpoint">
            <Input value={form.endpoint} onChange={(event) => onFieldChange('endpoint', event.target.value)} placeholder="http://127.0.0.1:8188" />
          </FormField>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <FormField label={t({ ko: '백엔드', en: 'Backend' })}>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.backendType}
              onChange={(event) => onFieldChange('backendType', event.target.value)}
            >
              <option value="comfyui">Local ComfyUI API</option>
              <option value="modal">Modal ComfyUI /generate</option>
            </select>
          </FormField>
          <FormField label={t({ ko: '동시 실행 슬롯', en: 'Capacity' })}>
            <Input type="number" min={1} max={100} value={form.capacity} onChange={(event) => onFieldChange('capacity', event.target.value)} />
          </FormField>
        </div>

        <FormField label={t({ ko: '설명', en: 'Description' })} hint={t({ ko: '선택', en: 'Optional' })}>
          <Input value={form.description} onChange={(event) => onFieldChange('description', event.target.value)} placeholder={t({ ko: '메인 GPU 서버', en: 'Main GPU server' })} />
        </FormField>

        <FormField label={t({ ko: '라우팅 태그', en: 'Routing tags' })} hint={t({ ko: '쉼표로 구분', en: 'Comma-separated' })}>
          <Input value={form.routingTags} onChange={(event) => onFieldChange('routingTags', event.target.value)} placeholder="gpu4090, high-vram, fast-lane" />
        </FormField>

        <SettingsModalFooter>
          <Button type="button" variant="ghost" onClick={onReset} disabled={isSubmitting}>
            {t({ ko: '초기화', en: 'Reset' })}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t({ ko: '취소', en: 'Cancel' })}
          </Button>
          <Button type="button" onClick={onSubmit} disabled={isSubmitting || form.name.trim().length === 0 || form.endpoint.trim().length === 0}>
            {isSubmitting ? t({ ko: '저장 중…', en: 'Saving…' }) : submitLabel}
          </Button>
        </SettingsModalFooter>
      </SettingsModalBody>
    </SettingsModal>
  )
}

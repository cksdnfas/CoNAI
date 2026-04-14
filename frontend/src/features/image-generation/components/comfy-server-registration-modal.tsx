import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SettingsModal } from '@/features/settings/components/settings-modal'
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
  const title = mode === 'edit' ? 'ComfyUI 서버 수정' : 'ComfyUI 서버 등록'
  const submitLabel = mode === 'edit' ? '서버 저장' : '서버 등록'

  return (
    <SettingsModal open={open} onClose={onClose} title={title} widthClassName="max-w-2xl">
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Name">
            <Input value={form.name} onChange={(event) => onFieldChange('name', event.target.value)} placeholder="Local ComfyUI" />
          </FormField>
          <FormField label="Endpoint">
            <Input value={form.endpoint} onChange={(event) => onFieldChange('endpoint', event.target.value)} placeholder="http://127.0.0.1:8188" />
          </FormField>
        </div>

        <FormField label="Description" hint="선택">
          <Input value={form.description} onChange={(event) => onFieldChange('description', event.target.value)} placeholder="메인 GPU 서버" />
        </FormField>

        <FormField label="Routing Tags" hint="쉼표로 구분">
          <Input value={form.routingTags} onChange={(event) => onFieldChange('routingTags', event.target.value)} placeholder="gpu4090, high-vram, fast-lane" />
        </FormField>

        <div className="flex justify-end gap-2 border-t border-border/70 pt-4">
          <Button type="button" variant="ghost" onClick={onReset} disabled={isSubmitting}>
            초기화
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button type="button" onClick={onSubmit} disabled={isSubmitting || form.name.trim().length === 0 || form.endpoint.trim().length === 0}>
            {isSubmitting ? '저장 중…' : submitLabel}
          </Button>
        </div>
      </div>
    </SettingsModal>
  )
}

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsField, SettingsModalBody, SettingsModalFooter, SettingsToggleRow } from '@/features/settings/components/settings-primitives'
import { useI18n } from '@/i18n'
import type { ComfyUIServerFormDraft } from '../image-generation-shared'

type ComfyServerRegistrationModalProps = {
  open: boolean
  form: ComfyUIServerFormDraft
  mode?: 'create' | 'edit'
  isSubmitting: boolean
  onClose: () => void
  onReset: () => void
  onFieldChange: (field: keyof ComfyUIServerFormDraft, value: string | boolean) => void
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
  const canSelectRepresentative = form.backendType !== 'modal'

  return (
    <SettingsModal open={open} onClose={onClose} title={title} widthClassName="max-w-2xl">
      <SettingsModalBody className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <SettingsField label={t({ ko: '서버 이름', en: 'Server name' })}>
            <Input variant="settings" value={form.name} onChange={(event) => onFieldChange('name', event.target.value)} placeholder="Local ComfyUI" />
          </SettingsField>
          <SettingsField label={t({ ko: '엔드포인트', en: 'Endpoint' })}>
            <Input variant="settings" value={form.endpoint} onChange={(event) => onFieldChange('endpoint', event.target.value)} placeholder="http://127.0.0.1:8188" />
          </SettingsField>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <SettingsField label={t({ ko: '백엔드', en: 'Backend' })}>
            <Select
              variant="settings"
              value={form.backendType}
              onChange={(event) => onFieldChange('backendType', event.target.value)}
            >
              <option value="comfyui">Local ComfyUI API</option>
              <option value="modal">Modal ComfyUI /generate</option>
            </Select>
          </SettingsField>
          <SettingsField label={t({ ko: '동시 실행 슬롯', en: 'Capacity' })}>
            <Input variant="settings" type="number" min={1} max={100} value={form.capacity} onChange={(event) => onFieldChange('capacity', event.target.value)} />
          </SettingsField>
        </div>

        <SettingsField label={t({ ko: '설명', en: 'Description' })} hint={t({ ko: '선택', en: 'Optional' })}>
          <Input variant="settings" value={form.description} onChange={(event) => onFieldChange('description', event.target.value)} placeholder={t({ ko: '메인 GPU 서버', en: 'Main GPU server' })} />
        </SettingsField>

        <SettingsField label={t({ ko: '라우팅 태그', en: 'Routing tags' })} hint={t({ ko: '쉼표로 구분', en: 'Comma-separated' })}>
          <Input variant="settings" value={form.routingTags} onChange={(event) => onFieldChange('routingTags', event.target.value)} placeholder="gpu4090, high-vram, fast-lane" />
        </SettingsField>

        {canSelectRepresentative ? (
          <SettingsToggleRow>
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(event) => onFieldChange('isDefault', event.target.checked)}
            />
            <span className="flex-1">{t({ ko: '대표 서버', en: 'Representative server' })}</span>
            <span className="text-[11px] text-muted-foreground">{t({ ko: 'API 기본 대상', en: 'Default API target' })}</span>
          </SettingsToggleRow>
        ) : null}

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

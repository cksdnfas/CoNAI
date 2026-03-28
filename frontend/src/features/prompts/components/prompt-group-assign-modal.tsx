import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { buildPromptGroupOptionItems } from '@/features/prompts/prompt-group-option-utils'
import type { PromptGroupRecord } from '@/types/prompt'

interface PromptGroupAssignModalProps {
  open: boolean
  groups: PromptGroupRecord[]
  selectedCount: number
  isSubmitting?: boolean
  onClose: () => void
  onSubmit: (groupId: number | null) => Promise<void>
}

export function PromptGroupAssignModal({
  open,
  groups,
  selectedCount,
  isSubmitting = false,
  onClose,
  onSubmit,
}: PromptGroupAssignModalProps) {
  const groupOptions = useMemo(() => buildPromptGroupOptionItems(groups), [groups])
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    setSelectedGroupId(groupOptions[0] ? String(groupOptions[0].id) : '')
    setFormError(null)
  }, [groupOptions, open])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!selectedGroupId) {
      setFormError('먼저 이동할 그룹을 골라줘.')
      return
    }

    setFormError(null)
    await onSubmit(selectedGroupId === '0' ? null : Number(selectedGroupId))
  }

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title="선택 프롬프트 그룹 지정"
      widthClassName="max-w-xl"
    >
      <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>확인이 필요해</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">대상 그룹</p>
          <Select value={selectedGroupId} onChange={(event) => setSelectedGroupId(event.target.value)}>
            {groupOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border/70 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button type="submit" disabled={isSubmitting || groupOptions.length === 0}>
            {isSubmitting ? '적용 중…' : '그룹 지정'}
          </Button>
        </div>
      </form>
    </SettingsModal>
  )
}

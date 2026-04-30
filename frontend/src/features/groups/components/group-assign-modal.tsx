import { Folder, FolderOpen } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsModalBody, SettingsModalFooter } from '@/features/settings/components/settings-primitives'
import { buildGroupOptionItems } from '@/features/groups/group-option-utils'
import type { GroupWithHierarchy } from '@/types/group'
import { useI18n } from '@/i18n'

interface GroupAssignModalProps {
  open: boolean
  groups: GroupWithHierarchy[]
  selectedCount: number
  isSubmitting?: boolean
  onClose: () => void
  onSubmit: (groupId: number) => Promise<void>
}

export function GroupAssignModal({
  open,
  groups,
  isSubmitting = false,
  onClose,
  onSubmit,
}: GroupAssignModalProps) {
  const { t, formatNumber } = useI18n()
  const groupOptions = useMemo(() => buildGroupOptionItems(groups), [groups])
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
      setFormError(t('groups.components.group.assign.modal.choose.a.group.to.assign.first'))
      return
    }

    setFormError(null)
    await onSubmit(Number(selectedGroupId))
  }

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={t('groups.components.group.assign.modal.add.selected.images.to.a.group')}
      widthClassName="max-w-xl"
    >
      <form onSubmit={(event) => void handleSubmit(event)}>
        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>{t('groups.components.group.assign.modal.confirmation.required')}</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <SettingsModalBody className="space-y-5">
          {groupOptions.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">{t('groups.components.group.assign.modal.target.group')}</p>
              <HierarchyPicker
                items={groups}
                selectedId={selectedGroupId ? Number(selectedGroupId) : null}
                onSelect={(group) => setSelectedGroupId(String(group.id))}
                getId={(group) => group.id}
                getParentId={(group) => group.parent_id}
                getLabel={(group) => (
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate">{group.name}</span>
                    <span className="shrink-0 text-xs">{formatNumber(group.image_count)}</span>
                  </div>
                )}
                sortItems={(left, right) => left.name.localeCompare(right.name)}
                renderIcon={(_, state) => (state.hasChildren ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
                showRootOption={false}
              />
            </div>
          ) : (
            <Alert>
              <AlertTitle>{t('groups.components.group.assign.modal.no.groups')}</AlertTitle>
              <AlertDescription>{t('groups.components.group.assign.modal.create.a.group.first')}</AlertDescription>
            </Alert>
          )}

          <SettingsModalFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
              {t({ ko: '취소', en: 'Cancel' })}
            </Button>
            <Button type="submit" disabled={isSubmitting || groupOptions.length === 0}>
              {isSubmitting ? t('groups.components.group.assign.modal.adding') : t('groups.components.group.assign.modal.add.to.group')}
            </Button>
          </SettingsModalFooter>
        </SettingsModalBody>
      </form>
    </SettingsModal>
  )
}

import { useMemo, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Modal, ModalBody } from '@/components/ui/modal'
import { useI18n } from '@/i18n'
import { collectGroupSubtreeIds } from '@/features/groups/group-option-utils'
import type { GroupWithHierarchy } from '@/types/group'
import { GroupColorDot } from './group-color-dot'
import { GroupModalFooter, GroupModalSection, GroupModalSwitchRow } from './group-modal-parts'

const NAME_PREVIEW_LIMIT = 12

interface GroupDeleteDialogProps {
  open: boolean
  targets: GroupWithHierarchy[]
  allGroups: GroupWithHierarchy[]
  isDeleting?: boolean
  onClose: () => void
  onConfirm: (cascade: boolean) => void
}

/** One confirmation for deleting one or more groups; child groups move to the top level unless cascade is picked. */
export function GroupDeleteDialog({ open, targets, allGroups, isDeleting = false, onClose, onConfirm }: GroupDeleteDialogProps) {
  const { t, formatNumber } = useI18n()
  // The caller keys the dialog by its targets, so each opening starts with child groups kept.
  const [cascade, setCascade] = useState(false)
  const childCount = useMemo(() => {
    const targetIds = new Set(targets.map((group) => group.id))
    return [...collectGroupSubtreeIds(allGroups, targetIds)].filter((id) => !targetIds.has(id)).length
  }, [allGroups, targets])

  const single = targets.length === 1 ? targets[0] : null
  const hiddenCount = Math.max(0, targets.length - NAME_PREVIEW_LIMIT)

  return (
    <Modal
      open={open}
      onClose={onClose}
      appearance="card"
      widthClassName="max-w-md"
      title={single
        ? t({ ko: '그룹 삭제', en: 'Delete group' })
        : t({ ko: '그룹 {count}개 삭제', en: 'Delete {count} groups' }, { count: formatNumber(targets.length) })}
      description={t({ ko: '이미지 파일은 유지', en: 'Image files are kept' })}
    >
      <ModalBody className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {targets.slice(0, NAME_PREVIEW_LIMIT).map((group) => (
            <Chip key={group.id} tone="muted">
              <GroupColorDot color={group.color} />
              {group.name}
            </Chip>
          ))}
          {hiddenCount > 0 ? <Chip tone="muted">+{formatNumber(hiddenCount)}</Chip> : null}
        </div>

        {childCount > 0 ? (
          <GroupModalSection>
            <GroupModalSwitchRow
              label={t({ ko: '하위 그룹 {count}개도 삭제', en: 'Also delete {count} child groups' }, { count: formatNumber(childCount) })}
              checked={cascade}
              onCheckedChange={setCascade}
              disabled={isDeleting}
            />
          </GroupModalSection>
        ) : null}
      </ModalBody>

      <GroupModalFooter busy={isDeleting}>
        <Button type="button" variant="destructive" className="font-semibold" onClick={() => onConfirm(cascade)} disabled={isDeleting || targets.length === 0}>
          {isDeleting ? <LoaderCircle className="animate-spin" /> : null}
          {single
            ? t({ ko: '삭제', en: 'Delete' })
            : t({ ko: '{count}개 삭제', en: 'Delete {count}' }, { count: formatNumber(targets.length) })}
        </Button>
      </GroupModalFooter>
    </Modal>
  )
}

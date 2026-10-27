import { useMemo, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal, ModalBody } from '@/components/ui/modal'
import { useI18n } from '@/i18n'
import type { GroupCountMaps } from '@/features/groups/group-count-utils'
import { collectGroupSubtreeIds } from '@/features/groups/group-option-utils'
import type { GroupWithHierarchy } from '@/types/group'
import { GroupLocationPicker } from './group-location-picker'
import { GroupModalFooter } from './group-modal-parts'

interface GroupMoveDialogProps {
  open: boolean
  targets: GroupWithHierarchy[]
  allGroups: GroupWithHierarchy[]
  countMaps?: GroupCountMaps
  isMoving?: boolean
  onClose: () => void
  onConfirm: (parentId: number | null) => void
}

/** Move one or more groups under another group or to the top level; their images and child groups go along. */
export function GroupMoveDialog({ open, targets, allGroups, countMaps, isMoving = false, onClose, onConfirm }: GroupMoveDialogProps) {
  const { t, formatNumber } = useI18n()
  // A group cannot move into itself or under one of its own descendants.
  const candidates = useMemo(() => {
    const blockedIds = collectGroupSubtreeIds(allGroups, targets.map((group) => group.id))
    return allGroups.filter((group) => !blockedIds.has(group.id))
  }, [allGroups, targets])
  const sharedParentId = targets.length > 0 && targets.every((group) => (group.parent_id ?? null) === (targets[0].parent_id ?? null))
    ? targets[0].parent_id ?? null
    : undefined
  // The caller keys the dialog by its targets, so each opening starts from their current parent.
  const [parentId, setParentId] = useState<number | null>(() => sharedParentId ?? null)

  const single = targets.length === 1 ? targets[0] : null
  const unchanged = sharedParentId !== undefined && sharedParentId === parentId

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={single
        ? t({ ko: '‘{name}’ 옮기기', en: 'Move ‘{name}’' }, { name: single.name })
        : t({ ko: '그룹 {count}개 옮기기', en: 'Move {count} groups' }, { count: formatNumber(targets.length) })}
    >
      <ModalBody>
        <GroupLocationPicker
          groups={candidates}
          pathGroups={allGroups}
          value={parentId}
          onChange={setParentId}
          collapsible={false}
          countMaps={countMaps}
        />
      </ModalBody>

      <GroupModalFooter busy={isMoving}>
        <Button type="button" onClick={() => onConfirm(parentId)} disabled={isMoving || unchanged || targets.length === 0}>
          {isMoving ? <LoaderCircle className="animate-spin" /> : null}
          {t({ ko: '여기로 옮기기', en: 'Move here' })}
        </Button>
      </GroupModalFooter>
    </Modal>
  )
}

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Plus } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody } from '@/components/ui/modal'
import { buildGroupCountMaps } from '@/features/groups/group-count-utils'
import { buildGroupOptionItems } from '@/features/groups/group-option-utils'
import { createGroup, GROUPS_HIERARCHY_ALL_QUERY_KEY } from '@/lib/api-groups'
import type { GroupWithHierarchy } from '@/types/group'
import { useI18n } from '@/i18n'
import { GroupColorDot } from './group-color-dot'
import { GroupLocationPicker } from './group-location-picker'
import { GroupModalFooter } from './group-modal-parts'

const RECENT_GROUPS_KEY = 'conai:groups:recent-assign:v1'
const RECENT_GROUP_LIMIT = 5

/** Groups images were last added to, newest first (this browser only). */
function readRecentGroupIds(): number[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RECENT_GROUPS_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isInteger(id)) : []
  } catch {
    return []
  }
}

function rememberRecentGroup(groupId: number) {
  const next = [groupId, ...readRecentGroupIds().filter((id) => id !== groupId)].slice(0, RECENT_GROUP_LIMIT)
  try {
    window.localStorage.setItem(RECENT_GROUPS_KEY, JSON.stringify(next))
  } catch {
    // Storage off (private mode): the recent list just stays empty.
  }
}

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
  selectedCount,
  isSubmitting = false,
  onClose,
  onSubmit,
}: GroupAssignModalProps) {
  const { t, formatNumber } = useI18n()
  const queryClient = useQueryClient()
  const groupOptions = useMemo(() => buildGroupOptionItems(groups), [groups])
  const countMaps = useMemo(() => buildGroupCountMaps(groups), [groups])
  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group] as const)), [groups])
  const [recentIds, setRecentIds] = useState<number[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)
  // null: the "new group" field is closed.
  const [newGroupName, setNewGroupName] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    const storedRecentIds = readRecentGroupIds()
    setRecentIds(storedRecentIds)
    setSelectedGroupId(storedRecentIds.find((id) => groupById.has(id)) ?? groupOptions[0]?.id ?? null)
    setNewGroupName(null)
    setFormError(null)
  }, [groupById, groupOptions, open])

  const recentGroups = recentIds.flatMap((id) => groupById.get(id) ?? [])
  const selectedGroup = selectedGroupId === null ? undefined : groupById.get(selectedGroupId)
  const busy = isSubmitting || isCreating

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (selectedGroupId === null) {
      setFormError(t('groups.components.group.assign.modal.choose.a.group.to.assign.first'))
      return
    }

    setFormError(null)
    await onSubmit(selectedGroupId)
    rememberRecentGroup(selectedGroupId)
  }

  // Make a top-level group with the typed name and add the images to it in one go.
  const handleCreateAndAdd = async () => {
    const name = newGroupName?.trim()
    if (!name) {
      return
    }

    setFormError(null)
    setIsCreating(true)
    let createdId: number
    try {
      createdId = (await createGroup({ name })).id
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error))
      return
    } finally {
      setIsCreating(false)
    }

    await queryClient.invalidateQueries({ queryKey: GROUPS_HIERARCHY_ALL_QUERY_KEY })
    await onSubmit(createdId)
    rememberRecentGroup(createdId)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      appearance="card"
      title={t({ ko: '그룹에 추가', en: 'Add to group' })}
      description={t({ ko: '{count}장', en: '{count} images' }, { count: formatNumber(selectedCount) })}
      widthClassName="max-w-md"
    >
      <form onSubmit={(event) => void handleSubmit(event)}>
        <ModalBody spacing="sm">
          {formError ? (
            <Alert variant="destructive">
              <AlertTitle>{t('groups.components.group.assign.modal.confirmation.required')}</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          {recentGroups.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">{t({ ko: '최근', en: 'Recent' })}</p>
              <div className="flex flex-wrap gap-1.5">
                {recentGroups.map((group) => (
                  <Button
                    key={group.id}
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="max-w-48"
                    data-pressed={group.id === selectedGroupId ? 'true' : undefined}
                    aria-pressed={group.id === selectedGroupId}
                    onClick={() => setSelectedGroupId(group.id)}
                  >
                    <GroupColorDot color={group.color} />
                    <span className="truncate">{group.name}</span>
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          {groupOptions.length > 0 ? (
            <GroupLocationPicker
              groups={groups}
              value={selectedGroupId}
              onChange={setSelectedGroupId}
              allowRoot={false}
              collapsible={false}
              countMaps={countMaps}
            />
          ) : (
            <Alert>
              <AlertTitle>{t('groups.components.group.assign.modal.no.groups')}</AlertTitle>
              <AlertDescription>{t('groups.components.group.assign.modal.create.a.group.first')}</AlertDescription>
            </Alert>
          )}

          {newGroupName !== null ? (
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void handleCreateAndAdd()
                  }
                }}
                aria-label={t({ ko: '새 그룹 이름', en: 'New group name' })}
                placeholder={t({ ko: '새 그룹 이름', en: 'New group name' })}
                disabled={busy}
              />
              <Button type="button" onClick={() => void handleCreateAndAdd()} disabled={busy || !newGroupName.trim()}>
                {isCreating ? <LoaderCircle className="animate-spin" /> : null}
                {t({ ko: '만들어 넣기', en: 'Create & add' })}
              </Button>
            </div>
          ) : null}
        </ModalBody>

        <GroupModalFooter
          busy={busy}
          start={newGroupName === null ? (
            <Button type="button" variant="ghost" onClick={() => setNewGroupName('')} disabled={busy}>
              <Plus />
              {t({ ko: '새 그룹', en: 'New group' })}
            </Button>
          ) : null}
        >
          <Button type="submit" className="max-w-56" disabled={busy || !selectedGroup}>
            {isSubmitting ? <LoaderCircle className="animate-spin" /> : null}
            <span className="truncate">
              {selectedGroup
                ? t({ ko: '‘{name}’에 추가', en: 'Add to ‘{name}’' }, { name: selectedGroup.name })
                : t({ ko: '추가', en: 'Add' })}
            </span>
          </Button>
        </GroupModalFooter>
      </form>
    </Modal>
  )
}

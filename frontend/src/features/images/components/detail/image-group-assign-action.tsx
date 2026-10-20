import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderPlus } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { GroupAssignModal } from '@/features/groups/components/group-assign-modal'
import { formatGroupBulkAddNotice } from '@/features/groups/group-bulk-result-messages'
import { addImagesToGroup, getGroupsHierarchyAll, GROUPS_HIERARCHY_ALL_QUERY_KEY } from '@/lib/api-groups'
import type { GroupWithHierarchy } from '@/types/group'
import type { ImageRecord } from '@/types/image'

const GROUPS_STALE_TIME = 60_000

interface ImageGroupAssignActionProps {
  image?: ImageRecord
  /** `ghost` in page toolbars, `overlay` on the viewer's photo stage. */
  variant?: 'ghost' | 'secondary' | 'overlay'
}

/** Render a reusable single-image group assignment action for detail views. */
export function ImageGroupAssignAction({ image, variant = 'secondary' }: ImageGroupAssignActionProps) {
  const { canAssignGroups } = useImagePermissions()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t, formatNumber } = useI18n()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const compositeHash = image?.composite_hash ?? null

  const groupsQuery = useQuery({
    queryKey: GROUPS_HIERARCHY_ALL_QUERY_KEY,
    queryFn: getGroupsHierarchyAll,
    enabled: false,
    staleTime: GROUPS_STALE_TIME,
  })

  const assignMutation = useMutation({
    // The bulk endpoint reports "already in the group" as a count instead of an English 409 message.
    mutationFn: (groupId: number) => addImagesToGroup(groupId, [compositeHash as string]),
    onSuccess: async (result) => {
      setIsModalOpen(false)
      showSnackbar(formatGroupBulkAddNotice(result, t, formatNumber))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: GROUPS_HIERARCHY_ALL_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['group-detail', 'custom'] }),
        queryClient.invalidateQueries({ queryKey: ['group-images', 'custom'] }),
        queryClient.invalidateQueries({ queryKey: ['image-detail', compositeHash] }),
      ])
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t('images.components.detail.image.group.assign.action.failed.to.add.the.image.to.the'), tone: 'error' })
    },
  })

  if (!canAssignGroups || !compositeHash) {
    return null
  }

  const handleOpenModal = async () => {
    if (!canAssignGroups || !compositeHash) {
      return
    }

    if (groupsQuery.isFetching) {
      showSnackbar({ message: t('images.components.detail.image.group.assign.action.loading.custom.groups'), tone: 'info' })
      return
    }

    // The cached list while it is fresh; a stale or invalidated one (e.g. after a group was created) is loaded again.
    let groups: GroupWithHierarchy[]
    try {
      groups = await queryClient.fetchQuery({ queryKey: GROUPS_HIERARCHY_ALL_QUERY_KEY, queryFn: getGroupsHierarchyAll, staleTime: GROUPS_STALE_TIME })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t('images.components.detail.image.group.assign.action.failed.to.load.groups'), tone: 'error' })
      return
    }

    if (groups.length === 0) {
      showSnackbar({ message: t('images.components.detail.image.group.assign.action.create.a.custom.group.first'), tone: 'error' })
      return
    }

    setIsModalOpen(true)
  }

  return (
    <>
      <IconButton size="icon-sm" variant={variant} onClick={() => void handleOpenModal()} disabled={assignMutation.isPending || groupsQuery.isFetching} label={t('images.components.detail.image.group.assign.action.add.to.group')}>
        <FolderPlus className="h-4 w-4" />
      </IconButton>

      <GroupAssignModal
        open={isModalOpen}
        groups={groupsQuery.data ?? []}
        selectedCount={1}
        isSubmitting={assignMutation.isPending}
        onClose={() => setIsModalOpen(false)}
        onSubmit={async (groupId) => {
          await assignMutation.mutateAsync(groupId)
        }}
      />
    </>
  )
}

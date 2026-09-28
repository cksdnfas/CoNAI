import { useCallback, useState } from 'react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import type { CustomDropdownList } from '@/lib/api-image-generation-types'
import {
  DEFAULT_COMFY_MODEL_API_PATHS,
  createGenerationCustomDropdownList,
  deleteGenerationCustomDropdownList,
  scanGenerationComfyUIModelDropdownLists,
  updateGenerationCustomDropdownList,
} from '@/lib/api-image-generation-workflows'
import { getErrorMessage } from '../image-generation-shared'

/** Create / update / delete / auto-scan actions for ComfyUI custom dropdown lists. */
export function useComfyDropdownListActions({
  dropdownListById,
  refetchDropdownLists,
}: {
  dropdownListById: Map<number, CustomDropdownList>
  refetchDropdownLists: () => Promise<unknown>
}) {
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const confirm = useConfirm()
  const [isRefreshingDropdownLists, setIsRefreshingDropdownLists] = useState(false)

  const handleCreateDropdownList = async (input: { name: string; description?: string; items: string[] }) => {
    try {
      await createGenerationCustomDropdownList(input)
      await refetchDropdownLists()
      showSnackbar({ message: t({ ko: '커스텀 드롭다운 목록을 만들었어.', en: 'Created the custom dropdown list.' }), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '커스텀 드롭다운 목록 생성에 실패했어.', en: 'Failed to create the custom dropdown list.' })), tone: 'error' })
    }
  }

  const handleDeleteDropdownList = async (listId: number) => {
    const list = dropdownListById.get(listId)
    if (!list) {
      return
    }

    const confirmed = await confirm({
      title: t({ ko: '목록 삭제', en: 'Delete list' }),
      description: t({ ko: '정말 {name} 목록을 삭제할까?', en: 'Delete the {name} list?' }, { name: list.name }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (!confirmed) {
      return
    }

    try {
      await deleteGenerationCustomDropdownList(listId)
      await refetchDropdownLists()
      showSnackbar({ message: t({ ko: '드롭다운 목록을 삭제했어.', en: 'Deleted the dropdown list.' }), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '드롭다운 목록 삭제에 실패했어.', en: 'Failed to delete the dropdown list.' })), tone: 'error' })
    }
  }

  const handleUpdateDropdownList = async (listId: number, input: { name?: string; description?: string; items?: string[] }) => {
    try {
      await updateGenerationCustomDropdownList(listId, input)
      await refetchDropdownLists()
      showSnackbar({ message: t({ ko: '드롭다운 목록을 수정했어.', en: 'Updated the dropdown list.' }), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '드롭다운 목록 수정에 실패했어.', en: 'Failed to update the dropdown list.' })), tone: 'error' })
    }
  }

  const handleScanDropdownLists = useCallback(async (input: { apiPaths: string[] }) => {
    if (isRefreshingDropdownLists) {
      return
    }

    try {
      setIsRefreshingDropdownLists(true)
      const response = await scanGenerationComfyUIModelDropdownLists(input)
      await refetchDropdownLists()
      showSnackbar({ message: response.data.message || t({ ko: '자동수집 목록을 갱신했어.', en: 'Refreshed the auto-collect list.' }), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '자동수집 목록 생성에 실패했어.', en: 'Failed to create the auto-collect list.' })), tone: 'error' })
    } finally {
      setIsRefreshingDropdownLists(false)
    }
  }, [isRefreshingDropdownLists, refetchDropdownLists, showSnackbar, t])

  const handleRefreshDropdownLists = useCallback(() => handleScanDropdownLists({ apiPaths: DEFAULT_COMFY_MODEL_API_PATHS }), [handleScanDropdownLists])

  return {
    isRefreshingDropdownLists,
    handleCreateDropdownList,
    handleDeleteDropdownList,
    handleUpdateDropdownList,
    handleScanDropdownLists,
    handleRefreshDropdownLists,
  }
}

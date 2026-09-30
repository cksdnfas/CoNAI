import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpCircle } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { IconButton } from '@/components/ui/icon-button'
import { Spinner } from '@/components/ui/loading-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { getCodexCliVersion, updateCodexCli } from '@/lib/api-image-generation-queue'
import { getErrorMessage } from '../image-generation-shared'

export const CODEX_CLI_VERSION_QUERY_KEY = ['codex-cli-version'] as const

/** Admin-only toolbar action that appears when npm has a newer Codex CLI than the server runs. */
export function CodexCliUpdateButton({ onUpdated }: { onUpdated: () => void }) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()

  const versionQuery = useQuery({
    queryKey: CODEX_CLI_VERSION_QUERY_KEY,
    queryFn: () => getCodexCliVersion(),
    staleTime: 60 * 60 * 1000,
    retry: false,
  })

  const updateMutation = useMutation({
    mutationFn: updateCodexCli,
    onSuccess: (result) => {
      queryClient.setQueryData(CODEX_CLI_VERSION_QUERY_KEY, result)
      showSnackbar({ message: t({ ko: `Codex ${result.data.current ?? ''} 로 업데이트했어`, en: `Updated Codex to ${result.data.current ?? ''}` }), tone: 'info' })
      onUpdated()
    },
    onError: (error) => {
      showSnackbar({ message: getErrorMessage(error, t({ ko: 'Codex 업데이트 실패', en: 'Codex update failed' })), tone: 'error' })
    },
  })

  const info = versionQuery.data?.data
  if (!info || (!info.updateAvailable && !updateMutation.isPending)) {
    return null
  }

  const label = t({ ko: `Codex 업데이트 (${info.current} → ${info.latest})`, en: `Update Codex (${info.current} → ${info.latest})` })

  const handleClick = async () => {
    const confirmed = await confirm({
      title: t({ ko: 'Codex 업데이트', en: 'Update Codex' }),
      description: t({
        ko: `${info.current} → ${info.latest}. 업데이트하는 동안 Codex 채팅이 끊겨.`,
        en: `${info.current} → ${info.latest}. Codex chat disconnects during the update.`,
      }),
      confirmLabel: t({ ko: '업데이트', en: 'Update' }),
    })
    if (confirmed) {
      updateMutation.mutate()
    }
  }

  return (
    <IconButton variant="ghost" size="icon-sm" onClick={() => void handleClick()} disabled={updateMutation.isPending} label={label}>
      {updateMutation.isPending ? <Spinner size="sm" /> : <ArrowUpCircle />}
    </IconButton>
  )
}

import { lazy, Suspense, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/loading-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { applyChatProfileAssetsProposal, dismissChatProposal, type ChatAssetOwner, type CodexChatToolCall } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { getPromptPresets } from '@/lib/api-prompt-presets'
import { codexChatThreadQueryKey } from './codex-chat-context'
import { ChatMediaAttachments } from './chat-media-picker'
import { ProposalFooter, ProposalFrame } from './chat-proposal-parts'
import { refreshOwnerAssets } from '@/features/settings/components/chat-profile-asset-runs'

// Opened on demand from an approved card; keeps the settings asset editor out of the chat bundle.
const ChatAssetBatchModal = lazy(() => import('@/features/settings/components/chat-asset-batch-modal').then((module) => ({ default: module.ChatAssetBatchModal })))

type AssetsProposal = Extract<NonNullable<CodexChatToolCall['proposal']>, { kind: 'profile_assets' | 'character_assets' }>

/**
 * Generation and application use separate server approvals; only administrators can act. The same card serves a
 * chat profile's assets and a character library setting's (no background slot).
 */
export function ChatAssetProposalCard({ proposal, threadId }: { proposal: AssetsProposal; threadId?: number }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const admin = useAuthStatusQuery().data?.isAdmin === true
  const queryClient = useQueryClient()
  const presets = useQuery({ queryKey: ['prompt-presets', 'chat-assets'], queryFn: () => getPromptPresets({ withItems: true }), enabled: admin && proposal.action === 'create' })
  const [state, setState] = useState<'saved' | 'dismissed' | null>(null)
  const [batchId, setBatchId] = useState<number | null>(proposal.savedId ?? null)
  const [open, setOpen] = useState(false)
  const saved = state === 'saved' || proposal.savedId !== undefined
  const owner: ChatAssetOwner = proposal.kind === 'profile_assets' ? { kind: 'profile', id: proposal.profileId } : { kind: 'setting', id: proposal.settingId }
  const ownerName = proposal.kind === 'profile_assets' ? proposal.profileName : proposal.settingName
  const dismissed = !saved && (state === 'dismissed' || proposal.dismissed === true)
  const refresh = () => Promise.all([
    ...(threadId === undefined ? [] : [queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(threadId) })]),
  ])
  const onError = (error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '제안을 처리하지 못했어.', en: 'Could not process proposal.' })), tone: 'error' })
  const approve = useMutation({
    mutationFn: () => applyChatProfileAssetsProposal(proposal.id),
    onSuccess: async (response) => {
      setState('saved')
      const nextBatchId = response.batch?.id ?? (proposal.action === 'apply' ? proposal.batchId : undefined)
      setBatchId(nextBatchId ?? null)
      // The proposal is already applied: a failed refresh only leaves the views stale until their next fetch.
      await Promise.all([
        refresh(),
        ...(response.result ? [refreshOwnerAssets(queryClient, response.result.owner, [response.result.applied], nextBatchId)] : []),
      ]).catch(() => undefined)
    },
    onError,
  })
  const dismiss = useMutation({ mutationFn: () => dismissChatProposal(proposal.id), onSuccess: async () => { setState('dismissed'); await refresh() }, onError })
  const busy = approve.isPending || dismiss.isPending
  const expressionCount = proposal.action === 'create' ? proposal.input.expressions?.length ?? presets.data?.find((preset) => preset.id === proposal.input.expressionPresetId)?.items?.length : undefined
  const parts = proposal.action === 'create' ? [
    ...(proposal.input.expressionPresetId ? [expressionCount === undefined ? t({ ko: '표정', en: 'Expressions' }) : t({ ko: '표정 {count}', en: '{count} expressions' }, { count: expressionCount })] : []),
    ...(proposal.input.slots ?? []).map((slot) => slot.kind === 'background' ? t({ ko: '배경', en: 'Background' }) : slot.kind === 'full' ? t({ ko: '전신', en: 'Full body' }) : slot.kind === 'reference' ? t({ ko: '기준 이미지', en: 'Reference image' }) : t({ ko: '아바타', en: 'Avatar' })),
  ] : Object.keys(proposal.chosenHashes)
  return <ProposalFrame>
    <div className="flex items-baseline gap-2"><span className="text-xs font-semibold text-muted-foreground">{proposal.action === 'create' ? t({ ko: '자산 만들기', en: 'Create assets' }) : t({ ko: '자산 적용', en: 'Apply assets' })}</span><span className="truncate text-xs text-muted-foreground">{ownerName}</span></div>
    <div className="text-sm">{parts.join(' · ')}</div>
    {proposal.action === 'apply' ? <ChatMediaAttachments items={[...new Map(Object.entries(proposal.chosenHashes).map(([name, compositeHash]) => [compositeHash, { name, compositeHash, mimeType: null }])).values()]} /> : null}
    {saved || dismissed ? <ProposalFooter status><span>{saved ? t({ ko: '승인됨', en: 'Approved' }) : t({ ko: '거절됨', en: 'Dismissed' })}</span>{admin && saved && (batchId ?? proposal.savedId) ? <Button variant="link" size="xs" onClick={() => setOpen(true)}>{t({ ko: '자산 창 열기', en: 'Open assets' })}</Button> : null}</ProposalFooter> : admin ? <ProposalFooter className="justify-end"><Button size="xs" variant="ghost" disabled={busy} onClick={() => dismiss.mutate()}>{t({ ko: '거절', en: 'Dismiss' })}</Button><Button size="xs" disabled={busy} onClick={() => approve.mutate()}>{approve.isPending ? <Spinner /> : proposal.action === 'create' ? <Sparkles /> : <Check />}{t({ ko: '승인', en: 'Approve' })}</Button></ProposalFooter> : null}
    {admin && open ? <Suspense fallback={null}><ChatAssetBatchModal target={{ owner, name: ownerName }} initialBatchId={batchId ?? proposal.savedId} onClose={() => setOpen(false)} /></Suspense> : null}
  </ProposalFrame>
}

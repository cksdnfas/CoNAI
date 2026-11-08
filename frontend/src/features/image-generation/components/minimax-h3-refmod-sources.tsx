import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { MiniMaxH3RefModLibraryMember, MiniMaxH3RefModRecord, MiniMaxH3RefModRecordMember, MiniMaxH3RefModRecordStatus } from '@conai/shared'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { DisclosureButton } from '@/components/ui/disclosure-button'
import { EmptyState } from '@/components/ui/empty-state'
import { Modal, ModalBody } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Text } from '@/components/ui/text'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useI18n } from '@/i18n'
import {
  buildMiniMaxH3RefModMediaUrl,
  COMFY_REFMOD_LIBRARY_QUERY_ROOT,
  COMFY_REFMOD_RECORDS_QUERY_ROOT,
  comfyRefModRecordsQueryKey,
  deleteMiniMaxH3RefModRecord,
  getMiniMaxH3RefModRecords,
} from '@/lib/api-image-generation-workflows'
import { getErrorMessage } from '../image-generation-shared'

const K = 'image-generation.components.minimax.h3.director.refmod.panel'
const RECORD_THUMBNAIL_LIMIT = 3
const STATUS_BADGE: Record<MiniMaxH3RefModRecordStatus, 'info' | 'success' | 'destructive'> = { pending: 'info', saved: 'success', failed: 'destructive' }

/** `mm:ss`, with tenths when the time is fractional (trims are often sub-second). */
function formatClock(seconds: number) {
  const total = Math.max(0, seconds)
  const minutes = Math.floor(total / 60)
  const rest = Math.floor((total - minutes * 60) * 10) / 10
  const secondsText = Number.isInteger(rest) ? String(rest).padStart(2, '0') : rest.toFixed(1).padStart(4, '0')
  return `${String(minutes).padStart(2, '0')}:${secondsText}`
}

function RefModMemberCard({ member, showMedia }: { member: MiniMaxH3RefModRecordMember; showMedia: boolean }) {
  const { t } = useI18n()
  const src = showMedia ? buildMiniMaxH3RefModMediaUrl(member) : ''
  const trim = member.trim_start !== null || member.trim_end !== null
    ? t(`${K}.sources.trim`, { range: `${formatClock(member.trim_start ?? 0)}–${member.trim_end !== null ? formatClock(member.trim_end) : ''}` })
    : null
  const facts = [
    trim,
    member.source_width && member.source_height ? `${member.source_width}×${member.source_height}` : null,
    // Images carry the Director slot length, not a media duration.
    member.kind !== 'image' && member.source_duration !== null ? formatClock(member.source_duration) : null,
  ].filter(Boolean).join(' · ')

  return (
    <figure className="min-w-0 space-y-1.5">
      {!showMedia ? null : member.kind === 'image' ? (
        <img src={src} alt={member.description || member.file_name} loading="lazy" className="aspect-square w-full rounded-sm bg-surface-low object-cover" />
      ) : member.kind === 'video' ? (
        <video src={src} controls preload="metadata" className="aspect-video w-full rounded-sm bg-surface-low" />
      ) : (
        <audio src={src} controls preload="none" className="w-full" />
      )}
      <figcaption className="min-w-0 space-y-1">
        <span className="flex min-w-0 items-center gap-1">
          <Badge variant="secondary" size="sm">{t(`${K}.sources.kind.${member.kind}`)}</Badge>
          <Text as="span" variant="caption" className="min-w-0 truncate" title={member.file_name}>{member.file_name}</Text>
        </span>
        {member.description ? <Text variant="caption" tone="default" className="line-clamp-3">{member.description}</Text> : null}
        {facts ? <Text variant="caption" mono>{facts}</Text> : null}
      </figcaption>
    </figure>
  )
}

/** Every retained source of a CoNAI-made RefMod, in export order; the media itself needs `images.view`. */
export function RefModMemberGrid({ members }: { members: MiniMaxH3RefModRecordMember[] }) {
  const { canViewImages } = useImagePermissions()
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {members.map((member) => <RefModMemberCard key={member.index} member={member} showMedia={canViewImages} />)}
    </div>
  )
}

function RefModRecordDetails({ record }: { record: MiniMaxH3RefModRecord }) {
  const { t, formatDateTime } = useI18n()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { canUpdateWorkflows } = useFeaturePermissions()
  const [isDeleting, setIsDeleting] = useState(false)
  const summary = [record.concept_type, record.description, formatDateTime(record.created_at)].filter(Boolean).join(' · ')

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: t(`${K}.sources.delete.title`),
      description: t(`${K}.sources.delete.description`, { name: record.name ?? `#${record.id}` }),
      confirmLabel: t(`${K}.sources.delete.confirm`),
      tone: 'destructive',
    })
    if (!confirmed) return
    setIsDeleting(true)
    try {
      await deleteMiniMaxH3RefModRecord(record.id)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: COMFY_REFMOD_LIBRARY_QUERY_ROOT }),
        queryClient.invalidateQueries({ queryKey: COMFY_REFMOD_RECORDS_QUERY_ROOT }),
      ])
      showSnackbar({ message: t(`${K}.sources.delete.done`), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t(`${K}.sources.delete.failed`)), tone: 'error' })
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="space-y-3">
      <Text variant="caption">{summary}</Text>
      {record.members.length > 0 ? <RefModMemberGrid members={record.members} /> : <Text variant="caption">{t(`${K}.sources.empty`)}</Text>}
      {canUpdateWorkflows ? (
        <div className="flex justify-end">
          <Button size="xs" variant="destructive-ghost" disabled={isDeleting} aria-busy={isDeleting} onClick={() => void handleDelete()}>
            {t(`${K}.sources.delete`)}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * "원본 보기" under a RefMod: CoNAI's retained sources when CoNAI made the bundle, otherwise the member descriptions
 * DaSiWa keeps in the file. Media elements mount only while open.
 */
export function RefModSourcesDisclosure({ record, members = [] }: { record?: MiniMaxH3RefModRecord; members?: MiniMaxH3RefModLibraryMember[] }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const count = record ? record.members.length : members.length
  if (!record && members.length === 0) return null

  return (
    <div>
      <DisclosureButton open={open} onClick={() => setOpen((current) => !current)}>
        <Text as="span" variant="caption">{t(`${K}.sources.toggle`, { count })}</Text>
      </DisclosureButton>
      {open ? (
        <div className="pt-1 pb-2">
          {record ? <RefModRecordDetails record={record} /> : (
            <ul className="space-y-1">
              {members.map((member, index) => (
                <li key={index} className="flex min-w-0 items-start gap-2">
                  <Badge variant="secondary" size="sm" className="shrink-0">{t(`${K}.sources.kind.${member.kind}`)}</Badge>
                  <Text as="span" variant="caption" className="min-w-0">{member.description || t(`${K}.sources.no.description`)}</Text>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}

type MiniMaxH3RefModRecordsDialogProps = {
  open: boolean
  /** The library's resolved server; only its records are listed. */
  serverId: number
  /** False when every slot is taken by a named RefMod. */
  canPick: boolean
  onPick: (name: string) => void
  onClose: () => void
}

/** RefMods created through CoNAI workflow runs, newest first; a saved one can be put into a slot. */
export function MiniMaxH3RefModRecordsDialog({ open, serverId, canPick, onPick, onClose }: MiniMaxH3RefModRecordsDialogProps) {
  const { t, formatDateTime } = useI18n()
  const { canViewImages } = useImagePermissions()
  const records = useQuery({
    queryKey: comfyRefModRecordsQueryKey(serverId),
    queryFn: () => getMiniMaxH3RefModRecords(serverId),
    enabled: open,
  })

  return (
    <Modal open={open} onClose={onClose} size="lg" height="medium" title={t(`${K}.records.title`)}>
      <ModalBody spacing="sm">
        {records.isPending ? <Text variant="caption" role="status">{t(`${K}.records.loading`)}</Text> : null}
        {records.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t(`${K}.records.error`)}</AlertTitle>
            <AlertDescription>{getErrorMessage(records.error, '')}</AlertDescription>
          </Alert>
        ) : null}
        {records.data?.length === 0 ? <EmptyState size="compact" title={t(`${K}.records.empty`)} /> : null}
        {records.data?.map((record) => {
          const thumbnails = canViewImages ? record.members.filter((member) => member.kind === 'image').slice(0, RECORD_THUMBNAIL_LIMIT) : []
          const name = record.status === 'saved' ? record.name : null
          return (
            <div key={record.id} className="space-y-2 border-b border-line py-3 first:pt-0 last:border-b-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={STATUS_BADGE[record.status]} size="sm">{t(`${K}.records.status.${record.status}`)}</Badge>
                <Text as="span" variant="label" className="min-w-0 flex-1 truncate">{record.name ?? t(`${K}.records.unnamed`)}</Text>
                <Text as="span" variant="caption" className="shrink-0">{formatDateTime(record.created_at)}</Text>
                <Button size="xs" variant="secondary" disabled={!name || !canPick} onClick={() => { if (name) { onPick(name); onClose() } }}>
                  {t(`${K}.records.pick`)}
                </Button>
              </div>
              {record.error ? <Text variant="caption" tone="destructive">{record.error}</Text> : null}
              {thumbnails.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {thumbnails.map((member) => (
                    <img key={member.index} src={buildMiniMaxH3RefModMediaUrl(member)} alt={member.description || member.file_name} loading="lazy" className="size-12 rounded-sm bg-surface-low object-cover" />
                  ))}
                </div>
              ) : null}
              <RefModSourcesDisclosure record={record} />
            </div>
          )
        })}
      </ModalBody>
    </Modal>
  )
}

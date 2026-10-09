import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Workflow } from 'lucide-react'
import { RowPicker, type RowPickerItem } from '@/components/ui/row-picker'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useI18n } from '@/i18n'
import { GRAPH_WORKFLOW_COVERS_QUERY_KEY, getGraphWorkflowCovers, type GraphWorkflowNameRecord } from '@/lib/api-module-graph'
import { libraryThumbnailUrl } from '@/lib/api-sprite'
import { cn } from '@/lib/utils'

/** Workflow id → its newest library image (the face of the workflow). New results show within a minute. */
export function useWorkflowCovers(enabled = true) {
  const query = useQuery({ queryKey: GRAPH_WORKFLOW_COVERS_QUERY_KEY, queryFn: getGraphWorkflowCovers, enabled, staleTime: 60_000 })
  return query.data ?? {}
}

/** A workflow's face: its newest result image, or the workflow mark when it has none (or the image is gone). */
export function WorkflowCover({ hash, size = 'md', className }: { hash?: string | null; size?: 'md' | 'lg'; className?: string }) {
  const { canViewImages } = useImagePermissions()
  const [failed, setFailed] = useState<string | null>(null)
  const box = cn('shrink-0 overflow-hidden rounded-sm bg-surface-high', size === 'lg' ? 'size-11' : 'size-9', className)
  if (!hash || !canViewImages || failed === hash) {
    return <span className={cn(box, 'grid place-items-center text-muted-foreground')} aria-hidden="true"><Workflow className="size-4" /></span>
  }
  return <img src={libraryThumbnailUrl(hash)} alt="" loading="lazy" decoding="async" onError={() => setFailed(hash)} className={cn(box, 'object-cover')} />
}

/** Pick one workflow by its face. `detailOf` adds a line under a workflow's name. */
export function WorkflowPicker({ workflows, covers, value, onChange, disabled, detailOf }: {
  workflows: GraphWorkflowNameRecord[]
  covers: Record<string, string>
  value: string
  onChange: (workflowId: string) => void
  disabled?: boolean
  detailOf?: (workflowId: number) => string | undefined
}) {
  const { t } = useI18n()
  const items = useMemo<RowPickerItem[]>(() => workflows.map((workflow) => ({
    id: String(workflow.id),
    media: <WorkflowCover hash={covers[workflow.id]} />,
    title: <span className="truncate">{workflow.name}</span>,
    subtitle: detailOf?.(workflow.id),
    searchText: workflow.name,
  })), [covers, detailOf, workflows])
  return (
    <RowPicker
      items={items}
      value={value}
      onChange={onChange}
      disabled={disabled}
      ariaLabel={t({ ko: '워크플로우', en: 'Workflow' })}
      placeholder={t({ ko: '워크플로우 고르기', en: 'Pick a workflow' })}
      searchPlaceholder={t({ ko: '워크플로우 찾기', en: 'Find a workflow' })}
      emptyLabel={t({ ko: '맞는 워크플로우 없음', en: 'No matching workflow' })}
    />
  )
}

import { useMemo } from 'react'
import type { WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { groupWorkflowMarkedFieldsByNode } from '../workflow-marked-field-groups'
import type { SelectedImageDraft, WorkflowFieldDraftValue } from '../image-generation-shared'
import { WorkflowFieldDisclosureCard, WorkflowNodeFieldDisclosureCard } from './workflow-field-disclosure-card'

type WorkflowFieldGroupListProps = {
  fields: WorkflowMarkedField[]
  values: Record<string, WorkflowFieldDraftValue>
  loraOptions?: string[]
  isRefreshingOptions?: boolean
  onRefreshOptions?: () => Promise<void> | void
  onChange: (fieldId: string, value: WorkflowFieldDraftValue) => void
  onImageChange: (fieldId: string, image?: SelectedImageDraft) => Promise<void> | void
}

/** Render runtime workflow fields with fields from the same source node grouped together. */
export function WorkflowFieldGroupList({
  fields,
  values,
  loraOptions,
  isRefreshingOptions = false,
  onRefreshOptions,
  onChange,
  onImageChange,
}: WorkflowFieldGroupListProps) {
  const groups = useMemo(() => groupWorkflowMarkedFieldsByNode(fields), [fields])

  return groups.map((group) => {
    if (group.fields.length === 1) {
      const field = group.fields[0]
      return (
        <WorkflowFieldDisclosureCard
          key={group.key}
          field={field}
          value={values[field.id] ?? ''}
          loraOptions={loraOptions}
          isRefreshingOptions={isRefreshingOptions}
          onRefreshOptions={onRefreshOptions}
          onChange={(value) => onChange(field.id, value)}
          onImageChange={(image) => onImageChange(field.id, image)}
        />
      )
    }

    return (
      <WorkflowNodeFieldDisclosureCard
        key={group.key}
        nodeId={group.nodeId}
        nodeTitle={group.nodeTitle}
        fields={group.fields}
        values={values}
        loraOptions={loraOptions}
        isRefreshingOptions={isRefreshingOptions}
        onRefreshOptions={onRefreshOptions}
        onChange={onChange}
        onImageChange={onImageChange}
      />
    )
  })
}

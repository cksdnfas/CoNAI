import type { ChatPageData, ChatPageSnapshot } from '@conai/shared'
import { PromptCollectionModel } from '../../models/PromptCollection'
import { PromptPresetModel } from '../../models/PromptPreset'
import { WildcardModel } from '../../models/Wildcard'
import { WorkflowModel } from '../../models/Workflow'
import { nativeEditRevision } from '../nativeEditRevision'

export function chatPageNativeActionRevision(page: Pick<ChatPageSnapshot, 'kind' | 'resourceId'> & Partial<Pick<ChatPageSnapshot, 'data'>>, actionId: string, args: Record<string, ChatPageData>) {
  let record: unknown
  if (actionId === 'prompt.update') record = PromptCollectionModel.findById(Number(args.id), args.type as 'positive' | 'negative' | 'auto')
  else if (actionId === 'preset.update') record = PromptPresetModel.findByIdWithItems(Number(args.id))
  else if (actionId === 'wildcard.update') record = WildcardModel.findByIdWithItems(Number(args.id))
  else if (actionId === 'comfy.save') record = WorkflowModel.findById(Number(page.resourceId))
  else return undefined
  if (!record) throw new Error('수정할 항목을 찾을 수 없어.')
  const revision = nativeEditRevision(record)
  const selected = page.data?.selected
  if (selected && typeof selected === 'object' && !Array.isArray(selected) && selected.revision !== revision) throw new Error('페이지에 표시된 항목보다 최신 내용이 저장됐어. 새로 읽고 다시 요청해줘.')
  return revision
}

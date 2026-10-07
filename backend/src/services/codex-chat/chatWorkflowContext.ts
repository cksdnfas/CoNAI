import { describeChatWorkflowModule, sanitizeChatWorkflowInputs, type ChatPageSnapshot, type ChatWorkflowModule } from '@conai/shared'
import { ModuleDefinitionModel } from '../../models/ModuleDefinition'
import { parseModuleDefinition } from '../graph-workflow-executor/shared'

/** Only the public editor interface is exposed, never module templates or internal values. */
export function chatWorkflowModules(): ChatWorkflowModule[] {
  return ModuleDefinitionModel.findAll(true).map(parseModuleDefinition).map(describeChatWorkflowModule)
}

export function sanitizeChatWorkflowPage(page: ChatPageSnapshot): ChatPageSnapshot {
  if (!page.workflow) return page
  const modules = new Map(chatWorkflowModules().map((module) => [module.id, module]))
  return { ...page, workflow: { ...page.workflow, nodes: page.workflow.nodes.map((node) => {
    const module = modules.get(node.module_id)
    if (!module) throw new Error('비활성 또는 삭제된 모듈이 있어. 모듈 목록을 새로고침해줘.')
    return { ...node, input_values: sanitizeChatWorkflowInputs(node.input_values, module), ...(module.runInputCapable ? {} : { run_input: undefined }) }
  }) } }
}

export function requireChatWorkflowModules(expected: ChatWorkflowModule[]) {
  const live = new Map(chatWorkflowModules().map((module) => [module.id, module]))
  if (expected.some((module) => JSON.stringify(module) !== JSON.stringify(live.get(module.id)))) throw new Error('모듈 정의가 바뀌었어. 편집기를 새로고침하고 다시 제안받아줘.')
}

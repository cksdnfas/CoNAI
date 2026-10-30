/** Shared generation-service settings retained for the separate RPG game-art feature. */
export const DEFAULT_DRAW = Object.freeze({ service: 'off', workflowId: null, promptField: null })

/** Validated draw settings from the page, or the current ones when the page did not send any. */
export function parseDraw(input, current) {
  if (input === undefined) return { ...DEFAULT_DRAW, ...current }
  const service = input?.service
  if (!['off', 'novelai', 'comfyui'].includes(service)) throw new Error('그림 방식을 다시 골라줘.')
  if (service !== 'comfyui') return { ...DEFAULT_DRAW, service }
  if (!Number.isSafeInteger(input.workflowId) || input.workflowId < 1) throw new Error('그림에 쓸 ComfyUI 워크플로우를 골라줘.')
  if (typeof input.promptField !== 'string' || !input.promptField.trim() || input.promptField.length > 200) throw new Error('워크플로우에서 장면을 넣을 입력칸을 골라줘.')
  return { service, workflowId: input.workflowId, promptField: input.promptField }
}


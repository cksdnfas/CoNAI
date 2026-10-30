/*
 * The 그림 방식 picker: 안 그림 · NovelAI · ComfyUI, and for ComfyUI the workflow and the text input that takes the prompt.
 * 게임 그림 (모험) uses it; the workflow list is read once per page.
 */
export const NO_DRAW = Object.freeze({ service: 'off', workflowId: null, promptField: null })
const textFields = workflow => (workflow?.input_fields ?? []).filter(f => f.type === 'text' || f.type === 'textarea')
export const promptFieldOf = workflow => {
  const fields = textFields(workflow), named = f => `${f.id} ${f.label ?? ''}`
  return (fields.find(f => /prompt|프롬프트|positive|긍정/i.test(named(f)) && !/neg|부정/i.test(named(f))) ?? fields[0])?.id ?? null
}
let workflows = null, loading = null, failed = false
const pickers = new Set()
function loadWorkflows(list, toast) {
  if (loading) return
  const pending = list()
  if (!pending) return // no host yet: the next render asks again
  loading = (async () => {
    try {
      const call = await pending
      const text = call?.result?.content?.find?.(c => c.type === 'text')?.text ?? ''
      if (call?.status === 'failed' || call?.result?.isError) throw new Error(text.slice(0, 200) || '워크플로우 목록을 읽지 못했어.')
      workflows = JSON.parse(text).filter(w => textFields(w).length)
    } catch (error) { failed = true; toast(error.message) }
    finally { loading = null; for (const picker of pickers) picker.render() }
  })()
}
const option = (value, label, chosen) => Object.assign(document.createElement('option'), { value: String(value ?? ''), textContent: label, selected: chosen })

/**
 * `service` holds buttons with data-service, `comfy` is the row shown for ComfyUI, `workflow`/`field` its selects.
 * `get()` returns the current choice, `set(next)` takes a new one; `list()` calls list_workflows (null without a host).
 */
export function createDrawPicker({ service, comfy, workflow, field }, { list, get, set, toast = () => {} }) {
  function render() {
    const draw = get()
    for (const b of service.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.service === draw.service))
    comfy.hidden = draw.service !== 'comfyui'
    if (draw.service !== 'comfyui') return
    if (!workflows) {
      workflow.replaceChildren(option('', failed ? '워크플로우 목록을 못 읽었어' : '불러오는 중…', true)); field.hidden = true
      if (!failed) loadWorkflows(list, toast)
      return
    }
    const chosen = workflows.find(w => w.id === draw.workflowId)
    workflow.replaceChildren(option('', workflows.length ? '워크플로우 고르기' : '쓸 수 있는 워크플로우가 없어', !chosen), ...workflows.map(w => option(w.id, w.name, w === chosen)))
    field.hidden = !chosen
    field.replaceChildren(...textFields(chosen).map(f => option(f.id, f.label || f.id, f.id === draw.promptField)))
  }
  for (const b of service.querySelectorAll('button')) b.addEventListener('click', () => {
    const draw = get()
    if (draw.service === b.dataset.service) return
    if (b.dataset.service === 'comfyui') failed = false // picking ComfyUI again retries a list that failed to load
    set(b.dataset.service === 'comfyui' ? { ...draw, service: 'comfyui' } : { ...NO_DRAW, service: b.dataset.service }); render()
  })
  workflow.addEventListener('change', () => {
    const chosen = workflows?.find(w => String(w.id) === workflow.value)
    set({ service: 'comfyui', workflowId: chosen?.id ?? null, promptField: promptFieldOf(chosen) }); render()
  })
  field.addEventListener('change', () => { set({ ...get(), promptField: field.value }); render() })
  const picker = { render }
  pickers.add(picker)
  return picker
}

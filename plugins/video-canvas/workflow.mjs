import { $, esc } from './util.mjs'
import { s, ctx, nodeById, cuts, profileOf } from './state.mjs'
import { toast } from './toast.mjs'
import { request, edit, reload } from './session.mjs'
import { modal } from './dialogs.mjs'

// Cut inputs are never profile settings (the server rejects them), so they never show up as form fields.
const RESERVED = ['mode', 'duration', 'media', 'assets', 'timeline_data', 'refmods', 'builder_state', 'prompt', 'simple_prompt', 'seed']
const LABELS = {
  width: '가로', height: '세로', resolution: '해상도', fps: '프레임 레이트', frame_rate: '프레임 레이트',
  aspect: '화면 비율', input_scaling: '입력 크기 맞춤', ref_image_size: '참조 이미지 크기', custom_aspect_w: '사용자 비율 가로', custom_aspect_h: '사용자 비율 세로',
  custom_mode: '사용자 해상도 방식', custom_mp: '사용자 해상도(MP)', custom_width: '사용자 가로(px)', custom_height: '사용자 세로(px)',
}
const choices = values => values.map(value => ({ value, label: value }))
// Known Director fields get a fixed set of choices ("group/key" for the nested resolution block).
const OPTIONS = {
  'resolution/aspect': choices(['auto', '1:1', '16:9', '9:16', '2:1', '1:2', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', 'custom']),
  'resolution/resolution': choices(['auto', '144p', '240p', '360p', '480p', '540p', '576p', '720p', '900p', '1024p', '1080p', '1152p', '1440p', '2160p', '2K', '4K', 'custom']),
  'resolution/input_scaling': choices(['Off', 'Auto', 'Target', 'Fit', 'Fill and crop', 'Fit and pad', 'Long side with divisible crop']),
  'resolution/custom_mode': [{ value: 'mp', label: '해상도(MP)' }, { value: 'fixed', label: '고정 크기' }],
}
const withCurrent = (options, value) => options && value !== undefined && !options.some(option => option.value === value) ? [...options, { value, label: String(value) }] : options
let loading = null, failed = false
/** workflow_options, cached for the page; `force` re-reads it (the dialog always shows the current list). A failed load is not retried until forced. */
export function ensureOptions(force = false) {
  if (!force && s.wf) return Promise.resolve(s.wf)
  if (!force && failed) return Promise.reject(new Error('워크플로 목록을 불러오지 못했어.'))
  loading ??= request('workflow_options').then(result => { s.wf = result; failed = false; ctx.hooks.renderInspector?.(); return result })
    .catch(error => { failed = true; toast(error.message, { error: true }); throw error }).finally(() => { loading = null })
  return loading
}
export const wfOf = profile => s.wf?.workflows?.find(workflow => workflow.workflowId === profile?.workflowId)
export const serverKey = profile => profile?.serverId ? `id:${profile.serverId}` : profile?.serverTag ? `tag:${profile.serverTag}` : ''
const serverFields = key => key.startsWith('id:') ? { serverId: Number(key.slice(3)) } : key.startsWith('tag:') ? { serverTag: key.slice(4) } : {}
const serverOptions = (current) => {
  const servers = s.wf?.servers ?? [], tags = s.wf?.tags ?? []
  const known = value => servers.some(server => `id:${server.id}` === value) || tags.some(tag => `tag:${tag}` === value)
  return `<option value="">자동</option>${servers.map(server => `<option value="id:${esc(server.id)}" ${current === `id:${server.id}` ? 'selected' : ''}>${esc(server.name)}</option>`).join('')}${tags.map(tag => `<option value="tag:${esc(tag)}" ${current === `tag:${tag}` ? 'selected' : ''}>태그 · ${esc(tag)}</option>`).join('')}${current && !known(current) ? `<option value="${esc(current)}" selected>${esc(current.replace(/^id:/, '서버 #').replace(/^tag:/, '태그 · '))}</option>` : ''}`
}
/** The preset a new cut starts with: the one the latest cut uses, else the latest saved one. */
export const lastPresetId = () => [s.project.lastProfileId, ...cuts().map(cut => cut.data.profileId).reverse(), s.project.profiles.at(-1)?.id].find(id => id && s.project.profiles.some(profile => profile.id === id)) ?? null
/** Saves a profile and returns its id (the server picks the id of a new one). */
export async function saveProfile(profile) {
  const before = new Set(s.project.profiles.map(item => item.id))
  const result = await request('save_profile', { expected_revision: s.project.revision, profile })
  await reload()
  return profile.id ?? result.profiles.find(item => !before.has(item.id))?.id
}
export const profileFrom = (workflow, key = '') => ({ workflowId: workflow.workflowId, label: workflow.name, ...serverFields(key), overrides: {}, inputs: {} })
/** Asks which workflow (and server) to use. Resolves { workflow, key }, { skip: true } or null when cancelled. */
export function chooseWorkflow({ title = '어떤 워크플로로 만들까?', allowSkip = false, current } = {}) {
  return new Promise(resolve => {
    let result = null, chosen = null
    modal(title, '<div id="wf-body"><p class="muted">워크플로를 불러오는 중이야…</p></div>', { primary: '이걸로 할래', extra: allowSkip ? '<button id="wf-skip" class="ghost">나중에 고를래</button>' : '' })
    $('dialog-primary').disabled = true
    if (allowSkip) $('wf-skip').onclick = () => { result = { skip: true }; $('modal').close() }
    $('dialog-primary').onclick = () => { result = { workflow: chosen, key: $('wf-server').value }; $('modal').close() }
    $('modal').addEventListener('close', () => resolve(result), { once: true })
    ensureOptions(true).then(options => {
      if (!$('wf-body')) return
      $('wf-body').innerHTML = `<div id="wf-list" class="conai-list picker-list" role="listbox" aria-label="워크플로">${options.workflows.map(workflow => `<button class="conai-list-row" role="option" data-wf="${esc(workflow.workflowId)}" aria-selected="false" ${workflow.usable ? '' : 'disabled'}><span class="conai-row-main"><span class="conai-row-title">${esc(workflow.name)}</span>${workflow.usable ? '' : `<span class="conai-row-meta">쓸 수 없어 · ${esc(workflow.reason ?? '준비가 덜 됐어')}</span>`}</span></button>`).join('') || '<p class="conai-empty">등록된 워크플로가 없어. ComfyUI 탭에서 먼저 등록해줘.</p>'}</div><label>서버<select id="wf-server">${serverOptions(current?.key ?? '')}</select></label>`
      const pick = id => {
        chosen = options.workflows.find(workflow => String(workflow.workflowId) === String(id))
        $('wf-list').querySelectorAll('[data-wf]').forEach(row => row.setAttribute('aria-selected', String(row.dataset.wf === String(id))))
        $('dialog-primary').disabled = !chosen
      }
      $('wf-list').onclick = event => { const id = event.target.closest('[data-wf]')?.dataset.wf; if (id) pick(id) }
      if (current?.workflowId && options.workflows.some(workflow => workflow.workflowId === current.workflowId && workflow.usable)) pick(current.workflowId)
    }, error => toast(error.message, { error: true }))
  })
}
/** Saves the cut's changed settings; a preset other cuts also use is forked so only this cut changes. */
export async function updateProfile(cutId, change) {
  const cut = nodeById(cutId), profile = profileOf(cut)
  const shared = cuts().filter(item => item.data.profileId === profile.id).length > 1
  const next = { label: profile.label, workflowId: profile.workflowId, ...(profile.serverId ? { serverId: profile.serverId } : profile.serverTag ? { serverTag: profile.serverTag } : {}), overrides: { ...profile.overrides }, inputs: { ...profile.inputs } }
  change(next)
  if (!shared) next.id = profile.id
  const id = await saveProfile(next)
  if (shared) await edit([{ op: 'set', id: cutId, fields: { profileId: id } }])
}
/** Creates a preset from the dialog's choice and binds it to the cut. */
export async function bindWorkflow(cutId, choice) {
  const profile = profileOf(nodeById(cutId))
  if (profile) return updateProfile(cutId, next => {
    delete next.serverId; delete next.serverTag
    Object.assign(next, profileFrom(choice.workflow, choice.key))
  })
  const id = await saveProfile(profileFrom(choice.workflow, choice.key))
  await edit([{ op: 'set', id: cutId, fields: { profileId: id } }])
}
const valueOf = target => target.dataset.ptype === 'boolean' ? target.checked : target.dataset.ptype === 'number' ? (target.value === '' ? undefined : Number(target.value)) : target.tagName === 'SELECT' ? JSON.parse(target.value) : target.value
// Defaults are single values plus nested groups such as `resolution`; a group field is addressed as "group/key".
const defaultFields = defaults => Object.entries(defaults ?? {}).filter(([key]) => !RESERVED.includes(key)).flatMap(([key, value]) =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value).filter(([, item]) => ['number', 'string', 'boolean'].includes(typeof item)).map(([sub, item]) => ({ key: `${key}/${sub}`, label: key === 'resolution' ? (LABELS[sub] ?? sub) : `${LABELS[key] ?? key} · ${LABELS[sub] ?? sub}`, value: item }))
    : ['number', 'string', 'boolean'].includes(typeof value) ? [{ key, label: LABELS[key] ?? key, value }] : [])
function fieldHtml(field) {
  const attrs = `data-pf="${esc(field.id)}" data-ptype="${field.options ? 'option' : field.kind}" aria-label="${esc(field.label)}"`
  const input = field.options
    ? `<select ${attrs}>${field.options.map(option => { const value = option?.value ?? option, label = option?.label ?? option; return `<option value="${esc(JSON.stringify(value))}" ${JSON.stringify(value) === JSON.stringify(field.value) ? 'selected' : ''}>${esc(label)}</option>` }).join('')}</select>`
    : field.kind === 'boolean' ? `<input type="checkbox" ${attrs} ${field.value ? 'checked' : ''}>`
      : field.type === 'textarea' ? `<textarea rows="3" ${attrs}>${esc(field.value ?? '')}</textarea>`
      : field.kind === 'number' ? `<input type="number" step="any" ${field.min !== undefined ? `min="${esc(field.min)}"` : ''} ${field.max !== undefined ? `max="${esc(field.max)}"` : ''} ${attrs} value="${esc(field.value ?? '')}">`
        : `<input ${attrs} value="${esc(field.value ?? '')}">`
  return `<label class="${field.kind === 'boolean' ? 'vc-check' : ''}">${esc(field.label)}${input}</label>`
}
const kindOf = type => ['number', 'integer', 'int', 'float'].includes(type) ? 'number' : ['boolean', 'bool', 'checkbox'].includes(type) ? 'boolean' : 'text'
/** Section 1 of the cut settings: workflow and server. */
export function workflowHtml(cut) {
  const profile = profileOf(cut)
  if (!s.wf) return `<h2 class="conai-group-head">1 · 워크플로·서버</h2><p class="muted">${profile ? esc(profile.label) : ''} 워크플로 목록을 불러오는 중이야…</p>`
  const known = wfOf(profile)
  return `<h2 class="conai-group-head">1 · 워크플로·서버</h2><label>워크플로<select data-pf="workflow">${profile ? '' : '<option value="">골라줘</option>'}${s.wf.workflows.map(workflow => `<option value="${esc(workflow.workflowId)}" ${workflow.workflowId === profile?.workflowId ? 'selected' : ''} ${workflow.usable || workflow.workflowId === profile?.workflowId ? '' : 'disabled'}>${esc(workflow.name)}${workflow.usable ? '' : ` — 쓸 수 없어 (${esc(workflow.reason ?? '준비가 덜 됐어')})`}</option>`).join('')}${profile && !known ? `<option value="${esc(profile.workflowId)}" selected>${esc(profile.label)}</option>` : ''}</select></label>${profile ? `<label>서버<select data-pf="server">${serverOptions(serverKey(profile))}</select></label>` : ''}`
}
/** Section 2: the workflow's adjustable settings as a form; raw overrides only under "고급". */
export function settingsHtml(cut) {
  const profile = profileOf(cut), wf = wfOf(profile)
  const head = '<h2 class="conai-group-head">2 · 워크플로 설정</h2>'
  if (!profile) return `${head}<p class="conai-empty">워크플로를 먼저 골라줘.</p>`
  if (!s.wf) return `${head}<p class="muted">불러오는 중…</p>`
  // The custom ratio and size inputs belong to the "custom" choices, as in the app's resolution panel.
  const resolution = { ...wf?.defaults?.resolution, ...profile.overrides?.resolution }
  const customSize = resolution.resolution === 'custom', fixed = resolution.custom_mode === 'fixed'
  const hidden = [
    ...(resolution.aspect === 'custom' ? [] : ['custom_aspect_w', 'custom_aspect_h']),
    ...(customSize ? [] : ['custom_mode']), ...(customSize && !fixed ? [] : ['custom_mp']), ...(customSize && fixed ? [] : ['custom_width', 'custom_height']),
  ].map(key => `resolution/${key}`)
  const fields = wf ? [
    ...defaultFields(wf.defaults).filter(field => !hidden.includes(field.key)).map(field => {
      const [key, sub] = field.key.split('/')
      const value = (sub ? profile.overrides?.[key]?.[sub] : profile.overrides?.[key]) ?? field.value
      return { id: `o:${field.key}`, label: field.label, kind: kindOf(typeof field.value), value, options: withCurrent(OPTIONS[field.key], value) }
    }),
    ...(wf.extraFields ?? []).map(field => ({ id: `i:${field.id}`, type: field.type, label: field.label ?? field.id, kind: kindOf(field.type), options: field.options, min: field.min, max: field.max, value: profile.inputs?.[field.id] ?? field.default })),
  ] : []
  const shared = cuts().filter(item => item.data.profileId === profile.id).length > 1
  return `${head}${fields.map(fieldHtml).join('') || '<p class="conai-empty">이 워크플로에는 조절할 설정이 없어.</p>'}${shared ? '<p class="muted">같은 프리셋을 쓰는 컷이 더 있어. 바꾸면 이 컷만 새 프리셋으로 갈라져.</p>' : ''}<details data-keep="advanced"><summary>고급</summary><label>overrides (JSON)<textarea data-pf="json" rows="5">${esc(JSON.stringify(profile.overrides ?? {}, null, 2))}</textarea></label></details>`
}
/** change handler for the workflow section and settings form of a cut. */
export async function onProfileChange(target) {
  const cutId = target.closest('[data-id]').dataset.id, key = target.dataset.pf
  if (key === 'workflow') {
    const workflow = s.wf.workflows.find(item => String(item.workflowId) === target.value)
    if (workflow) await bindWorkflow(cutId, { workflow, key: serverKey(profileOf(nodeById(cutId))) })
    return
  }
  if (key === 'server') return updateProfile(cutId, next => { delete next.serverId; delete next.serverTag; Object.assign(next, serverFields(target.value)) })
  if (key === 'json') {
    let overrides
    try { overrides = JSON.parse(target.value || '{}') } catch { throw new Error('overrides가 JSON 형식이 아니야.') }
    return updateProfile(cutId, next => { next.overrides = overrides })
  }
  const value = valueOf(target), [group, id] = [key.slice(0, 1), key.slice(2)]
  return updateProfile(cutId, next => {
    const bucket = group === 'o' ? next.overrides : next.inputs, [top, sub] = id.split('/')
    if (sub && group === 'o') {
      // A changed group is sent whole (the workflow's defaults with the user's change), so it never half-applies.
      bucket[top] = { ...wfOf(profileOf(nodeById(cutId)))?.defaults?.[top], ...bucket[top], [sub]: value }
    } else if (value === undefined) delete bucket[id]; else bucket[id] = value
  })
}

import { adapterOf, outputOf } from './domain.mjs'
import { $, esc, outputNames } from './util.mjs'
import { s, ctx, nodeById, cuts, profileOf, genProfiles } from './state.mjs'
import { toast } from './toast.mjs'
import { request, edit, reload, ui } from './session.mjs'
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
/** workflow_options, cached for the page; `force` re-reads it (the dialog always shows the current list). A failed load is not retried until forced.
 *  It asks for the app's generation presets and the skill sections a guide can link too; only administrators get them,
 *  so a missing `presets` hides the preset import and a missing `skills` the guide skill picker. */
export function ensureOptions(force = false) {
  if (!force && s.wf) return Promise.resolve(s.wf)
  if (!force && failed) return Promise.reject(new Error('워크플로 목록을 불러오지 못했어.'))
  loading ??= request('workflow_options', { presets: true, skills: true }).then(result => { s.wf = result; failed = false; ctx.hooks.renderInspector?.(); return result })
    .catch(error => { failed = true; toast(error.message, { error: true }); throw error }).finally(() => { loading = null })
  return loading
}
export const wfOf = profile => s.wf?.workflows?.find(workflow => workflow.workflowId === profile?.workflowId)
export const serverKey = profile => profile?.serverId ? `id:${profile.serverId}` : profile?.serverTag ? `tag:${profile.serverTag}` : ''
// The server keeps what a save leaves out, so choosing "자동" (or the other kind of server) has to say null for the one it drops.
const serverFields = key => ({ serverId: key.startsWith('id:') ? Number(key.slice(3)) : null, serverTag: key.startsWith('tag:') ? key.slice(4) : null })
const serverOptions = (current) => {
  const servers = s.wf?.servers ?? [], tags = s.wf?.tags ?? []
  const known = value => servers.some(server => `id:${server.id}` === value) || tags.some(tag => `tag:${tag}` === value)
  return `<option value="">자동</option>${servers.map(server => `<option value="id:${esc(server.id)}" ${current === `id:${server.id}` ? 'selected' : ''}>${esc(server.name)}</option>`).join('')}${tags.map(tag => `<option value="tag:${esc(tag)}" ${current === `tag:${tag}` ? 'selected' : ''}>태그 · ${esc(tag)}</option>`).join('')}${current && !known(current) ? `<option value="${esc(current)}" selected>${esc(current.replace(/^id:/, '서버 #').replace(/^tag:/, '태그 · '))}</option>` : ''}`
}
// The setting a new node starts with, among the profiles that fit its kind (cuts take Director ones, generation nodes the others): the one used last, else the latest saved.
const lastOf = (director, nodes) => {
  const own = s.project.profiles.filter(profile => (adapterOf(profile) === 'director') === director)
  return [s.project.lastProfileId, ...nodes.map(node => node.data.profileId).reverse(), own.at(-1)?.id].find(id => own.some(profile => profile.id === id)) ?? null
}
export const lastPresetId = () => lastOf(true, cuts())
export const lastGeneratorId = () => lastOf(false, s.project.nodes.filter(node => node.kind === 'gen'))
/** Saves a profile and returns its id (the server picks the id of a new one). */
export async function saveProfile(profile) {
  const before = new Set(s.project.profiles.map(item => item.id))
  const result = await request('save_profile', { expected_revision: s.project.revision, profile })
  await reload()
  return profile.id ?? result.profiles.find(item => !before.has(item.id))?.id
}
export const profileFrom = (workflow, key = '') => ({ workflowId: workflow.workflowId, label: workflow.name, ...serverFields(key), overrides: {}, inputs: {} })
// A cut runs an image-kind (Director) workflow; sound workflows are only for generation nodes.
const imageKind = workflow => workflow.kind === 'image'
/** Asks which workflow (and server) to use. Resolves { workflow, key }, { skip: true } or null when cancelled. */
export function chooseWorkflow({ title = '어떤 워크플로로 만들까?', allowSkip = false, current } = {}) {
  return new Promise(resolve => {
    let result = null, chosen = null
    modal(title, '<div id="wf-body"><p class="muted">워크플로를 불러오는 중이야…</p></div>', { primary: '이걸로 할래', extra: allowSkip ? '<button id="wf-skip" class="ghost">나중에 고를래</button>' : '' })
    $('dialog-primary').disabled = true
    if (allowSkip) $('wf-skip').onclick = () => { result = { skip: true }; $('modal').close() }
    $('dialog-primary').onclick = () => { result = { workflow: chosen, key: $('wf-server').value }; $('modal').close() }
    $('modal').addEventListener('close', () => resolve(result), { once: true })
    ensureOptions(true).then(({ workflows: all }) => {
      if (!$('wf-body')) return
      const workflows = all.filter(imageKind)
      $('wf-body').innerHTML = `<div id="wf-list" class="conai-list picker-list" role="listbox" aria-label="워크플로">${workflows.map(workflow => `<button class="conai-list-row" role="option" data-wf="${esc(workflow.workflowId)}" aria-selected="false" ${workflow.usable ? '' : 'disabled'}><span class="conai-row-main"><span class="conai-row-title">${esc(workflow.name)}</span>${workflow.usable ? '' : `<span class="conai-row-meta">쓸 수 없어 · ${esc(workflow.reason ?? '준비가 덜 됐어')}</span>`}</span></button>`).join('') || '<p class="conai-empty">등록된 워크플로가 없어. ComfyUI 탭에서 먼저 등록해줘.</p>'}</div><label>서버<select id="wf-server">${serverOptions(current?.key ?? '')}</select></label>`
      const pick = id => {
        chosen = workflows.find(workflow => String(workflow.workflowId) === String(id))
        $('wf-list').querySelectorAll('[data-wf]').forEach(row => row.setAttribute('aria-selected', String(row.dataset.wf === String(id))))
        $('dialog-primary').disabled = !chosen
      }
      $('wf-list').onclick = event => { const id = event.target.closest('[data-wf]')?.dataset.wf; if (id) pick(id) }
      if (current?.workflowId && workflows.some(workflow => workflow.workflowId === current.workflowId && workflow.usable)) pick(current.workflowId)
    }, error => toast(error.message, { error: true }))
  })
}
/** Saves the cut's changed settings; a preset other cuts also use is forked so only this cut changes. */
export async function updateProfile(cutId, change) {
  const cut = nodeById(cutId), profile = profileOf(cut)
  const shared = cuts().filter(item => item.data.profileId === profile.id).length > 1
  const next = { label: profile.label, workflowId: profile.workflowId, ...(profile.serverId ? { serverId: profile.serverId } : profile.serverTag ? { serverTag: profile.serverTag } : {}), overrides: { ...profile.overrides }, inputs: { ...profile.inputs } }
  // The guide text travels with the setting; the skill link stays on the stored profile by itself, so only a fork has to bring it along.
  for (const key of shared ? ['instruction', 'guide', 'guideSkill'] : ['instruction', 'guide']) if (profile[key] !== undefined) next[key] = profile[key]
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
  return `<h2 class="conai-group-head">1 · 워크플로·서버</h2><label>워크플로<select data-pf="workflow">${profile ? '' : '<option value="">골라줘</option>'}${s.wf.workflows.filter(imageKind).map(workflow => `<option value="${esc(workflow.workflowId)}" ${workflow.workflowId === profile?.workflowId ? 'selected' : ''} ${workflow.usable || workflow.workflowId === profile?.workflowId ? '' : 'disabled'}>${esc(workflow.name)}${workflow.usable ? '' : ` — 쓸 수 없어 (${esc(workflow.reason ?? '준비가 덜 됐어')})`}</option>`).join('')}${profile && !known ? `<option value="${esc(profile.workflowId)}" selected>${esc(profile.label)}</option>` : ''}</select></label>${profile ? `<label>서버<select data-pf="server">${serverOptions(serverKey(profile))}</select></label>` : ''}`
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
  if (nodeById(cutId).kind === 'gen') return onGenChange(nodeById(cutId), key, target)
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

// ---- generation settings: the profiles of generation nodes (ComfyUI workflow or NovelAI), registered here or copied from an app preset ----
const adapterNames = { workflow: 'ComfyUI 워크플로', nai: 'NovelAI' }
const opt = (value, label, current, disabled = false) => `<option value="${esc(value)}" ${String(value) === String(current) ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${esc(label)}</option>`
const workflowById = id => s.wf?.workflows?.find(workflow => workflow.workflowId === id)
/** True when the app listed its generation presets for this account (administrators); only then can presets be imported and guide skills linked. */
export const presetsAvailable = () => Array.isArray(s.wf?.presets)
/** The title of a linked guide skill section or group: the skill list (administrators) and the preset list know it, the node read has it for the open node, else its ID. */
export function guideTitle(link) {
  const skill = s.wf?.skills?.find(item => item.skillId === link.skillId)
  const listed = [...(skill?.sections ?? []), ...(skill?.groups ?? [])].find(item => item.path === link.path)?.title
  const known = s.wf?.presets?.find(preset => preset.guideSkill?.skillId === link.skillId && preset.guideSkill.path === link.path)?.guideSkill.title
  const read = s.nodeDetail?.preview?.guide?.skill
  return listed ?? known ?? (read?.skillId === link.skillId && read.path === link.path ? read.title : null) ?? `스킬 #${link.skillId} · ${link.path}`
}
/** Section 1 of a generation node's settings: which generation settings it uses, and where to register or import one. */
export function genSettingsHtml(node) {
  const profile = profileOf(node), used = profile ? s.project.nodes.filter(item => item.kind === 'gen' && item.data.profileId === profile.id).length : 0
  return `<h2 class="conai-group-head">1 · 생성 설정</h2><label>생성 설정<select data-pf="profile">${profile ? '' : '<option value="">골라줘</option>'}${genProfiles().map(item => opt(item.id, `${item.label} · ${outputNames[outputOf(item)]}`, profile?.id)).join('')}</select></label>
    <div class="toolbar">${profile ? '<button data-gen="edit">생성 설정 고치기</button>' : ''}<button data-gen="new">새 생성 설정</button>${presetsAvailable() ? '<button data-gen="import">생성 프리셋에서 가져오기</button>' : ''}</div>
    ${profile ? `<p class="muted">${adapterNames[adapterOf(profile)]} · 결과 종류 ${outputNames[outputOf(profile)]}${used > 1 ? ` · 이 생성 설정을 쓰는 생성 노드 ${used}개` : ''}</p>` : '<p class="conai-empty">생성 설정을 먼저 골라줘.</p>'}`
}
/** The fields a generation node fills itself (the profile marks them "노드마다"). */
export function genFieldsHtml(node) {
  const profile = profileOf(node)
  if (!profile || adapterOf(profile) !== 'workflow') return ''
  if (!s.wf) return '<p class="muted">불러오는 중…</p>'
  const fields = (workflowById(profile.workflowId)?.extraFields ?? []).filter(field => (profile.exposedFieldIds ?? []).includes(field.id) && field.id !== profile.promptFieldId && field.id !== profile.seedFieldId)
  return fields.map(field => fieldHtml({ id: `g:${field.id}`, type: field.type, label: field.label, kind: kindOf(field.type), options: field.options, min: field.min, max: field.max, value: node.data.inputs?.[field.id] ?? field.default })).join('')
}
async function onGenChange(node, key, target) {
  // Another profile has other fields and sizes, so the values meant for the old one go.
  if (key === 'profile') return edit([{ op: 'set', id: node.id, fields: { profileId: target.value || null, inputs: {}, size: null } }])
  const id = key.slice(2), value = valueOf(target), inputs = { ...node.data.inputs }
  if (value === undefined) delete inputs[id]; else inputs[id] = value
  return edit([{ op: 'set', id: node.id, fields: { inputs } }])
}

const draftFor = profile => {
  const exposed = profile?.exposedFieldIds ?? [], fixed = profile?.fixedInputs ?? {}
  return { id: profile?.id, original: profile ?? null, label: profile?.label ?? '', workflowId: profile?.workflowId ?? null, output: profile?.output ?? 'image',
    promptFieldId: profile?.promptFieldId ?? '', seedFieldId: profile?.seedFieldId ?? '', imageFieldIds: [...(profile?.imageFieldIds ?? [])],
    mode: Object.fromEntries([...exposed.map(id => [id, 'node']), ...Object.keys(fixed).map(id => [id, 'fixed'])]), fixed: { ...fixed },
    key: serverKey(profile), instruction: profile?.instruction ?? '', guide: profile?.guide ?? '',
    // `skill` is the guide skill link to save (undefined keeps the stored one, null cuts it); `skillId` is only the skill the picker shows.
    skill: undefined, skillId: profile?.guideSkill?.skillId ?? null, autoLabel: null }
}
/** A newly chosen workflow brings its detected roles and an output guess; values meant for the old workflow go. */
function useWorkflow(draft, workflow) {
  const { generator } = workflow
  Object.assign(draft, { workflowId: workflow.workflowId, output: generator.output, promptFieldId: generator.promptFieldId ?? '', seedFieldId: generator.seedFieldId ?? '', imageFieldIds: [...generator.imageFieldIds], mode: {}, fixed: {} })
  if (!draft.label.trim() || draft.label === draft.autoLabel) draft.label = workflow.name
  draft.autoLabel = workflow.name
}
// The simple fields that are neither the prompt nor the seed: each is the workflow's default, fixed in the profile, or filled per node.
const otherFields = (draft, workflow) => (workflow?.extraFields ?? []).filter(field => field.id !== draft.promptFieldId && field.id !== draft.seedFieldId)
const textFields = workflow => (workflow?.extraFields ?? []).filter(field => field.type === 'text' || field.type === 'textarea')
const plain = value => typeof value === 'object' ? '' : value ?? ''
function fixedControl(field, draft) {
  const value = draft.fixed[field.id], attrs = `data-g="fixed" data-gid="${esc(field.id)}" aria-label="${esc(field.label)} 고정값"`
  if (field.options) return `<select ${attrs}>${field.options.map(option => opt(option, option, value)).join('')}${value !== undefined && !field.options.includes(value) ? opt(value, `${value} (목록에 없음)`, value) : ''}</select>`
  return `<input ${attrs} type="${field.type === 'number' ? 'number' : 'text'}" ${field.type === 'number' ? 'step="any"' : ''} value="${esc(value ?? '')}" placeholder="${esc(plain(field.default))}">`
}
const MODES = [['default', '워크플로 기본값'], ['fixed', '고정값'], ['node', '생성 노드마다 채움']]
const sameLink = (a, b) => a?.skillId === b?.skillId && a?.path === b?.path
/** The guide skill: its linked section's title for everyone; administrators (the app lists skills only to them) also pick a skill, then one of its sections
 *  or a group of them, or cut the link. A skill that is off is listed with a note: its guide is not read until it is turned on. */
function guideSkillHtml(draft) {
  const link = draft.skill === undefined ? draft.original?.guideSkill : draft.skill, skills = s.wf?.skills
  const shown = `<p>가이드 스킬 · ${link ? esc(guideTitle(link)) : '<span class="muted">연결 없음</span>'}</p>`
  if (!Array.isArray(skills)) return `${shown}<p class="muted">가이드 스킬 연결은 관리자만 바꿀 수 있어.</p>`
  const picked = skills.find(skill => skill.skillId === draft.skillId)
  const entries = picked ? [...picked.groups.map(group => ({ path: group.path, label: `${group.title} — 그룹 (섹션 ${group.count}개)` })), ...picked.sections.map(section => ({ path: section.path, label: section.title }))] : []
  return `${shown}<label>가이드 스킬 고르기<select data-g="skillId"><option value="">연결 없음</option>${skills.map(skill => opt(skill.skillId, skill.enabled ? skill.name : `${skill.name} (꺼져 있음)`, draft.skillId)).join('')}${draft.skillId !== null && !picked ? opt(draft.skillId, `스킬 #${draft.skillId}`, draft.skillId) : ''}</select></label>
    ${picked ? `${picked.enabled ? '' : '<p class="warning">이 스킬이 꺼져 있어서, 켜기 전에는 가이드를 읽지 않아.</p>'}<label>스킬 섹션<select data-g="skillPath"><option value="">섹션 고르기</option>${entries.map(entry => opt(entry.path, entry.label, link?.skillId === picked.skillId ? link.path : '')).join('')}</select></label>` : ''}`
}
function generatorBody(draft) {
  const nai = draft.original && adapterOf(draft.original) === 'nai', workflow = workflowById(draft.workflowId)
  const guideText = `<label>안내 (이 생성 설정이 무엇을 만드는지)<textarea data-g="instruction" rows="2">${esc(draft.instruction)}</textarea></label><label>가이드 (프롬프트 쓰는 법)<textarea data-g="guide" rows="5">${esc(draft.guide)}</textarea></label>${guideSkillHtml(draft)}`
  const name = `<label>이름<input data-g="label" value="${esc(draft.label)}"></label>`
  if (nai) {
    const config = draft.original.nai
    return `${name}<p class="muted">NovelAI 설정은 생성 프리셋에서 복사한 값이라 여기서 고칠 수 없어. 바꾸려면 생성 프리셋을 다시 가져와줘.</p><p class="muted">${esc(config.model)} · 크기 ${esc(config.sizes.map(size => size.label).join(', '))}</p>${guideText}`
  }
  const known = s.wf.workflows
  const prompts = textFields(workflow), images = workflow?.generator.imageFields ?? []
  const roles = workflow ? `<h2 class="conai-group-head">필드 역할</h2>
    <label>프롬프트 필드<select data-g="promptFieldId"><option value="">없음 (프롬프트를 쓰지 않아)</option>${prompts.map(field => opt(field.id, field.label, draft.promptFieldId)).join('')}${draft.promptFieldId && !prompts.some(field => field.id === draft.promptFieldId) ? opt(draft.promptFieldId, draft.promptFieldId, draft.promptFieldId) : ''}</select></label>
    <label>시드 필드<select data-g="seedFieldId"><option value="">없음 (시드를 보내지 않아)</option>${[...new Set([workflow.generator.seedFieldId, draft.seedFieldId].filter(Boolean))].map(id => opt(id, id, draft.seedFieldId)).join('')}</select></label>
    ${images.length ? `<p>입력 이미지 필드 <span class="muted">(체크한 필드에 위에서부터 입력 이미지 1번, 2번… 순서로 들어가)</span></p>${images.map(field => `<label class="vc-check"><input type="checkbox" data-g="img" value="${esc(field.id)}" ${draft.imageFieldIds.includes(field.id) ? 'checked' : ''}>${esc(field.label)}</label>`).join('')}` : '<p class="muted">이 워크플로에는 이미지 입력 필드가 없어.</p>'}
    <h2 class="conai-group-head">다른 필드</h2>${otherFields(draft, workflow).map(field => `<div class="vc-gfield"><span class="vc-gfield-label" title="${esc(field.id)}">${esc(field.label)}</span><select data-g="mode" data-gid="${esc(field.id)}" aria-label="${esc(field.label)} 방식">${MODES.map(([value, label]) => opt(value, label, draft.mode[field.id] ?? 'default')).join('')}</select>${draft.mode[field.id] === 'fixed' ? `<div class="vc-gfixed">${fixedControl(field, draft)}</div>` : ''}</div>`).join('') || '<p class="muted">더 정할 필드가 없어.</p>'}`
    : draft.workflowId ? '<p class="warning">이 워크플로를 지금 목록에서 찾을 수 없어. 필드 설정은 그대로 두고 이름·안내·가이드만 고칠 수 있어.</p>' : ''
  return `${name}<label>워크플로<select data-g="workflowId">${draft.workflowId ? '' : '<option value="">골라줘</option>'}${known.map(item => opt(item.workflowId, `${item.name}${item.generator.usable ? '' : ` — 쓸 수 없어 (${item.generator.reason ?? '준비가 덜 됐어'})`}`, draft.workflowId, !item.generator.usable && item.workflowId !== draft.workflowId)).join('')}${draft.workflowId && !workflow ? opt(draft.workflowId, draft.original?.label ?? `워크플로 #${draft.workflowId}`, draft.workflowId) : ''}</select></label>
    <label>서버<select data-g="key">${serverOptions(draft.key)}</select></label>
    <label>결과 종류<select data-g="output">${Object.entries(outputNames).map(([value, label]) => opt(value, label, draft.output)).join('')}</select></label>${roles}${guideText}`
}
function profileFromDraft(draft) {
  const workflow = workflowById(draft.workflowId), nai = draft.original && adapterOf(draft.original) === 'nai'
  const common = { ...(draft.id ? { id: draft.id } : {}), label: draft.label.trim(), instruction: draft.instruction, guide: draft.guide, ...(draft.skill === undefined ? {} : { guideSkill: draft.skill }) }
  if (nai) return { ...common, output: 'image' }
  const shown = otherFields(draft, workflow), listed = new Set((workflow?.extraFields ?? []).map(field => field.id))
  // Values of fields this form cannot show (kept as they were) stay in the profile.
  const hidden = key => !listed.has(key)
  const fixedInputs = { ...Object.fromEntries(Object.entries(draft.original?.fixedInputs ?? {}).filter(([key]) => hidden(key))), ...Object.fromEntries(shown.filter(field => draft.mode[field.id] === 'fixed' && draft.fixed[field.id] !== undefined && draft.fixed[field.id] !== '').map(field => [field.id, draft.fixed[field.id]])) }
  const exposedFieldIds = [...(draft.original?.exposedFieldIds ?? []).filter(hidden), ...shown.filter(field => draft.mode[field.id] === 'node').map(field => field.id)]
  return { ...common, workflowId: draft.workflowId, output: draft.output, promptFieldId: draft.promptFieldId || null, seedFieldId: draft.seedFieldId || null, imageFieldIds: draft.imageFieldIds, exposedFieldIds, fixedInputs, ...serverFields(draft.key) }
}
const STRUCTURAL = ['workflowId', 'promptFieldId', 'seedFieldId', 'mode', 'skillId', 'skillPath']
/** Registers a generation setting, or edits `profile`. Resolves the saved profile's ID, or null when cancelled. */
export async function generatorDialog({ profile } = {}) {
  await ensureOptions(true)
  return new Promise(resolve => {
    const draft = draftFor(profile)
    let saved = null
    modal(profile ? '생성 설정 고치기' : '생성 설정 등록', '<div id="gen-form"></div>', { primary: '저장' })
    const render = () => {
      const form = $('gen-form')
      form.innerHTML = generatorBody(draft)
      $('dialog-primary').disabled = !draft.workflowId && !(draft.original && adapterOf(draft.original) === 'nai')
    }
    $('gen-form').addEventListener('input', event => handle(event))
    $('gen-form').addEventListener('change', event => handle(event))
    function handle(event) {
      const target = event.target, key = target.dataset.g, id = target.dataset.gid, workflow = workflowById(draft.workflowId)
      if (!key) return
      if (key === 'img') draft.imageFieldIds = [...$('gen-form').querySelectorAll('[data-g=img]')].filter(box => box.checked).map(box => box.value)
      else if (key === 'workflowId') { const next = workflowById(Number(target.value)); if (next) useWorkflow(draft, next) }
      else if (key === 'mode') {
        draft.mode[id] = target.value
        const field = workflow?.extraFields.find(item => item.id === id)
        if (target.value === 'fixed' && draft.fixed[id] === undefined && field?.options) draft.fixed[id] = field.default ?? field.options[0]
      } else if (key === 'fixed') {
        const field = workflow?.extraFields.find(item => item.id === id)
        draft.fixed[id] = field?.type === 'number' ? (target.value === '' ? undefined : Number(target.value)) : target.value
      } else if (key === 'skillId') {
        draft.skillId = target.value ? Number(target.value) : null
        // Choosing "연결 없음" cuts the stored link; choosing a skill changes nothing until one of its sections is picked.
        if (!target.value) draft.skill = draft.original?.guideSkill ? null : undefined
      } else if (key === 'skillPath') {
        if (target.value) { const link = { skillId: draft.skillId, path: target.value }; draft.skill = sameLink(link, draft.original?.guideSkill) ? undefined : link }
      } else draft[key] = target.value
      if (event.type === 'change' && STRUCTURAL.includes(key)) render()
    }
    $('dialog-primary').onclick = () => void ui(async () => { saved = await saveProfile(profileFromDraft(draft)); $('modal').close() })
    $('modal').addEventListener('close', () => resolve(saved), { once: true })
    render()
  })
}
/** Asks which preset to copy, then makes the generation setting from it. Resolves the new profile's ID, or null when cancelled. */
export async function importPresetDialog() {
  await ensureOptions(true)
  const presets = s.wf.presets ?? []
  return new Promise(resolve => {
    let chosen = null, saved = null
    const kindNames = { comfyui: 'ComfyUI', nai: 'NovelAI' }
    modal('생성 프리셋에서 가져오기', `<p class="muted">앱의 생성 프리셋을 복사해서 생성 설정을 만들어. 안내·가이드 글도 같이 복사해. 가져온 뒤에 생성 프리셋을 고쳐도 여기엔 반영되지 않아. 가이드 스킬은 복사가 아니라 연결이라서, 스킬 내용이 바뀌면 그대로 따라가.</p>
      <div id="preset-list" class="conai-list picker-list" role="listbox" aria-label="생성 프리셋">${presets.map(preset => `<button class="conai-list-row" role="option" data-preset="${esc(preset.id)}" aria-selected="false" ${preset.usable ? '' : 'disabled'}><span class="conai-row-main"><span class="conai-row-title">${esc(preset.name)}</span><span class="conai-row-meta">${esc([kindNames[preset.kind] ?? preset.kind, preset.hasGuide ? '가이드 있음' : '', preset.guideSkill ? `가이드 스킬 · ${preset.guideSkill.title ?? `#${preset.guideSkill.skillId}`}` : ''].filter(Boolean).join(' · '))}</span>${preset.usable ? '' : `<span class="conai-row-meta">쓸 수 없어 · ${esc(preset.reason ?? '준비가 덜 됐어')}</span>`}</span></button>`).join('') || '<p class="conai-empty">가져올 생성 프리셋이 없어.</p>'}</div>
      <label>이름<input id="preset-label"></label><label id="preset-output-field" hidden>결과 종류<select id="preset-output">${Object.entries(outputNames).map(([value, label]) => opt(value, label, 'image')).join('')}</select></label>`, { primary: '가져오기' })
    $('dialog-primary').disabled = true
    $('preset-list').onclick = event => {
      const id = event.target.closest('[data-preset]')?.dataset.preset
      if (!id) return
      chosen = presets.find(preset => String(preset.id) === id)
      $('preset-list').querySelectorAll('[data-preset]').forEach(row => row.setAttribute('aria-selected', String(row.dataset.preset === id)))
      $('preset-label').value = chosen.name
      $('preset-output-field').hidden = chosen.kind === 'nai'
      $('preset-output').value = workflowById(chosen.workflowId)?.generator.output ?? 'image'
      $('dialog-primary').disabled = false
    }
    $('dialog-primary').onclick = () => void ui(async () => {
      const label = $('preset-label').value.trim()
      const result = await request('import_preset', { expected_revision: s.project.revision, preset: { id: chosen.id, ...(label && label !== chosen.name ? { label } : {}), ...(chosen.kind === 'nai' ? {} : { output: $('preset-output').value }) } })
      await reload()
      saved = result.lastProfileId
      $('modal').close()
    })
    $('modal').addEventListener('close', () => resolve(saved), { once: true })
  })
}
/** Asks which generation setting to use. Resolves { id }, { skip: true } or null when cancelled; registering or importing happens here and resolves the new ID. */
export async function chooseGenerator({ title = '어떤 생성 설정으로 만들까?', allowSkip = false, current } = {}) {
  await ensureOptions(true)
  const pick = await new Promise(resolve => {
    let result = null
    const list = genProfiles()
    modal(title, `<div id="gen-list" class="conai-list picker-list" role="listbox" aria-label="생성 설정">${list.map(item => `<button class="conai-list-row" role="option" data-profile="${esc(item.id)}" aria-selected="${item.id === current}"><span class="conai-row-main"><span class="conai-row-title">${esc(item.label)}</span><span class="conai-row-meta">${esc(adapterNames[adapterOf(item)])} · 결과 종류 ${esc(outputNames[outputOf(item)])}</span></span></button>`).join('') || '<p class="conai-empty">등록한 생성 설정이 없어. 새로 만들거나 생성 프리셋에서 가져와줘.</p>'}</div>`,
      { extra: `<button id="gen-new">새 생성 설정</button>${presetsAvailable() ? '<button id="gen-import">생성 프리셋에서 가져오기</button>' : ''}${allowSkip ? '<button id="gen-skip" class="ghost">나중에 고를래</button>' : ''}` })
    const done = value => { result = value; $('modal').close() }
    $('gen-list').onclick = event => { const id = event.target.closest('[data-profile]')?.dataset.profile; if (id) done({ id }) }
    $('gen-new').onclick = () => done({ action: 'new' })
    if (presetsAvailable()) $('gen-import').onclick = () => done({ action: 'import' })
    if (allowSkip) $('gen-skip').onclick = () => done({ skip: true })
    $('modal').addEventListener('close', () => resolve(result), { once: true })
  })
  if (!pick?.action) return pick
  const id = await (pick.action === 'import' ? importPresetDialog() : generatorDialog())
  return id ? { id } : null
}

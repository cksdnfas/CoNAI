import { adapterOf, outputOf, roleOf, sameValue } from './domain.mjs'
import { $, esc, outputNames, icon, iconButton } from './util.mjs'
import { s, ctx, nodeById, profileOf, genProfiles, settingsOf, defaultOf, cutDefault } from './state.mjs'
import { toast } from './toast.mjs'
import { request, accountRequest, edit, ui } from './session.mjs'
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
    // `toasted` tells a caller that catches the error that the person has been told already.
    .catch(error => { failed = true; toast(error.message, { error: true }); error.toasted = true; throw error }).finally(() => { loading = null })
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
export const serverName = key => key.startsWith('id:') ? s.wf?.servers?.find(server => `id:${server.id}` === key)?.name ?? `서버 #${key.slice(3)}` : key.startsWith('tag:') ? `태그 · ${key.slice(4)}` : '서버 자동'
/** What a workflow offers a use (`cut`, `upscale` or `gen`): { usable, reason? }, as the server worked it out. */
const useOf = (role, workflow) => role === 'cut' ? workflow : role === 'gen' ? workflow.generator : workflow.upscale
/** The workflows a use can take: `usable` are the rows of its picker, `hidden` ones (with the reason) are only counted and listed.
 *  A cut or an upscale runs an image-kind workflow; sound workflows are only for generation nodes. */
export function workflowsFor(role) {
  const all = (s.wf?.workflows ?? []).filter(workflow => role === 'gen' || workflow.kind === 'image')
  return { usable: all.filter(workflow => useOf(role, workflow).usable), hidden: all.filter(workflow => !useOf(role, workflow).usable).map(workflow => ({ workflow, reason: useOf(role, workflow).reason })) }
}
/** A cut setting's changes to its workflow's defaults as text ("해상도 720p · 화면 비율 16:9"): the app saves only changed values, but an older fork can hold defaults too. */
function changedSettings(profile, wf) {
  const base = new Map(defaultFields(wf?.defaults).map(field => [field.key, field.value]))
  const changed = defaultFields(profile.overrides).filter(field => !sameValue(base.get(field.key), field.value)).map(field => `${field.label} ${field.value}`)
  const inputs = Object.keys(profile.inputs ?? {}).length
  return [...changed, ...(inputs ? [`추가 입력 ${inputs}개`] : [])].join(' · ')
}
/** What tells one setting from another: [{ key, text, warn? }], for the settings dialog's rows and the inspector's tooltip and warnings. */
export function profileFacts(profile) {
  const role = roleOf(profile), wf = wfOf(profile), facts = []
  if (adapterOf(profile) === 'nai') facts.push({ key: '종류', text: `NovelAI · ${profile.nai.model}` })
  else {
    facts.push({ key: '워크플로', text: wf?.name ?? (s.wf ? '워크플로를 찾을 수 없어' : `#${profile.workflowId}`), warn: Boolean(s.wf) && !wf })
    if (wf && !useOf(role, wf).usable) facts.push({ key: '상태', text: `지금은 쓸 수 없어 · ${useOf(role, wf).reason ?? '준비가 덜 됐어'}`, warn: true })
    facts.push({ key: '서버', text: serverName(serverKey(profile)) })
  }
  if (role === 'cut') { const changed = changedSettings(profile, wf); if (changed) facts.push({ key: '바뀐 설정', text: changed }) }
  // The rows of the dialog show the text only, so each one says what it is: two settings on one workflow differ in these.
  if (role === 'upscale') facts.push({ key: '영상 입력', text: `영상 입력 ${wf?.upscale.videoFields.find(field => field.id === profile.videoFieldId)?.label ?? profile.videoFieldId}` })
  if (role !== 'cut') facts.push(...fieldFacts(profile, wf))
  if (role === 'gen') facts.push({ key: '결과', text: outputNames[outputOf(profile)] })
  return facts
}
/** The facts of a setting as one line (what the settings rows and the menus show to tell same-named settings apart); a fault is not part of it. */
export const factsLine = profile => profileFacts(profile).filter(fact => !fact.warn).map(fact => fact.text).join(' · ')
const fieldLabel = (wf, id) => wf?.extraFields?.find(field => field.id === id)?.label ?? id
// A fixed image can be a data URL of any size; a value that is not plain text is not spelled out.
const fixedText = value => typeof value === 'string' ? (/^data:/i.test(value.trim()) ? '(파일)' : value) : value !== null && typeof value === 'object' ? '…' : String(value)
/** A workflow setting's fixed values and (a generation setting's) fields every node fills itself. */
function fieldFacts(profile, wf) {
  const fixed = Object.entries(profile.fixedInputs ?? {}).map(([id, value]) => `${fieldLabel(wf, id)} ${fixedText(value)}`)
  const perNode = (profile.exposedFieldIds ?? []).filter(id => id !== profile.promptFieldId && id !== profile.seedFieldId).map(id => fieldLabel(wf, id))
  return [...(fixed.length ? [{ key: '고정값', text: `고정값 ${fixed.join(', ')}` }] : []), ...(perNode.length ? [{ key: '노드마다', text: `노드마다 ${perNode.join(', ')}` }] : [])]
}
export const valueOf = target => target.dataset.ptype === 'boolean' ? target.checked : target.dataset.ptype === 'number' ? (target.value === '' ? undefined : Number(target.value)) : target.tagName === 'SELECT' ? JSON.parse(target.value) : target.value
// Defaults are single values plus nested groups such as `resolution`; a group field is addressed as "group/key".
const defaultFields = defaults => Object.entries(defaults ?? {}).filter(([key]) => !RESERVED.includes(key)).flatMap(([key, value]) =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value).filter(([, item]) => ['number', 'string', 'boolean'].includes(typeof item)).map(([sub, item]) => ({ key: `${key}/${sub}`, label: key === 'resolution' ? (LABELS[sub] ?? sub) : `${LABELS[key] ?? key} · ${LABELS[sub] ?? sub}`, value: item }))
    : ['number', 'string', 'boolean'].includes(typeof value) ? [{ key, label: LABELS[key] ?? key, value }] : [])
// `attr` names the data attribute that carries the field's ID: `pf` in a node's detail, `cf` in the settings dialog's cut form.
function fieldHtml(field, attr = 'pf') {
  const attrs = `data-${attr}="${esc(field.id)}" data-ptype="${field.options ? 'option' : field.kind}" aria-label="${esc(field.label)}"`
  const input = field.options
    ? `<select ${attrs}>${field.options.map(option => { const value = option?.value ?? option, label = option?.label ?? option; return `<option value="${esc(JSON.stringify(value))}" ${JSON.stringify(value) === JSON.stringify(field.value) ? 'selected' : ''}>${esc(label)}</option>` }).join('')}</select>`
    : field.kind === 'boolean' ? `<input type="checkbox" ${attrs} ${field.value ? 'checked' : ''}>`
      : field.type === 'textarea' ? `<textarea rows="3" ${attrs}>${esc(field.value ?? '')}</textarea>`
      : field.kind === 'number' ? `<input type="number" step="any" ${field.min !== undefined ? `min="${esc(field.min)}"` : ''} ${field.max !== undefined ? `max="${esc(field.max)}"` : ''} ${attrs} value="${esc(field.value ?? '')}">`
        : `<input ${attrs} value="${esc(field.value ?? '')}">`
  return `<label class="${field.kind === 'boolean' ? 'vc-check' : ''}">${esc(field.label)}${input}</label>`
}
const kindOf = type => ['number', 'integer', 'int', 'float'].includes(type) ? 'number' : ['boolean', 'bool', 'checkbox'].includes(type) ? 'boolean' : 'text'
/** A label on the left and its control on the right (`control` carries the id the label names, `extra` an icon button after it). */
export const fieldRow = (label, id, control, extra = '') => `<div class="vc-field-row"><label for="${id}">${esc(label)}</label>${extra ? `<span class="vc-control">${control}${extra}</span>` : control}</div>`
const warningsHtml = list => list.map(text => `<p class="warning">${esc(text)}</p>`).join('')
/** The settings rows of a cut's detail: the cut setting (its facts as the select's tooltip) and the upscale setting it uses, both chosen among the
 *  registered ones, the way to the library, and what is wrong with them (a deleted setting, a missing or unusable workflow). */
export function cutSettingsHtml(cut) {
  const profile = profileOf(cut), own = cut.data.upscaleProfileId, upscales = settingsOf('upscale'), fallback = defaultOf('upscale'), main = defaultOf('cut')
  // What a deleted setting leaves behind: a cut keeps the ID, gets the default cut setting when it generates and follows the default upscale setting.
  const lost = cut.data.profileId && !profile, replacement = cutDefault()
  const warnings = [
    ...(lost ? [`이 컷이 쓰던 영상 설정은 지워졌어. ${replacement ? `생성하면 대표 영상 설정(${replacement.label})을 받아.` : '쓸 설정을 골라줘.'}`] : []),
    ...(profile ? profileFacts(profile).filter(fact => fact.warn).map(fact => fact.text) : []),
  ]
  return fieldRow('영상 설정', 'insp-profile', `<select id="insp-profile" data-pf="profile" title="${esc(profile ? factsLine(profile) : '')}">${profile ? '' : '<option value="">골라줘</option>'}${settingsOf('cut').map(item => opt(item.id, item.id === main?.id ? `${item.label} · 대표` : item.label, profile?.id)).join('')}</select>`,
    iconButton('settings', '설정 관리', 'data-action="manage-settings" data-role="cut"'))
    + fieldRow('업스케일', 'insp-upscale', `<select id="insp-upscale" data-pf="upscale">${opt('', `대표 설정 따름 · ${fallback?.label ?? '없음'}`, own ?? '')}${upscales.map(item => opt(item.id, item.label, own)).join('')}${own && !upscales.some(item => item.id === own) ? opt(own, `지워진 설정 · 대표 설정을 따름 (${fallback?.label ?? '없음'})`, own) : ''}</select>`)
    + warningsHtml(warnings)
}
/** The adjustable settings of a cut setting as form fields (`draft` carries its overrides, inputs and the JSON text being edited); raw overrides only under "고급". */
export function cutFieldsHtml(draft, wf) {
  const profile = draft
  // The custom ratio and size inputs belong to the "custom" choices, as in the app's resolution panel.
  const resolution = { ...wf.defaults?.resolution, ...profile.overrides?.resolution }
  const customSize = resolution.resolution === 'custom', fixed = resolution.custom_mode === 'fixed'
  const hidden = [
    ...(resolution.aspect === 'custom' ? [] : ['custom_aspect_w', 'custom_aspect_h']),
    ...(customSize ? [] : ['custom_mode']), ...(customSize && !fixed ? [] : ['custom_mp']), ...(customSize && fixed ? [] : ['custom_width', 'custom_height']),
  ].map(key => `resolution/${key}`)
  const fields = [
    ...defaultFields(wf.defaults).filter(field => !hidden.includes(field.key)).map(field => {
      const [key, sub] = field.key.split('/')
      const value = (sub ? profile.overrides?.[key]?.[sub] : profile.overrides?.[key]) ?? field.value
      return { id: `o:${field.key}`, label: field.label, kind: kindOf(typeof field.value), value, options: withCurrent(OPTIONS[field.key], value) }
    }),
    ...(wf.extraFields ?? []).map(field => ({ id: `i:${field.id}`, type: field.type, label: field.label ?? field.id, kind: kindOf(field.type), options: field.options, min: field.min, max: field.max, value: profile.inputs?.[field.id] ?? field.default })),
  ]
  return `${fields.map(field => fieldHtml(field, 'cf')).join('') || '<p class="conai-empty">이 워크플로에는 조절할 설정이 없어.</p>'}<details data-keep="advanced"><summary>고급</summary><label>overrides (JSON)<textarea data-cf="json" rows="5">${esc(draft.json ?? JSON.stringify(profile.overrides ?? {}, null, 2))}</textarea></label></details>`
}
/** A change in the cut form of the settings dialog goes into the draft. Invalid JSON text stays as typed (`draft.json`) and is refused. */
export function applyCutField(draft, wf, target) {
  const key = target.dataset.cf
  if (key === 'json') {
    try { draft.overrides = JSON.parse(target.value || '{}'); draft.json = undefined } catch { draft.json = target.value; throw new Error('overrides가 JSON 형식이 아니야.') }
    return
  }
  const value = valueOf(target), [group, id] = [key.slice(0, 1), key.slice(2)]
  const bucket = group === 'o' ? draft.overrides : draft.inputs, [top, sub] = id.split('/')
  // A changed group is sent whole (the workflow's defaults with the user's change), so it never half-applies.
  if (sub && group === 'o') bucket[top] = { ...wf.defaults?.[top], ...bucket[top], [sub]: value }
  else if (value === undefined) delete bucket[id]
  else bucket[id] = value
}
/** change handler for the selects in a node's detail: the setting a cut or generation node uses, a cut's upscale setting, a generation node's own values. */
export async function onProfileChange(target) {
  const node = nodeById(target.closest('[data-id]').dataset.id), key = target.dataset.pf
  if (node.kind === 'gen') return onGenChange(node, key, target)
  return edit([{ op: 'set', id: node.id, fields: key === 'upscale' ? { upscaleProfileId: target.value || null } : { profileId: target.value || null } }])
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
/** The settings row of a generation node's detail: which generation setting it uses (what it is as the select's tooltip) and a menu to register,
 *  change or import one (`genSettingItems`). */
export function genSettingsHtml(node) {
  const profile = profileOf(node), used = profile ? s.project.nodes.filter(item => item.kind === 'gen' && item.data.profileId === profile.id).length : 0
  const about = profile ? `${adapterNames[adapterOf(profile)]} · 결과 종류 ${outputNames[outputOf(profile)]}${used > 1 ? ` · 이 프로젝트에서 ${used}개 노드가 사용` : ''}` : ''
  return fieldRow('생성 설정', 'insp-profile', `<select id="insp-profile" data-pf="profile" title="${esc(about)}">${profile ? '' : '<option value="">골라줘</option>'}${genProfiles().map(item => opt(item.id, `${item.label} · ${outputNames[outputOf(item)]}`, profile?.id)).join('')}</select>`,
    `<button type="button" class="conai-icon-button" data-imenu="gen-settings" aria-haspopup="menu" aria-expanded="false" aria-label="설정 관리" title="설정 관리">${icon('settings')}</button>`)
    + (node.data.profileId && !profile ? warningsHtml(['이 노드가 쓰던 생성 설정은 지워졌어. 다른 설정을 골라줘.']) : '')
}
/** The generation setting menu of a node: `run(action)` opens the settings dialog on that action (`edit`, `new`, `import`). */
export function genSettingItems(node, run) {
  const profile = profileOf(node)
  return [
    profile && { label: '생성 설정 고치기', meta: '모든 프로젝트가 같이 쓰는 설정이라, 고치면 다른 프로젝트의 노드에도 반영돼.', run: () => run('edit') },
    { label: '새 생성 설정', run: () => run('new') },
    presetsAvailable() && { label: '생성 프리셋에서 가져오기', run: () => run('import') },
  ]
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

// ---- the form of one setting in the settings dialog: a draft is edited and only an explicit save sends it ----
/** The draft of a new setting of a use (`cut`, `upscale`, `gen`), or of `profile` (a stored one). `touched` turns true when anything but the name and guide texts changes. */
export function newDraft(role, profile = null) {
  const exposed = profile?.exposedFieldIds ?? [], fixed = profile?.fixedInputs ?? {}
  return { role, id: profile?.id, original: profile, touched: false, label: profile?.label ?? '', workflowId: profile?.workflowId ?? null, output: profile?.output ?? 'image',
    promptFieldId: profile?.promptFieldId ?? '', seedFieldId: profile?.seedFieldId ?? '', imageFieldIds: [...(profile?.imageFieldIds ?? [])], videoFieldId: profile?.videoFieldId ?? '',
    mode: Object.fromEntries([...(role === 'upscale' ? [] : exposed).map(id => [id, 'node']), ...Object.keys(fixed).map(id => [id, 'fixed'])]), fixed: { ...fixed },
    overrides: structuredClone(profile?.overrides ?? {}), inputs: structuredClone(profile?.inputs ?? {}), json: undefined,
    key: serverKey(profile), instruction: profile?.instruction ?? '', guide: profile?.guide ?? '',
    // `skill` is the guide skill link to save (undefined keeps the stored one, null cuts it); `skillId` is only the skill the picker shows.
    skill: undefined, skillId: profile?.guideSkill?.skillId ?? null, autoLabel: null }
}
/** A newly chosen workflow brings its detected roles (a generation node's also an output guess); values meant for the old workflow go. */
function useWorkflow(draft, workflow) {
  Object.assign(draft, { workflowId: workflow.workflowId, mode: {}, fixed: {}, overrides: {}, inputs: {}, json: undefined })
  if (draft.role === 'gen') { const { generator } = workflow; Object.assign(draft, { output: generator.output, promptFieldId: generator.promptFieldId ?? '', seedFieldId: generator.seedFieldId ?? '', imageFieldIds: [...generator.imageFieldIds] }) }
  if (draft.role === 'upscale') Object.assign(draft, { videoFieldId: workflow.upscale.videoFields[0]?.id ?? '', seedFieldId: workflow.upscale.seedFieldId ?? '' })
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
/** The "다른 필드" rows: each simple field is the workflow's default, fixed in the setting or (a generation node's) filled per node. */
const otherFieldsHtml = (draft, workflow, modes) => otherFields(draft, workflow).map(field => `<div class="vc-gfield"><span class="vc-gfield-label" title="${esc(field.id)}">${esc(field.label)}</span><select data-g="mode" data-gid="${esc(field.id)}" aria-label="${esc(field.label)} 방식">${modes.map(([value, label]) => opt(value, label, draft.mode[field.id] ?? 'default')).join('')}</select>${draft.mode[field.id] === 'fixed' ? `<div class="vc-gfixed">${fixedControl(field, draft)}</div>` : ''}</div>`).join('') || '<p class="muted">더 정할 필드가 없어.</p>'
const seedSelect = (draft, detected) => `<label>시드 필드<select data-g="seedFieldId"><option value="">없음 (시드를 보내지 않아)</option>${[...new Set([detected, draft.seedFieldId].filter(Boolean))].map(id => opt(id, id, draft.seedFieldId)).join('')}</select></label>`
function genBlock(draft, workflow) {
  const prompts = textFields(workflow), images = workflow.generator.imageFields
  return `<label>결과 종류<select data-g="output">${Object.entries(outputNames).map(([value, label]) => opt(value, label, draft.output)).join('')}</select></label><h2 class="conai-group-head">필드 역할</h2>
    <label>프롬프트 필드<select data-g="promptFieldId"><option value="">없음 (프롬프트를 쓰지 않아)</option>${prompts.map(field => opt(field.id, field.label, draft.promptFieldId)).join('')}${draft.promptFieldId && !prompts.some(field => field.id === draft.promptFieldId) ? opt(draft.promptFieldId, draft.promptFieldId, draft.promptFieldId) : ''}</select></label>
    ${seedSelect(draft, workflow.generator.seedFieldId)}
    ${images.length ? `<p>입력 이미지 필드 <span class="muted">(체크한 필드에 위에서부터 입력 이미지 1번, 2번… 순서로 들어가)</span></p>${images.map(field => `<label class="vc-check"><input type="checkbox" data-g="img" value="${esc(field.id)}" ${draft.imageFieldIds.includes(field.id) ? 'checked' : ''}>${esc(field.label)}</label>`).join('')}` : '<p class="muted">이 워크플로에는 이미지 입력 필드가 없어.</p>'}
    <h2 class="conai-group-head">다른 필드</h2>${otherFieldsHtml(draft, workflow, MODES)}`
}
function upscaleBlock(draft, workflow) {
  const fields = workflow.upscale.videoFields
  return `<label>영상 입력 필드<select data-g="videoFieldId">${fields.map(field => opt(field.id, field.label, draft.videoFieldId)).join('')}${draft.videoFieldId && !fields.some(field => field.id === draft.videoFieldId) ? opt(draft.videoFieldId, draft.videoFieldId, draft.videoFieldId) : ''}</select></label>
    ${seedSelect(draft, workflow.upscale.seedFieldId)}<h2 class="conai-group-head">다른 필드</h2>${otherFieldsHtml(draft, workflow, MODES.filter(([value]) => value !== 'node'))}`
}
/** The workflow picker lists the usable workflows only; the stored one stays selectable when it no longer is (or is gone), and the hidden ones are counted with their reasons. */
function workflowPicker(draft, workflow) {
  const { usable, hidden } = workflowsFor(draft.role), kept = draft.workflowId && !usable.some(item => item.workflowId === draft.workflowId)
  const others = hidden.filter(item => item.workflow.workflowId !== draft.workflowId)
  return `<label>워크플로<select data-g="workflowId">${draft.workflowId ? '' : '<option value="">골라줘</option>'}${usable.map(item => opt(item.workflowId, item.name, draft.workflowId)).join('')}${kept ? opt(draft.workflowId, workflow ? `${workflow.name} — 지금은 쓸 수 없어` : `워크플로 #${draft.workflowId} — 찾을 수 없어`, draft.workflowId) : ''}</select></label>
    ${others.length ? `<details class="muted" data-keep="hidden-workflows"><summary>쓸 수 없는 워크플로 ${others.length}개는 숨겼어</summary><div class="conai-list">${others.map(item => `<div class="conai-list-row sm"><div class="conai-row-main"><span class="conai-row-title">${esc(item.workflow.name)}</span><span class="conai-row-meta">${esc(item.reason ?? '준비가 덜 됐어')}</span></div></div>`).join('')}</div></details>` : ''}`
}
/** The whole form of a draft. A setting whose workflow is gone, or no longer usable, keeps it as the selected value and can still be renamed and given guide text. */
export function formHtml(draft) {
  const nai = draft.original && adapterOf(draft.original) === 'nai', workflow = workflowById(draft.workflowId)
  // An upscale takes no prompt, so it has no guide on how to write one: its only text is the note on what the setting is for.
  const prompted = draft.role !== 'upscale', texts = prompted ? '이름·안내·가이드' : '이름·안내'
  const guideText = `<label>안내 (이 설정이 무엇을 위한 건지)<textarea data-g="instruction" rows="2">${esc(draft.instruction)}</textarea></label>${prompted ? `<label>가이드 (프롬프트 쓰는 법)<textarea data-g="guide" rows="5">${esc(draft.guide)}</textarea></label>` : ''}${draft.role === 'gen' ? guideSkillHtml(draft) : ''}`
  const name = `<label>이름<input data-g="label" value="${esc(draft.label)}"></label>`
  if (nai) {
    const config = draft.original.nai
    return `${name}<p class="muted">NovelAI 설정은 생성 프리셋에서 복사한 값이라 여기서 고칠 수 없어. 바꾸려면 생성 프리셋을 다시 가져와줘.</p><p class="muted">${esc(config.model)} · 크기 ${esc(config.sizes.map(size => size.label).join(', '))}</p>${guideText}`
  }
  const status = !draft.workflowId ? '' : !workflow ? `<p class="warning">이 워크플로를 지금 목록에서 찾을 수 없어. 필드 설정은 그대로 두고 ${texts}만 고칠 수 있어.</p>`
    : useOf(draft.role, workflow).usable ? '' : `<p class="warning">이 워크플로는 지금 쓸 수 없어 (${esc(useOf(draft.role, workflow).reason ?? '준비가 덜 됐어')}). 다른 워크플로를 고르거나 ${texts}만 고칠 수 있어.</p>`
  const block = !workflow ? '' : draft.role === 'cut' ? cutFieldsHtml(draft, workflow) : draft.role === 'upscale' ? upscaleBlock(draft, workflow) : genBlock(draft, workflow)
  return `${name}${workflowPicker(draft, workflow)}${status}<label>서버<select data-g="key">${serverOptions(draft.key)}</select></label>${block}${guideText}`
}
/** True when the draft can be saved. */
export const formReady = draft => Boolean(draft.workflowId || draft.original && adapterOf(draft.original) === 'nai') && (draft.role !== 'upscale' || Boolean(draft.videoFieldId))
/** The profile a save sends. With nothing but the name and guide texts changed the stored profile goes back as it is, so the server skips the workflow check
 *  and a setting whose workflow is gone or unusable can still be renamed. Invalid JSON text in the cut form is refused. */
export function formPayload(draft) {
  const text = { label: draft.label.trim(), instruction: draft.instruction, guide: draft.guide, ...(draft.skill === undefined ? {} : { guideSkill: draft.skill }) }
  if (draft.original && !draft.touched) return { ...draft.original, ...text }
  if (draft.json !== undefined) throw new Error('overrides가 JSON 형식이 아니야.')
  const workflow = workflowById(draft.workflowId), common = { ...(draft.id ? { id: draft.id } : {}), ...text, workflowId: draft.workflowId, ...serverFields(draft.key) }
  if (draft.role === 'cut') return { ...common, overrides: draft.overrides, inputs: draft.inputs }
  const shown = otherFields(draft, workflow), listed = new Set((workflow?.extraFields ?? []).map(field => field.id))
  // Values of fields this form cannot show (kept as they were) stay in the profile.
  const hidden = key => !listed.has(key)
  const fixedInputs = { ...Object.fromEntries(Object.entries(draft.original?.fixedInputs ?? {}).filter(([key]) => hidden(key))), ...Object.fromEntries(shown.filter(field => draft.mode[field.id] === 'fixed' && draft.fixed[field.id] !== undefined && draft.fixed[field.id] !== '').map(field => [field.id, draft.fixed[field.id]])) }
  // An upscale has no prompt, no input images and no per-node values: its one input is the video.
  if (draft.role === 'upscale') return { ...common, videoFieldId: draft.videoFieldId, seedFieldId: draft.seedFieldId || null, promptFieldId: null, imageFieldIds: [], exposedFieldIds: [], fixedInputs }
  const exposedFieldIds = [...(draft.original?.exposedFieldIds ?? []).filter(hidden), ...shown.filter(field => draft.mode[field.id] === 'node').map(field => field.id)]
  return { ...common, output: draft.output, promptFieldId: draft.promptFieldId || null, seedFieldId: draft.seedFieldId || null, imageFieldIds: draft.imageFieldIds, exposedFieldIds, fixedInputs }
}
const STRUCTURAL = ['workflowId', 'promptFieldId', 'seedFieldId', 'mode', 'skillId', 'skillPath']
const TEXT_KEYS = ['label', 'instruction', 'guide', 'skillId', 'skillPath']
/** An input or change event in the form changes the draft; returns true when the form has to be drawn again. A rejected value throws. */
export function formChange(draft, event, root) {
  const target = event.target, key = target.dataset.g, id = target.dataset.gid, workflow = workflowById(draft.workflowId)
  if (target.dataset.cf) {
    if (event.type !== 'change') return false
    draft.touched = true
    applyCutField(draft, workflow, target)
    return target.dataset.cf === 'json' || target.dataset.cf.startsWith('o:resolution/')
  }
  if (!key) return false
  if (!TEXT_KEYS.includes(key)) draft.touched = true
  if (key === 'img') draft.imageFieldIds = [...root.querySelectorAll('[data-g=img]')].filter(box => box.checked).map(box => box.value)
  else if (key === 'workflowId') { const next = workflowById(Number(target.value)); if (next && next.workflowId !== draft.workflowId) useWorkflow(draft, next) }
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
  return event.type === 'change' && STRUCTURAL.includes(key)
}
/** Asks which preset to copy, then makes the generation setting from it. Resolves the new setting's ID, or null when cancelled. */
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
      const result = await accountRequest('import_preset', { preset: { id: chosen.id, ...(label && label !== chosen.name ? { label } : {}), ...(chosen.kind === 'nai' ? {} : { output: $('preset-output').value }) } })
      saved = result.profileId
      $('modal').close()
    })
    $('modal').addEventListener('close', () => resolve(saved), { once: true })
  })
}

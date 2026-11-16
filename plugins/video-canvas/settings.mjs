import { roleOf } from './domain.mjs'
import { $, esc, patch } from './util.mjs'
import { s } from './state.mjs'
import { toast } from './toast.mjs'
import { accountRequest, reload, ui } from './session.mjs'
import { modal } from './dialogs.mjs'
import { ensureOptions, profileFacts, factsLine, presetsAvailable, importPresetDialog, newDraft, formHtml, formReady, formPayload, formChange } from './workflow.mjs'

// The settings library dialog: the account's cut, upscale and generation settings, registered once and picked wherever they are used.
// One dialog element serves every view (the list, a setting's form, the delete question); `st` is what it shows while it is open.
const ROLES = [['cut', '영상 컷'], ['upscale', '업스케일'], ['gen', '생성 노드']]
const ROLE_NAMES = Object.fromEntries(ROLES)
const DEFAULT_KEYS = { cut: 'cutProfileId', upscale: 'upscaleProfileId' }
const EMPTY = { cut: '등록한 컷 설정이 없어.', upscale: '등록한 업스케일 설정이 없어.', gen: '등록한 생성 설정이 없어.' }
// What deleting a setting does to the nodes that use it, which differs by use (the nodes keep the ID, the server decides what a run or an upscale takes).
const AFTER_DELETE = {
  cut: count => `이 설정을 쓰는 컷 ${count}개는 "설정 고르기" 상태가 돼. 생성하면 대표 영상 설정을 받고, 대표가 없으면 직접 골라야 해.`,
  upscale: count => `이 설정을 쓰는 컷 ${count}개는 대표 업스케일 설정을 따라가. 대표가 없으면 업스케일할 때 설정을 먼저 정해야 해.`,
  gen: count => `이 설정을 쓰는 생성 노드 ${count}개는 "설정 고르기" 상태가 돼. 다른 설정을 골라야 생성할 수 있어.`,
}
const CHANGED ='이 설정이 다른 곳에서 바뀌었어. 목록을 다시 불러왔으니 바뀐 내용을 확인하고 다시 고쳐줘.'
let st = null, opening = false

// A failed workflow list is toasted where it is read (ensureOptions); every other failure is told here, so each shows once.
const report = error => { if (!error.toasted) toast(error.message, { error: true }) }
/** The dialog's copy of the library, and the open project's (its pickers and cards), read again after a change. */
async function refresh(dialog) {
  dialog.lib = await accountRequest('library')
  if (s.project) await reload()
}
function back() {
  const close = $('dialog-close')
  close.removeAttribute('data-close')
  close.onclick = () => { st.view = null; show() }
}
function rowHtml(profile) {
  const key = DEFAULT_KEYS[roleOf(profile)], isDefault = key && st.lib.settings[key] === profile.id, uses = st.lib.usage[profile.id] ?? 0
  const plain = factsLine(profile)
  return `<div class="conai-list-row vc-set-row" data-profile="${esc(profile.id)}"><div class="conai-row-main"><span class="conai-row-title">${esc(profile.label)}${isDefault ? ' <span class="badge ok">대표</span>' : ''}</span>
    <span class="conai-row-meta" title="${esc(plain)}">${esc(plain)}</span>${profileFacts(profile).filter(fact => fact.warn).map(fact => `<span class="conai-row-meta warning">${esc(fact.text)}</span>`).join('')}
    <span class="conai-row-meta">${uses}개 노드에서 사용</span>
    <div class="toolbar"><button class="sm" data-do="edit" data-id="${esc(profile.id)}">고치기</button><button class="sm" data-do="copy" data-id="${esc(profile.id)}">복제</button><button class="sm" data-do="remove" data-id="${esc(profile.id)}">삭제</button>${key && !isDefault ? `<button class="sm" data-do="default" data-id="${esc(profile.id)}">대표로 정하기</button>` : ''}</div></div></div>`
}
function listHtml() {
  const rows = st.lib.profiles.filter(profile => roleOf(profile) === st.tab), key = DEFAULT_KEYS[st.tab]
  // Only a newly created first setting becomes the default by itself, so an account can have settings and none of them the default.
  const unset = key && rows.length && !rows.some(profile => profile.id === st.lib.settings[key])
  return `${st.message ? `<p class="warning" role="status">${esc(st.message)}</p>` : ''}<div class="toolbar"><button data-do="new">＋ 등록</button>${st.tab === 'gen' && presetsAvailable() ? '<button data-do="import">프리셋에서 가져오기</button>' : ''}</div>
    ${st.lib.duplicates > 0 ? `<div class="toolbar"><span class="muted">이름과 내용이 똑같은 설정이 ${st.lib.duplicates}개 겹쳐 있어.</span><button class="sm" data-do="merge">같은 설정 합치기</button></div>` : ''}
    ${unset ? `<p class="warning">대표 ${ROLE_NAMES[st.tab]} 설정이 없어. 하나를 대표로 정해줘.</p>` : ''}
    ${rows.length ? `<div class="conai-list">${rows.map(rowHtml).join('')}</div>` : `<p class="conai-empty">${EMPTY[st.tab]}</p>`}`
}
function showList() {
  modal('Video Canvas 설정', `<div class="conai-tabs" role="tablist" aria-label="설정 종류">${ROLES.map(([role, name]) => `<button role="tab" data-do="tab" data-role="${role}" aria-selected="${role === st.tab}">${name}</button>`).join('')}</div><div id="set-body" class="vc-set-body" role="tabpanel"></div>`, { close: '닫기' })
  patch($('set-body'), listHtml())
  // The dialog opens with the first tab focused; the focus belongs on the tab that is showing (also after a tab switch, which draws the tabs again).
  $('modal').querySelector('[data-do=tab][aria-selected=true]').focus()
}
function showForm() {
  const draft = st.view.draft
  modal(`${ROLE_NAMES[draft.role]} 설정 ${draft.original ? '고치기' : '등록'}`, '<div id="set-body" class="vc-set-body"></div>', { primary: '저장' })
  back()
  patch($('set-body'), formHtml(draft))
  $('dialog-primary').disabled = !formReady(draft)
  $('dialog-primary').onclick = save
}
function showRemove() {
  const profile = st.view.remove, current = st, uses = st.lib.usage[profile.id] ?? 0, isDefault = st.lib.settings[DEFAULT_KEYS[roleOf(profile)]] === profile.id
  modal('설정을 지울까?', `<p><b>${esc(profile.label)}</b>을(를) 지워. ${uses ? AFTER_DELETE[roleOf(profile)](uses) : '이 설정을 쓰는 노드는 없어.'}${isDefault ? ' 대표 설정이라 지우면 대표가 없어져.' : ''}</p>`, { primary: '지우기', danger: true })
  back()
  $('dialog-primary').onclick = () => void ui(async () => {
    await accountRequest('delete_profile', { id: profile.id })
    await refresh(current)
    if (st === current) { current.view = null; show() }
  }, $('dialog-primary'))
}
function showMerge() {
  const current = st, count = st.lib.duplicates
  modal('같은 설정을 합칠까?', `<p>이름과 내용이 똑같은 설정 ${count}개를 지워서 하나로 합쳐. 지워지는 설정을 쓰던 컷과 생성 노드는 남는 설정을 쓰게 돼.</p>
    <p>고쳐지는 프로젝트는 버전이 올라가서, 승인 대기 중인 제안은 다시 제안해야 하고 어시스턴트의 마지막 배치 되돌리기는 지워져. 이미 만든 take는 그대로야.</p>`, { primary: '합치기' })
  back()
  $('dialog-primary').onclick = () => void ui(async () => {
    await accountRequest('merge_profiles')
    await refresh(current)
    toast('같은 설정을 합쳤어.')
    if (st === current) { current.view = null; show() }
  }, $('dialog-primary'))
}
function show() {
  if (st.view?.merge) showMerge()
  else if (st.view?.remove) showRemove()
  else if (st.view?.draft) showForm()
  else showList()
}
/** Saves the form. A setting that was edited carries the revision its list read: a save that lost a race (409) overwrites nothing and says so. */
function save() {
  const current = st, draft = current.view.draft
  return ui(async () => {
    try {
      const result = await accountRequest('save_profile', { profile: formPayload(draft), ...(draft.id ? { expected_profile_revision: current.lib.revisions[draft.id] } : {}) })
      // Only a generation setting can land on the generation node this dialog was opened from.
      if (!draft.id && draft.role === 'gen') current.created = result.profileId
    } catch (error) {
      if (error.status !== 409) throw error
      current.message = CHANGED
    }
    await refresh(current)
    if (st === current) { current.view = null; show() }
  }, $('dialog-primary'))
}
async function importPreset() {
  const current = st
  // The preset dialog takes the dialog over and closes it when done; this dialog comes back in its place.
  current.busy = true
  let id = null
  try { id = await importPresetDialog() } catch (error) { report(error) } finally { current.busy = false }
  if (id) current.created = id
  await ui(() => refresh(current))
  show()
}
function act(target) {
  const { do: action, role, id } = target.dataset, current = st, profile = st.lib.profiles.find(item => item.id === id)
  st.message = null
  if (action === 'tab') { st.tab = role; return showList() }
  if (action === 'merge') { st.view = { merge: true }; return show() }
  if (action === 'new') { st.view = { draft: newDraft(st.tab) }; return show() }
  if (action === 'import') return void importPreset()
  if (action === 'edit') { st.view = { draft: newDraft(roleOf(profile), profile) }; return show() }
  if (action === 'remove') { st.view = { remove: profile }; return show() }
  const run = action === 'copy' ? () => accountRequest('duplicate_profile', { id }) : () => accountRequest('save_settings', { settings: { [DEFAULT_KEYS[roleOf(profile)]]: id } })
  return void ui(async () => { await run(); await refresh(current); if (st === current) show() }, target)
}
function edited(event) {
  const draft = st.view.draft
  let again
  try { again = formChange(draft, event, $('set-body')) } catch (error) { toast(error.message, { error: true }); again = true }
  if (again) patch($('set-body'), formHtml(draft))
  $('dialog-primary').disabled = !formReady(draft)
}
/**
 * Opens the settings dialog on a tab (it works with no project open). `start` goes straight into a form: `edit` (with `id`) or `new` for a setting
 * of the tab's use, or `import` for the generation presets; `message` is a notice shown on the list. The promise settles when the dialog closes
 * with the ID of the generation setting created or imported meanwhile (or null); it never rejects, a failed load is a toast.
 * One dialog at a time: opening it again while it is loading or open (a double click) does nothing and answers null at once, so only the
 * first opener ever gets the setting.
 */
export async function openSettings(tab = 'cut', { start, id, message } = {}) {
  if (st || opening) return null
  opening = true
  let lib
  try { [lib] = await Promise.all([accountRequest('library'), ensureOptions(true)]) } catch (error) { report(error); return null } finally { opening = false }
  return new Promise(resolve => {
    const current = st = { tab, lib, view: null, message: message ?? null, created: null, busy: false }
    const done = () => {
      // A preset import takes the dialog over and closes it itself; that is not this dialog ending.
      if (current.busy) return
      $('modal').removeEventListener('close', done)
      st = null
      resolve(current.created)
    }
    $('modal').addEventListener('close', done)
    if (start === 'edit') current.view = { draft: newDraft(tab, lib.profiles.find(profile => profile.id === id)) }
    else if (start === 'new') current.view = { draft: newDraft(tab) }
    show()
    if (start === 'import' && presetsAvailable()) void importPreset()
  })
}
export function bindSettings() {
  $('modal').addEventListener('click', event => {
    const target = st && event.target.closest('[data-do]')
    if (target && !target.disabled) act(target)
  })
  for (const type of ['input', 'change']) $('modal').addEventListener(type, event => { if (st?.view?.draft) edited(event) })
}

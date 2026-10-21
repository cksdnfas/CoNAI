import { connectPlugin } from './conai-plugin.js'

const $ = (id) => document.getElementById(id)
const status = $('status'), list = $('rules'), profileSelect = $('profile'), text = $('text'), saveButton = $('save'), cancelButton = $('cancel')
let api, rules = [], profiles = [], editing = null

const profileName = (id) => id === null ? '모든 캐릭터' : profiles.find((profile) => profile.id === id)?.name ?? `캐릭터 #${id}`

function publish() {
  api.publish(() => ({ revision: String(rules.length) + ':' + (editing ?? ''), dirty: text.value.trim() !== '' && editing === null, data: { rules: rules.map(({ id, profileId, text, enabled }) => ({ id, target: profileName(profileId), text: text.slice(0, 500), enabled: !!enabled })) } }))
}

function render() {
  list.replaceChildren(...rules.map((rule) => {
    const item = document.createElement('li')
    item.className = rule.enabled ? 'conai-list-row' : 'conai-list-row off'
    const body = document.createElement('div'); body.className = 'body'
    const line = document.createElement('span'); line.className = 'text'; line.textContent = rule.text
    const target = document.createElement('span'); target.className = 'target'; target.textContent = profileName(rule.profileId)
    body.append(line, target)
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'ghost'
    toggle.textContent = rule.enabled ? '끄기' : '켜기'
    toggle.onclick = () => send({ op: 'save', id: rule.id, profileId: rule.profileId, text: rule.text, enabled: !rule.enabled })
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'ghost'; edit.textContent = '고치기'
    edit.onclick = () => { editing = rule.id; text.value = rule.text; profileSelect.value = rule.profileId === null ? '' : String(rule.profileId); saveButton.textContent = '저장'; cancelButton.hidden = false; text.focus(); publish() }
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'ghost destructive'; remove.textContent = '지우기'
    remove.onclick = () => send({ op: 'delete', id: rule.id })
    item.append(body, toggle, edit, remove)
    return item
  }))
  status.textContent = rules.length ? `규칙 ${rules.length}개 · 켜진 규칙이 채팅 지시문 끝에 붙어.` : '아직 규칙이 없어.'
  publish()
}

function reset() {
  editing = null; text.value = ''; saveButton.textContent = '추가'; cancelButton.hidden = true; publish()
}

async function send(body) {
  try {
    const result = await api.server(body)
    rules = result.rules
    render()
    return true
  } catch (error) {
    status.textContent = error.message
    return false
  }
}

// Sandboxed pages can't submit forms, so the button saves directly.
saveButton.addEventListener('click', async () => {
  const profileId = profileSelect.value ? Number(profileSelect.value) : null
  const current = rules.find((rule) => rule.id === editing)
  if (await send({ op: 'save', id: editing ?? undefined, profileId, text: text.value, enabled: current ? !!current.enabled : true })) reset()
})
cancelButton.onclick = reset
text.addEventListener('input', publish)

api = await connectPlugin({})
try {
  profiles = (await api.server({ op: 'profiles' })).profiles
  for (const profile of profiles) profileSelect.append(new Option(profile.name, String(profile.id)))
} catch {
  // Listing profiles is an administrator tool; others still edit rules for every character.
}
await send({ op: 'list' })

import { createPortrait } from '../ui/portrait.js'
import { parseResidentInstructions } from '../../shared/resident-instructions.mjs'
import { DAY_LENGTHS } from '../../shared/clock.mjs'
import { ACTION_RANGE, WALK_RANGE, DEFAULT_SETTINGS, REPLY_LENGTHS, replyTimeoutMinutesOf } from '../../shared/village-settings.mjs'
import { createSaves } from './saves.js'
import { createAgentSettings } from './agents.js'

const $ = id => document.getElementById(id)
// Settings pages: the village draft (주민·지시문·이야기·마을), the adventure draft (모험·전투 AI·역할) and the AI behaviour
// draft (AI 행동·상태 정의) share one 적용. 세이브 슬롯 acts at once and has no draft.
const MENU_TABS = ['residents', 'instructions', 'story', 'village', 'adventure', 'combat', 'roles', 'agents', 'statuses', 'saves'], RPG_TABS = ['adventure', 'combat', 'roles']
const AGENT_KEYS = ['statusDefs', 'actionCatalog', 'deciders', 'conversationMaxTurns', 'maxConversations']

/** The settings window. The village draft (`app.draft`) waits there until 적용 sends it; 모험 pages come from the guild view. */
export function createSettingsMenu({ app, faces, rpgView, loadFace, closeQuick, renderHud, publish, toast, request, handle, openSetup }) {
  let tab = 'residents', draftRevision = null, instructionProfileId = null
  const saves = createSaves({ app, faces, request, toast, handle, onCreated: mode => { if (mode === 'empty') openSetup() } })
  const agents = createAgentSettings({ app, request, toast, publish, changed: () => renderFooter() })
  function resetDraft() {
    if (!app.world || app.dirty) return
    draftRevision = app.world.revision
    app.draft = {
      profileIds: app.world.residents.map(r => r.profileId),
      residentInstructions: app.world.residents.map(r => ({ profileId: r.profileId, instructions: r.instructions ?? '' })),
      scene: app.world.settings.scene, actionMin: app.world.settings.actionMin, actionMax: app.world.settings.actionMax,
      walkSpeed: app.world.settings.walkSpeed ?? DEFAULT_SETTINGS.walkSpeed, wander: app.world.settings.wander ?? DEFAULT_SETTINGS.wander,
      dayMinutes: app.world.settings.dayMinutes ?? DEFAULT_SETTINGS.dayMinutes, sleep: app.world.settings.sleep ?? DEFAULT_SETTINGS.sleep,
      replyLength: app.world.settings.replyLength ?? DEFAULT_SETTINGS.replyLength,
      replyTimeoutMinutes: replyTimeoutMinutesOf(app.world.settings),
    }
  }
  function markDirty() { app.dirty = true; renderMenu(); publish() }
  function openMenu(next = tab) {
    rpgView.close?.(); closeQuick()
    if (!MENU_TABS.includes(next) || (RPG_TABS.includes(next) && !app.world?.rpg)) next = 'residents'
    if (RPG_TABS.includes(next)) rpgView.showSettings?.()
    resetDraft(); agents.update(); tab = next; $('menu').hidden = false
    for (const p of app.profiles) loadFace(p)
    renderMenu(); renderHud()
    if (tab === 'saves') void saves.load()
  }
  function closeMenu() { $('menu').hidden = true; renderHud() }
  function renderFooter() {
    const pending = app.dirty || !!rpgView.settingsDirty || agents.dirty
    $('menu-footer').hidden = tab === 'saves' // slots act at once; there is nothing to apply
    $('draft-label').textContent = pending ? '적용 안 한 변경이 있어' : ''
    $('apply').disabled = app.working || !pending; $('cancel').disabled = app.working || !pending
  }
  rpgView.onSettingsChange?.(() => renderFooter())
  function renderMenu() {
    for (const b of $('menu').querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab))
    for (const id of MENU_TABS) $(`tab-${id}`).hidden = tab !== id
    for (const id of RPG_TABS) $('menu').querySelector(`[data-tab=${id}]`).hidden = !app.world?.rpg
    renderFooter()
    saves.render()
    const slots = $('slots'); slots.replaceChildren()
    for (let i = 0; i < 6; i++) {
      const id = app.draft.profileIds[i], p = app.profiles.find(p => p.id === id)
      const slot = document.createElement('button'); slot.type = 'button'; slot.className = 'slot'
      if (p) {
        const color = app.world.residents.find(r => r.profileId === p.id)?.color
        slot.append(createPortrait(p.name, faces.get(p.id), color), Object.assign(document.createElement('b'), { textContent: p.name }))
        slot.title = `${p.name} 빼기`; slot.addEventListener('click', () => togglePick(p.id))
      } else { slot.disabled = true; slot.append(Object.assign(document.createElement('span'), { className: 'hole' }), document.createTextNode('빈 자리')) }
      slots.append(slot)
    }
    $('slot-count').textContent = `${app.draft.profileIds.length} / 6`
    const grid = $('profiles'); grid.replaceChildren()
    if (!app.profiles.length) grid.append(Object.assign(document.createElement('p'), { className: 'empty', textContent: '쓸 수 있는 채팅 프로필이 없어.' }))
    app.profiles.forEach((p, i) => {
      const picked = app.draft.profileIds.indexOf(p.id)
      const card = document.createElement('button'); card.type = 'button'; card.className = 'card'; card.setAttribute('aria-pressed', String(picked >= 0))
      const art = document.createElement('span'); art.className = 'art'; art.style.setProperty('--resident-color', app.world.residents.find(r => r.profileId === p.id)?.color ?? ['#8a5a4c', '#3f6f72', '#5d4f8c', '#62783f', '#3e4f86', '#86663a'][i % 6]); art.textContent = Array.from(p.name.trim())[0] || '?'
      const face = faces.get(p.id)
      if (face?.url) {
        const image = document.createElement('img'); image.alt = ''; image.src = face.url
        if (face.crop) { const pos = `${face.crop.x}% ${face.crop.y}%`; image.style.objectPosition = pos; image.style.transformOrigin = pos; image.style.transform = `scale(${face.crop.scale})` }
        art.append(image)
      }
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name
      nm.append(Object.assign(document.createElement('small'), { textContent: p.tagline || ' ' }))
      card.append(art, nm)
      if (picked >= 0) card.append(Object.assign(document.createElement('span'), { className: 'pick', textContent: String(picked + 1) }))
      card.addEventListener('click', () => togglePick(p.id)); grid.append(card)
    })
    if (document.activeElement !== $('scene')) $('scene').value = app.draft.scene
    $('actionMin').textContent = String(app.draft.actionMin); $('actionMax').textContent = String(app.draft.actionMax)
    $('walkSpeed').textContent = app.draft.walkSpeed.toFixed(1)
    for (const b of $('wander').querySelectorAll('[data-wander]')) b.setAttribute('aria-pressed', String(String(app.draft.wander) === b.dataset.wander))
    $('dayMinutes').textContent = String(app.draft.dayMinutes)
    $('replyLength').textContent = app.draft.replyLength === 0 ? '프로필 기본값' : String(app.draft.replyLength)
    $('replyTimeoutMinutes').textContent = app.draft.replyTimeoutMinutes ? String(app.draft.replyTimeoutMinutes) : '프로필 기본값'
    for (const b of $('sleep').querySelectorAll('[data-sleep]')) b.setAttribute('aria-pressed', String(String(app.draft.sleep) === b.dataset.sleep))
    renderInstructions()
  }
  // 지시문: the invited residents as a list (face, name, a dot when they have instructions), the picked one's text beside it.
  function renderInstructions() {
    if (!app.draft.profileIds.includes(instructionProfileId)) instructionProfileId = app.draft.profileIds[0] ?? null
    const list = $('instruction-residents'), input = $('resident-instructions')
    list.replaceChildren(...app.draft.profileIds.map(id => {
      const name = app.profiles.find(p => p.id === id)?.name ?? app.world.residents.find(r => r.profileId === id)?.name ?? String(id)
      const b = document.createElement('button'); b.type = 'button'; b.className = 'inst-who'; b.dataset.profileId = String(id); b.setAttribute('aria-pressed', String(id === instructionProfileId))
      const has = !!app.draft.residentInstructions.find(r => r.profileId === id)?.instructions.trim()
      b.append(createPortrait(name, faces.get(id), app.world.residents.find(r => r.profileId === id)?.color), Object.assign(document.createElement('b'), { textContent: name }))
      if (has) b.append(Object.assign(document.createElement('i'), { className: 'inst-dot', title: '지시문 있음' }))
      b.addEventListener('click', () => { instructionProfileId = id; renderInstructions() })
      return b
    }))
    input.disabled = instructionProfileId === null; input.hidden = instructionProfileId === null
    const value = app.draft.residentInstructions.find(r => r.profileId === instructionProfileId)?.instructions ?? ''
    if (input.value !== value) input.value = value
    $('instructions-count').textContent = `${input.value.length}자 · 프로필 문맥 설정을 따라`
    $('instructions-empty').hidden = instructionProfileId !== null
  }
  $('resident-instructions').addEventListener('input', () => {
    const entry = app.draft.residentInstructions.find(r => r.profileId === instructionProfileId)
    if (!entry) return
    const had = !!entry.instructions.trim()
    entry.instructions = $('resident-instructions').value
    app.dirty = true; renderFooter()
    $('instructions-count').textContent = `${entry.instructions.length}자 · 프로필 문맥 설정을 따라`
    if (had !== !!entry.instructions.trim()) renderInstructions()
    publish()
  })
  function togglePick(id) {
    const at = app.draft.profileIds.indexOf(id)
    if (at >= 0) app.draft.profileIds.splice(at, 1)
    else if (app.draft.profileIds.length >= 6) { toast('주민은 최대 6명까지 초대할 수 있어.'); return }
    else app.draft.profileIds.push(id)
    app.draft.residentInstructions = app.draft.profileIds.map(profileId => app.draft.residentInstructions.find(r => r.profileId === profileId) ?? { profileId, instructions: app.world.residents.find(r => r.profileId === profileId)?.instructions ?? '' })
    markDirty()
  }
  for (const b of $('menu').querySelectorAll('[data-tab]')) b.addEventListener('click', () => { tab = b.dataset.tab; if (RPG_TABS.includes(tab)) rpgView.showSettings?.(); renderMenu(); publish(); if (tab === 'saves') void saves.load() })
  $('scene').addEventListener('input', () => { app.draft.scene = $('scene').value; markDirty() })
  for (const chip of $('menu').querySelectorAll('.presets button')) chip.addEventListener('click', () => { app.draft.scene = `${chip.textContent}. ${app.draft.scene}`.slice(0, 500); $('scene').value = app.draft.scene; markDirty() })
  for (const b of $('menu').querySelectorAll('[data-step]')) b.addEventListener('click', () => {
    const key = b.dataset.step, value = Math.max(ACTION_RANGE.min, Math.min(ACTION_RANGE.max, app.draft[key] + Number(b.dataset.by)))
    app.draft[key] = value
    if (app.draft.actionMin > app.draft.actionMax) key === 'actionMin' ? app.draft.actionMax = value : app.draft.actionMin = value
    markDirty()
  })
  for (const b of $('menu').querySelectorAll('[data-walk]')) b.addEventListener('click', () => { app.draft.walkSpeed = Math.round(Math.max(WALK_RANGE.min, Math.min(WALK_RANGE.max, app.draft.walkSpeed + Number(b.dataset.walk))) * 10) / 10; markDirty() })
  for (const b of $('wander').querySelectorAll('[data-wander]')) b.addEventListener('click', () => { app.draft.wander = b.dataset.wander === 'true'; markDirty() })
  for (const b of $('menu').querySelectorAll('[data-day]')) b.addEventListener('click', () => {
    const at = DAY_LENGTHS.indexOf(app.draft.dayMinutes), next = DAY_LENGTHS[Math.max(0, Math.min(DAY_LENGTHS.length - 1, (at < 0 ? DAY_LENGTHS.indexOf(DEFAULT_SETTINGS.dayMinutes) : at) + Number(b.dataset.day)))]
    if (next !== app.draft.dayMinutes) { app.draft.dayMinutes = next; markDirty() }
  })
  for (const b of $('menu').querySelectorAll('[data-reply]')) b.addEventListener('click', () => {
    const at = REPLY_LENGTHS.indexOf(app.draft.replyLength), next = REPLY_LENGTHS[Math.max(0, Math.min(REPLY_LENGTHS.length - 1, (at < 0 ? REPLY_LENGTHS.indexOf(DEFAULT_SETTINGS.replyLength) : at) + Number(b.dataset.reply)))]
    if (next !== app.draft.replyLength) { app.draft.replyLength = next; markDirty() }
  })
  for (const b of $('sleep').querySelectorAll('[data-sleep]')) b.addEventListener('click', () => { app.draft.sleep = b.dataset.sleep === 'true'; markDirty() })
  for (const b of $('menu').querySelectorAll('[data-reply-timeout]')) b.addEventListener('click', () => {
    const value = app.draft.replyTimeoutMinutes, delta = Number(b.dataset.replyTimeout)
    const next = value === 0 ? delta > 0 ? 5 : 0 : value === 5 && delta < 0 ? 0 : replyTimeoutMinutesOf({ replyTimeoutMinutes: value + delta })
    if (next !== app.draft.replyTimeoutMinutes) { app.draft.replyTimeoutMinutes = next; markDirty() }
  })

  $('menu-close').addEventListener('click', closeMenu)
  $('menu').querySelector('.dim').addEventListener('click', closeMenu)
  $('cancel').addEventListener('click', () => { app.dirty = false; resetDraft(); if (rpgView.settingsDirty) rpgView.resetSettings?.(); if (agents.dirty) agents.reset(); renderMenu(); publish() })
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('menu').hidden) closeMenu() })
  $('open-menu').addEventListener('click', () => openMenu())
  $('apply').addEventListener('click', handle(async () => {
    if (app.dirty) {
      await request('configure', { revision: draftRevision, ...app.draft })
      app.dirty = false; resetDraft(); publish()
      for (const r of app.world.residents) loadFace(app.profiles.find(p => p.id === r.profileId))
    }
    if (rpgView.settingsDirty) { await rpgView.saveSettings(); agents.rebase(app.world.agentSettingsRevision) }
    if (agents.dirty) await agents.save()
    closeMenu(); publish()
  }))

  async function prepare(args) {
    // AI 행동 fields are their own draft; the village draft is touched only when the call names village fields too.
    const agentFields = AGENT_KEYS.some(k => args[k] !== undefined), villageFields = Object.keys(args).some(k => !AGENT_KEYS.includes(k))
    if (agentFields && !villageFields) { openMenu(agents.prepare(args)); publish(); return }
    if (args.profileIds) {
      if (args.profileIds.length > 6) throw new Error('주민은 최대 6명까지야.')
      if (args.profileIds.some(id => !app.profiles.some(p => p.id === id))) throw new Error('사용 가능한 프로필 ID를 골라줘.')
    }
    resetDraft()
    const next = { ...app.draft, profileIds: args.profileIds ? [...new Set(args.profileIds)] : [...app.draft.profileIds] }
    const instructions = new Map(parseResidentInstructions(args.residentInstructions, next.profileIds).map(r => [r.profileId, r.instructions]))
    next.residentInstructions = next.profileIds.map(profileId => ({ profileId, instructions: instructions.get(profileId) ?? app.draft.residentInstructions.find(r => r.profileId === profileId)?.instructions ?? app.world.residents.find(r => r.profileId === profileId)?.instructions ?? '' }))
    if (args.scene !== undefined) next.scene = args.scene
    if (args.actionMin !== undefined) next.actionMin = args.actionMin
    if (args.actionMax !== undefined) next.actionMax = args.actionMax
    if (args.walkSpeed !== undefined) next.walkSpeed = Math.round(args.walkSpeed * 10) / 10
    if (args.wander !== undefined) next.wander = args.wander
    if (args.dayMinutes !== undefined) { if (!DAY_LENGTHS.includes(args.dayMinutes)) throw new Error(`하루 길이는 ${DAY_LENGTHS.join(', ')}분 중에서 골라줘.`); next.dayMinutes = args.dayMinutes }
    if (args.sleep !== undefined) next.sleep = args.sleep
    if (args.replyLength !== undefined) { if (!REPLY_LENGTHS.includes(args.replyLength)) throw new Error(`AI 답변 한도는 ${REPLY_LENGTHS.join(', ')} 중에서 골라줘.`); next.replyLength = args.replyLength }
    if (args.replyTimeoutMinutes !== undefined) next.replyTimeoutMinutes = replyTimeoutMinutesOf(args)
    if (next.actionMin > next.actionMax) throw new Error('행동 간격의 최소가 최대보다 클 수 없어.')
    const agentTab = agentFields ? agents.prepare(args) : null
    app.draft = next
    if (args.residentInstructions?.length) instructionProfileId = args.residentInstructions[0].profileId
    app.dirty = true; openMenu(args.residentInstructions ? 'instructions' : args.profileIds ? 'residents' : args.replyTimeoutMinutes !== undefined ? 'village' : agentTab ?? 'story'); publish()
  }

  return { open: openMenu, close: closeMenu, render: renderMenu, resetDraft, prepare, agents }
}

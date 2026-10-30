import { QUEST_TYPES, questReward } from '../../shared/rpg-systems.mjs'
import { node, svgIcon, tip, setOptions } from '../ui/dom.js'
import { QUEST_ICON, QUEST_UNIT, P, closed } from './common.js'

/* Quests */
const questRange = type => ({ min: type === 'explore' ? 20 : 1, max: type === 'explore' ? 100 : type === 'recover' ? 3 : ['clear', 'survey'].includes(type) ? 1 : 20 })

export function createQuests({ guild, layer, parts, open, run, request, publish }) {
  const $ = id => document.getElementById(id)
  const { face, bar, watchButton } = parts
  function setQuestType(type) {
    guild.questType = Object.hasOwn(QUEST_TYPES, type) ? type : 'hunt'
    const range = questRange(guild.questType), input = $('rpg-quest-count')
    input.min = range.min; input.max = range.max; input.value = Math.min(range.max, Math.max(range.min, Number(input.value)))
    $('rpg-count-label').textContent = QUEST_UNIT[guild.questType]
    for (const b of $('rpg-quest-type').children) b.setAttribute('aria-checked', String(b.dataset.type === guild.questType))
    reward()
  }
  function reward() {
    const zone = guild.world?.rpg.zones.find(z => z.id === $('rpg-quest-zone').value), count = Number($('rpg-quest-count').value)
    const range = questRange(guild.questType), value = zone ? questReward(guild.questType, count, zone.level) : null
    $('rpg-reward').replaceChildren(...(value && count >= range.min && count <= range.max ? [svgIcon(P.coin), `${value.gold}G · ${value.xp} EXP`] : []))
  }
  $('rpg-quest-type').append(...Object.entries(QUEST_TYPES).map(([type, name]) => {
    const b = node('button', '', 'rq-type'); b.type = 'button'; b.dataset.type = type; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(type === guild.questType))
    b.append(svgIcon(QUEST_ICON[type]), node('span', name)); b.addEventListener('click', () => { setQuestType(type); guild.questDirty = true; guild.questRequest = null; publish() }); return b
  }))
  function renderQuests() {
    const state = guild.world.rpg
    setOptions($('rpg-quest-zone'), state.zones.map(z => [z.id, `${z.floor}층 ${z.name}${z.unlocked ? '' : ' · 잠김'}`])); reward()
    const counts = { current: state.quests.filter(q => !closed(q)).length, completed: state.quests.filter(closed).length, all: state.quests.length }
    $('rpg-quest-filter').replaceChildren(...[['current', '진행·모집'], ['completed', '끝난 의뢰'], ['all', '전체']].map(([id, title]) => {
      const b = node('button', title); b.type = 'button'; b.id = `rpg-qf-${id}`; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(guild.questFilter === id))
      b.append(node('span', String(counts[id]), 'num gw-count')); b.addEventListener('click', () => { guild.questFilter = id; renderQuests(); publish() }); return b
    }))
    const order = q => q.status === 'active' ? 0 : q.status === 'open' ? 1 : 2
    const list = state.quests.filter(q => guild.questFilter === 'all' || (guild.questFilter === 'current' ? !closed(q) : closed(q))).sort((a, b) => order(a) - order(b) || b.createdAt - a.createdAt)
    $('rpg-board').replaceChildren(...list.map(q => {
      const line = node('div', '', 'rpg-quest'), type = q.type ?? 'hunt', zone = state.zones.find(z => z.id === q.zoneId), owner = state.actors.find(a => a.id === q.actorId)
      line.dataset.status = q.status
      const icon = node('span', '', 'rpg-qicon'); icon.dataset.type = type; icon.dataset.tip = QUEST_TYPES[type]; icon.append(svgIcon(QUEST_ICON[type] ?? QUEST_ICON.hunt))
      const main = node('div', '', 'rpg-qmain'), head = node('div', '', 'rpg-qhead')
      head.append(node('b', q.title))
      if (q.source === 'user') head.append(node('span', '내 의뢰', 'rpg-qtag mine'))
      if (closed(q)) head.append(node('span', q.status === 'completed' ? '완료' : '취소', `rpg-qtag ${q.status}`))
      main.append(head)
      if (q.note) main.append(node('p', q.note))
      const floorChip = node('button', `${zone?.floor ?? '?'}F`, 'rpg-qfloor num'); floorChip.type = 'button'; floorChip.id = `rpg-floor-quest-${q.id}`; tip(floorChip, `${zone?.floor ?? '?'}층 ${zone?.name ?? ''} 지도`); floorChip.addEventListener('click', () => open('zones', q.zoneId))
      const who = node('div', '', 'rpg-qwho')
      if (owner) { const b = node('button', '', 'rpg-qowner'); b.type = 'button'; b.id = `rpg-owner-${q.id}`; tip(b, `${owner.name} 모험 정보`); b.append(face(owner.profileId, owner.name), node('span', owner.name)); b.addEventListener('click', () => { guild.selected = owner.profileId; guild.detailTab = 'status'; open('actors') }); who.append(b) }
      else who.append(node('span', q.status === 'open' ? '모집 중' : '—', 'rpg-qwait'))
      const progress = node('div', '', 'rpg-qprogress'); progress.append(bar(q.progress, q.count, closed(q) && q.status === 'completed' ? 'hp' : 'xp'), node('span', type === 'explore' ? `${q.progress}% / ${q.count}%` : `${q.progress}/${q.count}`, 'num'))
      const gold = node('span', '', 'rpg-qgold num'); gold.append(svgIcon(P.coin), `${q.gold}`)
      const actions = node('div', '', 'rpg-quest-actions')
      if (owner?.expedition?.zoneId === q.zoneId && owner.phase !== 'dead') actions.append(watchButton(owner, `rpg-watch-${q.id}`))
      if (q.source === 'user' && q.status === 'open') {
        const button = node('button', guild.cancelTarget === q.id ? '취소 확인' : '취소', `btn${guild.cancelTarget === q.id ? ' danger' : ''}`); button.type = 'button'; button.id = `rpg-cancel-${q.id}`; button.disabled = guild.busy
        button.addEventListener('click', run(async () => { await request('rpg-commission-cancel', { questId: q.id }); guild.cancelTarget = null }))
        actions.append(button)
      }
      line.append(icon, main, floorChip, who, progress, gold, actions)
      return line
    }))
    if (!list.length) $('rpg-board').append(node('p', guild.questFilter === 'completed' ? '끝난 의뢰가 없어.' : '걸린 의뢰가 없어.', 'gw-empty'))
    if (state.shop?.guildAvailable === false) { const none = node('p', '마을에 모험가 길드 건물이 아직 없어 길드가 내는 자동 의뢰는 나오지 않아. 직접 의뢰는 걸 수 있고, 생활 창의 공사·공공 탭에서 길드를 지을 수 있어.', 'gw-empty'); none.id = 'rpg-guild-missing'; $('rpg-board').prepend(none) }
  }
  const composing = () => !$('rpg-commission').hidden
  const composer = visible => { $('rpg-commission').hidden = !visible; $('rpg-quests').classList.toggle('is-composing', visible); $('rpg-new-quest').setAttribute('aria-expanded', String(visible)); $('rpg-new-quest').hidden = visible; if (visible) $('rpg-quest-title').focus() }
  $('rpg-new-quest').addEventListener('click', () => composer(true))
  $('rpg-commission-close').addEventListener('click', () => composer(false))
  for (const b of layer.querySelectorAll('[data-qcount]')) b.addEventListener('click', () => {
    const input = $('rpg-quest-count'), next = Math.max(Number(input.min), Math.min(Number(input.max), (Number(input.value) || 0) + Number(b.dataset.qcount) * (guild.questType === 'explore' ? 10 : 1)))
    if (String(next) !== input.value) { input.value = String(next); input.dispatchEvent(new Event('input')) }
  })
  for (const id of ['rpg-quest-title', 'rpg-quest-note', 'rpg-quest-zone', 'rpg-quest-count']) $(id).addEventListener('input', () => { guild.questDirty = true; guild.questRequest = null; reward(); publish() })
  $('rpg-quest-zone').addEventListener('change', () => { guild.questDirty = true; guild.questRequest = null; reward(); publish() })
  $('rpg-submit').addEventListener('click', run(async () => {
    const range = questRange(guild.questType), title = $('rpg-quest-title').value.trim(), count = Number($('rpg-quest-count').value)
    if (!title || !Number.isInteger(count) || count < range.min || count > range.max) throw new Error('의뢰 이름과 목표 수를 확인해줘.')
    guild.questRequest ??= { requestId: crypto.randomUUID(), title, type: guild.questType, count, zoneId: $('rpg-quest-zone').value, note: $('rpg-quest-note').value }
    await request('rpg-commission', guild.questRequest)
    $('rpg-quest-title').value = $('rpg-quest-note').value = ''; guild.questDirty = false; guild.questRequest = null; composer(false); guild.questFilter = 'current'
  }))
  setQuestType('hunt')
  function prepareQuest(args) {
    const type = args.type ?? 'hunt', range = questRange(type)
    if (!guild.world?.rpg?.zones.some(z => z.id === args.zoneId) || typeof args.title !== 'string' || !args.title.trim() || args.title.length > 80 || !Number.isInteger(args.count) || !Object.hasOwn(QUEST_TYPES, type) || args.count < range.min || args.count > range.max || (args.note !== undefined && (typeof args.note !== 'string' || args.note.length > 500))) throw new Error('의뢰 이름·지역·토벌 수를 확인해줘.')
    open('quests'); composer(true); setQuestType(type); $('rpg-quest-title').value = args.title; $('rpg-quest-zone').value = args.zoneId; $('rpg-quest-count').value = args.count; $('rpg-quest-note').value = args.note ?? ''; guild.questDirty = true; guild.questRequest = null; reward(); publish()
  }

  return { renderQuests, composing, composer, prepareQuest }
}

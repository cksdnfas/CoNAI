import { POTIONS, SKILL_KINDS } from '../../shared/rpg-systems.mjs'
import { WEEKDAYS, hhmm, shiftsOf } from '../../shared/schedule.mjs'
import { node, svgIcon, svg } from '../ui/dom.js'
import { ROLE, SLOT, PHASE, P, RARITY, ITEM_ICON, POTION_ICON, STAT_ICON, STAT, POTION_TEXT, OUTCOME, INTENT, gearBonus, stamp, live } from './common.js'

// Character sheet: roster on the left, the picked adventurer's sheet on the right; gear as rarity-coloured slots.
export function createActors({ guild, parts, glyph, artUrl, monsterKey, open, render, publish, watchActor }) {
  const $ = id => document.getElementById(id)
  const { secondsLeft, face, bar, itemIcon } = parts
  function itemTile(item, worn, small) {
    const b = node('button', '', `rpg-it${small ? ' sm' : ''}`); b.type = 'button'; b.id = `rpg-item-${item.instanceId}`; b.dataset.item = item.instanceId
    b.dataset.rarity = RARITY[item.rarity] ?? 'common'; b.dataset.tip = item.name; b.setAttribute('aria-label', `${item.name}${worn ? ' · 착용 중' : ''}`)
    if (worn) b.dataset.worn = 'true'
    b.append(glyph(`item:${item.id}`, ITEM_ICON[item.slot] ?? ITEM_ICON.weapon))
    b.addEventListener('click', () => { guild.selectedItem = item.instanceId; render(); publish() })
    return b
  }
  function itemDetail(a, item, wornIds) {
    const aside = node('aside', '', 'rpg-gear-detail')
    if (!item) return aside
    const worn = wornIds.has(item.instanceId), current = worn ? null : a.equipment[item.slot]
    const place = a.inventory.some(i => i.instanceId === item.instanceId) ? '가방' : (a.storage ?? []).some(i => i.instanceId === item.instanceId) ? '창고' : ''
    const text = node('div'), stats = node('p', '', 'rpg-detail-stats num')
    for (const [key, name] of STAT) {
      if (!item[key] && !current?.[key]) continue
      const diff = current ? item[key] - current[key] : null, stat = node('span', `${name} ${item[key] ? `+${item[key]}` : '—'}`)
      if (diff !== null) stat.append(node('em', diff > 0 ? ` ▲${diff}` : diff < 0 ? ` ▼${-diff}` : ' =', `rpg-diff${diff > 0 ? ' up' : diff < 0 ? ' down' : ''}`))
      stats.append(stat)
    }
    text.append(node('b', item.name), node('small', [`${item.rarity} ${SLOT[item.slot] ?? ''}`, `Lv.${item.level}`, place, worn ? '착용 중' : current ? `비교: ${current.name}` : '이 부위는 비어 있어'].filter(Boolean).join(' · ')), stats)
    aside.dataset.rarity = RARITY[item.rarity] ?? 'common'; aside.append(itemIcon(item), text)
    return aside
  }
  function renderActors() {
    const data = guild.world.rpg
    if (!data.actors.some(a => a.profileId === guild.selected)) guild.selected = data.actors[0]?.profileId ?? null
    $('rpg-roster').replaceChildren(...data.actors.map(a => {
      const adventurer = a.role === 'adventurer'
      const button = node('button', '', 'rpg-actor'); button.type = 'button'; button.id = `rpg-actor-${a.profileId}`; button.setAttribute('aria-pressed', String(a.profileId === guild.selected)); button.dataset.role = a.role
      const who = node('span', '', 'rpg-actor-who'), name = node('b', a.name)
      if (live(a)) name.append(node('span', 'LIVE', 'rpg-live'))
      who.append(name, node('small', adventurer ? `Lv.${a.level} · ${a.phase === 'dead' ? `부활 ${secondsLeft(a)}초` : PHASE[a.phase]}` : ROLE[a.role]))
      if (adventurer) { const hp = bar(a.hp, a.stats.hp, 'hp'); hp.classList.add('thin'); who.append(hp) }
      button.append(face(a.profileId, a.name), who); button.title = a.name
      button.addEventListener('click', () => { guild.selected = a.profileId; guild.selectedItem = null; render(); publish() }); return button
    }))
    const target = $('rpg-character'), a = data.actors.find(a => a.profileId === guild.selected); target.replaceChildren()
    if (!a) { target.append(node('p', '마을에 주민을 초대해줘.', 'gw-empty')); return }
    const adventurer = a.role === 'adventurer'
    const hero = node('div', '', 'rpg-hero'), id = node('div', '', 'rpg-hero-id'), chips = node('div', '', 'rpg-chips')
    chips.append(node('span', adventurer ? a.calling?.translation?.job || a.calling?.job || '신탁 전' : ROLE[a.role], 'rpg-chip job'), node('span', `Lv.${a.level}`, 'rpg-chip'))
    const rank = node('span', a.rank, 'rpg-chip rank'); rank.dataset.tip = `${a.rank} 랭크`; chips.append(rank)
    if (adventurer) { const phase = node('span', a.phase === 'dead' ? `부활까지 ${secondsLeft(a)}초` : PHASE[a.phase], 'rpg-chip phase'); phase.dataset.phase = live(a) ? 'live' : a.phase; chips.append(phase) }
    id.append(node('h3', a.name), chips)
    const side = node('div', '', 'rpg-hero-side'), gold = node('span', '', 'rpg-gold num'); gold.dataset.tip = '소지금'; gold.append(svgIcon(STAT_ICON.gold), `${a.gold}G`); side.append(gold)
    if (live(a)) { const watch = node('button', '', 'btn main rpg-watch'); watch.type = 'button'; watch.id = 'rpg-actor-watch'; watch.innerHTML = svg(P.tv); watch.append('방송'); watch.addEventListener('click', () => watchActor(a.profileId)); side.append(watch) }
    hero.append(face(a.profileId, a.name), id, side); target.append(hero)
    if (!adventurer) {
      const shift = shiftsOf(data.settings)[a.role]
      target.append(node('p', shift ? `근무 ${hhmm(shift.open)}–${hhmm(shift.close)}${shift.off.length ? ` · ${shift.off.map(d => WEEKDAYS[d]).join('·')} 휴무` : ''}` : '마을에서 일해.', 'rpg-staff-note'))
      return
    }
    const top = node('div', '', 'rpg-top'), bars = node('div', '', 'rpg-bars')
    for (const [label, value, max, cls] of [['HP', a.hp, a.stats.hp, 'hp'], ['MP', a.mp, a.stats.mp, 'mp'], ['EXP', a.xp, a.nextXp, 'xp']]) {
      const track = bar(value, max, cls)
      track.setAttribute('role', 'meter'); track.setAttribute('aria-label', label); track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', String(max)); track.setAttribute('aria-valuenow', String(value))
      bars.append(node('span', label), track, node('em', `${value} / ${max}`, 'num'))
    }
    const strip = node('div', '', 'rpg-strip')
    for (const [key, name] of [['attack', '공격'], ['defense', '방어'], ['speed', '속도']]) { const cell = node('div'); cell.dataset.tip = name; cell.append(svgIcon(STAT_ICON[key]), node('b', String(a.stats[key]), 'num')); strip.append(cell) }
    const record = node('div', '', 'rpg-record'); record.dataset.tip = '완료한 의뢰 · 사망'; record.append(svgIcon(P.flag), node('b', String(a.completed), 'num'), svgIcon(P.skull), node('b', String(a.deaths), 'num')); strip.append(record)
    top.append(bars, strip); target.append(top)
    const detailNav = node('nav', '', 'rpg-detail-nav'); detailNav.setAttribute('aria-label', '모험가 상세')
    for (const [tabId, title] of [['status', '상태'], ['inventory', '장비'], ['journal', '원정 기록']]) { const b = node('button', title); b.type = 'button'; b.id = `rpg-detail-${tabId}`; b.setAttribute('aria-pressed', String(guild.detailTab === tabId)); b.addEventListener('click', () => { guild.detailTab = tabId; render(); publish() }); detailNav.append(b) }
    // Narrow windows show one panel at a time; a wide one lays all three out side by side (guild.css).
    const body = node('div', '', 'rpg-detail-body'); body.id = 'rpg-detail-body'; target.append(detailNav, body)
    const sections = Object.fromEntries(['status', 'inventory', 'journal'].map(tabId => { const el = node('div', '', 'rpg-detail-panel'); el.id = `rpg-detail-panel-${tabId}`; el.dataset.panel = tabId; if (guild.detailTab === tabId) el.dataset.active = 'true'; body.append(el); return [tabId, el] }))
    const block = (title, ...children) => { const el = node('section', '', 'rpg-block'); el.append(node('h4', title), ...children); return el }
    // 상태: the running expedition first, then the oracle's calling.
    if (a.expedition) {
      const e = a.expedition, zone = data.zones.find(z => z.id === e.zoneId), trip = node('div', '', 'rpg-trip-now'), line = node('div', '', 'rpg-line-head')
      const foeArt = e.monster && zone ? artUrl(monsterKey(zone.id, !!zone.map?.entities?.find(x => x.id === e.encounterId)?.boss)) : null
      if (foeArt) line.append(Object.assign(document.createElement('img'), { src: foeArt, alt: '', className: 'rpg-art rpg-foe-art', draggable: false }))
      line.append(node('b', `${zone?.floor ?? '?'}층 ${zone?.name ?? ''} · ${e.monster?.name ?? PHASE[a.phase]}`))
      if (e.monster && e.intent) line.append(node('span', INTENT[e.intent] ?? e.intent, 'rpg-intent'))
      trip.append(line)
      if (e.monster) { const foe = node('div', '', 'rpg-foe'); foe.append(bar(e.foeHp, e.monster.hp, 'foe'), node('em', `${e.foeHp} / ${e.monster.hp}`, 'num')); trip.append(foe) }
      const facts = node('div', '', 'rpg-facts num')
      for (const [path, text, label] of [[P.foe, e.kills, '처치'], [P.step, e.steps, '걸음'], ...(e.last ? [[STAT_ICON.attack, `${e.last.dealt} / ${e.last.taken}`, '준 피해 / 받은 피해']] : [])]) { const cell = node('span'); cell.dataset.tip = label; cell.append(svgIcon(path), String(text)); facts.append(cell) }
      if (a.phase === 'combat' && e.awaiting) facts.append(node('span', '행동 고르는 중', 'rpg-muted'))
      trip.append(facts)
      const quest = data.quests.find(q => q.id === a.questId)
      if (quest) {
        const qrow = node('div', '', 'rpg-foe')
        const link = node('button', `${quest.title} ${quest.progress} / ${quest.count}`, 'rpg-qlink'); link.type = 'button'; link.title = '의뢰 보기'; link.addEventListener('click', () => { guild.questFilter = 'current'; open('quests') })
        qrow.append(bar(quest.progress, quest.count, 'xp'), link); trip.append(qrow)
      }
      sections.status.append(block('지금 원정', trip))
    }
    if (a.retryWaits?.length) sections.status.append(node('p', a.retryWaits.map(w => `${data.zones.find(z => z.id === w.zoneId)?.floor}층 재도전 ${Math.ceil(w.seconds / 60)}분 대기`).join(' · '), 'rpg-muted'))
    const skills = node('div', '', 'rpg-skills')
    if (a.calling) {
      for (const [index, k] of a.calling.skills.entries()) {
        const translated = a.calling.translation?.skills?.[index]
        const skill = node('div', '', 'rpg-skill'), url = artUrl(`skill:${a.id}:${k.name}`)
        if (url) { skill.classList.add('has-art'); skill.append(Object.assign(document.createElement('img'), { src: url, alt: '', className: 'rpg-art', draggable: false })) }
        skill.append(node('b', translated?.name || k.name), node('em', SKILL_KINDS[k.kind ?? 'strike'])); if (k.effect) skill.append(node('span', translated?.effect || k.effect)); skills.append(skill)
      }
      skills.append(node('small', `${a.calling.by}에게 받은 신탁 · ${a.calling.rank} 랭크`, 'rpg-muted'))
    } else skills.append(node('p', '아직 신탁을 받지 않았어.', 'rpg-muted'))
    sections.status.append(block('스킬', skills))
    // 장비: worn slots and potions, the bag and the home storage as grids, the picked item compared with what is worn.
    const wornIds = new Set(Object.values(a.equipment).filter(Boolean).map(i => i.instanceId))
    const everything = [...Object.values(a.equipment).filter(Boolean), ...a.inventory, ...(a.storage ?? [])]
    const picked = everything.find(i => i.instanceId === guild.selectedItem) ?? a.inventory.find(i => !wornIds.has(i.instanceId)) ?? everything[0] ?? null
    const gear = node('div', '', 'rpg-gear'), slots = node('div', '', 'rpg-slots')
    for (const [slot, label] of Object.entries(SLOT)) {
      const item = a.equipment[slot], line = node('div', '', 'rpg-slot'), text = node('div', '', 'rpg-slot-text')
      if (item) { line.dataset.rarity = RARITY[item.rarity] ?? 'common'; const tile = itemTile(item, false); tile.removeAttribute('id'); line.append(tile) }
      else { const hole = node('span', '', 'rpg-it empty'); hole.append(svgIcon(ITEM_ICON[slot])); line.append(hole) }
      text.append(node('b', item?.name ?? `${label} 없음`)); if (item) text.append(node('span', gearBonus(item), 'num'))
      line.append(text); slots.append(line)
    }
    const pots = node('div', '', 'rpg-pots')
    for (const [key, def] of Object.entries(POTIONS)) { const pot = node('span', '', 'rpg-pot'); pot.dataset.kind = key; pot.dataset.tip = `${def.name} · ${POTION_TEXT[key]}`; pot.append(glyph(`potion:${key}`, POTION_ICON), node('b', String(a.supplies?.[key] ?? 0), 'num')); pots.append(pot) }
    gear.append(block('착용', slots, pots))
    for (const [title, list, size, small] of [['가방', a.inventory, a.bagSize ?? 6, false], ['창고', a.storage ?? [], a.storageSize ?? 40, true]]) {
      const heading = node('h4', `${title} `); heading.append(node('span', `${list.length}/${size}`, 'num'))
      const grid = node('div', '', `rpg-grid${small ? ' sm' : ''}`)
      for (let i = 0; i < Math.max(size, list.length); i++) grid.append(list[i] ? itemTile(list[i], wornIds.has(list[i].instanceId), small) : node('span', '', `rpg-it empty${small ? ' sm' : ''}`))
      const section = node('section', '', 'rpg-block'); section.append(heading, grid); gear.append(section)
    }
    gear.append(itemDetail(a, picked, wornIds))
    for (const tile of gear.querySelectorAll('[data-item]')) tile.setAttribute('aria-pressed', String(tile.dataset.item === picked?.instanceId))
    sections.inventory.append(gear)
    // 원정 기록: newest first, the outcome coloured.
    if (a.journal?.length) {
      const list = node('div', '', 'rpg-journal')
      for (const entry of a.journal.slice().reverse()) {
        const trip = node('div', '', 'rpg-trip'); trip.dataset.outcome = entry.outcome
        trip.append(node('span', OUTCOME[entry.outcome] ?? entry.outcome, 'rpg-trip-out'), node('b', `${entry.floor}층`), node('span', `${entry.kills} 처치 · 피해 ${entry.damage} · 물약 ${entry.potions}`, 'num'), node('small', entry.reason ?? ''), node('time', entry.at ? stamp(entry.at) : '', 'num'))
        list.append(trip)
      }
      sections.journal.append(block('원정 기록', list))
    } else sections.journal.append(block('원정 기록', node('p', '아직 원정 기록이 없어.', 'rpg-muted')))
  }

  return renderActors
}

import { createPortrait } from '../ui/portrait.js'
import { setText, place } from '../ui/dom.js'
import { backoff } from './resident.js'

const $ = id => document.getElementById(id)

// One row per resident, kept across polls: rebuilding the list every second re-created each portrait (its initial
// flashed until the image loaded again) and restyled the whole panel.
export function createParty({ app, faces, selectResident, openMenu }) {
  let partySignature = ''
  const partyRows = new Map()
  let inviteRow = null
  function renderParty() {
    const signature = JSON.stringify([app.selected, app.world.thinking, app.world.residents.map(r => [r.profileId, r.name, r.color, r.destination, r.activity, r.moving, r.away, r.asleep, backoff(app.world, r), r.agentError]), app.world.rpg?.actors.map(a => [a.profileId, !!a.expedition, a.phase]), [...faces.values()].map(f => f.url)])
    if (signature === partySignature) return
    partySignature = signature
    const party = $('party'); party.hidden = !app.world.residents.length
    for (const id of partyRows.keys()) if (!app.world.residents.some(r => r.profileId === id)) partyRows.delete(id)
    const rows = app.world.residents.map(r => {
      let row = partyRows.get(r.profileId)
      if (!row) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'pm'; button.dataset.profileId = String(r.profileId)
        const dot = document.createElement('span'); dot.className = 'st'
        const who = document.createElement('span'); who.className = 'who'
        const name = document.createElement('b'), where = document.createElement('small'), live = Object.assign(document.createElement('span'), { className: 'live-tag', textContent: 'LIVE' })
        who.append(name, where); button.append(document.createElement('span'), who)
        button.addEventListener('click', () => selectResident(r.profileId, button))
        row = { button, dot, name, where, live, faceKey: '' }; partyRows.set(r.profileId, row)
      }
      const thinking = app.world.thinking?.from === r.profileId, waiting = backoff(app.world, r)
      const state = waiting ? 'wait' : thinking ? 'think' : r.activity === 'talk' ? 'talk' : r.moving ? 'walk' : 'rest'
      const portrait = faces.get(r.profileId), faceKey = `${r.name}:${r.color}:${portrait?.url ?? ''}`
      if (row.faceKey !== faceKey) { row.faceKey = faceKey; const face = createPortrait(r.name, portrait, r.color); face.append(row.dot); row.button.firstChild.replaceWith(face) }
      if (row.dot.dataset.state !== state) row.dot.dataset.state = state
      row.button.setAttribute('aria-pressed', String(app.selected === r.profileId))
      setText(row.name, r.name); setText(row.where, waiting ? '판단 재시도 대기' : thinking ? '생각 중…' : state === 'talk' ? '이야기하는 중' : r.destination)
      const title = `${r.name} · ${row.where.textContent}${waiting ? ` · ${r.agentError}` : ''}`
      if (row.button.title !== title) row.button.title = title
      const live = !!app.world.rpg?.settings.enabled && app.world.rpg.actors.some(a => a.profileId === r.profileId && a.expedition && a.phase !== 'dead')
      if (live !== (row.button.dataset.live === 'true')) { if (live) { row.button.dataset.live = 'true'; row.button.append(row.live) } else { delete row.button.dataset.live; row.live.remove() } }
      return row.button
    })
    if (app.world.residents.length < 6) {
      if (!inviteRow) {
        inviteRow = document.createElement('button'); inviteRow.type = 'button'; inviteRow.className = 'pm add'; inviteRow.title = '주민 초대'
        const face = document.createElement('span'); face.className = 'profile-face'; face.textContent = '+'
        const who = document.createElement('span'); who.className = 'who'; who.textContent = '주민 초대'
        inviteRow.append(face, who); inviteRow.addEventListener('click', () => openMenu('residents'))
      }
      rows.push(inviteRow)
    }
    place(party, rows)
  }

  return { render: renderParty, invalidate: () => { partySignature = '' } }
}

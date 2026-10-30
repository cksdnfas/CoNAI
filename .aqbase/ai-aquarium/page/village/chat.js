import { speechNodes } from '../ui/speech.js'
import { OLD_TOOL_LINE } from '../../shared/speech.mjs'
import { node } from '../ui/dom.js'
import { requestCard, minutesLeft } from './resident.js'

const $ = id => document.getElementById(id)
const NAME_COLORS = ['#ffb48c', '#86ddd2', '#cbbaff', '#ff9fae', '#d4e38f', '#9ec3ff']
const CHAT_LINES = 5
const SPOKEN = new Set(['say', 'viewer', 'react']) // broadcast chat lines read like speech in the village feed

/** The village feed under the map: the last lines folded, the whole feed open, filtered by kind or by one speaker. */
export function createChat({ app, painter, memoryView, selectResident, openResident, cancelRequest }) {
  let filter = 'all', chatOpen = false, talkSig = ''
  /*
   * Above the feed: the conversations going on now (who, turn x/max, thinking) and the consent requests. Folded, one
   * row of chips; open, the request cards too (waiting ones, then the last few answers with their reasons).
   */
  function renderTalks() {
    const w = app.world, talks = w?.conversations ?? [], requests = w?.pendingRequests ?? []
    const open = requests.filter(q => q.status === 'pending'), done = chatOpen ? requests.filter(q => q.status !== 'pending').sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0)).slice(0, 5) : []
    const sig = JSON.stringify([chatOpen, talks.map(c => [c.id, c.participants, c.speaker, c.turn, c.maxTurns, c.thinking]), open, chatOpen ? open.map(q => minutesLeft(w, q)) : [], done, w?.residents.map(r => [r.profileId, r.name])])
    if (sig === talkSig) return
    talkSig = sig
    const box = $('talks'), name = id => w.residents.find(r => r.profileId === id)?.name ?? `#${id}`
    const chips = talks.map(c => {
      const b = node('button', '', 'talk-chip'); b.type = 'button'; b.dataset.thinking = String(!!c.thinking)
      b.append(node('b', c.participants.map(name).join('·')), node('span', `${c.turn}/${c.maxTurns}`, 'num'))
      if (c.thinking) b.append(node('i', '', 'talk-dots'))
      b.title = `${c.participants.map(name).join(', ')} 대화 · ${c.turn}/${c.maxTurns}차례 · ${c.thinking ? `${name(c.speaker)} 생각 중` : `다음 ${name(c.speaker)}`}`
      b.addEventListener('click', event => { event.stopPropagation(); openResident(c.speaker) })
      return b
    })
    if (open.length && !chatOpen) chips.push(node('span', `요청 대기 ${open.length}`, 'talk-chip waiting'))
    const row = node('div', '', 'talk-row'); row.append(...chips)
    const cards = chatOpen ? [...open.map(q => requestCard(w, q, cancelRequest)), ...done.map(q => requestCard(w, q))] : []
    box.replaceChildren(...(chips.length ? [row] : []), ...cards)
    box.hidden = !chips.length && !cards.length
    $('chat').hidden = !app.feed.length && box.hidden
  }
  const nameColor = id => { const i = app.world?.residents.findIndex(r => r.profileId === id) ?? -1; return NAME_COLORS[(i < 0 ? 0 : i) % NAME_COLORS.length] }
  let speakerFilter = null
  const chatRows = new WeakMap(), chatEmpty = Object.assign(document.createElement('div'), { className: 'empty', textContent: '아직 조용해.' })
  function renderChat() {
    const rows = app.feed.filter(e => (filter === 'all' || e.kind === filter || (filter === 'say' && SPOKEN.has(e.kind)) || (filter === 'event' && e.kind === 'dm')) && (!speakerFilter || e.speaker === speakerFilter) && !(e.kind === 'event' && OLD_TOOL_LINE.test(e.text)))
    const shown = chatOpen ? rows : rows.slice(-CHAT_LINES)
    const logs = $('logs'), nearBottom = logs.scrollHeight - logs.scrollTop - logs.clientHeight < 60
    // Each line is built once; a new message appends its row and drops the oldest instead of rebuilding the feed.
    const nodes = shown.map(e => {
      let row = chatRows.get(e)
      if (row) return row
      row = document.createElement('div'); row.className = 'ln'; row.dataset.kind = e.kind; chatRows.set(e, row)
      const time = document.createElement('time'); time.className = 'num'; time.textContent = new Date(e.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
      const body = document.createElement('p')
      if (e.kind === 'viewer') {
        const to = document.createElement('span'); to.className = 'to'; to.textContent = `→ ${e.recipient} 방송`
        body.append(Object.assign(document.createElement('b'), { className: 'name viewer', textContent: '시청자' }), to, document.createTextNode(e.text))
      } else if (SPOKEN.has(e.kind)) {
        const name = document.createElement('button'); name.type = 'button'; name.className = 'name'; name.style.color = nameColor(e.speaker); name.textContent = e.name
        name.addEventListener('click', event => { event.stopPropagation(); openNameMenu(e, name) })
        const to = document.createElement('span'); to.className = 'to'; to.textContent = e.kind === 'react' ? `→ ${e.recipient} 방송` : `→ ${e.recipient}`
        body.append(name, to, ...speechNodes(e.display_text ?? e.text))
        if (e.display_text) {
          const original = document.createElement('details'), label = document.createElement('summary'); label.textContent = '원문'
          original.append(label, document.createTextNode(e.text)); body.append(original)
        }
      } else {
        // The DM narrates in its own colour; other events are one plain line.
        if (e.kind === 'dm') body.append(Object.assign(document.createElement('b'), { className: 'name dm', textContent: 'GM' }))
        const text = document.createElement('span'); text.textContent = e.text.split('\n')[0].slice(0, 160); body.append(text)
      }
      row.append(time, body); return row
    })
    if (!shown.length) nodes.push(chatEmpty)
    const old = [...logs.children], start = old.indexOf(nodes[0])
    if (start >= 0 && old.length - start <= nodes.length && old.slice(start).every((n, i) => n === nodes[i])) { for (const n of old.slice(0, start)) n.remove(); logs.append(...nodes.slice(old.length - start)) }
    else logs.replaceChildren(...nodes)
    $('chat-scope').hidden = !speakerFilter
    $('chat-scope').textContent = speakerFilter ? `${app.feed.findLast(e => e.speaker === speakerFilter)?.name ?? ''}만 보는 중 ✕` : ''
    talkSig = ''; renderTalks()
    if (!chatOpen || nearBottom) logs.scrollTop = logs.scrollHeight
  }
  function openNameMenu(entry, anchor) {
    const menu = $('name-menu'), here = app.world?.residents.some(r => r.profileId === entry.speaker)
    const items = [
      here && ['지도에서 보기', () => { app.selected = null; selectResident(entry.speaker) }],
      [speakerFilter === entry.speaker ? '모두 보기' : '이 주민 대화만', () => { speakerFilter = speakerFilter === entry.speaker ? null : entry.speaker; if (chatOpen) renderChat(); else setChat(true) }],
      here && ['기억 보기', () => memoryView.open(entry.speaker, app.world.residents.find(r => r.profileId === entry.speaker)?.name ?? entry.name)],
    ].filter(Boolean)
    menu.replaceChildren(...items.map(([label, run]) => {
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'menuitem'); button.textContent = label
      button.addEventListener('click', event => { event.stopPropagation(); closeNameMenu(); run() })
      return button
    }))
    menu.hidden = false
    const stage = $('stage').getBoundingClientRect(), at = anchor.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(at.left - stage.left, stage.width - menu.offsetWidth - 8))}px`
    menu.style.top = `${Math.max(8, at.top - stage.top - menu.offsetHeight - 6)}px`
  }
  function closeNameMenu() { $('name-menu').hidden = true }
  document.addEventListener('click', event => { if (!event.target.closest('#name-menu')) closeNameMenu() })
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeNameMenu() })
  $('chat-scope').addEventListener('click', event => { event.stopPropagation(); speakerFilter = null; renderChat() })
  function setChat(open) { chatOpen = open; $('chat').classList.toggle('open', open); renderChat(); painter.repaint() }
  $('chat').addEventListener('click', event => { if (!chatOpen && !event.target.closest('.bar')) setChat(true) })
  $('chat-close').addEventListener('click', event => { event.stopPropagation(); setChat(false) })
  for (const button of $('chat').querySelectorAll('[data-filter]')) button.addEventListener('click', () => {
    filter = button.dataset.filter
    for (const b of $('chat').querySelectorAll('[data-filter]')) b.setAttribute('aria-selected', String(b === button))
    renderChat()
  })

  return { render: renderChat, renderTalks }
}

const $ = id => document.getElementById(id)

/* Quick menu: pill buttons pop out beside the pressed list entry (fixed there), or beside the token on the map (following it). */
const ICON = {
  tv: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6.5" width="18" height="13" rx="2.5"/><path d="M8.5 3l3.5 3.5L15.5 3"/></svg>',
  aim: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
  memory: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/></svg>',
  bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  pulse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>',
}

export function createQuickMenu({ app, painter, rpgView, memoryView, renderParty, publish, openLife = () => {}, openStatus = () => {} }) {
  let quickFrom = 'map', quickKey = '', quickOpened = '', quickFrame = 0
  function closeQuick() {
    if ($('quick').hidden) return
    $('quick').hidden = true; quickKey = quickOpened = ''; cancelAnimationFrame(quickFrame); quickFrame = 0
    if (app.selected !== null) { app.selected = null; painter.select(null); rpgView.select(null); renderParty(); publish() }
  }
  function renderQuick() {
    const menu = $('quick'), r = app.world?.residents.find(x => x.profileId === app.selected)
    if (!r) { if (!menu.hidden) { menu.hidden = true; quickKey = quickOpened = ''; cancelAnimationFrame(quickFrame); quickFrame = 0 } return }
    const actor = app.world.rpg?.settings.enabled ? app.world.rpg.actors.find(a => a.profileId === r.profileId) : null
    const live = !!actor?.expedition && actor.phase !== 'dead', watchable = live || (app.world.running && !r.away && !r.asleep)
    const onMap = quickFrom === 'list' && !!painter.anchor?.(r.profileId)
    const resident = !!app.world.rpg?.life && app.world.rpg.actors.some(a => a.profileId === r.profileId)
    const key = JSON.stringify([r.profileId, quickFrom, live, watchable, onMap, !!actor, resident])
    if (key !== quickKey) {
      quickKey = key
      const pill = (icon, label, run, cls = '') => {
        const b = document.createElement('button'); b.type = 'button'; b.className = `pill ${cls}`.trim(); b.setAttribute('role', 'menuitem'); b.innerHTML = ICON[icon]; b.append(label)
        b.addEventListener('click', event => { event.stopPropagation(); run() }); return b
      }
      const id = r.profileId, items = []
      if (watchable) items.push(pill('tv', live ? '방송 보기' : '생활 방송', () => { closeQuick(); rpgView.watch?.(id) }, live ? 'onair' : ''))
      if (onMap) items.push(pill('aim', '지도에서 보기', () => { painter.focus?.(id); quickFrom = 'map'; renderQuick() }))
      items.push(pill('pulse', '상태·관계', () => { closeQuick(); openStatus(id) }))
      items.push(pill('memory', '기억 보기', () => { closeQuick(); memoryView.open(id, r.name) }))
      if (actor) items.push(pill('shield', '모험 정보', () => { closeQuick(); rpgView.inspect?.(id) }))
      if (resident) items.push(pill('bag', '생활', () => { closeQuick(); openLife(id) }))
      items.forEach((b, i) => b.style.setProperty('--i', String(i)))
      menu.replaceChildren(...items); menu.setAttribute('aria-label', r.name)
      // Bounce only when the menu opens or moves to another place, not when a poll rebuilds it.
      const opened = `${id}:${quickFrom}`
      menu.classList.toggle('pop', opened !== quickOpened); quickOpened = opened
    }
    menu.dataset.from = quickFrom; menu.hidden = false
    placeQuick()
    cancelAnimationFrame(quickFrame); quickFrame = 0
    if (quickFrom === 'map') { const follow = () => { if ($('quick').hidden || quickFrom !== 'map') { quickFrame = 0; return } placeQuick(); quickFrame = requestAnimationFrame(follow) }; quickFrame = requestAnimationFrame(follow) }
  }
  function placeQuick() {
    const menu = $('quick')
    if (menu.hidden) return
    const stage = $('stage').getBoundingClientRect(), w = menu.offsetWidth || 130, h = menu.offsetHeight || 120
    const entry = $('party').querySelector(`.pm[data-profile-id="${app.selected}"]`)
    const token = quickFrom === 'map' ? painter.anchor?.(app.selected) : null
    let left, top
    if (token) {
      left = token.right - stage.left + 10
      if (left + w > stage.width - 12) left = token.left - stage.left - w - 10
      top = token.top - stage.top + token.height / 2 - h / 2
    } else {
      const at = entry?.getBoundingClientRect() ?? $('party').getBoundingClientRect(), party = $('party').getBoundingClientRect()
      left = party.right - stage.left + 8; top = at.top - stage.top
    }
    menu.style.left = `${Math.max(12, Math.min(stage.width - w - 12, left))}px`
    menu.style.top = `${Math.max(12, Math.min(stage.height - h - 12, top))}px`
  }
  document.addEventListener('pointerdown', event => { if (!$('quick').hidden && !event.target.closest('#quick, .tok, .pm')) closeQuick() })
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('quick').hidden) closeQuick() })
  window.addEventListener('resize', () => placeQuick())
  $('party').addEventListener('scroll', () => { if (quickFrom === 'list') placeQuick() })
  // The rail widens on hover/focus after the press placed the menu: follow its new edge instead of covering it.
  $('party').addEventListener('transitionend', event => { if (event.target === $('party') && quickFrom === 'list') placeQuick() })

  return { close: closeQuick, render: renderQuick, from: place => { quickFrom = place } }
}

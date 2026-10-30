import { node, svg, tip } from '../ui/dom.js'
import { P, RARITY, ITEM_ICON, pct } from './common.js'

/** Pieces every guild page draws: resident faces, bars, item icons and the 방송 button. */
export function createParts({ guild, glyph, portrait, portraits, watchActor }) {
  const secondsLeft = a => Math.max(0, Math.ceil((a.readyAt - guild.world.now) / 1000))
  function face(profileId, name) {
    const color = guild.world?.residents?.find(r => r.profileId === profileId)?.color
    if (portrait) return portrait(name, portraits()?.get?.(profileId), color)
    const el = node('span', '', 'profile-face'); el.append(node('span', Array.from(name.trim())[0] || '?', 'profile-initial')); return el
  }
  function bar(value, max, cls) { const track = node('span', '', `rpg-bar ${cls}`), fill = node('i'); fill.style.width = pct(value, max); track.append(fill); return track }
  function itemIcon(item, cls = '') {
    const el = node('span', '', `rpg-it ${cls}`.trim()); el.dataset.rarity = RARITY[item.rarity] ?? 'common'; el.append(glyph(`item:${item.id}`, ITEM_ICON[item.slot] ?? ITEM_ICON.weapon)); return el
  }
  function watchButton(a, id, cls = 'ib onair') {
    const watch = node('button', '', cls); watch.type = 'button'; if (id) watch.id = id; watch.innerHTML = svg(P.tv); tip(watch, `${a.name} 방송 보기`)
    watch.addEventListener('click', event => { event.stopPropagation(); watchActor(a.profileId) }); return watch
  }

  return { secondsLeft, face, bar, itemIcon, watchButton }
}

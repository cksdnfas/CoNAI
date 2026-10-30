import { POTIONS } from '../../shared/rpg-systems.mjs'
import { node, svgIcon } from '../ui/dom.js'
import { P, RARITY, POTION_ICON, POTION_TEXT, gearBonus } from './common.js'

/* Shop */
export function createShop({ guild, glyph, itemIcon }) {
  const $ = id => document.getElementById(id)
  function renderShop() {
    const shop = guild.world.rpg.shop ?? {}, grid = node('div', '', 'rs-grid')
    const card = (icon, name, sub, price, base, help) => {
      const el = node('div', '', 'rs-item'), text = node('div', '', 'rs-text'), cost = node('span', '', 'rs-price num')
      if (help) el.dataset.tip = help
      cost.append(svgIcon(P.coin), String(price)); if (base && base > price) cost.append(node('s', String(base)))
      text.append(name, node('small', sub, 'num')); el.append(icon, text, cost); grid.append(el)
    }
    // Only what the server puts on sale: a village without a general store has no shelf at all.
    const open = shop.available !== false
    for (const [key, def] of Object.entries(open ? shop.potions ?? {} : {})) {
      const icon = node('span', '', 'rpg-it'); icon.dataset.kind = key; icon.append(glyph(`potion:${key}`, POTION_ICON))
      card(icon, node('b', def.name), key === 'health' ? 'HP 45%' : 'MP 12', def.price, POTIONS[key]?.price, POTION_TEXT[key])
    }
    for (const item of open ? shop.equipment ?? [] : []) { const name = node('b', item.name); name.dataset.rarity = RARITY[item.rarity] ?? 'common'; card(itemIcon(item), name, `Lv.${item.level} · ${gearBonus(item)}`, item.price) }
    if (!open) { const none = node('p', '마을에 잡화점이 아직 없어. 생활 창의 공사·공공 탭에서 잡화점을 지으면 물약·장비 진열과 자동 보급이 열려.', 'gw-empty'); none.id = 'rpg-shop-missing'; grid.append(none) }
    // What the village's staff add, and what the inn charges after an expedition.
    const perks = node('div', '', 'rs-perks')
    const perk = (icon, title, state, on, help) => { const el = node('div', '', 'rs-perk'); el.dataset.on = String(on); el.dataset.tip = help; const text = node('div'); text.append(node('b', title), node('small', state)); el.append(svgIcon(icon), text); perks.append(el) }
    const off = shop.offDuty ?? {}
    perk(P.bag, shop.merchant ? `상인 ${shop.merchant}` : off.merchant ? `상인 ${off.merchant.name}` : '상인', shop.merchant ? '물약 −20% · 특제 장비' : off.merchant ? `쉬는 중 · ${off.merchant.hours}` : '없음', !!shop.merchant, '상인이 근무 중이면 물약이 20% 싸고, 공략한 층마다 특제 장비를 팔아.')
    perk(P.pen, shop.clerk ? `접수원 ${shop.clerk}` : off.guild ? `접수원 ${off.guild.name}` : '접수원', shop.clerk ? '의뢰 보상 +20%' : off.guild ? `쉬는 중 · ${off.guild.hours}` : '없음', !!shop.clerk, '접수원이 근무 중이면 의뢰 보상이 20% 늘어.')
    const supply = open && guild.world.rpg.settings.autoSupply
    perk(P.crate, '자동 보급', !open ? '잡화점 없음' : supply ? '켜짐' : '꺼짐', supply, '잡화점이 있을 때 출정 전에 예산 안에서 사고, 같은 장비 여분은 팔아.')
    perk(P.bed, '여관', '5 + 레벨×2 G', true, '원정에서 걸어 돌아오면 내. 돈이 없으면 두 배로 쉬어.')
    const goods = node('section', '', 'rs-goods'), aside = node('aside', '', 'rs-side')
    goods.append(node('h4', '진열대'), grid); aside.append(node('h4', '지금 혜택'), perks)
    $('rpg-shop').replaceChildren(goods, aside)
  }

  return renderShop
}

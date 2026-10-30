import { createHash } from 'node:crypto'
import { shiftLabel, shiftsOf } from '../../shared/schedule.mjs'
import { dayKey as dayOf, combatCallsToday, unlocked, RPG_DEFAULTS, stats, xpFor } from './rules.mjs'
import { POTIONS, BAG, STASH, gearPrice, retryAfter, potionPrice, shopStock, holder, innFee, hasFacility } from '../../shared/rpg-systems.mjs'
import { floorSummary } from './dungeon.mjs'
import { artOn, artHashes, artToday, artDailyOf, artProblem } from './game-art.mjs'
import { lifeView } from './life.mjs'
import { budgetText } from '../../shared/village-settings.mjs'

/** A floor's fixed geometry; what changes during play (`LIVE_MAP`) travels on its own every time. */
const mapHash = map => createHash('sha1').update(JSON.stringify([map.version, map.seed, map.width, map.height, map.tiles, map.entrance, map.exit])).digest('base64url').slice(0, 16)
const LIVE_MAP = ['entities', 'explored', 'cycle', 'resetAt']
/** The shop and guild staff who are off their shift right now, with their hours. */
const offDuty = s => Object.fromEntries(['merchant', 'guild'].map(role => { const a = hasFacility(s, role) && s.open?.[role] === false && s.actors.find(a => a.active && a.role === role); return [role, a ? { name: a.name, hours: shiftLabel(shiftsOf(s.settings)[role]) } : null] }))

  /** `maps` is what the page already holds ({ zoneId: hash }); an unchanged floor map is not sent again. */
export function viewOf(s, maps = null) {
  const zones = s.zones.map(z => {
    const drop = s.items.find(i => i.id === z.dropId)
    const out = { ...z, unlocked: unlocked(s, z), summary: floorSummary(z), drop: drop ? { id: drop.id, name: drop.name, slot: drop.slot, rarity: drop.rarity } : null }
    if (z.map) { out.mapHash = mapHash(z.map); if (maps?.[z.id] === out.mapHash) { out.map = Object.fromEntries(LIVE_MAP.map(k => [k, z.map[k]])); out.mapLive = true } }
    return out
  })
  return {
    revision: s.revision, configRevision: s.configRevision, settings: { ...RPG_DEFAULTS, ...s.settings }, combatMigrationNotice: s.combatMigrationNotice ?? null,
    shop: {
      available: hasFacility(s, 'merchant'), guildAvailable: hasFacility(s, 'guild'),
      potions: Object.fromEntries(Object.entries(hasFacility(s, 'merchant') ? POTIONS : {}).map(([key, def]) => [key, { ...def, price: potionPrice(s, key) }])),
      equipment: shopStock(s).map(i => ({ ...i, price: gearPrice(i) })),
      merchant: holder(s, 'merchant')?.name ?? null, clerk: holder(s, 'guild')?.name ?? null, offDuty: offDuty(s),
      innFee: Object.fromEntries(s.actors.filter(a => a.active && a.role === 'adventurer').map(a => [a.profileId, innFee(a)])),
    },
    zones, quests: s.quests, life: lifeView(s),
    actors: s.actors.filter(a => a.active).map(({ knowledge, ...a }) => ({
      ...a,
      expedition: a.expedition ? { ...a.expedition,
        awaiting: a.expedition.awaiting ? { id: a.expedition.awaiting.id, round: a.expedition.awaiting.round, since: a.expedition.awaiting.since } : null,
        navigationAsk: a.expedition.navigationAsk ? { id: a.expedition.navigationAsk.id, since: a.expedition.navigationAsk.since } : null,
      } : null,
      retryWaits: s.zones.map(z => ({ zoneId: z.id, seconds: Math.ceil(retryAfter(a, z, stats(s, a), Date.now()) / 1000) })).filter(w => w.seconds > 0),
      visible: a.expedition ? knowledge?.[a.expedition.zoneId] ?? '' : '', stats: stats(s, a), nextXp: xpFor(a.level),
      equipment: Object.fromEntries(Object.entries(a.equipment).map(([slot, id]) => [slot,
        a.inventory.find(i => i.id === id) ? { ...s.items.find(d => d.id === a.inventory.find(i => i.id === id).itemId), instanceId: id } : null])),
      inventory: a.inventory.map(i => ({ ...s.items.find(d => d.id === i.itemId), instanceId: i.id })),
      storage: (a.storage ?? []).map(i => ({ ...s.items.find(d => d.id === i.itemId), instanceId: i.id })), bagSize: BAG, storageSize: STASH,
    })),
    combatToday: combatCallsToday(s, Date.now()), logs: s.logs.slice(-20), thinking: s.pending ? { kind: s.pending.kind, actorId: s.pending.actorId ?? null } : null,
    error: s.error, budgetDiagnostic: s.budgetDiagnostic ?? null, budgetText: budgetText(s.budgetDiagnostic),
    attempts: s.pending?.attempts ?? s.aiFailures ?? 0,
    operationWaits: Object.values(s.operationFailures ?? {}).filter(f => f.until > Date.now()),
    aiPaused: false, aiFailures: s.aiFailures ?? 0,
    dm: {
      used: s.daily.day === dayOf(Date.now()) ? s.daily.count : 0, waitingAssets: s.assets.length,
      art: { on: artOn(s.settings), today: artToday(s, Date.now()), limit: artDailyOf(s.settings), setup: artProblem(s),
        needed: !!s.settings.enabled || !!s.artIssue || Object.values(s.art ?? {}).some(e => e.look && (!e.hash || e.requested)) },
    },
    art: artHashes(s),
    judge: { available: s.actors.some(a => a.active && a.profileJudge?.available), mode: s.settings.deciders?.combat?.decider ?? 'judge' },
  }
}

import { createHash } from 'node:crypto'
import { unlocked, syncActors, parseSettings, ROLES, CLASSES, stats, advance, addQuest, cancelQuest, closedQuest, livelihood } from './rules.mjs'
import { QUEST_TYPES } from '../../shared/rpg-systems.mjs'
import { queueArt, artProblem, checkGameArt } from './game-art.mjs'
import { applyManagement } from './management.mjs'
import { createReplays } from './replay.mjs'
import { createStore } from './store.mjs'
import { viewOf } from './view.mjs'
import { createAssets } from './assets.mjs'
import { createCombat } from './combat.mjs'
import { createPending, pausePending } from './pending.mjs'
import { lifeAction, constructionQuote, advanceLife } from './life.mjs'
import { LIFE_INPUT } from '../../shared/life.mjs'
import { syncProfileStatuses, driftStatuses } from '../../shared/agents.mjs'
import { configureAgents, setResidentStatuses, setRelationship, socialAction, answerRequest, expireRequests, cancelRequest } from './social.mjs'
import { villageAction } from './agent-actions.mjs'
const AGENT_COMMAND_LIMIT = 512, AGENT_COMMAND_TTL = 24 * 60 * 60_000
const agentFingerprint = (kind, profileId, input) => JSON.stringify([kind, profileId,
  ...(kind === 'social' ? ['id', 'target', 'item', 'amount', 'kind', 'place', 'detail'] : ['action', 'item', 'amount', 'npcId', 'recipeId', 'place']).map(k => input[k] ?? null)])

/**
 * withContext(owner, input, personal) adds the shared world lore and, when `personal` is a memory key, that memory: a
 * resident's own, or the village DM's (`dmKey`, kept apart from the same profile's resident memory).
 * Resident decisions never route to a proxy profile.
 */
export function createRpg(conai, { random = Math.random, onEvent = () => {}, withContext = (_owner, input) => input, judgeView = async () => ({}) } = {}) {
  const db = conai.db, ticking = new Set(), replays = createReplays(db), lifeTicks = new Map(), artChecks = new Map()
  let catalog = { at: -Infinity, list: [] }
  const profilesNow = async now => {
    if (now - catalog.at > 15_000) catalog = { at: now, list: await conai.llm.profiles().catch(() => catalog.list) }
    return catalog.list
  }
  /** The host's app-wide lore selection limit, read with the profile list (older hosts: no limit). */
  const loreLimit = () => catalog.list.find(p => Number.isInteger(p.loreSelectionLimit))?.loreSelectionLimit ?? Infinity
  const { read, write, sync } = createStore(db, replays, onEvent)
  const agentWrite = (owner, fn) => write(owner, fn, true, false)
  const configureAgentSettings = (owner, patch) => agentWrite(owner, s => configureAgents(s, patch))
  const statusSet = (owner, profileId, values) => agentWrite(owner, s => setResidentStatuses(s, profileId, values))
  const relationSet = (owner, from, to, affinity, label) => agentWrite(owner, s => setRelationship(s, from, to, affinity, label))
  const interact = (owner, from, input, requestId, now) => agentCommand(owner, requestId, agentFingerprint('social', from, input), now, s => socialAction(s, from, input, requestId, now))
  const replyRequest = (owner, id, profileId, answer, reason, now) => agentWrite(owner, s => answerRequest(s, id, profileId, answer, reason, now))
  const performVillage = (owner, profileId, input, requestId, now) => agentCommand(owner, requestId, agentFingerprint('village', profileId, input), now, s => villageAction(s, profileId, input, now))
  const requestCancel = (owner, id, reason, now) => agentWrite(owner, s => cancelRequest(s, id, reason, now))
  async function ensureArt(owner, now = Date.now(), force = false) {
    const s = read(owner), signature = JSON.stringify(s.settings.gameArt ?? null), previous = artChecks.get(owner)
    if (!force && previous?.signature === signature && now - previous.at < 60_000) return
    const epoch = s.life.epoch, revision = s.configRevision
    const result = await checkGameArt(conai, s.settings)
    write(owner, current => {
      if (current.life.epoch !== epoch || current.configRevision !== revision) return
      current.artService = result
      artChecks.set(owner, { signature, at: now })
    }, true, false)
  }
  // Only live timer samples are buffered. Five-second checkpoints avoid rewriting the full save at 2 Hz;
  // preserve each sample's clock/step so shifts, arrival and escrow consumption keep their original order.
  const checkpointLife = owner => {
    const clock = lifeTicks.get(owner)
    if (!clock?.samples.length) return
    write(owner, s => {
      for (const sample of clock.samples) {
        advanceLife(s, { running: true, clock: sample.clock }, sample.seconds, sample.at)
        const hours = Number.isFinite(s.agentClock) && Number.isFinite(sample.clock) ? Math.max(0, sample.clock - s.agentClock) / 60 : 0
        for (const a of s.actors) driftStatuses(s, a, hours, sample.sleeping?.includes(a.profileId))
        if (Number.isFinite(sample.clock)) s.agentClock = sample.clock
      }
    }, true, false)
    clock.samples = []; clock.seconds = 0
  }
  const assetStep = createAssets({ conai, read, write })
  const { combatStep, stopFights } = createCombat({ conai, read, write, withContext, judgeView })
  const { choose, runPending } = createPending({ conai, read, write, sync, withContext })
  /** `maps` is what the page already holds ({ zoneId: hash }); an unchanged floor map is not sent again. */
  function view(owner, residents, maps = null) {
    sync(owner, residents)
    agentWrite(owner, s => expireRequests(s, Date.now()))
    return viewOf(read(owner), maps)
  }
  async function cancel(owner) {
    checkpointLife(owner)
    lifeTicks.delete(owner)
    const pending = write(owner, s => { const p = s.pending; s.pending = null; return p })
    if (pending?.jobId) await conai.llm.cancel(pending.jobId).catch(() => {})
    await stopFights()
  }
  async function configure(owner, body, residents, profiles) {
    const pending = write(owner, s => {
      if (body.revision !== s.configRevision) throw new Error('RPG 설정이 바뀌었어. 다시 열어줘.')
      const settings = parseSettings(body.settings, s.settings, profiles)
      if (!Array.isArray(body.roles) || body.roles.length > 6) throw new Error('주민 역할을 확인해줘.')
      if (body.roles.filter(entry => entry?.role === 'oracle').length > 1) throw new Error('신관은 한 명만 둘 수 있어.')
      const seen = new Set()
      syncActors(s, residents)
      for (const entry of body.roles) {
        const actor = s.actors.find(a => a.active && a.profileId === entry.profileId)
        // Jobs come from the oracle now; an old `job` field is accepted and ignored.
        if (!actor || seen.has(entry.profileId) || !Object.hasOwn(ROLES, entry.role) || (entry.job !== undefined && !Object.hasOwn(CLASSES, entry.job))) throw new Error('주민 역할을 확인해줘.')
        seen.add(entry.profileId)
        if (actor.role !== entry.role && !['town', 'rest'].includes(actor.phase)) throw new Error('귀환한 주민의 역할만 바꿀 수 있어.')
        actor.role = entry.role; actor.hp = Math.min(actor.hp, stats(s, actor).hp); actor.mp = Math.min(actor.mp, stats(s, actor).mp)
      }
      s.settings = settings; s.configRevision++; s.error = null; s.dmRetryAt = 0; s.aiFailures = 0; s.aiPaused = false; s.artIssue = null
      for (const actor of s.actors) actor.oracleAt = 0
      const pending = s.pending; s.pending = null
      return pending
    })
    if (pending?.jobId) await conai.llm.cancel(pending.jobId).catch(() => {})
    if (!read(owner).settings.enabled) await stopFights()
    await ensureArt(owner, Date.now(), true)
  }
  function commission(owner, body, now) {
    if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(body.requestId)) throw new Error('의뢰 요청 ID가 필요해.')
    const fingerprint = createHash('sha256').update(JSON.stringify([body.title, body.note ?? '', body.zoneId, body.count, ...(body.type && body.type !== 'hunt' ? [body.type] : [])])).digest('hex')
    return command(owner, body.requestId, fingerprint, now, s => addQuest(s, body, now))
  }
  /** Retain the original commission window: 30 days, at most 10,000 live commands per slot.
   * Check an existing identity before cleanup; active-window retries can never be re-executed.
   */
  function migrateAgentCommands(owner, now) {
    if (read(owner).agentCommandsMigrated) return
    // 3.21 stored agent JSON fingerprints, whereas player commands have SHA-256 fingerprints.
    const where = `owner=? AND (fingerprint LIKE '["social",%' OR fingerprint LIKE '["village",%')`
    const rows = db.prepare(`SELECT request_id,fingerprint,at FROM rpg_commands WHERE ${where} ORDER BY at DESC LIMIT 512`).all(owner)
    agentWrite(owner, s => {
      s.agentCommands = rows.filter(r => r.at >= now - AGENT_COMMAND_TTL).reverse().map(r => {
        const [kind, profileId, input] = JSON.parse(r.fingerprint)
        return { id: r.request_id, fingerprint: agentFingerprint(kind, profileId, input), at: r.at }
      })
      s.agentCommandsMigrated = true
    })
    db.prepare(`DELETE FROM rpg_commands WHERE ${where}`).run(owner)
  }
  function agentCommand(owner, requestId, fingerprint, now, change) {
    return db.transaction(() => {
      migrateAgentCommands(owner, now)
      return agentWrite(owner, s => {
        const previous = s.agentCommands?.find(c => c.id === requestId)
        if (previous) { if (previous.fingerprint !== fingerprint) throw new Error('같은 요청 ID의 내용이 달라졌어.'); return { repeated: true } }
        const result = change(s)
        s.agentCommands = [...(s.agentCommands ?? []).filter(c => c.at >= now - AGENT_COMMAND_TTL).slice(-(AGENT_COMMAND_LIMIT - 1)), { id: requestId, fingerprint, at: now }]
        return result
      })
    })()
  }
  function command(owner, requestId, fingerprint, now, change, captureReplay = true) {
    return db.transaction(() => {
      migrateAgentCommands(owner, now)
      const previous = db.prepare('SELECT fingerprint FROM rpg_commands WHERE owner=? AND request_id=?').get(owner, requestId)
      if (previous) { if (previous.fingerprint !== fingerprint) throw new Error('같은 요청 ID의 내용이 달라졌어.'); return { repeated: true } }
      db.prepare('DELETE FROM rpg_commands WHERE owner=? AND at<?').run(owner, now - 30 * 86_400_000)
      if (db.prepare('SELECT COUNT(*) AS n FROM rpg_commands WHERE owner=?').get(owner).n >= 10_000) throw new Error('최근 30일 요청 기록이 10,000개야. 기록이 만료된 뒤 새 요청을 해줘.')
      const result = write(owner, change, false, captureReplay)
      db.prepare('INSERT INTO rpg_commands VALUES(?,?,?,?)').run(owner, requestId, fingerprint, now)
      return result
    })()
  }
  /** Same transaction/retention as commissions. UI retries reuse an ID within the documented 30-day window. */
  function lifeCommand(owner, body, now) {
    if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_:-]{16,160}$/.test(body.requestId)) throw new Error('생활 요청 ID가 필요해.')
    const fields = Object.keys(LIFE_INPUT.properties).filter(k => k !== 'requestId')
    const fingerprint = createHash('sha256').update(JSON.stringify(['life', ...fields.map(k => body[k] ?? null)])).digest('hex')
    checkpointLife(owner) // cancellation/refunds cannot skip already sampled work between checkpoints
    return command(owner, body.requestId, fingerprint, now, s => lifeAction(s, body, now), false)
  }
  async function tick(owner, world, now, hooks = {}) {
    if (ticking.has(owner)) return
    ticking.add(owner)
    try {
      sync(owner, world.residents)
      const obsolete = read(owner).obsoleteJobId
      if (obsolete) { await conai.llm.cancel(obsolete).catch(() => {}); write(owner, s => { s.obsoleteJobId = null }) }
      await ensureArt(owner, now)
      const settings = read(owner).settings
      const previousTick = lifeTicks.get(owner)
      if (!previousTick && world.running) lifeTicks.set(owner, { at: now, samples: [], seconds: 0 })
      if (previousTick && world.running) {
        const seconds = Math.min(5, Math.max(0, (now - previousTick.at) / 1000))
        previousTick.at = now
        if (seconds) { previousTick.samples.push({ seconds, clock: world.clock, at: now, sleeping: world.residents.filter(r => r.asleep || r.restPlan || (r.restUntil ?? 0) > now).map(r => r.profileId) }); previousTick.seconds += seconds }
        if (previousTick.seconds >= 5 || previousTick.samples.length >= 10 || (read(owner).pending?.nextAt ?? Infinity) <= now) checkpointLife(owner)
      }
      // Direct requests continue while the village sleeps; the normal queue still obeys the daily art budget.
      write(owner, s => { if (s.art && Object.values(s.art).some(e => e.direct)) queueArt(s, s.settings, now) }, true, false)
      await assetStep(owner, now, world.running && !artProblem(read(owner)))
      if (!world.running) { checkpointLife(owner); lifeTicks.delete(owner); return }
      const resting = hooks.resting ?? new Set()
      const profileList = await profilesNow(now)
      write(owner, s => {
        expireRequests(s, now)
        pausePending(s, !!world.memoryBacklogged, now)
        if (!Number.isFinite(s.agentClock) && Number.isFinite(world.clock)) s.agentClock = world.clock
        for (const a of s.actors) syncProfileStatuses(s, a, profileList.find(p => p.id === a.profileId))
        livelihood(s, world, now)
        if (s.settings.enabled) advance(s, now, random, { atGate: hooks.atGate })
        for (const zone of s.zones) if (s.settings.enabled && !world.memoryBacklogged && s.life.buildings.some(b => b.role === 'guild') && unlocked(s, zone) && !s.quests.some(q => q.zoneId === zone.id && q.source === 'guild' && !closedQuest(q)) && s.quests.filter(q => !closedQuest(q)).length < 20) {
          const completed = s.quests.filter(q => q.zoneId === zone.id && q.source === 'guild' && q.status === 'completed').length
          const type = zone.cleared ? ['hunt', 'explore', 'survey', 'recover'][completed % 4] : 'clear'
          const quest = addQuest(s, { title: `${zone.floor}층 ${QUEST_TYPES[type]}`, type, note: '', zoneId: zone.id, count: type === 'explore' ? 60 : type === 'recover' ? 2 : type === 'hunt' ? 3 : 1 }, now); quest.source = 'guild'
        }
        queueArt(s, s.settings, now)
      }, true)
      if (read(owner).settings.enabled) await combatStep(owner, world, now)
      sync(owner, world.residents)
      if (world.memoryBacklogged) return
      if (!world.running) return
      if (read(owner).pending) { await runPending(owner, world, now, resting); return }
      let current = read(owner)
      // Legacy global pauses no longer block unrelated operations.
      if (current.aiPaused) { write(owner, s => { s.aiPaused = false; s.aiFailures = 0; s.nextAiAt = 0 }); current = read(owner) }
      if (current.nextAiAt > now) return
      // Check the current profile catalog before either a new AI decision or a DM request.
      const profiles = await conai.llm.profiles().catch(() => [])
      if (!world.running) return
      choose(owner, world, now, profiles, resting, hooks)
      await runPending(owner, world, now, resting)
    } finally { ticking.delete(owner) }
  }
  const retry = owner => write(owner, s => {
    if (s.pending) return
    s.aiPaused = false; s.aiFailures = 0; s.error = null; s.nextAiAt = 0; s.dmRetryAt = 0
    s.operationFailures = {}
    for (const actor of s.actors) { actor.combatRetry = null; if (actor.phase === 'town') actor.readyAt = 0 }
  })
  const cancelCommission = (owner, questId, now) => write(owner, s => cancelQuest(s, questId, now))
  /** Whether a profile was usable at the last catalog check (errands use it to send residents to the priest). */
  const available = profileId => catalog.list.some(p => p.id === profileId)
  /** A fresh guild for a new or reset save slot that keeps `source`'s guild settings and residents' roles, nothing of its progress. */
  const seed = (owner, source, residents) => write(owner, s => {
    s.settings = structuredClone(source.settings); s.configRevision = source.configRevision + 1
    syncActors(s, residents)
    for (const actor of s.actors) actor.role = source.actors.find(a => a.profileId === actor.profileId)?.role ?? actor.role
  })
  /**
   * The world the DM set up with the player: that DM runs the guild, adventure follows the choice, and a first floor
   * takes cosmetic edits even after entry. Geometry, stats, exploration and combat progress stay intact.
   */
  const setupWorld = (owner, dmProfileId, adventure, residents) => write(owner, s => {
    s.settings.dmProfileId = dmProfileId; s.settings.enabled = adventure.enabled; s.configRevision++
    syncActors(s, residents)
    const first = s.zones[0]
    if (!adventure.enabled) return '던전 모험 끄기 · 기존 층 데이터는 유지했어.'
    if (!first) throw new Error('첫 층을 찾을 수 없어.')
    const fields = { name: adventure.floorName, theme: adventure.theme, monster: adventure.monster, monsterLook: adventure.monsterLook, bossLook: adventure.bossLook, sceneryLook: adventure.sceneryLook }
    const edits = Object.fromEntries(Object.entries(fields).filter(([, value]) => value))
    if (Object.keys(edits).length) applyManagement(s, { type: 'edit-floor', zoneId: first.id, ...edits }, Date.now())
    return '첫 층의 이름·테마·몬스터·외형을 적용했어. 이미 탐험한 지도·전투 능력치·진척은 유지했어.'
  })
  /** The player's wish for the next floor the DM designs, or adventure switched on/off from the DM conversation. */
  const setWish = (owner, text) => write(owner, s => { s.dmWish = text })
  const setEnabled = (owner, enabled, residents) => write(owner, s => { s.settings.enabled = enabled; s.configRevision++; syncActors(s, residents) })
  /** The village has one DM: the one the player talks with also designs the floors and describes the pictures. */
  const setDm = (owner, profileId) => write(owner, s => { if (s.settings.dmProfileId !== profileId) { s.settings.dmProfileId = profileId; s.configRevision++; s.dmRetryAt = 0 } })
  const lifeQuote = (owner, input) => constructionQuote(read(owner), input)
  function manage(owner, action, requestId, now) {
    const fingerprint = createHash('sha256').update(JSON.stringify(action)).digest('hex')
    return command(owner, requestId, fingerprint, now, s => applyManagement(s, action, now))
  }
  return { profilesNow, loreLimit, view, read, sync, configure, commission, cancelCommission, cancel, tick, retry, replays, available, seed, setupWorld, setWish, setEnabled, setDm, lifeCommand, lifeQuote, manage, ensureArt, checkpointLife,
    agentWrite, configureAgentSettings, statusSet, relationSet, interact, replyRequest, performVillage, requestCancel }
}

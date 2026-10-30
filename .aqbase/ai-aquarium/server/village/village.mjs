import { endConversation, busy, step, bindGeometry } from './world.mjs'
import { sleepy } from '../../shared/clock.mjs'
import { createGallery } from './gallery.mjs'
import { createMemory, line, dmKey } from '../memory/memory.mjs'
import { createRpg } from '../rpg/rpg.mjs'
import { BUBBLE_MS, HIGHLIGHT_MS } from './constants.mjs'
import { createStore } from './store.mjs'
import { createTalk } from './talk.mjs'
import { createMemoryPass } from './memory-pass.mjs'
import { createBroadcastChat } from './broadcast-chat.mjs'
import { createErrands } from './errands.mjs'
import { createRequests } from './requests.mjs'
import { createSlots } from './slots.mjs'
import { createSetup, memoryKeysOf } from './setup.mjs'
import { createResearch } from '../research/research.mjs'
import { createAgents } from './agents.mjs'
import { cancelAndWait, waitForCancellations } from '../llm-jobs.mjs'
import { judgeView } from './decider.mjs'

// Dungeon moments worth a neighbour's reaction, by weight: deaths and clears outrank quests, ranks, loot and stairs.
const HIGHLIGHTS = [[/ 사망 · /, 3], [/공략 완료/, 3], [/ 완료 \+\d+G/, 2], [/ 랭크 승급/, 2], [/ 획득$/, 1], [/ → \d+층 /, 1]]

/**
 * The village lives in the server module, not the page: one timer advances the world of the account that timer
 * calls run as (`conai.background.account()`), whether or not anyone is watching. Pages only read and configure.
 * Residents speak through native profile rooms; the aquarium supplies only current context and unseen memories.
 */
export function createVillage(conai, { random = Math.random } = {}) {
  const store = createStore(conai.db), { load, save, record, event } = store
  const research = createResearch(conai, store, { summaryProfile: owner => rpg.read(owner).settings.dmProfileId || null })
  const gallery = createGallery(conai, { albumOf: owner => slots.albumOf(owner) }), highlights = new Map()
  const memory = createMemory(conai, { clock: owner => load(owner).clock, loreLimit: () => rpg.loreLimit() })
  let background = { owner: undefined, at: -Infinity }, ticking = false
  const view = (owner, profileId, situation, options) => judgeView({ rpg, memory }, owner, profileId, situation, options)
  // A room's standing instructions (scene, allowed acts, tool format, looks) ride on each of its replies as system
  // instructions instead of being stored in every turn of its history; set when a turn is built or resubmitted.
  const roomInstructions = new Map()
  conai.hooks.on('chat.instructions', ({ instructions, threadId }) => {
    const extra = threadId ? roomInstructions.get(threadId) : null
    return extra ? `${instructions}\n\n${extra}` : instructions
  })

  const rpg = createRpg(conai, { random, judgeView: view, withContext: (owner, input, personal, purpose = 'decision') => memory.decorate(owner, input, personal, { purpose, settings: load(owner).settings }), onEvent: (owner, entry, actor) => {
    if (entry.quiet) return // per-turn combat lines stay in the broadcast; they are not village news or memories
    event(owner, actor ? { profileId: actor.profileId, name: actor.name } : null, entry.text, entry.at)
    if (entry.oracle && actor) {
      const o = entry.oracle, world = load(owner), speaker = world.residents.find(r => r.profileId === o.profileId)
      record(owner, 'say', `oracle:${entry.at}:${entry.id}`, o.profileId, o.name, actor.name, o.say, entry.at, o)
      memory.remember(owner, [o.profileId, actor.profileId], line(entry.at, '신전', `${o.name} → ${actor.name}: "${o.say}"`), entry.at, { text: o.displaySay ? line(entry.at, '신전', `${o.name} → ${actor.name}: "${o.displaySay}"`) : null, language: o.language, displayLanguage: o.displayLanguage })
      if (speaker) { speaker.bubble = o.displaySay ?? o.say; speaker.bubbleUntil = entry.at + BUBBLE_MS }
    }
    if (actor) memory.remember(owner, [actor.profileId], line(entry.at, '길드', entry.text), entry.at)
    const weight = actor && HIGHLIGHTS.find(([pattern]) => pattern.test(entry.text))?.[1]
    // The DM watches the dungeon: it remembers the floors it designed and the big moments, not every step.
    const dm = rpg.read(owner).settings.dmProfileId
    if (dm && entry.gmLife) memory.remember(owner, [dmKey(dm)], line(entry.at, '생활 세계', entry.text), entry.at)
    if (dm && (entry.dmDesign || weight)) memory.remember(owner, [dmKey(dm)], line(entry.at, '던전', entry.dmDesign ? `내가 설계한 층: ${entry.dmDesign}` : `${actor.name}: ${entry.text}`), entry.at)
    const previous = highlights.get(owner)
    if (weight && (!previous || weight >= previous.weight || entry.at - previous.at > HIGHLIGHT_MS)) highlights.set(owner, { profileId: actor.profileId, name: actor.name, text: entry.text, at: entry.at, weight })
  } })
  const slots = createSlots(conai.db) // after every village table exists

  /** The save slot the loop runs: the current slot of the account timer calls run as. */
  async function backgroundOwner(now) {
    if (now - background.at >= 10_000) {
      let account = null
      try { account = typeof conai.background?.account === 'function' ? await conai.background.account() : undefined } catch { account = null }
      background = { owner: account === undefined ? undefined : account ? String(account.id ?? 'bootstrap') : null, at: now }
    }
    return background.owner ? slots.active(background.owner) : background.owner
  }

  async function settle(world) {
    if (world.research?.owner) await research.cancel(world.research.owner, world)
    await agents.cancel(world)
    await talk.cancel(world)
    const p = world.pending, s = world.summary, j = world.sideJob
    world.pending = null; world.summary = null; world.sideJob = null
    endConversation(world, Date.now(), random)
    if (p?.jobId) await cancelAndWait(conai, p.jobId, world).then(job => memory.acceptProfileContext(world.residents.find(r => r.profileId === p.from), p, job))
    if (s?.jobId) await conai.llm.cancel(s.jobId).catch(() => {})
    if (j?.jobId) await cancelAndWait(conai, j.jobId, world).then(job => memory.acceptProfileContext(world.residents.find(r => r.profileId === j.from), j, job))
    if (j?.selection?.jobId) await conai.llm.cancel(j.selection.jobId).catch(() => {})
    for (const queued of world.sideWaiting ?? []) if (queued.selection?.jobId) await conai.llm.cancel(queued.selection.jobId).catch(() => {})
    for (const [key, parked] of Object.entries(world.memoryParked ?? {})) if (parked.jobId) {
      delete world.memoryParked[key]
      await conai.llm.cancel(parked.jobId).catch(() => {})
    }
    await waitForCancellations(world)
  }

  const parts = { conai, random, store, rpg, memory, gallery, highlights, slots, judgeView: view, roomInstructions }
  const talk = createTalk(parts), { streamOf } = talk
  const agents = createAgents(parts, talk)
  const remember = createMemoryPass(parts)
  const side = createBroadcastChat(parts, { streamOf })
  const { errands, passTime } = createErrands(parts)

  /** One step of the always-on loop. Movement is rule based; only conversation turns and memory summaries call the model. */
  async function tick(now = Date.now()) {
    if (ticking) return
    ticking = true
    try {
      const owner = await backgroundOwner(now)
      if (!owner) return
      const world = load(owner)
      for (const id of world.obsoleteTalkJobs ?? []) await conai.llm.cancel(id).catch(() => {})
      delete world.obsoleteTalkJobs
      if (world.research?.status === 'running') {
        const account = await conai.background.account()
        if (account) await research.tick(owner, world, String(account.id ?? 'bootstrap'), now)
      }
      bindGeometry(world, rpg.read(owner).life)
      world.memoryBacklogged = world.running && memory.backlogged(owner, memoryKeysOf(rpg, owner, world))
      // Walking comes first, before any awaited model call, so a slow host never stalls the village.
      if (world.running) {
        const seconds = world.lastTick ? Math.max(0, (now - world.lastTick) / 1000) : 0
        world.lastTick = now
        passTime(owner, world, seconds, now)
        errands(owner, world, now, rpg.read(owner))
        step(world, Math.min(5, seconds))
      }
      // Pictures can finish after the village falls asleep, so the album follows up either way.
      await gallery.step(owner, now,
        (r, count) => event(owner, r, `${josa(r.name, '이', '가')} 그림 ${count}장을 마을 앨범에 걸었어`, now),
        r => event(owner, r, `${r.name}의 그림이 완성되지 못했어`, now))
      {
        // An expedition starts once the resident has walked out of the village; nobody heads out from bed.
        await rpg.tick(owner, world, now, {
          atGate: actor => { const r = world.residents.find(r => r.profileId === actor.profileId); return !r || r.gate === actor.expedition?.id },
          atShrine: actor => { const r = world.residents.find(r => r.profileId === actor.profileId); return !r || (r.errand === 'oracle' && !r.path.length) },
          resting: new Set(world.residents.filter(r => busy(world, r) || r.agentJob || r.intention || (r.restUntil ?? 0) > now || r.asleep).map(r => r.profileId)),
        })
        bindGeometry(world, rpg.read(owner).life)
      }
      if (!world.running) { if (world.pending || world.summary?.jobId || world.sideJob) { await settle(world); save(owner, world) } return }
      if (!world.memoryBacklogged) await side(owner, world, now)
      await remember(owner, world, now) // memory-pass owns the single world.summary job; dialogue cannot starve it.
      talk.tick(owner, world, now)
      await agents.step(owner, world, now)
      save(owner, world)
    } finally { ticking = false }
  }

  /** Resolves between two loop steps, so a slot's rows can be replaced without a running step saving over them. */
  const idle = async () => { while (ticking) await new Promise(resolve => setTimeout(resolve, 20)) }
  const setup = createSetup({ conai, store, memory, rpg, slots })
  const dispatch = createRequests({ ...parts, slots, setup, research, backgroundOwner, settle, idle })
  return { tick, dispatch }
}

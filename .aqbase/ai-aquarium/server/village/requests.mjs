import { randomUUID } from 'node:crypto'
import { resident, arrange, normalize, bindGeometry } from './world.mjs'
import { LIFE_INPUT } from '../../shared/life.mjs'
import { keyOf, SLOT_LIMIT } from './slots.mjs'
import { ACTION_RANGE, WALK_RANGE, DEFAULT_SETTINGS, REPLY_LENGTHS, replyLengthOf, replyTimeoutMinutesOf } from '../../shared/village-settings.mjs'
import { budgetText } from '../llm-budget.mjs'
import { clockOf, DAY_LENGTHS } from '../../shared/clock.mjs'
import { onDuty, shiftsOf } from '../../shared/schedule.mjs'
import { hasFacility } from '../../shared/rpg-systems.mjs'
import { parseResidentInstructions } from '../../shared/resident-instructions.mjs'
import { POSTS, ERRAND_TEXT } from './constants.mjs'
import { josa, dayOf } from './text.mjs'
import { postOf } from './errands.mjs'
import { dmOf, memoryKeysOf } from './setup.mjs'
import { dmKey, line } from '../memory/memory.mjs'
import { agentSettings, definitionsFor, syncProfileStatuses } from '../../shared/agents.mjs'
import { decisionLogOf, safeDecisionText } from '../../shared/decision-log.mjs'

// Viewer chat on the broadcast: a short line, a few waiting at once, not too fast.
const VIEWER_MAX = 200
const VIEWER_QUEUE = 3
const VIEWER_GAP_MS = 4_000

/** The page's requests and the assistant tools; every op reads or configures the calling account's own village. */
export function createRequests({ conai, store, rpg, memory, gallery, highlights, slots, setup, research, backgroundOwner, settle, idle }) {
  const { ownerOf, load, save, forget, history, record, event } = store
  const refreshProfiles = (owner, world, profiles) => {
    rpg.sync(owner, world.residents)
    rpg.agentWrite(owner, s => { for (const a of s.actors.filter(a => a.active)) syncProfileStatuses(s, a, profiles.find(p => p.id === a.profileId)) })
    return profiles
  }
  const saveOf = owner => { const s = slots.ofKey(owner); return { id: s.id, name: s.name, createdAt: s.createdAt } }
  /** The account's save slots with a short summary of each village. */
  const savesOf = account => {
    const activeId = slots.activeId(account)
    return slots.rows(account).map(s => {
      const world = load(keyOf(account, s.id))
      return { id: s.id, name: s.name, createdAt: s.createdAt, playedAt: s.playedAt, active: s.id === activeId, running: !!world.running,
        residents: world.residents.map(r => ({ profileId: r.profileId, name: r.name, color: r.color })), day: clockOf(world.clock).day }
    })
  }
  /** A village that keeps `source`'s residents, their instructions and its settings, and nothing that happened there. */
  const freshFrom = (source, revision, now) => {
    const world = normalize(null)
    world.revision = revision; world.settings = structuredClone(source.settings)
    world.residents = source.residents.map((r, i) => ({ ...resident({ id: r.profileId, name: r.name }, i, now), color: r.color, instructions: r.instructions ?? '' }))
    arrange(world)
    return world
  }
  /** Same as the pause request: stops the village and cancels its replies, DM requests and fights. */
  async function sleep(owner, world, now) {
    await research.cancel(owner, world)
    await rpg.cancel(owner)
    if (world.running || world.pending || world.summary?.jobId) {
      world.running = false
      await settle(world)
      event(owner, null, '마을이 잠들었어', now); save(owner, world)
    }
  }
  const dropCaches = owner => { forget(owner); rpg.replays.drop(owner); highlights.delete(owner) }
  const view = async (owner, world, after, now, bgOwner, maps) => {
    const researchView = await research.view(owner, world)
    if (!store.isCurrent(owner, world)) throw new Error('마을이 변경됐어. 새로 확인해줘.')
    const game = rpg.view(owner, world.residents, maps)
    const rawGame = rpg.read(owner), daily = rawGame.agentDaily?.day === new Date(now).toISOString().slice(0, 10) ? rawGame.agentDaily : {}
    bindGeometry(world, rpg.read(owner).life)
    const memoryBacklogged = memory.backlogged(owner, memoryKeysOf(rpg, owner, world))
    return ({
    revision: world.revision, now, research: researchView,
    residents: world.residents.map(r => {
      const actor = game.actors.find(a => a.profileId === r.profileId)
      // A plaza sleeper stays on the map; the inn's guests are inside.
      const away = game.settings.enabled && !!actor && !!r.away, asleep = !away && !!r.asleep, rough = asleep && r.lodging === 'rough', hidden = away || (asleep && !rough)
      const destination = asleep ? rough ? '광장에서 노숙 중' : '여관에서 자는 중' : away ? ({ dead: '사망 · 부활 대기', travel: '던전 입장', explore: '던전 탐험', consider: '탐험 판단 중', combat: '전투 중', return: '귀환 중' })[actor.phase] ?? '던전' : r.errand ? ERRAND_TEXT[r.errand] ?? r.destination : r.posted && actor && POSTS[actor.role] ? `${POSTS[actor.role]} 근무 중` : r.destination
      return ({ profileId: r.profileId, name: r.name, color: r.color, x: r.x, y: r.y, destination, away, asleep, rough, errand: r.errand || '',
      goal: safeDecisionText(r.goal ?? actor?.goal ?? ''), statuses: actor?.statuses ?? {}, statusDefs: actor ? definitionsFor({ settings: game.settings }, actor) : [],
      agentError: r.agentError ?? null, combatError: actor?.combatError ?? null, agentReadyAt: r.nextAt, agentRoute: away ? actor?.agentRoute ?? null : r.agentRoute ?? actor?.agentRoute ?? null,
      agentBudgetText: budgetText(r.agentBudgetDiagnostic), combatBudgetText: budgetText(actor?.budgetDiagnostic),
      budgetRemaining: ['village', 'social', 'combat'].map(category => {
        const d = game.settings.deciders[category], b = actor?.agentBudget?.[category]
        const hourly = b?.hour === Math.floor(world.clock / 60) ? b.count : 0
        const remaining = (cap, used) => cap == null ? `무제한 (사용 ${used})` : `${Math.max(0, cap - used)}/${cap}`
        return `${({ village: '일상·요청 판단', social: '대화·방송·신탁', combat: '전투·탐사' })[category]} UTC 하루 ${remaining(d.maxCallsPerDay, daily[category] ?? 0)} · 마을 시간당 ${remaining(d.maxCallsPerHour, hourly)}`
      }).join(' / '),
      budgetRetries: r.agentJob?.attempts ?? r.agentFailures ?? 0,
      agentRoutes: { village: r.agentRoute ?? null, rpg: actor?.agentRoute ?? null },
      decisionLog: decisionLogOf(r, 5, true),
      judge: actor?.profileJudge ?? null, profileEngine: actor?.profileEngine ?? null,
      instructions: r.instructions ?? '',
      activity: hidden ? 'idle' : r.activity, moving: !hidden && r.path.length > 0, path: hidden ? [] : r.path.slice(0, 12).map(p => ({ x: p.x, y: p.y })), bubble: !hidden && r.bubbleUntil > now && !(researchView?.redacted && researchView.profileIds.includes(r.profileId)) ? r.bubble : '' }) }),
    clock: clockOf(world.clock),
    settings: { ...DEFAULT_SETTINGS, ...world.settings, ...agentSettings(game.settings) }, running: world.running, canRun: owner === bgOwner,
    agentSettingsRevision: game.configRevision,
    statuses: { definitions: game.settings.statusDefs, residents: game.actors.map(a => ({ profileId: a.profileId, values: a.statuses ?? {}, definitions: definitionsFor({ settings: game.settings }, a) })) },
    relationships: rpg.read(owner).relationships ?? [], pendingRequests: (rpg.read(owner).socialRequests ?? []).slice(-100),
    conversations: (world.conversations ?? []).map(c => ({ id: c.id, participants: c.participants, speaker: c.speaker, turn: c.turn, maxTurns: game.settings.conversationMaxTurns, nextAt: c.nextAt, thinking: !!c.pending || !!c.nextChoice, lines: c.lines })),
    actionCatalog: game.settings.actionCatalog, deciders: game.settings.deciders, agentDaily: rpg.read(owner).agentDaily ?? null,
    thinking: world.pending ? { from: world.pending.from, to: world.pending.to } : null,
    chat: { replying: world.sideJob ? { kind: world.sideJob.kind, from: world.sideJob.from } : null,
      waiting: [...(world.side ?? []).map(t => t.profileId), ...(world.sideWaiting ?? []).map(t => t.from)] },
    today: world.daily?.day === dayOf(now) ? world.daily.count : 0,
    save: saveOf(owner), setup: setup.brief(world),
    error: world.error || (memoryBacklogged ? '기억을 먼저 정리하고 있어. 새 주민 판단·대화는 기다려. 이미 정한 이동·휴식·생산은 계속되고 원문은 보존 중이야.' : null), memoryError: world.memoryError ?? null, memoryBudget: world.memoryBudget ?? null, memoryBacklogged, logs: history(owner, after), gallery: gallery.info(owner), rpg: game,
  }) }
  const integer = (value, min, max, label) => {
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label}: ${min}–${max} 사이 정수를 써줘.`)
    return value
  }

  async function dispatch(body, account) {
    const accountKey = ownerOf(account), owner = slots.active(accountKey), op = body?.op, now = Date.now()
    const bgOwner = await backgroundOwner(now)
    const world = load(owner), after = Number.isSafeInteger(body?.after) ? body.after : 0
    bindGeometry(world, rpg.read(owner).life)
    if (op === 'profiles') return refreshProfiles(owner, world, await conai.llm.profiles())
    const maps = body?.maps && typeof body.maps === 'object' ? body.maps : null
    if (op === 'agent-state') return view(owner, world, after, now, bgOwner, maps)
    if (['agent-configure', 'resident-status-set', 'relationship-set', 'request-cancel', 'combat-notice-dismiss', 'resident-decisions'].includes(op) &&
      (body.saveId !== slots.activeId(accountKey) || owner !== slots.active(accountKey))) throw new Error('세이브 슬롯이 바뀌었어. 현재 마을을 다시 확인해줘.')
    if (op === 'resident-decisions') {
      const resident = world.residents.find(r => r.profileId === body.profileId)
      if (!resident) throw new Error('마을에 없는 주민이야.')
      return { profileId: resident.profileId, entries: decisionLogOf(resident) }
    }
    if (op === 'combat-notice-dismiss') {
      rpg.agentWrite(owner, s => { if (s.combatMigrationNotice) s.combatMigrationNotice.dismissed = true })
      return view(owner, world, after, now, bgOwner, maps)
    }
    if (op === 'request-cancel') {
      rpg.requestCancel(owner, body.requestId, body.reason, now)
      return view(owner, world, after, now, bgOwner, maps)
    }
    if (op === 'agent-configure') {
      if (body.revision !== rpg.read(owner).configRevision) throw new Error('AI 행동 설정이 바뀌었어. 다시 확인해줘.')
      rpg.configureAgentSettings(owner, body.settings ?? {})
      world.revision++; save(owner, world)
      return view(owner, world, after, now, bgOwner, maps)
    }
    if (op === 'resident-status-set') {
      rpg.statusSet(owner, body.profileId, body.values)
      return view(owner, world, after, now, bgOwner, maps)
    }
    if (op === 'relationship-set') {
      rpg.relationSet(owner, body.from, body.to, body.affinity, body.label)
      return view(owner, world, after, now, bgOwner, maps)
    }
    if (op === 'research-start') {
      if (body.saveId !== slots.activeId(accountKey)) throw new Error('세이브 슬롯이 바뀌었어. 현재 마을을 다시 확인해줘.')
      if (owner !== bgOwner) throw new Error('조사는 상시 구동 계정의 현재 마을에서만 시작할 수 있어.')
      await research.start(owner, world, body, accountKey)
      return view(owner, world, after, now, bgOwner, maps)
    }
    if (op === 'research-cancel') {
      if (world.research?.activityId !== body.activityId) throw new Error('조사 활동이 변경됐어.')
      await research.cancel(owner, world)
      return view(owner, world, after, now, bgOwner, maps)
    }
    if (op === 'research-status' || op === 'research-draft') {
      if (op === 'research-draft' && world.research?.activityId !== body.activityId) throw new Error('조사 활동이 변경됐어.')
      return { research: await research.view(owner, world) }
    }
    // Save slots. A request that changes which village is shown answers with its whole recent log and every map.
    const shown = async key => ({ ...await view(key, load(key), 0, now, await backgroundOwner(now), null), saves: savesOf(accountKey), slotLimit: SLOT_LIMIT })
    const listed = async () => ({ ...await view(owner, world, after, now, bgOwner, maps), saves: savesOf(accountKey), slotLimit: SLOT_LIMIT })
    if (op === 'saves') return listed()
    if (op === 'save-rename') { slots.rename(accountKey, body.id, body.name); return listed() }
    // Setting up the world with a DM; every answer carries the whole conversation and draft.
    const withSetup = async () => ({ ...await view(owner, world, after, now, bgOwner, maps), setupDetail: setup.full(world) })
    // One village DM: the conversation follows the guild's DM setting before anything reads or talks to it.
    if (['setup', 'state', 'setup-say', 'setup-retry', 'dm-apply', 'dm-dismiss', 'setup-apply'].includes(op) && await setup.follow(owner, world)) save(owner, world)
    if (op === 'setup') { await rpg.ensureArt(owner, now); if (await setup.poll(owner, world, now)) save(owner, world); return withSetup() }
    if (op === 'setup-open') { await setup.open(owner, world, body.dmProfileId, now); save(owner, world); return withSetup() }
    if (op === 'setup-say') { await setup.say(owner, world, body.text, now); save(owner, world); return withSetup() }
    if (op === 'setup-retry') { await setup.retry(owner, world, now); save(owner, world); return withSetup() }
    if (op === 'dm-apply') { await rpg.ensureArt(owner, now, true); setup.applyProposal(owner, accountKey, world, body.messageId, now); save(owner, world); return withSetup() }
    if (op === 'dm-dismiss') { setup.dismiss(owner, world, body.messageId); save(owner, world); return withSetup() }
    if (op === 'setup-apply') {
      await rpg.ensureArt(owner, now, true)
      setup.apply(owner, accountKey, world, now)
      event(owner, null, `GM ${josa(world.setup.dm.name, '과', '와')} 세계 「${slots.ofKey(owner).name}」의 문을 열었어`, now); save(owner, world)
      return withSetup()
    }
    if (op === 'save-switch') {
      const id = slots.need(accountKey, body.id).id
      if (id !== slots.activeId(accountKey)) { await setup.cancel(world); await sleep(owner, world, now); slots.select(accountKey, id, now) }
      return shown(slots.active(accountKey))
    }
    if (op === 'save-create') {
      if (!['empty', 'copy'].includes(body.mode)) throw new Error('새 슬롯을 비울지, 지금 설정을 가져올지 골라줘.')
      const id = slots.create(accountKey, body.name, now), key = keyOf(accountKey, id)
      await setup.cancel(world)
      await sleep(owner, world, now)
      dropCaches(key)
      if (body.mode === 'copy') {
        save(key, freshFrom(world, 0, now))
        slots.copyWorldBook(owner, key)
        rpg.seed(key, rpg.read(owner), load(key).residents)
      }
      slots.select(accountKey, id, now)
      event(key, null, body.mode === 'copy' ? '지금 마을의 설정으로 새 마을을 시작했어' : '새 마을이 생겼어', now)
      return shown(key)
    }
    if (op === 'save-reset') {
      const slot = slots.current(accountKey)
      if (typeof body.name !== 'string' || body.name.trim() !== slot.name) throw new Error('확인용으로 지금 슬롯 이름을 그대로 써줘.')
      await setup.cancel(world)
      await sleep(owner, world, now)
      await idle()
      const game = rpg.read(owner)
      await conai.llm.forgetRooms({ roomKey: slots.roomKey(owner) })
      slots.wipe(owner, true); dropCaches(owner)
      save(owner, freshFrom(world, world.revision + 1, now))
      rpg.seed(owner, game, load(owner).residents)
      slots.restarted(accountKey, slot.id, now)
      event(owner, null, '마을을 처음부터 다시 시작했어', now)
      return shown(owner)
    }
    if (op === 'save-delete') {
      const key = keyOf(accountKey, slots.need(accountKey, body.id).id)
      if (key === owner) throw new Error('지금 쓰는 슬롯은 지울 수 없어. 다른 슬롯으로 바꾼 뒤 지워줘.')
      await idle()
      await settle(load(key))
      await conai.llm.forgetRooms({ roomKey: slots.roomKey(key) })
      slots.remove(accountKey, body.id); dropCaches(key)
      return listed()
    }
    if (op === 'state') { if (await setup.poll(owner, world, now)) save(owner, world); return view(owner, world, after, now, bgOwner, maps) }
    if (op === 'rpg-state') return rpg.view(owner, world.residents, maps)
    if (op === 'life-quote' || op === 'life-action') {
      if (body.saveId !== undefined && body.saveId !== slots.activeId(accountKey)) throw new Error('세이브 슬롯이 바뀌었어. 현재 마을을 다시 확인해줘.')
      rpg.sync(owner, world.residents)
      if (op === 'life-quote') return { quote: rpg.lifeQuote(owner, body) }
      const result = rpg.lifeCommand(owner, body, now)
      bindGeometry(world, rpg.read(owner).life); save(owner, world)
      return { ...await view(owner, world, after, now, bgOwner, maps), lifeResult: result }
    }
    if (op === 'replays') return rpg.replays.list(owner)
    if (op === 'replay') return rpg.replays.get(owner, body.id)
    if (op === 'viewer-say') {
      if (memory.backlogged(owner, memoryKeysOf(rpg, owner, world))) throw new Error('기억 정리가 밀려서 새 대화를 잠시 쉬고 있어. 기억 보기에서 상태를 확인해줘.')
      if (bgOwner === undefined || owner !== bgOwner || !world.running) throw new Error('마을이 깨어 있을 때만 채팅할 수 있어.')
      const r = world.residents.find(r => r.profileId === body.profileId)
      if (!r) throw new Error('마을에 없는 주민이야.')
      const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : ''
      if (!text || text.length > VIEWER_MAX) throw new Error(`채팅은 1–${VIEWER_MAX}자로 써줘.`)
      world.side ??= []
      if (world.side.length + (world.sideWaiting?.length ?? 0) + Number(!!world.sideJob) >= VIEWER_QUEUE) throw new Error('답장을 기다리는 채팅이 많아. 조금 뒤에 써줘.')
      if (now - (world.viewerAt ?? 0) < VIEWER_GAP_MS) throw new Error('채팅이 너무 빨라. 잠깐 뒤에 써줘.')
      const id = randomUUID()
      world.viewerAt = now; world.side.push({ id, profileId: r.profileId, text, at: now })
      record(owner, 'viewer', `viewer:${id}`, 0, '시청자', r.name, text, now)
      save(owner, world)
      return view(owner, world, after, now, bgOwner, maps)
    }
    if (op === 'rpg-retry') { rpg.retry(owner); return view(owner, world, after, now, bgOwner, maps) }
    if (op === 'rpg-configure') {
      const profiles = await conai.llm.profiles()
      await rpg.configure(owner, body, world.residents, profiles)
      if (await setup.follow(owner, world)) save(owner, world) // the guild's DM is the conversation's DM too
      {
        await settle(world)
        const game = rpg.read(owner), { actors, settings } = game, shifts = shiftsOf(settings)
        for (const r of world.residents) {
          const role = actors.find(a => a.profileId === r.profileId)?.role
          r.posted = !!POSTS[role] && hasFacility(game, role) && onDuty(shifts, role, world.clock)
          if (r.posted) { const post = postOf(world, r, role); Object.assign(r, { x: post.x, y: post.y, path: [], asleep: false, lodging: '', errand: '', activity: 'idle' }) }
        }
        arrange(world); save(owner, world)
      }
      return view(owner, world, after, now, bgOwner, maps)
    }
    if (op === 'rpg-commission') { rpg.commission(owner, body, now); return view(owner, world, after, now, bgOwner, maps) }
    if (op === 'rpg-commission-cancel') { rpg.cancelCommission(owner, body.questId, now); return view(owner, world, after, now, bgOwner, maps) }
    // A memory is a resident's (its profile id) or the village DM's (the negative of the DM's profile id).
    const dm = dmOf(rpg, owner, world)
    const memoryOwner = id => world.residents.find(r => r.profileId === id) ?? (dm && id === dmKey(dm.id) ? { profileId: id, name: `${dm.name} (GM)` } : null)
    if (op === 'memory') {
      const r = memoryOwner(body.profileId)
      if (!r) throw new Error('마을에 없는 주민이야.')
      return { profileId: r.profileId, name: r.name, ...memory.view(owner, r.profileId) }
    }
    if (['lore-list', 'lore-get', 'lore-save', 'lore-delete', 'memory-events'].includes(op)) {
      const id = body.profileId
      if (id !== 0 && !memoryOwner(id)) throw new Error('마을에 없는 주민이야. 세계관은 profileId 0, GM은 GM 프로필 ID의 음수로 열어줘.')
      if (id) memory.view(owner, id) // lazy, one-time import of the old summary
      if (op === 'memory-events') return memory.events(owner, id, body)
      if (op === 'lore-list') return memory.lore.list(owner, id, body)
      if (op === 'lore-get') return memory.lore.get(owner, id, body.id)
      if (op === 'lore-save') return memory.lore.put(owner, id, body.entry, now)
      memory.lore.remove(owner, id, body.id, body.revision)
      return { deleted: true }
    }
    if (op === 'configure') {
      if (body.revision !== world.revision) throw new Error('다른 창에서 설정이 바뀌었어. 새로 확인한 뒤 적용해줘.')
      if (!Array.isArray(body.profileIds) || body.profileIds.length > 6 || body.profileIds.some(id => !Number.isSafeInteger(id))) throw new Error('주민은 최대 6명까지 고를 수 있어.')
      const ids = [...new Set(body.profileIds)], profiles = await conai.llm.profiles()
      if (body.revision !== world.revision) throw new Error('다른 창에서 설정이 바뀌었어. 새로 확인한 뒤 적용해줘.')
      if (ids.some(id => !profiles.some(p => p.id === id))) throw new Error('사용할 수 없는 프로필이 포함됐어. 목록을 다시 불러와줘.')
      const instructions = new Map(parseResidentInstructions(body.residentInstructions, ids).map(r => [r.profileId, r.instructions]))
      const scene = String(body.scene ?? '').trim()
      if (!scene || scene.length > 500) throw new Error('마을 상황을 1–500자로 써줘.')
      const actionMin = integer(body.actionMin, ACTION_RANGE.min, ACTION_RANGE.max, '행동 간격')
      const actionMax = integer(body.actionMax, ACTION_RANGE.min, ACTION_RANGE.max, '행동 간격')
      if (actionMin > actionMax) throw new Error('행동 간격의 최소가 최대보다 클 수 없어.')
      let walkSpeed = world.settings.walkSpeed ?? DEFAULT_SETTINGS.walkSpeed, wander = world.settings.wander ?? DEFAULT_SETTINGS.wander
      if (body.walkSpeed !== undefined) {
        if (typeof body.walkSpeed !== 'number' || !Number.isFinite(body.walkSpeed) || body.walkSpeed < WALK_RANGE.min || body.walkSpeed > WALK_RANGE.max) throw new Error(`걷는 속도: ${WALK_RANGE.min}–${WALK_RANGE.max} 사이로 써줘.`)
        walkSpeed = Math.round(body.walkSpeed * 10) / 10
      }
      if (body.wander !== undefined) { if (typeof body.wander !== 'boolean') throw new Error('어슬렁 설정을 확인해줘.'); wander = body.wander }
      let dayMinutes = world.settings.dayMinutes ?? DEFAULT_SETTINGS.dayMinutes, sleep = world.settings.sleep ?? DEFAULT_SETTINGS.sleep
      if (body.dayMinutes !== undefined) { if (!DAY_LENGTHS.includes(body.dayMinutes)) throw new Error(`하루 길이는 ${DAY_LENGTHS.join(', ')}분 중에서 골라줘.`); dayMinutes = body.dayMinutes }
      if (body.sleep !== undefined) { if (typeof body.sleep !== 'boolean') throw new Error('밤 설정을 확인해줘.'); sleep = body.sleep }
      let replyLength = replyLengthOf(world.settings) ?? 0
      if (body.replyLength !== undefined) { if (!REPLY_LENGTHS.includes(body.replyLength)) throw new Error(`AI 답변 한도는 ${REPLY_LENGTHS.join(', ')} 중에서 골라줘.`); replyLength = body.replyLength }
      const replyTimeoutMinutes = replyTimeoutMinutesOf(body.replyTimeoutMinutes === undefined ? world.settings : body)
      const before = new Set(world.residents.map(r => r.profileId))
      const agentPatch = Object.fromEntries(['statusDefs', 'actionCatalog', 'deciders', 'conversationMaxTurns', 'maxConversations'].filter(k => body[k] !== undefined).map(k => [k, body[k]]))
      if (Object.keys(agentPatch).length) agentSettings(rpg.read(owner).settings, agentPatch)
      await research.cancel(owner, world)
      await settle(world)
      if (body.revision !== world.revision) throw new Error('다른 창에서 설정이 바뀌었어. 새로 확인한 뒤 적용해줘.')
      if (Object.keys(agentPatch).length) rpg.configureAgentSettings(owner, agentPatch)
      world.settings = { scene, actionMin, actionMax, walkSpeed, wander, dayMinutes, sleep, replyLength, replyTimeoutMinutes }
      world.residents = ids.map((id, i) => { const p = profiles.find(p => p.id === id), previous = world.residents.find(r => r.profileId === id); return { ...(previous ?? resident(p, i, now)), name: p.name, instructions: instructions.get(id) ?? previous?.instructions ?? '' } })
      refreshProfiles(owner, world, profiles)
      arrange(world)
      const dmNow = dmOf(rpg, owner, world)
      for (const r of world.residents) if (!before.has(r.profileId)) {
        event(owner, r, `${josa(r.name, '이', '가')} 마을에 왔어`, now)
        if (dmNow) memory.remember(owner, [dmKey(dmNow.id)], line(now, '마을', `${josa(r.name, '이', '가')} 마을에 새로 왔어`), now)
      }
      world.revision++; world.error = null; save(owner, world)
      return view(owner, world, after, now, bgOwner, maps)
    }
    if (op === 'start') {
      if (bgOwner === undefined) throw new Error('상시 구동을 지원하는 최신 CoNAI로 업데이트해줘.')
      if (owner !== bgOwner) throw new Error('상시 구동은 플러그인을 켠 관리자 계정의 마을만 할 수 있어.')
      if (!world.residents.length) throw new Error('주민을 먼저 초대해줘.')
      const profiles = await conai.llm.profiles()
      if (world.residents.some(r => !profiles.some(p => p.id === r.profileId))) throw new Error('꺼졌거나 권한이 바뀐 주민이 있어. 설정을 다시 적용해줘.')
      if (!world.running) {
        Object.assign(world, { running: true, runId: randomUUID(), seq: 0, lastTick: now, error: null, failures: 0, talkReadyAt: 0, summary: null })
        slots.touch(accountKey, slots.activeId(accountKey), now)
        event(owner, null, '마을이 깨어났어', now); save(owner, world)
      }
      return view(owner, world, after, now, bgOwner, maps)
    }
    if (op === 'pause') {
      await sleep(owner, world, now)
      return view(owner, world, after, now, bgOwner, maps)
    }
    throw new Error('알 수 없는 마을 요청이야.')
  }

  conai.onRequest(({ body, account }) => dispatch(body, account))
  conai.tools.register({ name: 'research_status', description: 'Read current scoped research status; never starts model calls.', scope: 'read', inputSchema: { type: 'object', properties: {} }, handler: (_, context) => dispatch({ op: 'research-status' }, context.account) })
  conai.tools.register({ name: 'research_draft', description: 'Read an unverified posts-compatible research draft. Never saves or publishes.', scope: 'read', inputSchema: { type: 'object', properties: { activityId: { type: 'string' } }, required: ['activityId'] }, handler: (args, context) => dispatch({ ...args, op: 'research-draft' }, context.account) })
  conai.tools.register({ name: 'inspect', description: 'Read residents, individual statuses and definitions, goals, profile judge routes, relationships, consent requests, concurrent conversations, bounded action catalog and decider settings. Read-only; never starts model calls.', scope: 'read', inputSchema: { type: 'object', properties: {} }, handler: (_, context) => dispatch({ op: 'state' }, context.account) })
  conai.tools.register({
    name: 'lore',
    description: 'Read aquarium lore in the calling account. profileId 0 is the shared world book; a resident ID reads only that resident; ' +
      'the negative of the village GM\'s profile ID reads the GM\'s own lore. Paginated keyword search. Never starts model calls or writes.',
    scope: 'read',
    inputSchema: { type: 'object', properties: { profileId: { type: 'integer' }, query: { type: 'string', maxLength: 200 }, offset: { type: 'integer', minimum: 0, maximum: 500 } }, required: ['profileId'] },
    handler: (args, context) => dispatch({ ...args, op: 'lore-list' }, context.account),
  })
  conai.tools.register({ name: 'pause', description: 'Put your AI aquarium to sleep and cancel its current reply.', scope: 'organize', inputSchema: { type: 'object', properties: {} }, handler: (_, context) => dispatch({ op: 'pause' }, context.account) })
  conai.tools.register({ name: 'life_quote', description: 'Read the validated construction/upgrade/adjacent-expansion quote without reserving gold, materials or a site.', scope: 'read',
    inputSchema: { ...LIFE_INPUT, required: ['actorId', 'kind'] }, handler: (args, context) => dispatch({ ...args, op: 'life-quote' }, context.account) })
  return dispatch
}

import { cleanSpeech, OLD_TOOL_LINE } from '../../shared/speech.mjs'

/** A live channel's chat: its game log lines and the village talk that mentions it, oldest first. */
export function chatLines(ch, world, feed) {
  const lines = [], told = new Set(), colorOf = id => world.residents.find(r => r.profileId === id)?.color ?? '#b8b8a4'
  // Game lines also reach the village feed as news; show each once.
  if (ch.actor && world.rpg) for (const l of world.rpg.logs ?? []) if (l.actorId === ch.actor.id) told.add(`${l.at}:${l.text}`) && lines.push({ at: l.at, sys: true, text: l.text.startsWith(`${ch.name} · `) ? l.text.slice(ch.name.length + 3) : l.text, kind: /처치|완료|보상|획득|공략|\+\d+G/.test(l.text) ? 'win' : /피해|전투|사망|함정/.test(l.text) ? 'hit' : '' })
  for (const e of feed() ?? []) {
    if (e.kind === 'say' && (e.speaker === ch.id || e.recipient === ch.name || e.text.includes(ch.name))) lines.push({ at: e.at, who: e.name, color: colorOf(e.speaker), host: e.speaker === ch.id, to: e.recipient, text: cleanSpeech(e.display_text ?? e.text) })
    else if (e.kind === 'viewer' && e.recipient === ch.name) lines.push({ at: e.at, who: '시청자', viewer: true, text: e.text })
    else if (e.kind === 'react' && (e.recipient === ch.name || e.speaker === ch.id)) lines.push({ at: e.at, who: e.name, color: colorOf(e.speaker), to: e.speaker === ch.id ? `${e.recipient} 방송` : '', text: e.display_text ?? e.text })
    else if (e.kind === 'event' && e.text.includes(ch.name) && !OLD_TOOL_LINE.test(e.text) && !told.has(`${e.at}:${e.text}`)) lines.push({ at: e.at, sys: true, text: e.text.split('\n')[0], kind: '' })
  }
  const out = lines.sort((a, b) => a.at - b.at).slice(-40), chat = world.chat
  if (chat?.replying?.kind === 'viewer' && chat.replying.from === ch.id) out.push({ sys: true, kind: 'typing', text: `${ch.name} 답장 쓰는 중…` })
  else if (chat?.waiting?.includes(ch.id)) out.push({ sys: true, kind: 'typing', text: `${ch.name}에게 채팅 전달 중…` })
  return out
}
/** A replay's chat: the expedition log up to the playback time. */
export function replayLines(replay) {
  const d = replay.data, name = d.actor.name
  return d.logs.filter(l => l[0] <= replay.t).slice(-40).map(([at, text]) => ({ at, sys: true, text: text.startsWith(`${name} · `) ? text.slice(name.length + 3) : text, kind: /처치|완료|보상|획득|공략|\+\d+G/.test(text) ? 'win' : /피해|전투|사망|함정/.test(text) ? 'hit' : '' }))
}

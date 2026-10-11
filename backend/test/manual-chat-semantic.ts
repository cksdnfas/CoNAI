/**
 * Manual end-to-end check of chat text embeddings with the real EmbeddingGemma 2 worker (CPU).
 *
 *   AI_RUNTIME_DIR=<dir with state.json> RUNTIME_MODELS_DIR=<hf hub cache> npx tsx test/manual-chat-semantic.ts
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-chat-semantic-manual-'))
process.env.RUNTIME_BASE_PATH = root
for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
  process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
}

const LORE = [
  { keys: ['에르난', '왕국'], title: '에르난 왕국', content: '대륙 서쪽의 해양 왕국. 수도는 항구 도시 벨마르. 국왕 알렌 3세는 병약하고, 실권은 재상 오르윈이 쥐고 있다.' },
  { keys: ['벨마르', '항구'], title: '벨마르 항구', content: "에르난의 수도. 밤이면 밀수선이 드나들고, 동쪽 부두의 '녹슨 닻' 선술집이 정보상들의 집결지다." },
  { keys: ['오르윈', '재상'], title: '재상 오르윈', content: '냉정한 실권자. 마법을 혐오하며 마탑을 해체하려 한다. 왼손에 화상 흉터가 있다.' },
  { keys: ['마탑', '마법사'], title: '마탑', content: "왕국 북쪽 절벽 위의 마법사 조합. 금서 '별의 서'를 봉인하고 있다." },
  { keys: ['별의 서', '금서'], title: '별의 서', content: '하늘의 별자리를 바꿔 운명을 다시 쓰는 금지된 마법서. 읽은 자는 기억을 하나씩 잃는다.' },
  { keys: ['용병', '길드'], title: '용병 길드', content: '벨마르 서문 근처. 의뢰 게시판과 등급제(철·은·금). 길드장 바르크는 외팔이 드워프.' },
  { keys: ['역병'], title: '검은 역병', content: '3년 전 남부를 휩쓴 병. 피부에 검은 반점이 생긴다. 치료제는 북쪽 설원의 은빛 이끼.' },
  { keys: ['등불', '축제'], title: "축제 '등불의 밤'", content: '매년 늦가을 벨마르에서 열리는 축제. 바다에 등불을 띄워 망자를 기린다.' },
  { keys: ['스튜', '요리'], title: '요리', content: '주인공의 특기는 생선 스튜. 리아는 매운 음식을 좋아한다.' },
]
const EPISODES = [
  "주인공과 리아는 녹슨 닻 선술집에서 정보상 '쥐꼬리'를 만나 마탑으로 가는 비밀 통로 지도를 샀다. 대가로 은화 30닢을 냈다.",
  '용병 길드에서 은급 의뢰를 받아 설원으로 향했다. 눈보라 속에서 은빛 이끼를 찾았지만 늑대 무리에게 쫓겼다.',
  '등불의 밤 축제에서 리아가 아버지를 위해 등불을 띄우며 울었다. 주인공은 말없이 곁을 지켰다.',
  '오르윈의 병사들이 마탑 입구를 봉쇄했다. 주인공 일행은 절벽을 타고 우회하려다 리아가 발목을 다쳤다.',
  '주인공이 생선 스튜를 끓여 리아에게 먹였다. 리아는 너무 싱겁다며 고춧가루를 잔뜩 넣었다.',
  '하루 종일 걸어서 다음 마을에 도착했다. 별일은 없었다.',
]
const CASES: Array<[string, string[], number | null]> = [
  ['그 늙은 실권자 녀석이 또 마법사들을 압박한대. 우리도 조심해야겠어.', ['재상 오르윈', '마탑'], null],
  ['요즘 남쪽 마을 사람들 피부에 검은 점이 생긴다던데, 그 병 다시 도는 거 아냐?', ['검은 역병'], null],
  ['운명을 바꾸는 책이 있다는 소문 들었어? 대신 기억을 잃는다던데.', ['별의 서'], null],
  ['너 저번에 내 국에 빨간 가루 왕창 넣었잖아.', ['요리'], 4],
  ['발목은 이제 괜찮아? 절벽에서 다쳤던 거.', [], 3],
  ['하늘이 맑네. 산책이나 할까?', [], null],
  ['응, 그 얘기 더 해줘.', ['별의 서'], null],
]
/** What the character said before each case (the previous message of the exchange). */
const BEFORE = ['그러게.', '그러게.', '그러게.', '그러게.', '그러게.', '그러게.', '마탑에 봉인된 그 금서 말이야, 읽으면 기억을 잃는대.']

async function main() {
  const authModule = await import('../src/database/authDb')
  authModule.initializeAuthDb()
  const mainDb = await import('../src/database/init')
  await mainDb.initializeDatabase()
  const user = await import('../src/database/userSettingsDb')
  user.initializeUserSettingsDb()
  const db = user.getUserSettingsDb()

  const { settingsService } = await import('../src/services/settingsService')
  settingsService.updateEmbeddingSettings({ enabled: true })
  const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
  const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
  const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
  const { ChatGroupStore } = await import('../src/services/codex-chat/chatGroupStore')
  const { ChatLorebookStore } = await import('../src/services/codex-chat/chatLorebook')
  const { FileStoreService } = await import('../src/services/fileStoreService')
  const { searchStoredFiles } = await import('../src/services/fileStoreSearch')
  const { semanticIndexer } = await import('../src/services/embeddings/semanticIndex')
  const { semanticContextFor } = await import('../src/services/embeddings/chatSemantic')
  const { searchChatHistory } = await import('../src/services/codex-chat/chatHistorySearch')
  const { textWorker } = await import('../src/services/aiWorker/textEmbeddingService')
  const { vectorStore } = await import('../src/services/vectors/vectorStore')

  ExternalApiProvider.create({ provider_name: 'conn', display_name: 'Conn', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
  const book = ChatLorebookStore.create({ name: '설정', entries: LORE })
  const profile = ChatProfileStore.create({ name: '리아', engine: 'llm', providerName: 'conn', summaryEnabled: true, lorebookIds: [book.id] })
  const threadId = CodexChatStore.createThread(null, '모험', 'llm', profile.id)
  EPISODES.forEach((content, index) => db.prepare('INSERT INTO chat_summary_segments (thread_id, level, from_message_id, until_message_id, content) VALUES (?, 0, ?, ?, ?)').run(threadId, index * 10 + 1, index * 10 + 9, content))
  const kai = ChatProfileStore.create({ name: '카이', engine: 'llm', providerName: 'conn' })
  const room = ChatGroupStore.create(null, '방', [profile.id, kai.id], profile.id)
  const say = (id: number, role: 'user' | 'assistant', content: string) => CodexChatStore.addMessage({ thread_id: id, role, content, tool_calls: [], status: 'completed', error: null })
  for (const line of ['설원에서 늑대한테 쫓긴 거 기억나? 다신 눈밭엔 안 갈래.', '응, 은빛 이끼 캐다가 그랬지.', '오늘 장 보러 가자. 생선이 싸대.', '마탑 지도는 내 배낭에 있어.']) say(room, 'user', line)
  const owner = 'bootstrap'
  const minutes = FileStoreService.createFolder(owner, null, '회의록')
  FileStoreService.writeText(owner, minutes.id, '2026-10-01.md', `## 1–40 · 설원 원정\n${'용병 길드 의뢰로 설원에 가서 은빛 이끼를 채집했다. 늑대 무리의 습격을 피해 동굴에서 밤을 보냈다. '.repeat(30)}\n## 41–80 · 귀환\n벨마르로 돌아와 이끼를 약사에게 넘겼고 역병 환자들이 회복하기 시작했다.`)
  FileStoreService.writeText(owner, minutes.id, '2026-10-05.md', '## 1–20 · 축제 준비\n등불의 밤을 앞두고 항구가 붐볐다. 리아는 등불을 직접 만들었다.')
  FileStoreService.writeText(owner, null, '장보기.txt', '생선, 감자, 양파, 고춧가루')

  let t = Date.now()
  let rounds = 0
  while (await semanticIndexer.sweep() > 0) rounds += 1
  console.log(`indexed in ${Date.now() - t}ms over ${rounds} passes:`, ['chat-recall', 'chat-lore', 'chat-message', 'file'].map((space) => `${space}=${vectorStore.count(space)}`).join(' '))

  const titleOf = (key: string) => LORE.find((_, index) => key.includes(`:${ChatLorebookStore.find(book.id)!.entries[index]?.id}:`))?.title
  for (const [index, [text, wantLore, wantEpisode]] of CASES.entries()) {
    say(threadId, 'assistant', BEFORE[index])
    say(threadId, 'user', text)
    t = Date.now()
    const thread = CodexChatStore.findThreadById(threadId)!
    const semantic = await semanticContextFor({ profile, thread, messages: CodexChatStore.listMessages(threadId), judgeDecidesLore: false })
    const ms = Date.now() - t
    const segmentIds = (db.prepare('SELECT id FROM chat_summary_segments WHERE thread_id = ? ORDER BY id').all(threadId) as Array<{ id: number }>).map((row) => row.id)
    const recall = [...(semantic?.recall.keys() ?? [])].map((id) => segmentIds.indexOf(id))
    const lore = [...(semantic?.loreKeys ?? [])].map((key) => ChatLorebookStore.find(book.id)!.entries.find((entry) => key.startsWith(`${book.id}:${entry.id}:`))?.title)
    console.log(`${ms}ms | ${text.slice(0, 26)} | lore ${JSON.stringify(lore)} (want ${JSON.stringify(wantLore)}) | recall ${JSON.stringify(recall)} (want ${wantEpisode})`)
    const fmt = (values: Iterable<[unknown, number]>, name: (key: any) => unknown) => [...values].sort((a, b) => b[1] - a[1]).map(([key, score]) => `${name(key)}:${score.toFixed(3)}`).join(' ')
    console.log('   recall', fmt(semantic?.recallScores ?? [], (id: number) => segmentIds.indexOf(id)))
    console.log('   lore  ', fmt(semantic?.loreScores ?? [], (key: string) => ChatLorebookStore.find(book.id)!.entries.find((entry) => key.startsWith(`${book.id}:${entry.id}:`))?.title?.slice(0, 5)))
    void titleOf
  }

  t = Date.now()
  const history = await searchChatHistory([room], '추운 곳에서 짐승에게 쫓긴 일', 5)
  console.log(`history ${Date.now() - t}ms:`, history.map((hit) => hit.excerpt.slice(0, 30)))
  t = Date.now()
  const files = await searchStoredFiles(owner, '약초 채집 원정', 5, undefined, { semantic: true })
  console.log(`files ${Date.now() - t}ms:`, files.hits.map((hit) => `${hit.entry.name} … ${(hit.snippet ?? '').slice(0, 40)}`))
  const lexicalFiles = await searchStoredFiles(owner, '약초 채집 원정', 5)
  console.log('files (words only):', lexicalFiles.hits.length)

  console.log('worker', JSON.stringify(textWorker.status()))
  semanticIndexer.stop()
  await textWorker.stop()
}

main().then(() => process.exit(0), (error) => {
  console.error(error)
  process.exit(1)
})

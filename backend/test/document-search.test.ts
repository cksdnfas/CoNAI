import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/** Minimal PDF fixtures with real page streams and a cross-reference table. */
function pdf(pages: string[]) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  for (const text of pages) {
    const stream = `BT /F1 12 Tf 50 700 Td (${text}) Tj ET`
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`)
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`)
  }
  let body = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${object}\nendobj\n` })
  const start = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`
  return Buffer.from(body)
}

test('document retrieval: PDF/XLSX extraction, permissions, resumable chunks and session references', { timeout: 120000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-documents-'))
  process.env.RUNTIME_BASE_PATH = root
  for (const part of ['DATABASE', 'SAVE', 'MODELS', 'TEMP', 'UPLOADS', 'LOGS']) process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase())
  process.env.AI_RUNTIME_DIR = path.join(root, 'ai-runtime')
  const database = await import('../src/database/userSettingsDb')
  database.initializeUserSettingsDb()
  const { FileStoreService, fileOwnerKey } = await import('../src/services/fileStoreService')
  const { refreshFileSearchIndex, searchStoredFiles, retryFileSearchIndex, startFileSearchMaintenance, stopFileSearchMaintenance, queueFileSearchRefresh } = await import('../src/services/fileStoreSearch')
  const { extractDocument } = await import('../src/services/fileDocumentExtraction')
  const { settingsService } = await import('../src/services/settingsService')
  const embedding = await import('../src/services/aiWorker/textEmbeddingService')
  const { semanticIndexer } = await import('../src/services/embeddings/semanticIndex')
  const db = database.getUserSettingsDb()
  t.after(async () => {
    semanticIndexer.stop()
    database.closeUserSettingsDb()
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>(resolve => logger.close(resolve))
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('conai-documents-'))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3 })
  })
  const owner = fileOwnerKey(1)
  let serial = 0
  const upload = (name: string, bytes: Buffer, who = owner) => {
    const staged = path.join(root, `staged-${serial++}`)
    fs.writeFileSync(staged, bytes)
    return FileStoreService.upload(who, null, [{ originalname: name, path: staged, size: bytes.length, mimetype: 'application/octet-stream' } as Express.Multer.File])[0]
  }
  const document = upload('reference.pdf', pdf(['Harbour project', 'Needle on the second page']))
  const AdmZip = (await import('adm-zip')).default
  const workbook = new AdmZip()
  const files: Record<string, string> = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="예산" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:C2"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>항구 예산</t></is></c><c r="B1" t="inlineStr"><is><t>금액(원)</t></is></c></row><row r="2"><c r="B2"><v>1200</v></c><c r="C2"><f>B2*2</f><v>2400</v></c></row></sheetData></worksheet>',
  }
  for (const [name, text] of Object.entries(files)) workbook.addFile(name, Buffer.from(text))
  const book = upload('budget.xlsx', workbook.toBuffer())

  await t.test('real parsers preserve page, sheet, cell and cached formula values; read tools can paginate', async () => {
    await refreshFileSearchIndex(owner)
    const result = await searchStoredFiles(owner, 'Needle')
    assert.equal(result.hits[0].entry.id, document.id)
    assert.equal(result.hits[0].location, 'Page 2')
    const reference = result.hits[0].read!
    assert.equal(reference.source, 'extracted')
    assert.match((await FileStoreService.readText(owner, document.id, reference.offset, reference.limit, reference)).text, /Needle/)
    await assert.rejects(FileStoreService.readText(fileOwnerKey(2), document.id, reference.offset, reference.limit, reference))
    const excel = await FileStoreService.readText(owner, book.id)
    assert.equal(excel.extracted, true)
    assert.match(excel.text, /Sheet 예산/)
    assert.match(excel.text, /B2: 1200 \(top cells: B1=금액\(원\)\)/)
    assert.match(excel.text, /C2: 2400/)
    let text = '', offset = 0
    for (;;) {
      const part = await FileStoreService.readText(owner, book.id, offset, 11)
      text += part.text
      if (part.nextOffset === null) break
      offset = part.nextOffset
    }
    assert.equal(text, excel.text)
    assert.equal((await searchStoredFiles(fileOwnerKey(2), 'Needle')).hits.length, 0)
    await assert.rejects(FileStoreService.readText(fileOwnerKey(2), book.id))
    const { assertLinkedFiles } = await import('../src/services/codex-chat/chatLinkedFiles')
    assert.equal(assertLinkedFiles(owner, [{ id: document.id, write: false }, { id: book.id, write: false }]).length, 2)
  })

  await t.test('extracted HTML offsets address normalized text, and old references are refused after edits', async () => {
    const html = FileStoreService.writeText(owner, null, 'offset.html', '<script>ignore()</script><p>😀 항구 &amp; 예산</p>')
    await refreshFileSearchIndex(owner, html.id)
    const hit = (await searchStoredFiles(owner, '항구')).hits.find(hit => hit.entry.id === html.id)!
    assert.ok(hit.read)
    const read = await FileStoreService.readText(owner, html.id, hit.read.offset, hit.read.limit, hit.read)
    assert.match(read.text, /😀 항구 & 예산/)
    assert.doesNotMatch(read.text, /script|ignore/)
    FileStoreService.updateText(owner, html.id, '<p>😀 다른 &amp; 내용</p>')
    await assert.rejects(FileStoreService.readText(owner, html.id, hit.read.offset, hit.read.limit, hit.read), /다시 검색/)
  })

  await t.test('transient extraction errors back off, stop after three retries, and can be explicitly retried by the owner', async sub => {
    const file = FileStoreService.writeText(owner, null, 'retry.txt', 'retry content')
    const target = FileStoreService.resolveFile(owner, file.id).filePath
    const open = fs.promises.open.bind(fs.promises)
    let reads = 0
    let failing = true
    sub.mock.method(fs.promises, 'open', async (...args: Parameters<typeof fs.promises.open>) => {
      if (args[0] === target) { reads++; if (failing) throw new Error('temporary read failure') }
      return open(...args)
    })
    const status = () => db.prepare("SELECT extraction_state, retry_count, retry_after FROM search_db.search_documents WHERE source = 'file' AND source_id = ?").get(file.id) as { extraction_state: string; retry_count: number; retry_after: number | null }
    await refreshFileSearchIndex(owner, file.id)
    assert.equal(status().extraction_state, 'error')
    assert.ok(status().retry_after! > Date.now())
    await refreshFileSearchIndex(owner, file.id)
    assert.equal(reads, 1, 'a new search does not bypass the retry delay')
    for (let retry = 1; retry <= 3; retry++) {
      db.prepare("UPDATE search_db.search_documents SET retry_after = 0 WHERE source_id = ?").run(file.id)
      await refreshFileSearchIndex(owner, file.id)
      assert.equal(status().retry_count, retry)
    }
    assert.equal(status().retry_after, null)
    await refreshFileSearchIndex(owner, file.id)
    assert.equal(reads, 4)
    await assert.rejects(retryFileSearchIndex(fileOwnerKey(2), file.id))
    await assert.rejects(retryFileSearchIndex(owner, file.id), /잠시 뒤/)
    failing = false
    db.prepare("UPDATE search_db.search_documents SET last_attempt = 0 WHERE source_id = ?").run(file.id)
    await retryFileSearchIndex(owner, file.id)
    assert.equal(status().extraction_state, 'ready')
  })

  await t.test('a restart and immediate refresh preserve future extraction retries', async sub => {
    const file = FileStoreService.writeText(owner, null, 'scheduled-retry.txt', 'scheduled recovery')
    const target = FileStoreService.resolveFile(owner, file.id).filePath
    const open = fs.promises.open.bind(fs.promises)
    let failing = true
    sub.mock.method(fs.promises, 'open', async (...args: Parameters<typeof fs.promises.open>) => {
      if (args[0] === target && failing) throw new Error('temporary read failure')
      return open(...args)
    })
    await refreshFileSearchIndex(owner, file.id)
    stopFileSearchMaintenance()
    db.prepare("UPDATE search_db.search_documents SET retry_after = ? WHERE source_id = ?").run(Date.now() + 100, file.id)
    failing = false
    startFileSearchMaintenance()
    queueFileSearchRefresh(owner)
    const state = () => (db.prepare("SELECT extraction_state FROM search_db.search_documents WHERE source_id = ?").get(file.id) as { extraction_state: string }).extraction_state
    const deadline = Date.now() + 3000
    while (state() !== 'ready' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(state(), 'ready')
  })

  await t.test('loaded vector caches preserve other files, replace retried chunks and discard old revisions', async () => {
    const { vectorStore } = await import('../src/services/vectors/vectorStore')
    const write = (id: string, revision: string, chunk: number, axis: number) => vectorStore.appendFileBatch(id, 'cache-test', owner, revision,
      [{ chunk, vector: new Float32Array(axis === 0 ? [1, 0] : [0, 1]), start: chunk * 10, end: chunk * 10 + 10 }], { chunk: chunk + 1, offset: chunk * 10 + 10, complete: true })
    const search = () => vectorStore.search('file', 'cache-test', [1, 0])
    write('cache-a', 'v1', 0, 0)
    write('cache-b', 'v1', 0, 0)
    assert.equal(search().length, 2)
    write('cache-a', 'v1', 1, 0)
    assert.equal(search().length, 3)
    write('cache-a', 'v1', 1, 1)
    assert.equal(search().length, 3)
    assert.equal(search().find(hit => hit.sourceKey === 'cache-a' && hit.chunk === 1)?.score, 0)
    write('cache-a', 'v2', 0, 1)
    assert.equal(search().length, 2)
    assert.equal(search().find(hit => hit.sourceKey === 'cache-a')?.contentHash, 'v2')
    assert.equal(search().find(hit => hit.sourceKey === 'cache-b')?.score, 1)
    vectorStore.remove('file', 'cache-a')
    vectorStore.remove('file', 'cache-b')
  })

  await t.test('empty and damaged PDFs report extraction failure instead of claiming complete coverage', async () => {
    const blank = path.join(root, 'blank.pdf')
    fs.writeFileSync(blank, pdf(['']))
    assert.equal((await extractDocument(blank, 'blank.pdf')).state, 'empty')
    const broken = upload('broken.pdf', Buffer.from('not a PDF'))
    await refreshFileSearchIndex(owner)
    const result = await searchStoredFiles(owner, 'broken')
    assert.equal(result.hits[0].extractionState, 'error')
    assert.equal(result.search?.failedDocuments, 1)
    await assert.rejects(FileStoreService.readText(owner, broken.id), /extraction failed/)
  })

  embedding.embeddingRuntime.checkDependencies = async () => ({ available: true, message: 'ok', missingPackages: [], python: 'fake' })
  embedding.embeddingRuntime.isModelCached = () => true
  let fail = false
  t.mock.method(embedding.textWorker, 'request', async (op: string, payload: any) => {
    if (fail) throw new Error('worker unavailable')
    if (op === 'chunk') return { items: payload.texts.map((text: string) => {
      const length = Array.from(text).length
      return Array.from({ length: Math.min(Math.ceil(length / 448), payload.maxChunks) }, (_, i) => ({ start: i * 448, end: Math.min(length, i * 448 + 512) })).filter(span => span.end > span.start)
    }) }
    if (op === 'embed') return { device: 'cpu', items: payload.items.map((item: { text: string }) => {
      const vector = new Float32Array(embedding.EMBEDDING_DIM)
      vector[item.text.includes('deepneedle') ? 0 : 1] = 1
      return [{ start: 0, end: Array.from(item.text).length, vector: Buffer.from(vector.buffer).toString('base64') }]
    }) }
    throw new Error(`Unexpected operation: ${op}`)
  })
  const long = FileStoreService.writeText(owner, null, 'long.txt', '😀 quiet text '.repeat(3000) + 'deepneedle')
  settingsService.updateEmbeddingSettings({ enabled: true, fileSearch: true, chatRecall: false, lorebook: false, chatHistory: false, imageSearch: false })

  await t.test('long documents resume in batches beyond 32 chunks, preserve Unicode offsets, and report completeness', async () => {
    await refreshFileSearchIndex(owner)
    assert.equal((await searchStoredFiles(owner, 'deepneedle', 20, undefined, { semantic: true })).search?.semantic, 'not_indexed')
    await semanticIndexer.sweep()
    const progress = () => db.prepare('SELECT * FROM vector_db.file_progress WHERE source_key = ?').get(long.id) as { next_chunk: number; complete: number }
    for (let i = 0; i < 8 && !progress(); i++) await semanticIndexer.sweep()
    assert.equal(progress().next_chunk, 4)
    assert.equal(progress().complete, 0)
    for (let i = 0; i < 100; i++) { await semanticIndexer.sweep(); if (progress().complete) break }
    assert.equal(progress().complete, 1)
    assert.ok(progress().next_chunk > 32)
    const hit = (await searchStoredFiles(owner, 'deepneedle', 20, undefined, { semantic: true })).hits.find(hit => hit.entry.id === long.id)
    assert.match(hit?.snippet ?? '', /deepneedle/)
    const natural = await searchStoredFiles(owner, 'please find the archived old project note about deepneedle', 20, undefined, { semantic: true })
    assert.equal(natural.search?.keywordTermsLimited, true)
    const semanticHit = natural.hits.find(hit => hit.entry.id === long.id)!
    assert.ok(semanticHit.read!.offset > 16000)
    const passage = await FileStoreService.readText(owner, long.id, semanticHit.read!.offset, semanticHit.read!.limit, semanticHit.read)
    assert.match(passage.text, /deepneedle/)
    const last = db.prepare("SELECT span_end FROM vector_db.vectors WHERE space = 'file' AND source_key = ? ORDER BY chunk DESC LIMIT 1").get(long.id) as { span_end: number }
    assert.equal(last.span_end, Buffer.byteLength('😀 quiet text '.repeat(3000) + 'deepneedle'))
  })

  await t.test('same-size edits invalidate vectors; worker failure is explicit and keyword search survives', async () => {
    const before = db.prepare('SELECT revision FROM vector_db.file_progress WHERE source_key = ?').get(long.id) as { revision: string }
    FileStoreService.updateText(owner, long.id, '😀 quiet text '.repeat(3000) + 'otherword!')
    await refreshFileSearchIndex(owner)
    assert.equal((await searchStoredFiles(owner, 'deepneedle', 20, undefined, { semantic: true })).hits.some(hit => hit.entry.id === long.id), false)
    await semanticIndexer.sweep()
    const after = db.prepare('SELECT revision FROM vector_db.file_progress WHERE source_key = ?').get(long.id) as { revision: string }
    assert.notEqual(after.revision, before.revision)
    fail = true
    const result = await searchStoredFiles(owner, 'otherword!', 20, undefined, { semantic: true })
    assert.equal(result.search?.mode, 'keyword')
    assert.equal(result.search?.semantic, 'unavailable')
    assert.ok(result.hits.some(hit => hit.entry.id === long.id))
    fail = false
    embedding.resetEmbeddingBackoff()
  })

  await t.test('Claude and pi session builders consume semantic lore, and the common Codex path deduplicates recalled text', async () => {
    const { ExternalApiProvider } = await import('../src/models/ExternalApiProvider')
    const { ChatProfileStore } = await import('../src/services/codex-chat/chatProfiles')
    const { CodexChatStore } = await import('../src/services/codex-chat/codexChatStore')
    const { ChatLorebookStore } = await import('../src/services/codex-chat/chatLorebook')
    const { booksForRequest, keyedLoreEntries } = await import('../src/services/codex-chat/chatLoreContext')
    const { buildClaudeSessionTurn } = await import('../src/services/codex-chat/claudeChatSessions')
    const { prepareSessionLore } = await import('../src/services/codex-chat/chatSessionMemory')
    const { userPersonaForThread } = await import('../src/services/codex-chat/chatUserProfiles')
    ExternalApiProvider.create({ provider_name: 'docs-test', display_name: 'Test', provider_type: 'llm_openai_compatible', base_url: 'http://unused.invalid', is_enabled: true, additional_config: { default_model: 'm' } })
    const lorebook = ChatLorebookStore.create({ name: 'Facts', entries: [{ id: 'entry', keys: ['never-trigger'], title: 'Harbour fact', content: 'The harbour closes at dusk.' }] })
    for (const runtime of ['claude', 'pi'] as const) {
      const profile = ChatProfileStore.create({ name: runtime, engine: runtime === 'claude' ? 'claude' : 'llm', llmRuntime: runtime === 'pi' ? 'pi' : 'direct', providerName: 'docs-test', lorebookIds: [lorebook.id] })
      const id = CodexChatStore.createThread(null, runtime, 'llm', profile.id)
      const thread = CodexChatStore.findThreadById(id)!
      const key = keyedLoreEntries(booksForRequest({ thread, profile }))[0].key
      const context = { loreKeys: new Set<string>(), recallKeep: null, semantic: { recall: new Map<number, number>(), recallScores: new Map<number, number>(), loreScores: new Map<string, number>(), loreKeys: new Set([key]), messages: [{ id: 42, role: 'user', text: 'A remembered harbour visit.' }] } }
      const turn = await buildClaudeSessionTurn({ requester: { accountId: null, accountType: 'admin' }, threadId: id, profile, history: [], withTools: false, runtime, judged: context })
      assert.match(JSON.stringify(turn.messages), /harbour closes at dusk/)
      assert.match(JSON.stringify(turn.messages), /remembered harbour visit/)
      const first = await prepareSessionLore(thread, profile, [], new Set(), userPersonaForThread(thread), context)
      const second = await prepareSessionLore(thread, profile, [], new Set(first.keyedKeys), userPersonaForThread(thread), context)
      assert.doesNotMatch(second.keyed, /remembered harbour visit/)
      // Session engines with no CoNAI summaries can still recall their own stored messages.
      settingsService.updateEmbeddingSettings({ chatRecall: true, chatHistory: false })
      const { indexMessagesNow } = await import('../src/services/embeddings/semanticIndex')
      const { semanticContextFor } = await import('../src/services/embeddings/chatSemantic')
      for (const content of ['old deepneedle', 'unrelated', 'another', 'again', 'deepneedle', 'deepneedle']) {
        CodexChatStore.addMessage({ thread_id: id, role: 'user', content, tool_calls: [], status: 'completed', error: null })
      }
      await indexMessagesNow([id], 32)
      const history = CodexChatStore.listMessages(id)
      const automatic = await semanticContextFor({ thread, profile, messages: history, judgeDecidesLore: false })
      assert.ok(automatic?.messages?.some(message => message.text === 'old deepneedle'))
      const withoutOld = await semanticContextFor({ thread, profile, messages: history.slice(1), judgeDecidesLore: false })
      assert.equal(withoutOld?.messages?.some(message => message.text === 'old deepneedle'), false)
      const text = 'A'.repeat(24) + 'deepneedle' + 'Z'.repeat(24)
      const mid = CodexChatStore.addMessage({ thread_id: id, role: 'assistant', content: text, tool_calls: [], status: 'completed', error: null })
      await indexMessagesNow([id], 32)
      const { vectorStore } = await import('../src/services/vectors/vectorStore')
      const before = vectorStore.contentHash('chat-message', String(mid), embedding.EMBEDDING_MODEL_KEY)
      CodexChatStore.editAssistantMessage(id, mid, 'A'.repeat(24) + 'otherword!' + 'Z'.repeat(24))
      const { semanticIndexInternals } = await import('../src/services/embeddings/semanticIndex')
      assert.ok(semanticIndexInternals.pendingMessages(32, [id]).some(item => item.sourceKey === String(mid)))
      await indexMessagesNow([id], 32)
      assert.notEqual(vectorStore.contentHash('chat-message', String(mid), embedding.EMBEDDING_MODEL_KEY), before)
    }
  })
})

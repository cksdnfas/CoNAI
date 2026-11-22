import assert from 'node:assert/strict'
import test from 'node:test'
import { readMcpToolResult } from '../src/services/codex-chat/chatToolReferences'

const take = '0f8e7a6b-1c2d-4e3f-8a9b-0c1d2e3f4a5b'
const parent = '11111111-2222-4333-8444-555555555555'
const text = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })

test('audio workspace lookups attach the takes they name (candidate_id), not their parents', () => {
  const listed = readMcpToolResult(text({ total: 1, candidates: [{ candidate_id: take, parent_candidate_id: parent, name: 'hit' }] }), 'list_audio_candidates')
  assert.deepEqual(listed.audioCandidateIds, [take])
  assert.deepEqual(readMcpToolResult({ structuredContent: { candidate_id: take } }, 'get_audio_candidate').audioCandidateIds, [take])
  // Another tool's candidate_id is not an audio take.
  assert.deepEqual(readMcpToolResult(text({ candidate_id: take }), 'get_image_metadata').audioCandidateIds, [])
  // Destructive results carry counts only, so nothing removed comes back as a card.
  assert.deepEqual(readMcpToolResult(text({ deleted: 1 }), 'delete_audio_candidate').audioCandidateIds, [])
})

test('file-store lookups attach their audio files only', () => {
  const song = 'a'.repeat(32), picture = 'b'.repeat(32), folder = 'c'.repeat(32), unnamed = 'd'.repeat(32), privateUpload = 'e'.repeat(32)
  const entry = (id: string, name: string, mimeType: string | null, extra: Record<string, unknown> = {}) => ({ id, parentId: null, name, kind: 'file', mimeType, size: 10, ...extra })
  const search = { terms: ['x'], hits: [
    { entry: entry(song, 'theme.mp3', 'audio/mpeg'), path: '/', snippet: '' },
    { entry: entry(picture, 'cover.png', 'image/png'), path: '/', snippet: '' },
    { entry: entry(unnamed, 'voice.ogg', null), path: '/', snippet: '' },
    { entry: entry(privateUpload, 'mine.wav', 'audio/wav', { chatAttachment: true }), path: '/', snippet: '' },
  ] }
  assert.deepEqual(readMcpToolResult(text(search), 'search_files').audioFileIds.sort(), [song, unnamed])
  const listing = { entries: [{ ...entry(folder, 'sounds.wav', null), kind: 'folder' }, entry(song, 'theme.mp3', 'audio/mpeg')], breadcrumbs: [], total: 2 }
  assert.deepEqual(readMcpToolResult(text(listing), 'list_files').audioFileIds, [song])
  assert.deepEqual(readMcpToolResult(text(entry(song, 'theme.mp3', 'audio/mpeg')), 'get_file_info').audioFileIds, [song])
  // Other tools' ids are not file-store entries.
  assert.deepEqual(readMcpToolResult(text(entry(song, 'theme.mp3', 'audio/mpeg')), 'linked_list').audioFileIds, [])
})

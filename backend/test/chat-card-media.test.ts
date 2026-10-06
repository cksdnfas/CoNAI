import assert from 'node:assert/strict'
import { test } from 'node:test'
import sharp from 'sharp'
import { findMediaLinks, findMediaUrls, rewriteMediaLinks, sniffMediaExtension } from '../src/services/codex-chat/chatMediaLinks'

const HASH = 'a'.repeat(48)

test('card media: web images and videos are found in order of appearance, once each', () => {
  const urls = findMediaUrls([
    'intro <video autoplay loop><source src="https://cdn.example/clip.mp4" type="video/mp4"></video> then ![smile](https://x.example/a.png)',
    '<img src="https://x.example/b.webp" alt="b"> and again ![](https://x.example/a.png "title")',
  ])
  assert.deepEqual(urls, ['https://cdn.example/clip.mp4', 'https://x.example/a.png', 'https://x.example/b.webp'])
})

test('card media: saved links become markdown images of their library copies; a <video> element is replaced whole', () => {
  const saved = new Map([
    ['https://x.example/a.png', `media:${HASH}.png`],
    ['https://cdn.example/clip.mp4', `media:${HASH}.mp4`],
    ['https://x.example/b.webp', `media:${HASH}.webp`],
  ])
  const text = [
    '![long [alt] text](https://x.example/a.png)',
    '<video src="https://cdn.example/clip.mp4" title="dance" muted></video>',
    '<img alt="b [x]" src="https://x.example/b.webp">',
    '![kept](https://x.example/missing.png)',
  ].join('\n')
  assert.equal(rewriteMediaLinks(text, saved), [
    `![long [alt] text](media:${HASH}.png)`,
    `![dance](media:${HASH}.mp4)`,
    `![b  x](media:${HASH}.webp)`,
    '![kept](https://x.example/missing.png)',
  ].join('\n'))
})

test('card media: library links are listed by id with their extension', () => {
  const other = 'b'.repeat(32)
  assert.deepEqual(findMediaLinks([`![](media:${HASH}.gif) ![](media:${other}.mp4) ![](media:${HASH}.gif)`]), [
    { compositeHash: HASH, extension: 'gif' },
    { compositeHash: other, extension: 'mp4' },
  ])
})

test('card media: files are identified by content, not by their link', async () => {
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#f00' } }).png().toBuffer()
  assert.equal(await sniffMediaExtension(png), 'png')
  const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#0f0' } }).gif().toBuffer()
  assert.equal(await sniffMediaExtension(gif), 'gif')
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(16)])
  assert.equal(await sniffMediaExtension(mp4), 'mp4')
  const mov = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  '), Buffer.alloc(16)])
  assert.equal(await sniffMediaExtension(mov), 'mov')
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84]), Buffer.from('webm'), Buffer.alloc(16)])
  assert.equal(await sniffMediaExtension(webm), 'webm')
  await assert.rejects(sniffMediaExtension(Buffer.from('<html>not found</html>')), /not an image/)
})

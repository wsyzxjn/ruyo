import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer } from '@ruyojs/core'
import { youtubeAdapter } from '@ruyojs/youtube'
import { inspectLayout, sampleImage } from '../../../test/inspect-layout.mjs'

const id = 'aB3_-dEFg12'
const watch = 'https://www.youtube.com/watch?v=' + id
const shortsPage = 'https://www.youtube.com/shorts/' + id
const thumbnail = 'https://i.ytimg.com/test.jpg'
const maxres = 'https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg'
const portrait = 'https://i.ytimg.com/vi/' + id + '/oar2.jpg'
const video = { type: 'video', title: '一段足够长的视频标题，换行后仍然要显示完整', author_name: '频道 Name',
  thumbnail_url: thumbnail, width: 160, height: 90 }

function youtube(page, metadata, covers) {
  const calls = []
  return { calls, async fetch(input, init) {
    assert.equal(init.redirect, 'manual')
    calls.push(input)
    if (input.startsWith('https://i.ytimg.com/')) {
      assert.equal(init.headers.get('referer'), 'https://www.youtube.com/')
      return covers.includes(input) ? new Response(sampleImage) : new Response(null, { status: 404 })
    }
    const url = new URL(input)
    assert.equal(url.origin + url.pathname, 'https://www.youtube.com/oembed')
    assert.equal(url.searchParams.get('url'), page)
    assert.equal(url.searchParams.get('format'), 'json')
    return Response.json(metadata)
  } }
}

test('watch, mobile and short links use official oEmbed and the full-resolution cover', async () => {
  const host = youtube(watch, video, [maxres])
  for (const input of [watch + '&list=abc', 'https://m.youtube.com/watch?v=' + id, 'https://youtu.be/' + id + '?si=abc']) {
    const card = await youtubeAdapter.resolve(new URL(input), undefined, host)
    const { items, paragraphs } = await inspectLayout(youtubeAdapter, card, 160)
    const cover = items.find(item => item.kind === 'image')
    assert.deepEqual([cover.x, cover.y, cover.width, cover.height], [12, 12, 136, 77])
    const [title, channel] = items.filter(item => item.kind === 'text')
    assert.equal(paragraphs[title.id].runs[0].text, video.title)
    assert.equal(paragraphs[channel.id].runs[0].text, video.author_name)
    assert.ok(title.x === 12 && title.height > 24 && channel.y >= title.y + title.height)
  }
  assert.equal(host.calls.length, 6)
  for (const input of ['https://youtu.be/shortid', 'https://example.org/watch?v=' + id,
    'https://youtube.com/playlist?list=abc', 'https://youtube.com/@creator', 'https://youtu.be/' + id + '/extra'])
    assert.equal(youtubeAdapter.resolve(new URL(input)), undefined)
})

test('Shorts ask oEmbed about the Short and sit portrait in a square frame', async () => {
  const short = { ...video, width: 90, height: 160 }
  for (const covers of [[portrait], [thumbnail]]) {
    const host = youtube(shortsPage, short, covers)
    const card = await youtubeAdapter.resolve(new URL('https://youtube.com/shorts/' + id + '/?feature=share'), undefined, host)
    const { items } = await inspectLayout(youtubeAdapter, card, 160)
    assert.deepEqual(host.calls.slice(1), [portrait, ...(covers[0] === thumbnail ? [thumbnail] : [])])
    const frame = items.find(item => item.kind === 'rect')
    const cover = items.find(item => item.kind === 'image')
    assert.deepEqual([frame.x, frame.y, frame.width, frame.height], [12, 12, 136, 136])
    assert.equal(cover.height, 136)
    assert.ok(Math.abs(cover.width - 136 * 90 / 160) < 0.01 && Math.abs(cover.x + cover.width / 2 - 80) < 0.01)
  }
})

test('videos without a full-resolution frame fall back to the oEmbed thumbnail', async () => {
  const host = youtube(watch, video, [thumbnail])
  const card = await youtubeAdapter.resolve(new URL(watch), undefined, host)
  await inspectLayout(youtubeAdapter, card, 160)
  assert.deepEqual(host.calls.slice(1), [maxres, thumbnail])
})

test('reports upstream restrictions, missing videos, incomplete metadata and unreadable covers', async () => {
  const renderer = createRenderer({ adapters: [youtubeAdapter] })
  const render = fetch => renderer.render(watch, {}, { fetch })
  for (const [status, code] of [[401, 'ACCESS_RESTRICTED'], [404, 'NOT_FOUND']])
    await assert.rejects(render(async () => new Response(null, { status })), { code })
  await assert.rejects(render(async () => Response.json({ ...video, title: '' })), { code: 'UPSTREAM_ERROR' })
  await assert.rejects(render(async url => url.startsWith('https://i.ytimg.com/') ? new Response('broken') : Response.json(video)), { code: 'ASSET_ERROR' })
  await assert.rejects(render(async url => url.startsWith('https://i.ytimg.com/') ? new Response(null, { status: 404 }) : Response.json(video)), { code: 'ASSET_ERROR' })
})

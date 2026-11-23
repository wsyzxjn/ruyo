import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer } from '@ruyojs/core'
import { bilibiliAdapter } from '@ruyojs/bilibili'
import { inspectLayout, sampleImage } from '../../../test/inspect-layout.mjs'

const bvid = 'BV17x411w7KC'
const cover = 'https://i0.hdslb.com/cover.jpg'
const frame = 'https://i0.hdslb.com/part.jpg'
const video = {
  bvid, aid: 170001, title: '测试视频', pic: cover, duration: 3700, owner: { name: '作者' },
  pubdate: 1700000000, stat: { view: 12345, like: 0, reply: 12, coin: -1 },
  pages: [{ page: 1, part: '上篇', duration: 3600 }, { page: 2, part: '下篇', duration: 100, first_frame: frame }]
}
const render = createRenderer({ adapters: [bilibiliAdapter] }).render

test('BV, mobile av and b23.tv render the selected part through the supplied host', async () => {
  const short = 'https://b23.tv/foo'
  const bv = 'https://www.bilibili.com/video/' + bvid + '/?p=2'
  const av = 'https://m.bilibili.com/video/av170001?p=2'
  const calls = []
  const host = { async fetch(input, init) {
    calls.push(input)
    assert.equal(init.redirect, 'manual')
    if (input === short) return new Response(null, { status: 302, headers: { location: '/bar' } })
    if (input === 'https://b23.tv/bar') return Response.redirect(bv)
    if ([cover, frame].includes(input)) return new Response(sampleImage)
    const url = new URL(input)
    assert.equal(url.origin + url.pathname, 'https://api.bilibili.com/x/web-interface/view')
    assert.ok(['?bvid=' + bvid, '?aid=170001'].includes(url.search))
    return Response.json({ code: 0, data: video })
  } }
  const opts = { width: 160, dpr: 2 }
  const a = await render(bv, opts, host)
  const b = await render(av, opts, host)
  const s = await render(short, opts, host)
  assert.deepEqual(a.png, b.png)
  assert.deepEqual(a.png, s.png)
  assert.equal(a.width, 320)
  assert.ok(calls.includes('https://api.bilibili.com/x/web-interface/view?aid=170001'))
  assert.deepEqual(calls.slice(-4), [short, 'https://b23.tv/bar', 'https://api.bilibili.com/x/web-interface/view?bvid=' + bvid, frame])
  async function labels(url) {
    const card = await bilibiliAdapter.resolve(new URL(url), undefined, host)
    const { paragraphs } = await inspectLayout(bilibiliAdapter, card, 160)
    return paragraphs.flatMap(p => p.runs.map(r => r.text))
  }
  const selected = await labels(bv)
  for (const label of ['测试视频', '作者', '1:40', 'P2 · 下篇', '1.2万播放', '0', '12']) assert.ok(selected.includes(label), label)
  assert.ok(!selected.includes('-1'))
  assert.ok((await labels(bv.split('?')[0])).includes('1:01:40'))
  await assert.rejects(render(av.replace('p=2', 'p=3'), opts, host), { code: 'NOT_FOUND' })
})

test('a video dynamic retains its own caption and statistics and renders the embedded archive', async () => {
  const url = new URL('https://t.bilibili.com/123')
  const host = { async fetch(input) {
    if (input === cover) return new Response(sampleImage)
    assert.equal(new URL(input).pathname, '/x/polymer/web-dynamic/v1/detail')
    return Response.json({ code: 0, data: { item: { type: 'DYNAMIC_TYPE_AV', id_str: '123', modules: {
      module_author: { name: '动态作者' }, module_stat: { like: { count: 42 } },
      module_dynamic: { desc: { text: '动态里的文字' }, major: { type: 'MAJOR_TYPE_ARCHIVE',
        archive: { title: '视频标题', cover, duration_text: '02:10', stat: { play: '8.3万', danmaku: '12' } } } }
    } } } })
  } }
  const card = await bilibiliAdapter.resolve(url, undefined, host)
  const { items, paragraphs } = await inspectLayout(bilibiliAdapter, card, 480)
  const labels = items.filter(i => i.kind === 'text').flatMap(i => paragraphs[i.id].runs.map(r => r.text))
  assert.deepEqual(labels.filter(Boolean), ['动态作者', '动态里的文字', '02:10', '视频标题', '8.3万播放 · 12弹幕', '42'])
  assert.ok(items.some(i => i.kind === 'image' && i.src === cover))
})

test('short links stop at unsupported destinations and videos propagate platform errors', async () => {
  const calls = []
  await assert.rejects(render('https://b23.tv/test', {}, { async fetch(url) {
    calls.push(url)
    return Response.redirect('https://live.bilibili.com/123')
  } }), { code: 'UNSUPPORTED_URL' })
  assert.deepEqual(calls, ['https://b23.tv/test'])
  for (const [code, expected] of [[-352, 'ACCESS_RESTRICTED'], [-404, 'NOT_FOUND']])
    await assert.rejects(render('https://www.bilibili.com/video/' + bvid, {}, { fetch: async () => Response.json({ code }) }), { code: expected })
  assert.equal(bilibiliAdapter.resolve(new URL('https://www.bilibili.com/video/BVshort')), undefined)
})

import assert from 'node:assert/strict'
import { inspectLayout, sampleImage } from '../../../test/inspect-layout.mjs'
import { test } from 'node:test'
import { bilibiliAdapter } from '@ruyojs/bilibili'

test('renders visible interaction counts in toolbar order with Bilibili units', async () => {
  const url = new URL('https://t.bilibili.com/123')
  const modules = {
    module_author: { name: '作者' }, module_dynamic: { desc: { text: '正文' } },
    module_stat: {
      like: { count: 10000 }, coin: { count: 0 }, favorite: { count: '9999' },
      forward: { count: 12345 }, comment: { count: 100000000 }
    }
  }
  const host = { fetch: async () => Response.json({ code: 0, data: { item: {
    id_str: '123', type: 'DYNAMIC_TYPE_WORD', modules
  } } }) }
  const card = await bilibiliAdapter.resolve(url, undefined, host)
  for (const width of [708, 160]) {
    const { items, paragraphs } = await inspectLayout(bilibiliAdapter, card, width)
    const counts = items.filter(i => i.kind === 'text' && paragraphs[i.id].style.includes('font-size:12px'))
    assert.deepEqual(counts.map(i => paragraphs[i.id].runs[0].text), ['1.0万', '0', '9999', '1.2万', '1.0亿'])
    assert.ok(counts.every(i => i.x >= 0 && i.x + i.width <= width))
    assert.equal(new Set(counts.map(i => i.y)).size, width === 708 ? 1 : 3)
  }
  modules.module_stat = { like: { hidden: true, count: 100 }, forward: null, comment: { count: 0 } }
  const partial = await bilibiliAdapter.resolve(url, undefined, host)
  const { paragraphs } = await inspectLayout(bilibiliAdapter, partial, 708)
  assert.deepEqual(paragraphs.filter(p => p.style.includes('font-size:12px')).map(p => p.runs[0].text), ['0'])
})

test('resolves rich text, topic links and a long ID without rounding', async t => {
  const id = '1000000000000000001'
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(new URL(url).searchParams.get('id'), id)
    return Response.json({ code: 0, data: { item: { id_str: id, type: 'DYNAMIC_TYPE_WORD', modules: {
      module_author: { name: '测试', pub_time: '11月23日' },
      module_dynamic: { desc: { rich_text_nodes: [{ type: 'RICH_TEXT_NODE_TYPE_TOPIC', text: '#话题#' }] } }
    } } } })
  })
  assert.equal(bilibiliAdapter.resolve(new URL('https://x.com/example/status/123')), undefined)
  const card = await bilibiliAdapter.resolve(new URL('https://t.bilibili.com/' + id))
  const { paragraphs } = await inspectLayout(bilibiliAdapter, card, 480)
  assert.ok(paragraphs.some(p => p.runs.some(r => r.text === '#话题#' && r.style === 'color:#008ac5')))
  assert.equal(card.assets.size, 0)
})

test('requests the desktop cover crop and uses the original image if it is unavailable', async t => {
  const id = '1000000000000000002'
  const src = 'https://i0.hdslb.com/bfs/new_dyn/cover.jpg'
  const url = new URL('https://www.bilibili.com/opus/' + id)
  const crop = src + '@1416w_798h_1c.webp'
  const calls = []
  let status = 200
  t.mock.method(globalThis, 'fetch', async input => {
    if (new URL(input).hostname === 'api.bilibili.com') return Response.json({ code: 0, data: { item: {
      id_str: id, type: 'DYNAMIC_TYPE_DRAW', modules: { module_author: { name: '作者' },
        module_dynamic: { major: { type: 'MAJOR_TYPE_DRAW', draw: { items: [{ src, width: 900, height: 1200 }] } } } }
    } } })
    calls.push(input)
    return new Response(sampleImage, { status: input === crop ? status : 200 })
  })
  const primary = await bilibiliAdapter.resolve(url)
  assert.deepEqual(calls, [crop])
  const primaryImage = (await inspectLayout(bilibiliAdapter, primary, 708)).items.find(i => i.src === src)
  assert.equal(primaryImage.height, 399)
  assert.equal(primaryImage.paint.contain, true)
  status = 404
  const fallback = await bilibiliAdapter.resolve(url)
  assert.deepEqual(calls, [crop, crop, src])
  const fallbackImage = (await inspectLayout(bilibiliAdapter, fallback, 708)).items.find(i => i.src === src)
  assert.equal(fallbackImage.height, 399)
  assert.equal(fallbackImage.paint.contain, false)
})

test('album shows the first slide and fetches only the visible thumbnail strip', async t => {
  const id = '1000000000000000003'
  const pics = Array.from({ length: 12 }, (_, i) => ({ url: 'https://i1.hdslb.com/' + i + '.jpg', width: 720, height: 960 }))
  const requests = []
  t.mock.method(globalThis, 'fetch', async input => {
    if (new URL(input).hostname === 'api.bilibili.com') return Response.json({ code: 0, data: { item: {
      id_str: id, type: 'DYNAMIC_TYPE_DRAW', modules: { module_author: { name: '作者' }, module_dynamic: {
        major: { type: 'MAJOR_TYPE_OPUS', opus: { title: '标题', summary: { text: '正文' }, pics } } } }
    } } })
    requests.push(input)
    return new Response(sampleImage)
  })
  const card = await bilibiliAdapter.resolve(new URL('https://t.bilibili.com/' + id))
  assert.deepEqual(requests, pics.slice(0, 9).map(p => p.url))
  const { items, paragraphs } = await inspectLayout(bilibiliAdapter, card, 708)
  assert.equal(items.filter(i => i.src === pics[0].url).length, 2)
  const top = value => items.find(i => i.kind === 'text' && paragraphs[i.id].runs[0]?.text === value).y
  assert.ok(top('标题') < top('作者') && top('作者') < top('正文'))
  assert.equal(bilibiliAdapter.maxWidth, 708)
})

import assert from 'node:assert/strict'
import { inspectLayout, sampleImage } from '../../../test/inspect-layout.mjs'
import { test } from 'node:test'
import { xAdapter } from '@ruyo/x'

const id = '9007199254740993123'
const xUrl = 'https://x.com/example/status/' + id

function tweet(extra = {}) {
  return { __typename: 'Tweet', rest_id: id, core: { user_results: { result: { core: { name: 'Example', screen_name: 'example' } } } },
    details: { full_text: '你好 🐈\n第二行 &amp; wrap', created_at_ms: 1700000000000 }, ...extra }
}

function html(...tweets) {
  return '<html><script>data.push(' + JSON.stringify(JSON.stringify({ items: tweets })) + ')</script></html>'
}

test('X follows the canonical ID route and merges repeated payloads', async t => {
  const full = tweet({ details: { full_text: '🙂read https://t.co/a', display_text_range: [1, 20] },
    url_entities: [{ indices: [6, 20], display_url: 'example.org' }] })
  delete full.core
  const stub = tweet({ details: { full_text: '' } })
  t.mock.method(globalThis, 'fetch', async input => input === xUrl ? new Response(null, { status: 404 })
    : new Response(html(full, stub)))
  const card = await xAdapter.resolve(new URL(xUrl))
  const { paragraphs } = await inspectLayout(xAdapter, card, 360)
  assert.ok(paragraphs.some(p => p.runs[0]?.text === 'Example' && p.style.includes('font-weight:700')))
  const body = paragraphs.find(p => p.runs.some(r => r.text === 'example.org'))
  assert.equal(body.runs.map(r => r.text).join(''), 'read example.org')
  assert.equal(body.runs.at(-1).style, 'color:#1d9bf0')
})

test('timeline uses account metadata, truncated counts and the best available image variant', async t => {
  const avatar = 'https://pbs.twimg.com/profile_images/1/account_normal.jpg'
  const photo = 'https://pbs.twimg.com/media/example.jpg'
  const post = tweet({
    core: { user_results: { result: {
      core: { name: 'Team', screen_name: 'team' }, profile_image_shape: 'Square',
      avatar: { image_url: avatar }, verification: { verified_type: 'Business' }
    } } },
    counts: { reply_count: 6, quote_count: 4, retweet_count: 8, favorite_count: 5264 },
    views: { count: '139073' },
    media_entities2: [{ type: 'photo', media_url_https: photo, original_info: { width: 800, height: 600 } }]
  })
  const requests = []
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(url)
    if (url === xUrl) return new Response(html(post))
    if (url.includes('name=medium')) return new Response(null, { status: 404 })
    return new Response(sampleImage)
  })
  const card = await xAdapter.resolve(new URL(xUrl), { width: 600, dpr: 2 })
  assert.ok(requests.includes(avatar.replace('_normal', '_x96')))
  assert.ok(requests.includes('https://pbs.twimg.com/media/example?format=jpg&name=medium'))
  assert.ok(requests.includes(photo))
  assert.ok(card.assets.has(avatar) && card.assets.has(photo))
  const wide = await inspectLayout(xAdapter, card, 600)
  assert.equal(wide.items.find(i => i.src === avatar).paint.radius, 4)
  assert.ok(wide.items.some(i => i.svg?.includes('icon-verified-business-color')))
  for (const count of ['6','12','5.2K','139K'])
    assert.ok(wide.paragraphs.some(p => p.runs[0]?.text === count))
  const narrow = await inspectLayout(xAdapter, card, 320)
  const icons = layout => layout.items.filter(i => i.kind === 'svg').length
  assert.equal(icons(wide) - icons(narrow), 1, 'hide bookmark on narrow cards')
})

test('timeline preserves text presentation and gives explicit emoji sequences one color glyph slot', async t => {
  const text = '© · ©️ · ↔︎ · ↔️ · 1️⃣ · 👩🏽‍💻 · 🇬🇷 · <&>'
  t.mock.method(globalThis, 'fetch', async () => new Response(html(tweet({ details: { full_text: text } }))))
  const card = await xAdapter.resolve(new URL(xUrl))
  const { paragraphs } = await inspectLayout(xAdapter, card, 320)
  const body = paragraphs.find(p => p.runs.map(r => r.text).join('') === text)
  assert.ok(body)
  const emoji = body.runs.filter(r => r.style?.includes("font-family:'Apple Color Emoji'"))
  assert.deepEqual(emoji.map(r => r.text), ['©️', '↔️', '1️⃣', '👩🏽‍💻', '🇬🇷'])
  assert.deepEqual([...new Set(xAdapter.fonts.filter(f => f.family === 'TwitterChirp').map(f => f.weight))], [400, 500, 700, 800])
})

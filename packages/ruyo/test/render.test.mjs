import assert from 'node:assert/strict'
import { test } from 'node:test'
import { render } from 'ruyo'

const id = '9007199254740993123'
const xUrl = 'https://x.com/example/status/' + id
const biliUrl = 'https://www.bilibili.com/opus/' + id
test('the default renderer handles GitHub issue links with a per-call host', async () => {
  const url = 'https://github.com/owner/repo/issues/7'
  const host = { async fetch(input) {
    assert.equal(input, 'https://api.github.com/repos/owner/repo/issues/7')
    return Response.json({ html_url: url, title: 'Quick fix', number: 7, state: 'open', user: null, comments: 0 })
  } }
  const result = await render(url, { width: 320, dpr: 2 }, host)
  assert.equal(result.width, 640)
  assert.deepEqual([...result.png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
})

const photoUrl = 'https://i0.hdslb.com/test.png'
const pixels = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAFElEQVR4nGN84KLGgA0wYRWlkwQAw5wBVjcISf0AAAAASUVORK5CYII=', 'base64')

test('the default renderer handles YouTube Shorts through the caller’s host', async () => {
  const cover = 'https://i.ytimg.com/cover.jpg'
  const host = { fetch: async url => url.startsWith('https://i.ytimg.com/') ? new Response(pixels) : Response.json({
    type: 'video', title: '示例', author_name: '频道', thumbnail_url: cover, width: 90, height: 160
  }) }
  const image = await render('https://www.youtube.com/shorts/aB3_-dEFg12', { width: 180, dpr: 2 }, host)
  assert.equal(image.width, 360)
  assert.ok(image.height > image.width)
})

function tweet(extra = {}) {
  return { __typename: 'Tweet', rest_id: id, core: { user_results: { result: { core: { name: 'Example', screen_name: 'example' } } } },
    details: { full_text: '你好 🐈\n第二行 &amp; wrap', created_at_ms: 1700000000000 }, ...extra }
}

function html(...tweets) {
  return '<html><script>data.push(' + JSON.stringify(JSON.stringify({ items: tweets })) + ')</script></html>'
}

function biliItem(extra = {}) {
  return { type: 'DYNAMIC_TYPE_DRAW', id_str: id, modules: {
    module_author: { name: '作者', pub_time: '11月23日' },
    module_dynamic: { major: { type: 'MAJOR_TYPE_OPUS', opus: {
      summary: { rich_text_nodes: [{ type: 'RICH_TEXT_NODE_TYPE_TEXT', text: '正文 & <示例>\n' }, { type: 'RICH_TEXT_NODE_TYPE_AT', text: '@作者' }] },
      pics: Array.from({ length: 4 }, () => ({ url: photoUrl, width: 800, height: 600 }))
    } } }
  }, ...extra }
}

test('both adapters reach the same renderer; preserve rich text, photos, long IDs and DPR', async t => {
  let requests = 0
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input)
    if (url.href === xUrl) return new Response(html(tweet({ rest_id: '123' }), tweet()))
    if (url.href === photoUrl) { requests++; return new Response(pixels) }
    assert.equal(url.hostname, 'api.bilibili.com')
    assert.equal(url.searchParams.get('id'), id)
    return Response.json({ code: 0, data: { item: biliItem() } })
  })
  for (const url of [xUrl, biliUrl]) {
    const one = await render(url, { width: 360, dpr: 1 })
    const two = await render(url, { width: 360, dpr: 2 })
    assert.equal(one.width, 360)
    assert.equal(two.width, 720)
    assert.ok(Math.abs(two.height - one.height * 2) <= 2, [one.height, two.height].join(', '))
    assert.deepEqual([...one.png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    assert.deepEqual(one.png, (await render(url, { width: 360, dpr: 1 })).png)
    if (url === biliUrl) assert.ok(one.height > 240)
  }
  assert.equal(requests, 3, 'download a repeated image just once per render')
})

test('each render uses its selected host for posts, redirects and media retries', async t => {
  const { createRenderer } = await import('@ruyojs/core')
  const { xAdapter } = await import('@ruyojs/x')
  const { bilibiliAdapter } = await import('@ruyojs/bilibili')
  const globalFetch = t.mock.method(globalThis, 'fetch', () => assert.fail('unexpected direct fetch'))
  const photo = 'https://pbs.twimg.com/media/test.jpg'
  const xCalls = []
  const xHost = { async fetch(url, init) {
    xCalls.push(url)
    assert.equal(init.redirect, 'manual')
    assert.ok(init.signal instanceof AbortSignal)
    if (url === xUrl) return new Response(null, { status: 404 })
    if (url === 'https://x.com/i/status/' + id) return new Response(null, { status: 302, headers: { location: '/post' } })
    if (url === 'https://x.com/post') return new Response(html(tweet({
      media_entities2: [{ type: 'photo', media_url_https: photo, original_info: { width: 8, height: 6 } }]
    })))
    assert.equal(new Headers(init.headers).get('referer'), 'https://x.com/')
    return url === photo ? new Response(pixels) : new Response(null, { status: 404 })
  } }
  const biliCalls = []
  const biliHost = { async fetch(url, init) {
    biliCalls.push(url)
    assert.equal(init.redirect, 'manual')
    if (new URL(url).hostname === 'api.bilibili.com') return Response.json({ code: 0, data: { item: biliItem() } })
    if (url === photoUrl) return new Response(null, { status: 307, headers: { location: '/actual.png' } })
    assert.equal(url, 'https://i0.hdslb.com/actual.png')
    return new Response(pixels)
  } }
  const renderer = createRenderer({ adapters: [xAdapter, bilibiliAdapter], host: xHost })
  const opts = { width: 360, dpr: 1 }
  await Promise.all([renderer.render(xUrl, opts), renderer.render(biliUrl, opts, biliHost)])
  assert.deepEqual(xCalls, [xUrl, 'https://x.com/i/status/' + id, 'https://x.com/post',
    'https://pbs.twimg.com/media/test?format=jpg&name=small', photo])
  assert.deepEqual(biliCalls.slice(1), [photoUrl, 'https://i0.hdslb.com/actual.png'])
  await render(biliUrl, opts, biliHost)
  assert.equal(biliCalls.length, 6)
  assert.equal(globalFetch.mock.callCount(), 0)
})

test('reject unreadable redirects and bound the redirect chain through the supplied host', async () => {
  const via = fetch => render(biliUrl, {}, { fetch })
  await assert.rejects(via(async () => new Response(null, { status: 302 })), { code: 'UPSTREAM_ERROR' })
  const opaque = Object.defineProperty(Response.error(), 'type', { value: 'opaqueredirect' })
  await assert.rejects(via(async () => opaque), /expose redirect status and Location/)
  let calls = 0
  await assert.rejects(via(async () => Response.redirect('https://api.bilibili.com/' + ++calls)), /Exceeded 10 redirects/)
  assert.equal(calls, 11)
})

test('reject missing payloads, restricted upstreams, unsupported types and broken images', async t => {
  const mock = t.mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(html(tweet({ rest_id: 'other' })))))
  await assert.rejects(render(xUrl), { code: 'NOT_FOUND' })
  mock.mock.mockImplementation(async () => Response.json({ code: -352, message: '-352' }))
  await assert.rejects(render(biliUrl), { code: 'ACCESS_RESTRICTED' })
  mock.mock.mockImplementation(async () => Response.json({ code: 0, data: { item: biliItem({ type: 'DYNAMIC_TYPE_FORWARD' }) } }))
  await assert.rejects(render(biliUrl), { code: 'UNSUPPORTED_CONTENT' })
  mock.mock.mockImplementation(async () => new Response(html(tweet({ media_entities2: [{ type: 'video' }] }))))
  await assert.rejects(render(xUrl), { code: 'UNSUPPORTED_CONTENT' })
  mock.mock.mockImplementation(async url => url === photoUrl ? new Response('broken') : Response.json({ code: 0, data: { item: biliItem() } }))
  await assert.rejects(render(biliUrl), { code: 'ASSET_ERROR' })
  await assert.rejects(render('https://example.org/'), { code: 'UNSUPPORTED_URL' })
  await assert.rejects(render(xUrl, { dpr: 0 }), { code: 'INVALID_OPTIONS' })
})

test('a separately registered layout renders through the public core API', async () => {
  const { createRenderer } = await import('@ruyojs/core')
  const adapter = {
    resolve(url) {
      if (url.hostname !== 'example.org') return
      return Promise.resolve({
        layout: width => ({ height: 24, items: [{ kind: 'rect', x: 0, y: 0, width, height: 24, paint: { fill: [255, 0, 0, 255] } }] }),
        assets: new Map()
      })
    }
  }
  const renderer = createRenderer({ adapters: [adapter] })
  const result = await renderer.render('https://example.org/card', { width: 240, dpr: 2 })
  assert.deepEqual([result.width, result.height], [480, 48])
})

function textLayout(text, family) {
  return (width, { prepareText }) => {
    const block = prepareText({ runs: [{ text }], maxWidth: width,
      style: 'font-family:' + family + ';font-size:24px;line-height:40px' })
    return { height: 64, items: [{ kind: 'text', x: 0, y: 0, ...block }] }
  }
}

test('adapter font overrides take priority and missing glyphs fall back to the host', async () => {
  const { createRenderer } = await import('@ruyojs/core')
  const { xAdapter } = await import('@ruyojs/x')
  const { bilibiliAdapter } = await import('@ruyojs/bilibili')
  assert.equal(bilibiliAdapter.fonts, undefined)
  const latin = xAdapter.fonts.find(face => face.file.pathname.endsWith('/Chirp-Regular.latin.ttf'))
  assert.ok(latin)
  const adapters = [
    { host: 'default.example' },
    { host: 'empty.example', fonts: [] },
    { host: 'custom.example', fonts: [latin] }
  ].map(({ host, ...options }) => ({
    ...options,
    resolve(url) {
      if (url.hostname !== host) return
      const text = decodeURIComponent(url.pathname.slice(1))
      return Promise.resolve({
        layout: textLayout(text, 'TwitterChirp,system-ui'),
        assets: new Map()
      })
    }
  }))
  const renderer = createRenderer({ adapters })
  const draw = async (host, text) => (await renderer.render(`https://${host}.example/${text}`, { width: 240, dpr: 1 })).png
  const latinText = 'Quick brown fox'
  const system = await draw('default', latinText)
  assert.deepEqual(await draw('empty', latinText), system)
  const custom = await draw('custom', latinText)
  assert.notDeepEqual(custom, system)

  // Digits are available on every host. Restrict the same face to letters to
  // exercise fallback even on hosts without Chinese or emoji fonts installed.
  const limited = { ...adapters[2], fonts: [{ ...latin, ranges: [[32, 32], [65, 90], [97, 122]] }] }
  const limitedRenderer = createRenderer({ adapters: [limited] })
  const drawLimited = async text => (await limitedRenderer.render(`https://custom.example/${text}`, { width: 240, dpr: 1 })).png
  assert.deepEqual(await drawLimited(latinText), custom)
  assert.notDeepEqual(await drawLimited('1234'), await drawLimited('5678'))
  assert.deepEqual(await drawLimited(latinText), custom)
  if (process.platform === 'darwin') {
    for (const [left, right] of [['日', '月'], ['🐈', '🐕']]) {
      assert.notDeepEqual(await draw('custom', left), await draw('custom', right))
    }
  }
  assert.deepEqual(await draw('custom', latinText), custom)
  assert.deepEqual(await draw('default', latinText), system)
})

test('X clamps wide viewports to the 600px timeline column before rendering', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(html(tweet())))
  const wide = await render(xUrl, { width: 900, dpr: 2 })
  const column = await render(xUrl, { width: 600, dpr: 2 })
  assert.equal(wide.width, 1200)
  assert.deepEqual(wide.png, column.png)
})

test('macOS host fallback paints distinct Chinese and emoji glyphs without bundled fonts', { skip: process.platform !== 'darwin' }, async () => {
  const { createRenderer } = await import('@ruyojs/core')
  const renderer = createRenderer({ adapters: [{
    resolve(url) {
      const text = decodeURIComponent(url.pathname.slice(1))
      return Promise.resolve({
        layout: textLayout(text, 'system-ui'),
        assets: new Map()
      })
    }
  }] })
  for (const [left, right] of [['日', '月'], ['🐈', '🐕']]) {
    const draw = async text => (await renderer.render('https://example.org/' + text, { width: 240, dpr: 1 })).png
    assert.notDeepEqual(await draw(left), await draw(right))
  }
})

test('system font preflight batches new paragraphs, preserves pixels and skips cached cards', async t => {
  const { createRenderer } = await import('@ruyojs/core')
  const { default: childProcess } = await import('node:child_process')
  const { syncBuiltinESMExports } = await import('node:module')
  const exec = t.mock.method(childProcess, 'execFileSync')
  syncBuiltinESMExports()
  t.after(() => { exec.mock.restore(); syncBuiltinESMExports() })

  const paragraphs = ['Latin e\u0301', '中文', '👩🏽‍💻', 'עברית']
  let probes = 0
  function adapter(batch, conditional = false) {
    return { resolve: async () => ({
      assets: new Map(),
      layout(width, { prepareText, preflightSystemFonts }) {
        function layout(measure) {
          const items = []
          let y = 0
          for (const text of paragraphs) {
            const block = measure({ runs: [{ text }], maxWidth: width, style: 'font-family:system-ui;font-size:18px' })
            items.push({ kind: 'text', x: 0, y, ...block })
            y += block.height
            if (conditional && !block.width) break
          }
          return { height: y, items }
        }
        if (batch) preflightSystemFonts(measure => { probes++; return layout(measure) })
        return layout(prepareText)
      }
    }) }
  }
  const draw = adapter => {
    const renderer = createRenderer({ adapters: [adapter] })
    return () => renderer.render('https://example.org/fonts', { width: 240, dpr: 1 })
  }
  const expected = await draw(adapter(false))()
  const render = draw(adapter(true))
  exec.mock.resetCalls()
  assert.deepEqual((await render()).png, expected.png)
  const commands = exec.mock.calls.map(call => call.arguments[0])
  if (process.platform === 'darwin') assert.deepEqual(commands, ['/usr/bin/osascript'])
  else if (process.platform === 'win32') assert.deepEqual(commands, ['powershell.exe'])
  else assert.deepEqual(commands, Array(4).fill('fc-match'))
  assert.equal(probes, 1)
  exec.mock.resetCalls()
  assert.deepEqual((await render()).png, expected.png)
  assert.equal(exec.mock.callCount(), 0)
  assert.equal(probes, 1)
  // Real metrics may expose paragraphs that the provisional layout could not discover.
  assert.deepEqual((await draw(adapter(true, true))()).png, expected.png)
})

test('the painter preserves draw order and rectangular clips at fractional DPR', async () => {
  const { createRenderer } = await import('@ruyojs/core')
  const red = { kind: 'rect', x: 0, y: 0, width: 40, height: 24, paint: { fill: [255, 0, 0, 255] } }
  const blue = { ...red, paint: { fill: [0, 0, 255, 255] } }
  const scene = {
    clipped: [red, { ...blue, clip: [8, 4, 12, 8] }],
    positioned: [red, { ...blue, x: 8, y: 4, width: 12, height: 8 }],
    covered: [blue, red],
    red: [red],
  }
  const renderer = createRenderer({ adapters: [{
    resolve: async url => ({ assets: new Map(), layout: () => ({ height: 24, items: scene[url.pathname.slice(1)] }) })
  }] })
  const draw = async name => (await renderer.render('https://example.org/' + name, { width: 160, dpr: 1.5 })).png
  const clipped = await draw('clipped')
  assert.deepEqual(clipped, await draw('positioned'))
  const covered = await draw('covered')
  assert.deepEqual(covered, await draw('red'))
  assert.notDeepEqual(clipped, covered)
})

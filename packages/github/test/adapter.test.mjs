import assert from 'node:assert/strict'
import { test } from 'node:test'
import { githubAdapter } from '@ruyojs/github'
import { inspectLayout, sampleImage } from '../../../test/inspect-layout.mjs'

const avatar = 'https://avatars.githubusercontent.com/u/42'
const root = 'https://api.github.com/repos/demo/project'
const user = { login: 'contributor', avatar_url: avatar }
const repo = {
  full_name: 'demo/project',
  owner: user,
  visibility: 'public',
  archived: true,
  description: 'A multilingual project 示例',
  language: 'Rust',
  license: { spdx_id: 'MIT' },
  stargazers_count: 12003,
  forks_count: 0
}
const issue = {
  html_url: 'https://github.com/demo/project/issues/12',
  title: 'An issue',
  number: 12,
  body_text: 'Plain text\nfrom GitHub',
  comments: 1,
  user,
  state: 'open'
}

function fixture(endpoints) {
  const calls = []
  return {
    calls,
    async fetch(url, init) {
      calls.push(url)
      assert.equal(init.redirect, 'manual')
      if (url === avatar) return new Response(sampleImage)
      assert.equal(init.headers.get('accept'), 'application/vnd.github.full+json')
      assert.ok(Object.hasOwn(endpoints, url), url)
      return Response.json(endpoints[url])
    }
  }
}
async function inspect(url, host, width = 600) {
  const card = await githubAdapter.resolve(new URL(url), undefined, host)
  const layout = await inspectLayout(githubAdapter, card, width)
  return { ...layout, labels: layout.paragraphs.flatMap((p) => p.runs.map((r) => r.text)) }
}

test('repository and avatar use the selected host; metrics wrap inside narrow cards', async () => {
  const host = fixture({ [root]: repo })
  const { labels, items } = await inspect('https://github.com/demo/project.git/?tab=readme#top', host, 160)
  assert.deepEqual(host.calls, [root, avatar])
  for (const text of [
    'contributor',
    ' · Repository',
    'project',
    'Public archive',
    repo.description,
    '12,003 stars',
    '0 forks',
    'Rust',
    'MIT'
  ])
    assert.ok(labels.includes(text), text)
  for (const item of items) assert.ok(item.x >= 0 && item.x + item.width <= 160.01, JSON.stringify(item))
})

test('Issue renders its plain-text excerpt and canonical repository after a rename', async () => {
  const body = '📦'.repeat(300)
  const host = fixture({
    [root + '/issues/12']: {
      ...issue,
      body_text: body,
      user: null,
      state: 'closed',
      state_reason: 'not_planned',
      html_url: 'https://github.com/new-owner/new-name/issues/12'
    }
  })
  const { labels } = await inspect('https://github.com/demo/project/issues/12#issuecomment-1', host)
  assert.deepEqual(host.calls, [root + '/issues/12'])
  for (const text of ['new-owner/new-name', 'Issue #12', 'An issue', 'Not planned', '📦'.repeat(280) + '…', '1 comment'])
    assert.ok(labels.includes(text), text)
})

test('PR state, changed files and discussion comments follow pull-request metadata', async () => {
  for (const [state, merged, draft, badge] of [
    ['closed', true, false, 'Merged'],
    ['closed', false, false, 'Closed'],
    ['open', false, true, 'Draft'],
    ['open', false, false, 'Open']
  ]) {
    const pr = { ...issue, html_url: 'https://github.com/demo/project/pull/12', state, merged, draft, changed_files: 2 }
    const alias = badge === 'Merged'
    const host = fixture({ [root + '/pulls/12']: pr, [root + '/issues/12']: { ...issue, pull_request: {} } })
    const { labels } = await inspect('https://github.com/demo/project/' + (alias ? 'issues' : 'pull') + '/12', host)
    for (const text of [
      'contributor',
      'demo/project',
      'Pull request #12',
      'An issue',
      badge,
      'Plain text from GitHub',
      '1 comment',
      '2 files changed'
    ])
      assert.ok(labels.includes(text), text)
    assert.equal(host.calls.length, alias ? 3 : 2)
  }
})

test('unsupported routes fall through and GitHub errors retain their error codes', async () => {
  for (const path of [
    'https://github.com/login',
    'https://github.com/topics/rust',
    'https://github.com/demo/project/tree/main',
    'https://github.com/demo/project/pull/nope',
    'https://example.com/demo/project'
  ])
    assert.equal(githubAdapter.resolve(new URL(path)), undefined)
  const url = new URL('https://github.com/demo/project')
  for (const [status, code] of [
    [404, 'NOT_FOUND'],
    [403, 'ACCESS_RESTRICTED'],
    [429, 'ACCESS_RESTRICTED']
  ])
    await assert.rejects(githubAdapter.resolve(url, undefined, { fetch: async () => new Response(null, { status }) }), {
      code
    })
  await assert.rejects(githubAdapter.resolve(url, undefined, fixture({ [root]: {} })), { code: 'UPSTREAM_ERROR' })
})

test('languages use actual byte counts, and unavailable enrichment falls back to the primary language', async () => {
  const page = 'https://github.com/demo/project'
  const info = {
    ...repo,
    languages_url: root + '/languages',
    topics: ['wasm'],
    open_issues_count: 3,
    subscribers_count: 2
  }
  const { labels } = await inspect(page, fixture({ [root]: info, [root + '/languages']: { Rust: 7, TypeScript: 3 } }))
  for (const text of ['Rust', '70.0%', 'TypeScript', '30.0%', 'wasm', '3 open issues & PRs', '2 watching'])
    assert.ok(labels.includes(text), text)
  const fallbackHost = fixture({ [root]: info })
  const fallback = await inspect(page, {
    fetch: (url, init) =>
      url === root + '/languages' ? new Response(null, { status: 403 }) : fallbackHost.fetch(url, init)
  })
  assert.ok(fallback.labels.includes('Rust'))
  assert.ok(!fallback.labels.includes('100.0%'))
})

test('release tags with slashes and latest use real assets, downloads, and formatted notes', async () => {
  const release = {
    name: 'Winter release',
    tag_name: 'channel/v2',
    author: user,
    published_at: '2026-11-15T02:00:00Z',
    assets: [{ name: 'app.zip', size: 2048, download_count: 15 }],
    body_html: '<h2>Changes</h2><ul><li>A <strong>fix</strong></li></ul><pre>let a = 3</pre>',
    reactions: { rocket: 2 }
  }
  for (const [route, endpoint, badge] of [
    ['tag/channel/v2', 'tags/channel%2Fv2', 'Release'],
    ['tag/channel%2Fv2', 'tags/channel%2Fv2', 'Release'],
    ['latest', 'latest', 'Latest']
  ]) {
    const { labels, paragraphs } = await inspect(
      'https://github.com/demo/project/releases/' + route,
      fixture({ [root + '/releases/' + endpoint]: release })
    )
    for (const text of [
      'Winter release',
      badge,
      'Changes',
      'fix',
      'let a = 3',
      'app.zip',
      '2.0 KiB',
      '15 downloads',
      '🚀 2'
    ])
      assert.ok(labels.includes(text), text)
    assert.ok(paragraphs.some((p) => p.runs.some((r) => r.text === 'fix' && r.style.includes('font-weight:600'))))
  }
})

test('release notes end between words, show only images inside the excerpt, and keep list markers', async () => {
  const early = 'https://github.com/user-attachments/assets/early.png'
  const late = 'https://github.com/user-attachments/assets/late.png'
  const host = (body_html) => {
    const base = fixture({ [root + '/releases/latest']: { tag_name: 'v1', author: user, assets: [], body_html } })
    return {
      calls: base.calls,
      fetch: (url, init) => (url === early || url === late ? new Response(sampleImage) : base.fetch(url, init))
    }
  }
  const page = 'https://github.com/demo/project/releases/latest'

  const long = host('<p>' + 'alpha '.repeat(250) + '</p><p><img src="' + late + '"></p>')
  const cut = await inspect(page, long)
  const excerpt = cut.paragraphs.find((p) => p?.runs[0]?.text.startsWith('alpha'))
  assert.equal(excerpt.runs.at(-1).text, 'alpha '.repeat(165) + 'alpha…')
  assert.ok(cut.labels.includes('Read more on GitHub ↗'))
  assert.ok(!long.calls.includes(late))
  assert.ok(!cut.items.some((i) => i.kind === 'image' && i.src === late))

  const rich = await inspect(
    page,
    host(
      '<p>Intro with <code>pnpm</code></p><p><img src="' +
        early +
        '"></p><p>After</p><pre><code>let a = 3</code></pre>' +
        '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" checked disabled> Done</li>' +
        '<li class="task-list-item"><input type="checkbox" disabled> Todo</li></ul><ol start="3"><li>Third</li><li>Fourth</li></ol>'
    )
  )
  const top = (text) => {
    const id = rich.paragraphs.findIndex((p) => p?.runs.some((r) => r.text === text))
    return rich.items.find((i) => i.kind === 'text' && i.id === id).y
  }
  const image = rich.items.find((i) => i.kind === 'image' && i.src === early)
  assert.ok(top('Intro with ') < image.y && image.y + image.height <= top('After'))
  assert.ok(rich.paragraphs.some((p) => p?.runs.some((r) => r.text === 'pnpm' && r.style.includes('background-color'))))
  assert.ok(rich.paragraphs.some((p) => p?.runs.some((r) => r.text === 'let a = 3' && !r.style)))
  for (const text of ['3.', '4.', 'Third', 'Fourth']) assert.ok(rich.labels.includes(text), text)
  assert.ok(!rich.labels.includes('•'))
  assert.equal(rich.items.filter((i) => i.kind === 'rect' && i.width === 14 && i.height === 14).length, 2)
  assert.equal(rich.items.filter((i) => i.kind === 'svg' && i.width === 12).length, 1)
})

test('commit uses its author fallback, signature, per-file changes and full diff totals', async () => {
  const sha = 'ab12345'.padEnd(40, 'f')
  const host = fixture({
    [root + '/commits/ab12345']: {
      sha,
      author: null,
      commit: {
        author: { name: 'Local Author' },
        committer: { date: '2026-11-20T08:00:00Z' },
        message: 'Fix parser\n\nKeep blank lines.\n\nCo-authored-by: Pair Programmer <pair@example.com>',
        verification: { reason: 'unsigned', verified: false }
      },
      stats: { additions: 24, deletions: 3 },
      files: [{ filename: 'new.ts', previous_filename: 'old.ts', status: 'renamed', additions: 10, deletions: 1 }]
    }
  })
  const { labels } = await inspect('https://github.com/demo/project/commit/ab12345', host, 240)
  for (const text of [
    'Fix parser',
    'demo/project',
    ' · Commit ab12345',
    'Local Author and Pair Programmer · Committed 2026-11-20',
    'Keep blank lines.',
    'R',
    'old.ts → new.ts',
    '+10  −1',
    '+24',
    '−3',
    '1 file changed'
  ])
    assert.ok(labels.includes(text), text)
  assert.ok(!labels.some((text) => text.includes('Co-authored-by') || text === 'Unsigned'))
})

test('profile uses the users endpoint, including organization and optional profile fields', async () => {
  const data = {
    ...user,
    type: 'Organization',
    name: 'Example Org',
    public_repos: 1,
    followers: 900,
    following: 0,
    public_gists: 0,
    location: 'Tokyo',
    bio: 'Open source tools'
  }
  const { labels } = await inspect('https://github.com/demo/', fixture({ 'https://api.github.com/users/demo': data }))
  for (const text of [
    'Organization',
    'Example Org',
    'Open source tools',
    'Tokyo',
    '1 public repository',
    '900 followers',
    '0 following'
  ])
    assert.ok(labels.includes(text), text)
})

test('public Discussions use their own post, state and counts, including org-level URLs', async () => {
  const url = 'https://github.com/orgs/demo/discussions/12'
  const html =
    '<meta property="og:url" content="' +
    url +
    '"><meta content="Q &amp; A" property="og:title"><div id="partial-discussion-header"><span class="State" title="Answered"></span></div>' +
    '<div id="discussion-432"><h2 class="timeline-comment-header-text"><a data-hovercard-type="user" href="/demo-user">Demo</a></h2><div class="js-comment-body"><p>A detailed answer.</p></div>' +
    '<button id="discussion-upvote-button-Discussion-432">7</button></div><span id="discussion-comment-count">2 comments · 4 replies</span>'
  const host = {
    async fetch(input, init) {
      assert.equal(input, url)
      assert.equal(init.headers.get('accept'), 'text/html')
      return new Response(html)
    }
  }
  const { labels } = await inspect(url, host)
  for (const text of ['Q & A', 'Answered', 'demo-user', 'A detailed answer.', '7 upvotes', '2 comments', '4 replies'])
    assert.ok(labels.includes(text), text)
  await assert.rejects(
    githubAdapter.resolve(new URL(url), undefined, { fetch: async () => new Response('<title>Sign in</title>') }),
    { code: 'UPSTREAM_ERROR' }
  )
})

test('rich PRs include branch direction, labels, milestone, reactions, and optional body image', async () => {
  const src = 'https://github.com/user-attachments/assets/demo.png'
  const pr = {
    ...issue,
    html_url: 'https://github.com/demo/project/pull/12',
    merged: false,
    draft: false,
    changed_files: 2,
    commits: 3,
    additions: 25,
    deletions: 12,
    base: { ref: 'main' },
    head: { ref: 'fix' },
    labels: [{ name: 'bug', color: 'd73a4a' }],
    milestone: { title: 'v2' },
    reactions: { heart: 2 },
    body_html: '<p>Illustration</p><img src="' + src + '">'
  }
  const host = fixture({ [root + '/pulls/12']: pr })
  for (const status of [200, 404]) {
    const { items, labels } = await inspect(
      pr.html_url,
      { fetch: (url, init) => (url === src ? new Response(sampleImage, { status }) : host.fetch(url, init)) },
      160
    )
    assert.equal(
      items.some((i) => i.kind === 'image' && i.src === src),
      status === 200
    )
    for (const value of ['bug', 'v2', '❤️ 2', 'main', '←', 'fix', '+25', '−12', '3 commits'])
      assert.ok(labels.includes(value), value)
    for (const item of items) assert.ok(item.x >= 0 && item.x + item.width <= 160.01, JSON.stringify(item))
  }
})

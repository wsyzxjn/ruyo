# Ruyo

Ruyo turns links from X, Bilibili, GitHub, and YouTube into PNG preview cards. It runs in Node.js and doesn't need a browser.

> **Not on npm yet.** To try Ruyo, [build it from source](#build-from-source).

## Usage

Requires Node.js 24 or later.

```ts
import { writeFile } from 'node:fs/promises'
import { render } from '@ruyojs/ruyo'

const { png, width, height } = await render('https://x.com/jack/status/20')
await writeFile('post.png', png)
```

`render(url, options?, host?)` returns the PNG bytes along with the image's `width` and `height` in pixels.

| Option | Default | Range | Description |
|---|---|---|---|
| `width` | `600` | Integer, 160–1200 | Card width in CSS pixels. X cards are at most 600 wide, Bilibili cards 708. |
| `dpr` | `2` | 1–4 | Device pixel ratio of the output image |

## Supported links

### X

| Link | Card |
|---|---|
| `x.com/<user>/status/<id>`, `x.com/i/web/status/<id>` | Original text and photo posts in the light desktop timeline style, with verification badges and reply, repost, like, and view counts |

`twitter.com`, `www.` and `mobile.` hosts, and a trailing `/photo/<n>` also work. Quotes, reposts, videos, and link cards aren't supported.

### Bilibili

| Link | Card |
|---|---|
| `bilibili.com/video/BV…`, `bilibili.com/video/av…` | Cover, title, duration, uploader, date, and play, danmaku, like, coin, favorite, share, and comment counts. With `?p=<n>`, the title and duration of that part. |
| `t.bilibili.com/<id>`, `bilibili.com/opus/<id>` | Text, image, and video dynamics, with author and engagement counts |
| `b23.tv/<code>` | Whatever the short link points to |

`www.` and `m.` hosts also work. Reposted dynamics aren't supported. Bilibili often rejects anonymous requests for dynamics, which fail with `ACCESS_RESTRICTED`.

### GitHub

| Link | Card |
|---|---|
| `github.com/<owner>/<repo>` | Description, visibility, topics, homepage, default branch, languages, stars, forks, watchers, and open issues and PRs |
| `…/issues/<n>` | State, author, date, labels, body, assignees, milestone, reactions, and comment count |
| `…/pull/<n>` | Everything on an issue card, plus branches, lines added and removed, commits, changed files, and review comments |
| `…/releases/latest`, `…/releases/tag/<tag>` | Version, release notes, date, the first three assets with their sizes, and total downloads |
| `…/commit/<sha>` | Message, short SHA, signature status, co-authors, lines added and removed, changed file count, and stats for up to six files |
| `…/discussions/<n>`, `github.com/orgs/<org>/discussions/<n>` | Body, category, votes, comment and reply counts, and the accepted answer if there is one |
| `github.com/<user-or-org>` | Profile, location, website, join date, public repos, followers, following, and three recently pushed repos |

Body previews keep headings, lists, task lists, code, quotes, and links. Long text is cut at a word boundary, and the first image within the preview is shown in place.

Ruyo calls the GitHub REST API anonymously, which GitHub limits to 60 requests per hour per IP. Each card takes 1–3 requests; discussions are read from the public web page instead. To raise the limit, [add a token](#network-and-proxies).

### YouTube

| Link | Card |
|---|---|
| `youtube.com/watch?v=<id>`, `youtu.be/<id>`, `youtube.com/shorts/<id>` | Thumbnail, title, and channel name |

`m.youtube.com` also works. Ruyo reads YouTube's official oEmbed data, so it only works for videos that allow embedding, and it can't show views, duration, or likes. Shorts are shown upright, centered in a square frame.

## Errors

Failures throw a `RuyoError`. Check its `code`:

| Code | Meaning |
|---|---|
| `UNSUPPORTED_URL` | No adapter handles the link |
| `INVALID_OPTIONS` | `width` or `dpr` is out of range |
| `UNSUPPORTED_CONTENT` | The link is recognized, but its content isn't supported, such as an X quote or a Bilibili repost |
| `ACCESS_RESTRICTED` | The platform refused the request, for example because of rate limits, a login wall, or risk control |
| `NOT_FOUND` | The post or page doesn't exist |
| `UPSTREAM_ERROR` | The network failed, or the platform returned unexpected data |
| `ASSET_ERROR` | An image or font couldn't be loaded |
| `RENDER_ERROR` | The card couldn't be drawn |

## Network and proxies

Every request, including images, goes through `host.fetch`, which defaults to the global `fetch`. Pass your own to add headers, use a proxy, or cache responses. This one sends a GitHub token to the API only:

```ts
import { render, type NetworkHost } from '@ruyojs/ruyo'

const host: NetworkHost = {
  fetch(input, init) {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.hostname !== 'api.github.com') return fetch(input, init)
    const headers = new Headers(init?.headers)
    headers.set('authorization', `Bearer ${process.env.GITHUB_TOKEN}`)
    return fetch(input, { ...init, headers })
  },
}

await render('https://github.com/nodejs/node', {}, host)
```

To use a host for every call, pass it to `createRenderer({ adapters, host })` instead.

Ruyo requests with `redirect: 'manual'` and follows up to 10 redirects itself, so your `fetch` must pass redirect responses through with their status and `Location` header intact. Requests time out after 15 seconds.

## Fonts

X cards use fonts bundled with `@ruyojs/x`. Other cards use the system UI font of the machine running Node.js, fall back to other installed fonts for missing characters, and use its default monospace font for code.

On Linux, Ruyo finds fonts through Fontconfig (`fc-match`). Install fonts that cover the scripts and emoji you need, such as Noto Sans CJK and Noto Color Emoji.

## Choosing adapters

The `@ruyojs/ruyo` package includes all four platforms. To include only some, combine `@ruyojs/core` with the adapters you need:

```ts
import { createRenderer } from '@ruyojs/core'
import { githubAdapter } from '@ruyojs/github'
import { xAdapter } from '@ruyojs/x'

const { render } = createRenderer({ adapters: [xAdapter, githubAdapter] })
const { png } = await render('https://x.com/jack/status/20', { width: 480 })
```

Adapters are tried in order, and the first one that recognizes the link renders it.

| Package | Export |
|---|---|
| `@ruyojs/x` | `xAdapter` |
| `@ruyojs/bilibili` | `bilibiliAdapter` |
| `@ruyojs/github` | `githubAdapter` |
| `@ruyojs/youtube` | `youtubeAdapter` |

## Writing an adapter

This adapter renders the page title of `example.com` links:

```ts
import { createRenderer, type Adapter, type NetworkHost, type ResolvedCard } from '@ruyojs/core'
import { request } from '@ruyojs/core/adapter'

async function titleCard(url: URL, host?: NetworkHost): Promise<ResolvedCard> {
  const html = await (await request(url.href, {}, host)).text()
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? url.href
  return {
    assets: new Map(),
    layout(width, { prepareText }) {
      const text = prepareText({
        runs: [{ text: title }],
        maxWidth: width - 32,
        style: 'font-family:system-ui;font-size:20px;line-height:28px',
      })
      return { height: Math.ceil(text.height) + 32, items: [{ kind: 'text', x: 16, y: 16, ...text }] }
    },
  }
}

const titleAdapter: Adapter = {
  resolve: (url, _options, host) => (url.hostname === 'example.com' ? titleCard(url, host) : undefined),
}

const { render } = createRenderer({ adapters: [titleAdapter] })
```

- `resolve(url, options, host)` returns `undefined` synchronously for links it doesn't handle. Otherwise, it returns a promise for `{ assets, layout }`.
- `assets` maps keys to image bytes. `image` items refer to them by `src`.
- `layout(width, context)` returns the card's `height` and the `items` to draw in order: `text`, `rect`, `image`, or `svg`. All sizes are in CSS pixels.
- `context.prepareText()` lays out a paragraph and returns its size, so you can place content below it. `context.imageSize(src)` returns an image's natural size.
- `@ruyojs/core/adapter` provides `request`, `loadImage`, and `loadImages`. They go through `host` and turn HTTP failures into `RuyoError`s.
- Set `maxWidth` to cap the card width, or `fonts` to use bundled font files before system fonts.

## Build from source

You'll need Node.js 24+, pnpm, Rust, and wasm-bindgen CLI 0.2.100.

```sh
rustup toolchain install
cargo install wasm-bindgen-cli --version 0.2.100 --locked
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

`rustup toolchain install` sets up the Rust version and WebAssembly target pinned in `rust-toolchain.toml`. To release a change, add a changeset with `pnpm changeset`.

Then add it to your project:

```sh
pnpm add link:/path/to/Ruyo/packages/ruyo
```

## Credits and licenses

Ruyo is released under the [MIT License](LICENSE).

- X carousel sizing, X icons, and rounded corner paths are adapted from [xeet](https://github.com/rauchg/xeet/blob/095ba15/crates/xeet-core/src/cards/media.rs) (Apache-2.0). The license ships with `@ruyojs/x` and `@ruyojs/core`.
- GitHub icons are from [Octicons](https://github.com/primer/octicons) (MIT). See `packages/github/licenses/octicons.txt`.
- Text layout uses [Takumi](https://github.com/kane50613/takumi), and drawing uses [tiny-skia](https://github.com/linebender/tiny-skia).
- Chirp, Arial, Apple Color Emoji, and Hiragino Sans fonts bundled with `@ruyojs/x` remain under their owners' terms and aren't covered by Ruyo's license. See [X fonts](packages/x/fonts/README.md).

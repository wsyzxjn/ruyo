# ruyo

Turn links from X, Bilibili, GitHub, and YouTube into PNG preview cards. Runs in Node.js without a browser.

## Install

```sh
npm install ruyo
```

Requires Node.js 24 or later.

## Usage

```ts
import { writeFile } from 'node:fs/promises'
import { render } from 'ruyo'

const { png, width, height } = await render('https://github.com/nodejs/node')
await writeFile('card.png', png)
```

`render(url, options?, host?)` returns the PNG bytes and the image's `width` and `height` in pixels.

| Option | Default | Description |
|---|---|---|
| `width` | `600` | Card width in CSS pixels, an integer from 160 to 1200. X cards are at most 600 wide, Bilibili cards 708. |
| `dpr` | `2` | Device pixel ratio, from 1 to 4 |

## Supported links

- **X**: original text and photo posts
- **Bilibili**: videos, dynamics, and `b23.tv` short links
- **GitHub**: repositories, issues, pull requests, releases, commits, discussions, and profiles
- **YouTube**: videos and Shorts that allow embedding

See [@ruyojs/x](https://www.npmjs.com/package/@ruyojs/x), [@ruyojs/bilibili](https://www.npmjs.com/package/@ruyojs/bilibili), [@ruyojs/github](https://www.npmjs.com/package/@ruyojs/github), and [@ruyojs/youtube](https://www.npmjs.com/package/@ruyojs/youtube) for link formats and what each card shows.

## Errors

Failures throw a `RuyoError`. Check its `code`:

| Code | Meaning |
|---|---|
| `UNSUPPORTED_URL` | No adapter handles the link |
| `INVALID_OPTIONS` | `width` or `dpr` is out of range |
| `UNSUPPORTED_CONTENT` | The link is recognized, but its content isn't supported, such as an X quote |
| `ACCESS_RESTRICTED` | The platform refused the request, for example because of rate limits or a login wall |
| `NOT_FOUND` | The post or page doesn't exist |
| `UPSTREAM_ERROR` | The network failed, or the platform returned unexpected data |
| `ASSET_ERROR` | An image or font couldn't be loaded |
| `RENDER_ERROR` | The card couldn't be drawn |

## Network

Every request, images included, goes through `host.fetch`, which defaults to the global `fetch`. Pass your own to add headers, use a proxy, or cache responses. This one sends a GitHub token to the GitHub API only:

```ts
import { render, type NetworkHost } from 'ruyo'

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

Ruyo follows up to 10 redirects itself, so your `fetch` must return redirect responses with their status and `Location` header intact. Requests time out after 15 seconds.

## Fonts

X cards use fonts bundled with `@ruyojs/x`. Other cards use the system fonts of the machine running Node.js. On Linux, Ruyo finds them through Fontconfig, so install fonts for the scripts and emoji you need, such as Noto Sans CJK and Noto Color Emoji.

## Only some platforms

`ruyo` includes every adapter. To include only some, or to add your own, use [@ruyojs/core](https://www.npmjs.com/package/@ruyojs/core).

# @ruyojs/core

The renderer behind [@ruyojs/ruyo](https://www.npmjs.com/package/@ruyojs/ruyo). Use it to include only the platforms you need, or to write your own adapter.

## Install

```sh
npm install @ruyojs/core @ruyojs/x
```

Requires Node.js 24 or later. Install the adapters you need:

| Package | Export | Links |
|---|---|---|
| [@ruyojs/x](https://www.npmjs.com/package/@ruyojs/x) | `xAdapter` | X posts |
| [@ruyojs/bilibili](https://www.npmjs.com/package/@ruyojs/bilibili) | `bilibiliAdapter` | Bilibili videos and dynamics |
| [@ruyojs/github](https://www.npmjs.com/package/@ruyojs/github) | `githubAdapter` | GitHub repositories, issues, pull requests, and more |
| [@ruyojs/youtube](https://www.npmjs.com/package/@ruyojs/youtube) | `youtubeAdapter` | YouTube videos and Shorts |

## Usage

```ts
import { writeFile } from 'node:fs/promises'
import { createRenderer } from '@ruyojs/core'
import { xAdapter } from '@ruyojs/x'

const { render } = createRenderer({ adapters: [xAdapter] })
const { png } = await render('https://x.com/jack/status/20', { width: 480 })
await writeFile('post.png', png)
```

`createRenderer({ adapters, host? })` returns a `render(url, options?, host?)` function with the same options, errors, and network behavior as the one in [@ruyojs/ruyo](https://www.npmjs.com/package/@ruyojs/ruyo). Adapters are tried in order, and the first one that recognizes the link renders it. `host` sets the default network host for every call.

The package also exports `RuyoError` and the types used here and below.

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

## License notices

Rounded corner paths are adapted from [xeet](https://github.com/rauchg/xeet) (Apache-2.0). See `licenses/` in this package.

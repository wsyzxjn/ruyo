# @ruyojs/x

X adapter for [Ruyo](https://www.npmjs.com/package/@ruyojs/ruyo). Renders X posts as PNG cards in the light desktop timeline style.

## Install

```sh
npm install @ruyojs/core @ruyojs/x
```

Or install [@ruyojs/ruyo](https://www.npmjs.com/package/@ruyojs/ruyo), which includes every platform.

## Usage

```ts
import { createRenderer } from '@ruyojs/core'
import { xAdapter } from '@ruyojs/x'

const { render } = createRenderer({ adapters: [xAdapter] })
const { png } = await render('https://x.com/jack/status/20')
```

## Supported links

- `x.com/<user>/status/<id>`
- `x.com/i/web/status/<id>`

`twitter.com`, `www.` and `mobile.` hosts, and a trailing `/photo/<n>` also work.

Original text and photo posts are shown with verification badges and reply, repost, like, and view counts. Quotes, reposts, videos, and link cards fail with `UNSUPPORTED_CONTENT`. Cards are at most 600 pixels wide.

## Fonts

This package bundles fonts that match the X timeline. Characters they don't cover fall back to system fonts. Chirp, Arial, Apple Color Emoji, and Hiragino Sans remain under their owners' terms and aren't covered by Ruyo's license. See `fonts/README.md` in this package.

## License notices

Carousel sizing and X icons are adapted from [xeet](https://github.com/rauchg/xeet) (Apache-2.0). See `licenses/` in this package.

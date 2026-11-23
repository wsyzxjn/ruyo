# @ruyojs/bilibili

Bilibili adapter for [Ruyo](https://www.npmjs.com/package/ruyo). Renders Bilibili videos and dynamics as PNG cards.

## Install

```sh
npm install @ruyojs/core @ruyojs/bilibili
```

Or install [ruyo](https://www.npmjs.com/package/ruyo), which includes every platform.

## Usage

```ts
import { createRenderer } from '@ruyojs/core'
import { bilibiliAdapter } from '@ruyojs/bilibili'

const { render } = createRenderer({ adapters: [bilibiliAdapter] })
const { png } = await render('https://www.bilibili.com/video/BV17x411w7KC/?p=2')
```

## Supported links

| Link | Card |
|---|---|
| `bilibili.com/video/BV…`, `bilibili.com/video/av…` | Cover, title, duration, uploader, date, and play, danmaku, like, coin, favorite, share, and comment counts. With `?p=<n>`, the title and duration of that part. |
| `t.bilibili.com/<id>`, `bilibili.com/opus/<id>` | Text, image, and video dynamics, with author and engagement counts |
| `b23.tv/<code>` | Whatever the short link points to |

`www.` and `m.` hosts also work. Reposted dynamics fail with `UNSUPPORTED_CONTENT`. Bilibili often rejects anonymous requests for dynamics, which then fail with `ACCESS_RESTRICTED`. Cards are at most 708 pixels wide.

## Fonts

Cards use the system fonts of the machine running Node.js. On Linux, install Chinese and emoji fonts, such as Noto Sans CJK and Noto Color Emoji.

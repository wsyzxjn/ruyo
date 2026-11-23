# @ruyojs/youtube

YouTube adapter for [Ruyo](https://www.npmjs.com/package/ruyo). Renders YouTube videos and Shorts as PNG cards with the thumbnail, title, and channel name.

## Install

```sh
npm install @ruyojs/core @ruyojs/youtube
```

Or install [ruyo](https://www.npmjs.com/package/ruyo), which includes every platform.

## Usage

```ts
import { createRenderer } from '@ruyojs/core'
import { youtubeAdapter } from '@ruyojs/youtube'

const { render } = createRenderer({ adapters: [youtubeAdapter] })
const { png } = await render('https://youtu.be/jNQXAC9IVRw')
```

## Supported links

- `youtube.com/watch?v=<id>`
- `youtu.be/<id>`
- `youtube.com/shorts/<id>`

`m.youtube.com` also works. Shorts are shown upright, centered in a square frame.

The adapter reads YouTube's official oEmbed data, so it only works for videos that allow embedding, and it can't show views, duration, or likes.

## Fonts

Cards use the system fonts of the machine running Node.js. On Linux, install fonts for the scripts and emoji you need, such as Noto Sans CJK and Noto Color Emoji.

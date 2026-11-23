import { createRenderer } from '@ruyojs/core'
import { xAdapter } from '@ruyojs/x'
import { bilibiliAdapter } from '@ruyojs/bilibili'
import { githubAdapter } from '@ruyojs/github'
import { youtubeAdapter } from '@ruyojs/youtube'

export { RuyoError } from '@ruyojs/core'
export type { RenderOptions, RenderResult, NetworkHost, ErrorCode } from '@ruyojs/core'
export const { render } = createRenderer({ adapters: [xAdapter, bilibiliAdapter, githubAdapter, youtubeAdapter] })

import { createRenderer } from '@ruyo/core'
import { xAdapter } from '@ruyo/x'
import { bilibiliAdapter } from '@ruyo/bilibili'
import { githubAdapter } from '@ruyo/github'
import { youtubeAdapter } from '@ruyo/youtube'

export { RuyoError } from '@ruyo/core'
export type { RenderOptions, RenderResult, NetworkHost, ErrorCode } from '@ruyo/core'
export const { render } = createRenderer({ adapters: [xAdapter, bilibiliAdapter, githubAdapter, youtubeAdapter] })

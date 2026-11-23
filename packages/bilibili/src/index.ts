import { readFileSync } from 'node:fs'
import { RuyoError, type Adapter, type NetworkHost, type PrepareText, type ResolvedCard } from '@ruyojs/core'
import { request, loadImage, loadImages, type Run, type Photo } from '@ruyojs/core/adapter'

import { detail, imageUrl, countText, statOrder, type StatKind } from './api.js'
import { archivePreview, videoCard, type Archive, type VideoPreview } from './video.js'

interface BiliDynamic {
  name: string
  avatar?: string
  nicknameColor?: string
  decoration?: string
  date: string
  body: Run[]
  photos: Photo[]
  video?: VideoPreview
  title?: string
  topic?: string
  stats: { kind: StatKind; value: string }[]
}

interface RichText {
  text?: string
  rich_text_nodes?: { type: string; text?: string; orig_text?: string; emoji?: { icon_url: string } }[]
}

interface DynamicItem {
  id_str: string
  type: string
  modules: {
    module_stat?: Partial<Record<StatKind, { count?: number | string; hidden?: boolean } | null>>
    module_author?: {
      name: string; face?: string; pub_time?: string; pub_ts?: number
      vip?: { nickname_color?: string }
      decoration_card?: { card_url?: string }
      decorate?: { card_url?: string }
    }
    module_dynamic?: {
      desc?: RichText
      topic?: { name: string }
      major?: {
        type: string
        opus?: { title?: string; summary: RichText; pics: { url: string; width: number; height: number }[] }
        archive?: Archive
        draw?: { items: { src: string; width: number; height: number }[] }
      }
    }
  }
}

async function resolveBili(id: string, host: NetworkHost): Promise<BiliDynamic> {
  const query = new URLSearchParams({ id, platform: 'web', features: 'itemOpusStyle', timezone_offset: '-480' })
  const data = await detail<{ item?: DynamicItem }>('/x/polymer/web-dynamic/v1/detail?' + query, 'https://t.bilibili.com/' + id, host)
  const item = data?.item
  if (!item || item.id_str !== id) throw new RuyoError('NOT_FOUND', 'Dynamic missing from response')
  if (!['DYNAMIC_TYPE_WORD', 'DYNAMIC_TYPE_DRAW', 'DYNAMIC_TYPE_AV'].includes(item.type))
    throw new RuyoError('UNSUPPORTED_CONTENT', 'Unsupported Bilibili dynamic: ' + item.type)
  const author = item.modules.module_author
  const dynamic = item.modules.module_dynamic
  if (!author?.name || !dynamic) throw new RuyoError('UPSTREAM_ERROR', 'Missing Bilibili author or body')
  const major = dynamic.major
  const video = item.type === 'DYNAMIC_TYPE_AV' && major?.type === 'MAJOR_TYPE_ARCHIVE' ? archivePreview(major.archive) : undefined
  if (item.type === 'DYNAMIC_TYPE_AV' && !video) throw new RuyoError('UNSUPPORTED_CONTENT', 'Video unavailable in Bilibili dynamic')
  if (major && !video && !['MAJOR_TYPE_DRAW', 'MAJOR_TYPE_OPUS', 'MAJOR_TYPE_NONE'].includes(major.type))
    throw new RuyoError('UNSUPPORTED_CONTENT', 'Unsupported Bilibili attachment: ' + major.type)
  const rich = major?.opus?.summary ?? dynamic.desc
  const body: Run[] = rich?.rich_text_nodes?.length ? rich.rich_text_nodes.map(node => ({
    text: node.text ?? node.orig_text ?? '',
    link: !['RICH_TEXT_NODE_TYPE_TEXT', 'RICH_TEXT_NODE_TYPE_EMOJI'].includes(node.type),
    emoji: node.emoji?.icon_url ? imageUrl(node.emoji.icon_url) : undefined
  })) : [{ text: rich?.text ?? '' }]
  const pics = major?.opus?.pics ?? major?.draw?.items.map(p => ({ ...p, url: p.src })) ?? []
  if (item.type === 'DYNAMIC_TYPE_DRAW' && !pics.length)
    throw new RuyoError('UPSTREAM_ERROR', 'Missing Bilibili pictures')
  if (!video && !pics.length && !body.some(run => run.text || run.emoji))
    throw new RuyoError('UPSTREAM_ERROR', 'Missing Bilibili text')
  const decoration = author.decoration_card?.card_url || author.decorate?.card_url
  const stats: BiliDynamic['stats'] = []
  for (const kind of statOrder) {
    const stat = item.modules.module_stat?.[kind]
    const value = countText(stat?.count)
    if (!stat?.hidden && value !== undefined) stats.push({ kind, value })
  }
  return {
    name: author.name, avatar: author.face && imageUrl(author.face),
    nicknameColor: author.vip?.nickname_color?.match(/^#[\da-f]{6}$/i)?.[0],
    decoration: decoration ? imageUrl(decoration) : undefined,
    date: author.pub_time || (author.pub_ts ? new Date(author.pub_ts * 1000).toISOString().slice(0, 10) : ''),
    title: major?.opus?.title ?? undefined, topic: dynamic.topic?.name, body, stats, video,
    photos: pics.map(p => ({ url: imageUrl(p.url), width: p.width, height: p.height }))
  }
}

function resolvePage(url: URL, host: NetworkHost) {
  const main = /^(?:(?:www|m)\.)?bilibili\.com$/.test(url.hostname)
  const video = main && /^\/video\/(BV[0-9A-Za-z]{10}|av[1-9]\d*)\/?$/.exec(url.pathname)
  if (video) return videoCard(video[1], url.searchParams.get('p'), host)
  const match = url.hostname === 't.bilibili.com' ? /^\/(\d+)\/?$/.exec(url.pathname)
    : main ? /^\/opus\/(\d+)\/?$/.exec(url.pathname) : null
  if (!match) return
  return resolveBili(match[1], host).then<ResolvedCard>(async content => {
    const referer = 'https://www.bilibili.com/'
    // The desktop cover is a server-cropped 2x image, including at DPR 1.
    const cover = content.photos.length === 1 ? content.photos[0].url : undefined
    const crop = cover && /^https:\/\/i[0-9]+\.hdslb\.com\/bfs\/[^?#@]+\.(?:jpe?g|png|webp)$/i.test(cover)
    const assets = await loadImages([content.avatar, content.decoration, content.video?.cover, ...content.body.map(run => run.emoji),
      ...content.photos.slice(0, 9).map(p => p.url).filter(url => !crop || url !== cover)], referer, host)
    if (content.photos.length > 1) {
      assets.set('ruyo:bilibili/album-arrow', readFileSync(new URL('../assets/album-arrow.png', import.meta.url)))
    }
    let croppedCover = false
    if (cover && crop) {
      try {
        assets.set(cover, await loadImage(cover + '@1416w_798h_1c.webp', referer, host))
        croppedCover = true
      } catch {
        assets.set(cover, await loadImage(cover, referer, host))
      }
    }
    return {
      async layout(width, { prepareText, imageSize, preflightSystemFonts }) {
        const wasm = await import('#wasm')
        const layout = (measure: PrepareText) => wasm.layout({ ...content, croppedCover }, width, measure, imageSize)
        preflightSystemFonts?.(layout)
        return layout(prepareText)
      },
      assets
    }
  })
}

export const bilibiliAdapter: Adapter = {
  maxWidth: 708,
  resolve(url, _options, host = globalThis) {
    if (url.hostname !== 'b23.tv') return resolvePage(url, host)
    if (!/^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return
    return request(url.href, {}, host, next => next.hostname !== 'b23.tv').then(async target => {
      if (target instanceof URL) {
        const card = resolvePage(target, host)
        if (card) return card
      } else {
        await target.body?.cancel()
      }
      throw new RuyoError('UNSUPPORTED_URL', 'Bilibili short link does not point to a supported video or dynamic')
    })
  }
}

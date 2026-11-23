import { RuyoError, type NetworkHost, type ResolvedCard, type PrepareText } from '@ruyo/core'
import { loadImages } from '@ruyo/core/adapter'
import { countText, detail, imageUrl, statOrder } from './api.js'

export interface VideoPreview {
  cover: string
  title: string
  duration?: string
  meta?: string
}
export interface Archive {
  cover?: string
  title?: string
  duration_text?: string
  stat?: { play?: string; danmaku?: string }
}

export function archivePreview(archive?: Archive): VideoPreview {
  if (!archive?.cover || !archive.title) throw new RuyoError('UPSTREAM_ERROR', 'Missing Bilibili video attachment')
  return {
    title: archive.title, cover: imageUrl(archive.cover), duration: archive.duration_text,
    meta: [archive.stat?.play && archive.stat.play + '播放', archive.stat?.danmaku && archive.stat.danmaku + '弹幕'].filter(Boolean).join(' · ')
  }
}

interface View {
  bvid: string; aid: number; title: string; pic: string; duration: number; pubdate?: number
  owner: { name: string; face?: string }
  pages?: { page: number; part: string; duration: number; first_frame?: string }[]
  stat?: Partial<Record<'view' | 'danmaku' | 'like' | 'coin' | 'favorite' | 'share' | 'reply', number>>
}

function durationText(seconds: number) {
  if (!Number.isSafeInteger(seconds) || seconds < 0) return
  const minutes = Math.floor(seconds / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (minutes >= 60 ? Math.floor(minutes / 60) + ':' + pad(minutes % 60) : String(minutes)) + ':' + pad(seconds % 60)
}

export async function videoCard(id: string, page: string | null, host: NetworkHost): Promise<ResolvedCard> {
  const bv = id.startsWith('BV')
  const query = bv ? 'bvid=' + id : 'aid=' + id.slice(2)
  const referer = 'https://www.bilibili.com/video/' + id + '/'
  const data = await detail<View>('/x/web-interface/view?' + query, referer, host)
  if (!data?.title || !data.pic || !data.owner?.name || (bv ? data.bvid !== id : String(data.aid) !== id.slice(2)))
    throw new RuyoError('UPSTREAM_ERROR', 'Incomplete Bilibili video details')
  const selected = page === null ? undefined : data.pages?.find(p => String(p.page) === page)
  if (page !== null && !selected && !(page === '1' && !data.pages?.length))
    throw new RuyoError('NOT_FOUND', 'Bilibili video part not found')
  const views = countText(data.stat?.view)
  const danmaku = countText(data.stat?.danmaku)
  const video: VideoPreview = {
    title: data.title, cover: imageUrl(selected?.first_frame || data.pic),
    duration: durationText(selected?.duration ?? data.duration),
    meta: [views && views + '播放', danmaku && danmaku + '弹幕'].filter(Boolean).join(' · ')
  }
  const avatar = data.owner.face && imageUrl(data.owner.face)
  const assets = await loadImages([video.cover, avatar], referer, host)
  const stats = statOrder.flatMap(kind => {
    const value = countText(data.stat?.[kind === 'forward' ? 'share' : kind === 'comment' ? 'reply' : kind])
    return value === undefined ? [] : [{ kind, value }]
  })
  const date = data.pubdate && new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(data.pubdate * 1000)
  const content = {
    video, name: data.owner.name, avatar, date: date || undefined, stats,
    part: selected && (data.pages?.length ?? 0) > 1 ? 'P' + selected.page + ' · ' + selected.part : undefined
  }
  return {
    assets,
    async layout(width, { prepareText, preflightSystemFonts }) {
      const wasm = await import('#wasm')
      const layout = (measure: PrepareText) => wasm.videoLayout(content, width, measure)
      preflightSystemFonts?.(layout)
      return layout(prepareText)
    }
  }
}

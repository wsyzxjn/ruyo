import { RuyoError, type Adapter, type PrepareText } from '@ruyojs/core'
import { loadImage, request } from '@ruyojs/core/adapter'

function videoLink(url: URL) {
  let id: string | null | undefined
  let shorts = false
  if (url.hostname === 'youtu.be') {
    id = /^\/([^/]+)\/?$/.exec(url.pathname)?.[1]
  } else if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v')
    else {
      id = /^\/shorts\/([^/]+)\/?$/.exec(url.pathname)?.[1]
      shorts = true
    }
  }
  return id && /^[\w-]{11}$/.test(id) ? { id, shorts } : undefined
}

export const youtubeAdapter: Adapter = {
  resolve(url, _options, host = globalThis) {
    const link = videoLink(url)
    if (!link) return
    const { id, shorts } = link
    // Only a Shorts URL makes oEmbed report the portrait size.
    const page = shorts ? 'https://www.youtube.com/shorts/' + id : 'https://www.youtube.com/watch?v=' + id
    const query = new URLSearchParams({ url: page, format: 'json' })
    return request('https://www.youtube.com/oembed?' + query, { accept: 'application/json' }, host).then(async response => {
      const video = await response.json()
      const thumbnail = typeof video?.thumbnail_url === 'string' && URL.parse(video.thumbnail_url)
      if (video?.type !== 'video' || typeof video.title !== 'string' || !video.title.trim() ||
          typeof video.author_name !== 'string' || !video.author_name.trim() || !thumbnail || thumbnail.protocol !== 'https:')
        throw new RuyoError('UPSTREAM_ERROR', 'Incomplete YouTube video metadata')
      // oEmbed's thumbnail is 480px wide and letterboxed. Prefer the full-resolution frame, or a Short's
      // portrait original, which not every video has.
      const sharp = 'https://i.ytimg.com/vi/' + id + (shorts ? '/oar2.jpg' : '/maxresdefault.jpg')
      const cover = await loadImage(sharp, 'https://www.youtube.com/', host)
        .catch(() => loadImage(thumbnail.href, 'https://www.youtube.com/', host))
      return {
        assets: new Map([['cover', cover]]),
        async layout(width, { prepareText, imageSize, preflightSystemFonts }) {
          const wasm = await import('#wasm')
          const [iw, ih] = imageSize('cover')
          const ratio = Number.isFinite(video.width) && video.width > 0 && Number.isFinite(video.height) && video.height > 0
            ? video.height / video.width : ih / iw
          const layout = (measure: PrepareText) => wasm.layout(video.title, video.author_name, width, ratio, measure)
          preflightSystemFonts?.(layout)
          return layout(prepareText)
        }
      }
    })
  }
}

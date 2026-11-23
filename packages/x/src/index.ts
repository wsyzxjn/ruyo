import { readFileSync } from 'node:fs'
import { fonts, splitEmoji } from './fonts.js'
import { RuyoError, type Adapter, type NetworkHost, type RenderOptions } from '@ruyo/core'
import { request, loadImage, type Run, type Photo } from '@ruyo/core/adapter'

const defaultAvatar = 'ruyo:x/default-avatar'

interface XPost {
  name: ReturnType<typeof splitEmoji>
  avatar: string
  date: string
  body: ReturnType<typeof splitEmoji>
  photos: Photo[]
  handle: string
  verified?: 'blue' | 'business' | 'government'
  squareAvatar: boolean
  affiliate?: string
  counts: { replies: number; reposts: number; likes: number; views: number }
}

type JsonObject = { [key: string]: unknown }
function object(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface Entity { indices?: [number, number]; from_index?: number; to_index?: number; url?: string; display_url?: string }
interface Tweet {
  details: { full_text: string; display_text_range?: [number, number]; created_at_ms?: number; hashtag_entities?: Entity[] }
  core?: { user_results?: { result?: {
    core?: { name: string; screen_name: string }
    avatar?: { image_url: string }
    profile_image_shape?: string
    verification?: { verified_type?: string; is_blue_verified?: boolean }
    identity_profile_labels_highlighted_label?: { label?: { badge?: { url?: string } } }
  } } }
  counts?: { reply_count?: number; retweet_count?: number; quote_count?: number; favorite_count?: number }
  views?: { count?: string }
  media_entities2?: { type: string; media_url_https: string; original_info: { width: number; height: number } }[]
  url_entities?: Entity[]
  mention_entities?: Entity[]
  quoted_tweet_results?: { result?: unknown }
  nested_quoted_tweet_results?: { result?: unknown }
  retweeted_status_results?: { result?: unknown }
  legacy?: { is_quote_status?: boolean }
  card?: unknown
}

function mergeMissing(target: JsonObject, other: JsonObject) {
  for (const [key, value] of Object.entries(other)) {
    const current = target[key]
    if (!Object.hasOwn(target, key) || current === null ||
        (Array.isArray(current) && current.length === 0)) {
      Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true })
    } else if (object(current) && object(value)) mergeMissing(current, value)
  }
}

function extractTweet(html: string, id: string): Tweet {
  const copies: JsonObject[] = []
  function visit(value: unknown) {
    if (Array.isArray(value)) value.forEach(visit)
    if (!object(value)) return
    if (value.__typename === 'Tweet' && value.rest_id === id && object(value.details) &&
        typeof value.details.full_text === 'string') copies.push(value)
    Object.values(value).forEach(visit)
  }

  // X embeds escaped JSON strings inside its server-rendered page.
  for (const [quoted] of html.matchAll(/"(?:\\[\s\S]|[^"\\])*"/g)) {
    if (!quoted.includes('full_text')) continue
    let decoded: unknown
    try { decoded = JSON.parse(JSON.parse(quoted)) } catch { continue }
    visit(decoded)
  }
  if (!copies.length) throw new RuyoError('NOT_FOUND', 'X page has no embedded post ' + id)
  // A longer transport fragment may contain unrelated metadata and only a stub body.
  const richness = (copy: JsonObject) => {
    const body = (copy.details as { full_text: string }).full_text.length
    const media = Array.isArray(copy.media_entities2) ? copy.media_entities2.length : 0
    return { body, media, fields: Object.keys(copy).length }
  }
  copies.sort((a, b) => {
    const left = richness(a), right = richness(b)
    return right.body - left.body || right.media - left.media || right.fields - left.fields
  })
  const [tweet, ...rest] = copies
  for (const copy of rest) mergeMissing(tweet, copy)
  return tweet as unknown as Tweet
}

function decodeText(value: string) {
  const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }
  return value.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => entities[entity])
}

function textRuns(tweet: Tweet): Run[] {
  const points = [...tweet.details.full_text]
  const [start, end] = tweet.details.display_text_range ?? [0, points.length]
  const runs: Run[] = []
  const entities = [...tweet.url_entities ?? [], ...tweet.mention_entities ?? [], ...tweet.details.hashtag_entities ?? []]
  const spans = entities.map(entity => {
    let [from, to] = entity.indices ?? [entity.from_index, entity.to_index]
    if (from === undefined && entity.url) {
      const offset = tweet.details.full_text.indexOf(entity.url)
      if (offset >= 0) {
        from = [...tweet.details.full_text.slice(0, offset)].length
        to = from + [...entity.url].length
      }
    }
    return { from, to, label: entity.display_url }
  }).filter((s): s is { from: number; to: number; label: string | undefined } =>
    typeof s.from === 'number' && typeof s.to === 'number' && s.from >= start && s.to <= end && s.to > s.from)
  let cursor = start
  for (const { from, to, label } of spans.sort((a, b) => a.from - b.from)) {
    if (from < cursor) continue
    if (cursor < from) runs.push({ text: decodeText(points.slice(cursor, from).join('')) })
    runs.push({ text: decodeText(label ?? points.slice(from, to).join('')), link: true })
    cursor = to
  }
  if (cursor < end) runs.push({ text: decodeText(points.slice(cursor, end).join('')) })
  return runs
}

function timelineDate(time: number, now = Date.now()): string {
  const elapsed = Math.floor((now - time) / 1000)
  if (elapsed <= 0) return 'Now'
  if (elapsed < 60) return elapsed + 's'
  if (elapsed < 3600) return Math.floor(elapsed / 60) + 'm'
  if (elapsed < 86400) return Math.floor(elapsed / 3600) + 'h'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
    year: new Date(time).getUTCFullYear() === new Date(now).getUTCFullYear() ? undefined : 'numeric'
  }).format(time)
}

function photoUrl(src: string, count: number, { width, dpr }: Required<RenderOptions>) {
  const url = new URL(src)
  if (url.hostname !== 'pbs.twimg.com') return src
  const ext = /\.(jpg|jpeg|webp|png)$/i.exec(url.pathname)
  if (ext) {
    url.searchParams.set('format', ext[1])
    url.pathname = url.pathname.slice(0, -ext[0].length)
  }
  const content = Math.min(width, 600) - 80
  const slot = count === 1 ? content : (content - 4) * (count === 3 ? 0.6 : 0.5)
  const pixels = slot * dpr
  url.searchParams.set('name', pixels <= 680 ? 'small' : pixels <= 1200 ? 'medium' : 'large')
  return url.href
}

async function resolveX(id: string, handle: string | undefined, host: NetworkHost): Promise<XPost> {
  const headers = {
    accept: 'text/html',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
  }
  const canonical = 'https://x.com/i/status/' + id
  let response: Response
  if (handle && handle !== 'i') {
    try { response = await request('https://x.com/' + handle + '/status/' + id, headers, host) }
    catch { response = await request(canonical, headers, host) }
  } else response = await request(canonical, headers, host)
  const tweet = extractTweet(await response.text(), id)
  const media = tweet.media_entities2 ?? []
  if (tweet.quoted_tweet_results?.result || tweet.nested_quoted_tweet_results?.result ||
      tweet.legacy?.is_quote_status || tweet.retweeted_status_results?.result ||
      media.some(m => m.type !== 'photo') || tweet.card)
    throw new RuyoError('UNSUPPORTED_CONTENT', 'Expected an original X text or photo post')
  const user = tweet.core?.user_results?.result
  if (!user?.core?.name || !user.core.screen_name) throw new RuyoError('UPSTREAM_ERROR', 'Missing X author')
  const time = tweet.details.created_at_ms
  const verification = user.verification
  return {
    name: splitEmoji({ text: user.core.name }), handle: user.core.screen_name,
    avatar: user.avatar?.image_url ?? defaultAvatar,
    squareAvatar: user.profile_image_shape === 'Square',
    verified: verification?.verified_type === 'Business' ? 'business'
      : verification?.verified_type === 'Government' ? 'government' : verification?.is_blue_verified ? 'blue' : undefined,
    affiliate: user.identity_profile_labels_highlighted_label?.label?.badge?.url,
    counts: {
      replies: tweet.counts?.reply_count ?? 0,
      reposts: (tweet.counts?.retweet_count ?? 0) + (tweet.counts?.quote_count ?? 0),
      likes: tweet.counts?.favorite_count ?? 0,
      views: Number(tweet.views?.count) || 0
    },
    date: time ? timelineDate(time) : '',
    body: textRuns(tweet).flatMap(splitEmoji),
    photos: media.map(m => ({ url: m.media_url_https, width: m.original_info.width, height: m.original_info.height }))
  }
}

async function loadXImages(post: XPost, options: Required<RenderOptions>, host: NetworkHost) {
  // Keep original URLs as the layout keys. The CDN may only have the payload's original variant.
  const variants = new Map(post.photos.map(p => [p.url, photoUrl(p.url, post.photos.length, options)]))
  if (post.avatar !== defaultAvatar) {
    const size = 40 * options.dpr
    const suffix = size <= 48 ? '_normal' : size <= 96 ? '_x96' : '_reasonably_small'
    variants.set(post.avatar, post.avatar.replace(/_(normal|bigger|x96|reasonably_small)(?=\.[^/.?]+(?:\?|$))/, suffix))
  }
  if (post.affiliate) variants.set(post.affiliate, post.affiliate)
  const assets = new Map<string, Uint8Array>()
  await Promise.all([...variants].map(async ([original, preferred]) => {
    try {
      assets.set(original, await loadImage(preferred, 'https://x.com/', host))
    } catch (error) {
      if (preferred === original) throw error
      assets.set(original, await loadImage(original, 'https://x.com/', host))
    }
  }))
  if (post.avatar === defaultAvatar) {
    assets.set(defaultAvatar, readFileSync(new URL('../assets/default-avatar.png', import.meta.url)))
  }
  return assets
}

export const xAdapter: Adapter = {
  fonts,
  maxWidth: 600,
  resolve(url, options = { width: 600, dpr: 2 }, host = globalThis) {
    if (!/^(?:(?:www|mobile)\.)?(?:x|twitter)\.com$/.test(url.hostname)) return
    const match = /^\/(\w+|i\/web)\/status(?:es)?\/(\d+)(?:\/photo\/\d+)?\/?$/.exec(url.pathname)
    if (!match) return
    return resolveX(match[2], match[1] === 'i/web' ? undefined : match[1], host).then(async content => ({
      async layout(width, { prepareText }) {
        const wasm = await import('#wasm')
        return wasm.layout(content, width, prepareText)
      },
      assets: await loadXImages(content, options, host)
    }))
  }
}

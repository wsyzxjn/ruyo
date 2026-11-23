import type { NetworkHost } from '@ruyojs/core'
import { request } from '@ruyojs/core/adapter'

export interface Actor {
  login: string
  avatar_url?: string
}

export interface Preview {
  kind: 'repository' | 'issue' | 'pull' | 'release' | 'commit' | 'discussion' | 'profile'
  author: Actor | null
  /** Replaces the author's login in the byline; empty when the header already names them. */
  byline?: string
  context: string
  /** What the card shows, at the header's right edge. */
  label: string
  date?: string
  facts?: { icon: 'link' | 'branch' | 'fork' | 'organization' | 'location' | 'milestone' | 'person'; text: string; link?: boolean }[]
  chips?: { text: string; color?: string }[]
  reactions?: { text: string }[]
  blocks?: {
    kind: 'heading' | 'paragraph' | 'list' | 'code' | 'quote' | 'image' | 'more'
    runs: { text: string; style?: string }[]
    /** Ordered list number, such as `3.`. */
    marker?: string
    /** Task list state. */
    checked?: boolean
  }[]
  image?: string
  details?: { title: string; rows: { name: string; value?: string; tag?: string }[] }[]
  languages?: { name: string; percent: number; color: string }[]
  diff?: { additions: number; deletions: number; base?: string; head?: string }
  title: string
  badge: string
  body?: string | null
  metrics: {
    icon:
      | 'star'
      | 'fork'
      | 'language'
      | 'license'
      | 'comments'
      | 'files'
      | 'people'
      | 'repo'
      | 'assets'
      | 'upvotes'
      | 'watch'
      | 'issues'
      | 'commits'
      | 'downloads'
    text: string
  }[]
}

const headers = {
  accept: 'application/vnd.github.full+json',
  'user-agent': 'Ruyo',
  'x-github-api-version': '2022-11-28'
}
const numbers = new Intl.NumberFormat('en-US')
export const formatCount = (n: number, unit: string) => numbers.format(n) + ' ' + unit + (n === 1 ? '' : 's')

export async function read<T>(path: string, host: NetworkHost): Promise<T> {
  return (await request('https://api.github.com' + path, headers, host)).json() as Promise<T>
}

const words = new Intl.Segmenter(undefined, { granularity: 'word' })

/** The longest prefix of `text` within `limit` code points that ends between words. */
export function clip(text: string, limit: number) {
  let end = 0
  let points = 0
  for (const { segment, index } of words.segment(text)) {
    points += Array.from(segment).length
    if (points > limit) break
    end = index + segment.length
  }
  return end ? text.slice(0, end) : Array.from(text).slice(0, limit).join('')
}

export function excerpt(value: string | null | undefined) {
  const body = (value ?? '').replace(/\s+/gu, ' ').trim()
  return Array.from(body).length > 280 ? clip(body, 280).trimEnd() + '…' : body
}

/** A URL as GitHub's sidebar shows it, without the scheme. */
export function displayUrl(value: string) {
  return value.replace(/^https?:\/\//i, '').replace(/\/$/, '')
}

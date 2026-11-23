import { RuyoError, type NetworkHost } from '@ruyo/core'
import { request } from '@ruyo/core/adapter'

export const statOrder = ['like', 'coin', 'favorite', 'forward', 'comment'] as const
export type StatKind = typeof statOrder[number]

export function imageUrl(src: string) {
  return new URL(src, 'https://www.bilibili.com').href.replace(/^http:/, 'https:')
}

export function countText(raw: unknown) {
  const count = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return
  return count >= 1e8 ? (count / 1e8).toFixed(1) + '亿'
    : count >= 1e4 ? (count / 1e4).toFixed(1) + '万' : String(count)
}

export async function detail<T>(path: string, referer: string, host: NetworkHost) {
  const response = await request('https://api.bilibili.com' + path, { referer, accept: 'application/json' }, host)
  const result = await response.json() as { code: number; message?: string; data?: T }
  if (result.code !== 0) {
    const code = [-352, -412, -403, -101].includes(result.code) ? 'ACCESS_RESTRICTED'
      : [-404, 4101131, 62002].includes(result.code) ? 'NOT_FOUND'
      : result.code === 62012 ? 'ACCESS_RESTRICTED' : 'UPSTREAM_ERROR'
    throw new RuyoError(code, 'Bilibili detail returned ' + result.code + ' (' + result.message + ')')
  }
  return result.data
}

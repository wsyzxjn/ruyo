import type { NetworkHost } from './index.js'
import { RuyoError } from './errors.js'

export interface Run { text: string; link?: boolean; emoji?: string }
export interface Photo { url: string; width: number; height: number }

export function request(url: string, headers: Record<string, string>, host?: NetworkHost): Promise<Response>
/** Stop before fetching a redirect destination that the adapter can resolve itself. */
export function request(url: string, headers: Record<string, string>, host: NetworkHost, stopAt: (url: URL) => boolean): Promise<Response | URL>
export async function request(url: string, headers: Record<string, string>, host: NetworkHost = globalThis, stopAt?: (url: URL) => boolean): Promise<Response | URL> {
  const signal = AbortSignal.timeout(15_000)
  const requestHeaders = new Headers(headers)
  for (let hops = 0; ; hops++) {
    let response: Response
    try {
      response = await host.fetch(url, { headers: requestHeaders, signal, redirect: 'manual' })
    } catch (cause) {
      throw new RuyoError('UPSTREAM_ERROR', 'Could not reach ' + new URL(url).hostname, { cause })
    }
    if (response.ok) return response
    if (response.type === 'opaqueredirect')
      throw new RuyoError('UPSTREAM_ERROR', 'The network host must expose redirect status and Location')
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      const code = response.status === 404 || response.status === 410 ? 'NOT_FOUND'
        : [401, 403, 412, 429].includes(response.status) ? 'ACCESS_RESTRICTED' : 'UPSTREAM_ERROR'
      throw new RuyoError(code, new URL(url).hostname + ' returned HTTP ' + response.status)
    }
    await response.body?.cancel()
    const location = response.headers.get('location')
    const next = location && URL.parse(location, url)
    if (!next || !['https:', 'http:'].includes(next.protocol) || next.username || next.password)
      throw new RuyoError('UPSTREAM_ERROR', 'Invalid redirect from ' + new URL(url).hostname)
    if (hops >= 10) throw new RuyoError('UPSTREAM_ERROR', 'Exceeded 10 redirects')
    if (stopAt?.(next)) return next
    if (next.origin !== new URL(url).origin) {
      for (const name of ['authorization', 'proxy-authorization', 'cookie', 'host']) requestHeaders.delete(name)
    }
    url = next.href
  }
}

export async function loadImage(src: string, referer: string, host?: NetworkHost): Promise<Uint8Array> {
  try {
    const response = await request(src, { referer }, host)
    return new Uint8Array(await response.arrayBuffer())
  } catch (cause) {
    throw new RuyoError('ASSET_ERROR', 'Could not download image ' + src, { cause })
  }
}

export async function loadImages(sources: Iterable<string | undefined>, referer: string, host?: NetworkHost): Promise<Map<string, Uint8Array>> {
  const assets = new Map<string, Uint8Array>()
  await Promise.all([...new Set(sources)].map(async src => {
    if (src) assets.set(src, await loadImage(src, referer, host))
  }))
  return assets
}

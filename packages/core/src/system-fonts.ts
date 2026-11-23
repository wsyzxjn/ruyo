import { execFileSync } from 'node:child_process'
import { globSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Renderer } from '#wasm'
import { RuyoError } from './errors.js'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

// Fontconfig orders the faces for the host's system-ui alias and exposes their
// coverage, including the installed fallbacks for scripts outside that face.
function fontconfigFiles(groups: string[][]): string[][] {
  const results = groups.map(() => new Set<string>())
  for (const weight of ['regular', 'demibold', 'bold']) {
    const remaining = groups.map(group => new Set(group.flatMap(cluster => Array.from(cluster, ch => ch.codePointAt(0)!))))
    const matches = execFileSync('fc-match', ['-s', '-f', '%{file}\t%{charset}\n', 'system-ui:weight=' + weight], { encoding: 'utf8' })
    for (const [index, line] of matches.trimEnd().split('\n').entries()) {
      const [file, charset] = line.split('\t')
      if (!file || !charset) continue
      const ranges = charset.split(' ').map(range => range.split('-').map(n => parseInt(n, 16)))
      for (const [i, points] of remaining.entries()) {
        if (index === 0) results[i].add(file)
        for (const cp of points) {
          if (ranges.some(([start, end = start]) => start <= cp && cp <= end)) {
            results[i].add(file)
            points.delete(cp)
          }
        }
      }
      if (remaining.every(points => !points.size)) break
    }
  }
  const needsEmoji = groups.map(group => group.some(cluster => /[\p{Emoji_Presentation}\uFE0F\u20E3]/u.test(cluster)))
  if (needsEmoji.includes(true)) {
    const emoji = execFileSync('fc-match', ['-f', '%{file}', 'emoji:color=true'], { encoding: 'utf8' })
    if (emoji) needsEmoji.forEach((needed, i) => { if (needed) results[i].add(emoji) })
  }
  return results.map(files => [...files])
}

// Ask the macOS or Windows helper script, which reads one JSON request from stdin.
function platformQuery(request: object) {
  const dir = new URL('../system-fonts/', import.meta.url)
  const opts = { input: JSON.stringify(request), encoding: 'utf8' } as const
  const output = process.platform === 'darwin'
    ? execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', fileURLToPath(new URL('macos.js', dir))], opts)
    : execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', readFileSync(new URL('windows.ps1', dir), 'utf8')], opts)
  return JSON.parse(output)
}

function systemFiles(groups: string[][]): string[][] {
  if (process.platform === 'darwin') {
    const paths: string[][] = platformQuery({ groups })
    let pingFang: string | undefined
    return paths.map(group => group.map(path => {
      // Recent macOS ships UI PingFang with Apple-only hvgl outlines.
      // Use the installed OpenType edition, or the web stack's next CJK face.
      if (basename(path) !== 'PingFangUI.ttc') return path
      return pingFang ??= globSync('/System/Library/AssetsV2/com_apple_MobileAsset_Font*/*.asset/AssetData/PingFang.ttc')[0]
        ?? '/System/Library/Fonts/Hiragino Sans GB.ttc'
    }))
  }
  if (process.platform === 'win32') return platformQuery({ groups })
  return fontconfigFiles(groups)
}

// The host's default fixed-pitch faces, as browsers use them for the generic monospace family.
function monospaceFiles(): string[] {
  if (process.platform === 'darwin' || process.platform === 'win32') return [platformQuery({ monospace: true })].flat()
  return [...new Set(['regular', 'bold'].map(weight =>
    execFileSync('fc-match', ['-f', '%{file}', 'monospace:weight=' + weight], { encoding: 'utf8' })).filter(Boolean))]
}

function resolveFiles(groups: string[][]) {
  try {
    return systemFiles(groups)
  } catch (cause) {
    throw new RuyoError('ASSET_ERROR', 'Could not load fonts from the host system', { cause })
  }
}

export class SystemFonts {
  private readonly seen = new Set<string>()
  private readonly files = new Set<string>()
  private monospace = false

  private missing(text: string, uncovered?: string) {
    const characters = uncovered === undefined ? undefined : new Set(uncovered)
    const missing = new Set<string>()
    for (const { segment } of segmenter.segment(text)) {
      if (!segment.trim() || this.seen.has(segment)) continue
      if (!characters || Array.from(segment).some(ch => characters.has(ch))) missing.add(segment)
    }
    return [...missing]
  }

  prefetch(texts: string[]): Map<string, string[]> {
    const pending = new Set<string>()
    const groups: string[][] = []
    for (const text of texts) {
      const group = this.missing(text).filter(segment => !pending.has(segment))
      if (group.length) groups.push(group)
      for (const segment of group) pending.add(segment)
    }
    if (!groups.length) return new Map()
    // Store paths only. Registering a later paragraph's fallback early can change earlier glyphs.
    const paths = resolveFiles(groups)
    return new Map(groups.map((group, i) => [JSON.stringify(group), paths[i]]))
  }

  load(engine: Renderer, text: string, uncovered?: string, prefetch?: () => Map<string, string[]>) {
    const missing = this.missing(text, uncovered)
    if (!missing.length) return
    const paths = prefetch?.().get(JSON.stringify(missing)) ?? resolveFiles([missing])[0]
    try {
      if (!paths.length) throw new Error('No installed system UI fonts found')
      for (const path of paths) {
        if (this.files.has(path)) continue
        engine.registerSystemFont(readFileSync(path))
        this.files.add(path)
      }
      for (const segment of missing) this.seen.add(segment)
    } catch (cause) {
      throw new RuyoError('ASSET_ERROR', 'Could not load fonts from the host system', { cause })
    }
  }

  /** Register the host's fixed-pitch faces as the generic monospace family. Other scripts still fall back per grapheme. */
  loadMonospace(engine: Renderer) {
    if (this.monospace) return
    try {
      for (const path of monospaceFiles()) {
        engine.registerSystemFont(readFileSync(path), 'monospace')
        this.files.add(path)
      }
    } catch (cause) {
      throw new RuyoError('ASSET_ERROR', 'Could not load the host monospace font', { cause })
    }
    this.monospace = true
  }
}

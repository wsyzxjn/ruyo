import { readFileSync } from 'node:fs'
import type { AdapterFontFace } from '@ruyojs/core'
import type { Run } from '@ruyojs/core/adapter'

interface Face extends Omit<AdapterFontFace, 'file' | 'ranges'> {
  file: string
  kind: string
  ranges: [number, number][]
}

const manifest = new URL('../fonts/manifest.json', import.meta.url)
const faces: Face[] = JSON.parse(readFileSync(manifest, 'utf8'))
const emojiRanges = faces.find(face => face.kind === 'emoji')!.ranges
const chirpRanges = faces.filter(face => face.kind === 'chirp' && face.weight === 400).flatMap(face => face.ranges)
const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' })

// The manifest limits implicit fallback. Explicit emoji sequences can use the full emoji cmap.
export const fonts: AdapterFontFace[] = faces.map(({ file, family, weight, ranges, kind }) => ({
  file: new URL(file, manifest), family, weight, ranges: kind === 'emoji' ? undefined : ranges
}))

export function splitEmoji({ text, link = false }: Run) {
  const runs: { text: string; link?: boolean; colorEmoji?: boolean }[] = []
  let start = 0
  for (const { segment, index } of graphemes.segment(text)) {
    if (!/^\p{Emoji}/u.test(segment) || segment.includes('\uFE0E')) continue
    const cp = segment.codePointAt(0)!
    const covers = ([from, to]: [number, number]) => from <= cp && cp <= to
    const explicit = /[\uFE0F\u20E3\u200D\p{Emoji_Modifier}\u{E0020}-\u{E007F}]/u.test(segment)
    if (!explicit && (chirpRanges.some(covers) || !emojiRanges.some(covers))) continue
    if (index > start) runs.push({ text: text.slice(start, index), link })
    runs.push({ text: segment, link, colorEmoji: true })
    start = index + segment.length
  }
  if (start < text.length) runs.push({ text: text.slice(start), link })
  return runs
}

import { readFileSync } from 'node:fs'
import { Frame, Renderer } from '#wasm'
import { SystemFonts } from './system-fonts.js'
import { RuyoError } from './errors.js'

export { RuyoError }
export type { ErrorCode } from './errors.js'

export interface NetworkHost { fetch: typeof globalThis.fetch }
export interface RenderOptions { width?: number; dpr?: number }
export interface RenderResult { png: Uint8Array; width: number; height: number }

export interface Paragraph {
  runs: readonly { text: string; style?: string; image?: string }[]
  style: string
  maxWidth: number
  lang?: string
}
export interface TextBlock { id: number; width: number; height: number }
export type PrepareText = (paragraph: Paragraph) => TextBlock
export interface LayoutContext {
  prepareText: PrepareText
  /** On the first host-font miss, collect paragraphs from a pure synchronous layout using provisional sizes. */
  preflightSystemFonts?(layout: (measure: PrepareText) => DisplayList): void
  imageSize(src: string): readonly [number, number]
}
export type Color = readonly [number, number, number, number]
export interface BoxPaint {
  radius?: number
  squircle?: boolean
  fill?: Color
  border?: readonly [number, Color]
  inset?: number
  contain?: boolean
  rotateHalfTurn?: boolean
  blur?: number
}
export type DrawItem = {
  x: number; y: number; width: number; height: number
  clip?: readonly [number, number, number, number]
} & (
  | { kind: 'text'; id: number }
  | { kind: 'rect'; paint: BoxPaint }
  | { kind: 'image'; src: string; paint: BoxPaint }
  | { kind: 'svg'; svg: string }
)
export interface DisplayList {
  height: number
  /** RGBA, default opaque white. */
  background?: Color
  /** Corner radii clockwise from top left, in CSS pixels. */
  radii?: readonly [number, number, number, number]
  items: readonly DrawItem[]
}
export interface ResolvedCard {
  /** Position measured text and artwork in CSS pixels. Text ids belong to this layout call. */
  layout(width: number, context: LayoutContext): DisplayList | Promise<DisplayList>
  assets: Map<string, Uint8Array>
}

export interface AdapterFontFace {
  file: URL
  family: string
  weight?: number
  /** Inclusive Unicode codepoint ranges, as in CSS @font-face. */
  ranges?: readonly (readonly [number, number])[]
}

export interface Adapter {
  /** Maximum width of this platform’s card column, in CSS pixels. */
  readonly maxWidth?: number
  /** Adapter fonts in priority order. Uncovered text falls back to host system fonts. */
  readonly fonts?: readonly (URL | AdapterFontFace)[]
  /** Return undefined for URLs this adapter does not handle. */
  resolve(url: URL, options?: Required<RenderOptions>, host?: NetworkHost): Promise<ResolvedCard> | undefined
}

interface Engine {
  renderer: Renderer
  systemFonts: SystemFonts
  hasOverrides: boolean
}
const engines = new WeakMap<Adapter, Engine>()

function engineFor(adapter: Adapter): Engine {
  const cached = engines.get(adapter)
  if (cached) return cached
  const engine = new Renderer()
  try {
    for (const font of adapter.fonts ?? []) {
      if (font instanceof URL) engine.registerFont(readFileSync(font), undefined)
      else engine.registerFont(readFileSync(font.file), font)
    }
  } catch (cause) {
    engine.free()
    throw new RuyoError('ASSET_ERROR', 'Could not load adapter fonts', { cause })
  }
  const context = { renderer: engine, systemFonts: new SystemFonts(), hasOverrides: Boolean(adapter.fonts?.length) }
  engines.set(adapter, context)
  return context
}

export function createRenderer({ adapters, host: defaultHost = globalThis }: { adapters: readonly Adapter[]; host?: NetworkHost }) {
  async function render(input: string | URL, { width = 600, dpr = 2 }: RenderOptions = {}, host: NetworkHost = defaultHost): Promise<RenderResult> {
    if (!Number.isInteger(width) || width < 160 || width > 1200 || !Number.isFinite(dpr) || dpr < 1 || dpr > 4)
      throw new RuyoError('INVALID_OPTIONS', 'Use a width of 160–1200 CSS pixels and a DPR of 1–4')

    const url = URL.parse(input.toString())
    if (url && ['http:', 'https:'].includes(url.protocol)) {
      for (const adapter of adapters) {
        const cardWidth = Math.min(width, adapter.maxWidth ?? width)
        let card: ResolvedCard
        try {
          const pending = adapter.resolve(url, { width: cardWidth, dpr }, host)
          if (!pending) continue
          card = await pending
        } catch (cause) {
          if (cause instanceof RuyoError) throw cause
          throw new RuyoError('UPSTREAM_ERROR', 'Invalid platform response', { cause })
        }
        return drawCard(engineFor(adapter), card, cardWidth, dpr)
      }
    }
    throw new RuyoError('UNSUPPORTED_URL', 'No registered adapter handles this URL')
  }
  return { render }
}

function paragraphText(paragraph: Paragraph) {
  return paragraph.runs.map(run => run.image ? '' : run.text).join('')
}

const monospace = /font-family:[^;]*\bmonospace\b/
function usesMonospace(paragraph: Paragraph) {
  return monospace.test(paragraph.style) || paragraph.runs.some(run => run.style && monospace.test(run.style))
}

async function drawCard({ renderer, systemFonts, hasOverrides }: Engine, card: ResolvedCard, width: number, dpr: number): Promise<RenderResult> {
  try {
    const frame = new Frame(width, dpr)
    try {
      for (const [src, bytes] of card.assets) frame.addImage(src, bytes)
      let prefetch: (() => Map<string, string[]>) | undefined
      const prepareText: PrepareText = paragraph => {
        const text = paragraphText(paragraph)
        if (!hasOverrides) systemFonts.load(renderer, text, undefined, prefetch)
        // After the UI faces, which unmatched generic families fall back to in registration order.
        if (usesMonospace(paragraph)) systemFonts.loadMonospace(renderer)
        const prepared: TextBlock | string = frame.prepare(renderer, paragraph, hasOverrides)
        if (typeof prepared !== 'string') return prepared
        systemFonts.load(renderer, text, prepared)
        return frame.prepare(renderer, paragraph, false)
      }
      const list = await card.layout(width, {
        prepareText,
        preflightSystemFonts(layout) {
          if (hasOverrides) return
          let paths: Map<string, string[]> | undefined
          prefetch = () => {
            if (paths) return paths
            const texts: string[] = []
            layout(paragraph => {
              texts.push(paragraphText(paragraph))
              return { id: texts.length - 1, width: 0, height: 0 }
            })
            paths = systemFonts.prefetch(texts)
            return paths
          }
        },
        imageSize(src) {
          const [width, height] = frame.imageSize(src)
          return [width, height]
        }
      })
      const png = frame.draw(renderer, list)
      const header = new DataView(png.buffer, png.byteOffset, png.byteLength)
      return { png, width: header.getUint32(16), height: header.getUint32(20) }
    } finally {
      frame.free()
    }
  } catch (cause) {
    if (cause instanceof RuyoError) throw cause
    if (String(cause).includes('Invalid image:')) throw new RuyoError('ASSET_ERROR', String(cause), { cause })
    throw new RuyoError('RENDER_ERROR', 'Could not render card', { cause })
  }
}

import { DomUtils as dom, parseDocument } from 'htmlparser2'
import { clip, excerpt, type Preview } from './api.js'

type Element = NonNullable<ReturnType<typeof dom.findOne>>
type Node = Element['children'][number]
type Block = NonNullable<Preview['blocks']>[number]

const isElement = (node: { type: string } | null): node is Element => node?.type === 'tag'

const inlineCode =
  'font-family:monospace;font-size:85%;background-color:rgba(129,139,152,0.12);border-radius:6px;padding:0.2em 0.4em'

function hosted(src: string | undefined, page: string) {
  const url = src ? URL.parse(src, page) : null
  return url?.protocol === 'https:' && (url.hostname === 'github.com' || url.hostname.endsWith('.githubusercontent.com'))
    ? url.href
    : undefined
}

const picture = (node: Element, page: string) =>
  dom.findOne((e) => e.name === 'img' && !e.attribs.class?.includes('emoji') && !!hosted(e.attribs.src, page), [node])

function listMarker(item: Element): Pick<Block, 'marker' | 'checked'> {
  const box = dom.findOne((e) => e.name === 'input' && e.attribs.type === 'checkbox', item.children)
  if (box) return { checked: 'checked' in box.attribs }
  const list = item.parent
  if (!isElement(list) || list.name !== 'ol') return {}
  const start = Number.parseInt(list.attribs.start ?? '1', 10)
  const items = list.children.filter((child) => isElement(child) && child.name === 'li')
  return { marker: (Number.isNaN(start) ? 1 : start) + items.indexOf(item) + '.' }
}

// GitHub supplies rendered Markdown via the full+json media type. Keep its semantic
// blocks and inline formatting, while Rust owns the card's layout and line wrapping.
// The excerpt ends between words, and only an image inside it is shown, where it appears.
export function article(
  html: string | undefined,
  plain: string | null | undefined,
  page: string
): Pick<Preview, 'blocks' | 'body' | 'image'> {
  if (!html) return { body: excerpt(plain) }
  const doc = parseDocument(html)
  const blocks: Block[] = []
  let remaining = 1000
  let truncated = false
  let image: string | undefined
  function inline(node: Node, runs: Block['runs'], style: string, pre: boolean) {
    if (node.type === 'text') {
      if (node.data) runs.push({ text: node.data, style })
    } else if (
      node.type === 'tag' &&
      node.name !== 'svg' &&
      node.name !== 'img' &&
      node.attribs['aria-hidden'] !== 'true'
    ) {
      if (node.name === 'br') runs.push({ text: '\n' })
      const next = (
        {
          a: 'color:#0969da',
          code: pre ? '' : inlineCode,
          strong: 'font-weight:600',
          em: 'font-style:italic'
        } as Record<string, string>
      )[node.name]
      for (const child of node.children) inline(child, runs, next ? [style, next].filter(Boolean).join(';') : style, pre)
    }
  }
  function attachImage(node: Element) {
    if (image) return
    image = hosted(picture(node, page)?.attribs.src, page)
    if (image) blocks.push({ kind: 'image', runs: [] })
  }
  function visit(node: Node) {
    if (!isElement(node) || truncated) return
    const kind = /^h[1-6]$/.test(node.name)
      ? 'heading'
      : node.name === 'pre'
        ? 'code'
        : node.name === 'li'
          ? 'list'
          : node.name === 'blockquote'
            ? 'quote'
            : ['p', 'tr', 'summary'].includes(node.name)
              ? 'paragraph'
              : undefined
    if (!kind) {
      if (node.name === 'img') attachImage(node)
      else node.children.forEach(visit)
      return
    }
    const runs: Block['runs'] = []
    inline(node, runs, '', kind === 'code')
    const empty = !runs.some((run) => run.text.trim())
    if (empty && !picture(node, page)) return
    if (blocks.length >= 9 || remaining <= 0) {
      truncated = true
      return
    }
    if (empty) {
      attachImage(node)
      return
    }
    const visible: Block['runs'] = []
    for (const run of runs) {
      const points = Array.from(run.text).length
      if (points <= remaining) {
        visible.push(run)
        remaining -= points
        continue
      }
      truncated = true
      const text = clip(run.text, remaining)
      if (text.trim()) visible.push({ ...run, text })
      const last = visible.at(-1)
      if (last) visible[visible.length - 1] = { ...last, text: last.text.trimEnd() + '…' }
      break
    }
    if (!visible.length) return
    blocks.push({ kind, runs: visible, ...(kind === 'list' ? listMarker(node) : {}) })
    attachImage(node)
  }
  doc.children.forEach(visit)
  if (truncated) {
    while (blocks.at(-1)?.kind === 'heading') blocks.pop()
    blocks.push({ kind: 'more', runs: [{ text: 'Read more on GitHub ↗' }] })
  }
  return { blocks, image, body: blocks.length ? undefined : excerpt(plain) }
}

export type Labels = (string | { name: string; color?: string })[]
export function labelChips(labels: Labels = []) {
  return labels.slice(0, 10).map((v) => (typeof v === 'string' ? { text: v } : { text: v.name, color: v.color }))
}

const reactions = {
  '+1': '👍',
  '-1': '👎',
  laugh: '😄',
  hooray: '🎉',
  confused: '😕',
  heart: '❤️',
  rocket: '🚀',
  eyes: '👀'
}
export function reactionChips(counts?: Record<string, number>) {
  return Object.entries(reactions).flatMap(([key, emoji]) =>
    counts && counts[key] > 0 ? [{ text: emoji + ' ' + counts[key] }] : []
  )
}

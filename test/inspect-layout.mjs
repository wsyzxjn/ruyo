import { createRenderer } from '../packages/core/dist/index.js'

export const sampleImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAFElEQVR4nGN84KLGgA0wYRWlkwQAw5wBVjcISf0AAAAASUVORK5CYII=', 'base64')

// Inspect the same positioned items and real shaped blocks that the public renderer paints.
export async function inspectLayout(adapter, card, width) {
  const paragraphs = []
  let list
  const renderer = createRenderer({ adapters: [{
    ...adapter,
    resolve: async () => ({
      assets: card.assets,
      async layout(width, context) {
        list = await card.layout(width, { ...context, prepareText(spec) {
          const block = context.prepareText(spec)
          paragraphs[block.id] = spec
          return block
        } })
        return list
      }
    })
  }] })
  await renderer.render('https://example.org/test', { width, dpr: 1 })
  return { items: list.items, paragraphs }
}

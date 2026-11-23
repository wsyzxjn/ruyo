import { RuyoError, type NetworkHost } from '@ruyojs/core'
import { request } from '@ruyojs/core/adapter'
import { DomUtils as dom, parseDocument } from 'htmlparser2'
import { article } from './details.js'
import { excerpt, formatCount, type Preview } from './api.js'

export async function discussion(slug: string, number: string, host: NetworkHost): Promise<Preview> {
  const url = 'https://github.com/' + slug + '/discussions/' + number
  const response = await request(url, { accept: 'text/html', 'accept-language': 'en', 'user-agent': 'Ruyo' }, host)
  const doc = parseDocument(await response.text())
  const meta = (property: string) =>
    dom.findOne((e) => e.name === 'meta' && e.attribs.property === property, doc)?.attribs.content
  const canonical = URL.parse(meta('og:url') ?? '')
  const path = canonical?.pathname.match(/^\/([^/]+\/[^/]+)\/discussions\/(\d+)\/?$/)
  if (canonical?.hostname !== 'github.com' || !path || path[2] !== number)
    throw new RuyoError('UPSTREAM_ERROR', 'Missing GitHub discussion metadata')

  const header = dom.getElementById('partial-discussion-header', doc)
  const heading = header && dom.findOne((e) => e.attribs.class?.split(/\s+/).includes('js-issue-title'), header)
  const suffix = ' · ' + path[1] + ' · Discussion #' + number
  const ogTitle = meta('og:title') ?? ''
  const title = heading
    ? dom.textContent(heading).trim()
    : ogTitle.endsWith(suffix)
      ? ogTitle.slice(0, -suffix.length)
      : ogTitle
  if (!title) throw new RuyoError('UPSTREAM_ERROR', 'Missing GitHub discussion title')
  const status =
    header && dom.findOne((e) => e.attribs.class?.split(/\s+/).includes('State') && !!e.attribs.title, header)
  const category =
    header && dom.findOne((e) => e.name === 'a' && e.attribs.href?.includes('/discussions/categories/'), header)

  const post = dom.getElementById((id) => /^discussion-\d+$/.test(id), doc)
  const byline =
    post &&
    dom.findOne((e) => e.name === 'h2' && e.attribs.class?.split(/\s+/).includes('timeline-comment-header-text'), post)
  const user = byline && dom.findOne((e) => e.name === 'a' && e.attribs['data-hovercard-type'] === 'user', byline)
  const login = user?.attribs.href?.match(/^\/([^/]+)$/)?.[1]
  const avatar = user && dom.findOne((e) => e.name === 'img', user)?.attribs.src

  const metrics: Preview['metrics'] = []
  const vote = post && dom.findOne((e) => e.attribs.id?.startsWith('discussion-upvote-button-Discussion-'), post)
  const votes = vote && dom.textContent(vote).trim().replaceAll(',', '')
  if (votes && /^\d+$/.test(votes)) metrics.push({ icon: 'upvotes', text: formatCount(Number(votes), 'upvote') })
  const counts = dom.getElementById('discussion-comment-count', doc)
  if (counts) {
    for (const [text] of dom.textContent(counts).matchAll(/[\d,]+\s+(?:comments?|repl(?:y|ies))\b/gi))
      metrics.push({ icon: 'comments', text: text.replace(/\s+/g, ' ') })
  }
  const bodyNode = post && dom.findOne((e) => e.attribs.class?.split(/\s+/).includes('js-comment-body'), post)
  const timestamp = byline && dom.findOne((e) => e.name === 'relative-time', byline)?.attribs.datetime
  const details: NonNullable<Preview['details']> = []
  if (status?.attribs.title === 'Answered') {
    for (const script of dom.findAll((e) => e.name === 'script' && e.attribs.type === 'application/ld+json', doc)) {
      let answer
      try {
        answer = JSON.parse(dom.textContent(script)).mainEntity?.acceptedAnswer
      } catch {
        continue
      }
      if (typeof answer?.text !== 'string') continue
      const summary = excerpt(dom.textContent(parseDocument(answer.text)))
      if (summary) details.push({ title: 'Accepted answer', rows: [{ name: summary }] })
      break
    }
  }
  return {
    kind: 'discussion',
    details,
    title,
    context: path[1].replace(/^orgs\//, ''),
    label: 'Discussion #' + number,
    author: login ? { login, avatar_url: avatar || undefined } : null,
    ...article(bodyNode ? dom.getInnerHTML(bodyNode) : undefined, meta('og:description'), url),
    date: timestamp ? 'Started ' + timestamp.slice(0, 10) : undefined,
    chips: category && status ? [{ text: dom.textContent(category).trim(), color: '8250df' }] : [],
    badge: status?.attribs.title || (category && dom.textContent(category).trim()) || 'Discussion',
    metrics
  }
}

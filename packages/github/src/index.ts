import { RuyoError, type Adapter, type NetworkHost, type PrepareText } from '@ruyo/core'
import { loadImage, loadImages } from '@ruyo/core/adapter'

import { displayUrl, formatCount, read, type Actor, type Preview } from './api.js'
import { commit, profile, release } from './resources.js'
import { article, labelChips, reactionChips, type Labels } from './details.js'
import { languageBreakdown } from './languages.js'
import { discussion } from './discussion.js'

interface Repository {
  full_name: string
  topics?: string[]
  homepage?: string
  fork?: boolean
  parent?: { full_name: string }
  is_template?: boolean
  updated_at?: string
  default_branch?: string
  languages_url?: string
  open_issues_count?: number
  subscribers_count?: number
  owner: Actor
  description: string | null
  visibility: string
  archived: boolean
  language: string | null
  license: { spdx_id: string | null } | null
  stargazers_count: number
  forks_count: number
}
interface Ticket {
  html_url: string
  title: string
  number: number
  user: Actor | null
  body_text?: string | null
  body_html?: string
  created_at?: string
  merged_at?: string
  labels?: Labels
  reactions?: Record<string, number>
  milestone?: { title: string } | null
  assignees?: Actor[]
  state: 'open' | 'closed'
  state_reason?: string | null
  comments: number
  pull_request?: object
}
interface PullRequest extends Ticket {
  merged: boolean
  draft: boolean
  changed_files: number
  base?: { ref: string }
  head?: { ref: string }
  additions?: number
  deletions?: number
  commits?: number
  review_comments?: number
}
async function repository(slug: string, host: NetworkHost): Promise<Preview> {
  const repo = await read<Repository>('/repos/' + slug, host)
  if (
    !repo.full_name ||
    !repo.owner?.login ||
    !repo.visibility ||
    !Number.isInteger(repo.stargazers_count) ||
    !Number.isInteger(repo.forks_count)
  )
    throw new RuyoError('UPSTREAM_ERROR', 'Incomplete GitHub repository')
  const metrics: Preview['metrics'] = [
    { icon: 'star', text: formatCount(repo.stargazers_count, 'star') },
    { icon: 'fork', text: formatCount(repo.forks_count, 'fork') }
  ]
  const languages = repo.languages_url
    ? await read<Record<string, number>>('/repos/' + repo.full_name + '/languages', host)
        .then(languageBreakdown)
        .catch(() => [])
    : []
  if (Number.isInteger(repo.open_issues_count))
    metrics.push({ icon: 'issues', text: repo.open_issues_count + ' open issues & PRs' })
  if (Number.isInteger(repo.subscribers_count))
    metrics.push({ icon: 'watch', text: repo.subscribers_count + ' watching' })
  if (!languages.length && repo.language) metrics.push({ icon: 'language', text: repo.language })
  if (repo.license?.spdx_id && repo.license.spdx_id !== 'NOASSERTION')
    metrics.push({ icon: 'license', text: repo.license.spdx_id })
  const visibility = repo.visibility[0].toUpperCase() + repo.visibility.slice(1)
  const topics = repo.topics ?? []
  const chips = topics.slice(0, 9).map((text) => ({ text, color: '54aeff' }))
  if (topics.length > 9) chips.push({ text: '+' + (topics.length - 9), color: '54aeff' })
  const facts: Preview['facts'] = []
  if (repo.fork && repo.parent) facts.push({ icon: 'fork', text: 'Forked from ' + repo.parent.full_name })
  if (repo.homepage) facts.push({ icon: 'link', text: displayUrl(repo.homepage), link: true })
  if (repo.default_branch) facts.push({ icon: 'branch', text: repo.default_branch })
  return {
    kind: 'repository',
    author: repo.owner,
    byline: '',
    context: repo.owner.login,
    label: 'Repository',
    title: repo.full_name.slice(repo.full_name.indexOf('/') + 1),
    body: repo.description,
    facts,
    metrics,
    date: repo.updated_at && 'Updated ' + repo.updated_at.slice(0, 10),
    languages,
    chips,
    badge: repo.archived ? visibility + ' archive' : repo.is_template ? visibility + ' template' : visibility
  }
}

async function ticket(slug: string, route: string, number: string, host: NetworkHost): Promise<Preview> {
  // GitHub also serves pull requests at /issues/N. Use PR metadata for their merge state.
  const issue = route === 'issues' ? await read<Ticket>('/repos/' + slug + '/issues/' + number, host) : undefined
  const pr =
    !issue || issue.pull_request ? await read<PullRequest>('/repos/' + slug + '/pulls/' + number, host) : undefined
  const item = pr ?? issue!
  const canonical = URL.parse(item.html_url)?.pathname.match(/^\/([^/]+\/[^/]+)\/(?:issues|pull)\/\d+\/?$/)
  if (
    !canonical ||
    !item.title ||
    !Number.isInteger(item.number) ||
    !Number.isInteger(item.comments) ||
    !['open', 'closed'].includes(item.state)
  )
    throw new RuyoError('UPSTREAM_ERROR', 'Incomplete GitHub issue or pull request')
  const metrics: Preview['metrics'] = [{ icon: 'comments', text: formatCount(item.comments, 'comment') }]
  if (pr && Number.isInteger(pr.changed_files))
    metrics.push({ icon: 'files', text: formatCount(pr.changed_files, 'file') + ' changed' })
  if (pr?.commits !== undefined) metrics.push({ icon: 'commits', text: formatCount(pr.commits, 'commit') })
  if (pr?.review_comments) metrics.push({ icon: 'comments', text: formatCount(pr.review_comments, 'review comment') })
  const badge = pr?.merged
    ? 'Merged'
    : item.state === 'closed'
      ? item.state_reason === 'not_planned'
        ? 'Not planned'
        : 'Closed'
      : pr?.draft
        ? 'Draft'
        : 'Open'
  const facts: Preview['facts'] = []
  if (item.milestone) facts.push({ icon: 'milestone', text: item.milestone.title })
  if (item.assignees?.length)
    facts.push({ icon: 'person', text: item.assignees.map((user) => '@' + user.login).join(', ') })
  return {
    kind: pr ? 'pull' : 'issue',
    author: item.user,
    context: canonical[1],
    label: (pr ? 'Pull request #' : 'Issue #') + item.number,
    title: item.title,
    badge,
    metrics,
    ...article(item.body_html, item.body_text, item.html_url),
    date: pr?.merged_at
      ? 'Merged ' + pr.merged_at.slice(0, 10)
      : item.created_at && 'Opened ' + item.created_at.slice(0, 10),
    chips: labelChips(item.labels),
    reactions: reactionChips(item.reactions),
    facts,
    diff:
      pr && pr.additions !== undefined && pr.deletions !== undefined
        ? { additions: pr.additions, deletions: pr.deletions, base: pr.base?.ref, head: pr.head?.ref }
        : undefined
  }
}

const reserved = new Set(
  'about account apps codespaces collections contact copilot dashboard discussions enterprise events explore features gist issues join login logout marketplace new notifications organizations orgs pricing projects pull pulls readme search security sessions settings site sponsors stars support topics trending users'.split(
    ' '
  )
)

function resolvePath(path: string, host: NetworkHost): Promise<Preview> | undefined {
  const [owner, repo, route, ...rest] = path.replace(/^\/|\/$/g, '').split('/')
  const login = /^[a-z0-9][a-z0-9_-]*$/i
  const number = /^[1-9]\d*$/
  if (
    owner === 'orgs' &&
    login.test(repo ?? '') &&
    route === 'discussions' &&
    rest.length === 1 &&
    number.test(rest[0])
  )
    return discussion('orgs/' + repo, rest[0], host)
  if (!login.test(owner) || reserved.has(owner.toLowerCase())) return
  if (repo === undefined) return profile(owner, host)
  if (!/^[a-z0-9._-]+$/i.test(repo)) return
  const slug = owner + '/' + repo.replace(/\.git$/, '')
  if (!route && !rest.length) return repository(slug, host)
  if (rest.length === 1) {
    const [id] = rest
    if (number.test(id)) {
      if (route === 'issues' || route === 'pull') return ticket(slug, route, id, host)
      if (route === 'discussions') return discussion(slug, id, host)
    }
    if (route === 'commit' && /^[a-f0-9]{4,64}$/i.test(id)) return commit(slug, id, host)
    if (route === 'releases' && id === 'latest') return release(slug, 'latest', host)
  }
  if (route === 'releases' && rest[0] === 'tag' && rest.length > 1 && rest.slice(1).every(Boolean)) {
    let tag: string
    try {
      tag = decodeURIComponent(rest.slice(1).join('/'))
    } catch {
      return
    }
    return release(slug, 'tags/' + encodeURIComponent(tag), host)
  }
}

export const githubAdapter: Adapter = {
  resolve(url, _options, host = globalThis) {
    if (!['github.com', 'www.github.com'].includes(url.hostname)) return
    const preview = resolvePath(url.pathname, host)
    if (!preview) return
    return preview.then(async (content) => {
      const assets = await loadImages([content.author?.avatar_url], 'https://github.com/', host)
      if (content.image && !assets.has(content.image)) {
        try {
          assets.set(content.image, await loadImage(content.image, 'https://github.com/', host))
        } catch {
          content.image = undefined
        }
      }
      return {
        assets,
        async layout(width, { prepareText, imageSize, preflightSystemFonts }) {
          const wasm = await import('#wasm')
          const layout = (measure: PrepareText) => wasm.layout(content, width, measure, imageSize)
          preflightSystemFonts?.(layout)
          return layout(prepareText)
        }
      }
    })
  }
}

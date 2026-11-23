import { RuyoError, type NetworkHost } from '@ruyo/core'
import { displayUrl, excerpt, formatCount, read, type Actor, type Preview } from './api.js'

import { article, reactionChips } from './details.js'

export async function release(slug: string, reference: string, host: NetworkHost): Promise<Preview> {
  const data = await read<{
    tag_name: string
    name: string | null
    author: Actor | null
    draft: boolean
    prerelease: boolean
    body_text?: string
    body_html?: string
    body?: string | null
    published_at: string | null
    assets: { name: string; size: number; download_count: number }[]
    reactions?: Record<string, number>
  }>('/repos/' + slug + '/releases/' + reference, host)
  if (!data.tag_name || !Array.isArray(data.assets)) throw new RuyoError('UPSTREAM_ERROR', 'Incomplete GitHub release')
  const metrics: Preview['metrics'] = [{ icon: 'assets', text: formatCount(data.assets.length, 'asset') }]
  const downloads = data.assets.reduce((total, a) => total + a.download_count, 0)
  if (Number.isFinite(downloads) && data.assets.length)
    metrics.push({ icon: 'downloads', text: formatCount(downloads, 'download') })
  const rows = data.assets
    .slice(0, 3)
    .map((a) => ({
      name: a.name,
      value: a.size < 1048576 ? (a.size / 1024).toFixed(1) + ' KiB' : (a.size / 1048576).toFixed(1) + ' MiB'
    }))
  if (data.assets.length > rows.length)
    rows.push({ name: '+' + (data.assets.length - rows.length) + ' more assets', value: '' })
  return {
    kind: 'release',
    title: data.name || data.tag_name,
    author: data.author,
    context: slug,
    label: 'Release ' + data.tag_name,
    badge: data.draft ? 'Draft' : data.prerelease ? 'Pre-release' : reference === 'latest' ? 'Latest' : 'Release',
    date: (data.published_at && 'Released ' + data.published_at.slice(0, 10)) || undefined,
    ...article(
      data.body_html,
      data.body_text ?? data.body,
      'https://github.com/' + slug + '/releases/tag/' + data.tag_name
    ),
    details: [{ title: 'Release assets', rows }],
    reactions: reactionChips(data.reactions),
    metrics
  }
}

export async function commit(slug: string, ref: string, host: NetworkHost): Promise<Preview> {
  const data = await read<{
    sha: string
    author: Actor | null
    stats?: { additions: number; deletions: number }
    files?: { filename: string; status: string; additions: number; deletions: number; previous_filename?: string }[]
    commit: {
      committer?: { date: string }
      author: { name: string } | null
      message: string
      verification?: { verified: boolean; reason: string }
    }
  }>('/repos/' + slug + '/commits/' + ref, host)
  if (!data.sha?.toLowerCase().startsWith(ref.toLowerCase()) || !data.commit?.message)
    throw new RuyoError('UPSTREAM_ERROR', 'Incomplete GitHub commit')
  const [subject, ...rest] = data.commit.message.trim().split(/\r?\n/)
  // Like `git interpret-trailers`, a final paragraph made only of `Key: value` lines is the trailer block.
  const paragraphs = rest.join('\n').trim().split(/\n\s*\n/)
  const trailers = paragraphs
    .at(-1)!
    .split('\n')
    .every((line) => /^[a-z][\w-]*:\s*\S/i.test(line))
    ? paragraphs.pop()!.split('\n')
    : []
  const coauthors = trailers.flatMap((line) => line.match(/^co-authored-by:\s*(.+?)\s*(?:<[^>]*>)?$/i)?.[1] ?? [])
  const author = data.author ?? (data.commit.author?.name ? { login: data.commit.author.name } : null)
  const metrics: Preview['metrics'] = []
  if (data.files) metrics.push({ icon: 'files', text: formatCount(data.files.length, 'file') + ' changed' })
  const rows = (data.files ?? []).slice(0, 6).map((f) => ({
    tag: ({ added: 'A', removed: 'D', renamed: 'R', copied: 'C' } as Record<string, string>)[f.status] ?? 'M',
    name: f.previous_filename ? f.previous_filename + ' → ' + f.filename : f.filename,
    value: '+' + f.additions + '  −' + f.deletions
  }))
  const fileCount = data.files?.length ?? 0
  const verification = data.commit.verification
  const badge = verification?.verified
    ? 'Verified'
    : verification && verification.reason !== 'unsigned'
      ? 'Unverified'
      : ''
  return {
    kind: 'commit',
    author,
    byline:
      author && coauthors.length
        ? author.login + ' and ' + (coauthors.length === 1 ? coauthors[0] : coauthors.length + ' others')
        : undefined,
    title: subject,
    context: slug,
    label: 'Commit ' + data.sha.slice(0, 7),
    date: data.commit.committer?.date && 'Committed ' + data.commit.committer.date.slice(0, 10),
    body: excerpt(paragraphs.join(' ')),
    badge,
    metrics,
    diff: data.stats,
    details: [{ title: fileCount > 6 ? 'Changed files · first 6' : 'Changed files', rows }]
  }
}

export async function profile(login: string, host: NetworkHost): Promise<Preview> {
  const data = await read<
    Actor & {
      name: string | null
      type: string
      bio: string | null
      public_repos: number
      followers: number
      following: number
      location?: string
      company?: string
      blog?: string
      created_at?: string
      public_gists?: number
      repos_url?: string
    }
  >('/users/' + login, host)
  if (!data.login || !data.type || ![data.public_repos, data.followers, data.following].every(Number.isInteger))
    throw new RuyoError('UPSTREAM_ERROR', 'Incomplete GitHub profile')
  const recent =
    data.repos_url && data.public_repos > 0
      ? await read<{ name: string; language: string | null; stargazers_count: number }[]>(
          '/users/' + data.login + '/repos?sort=pushed&direction=desc&per_page=3&type=owner',
          host
        ).catch(() => [])
      : []
  return {
    kind: 'profile',
    author: data,
    byline: '',
    context: data.login,
    label: 'Profile',
    title: data.name || data.login,
    body: data.bio,
    date: data.created_at && 'Joined ' + data.created_at.slice(0, 10),
    facts: [
      ...(data.company ? [{ icon: 'organization' as const, text: data.company }] : []),
      ...(data.location ? [{ icon: 'location' as const, text: data.location }] : []),
      ...(data.blog ? [{ icon: 'link' as const, text: displayUrl(data.blog), link: true }] : [])
    ],
    details: [
      {
        title: 'Recently pushed repositories',
        rows: recent.map((repo) => ({
          name: repo.name,
          value: [repo.language, formatCount(repo.stargazers_count, 'star')].filter(Boolean).join(' · ')
        }))
      }
    ],
    badge: data.type === 'User' ? 'Personal account' : data.type,
    metrics: [
      {
        icon: 'repo',
        text:
          data.public_repos.toLocaleString('en-US') +
          (data.public_repos === 1 ? ' public repository' : ' public repositories')
      },
      { icon: 'people', text: formatCount(data.followers, 'follower') },
      { icon: 'people', text: data.following.toLocaleString('en-US') + ' following' },
      ...(data.public_gists !== undefined
        ? [{ icon: 'files' as const, text: formatCount(data.public_gists, 'public gist') }]
        : [])
    ]
  }
}

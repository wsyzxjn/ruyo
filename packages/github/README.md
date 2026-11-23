# @ruyojs/github

GitHub adapter for [Ruyo](https://www.npmjs.com/package/ruyo). Renders GitHub repositories, issues, pull requests, releases, commits, discussions, and profiles as PNG cards.

## Install

```sh
npm install @ruyojs/core @ruyojs/github
```

Or install [ruyo](https://www.npmjs.com/package/ruyo), which includes every platform.

## Usage

```ts
import { createRenderer } from '@ruyojs/core'
import { githubAdapter } from '@ruyojs/github'

const { render } = createRenderer({ adapters: [githubAdapter] })
const { png } = await render('https://github.com/nodejs/node/pull/1')
```

## Supported links

| Link | Card |
|---|---|
| `github.com/<owner>/<repo>` | Description, visibility, topics, homepage, default branch, languages, stars, forks, watchers, and open issues and PRs |
| `…/issues/<n>` | State, author, date, labels, body, assignees, milestone, reactions, and comment count |
| `…/pull/<n>` | Everything on an issue card, plus branches, lines added and removed, commits, changed files, and review comments |
| `…/releases/latest`, `…/releases/tag/<tag>` | Version, release notes, date, the first three assets with their sizes, and total downloads |
| `…/commit/<sha>` | Message, short SHA, signature status, co-authors, lines added and removed, changed file count, and stats for up to six files |
| `…/discussions/<n>`, `github.com/orgs/<org>/discussions/<n>` | Body, category, votes, comment and reply counts, and the accepted answer if there is one |
| `github.com/<user-or-org>` | Profile, location, website, join date, public repos, followers, following, and three recently pushed repos |

Body previews keep headings, lists, task lists, code, quotes, and links. Long text is cut at a word boundary, and the first image within the preview is shown in place.

## Rate limits

The adapter calls the GitHub REST API anonymously, which GitHub limits to 60 requests per hour per IP. Each card takes 1–3 requests. Discussions are read from the public web page instead.

To raise the limit, send a token to the API through a custom `fetch`:

```ts
import { createRenderer, type NetworkHost } from '@ruyojs/core'
import { githubAdapter } from '@ruyojs/github'

const host: NetworkHost = {
  fetch(input, init) {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.hostname !== 'api.github.com') return fetch(input, init)
    const headers = new Headers(init?.headers)
    headers.set('authorization', `Bearer ${process.env.GITHUB_TOKEN}`)
    return fetch(input, { ...init, headers })
  },
}

const { render } = createRenderer({ adapters: [githubAdapter], host })
```

## License notices

Icons are from [Octicons](https://github.com/primer/octicons) (MIT). See `licenses/octicons.txt` in this package.

import { BackendError, parseLogLocation, type Backend, type CiStatus, type CommitResult, type FileChange, type RepoFile } from './types'

export interface GitHubConfig {
  token: string
  owner: string
  repo: string
  branch: string
  apiBase?: string
  fetch?: typeof fetch
}

function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/')

/** GitHub REST client for the ledger-data repo (fetch only, no SDK). */
export class GitHubBackend implements Backend {
  readonly kind = 'github' as const
  private readonly base: string
  private readonly f: typeof fetch

  constructor(private readonly cfg: GitHubConfig) {
    this.base = cfg.apiBase ?? 'https://api.github.com'
    this.f = cfg.fetch ?? globalThis.fetch.bind(globalThis)
  }

  private get repoPath() {
    return `/repos/${encodeURIComponent(this.cfg.owner)}/${encodeURIComponent(this.cfg.repo)}`
  }

  private async req<T>(method: string, path: string, body?: unknown, accept = 'application/vnd.github+json'): Promise<T> {
    let res: Response
    try {
      res = await this.f(this.base + path, {
        method,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${this.cfg.token}`,
          Accept: accept,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      })
    } catch (e) {
      throw new BackendError(`Network error: ${(e as Error).message}`, undefined, true)
    }
    if (!res.ok) {
      let detail = ''
      try {
        detail = ((await res.json()) as { message?: string }).message ?? ''
      } catch {
        /* no body */
      }
      throw new BackendError(this.explain(res.status, detail, res.headers), res.status)
    }
    if (res.status === 204) return undefined as T
    if (accept.includes('raw')) return (await res.text()) as T
    return (await res.json()) as T
  }

  private explain(status: number, detail: string, headers: Headers): string {
    switch (status) {
      case 401:
        return 'GitHub rejected the token (invalid or expired). Create a new fine-grained token in Settings.'
      case 403:
        if (headers.get('x-ratelimit-remaining') === '0') return 'GitHub API rate limit reached. Try again later.'
        return `The token lacks a permission for this repo (needs Contents: read and write, Actions: read). ${detail}`
      case 404:
        return `Repository ${this.cfg.owner}/${this.cfg.repo} (branch ${this.cfg.branch}) not found, or the token has no access to it.`
      case 409:
        return `Conflict: the file changed on GitHub. ${detail}`
      case 422:
        return `GitHub refused the change: ${detail}`
      default:
        return `GitHub error ${status}: ${detail}`
    }
  }

  async verify(): Promise<void> {
    await this.req('GET', this.repoPath)
    await this.head()
  }

  async repoState(): Promise<'ready' | 'empty' | 'no-journal'> {
    await this.req('GET', this.repoPath)
    try {
      const { files } = await this.listFiles()
      return files.some((f) => f.path === 'main.journal') ? 'ready' : 'no-journal'
    } catch (e) {
      // a repository without any commit has no branch yet (404) or answers 409 "Git Repository is empty"
      if (e instanceof BackendError && (e.status === 404 || e.status === 409)) return 'empty'
      throw e
    }
  }

  async initialize(files: Record<string, string>, message: string): Promise<{ workflows: boolean }> {
    const state = await this.repoState()
    if (state === 'ready') throw new BackendError('This repository already has a main.journal.')
    let rest = Object.entries(files).filter(([p]) => !p.startsWith('.github/'))
    const workflows = Object.entries(files).filter(([p]) => p.startsWith('.github/'))
    if (state === 'empty') {
      // the first file goes through the Contents API, which creates the default branch
      const first = rest.find(([p]) => p === 'README.md') ?? rest[0]
      await this.req('PUT', `${this.repoPath}/contents/${encPath(first[0])}`, { message, content: b64encode(first[1]) })
      rest = rest.filter(([p]) => p !== first[0])
    }
    const current = new Map((await this.listFiles()).files.map((f) => [f.path, f.sha]))
    const base = (paths: string[]) => Object.fromEntries(paths.map((p) => [p, current.get(p)]))
    if (rest.length) await this.commitMany(rest.map(([path, text]) => ({ path, text })), message, base(rest.map(([p]) => p)))
    if (!workflows.length) return { workflows: true }
    try {
      await this.commitMany(workflows.map(([path, text]) => ({ path, text })), 'setup: hledger check and daily rates', base(workflows.map(([p]) => p)))
      return { workflows: true }
    } catch (e) {
      // a token without "Workflows: write" cannot create .github/workflows files
      if (e instanceof BackendError && [403, 404, 422].includes(e.status ?? 0)) return { workflows: false }
      throw e
    }
  }

  private async head(): Promise<{ commitSha: string; treeSha: string }> {
    const b = await this.req<{ commit: { sha: string; commit: { tree: { sha: string } } } }>(
      'GET',
      `${this.repoPath}/branches/${encodeURIComponent(this.cfg.branch)}`
    )
    return { commitSha: b.commit.sha, treeSha: b.commit.commit.tree.sha }
  }

  async listFiles(): Promise<{ headSha: string; files: RepoFile[] }> {
    const { commitSha, treeSha } = await this.head()
    const t = await this.req<{ tree: { path: string; sha: string; type: string }[]; truncated: boolean }>(
      'GET',
      `${this.repoPath}/git/trees/${treeSha}?recursive=1`
    )
    return {
      headSha: commitSha,
      files: t.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, sha: e.sha }))
    }
  }

  /** Blobs are immutable by sha, so no stale caches. */
  readFile(_path: string, sha: string): Promise<string> {
    return this.req<string>('GET', `${this.repoPath}/git/blobs/${sha}`, undefined, 'application/vnd.github.raw+json')
  }

  async commit(changes: FileChange[], message: string, baseShas: Record<string, string | undefined>): Promise<CommitResult> {
    if (changes.length === 1 && changes[0].text !== null) {
      // single file: Contents API (GitHub checks the base sha and answers 409 on conflict)
      const c = changes[0]
      const body: Record<string, string> = { message, content: b64encode(c.text!), branch: this.cfg.branch }
      const sha = baseShas[c.path]
      if (sha) body.sha = sha
      const r = await this.req<{ content: { sha: string }; commit: { sha: string } }>(
        'PUT',
        `${this.repoPath}/contents/${encPath(c.path)}`,
        body
      )
      return { commitSha: r.commit.sha, shas: { [c.path]: r.content.sha } }
    }
    return this.commitMany(changes, message, baseShas)
  }

  /** Several files in one commit through the Git Data API. */
  private async commitMany(changes: FileChange[], message: string, baseShas: Record<string, string | undefined>): Promise<CommitResult> {
    const { commitSha, treeSha } = await this.head()
    // optimistic concurrency: compare current blob shas with the ones the change was based on
    const { files } = await this.listFilesAt(treeSha)
    const current = new Map(files.map((f) => [f.path, f.sha]))
    for (const c of changes) {
      if (current.get(c.path) !== baseShas[c.path]) {
        throw new BackendError(`Conflict: ${c.path} changed on GitHub since it was loaded.`, 409)
      }
    }
    const shas: Record<string, string> = {}
    const tree: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[] = []
    for (const c of changes) {
      if (c.text === null) {
        tree.push({ path: c.path, mode: '100644', type: 'blob', sha: null })
        continue
      }
      const blob = await this.req<{ sha: string }>('POST', `${this.repoPath}/git/blobs`, {
        content: b64encode(c.text),
        encoding: 'base64'
      })
      shas[c.path] = blob.sha
      tree.push({ path: c.path, mode: '100644', type: 'blob', sha: blob.sha })
    }
    const newTree = await this.req<{ sha: string }>('POST', `${this.repoPath}/git/trees`, { base_tree: treeSha, tree })
    const commit = await this.req<{ sha: string }>('POST', `${this.repoPath}/git/commits`, {
      message,
      tree: newTree.sha,
      parents: [commitSha]
    })
    try {
      await this.req('PATCH', `${this.repoPath}/git/refs/heads/${encodeURIComponent(this.cfg.branch)}`, {
        sha: commit.sha,
        force: false
      })
    } catch (e) {
      if (e instanceof BackendError && e.status === 422) throw new BackendError('Conflict: the branch moved during the commit.', 409)
      throw e
    }
    return { commitSha: commit.sha, shas }
  }

  private async listFilesAt(treeSha: string): Promise<{ files: RepoFile[] }> {
    const t = await this.req<{ tree: { path: string; sha: string; type: string }[] }>(
      'GET',
      `${this.repoPath}/git/trees/${treeSha}?recursive=1`
    )
    return { files: t.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, sha: e.sha })) }
  }

  async ciStatus(commitSha: string): Promise<CiStatus> {
    // workflow runs (Actions: read) — fine-grained tokens have no "Checks" permission
    const r = await this.req<{
      workflow_runs: { name: string; path?: string; status: string; conclusion: string | null; html_url: string }[]
    }>('GET', `${this.repoPath}/actions/runs?head_sha=${encodeURIComponent(commitSha)}&per_page=20`)
    const runs = r.workflow_runs
    if (runs.length === 0) return { state: 'pending' }
    const run = runs.find((x) => x.name === 'check' || x.path?.endsWith('/check.yml')) ?? runs[0]
    if (run.status !== 'completed') return { state: 'pending', url: run.html_url }
    if (run.conclusion === 'success') return { state: 'success', url: run.html_url }
    const status: CiStatus = { state: 'failure', url: run.html_url }
    try {
      const report = await this.statusReport()
      if (report && report.sha === commitSha) {
        status.log = report.log
        status.location = parseLogLocation(report.log)
        status.checkedAt = report.checkedAt
      }
    } catch {
      /* the report is a convenience */
    }
    return status
  }

  /** `reports/status.json` written by the check workflow. */
  async statusReport(): Promise<{ sha: string; ok: boolean; checkedAt: string; log: string } | undefined> {
    try {
      const text = await this.req<string>(
        'GET',
        `${this.repoPath}/contents/reports/status.json?ref=${encodeURIComponent(this.cfg.branch)}`,
        undefined,
        'application/vnd.github.raw+json'
      )
      return JSON.parse(text)
    } catch (e) {
      if (e instanceof BackendError && e.status === 404) return undefined
      throw e
    }
  }
}

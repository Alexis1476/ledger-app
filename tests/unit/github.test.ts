import { describe, expect, it, vi } from 'vitest'
import { GitHubBackend } from '../../src/github/client'
import { gitBlobSha, parseLogLocation } from '../../src/github/types'

type Call = { method: string; url: string; body?: unknown; headers: Record<string, string> }

function mockFetch(routes: Record<string, (call: Call) => { status?: number; json?: unknown; text?: string }>) {
  const calls: Call[] = []
  const f = vi.fn(async (url: string, init: RequestInit) => {
    const call: Call = {
      method: init.method ?? 'GET',
      url: url.replace('https://api.github.com', ''),
      body: init.body ? JSON.parse(init.body as string) : undefined,
      headers: init.headers as Record<string, string>
    }
    calls.push(call)
    const key = Object.keys(routes).find((k) => `${call.method} ${call.url}`.startsWith(k))
    if (!key) return new Response(JSON.stringify({ message: 'no route' }), { status: 500 })
    const r = routes[key](call)
    const status = r.status ?? 200
    return new Response(r.text ?? JSON.stringify(r.json ?? {}), { status })
  })
  return { f: f as unknown as typeof fetch, calls }
}

const cfg = { token: 'tkn', owner: 'me', repo: 'ledger-data', branch: 'main' }
const branch = { json: { commit: { sha: 'c0', commit: { tree: { sha: 't0' } } } } }

describe('GitHubBackend', () => {
  it('lists files of the branch head', async () => {
    const { f, calls } = mockFetch({
      'GET /repos/me/ledger-data/branches/main': () => branch,
      'GET /repos/me/ledger-data/git/trees/t0?recursive=1': () => ({
        json: { tree: [{ path: 'main.journal', sha: 's1', type: 'blob' }, { path: 'journals', sha: 'x', type: 'tree' }], truncated: false }
      })
    })
    const gh = new GitHubBackend({ ...cfg, fetch: f })
    expect(await gh.listFiles()).toEqual({ headSha: 'c0', files: [{ path: 'main.journal', sha: 's1' }] })
    expect(calls[0].headers.Authorization).toBe('Bearer tkn')
  })

  it('reads raw blobs', async () => {
    const { f, calls } = mockFetch({ 'GET /repos/me/ledger-data/git/blobs/s1': () => ({ text: 'include a.journal\n' }) })
    const gh = new GitHubBackend({ ...cfg, fetch: f })
    expect(await gh.readFile('main.journal', 's1')).toBe('include a.journal\n')
    expect(calls[0].headers.Accept).toBe('application/vnd.github.raw+json')
  })

  it('writes one file with the Contents API (base64 utf-8, sha)', async () => {
    const { f, calls } = mockFetch({
      'PUT /repos/me/ledger-data/contents/journals/2026.journal': () => ({ json: { content: { sha: 'new' }, commit: { sha: 'c1' } } })
    })
    const gh = new GitHubBackend({ ...cfg, fetch: f })
    const r = await gh.commit([{ path: 'journals/2026.journal', text: 'Café 1.00 CHF\n' }], 'add: x', { 'journals/2026.journal': 'old' })
    expect(r).toEqual({ commitSha: 'c1', shas: { 'journals/2026.journal': 'new' } })
    const body = calls[0].body as { content: string; sha: string; branch: string }
    expect(body.sha).toBe('old')
    expect(body.branch).toBe('main')
    expect(new TextDecoder().decode(Uint8Array.from(atob(body.content), (c) => c.charCodeAt(0)))).toBe('Café 1.00 CHF\n')
  })

  it('commits several files with the Git Data API', async () => {
    const { f, calls } = mockFetch({
      'GET /repos/me/ledger-data/branches/main': () => branch,
      'GET /repos/me/ledger-data/git/trees/t0': () => ({ json: { tree: [{ path: 'main.journal', sha: 'm0', type: 'blob' }] } }),
      'POST /repos/me/ledger-data/git/blobs': (c) => ({ json: { sha: `b-${(c.body as { content: string }).content.length}` } }),
      'POST /repos/me/ledger-data/git/trees': () => ({ json: { sha: 't1' } }),
      'POST /repos/me/ledger-data/git/commits': () => ({ json: { sha: 'c1' } }),
      'PATCH /repos/me/ledger-data/git/refs/heads/main': () => ({ json: {} })
    })
    const gh = new GitHubBackend({ ...cfg, fetch: f })
    const r = await gh.commit(
      [
        { path: 'journals/2027.journal', text: 'x\n' },
        { path: 'main.journal', text: 'include journals/2027.journal\n' }
      ],
      'add: y',
      { 'journals/2027.journal': undefined, 'main.journal': 'm0' }
    )
    expect(r.commitSha).toBe('c1')
    expect(Object.keys(r.shas)).toEqual(['journals/2027.journal', 'main.journal'])
    const treeCall = calls.find((c) => c.method === 'POST' && c.url.endsWith('/git/trees'))!
    expect((treeCall.body as { base_tree: string }).base_tree).toBe('t0')
    const commitCall = calls.find((c) => c.url.endsWith('/git/commits'))!
    expect(commitCall.body).toEqual({ message: 'add: y', tree: 't1', parents: ['c0'] })
    const refCall = calls.find((c) => c.method === 'PATCH')!
    expect(refCall.body).toEqual({ sha: 'c1', force: false })
  })

  it('detects a conflict before a multi-file commit', async () => {
    const { f } = mockFetch({
      'GET /repos/me/ledger-data/branches/main': () => branch,
      'GET /repos/me/ledger-data/git/trees/t0': () => ({ json: { tree: [{ path: 'main.journal', sha: 'changed', type: 'blob' }] } })
    })
    const gh = new GitHubBackend({ ...cfg, fetch: f })
    await expect(
      gh.commit([{ path: 'a.journal', text: '' }, { path: 'main.journal', text: '' }], 'm', { 'main.journal': 'm0' })
    ).rejects.toMatchObject({ status: 409 })
  })

  it('explains auth errors', async () => {
    const { f } = mockFetch({ 'GET /repos/me/ledger-data': () => ({ status: 401, json: { message: 'Bad credentials' } }) })
    const gh = new GitHubBackend({ ...cfg, fetch: f })
    await expect(gh.verify()).rejects.toMatchObject({ status: 401, message: expect.stringContaining('invalid or expired') })
    const { f: f404 } = mockFetch({ 'GET /repos/me/ledger-data': () => ({ status: 404, json: { message: 'Not Found' } }) })
    await expect(new GitHubBackend({ ...cfg, fetch: f404 }).verify()).rejects.toMatchObject({ status: 404 })
  })

  it('flags network errors', async () => {
    const f = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    await expect(new GitHubBackend({ ...cfg, fetch: f }).listFiles()).rejects.toMatchObject({ network: true })
  })

  it('maps check runs and reads the failure log', async () => {
    const log = 'hledger: Error: /home/runner/work/ledger-data/ledger-data/journals/2026.journal:12:5:\n  | unbalanced'
    const { f } = mockFetch({
      'GET /repos/me/ledger-data/actions/runs?head_sha=c1': () => ({
        json: { workflow_runs: [{ name: 'check', path: '.github/workflows/check.yml', status: 'completed', conclusion: 'failure', html_url: 'u' }] }
      }),
      'GET /repos/me/ledger-data/contents/reports/status.json': () => ({
        text: JSON.stringify({ sha: 'c1', ok: false, checkedAt: 'now', log })
      })
    })
    const s = await new GitHubBackend({ ...cfg, fetch: f }).ciStatus('c1')
    expect(s.state).toBe('failure')
    expect(s.location).toEqual({ file: '/home/runner/work/ledger-data/ledger-data/journals/2026.journal', line: 12, column: 5 })
    const { f: f2 } = mockFetch({
      'GET /repos/me/ledger-data/actions/runs?head_sha=c2': () => ({ json: { workflow_runs: [{ name: 'check', status: 'in_progress', conclusion: null }] } })
    })
    expect((await new GitHubBackend({ ...cfg, fetch: f2 }).ciStatus('c2')).state).toBe('pending')
  })
})

describe('helpers', () => {
  it('gitBlobSha equals git hash-object', async () => {
    // printf 'hello\n' | git hash-object --stdin
    expect(await gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
  })

  it('parseLogLocation maps to known files', () => {
    expect(parseLogLocation('Error: /x/y/ledger-data/journals/2026.journal:3:1:', ['journals/2026.journal', 'main.journal'])).toEqual({
      file: 'journals/2026.journal',
      line: 3,
      column: 1
    })
    expect(parseLogLocation('nothing here')).toBeUndefined()
  })
})

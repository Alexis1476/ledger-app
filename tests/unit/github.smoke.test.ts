/**
 * Manual smoke test against a THROWAWAY GitHub repo (never your real ledger-data):
 *   GH_SMOKE_TOKEN=github_pat_... GH_SMOKE_REPO=you/ledger-smoke pnpm gh:smoke
 * The repo must exist with at least one commit on `main` (e.g. created with a README).
 */
import { describe, expect, it } from 'vitest'
import { GitHubBackend } from '../../src/github/client'

const token = process.env.GH_SMOKE_TOKEN
const [owner, repo] = (process.env.GH_SMOKE_REPO ?? '').split('/')
const branch = process.env.GH_SMOKE_BRANCH ?? 'main'

describe.skipIf(!token || !owner || !repo)('GitHub smoke test (real API)', () => {
  const gh = new GitHubBackend({ token: token!, owner, repo, branch })
  const stamp = new Date().toISOString()

  it('verifies access and lists files', async () => {
    await gh.verify()
    const { headSha, files } = await gh.listFiles()
    expect(headSha).toMatch(/^[0-9a-f]{40}$/)
    expect(Array.isArray(files)).toBe(true)
  })

  it('writes one file, then two files in one commit, and reads them back', async () => {
    const before = await gh.listFiles()
    const sha = before.files.find((f) => f.path === 'smoke/a.journal')?.sha
    const one = await gh.commit([{ path: 'smoke/a.journal', text: `; ${stamp}\n` }], `smoke: one file ${stamp}`, { 'smoke/a.journal': sha })
    expect(one.commitSha).toMatch(/^[0-9a-f]{40}$/)
    const after = await gh.listFiles()
    const shaB = after.files.find((f) => f.path === 'smoke/b.journal')?.sha
    const two = await gh.commit(
      [
        { path: 'smoke/a.journal', text: `; ${stamp} (2)\n` },
        { path: 'smoke/b.journal', text: `; ${stamp}\n` }
      ],
      `smoke: two files ${stamp}`,
      { 'smoke/a.journal': one.shas['smoke/a.journal'], 'smoke/b.journal': shaB }
    )
    const text = await gh.readFile('smoke/a.journal', two.shas['smoke/a.journal'])
    expect(text).toBe(`; ${stamp} (2)\n`)
    const status = await gh.ciStatus(two.commitSha)
    expect(['pending', 'success', 'failure']).toContain(status.state)
  }, 60_000)

  it('rejects a stale sha with 409', async () => {
    await expect(gh.commit([{ path: 'smoke/a.journal', text: 'x\n' }], 'smoke: stale', { 'smoke/a.journal': '0'.repeat(40) })).rejects.toMatchObject({
      status: 409
    })
  })
})

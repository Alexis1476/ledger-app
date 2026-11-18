import { BackendError, type Backend, type CiStatus, type CommitResult, type FileChange, type RepoFile } from './types'

/**
 * Dev-only backend: reads and writes the local ledger-data checkout through the
 * Vite dev server (see vite-plugin-local-data.ts) and runs the real `hledger check`.
 */
export class LocalBackend implements Backend {
  readonly kind = 'local' as const

  constructor(private readonly base = '/__local') {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetch(this.base + path, {
        method,
        cache: 'no-store',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined
      })
    } catch (e) {
      throw new BackendError(`Local dev server unreachable: ${(e as Error).message}`, undefined, true)
    }
    if (!res.ok) {
      const msg = await res.text()
      throw new BackendError(msg || `Local backend error ${res.status}`, res.status)
    }
    return (await res.json()) as T
  }

  async verify(): Promise<void> {
    await this.req('GET', '/info')
  }

  listFiles(): Promise<{ headSha: string; files: RepoFile[] }> {
    return this.req('GET', '/tree')
  }

  async readFile(path: string): Promise<string> {
    const r = await this.req<{ text: string }>('GET', `/file?path=${encodeURIComponent(path)}`)
    return r.text
  }

  commit(changes: FileChange[], message: string, baseShas: Record<string, string | undefined>): Promise<CommitResult> {
    return this.req('POST', '/commit', { changes, message, baseShas })
  }

  ciStatus(commitSha: string): Promise<CiStatus> {
    return this.req('GET', `/check?sha=${encodeURIComponent(commitSha)}`)
  }

  async repoState(): Promise<'ready' | 'empty' | 'no-journal'> {
    try {
      await this.listFiles()
      return 'ready'
    } catch (e) {
      if (e instanceof BackendError && e.status === 404) return 'no-journal'
      throw e
    }
  }

  async initialize(files: Record<string, string>, message: string): Promise<{ workflows: boolean }> {
    await this.commit(Object.entries(files).map(([path, text]) => ({ path, text })), message, {})
    return { workflows: true }
  }
}

/** True when the dev server exposes the local ledger-data folder. */
export async function localBackendAvailable(): Promise<{ dir: string } | undefined> {
  if (!import.meta.env.DEV) return undefined
  try {
    const r = await fetch('/__local/info', { cache: 'no-store' })
    if (!r.ok) return undefined
    return (await r.json()) as { dir: string }
  } catch {
    return undefined
  }
}

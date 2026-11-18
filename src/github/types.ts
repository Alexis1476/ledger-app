export interface RepoFile {
  path: string
  /** git blob sha */
  sha: string
}

export interface FileChange {
  path: string
  /** new content, or null to delete */
  text: string | null
}

export interface CommitResult {
  commitSha: string
  /** new blob sha per written path */
  shas: Record<string, string>
}

export type CiState = 'pending' | 'success' | 'failure' | 'unknown'

export interface CiStatus {
  state: CiState
  /** hledger error output */
  log?: string
  /** first file:line:col found in the log */
  location?: { file: string; line: number; column?: number }
  url?: string
  checkedAt?: string
}

/** Storage for ledger-data: the GitHub repo in production, the local checkout in dev. */
export interface Backend {
  readonly kind: 'github' | 'local'
  /** Verifies access; throws a BackendError with a clear message otherwise. */
  verify(): Promise<void>
  /** Files of the branch head, with the head commit sha. */
  listFiles(): Promise<{ headSha: string; files: RepoFile[] }>
  readFile(path: string, sha: string): Promise<string>
  /**
   * Commit changes in one commit. `baseShas` are the blob shas the change was computed from
   * (undefined = file is new); a mismatch raises a BackendError with status 409.
   */
  commit(changes: FileChange[], message: string, baseShas: Record<string, string | undefined>): Promise<CommitResult>
  ciStatus(commitSha: string): Promise<CiStatus>
  /** ready = has main.journal; empty = no commit yet; no-journal = commits but no main.journal */
  repoState(): Promise<'ready' | 'empty' | 'no-journal'>
  /**
   * Write the files of a new ledger (setup). Workflow files need the token permission
   * "Workflows: write": without it they are skipped and `workflows` is false.
   */
  initialize(files: Record<string, string>, message: string): Promise<{ workflows: boolean }>
}

export class BackendError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly network = false
  ) {
    super(message)
    this.name = 'BackendError'
  }
}

/** Parse the first `path.journal:line[:col]` reference in an hledger error log. */
export function parseLogLocation(log: string, knownFiles: string[] = []): CiStatus['location'] {
  const m = /([^\s:"]*?\.journal):(\d+)(?::(\d+))?/.exec(log)
  if (!m) return undefined
  let file = m[1].replace(/\\/g, '/')
  const known = knownFiles.filter((k) => file === k || file.endsWith('/' + k)).sort((a, b) => b.length - a.length)[0]
  if (known) file = known
  return { file, line: Number(m[2]), column: m[3] ? Number(m[3]) : undefined }
}

/** Git blob sha-1 of a text, identical to `git hash-object`. */
export async function gitBlobSha(text: string): Promise<string> {
  const body = new TextEncoder().encode(text)
  const head = new TextEncoder().encode(`blob ${body.length}\0`)
  const buf = new Uint8Array(head.length + body.length)
  buf.set(head)
  buf.set(body, head.length)
  const digest = await crypto.subtle.digest('SHA-1', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

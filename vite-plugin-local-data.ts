/**
 * Dev-server-only plugin: exposes the local ledger-data checkout under /__local so the app
 * can be tested end to end without GitHub. "CI" is the real `hledger check` run locally.
 *
 *   LEDGER_DATA_DIR  path to the ledger-data checkout (default ../ledger-data)
 *   HLEDGER          hledger executable (default "hledger" on PATH)
 *   LOCAL_GIT_COMMIT=1  also `git commit` each change in LEDGER_DATA_DIR
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

const ALLOWED = /\.(journal|json|csv|md|yml)$/

function blobSha(buf: Buffer): string {
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')
}

function listFiles(root: string): { path: string; sha: string }[] {
  const out: { path: string; sha: string }[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name.startsWith('.') || name === 'node_modules' || name === '__pycache__') continue
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (ALLOWED.test(name)) out.push({ path: relative(root, p).split(sep).join('/'), sha: blobSha(readFileSync(p)) })
    }
  }
  walk(root)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

function safePath(root: string, rel: string): string {
  const p = resolve(root, rel)
  if (!p.startsWith(root + sep) || !ALLOWED.test(p)) throw new Error(`path not allowed: ${rel}`)
  return p
}

function run(cmd: string, args: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((res) => {
    execFile(cmd, args, { cwd, windowsHide: true }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
      res({ code, out: String(stdout), err: String(stderr || (error && code !== 0 && !stderr ? error.message : '')) })
    })
  })
}

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', typeof data === 'string' ? 'text/plain' : 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(typeof data === 'string' ? data : JSON.stringify(data))
}

export default function localData(): Plugin {
  return {
    name: 'ledger-local-data',
    apply: 'serve',
    configureServer(server) {
      const root = resolve(server.config.root, process.env.LEDGER_DATA_DIR ?? '../ledger-data')
      const hledger = process.env.HLEDGER ?? 'hledger'
      const gitCommit = process.env.LOCAL_GIT_COMMIT === '1'
      if (!existsSync(join(root, 'main.journal'))) {
        server.config.logger.warn(`[local-data] ${root} has no main.journal yet: the app offers to set up a new ledger there`)
      } else {
        server.config.logger.info(`[local-data] serving ${root} at /__local (hledger: ${hledger})`)
      }
      let counter = 0

      server.middlewares.use('/__local', async (req, res) => {
        try {
          // an empty folder is served too: the app then offers to set up a new ledger in it
          if (!existsSync(root)) return send(res, 404, `${root} not found`)
          const url = new URL(req.url ?? '/', 'http://localhost')
          const empty = !existsSync(join(root, 'main.journal'))
          if (empty && req.method === 'GET' && url.pathname !== '/info') return send(res, 404, `${root}/main.journal not found`)
          if (req.method === 'GET' && url.pathname === '/info') {
            return send(res, 200, { dir: root, hledger, gitCommit })
          }
          if (req.method === 'GET' && url.pathname === '/tree') {
            const files = listFiles(root)
            const headSha = createHash('sha1').update(files.map((f) => f.path + f.sha).join('\n')).digest('hex')
            return send(res, 200, { headSha, files })
          }
          if (req.method === 'GET' && url.pathname === '/file') {
            const p = safePath(root, url.searchParams.get('path') ?? '')
            return send(res, 200, { text: readFileSync(p, 'utf8') })
          }
          if (req.method === 'POST' && url.pathname === '/commit') {
            const { changes, message, baseShas } = (await body(req)) as {
              changes: { path: string; text: string | null }[]
              message: string
              baseShas: Record<string, string | undefined>
            }
            for (const c of changes) {
              const p = safePath(root, c.path)
              const cur = existsSync(p) ? blobSha(readFileSync(p)) : undefined
              if (cur !== baseShas[c.path]) return send(res, 409, `Conflict: ${c.path} changed on disk since it was loaded.`)
            }
            const shas: Record<string, string> = {}
            for (const c of changes) {
              const p = safePath(root, c.path)
              if (c.text === null) {
                rmSync(p, { force: true })
              } else {
                mkdirSync(dirname(p), { recursive: true })
                writeFileSync(p, c.text)
                shas[c.path] = blobSha(Buffer.from(c.text, 'utf8'))
              }
            }
            let commitSha = `local-${Date.now()}-${++counter}`
            if (gitCommit) {
              await run('git', ['add', '--', ...changes.map((c) => c.path)], root)
              const r = await run('git', ['commit', '-m', message, '--', ...changes.map((c) => c.path)], root)
              if (r.code === 0) commitSha = (await run('git', ['rev-parse', 'HEAD'], root)).out.trim()
            }
            server.config.logger.info(`[local-data] ${message}`)
            return send(res, 200, { commitSha, shas })
          }
          if (req.method === 'GET' && url.pathname === '/check') {
            const r = await run(hledger, ['-f', 'main.journal', 'check', '--strict', 'ordereddates'], root)
            const log = (r.err || r.out).trim()
            if (r.code === 0) return send(res, 200, { state: 'success', checkedAt: new Date().toISOString() })
            const m = /([^\s:"]*?\.journal):(\d+)(?::(\d+))?/.exec(log)
            const location = m
              ? { file: relative(root, resolve(root, m[1])).split(sep).join('/'), line: Number(m[2]), column: m[3] ? Number(m[3]) : undefined }
              : undefined
            const missing = /ENOENT|not recognized|not found/i.test(log) && !m
            return send(res, 200, {
              state: missing ? 'unknown' : 'failure',
              log: missing ? `hledger not found (${hledger}). Set HLEDGER=/path/to/hledger.` : log,
              location,
              checkedAt: new Date().toISOString()
            })
          }
          send(res, 404, 'not found')
        } catch (e) {
          send(res, 500, (e as Error).message)
        }
      })
    }
  }
}

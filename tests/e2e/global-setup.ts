import { cpSync, existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { writeSampleLedger } from './sample-ledger'

/**
 * A fresh ledger for every run, in tests/e2e/.data: by default the made-up sample ledger
 * (sample-ledger.ts); with E2E_SOURCE_DIR, a copy of that folder (it is never touched).
 */
export default function globalSetup() {
  const target = join(import.meta.dirname, '.data')
  rmSync(target, { recursive: true, force: true })
  const source = process.env.E2E_SOURCE_DIR
  if (!source) return writeSampleLedger(target)
  const dir = resolve(source)
  if (!existsSync(join(dir, 'main.journal'))) throw new Error(`E2E_SOURCE_DIR: ${dir}/main.journal not found`)
  cpSync(dir, target, { recursive: true, filter: (p) => !p.includes('.git') })
}

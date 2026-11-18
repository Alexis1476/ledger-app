import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { configWarnings, parseConfig } from '@/config/schema'
import { BackendError, gitBlobSha, type Backend, type FileChange } from '@/github/types'
import { fmtQty } from '@/ledger/decimal'
import { format } from '@/ledger/formatter'
import { deleteRange, ensureInclude, insertTransaction, moveTransaction, replaceRange, yearFile } from '@/ledger/insert'
import { addCommodity, addDeclaration, renameAccounts, setDeclarationTags } from '@/ledger/chart'
import { declareAccount } from '@/ledger/loans'
import { parseFile, parseJournal } from '@/ledger/parser'
import { describeRule, formatSchedule, type Rule, type Schedule } from '@/ledger/periodic'
import { balances, buildPriceDB, checkAssertions } from '@/ledger/reports'
import type { Transaction } from '@/ledger/types'
import { validate, type Issue } from '@/ledger/validate'
import { db, type CachedFile, type OutboxItem } from '@/offline/db'
import { useSettingsStore } from './settings'
import { useSyncStore } from './sync'

const NEW_YEAR_FILE_HEADER = (year: string) => `; ${year} — transactions written by the app (via:app). Keep sorted by date.\n`

export const SCHEDULE_FILE = 'journals/scheduled.journal'
const SCHEDULE_FILE_HEADER =
  '; scheduled.journal — scheduled payments, written by the app: hledger periodic transactions\n' +
  '; (`hledger --forecast` reads them; they are not part of the balances).\n'

export class ValidationError extends Error {
  constructor(readonly issues: Issue[]) {
    super(issues.map((i) => i.message).join('; '))
    this.name = 'ValidationError'
  }
}

function wanted(path: string) {
  return path.endsWith('.journal') || path === 'app.config.json' || (path.startsWith('lists/') && path.endsWith('.md'))
}

export function commitMessage(verb: 'add' | 'del' | 'edit', tx: Transaction): string {
  const first = tx.postings.find((p) => p.amount && !p.amount.qty.isZero()) ?? tx.postings[0]
  const amount = first?.amount ? `${fmtQty(first.amount.qty.abs())} ${first.amount.commodity}` : ''
  const what = tx.payee ?? tx.note ?? ''
  return `${verb}: ${tx.date} ${what} ${amount}`.replace(/\s+/g, ' ').trim()
}

export const useJournalStore = defineStore('journal', () => {
  const settings = useSettingsStore()
  const files = shallowRef<Record<string, CachedFile>>({})
  const headSha = ref<string>()
  const state = ref<'empty' | 'loading' | 'ready' | 'error'>('empty')
  const error = ref<string>()
  const syncedAt = ref<string>()
  const offline = ref(false)
  const outbox = ref<OutboxItem[]>([])

  const texts = computed(() => Object.fromEntries(Object.entries(files.value).map(([p, f]) => [p, f.text])))
  const journal = computed(() => parseJournal(texts.value))
  const configResult = computed(() => parseConfig(files.value['app.config.json']?.text))
  const config = computed(() => configResult.value.config)
  const warnings = computed(() => [
    ...configResult.value.errors,
    ...configWarnings(config.value, journal.value.accounts.map((a) => a.name))
  ])
  const prices = computed(() => buildPriceDB(journal.value))
  const balanceMap = computed(() => balances(journal.value))
  const hasData = computed(() => Object.keys(files.value).length > 0)

  let backend: Backend | undefined
  function api(): Backend {
    if (!backend) backend = settings.makeBackend()
    return backend
  }
  function resetBackend() {
    backend = undefined
  }

  async function persist() {
    await db.setCache({
      source: settings.source,
      headSha: headSha.value ?? '',
      files: files.value,
      syncedAt: syncedAt.value ?? ''
    })
  }

  /** Open instantly from the IndexedDB cache (also offline). */
  async function loadCache() {
    const c = await db.getCache()
    outbox.value = await db.getOutbox()
    if (c && c.source === settings.source) {
      files.value = c.files
      headSha.value = c.headSha
      syncedAt.value = c.syncedAt
      state.value = 'ready'
    }
  }

  /** Download files whose blob sha changed since the cache. */
  async function refresh() {
    if (!settings.configured) return
    if (state.value !== 'ready') state.value = 'loading'
    error.value = undefined
    try {
      const b = api()
      const { headSha: head, files: remote } = await b.listFiles()
      const next: Record<string, CachedFile> = {}
      const todo = remote.filter((f) => wanted(f.path))
      await Promise.all(
        todo.map(async (f) => {
          const cached = files.value[f.path]
          next[f.path] = cached && cached.sha === f.sha ? cached : { sha: f.sha, text: await b.readFile(f.path, f.sha) }
        })
      )
      if (!next['main.journal']) throw new BackendError('main.journal not found at the root of the repository.')
      files.value = next
      headSha.value = head
      syncedAt.value = new Date().toISOString()
      offline.value = false
      state.value = 'ready'
      await persist()
    } catch (e) {
      const err = e as BackendError
      offline.value = !!err.network
      error.value = err.message
      if (!hasData.value) state.value = 'error'
      throw e
    }
  }

  async function init() {
    await loadCache()
    if (!settings.configured) return
    try {
      await refresh()
      await flushOutbox()
    } catch {
      /* error shown from state */
    }
  }

  /** Full reset when the data source changes. */
  async function reload() {
    resetBackend()
    files.value = {}
    headSha.value = undefined
    state.value = 'empty'
    await db.clearCache()
    await init()
  }

  function check(tx: Transaction, replacing?: Transaction): Issue[] {
    return validate(tx, journal.value, replacing ? { replacing } : {})
  }

  /** Re-parse the journal with the changed files and make sure nothing broke (layer 2). */
  function verifyAfter(changed: Record<string, string>, tx?: Transaction) {
    const before = journal.value
    const after = parseJournal({ ...texts.value, ...changed })
    const errs = (j: typeof after) => new Set(j.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.file}:${d.message}`))
    const old = errs(before)
    const fresh = [...errs(after)].filter((x) => !old.has(x))
    if (fresh.length) throw new Error(`The change would break the journal: ${fresh.join('; ')}`)
    if (tx?.id && !after.transactions.some((t) => t.id === tx.id)) {
      throw new Error('The new transaction is not reachable from main.journal.')
    }
    const failing = checkAssertions(after.transactions).length
    if (failing > checkAssertions(before.transactions).length) throw new Error('The change breaks a balance assertion.')
  }

  async function commitChanges(changed: Record<string, string>, message: string): Promise<string> {
    const changes: FileChange[] = Object.entries(changed).map(([path, text]) => ({ path, text }))
    const base = Object.fromEntries(Object.keys(changed).map((p) => [p, files.value[p]?.sha]))
    const r = await api().commit(changes, message, base)
    const next = { ...files.value }
    for (const [path, text] of Object.entries(changed)) {
      next[path] = { sha: r.shas[path] ?? (await gitBlobSha(text)), text }
    }
    files.value = next
    headSha.value = r.commitSha
    await persist()
    useSyncStore().track(r.commitSha, message)
    return r.commitSha
  }

  function planAdd(tx: Transaction): Record<string, string> {
    const target = yearFile(tx.date)
    const current = files.value[target]?.text ?? NEW_YEAR_FILE_HEADER(tx.date.slice(0, 4))
    const changed: Record<string, string> = { [target]: insertTransaction(current, format(tx), tx.date).text }
    if (!journal.value.files.includes(target)) {
      const main = files.value['main.journal']?.text ?? ''
      changed['main.journal'] = ensureInclude(main, target)
    }
    return changed
  }

  /**
   * Validate, format, insert at the chronological position and commit (one commit).
   * Offline: the formatted entry goes to the outbox and is replayed later.
   */
  async function addTransaction(tx: Transaction, opts: { queueOffline?: boolean } = { queueOffline: true }) {
    const issues = check(tx)
    if (issues.length) throw new ValidationError(issues)
    const attempt = async () => {
      const changed = planAdd(tx)
      verifyAfter(changed, tx)
      return commitChanges(changed, commitMessage('add', tx))
    }
    try {
      try {
        return { commitSha: await attempt(), queued: false }
      } catch (e) {
        if (e instanceof BackendError && e.status === 409) {
          // the file changed elsewhere: re-read, re-apply, retry once
          await refresh()
          const again = check(tx)
          if (again.length) throw new ValidationError(again)
          return { commitSha: await attempt(), queued: false }
        }
        throw e
      }
    } catch (e) {
      if (e instanceof BackendError && e.network && opts.queueOffline) {
        await enqueue(tx)
        offline.value = true
        return { commitSha: undefined, queued: true }
      }
      throw e
    }
  }

  /** Exact current text of a transaction, or an error when the file changed since it was parsed. */
  async function currentText(tx: Transaction): Promise<string> {
    if (!tx.src) throw new Error('Transaction has no source position.')
    const { file, startLine, endLine, raw } = tx.src
    const text = files.value[file]?.text
    if (text === undefined) throw new Error(`${file} is not loaded.`)
    const lines = text.replace(/\r\n?/g, '\n').split('\n')
    if (lines.slice(startLine - 1, endLine).join('\n') !== raw) {
      await refresh()
      throw new Error('The file changed since it was loaded. Reopen the transaction and try again.')
    }
    return text
  }

  /**
   * Edit: rewrite only the transaction's lines. A new date moves it to its chronological place;
   * a new year moves it from its yearly file (journals/2026.journal) to the
   * app's yearly file of the new date, in one commit.
   */
  async function replaceTransaction(old: Transaction, tx: Transaction) {
    const issues = check(tx, old)
    if (issues.length) throw new ValidationError(issues)
    const text = await currentText(old)
    const { file, startLine, endLine } = old.src!
    const yearBound = /(^|[-/])\d{4}\.journal$/.test(file)
    const changed: Record<string, string> = {}
    if (tx.date === old.date) {
      changed[file] = replaceRange(text, startLine, endLine, format(tx)).text
    } else if (!yearBound || tx.date.slice(0, 4) === old.date.slice(0, 4)) {
      changed[file] = moveTransaction(text, startLine, endLine, format(tx), tx.date).text
    } else {
      changed[file] = deleteRange(text, startLine, endLine)
      const target = yearFile(tx.date)
      const base = target === file ? changed[file] : files.value[target]?.text ?? NEW_YEAR_FILE_HEADER(tx.date.slice(0, 4))
      changed[target] = insertTransaction(base, format(tx), tx.date).text
      if (!journal.value.files.includes(target)) changed['main.journal'] = ensureInclude(files.value['main.journal']?.text ?? '', target)
    }
    verifyAfter(changed, tx)
    return commitChanges(changed, commitMessage('edit', tx))
  }

  async function deleteTransaction(tx: Transaction) {
    const text = await currentText(tx)
    const { file, startLine, endLine } = tx.src!
    const changed = { [file]: deleteRange(text, startLine, endLine) }
    verifyAfter(changed)
    return commitChanges(changed, commitMessage('del', tx))
  }

  /**
   * Rewrite a non-journal file (e.g. lists/shopping.md) from its current text, in one commit.
   * The file changed elsewhere (409): re-read and apply `update` again on the new text.
   */
  async function saveFile(path: string, update: (text: string | undefined) => string, message: string) {
    const attempt = async () => {
      const current = files.value[path]?.text
      const next = update(current)
      if (next === current) return undefined
      return commitChanges({ [path]: next }, message)
    }
    try {
      return await attempt()
    } catch (e) {
      if (e instanceof BackendError && e.status === 409) {
        await refresh()
        return attempt()
      }
      throw e
    }
  }

  /**
   * Declare a new account (pocket or category) with its tags, and its currency if new, in one
   * commit; checked like any change (the journal must still parse).
   */
  async function addAccount(account: string, tags: Record<string, string>, currency?: string) {
    if (journal.value.accounts.some((a) => a.name === account)) throw new Error(`${account} already exists.`)
    const attempt = async () => {
      const accFile = journal.value.accounts.find((a) => a.name.split(':')[0] === account.split(':')[0])?.src?.file ?? 'accounts.journal'
      const changed: Record<string, string> = { [accFile]: addDeclaration(files.value[accFile]?.text ?? '', account, tags) }
      if (currency && !journal.value.commodities.some((c) => c.symbol === currency)) {
        const comFile = journal.value.commodities[0]?.src?.file ?? 'commodities.journal'
        changed[comFile] = addCommodity(changed[comFile] ?? files.value[comFile]?.text ?? '', currency)
        if (!journal.value.files.includes(comFile)) changed['main.journal'] = ensureInclude(files.value['main.journal']?.text ?? '', comFile)
      }
      verifyAfter(changed)
      const after = parseJournal({ ...texts.value, ...changed })
      if (!after.accounts.some((a) => a.name === account)) throw new Error('The new account is not reachable from main.journal.')
      return commitChanges(changed, `accounts: add ${account}`)
    }
    try {
      return await attempt()
    } catch (e) {
      if (e instanceof BackendError && e.status === 409) {
        await refresh()
        return attempt()
      }
      throw e
    }
  }

  /** Commit several rewritten files, re-applied on the fresh text after a 409. */
  async function rewrite(build: () => Record<string, string>, message: string) {
    const attempt = async () => {
      const changed = build()
      if (!Object.keys(changed).length) return undefined
      verifyAfter(changed)
      return commitChanges(changed, message)
    }
    try {
      return await attempt()
    } catch (e) {
      if (e instanceof BackendError && e.status === 409) {
        await refresh()
        return attempt()
      }
      throw e
    }
  }

  /**
   * Move / rename accounts everywhere (declarations, postings in every journal, keys of
   * app.config.json). Balances do not change; the journal must still parse.
   */
  async function renameAccountsEverywhere(map: Record<string, string>) {
    const taken = new Set(journal.value.accounts.map((a) => a.name))
    for (const [from, to] of Object.entries(map)) {
      if (!taken.has(from)) throw new Error(`${from} is not declared.`)
      if (taken.has(to)) throw new Error(`${to} already exists.`)
    }
    const message = Object.entries(map).length === 1 ? `accounts: move ${Object.keys(map)[0]} → ${Object.values(map)[0]}` : `accounts: move ${Object.keys(map).length} accounts`
    return rewrite(() => {
      const changed: Record<string, string> = {}
      for (const path of journal.value.files) {
        const r = renameAccounts(files.value[path]?.text ?? '', map)
        if (r.count) changed[path] = r.text
      }
      const cfg = files.value['app.config.json']?.text
      if (cfg) {
        let next = cfg
        for (const [from, to] of Object.entries(map)) next = next.split(`"${from}"`).join(`"${to}"`)
        if (next !== cfg) changed['app.config.json'] = next
      }
      return changed
    }, message)
  }

  /** Set tags on an account declaration (label, archived…; '' removes a tag). */
  async function setAccountTags(account: string, tags: Record<string, string>) {
    const file = journal.value.accounts.find((a) => a.name === account)?.src?.file
    if (!file) throw new Error(`${account} is not declared.`)
    return rewrite(() => {
      const text = files.value[file]?.text ?? ''
      const next = setDeclarationTags(text, account, tags)
      return next === text ? {} : { [file]: next }
    }, `accounts: ${account} ${Object.entries(tags).map(([k, v]) => (v ? `${k}=${v}` : `-${k}`)).join(' ')}`)
  }

  /** Declare a person's account (assets:receivables:<who> / liabilities:people:<who>) if missing. */
  async function declarePersonAccount(account: string) {
    if (journal.value.accounts.some((a) => a.name === account)) return
    const decl = journal.value.accounts.find((a) => a.name.startsWith('assets:') || a.name.startsWith('liabilities'))?.src?.file ?? 'accounts.journal'
    await saveFile(decl, (text) => declareAccount(text ?? '', account), `accounts: add ${account}`)
  }

  // ── Scheduled payments (periodic transactions in journals/scheduled.journal) ──

  /** Add or replace a schedule (validated like a transaction dated on its first occurrence). */
  async function saveSchedule(rule: Rule, tx: Transaction, old?: Schedule) {
    const plain: Transaction = { ...tx, date: rule.from, status: '' }
    const issues = check(plain)
    if (issues.length) throw new ValidationError(issues)
    const text = formatSchedule(rule, plain)
    const changed: Record<string, string> = {}
    if (old?.src) {
      const current = await currentText({ ...old.tx, src: old.src })
      changed[old.src.file] = replaceRange(current, old.src.startLine, old.src.endLine, text).text
    } else {
      const base = files.value[SCHEDULE_FILE]?.text ?? SCHEDULE_FILE_HEADER
      changed[SCHEDULE_FILE] = `${base.replace(/\s*$/, '')}\n\n${text}\n`
      if (!journal.value.files.includes(SCHEDULE_FILE)) changed['main.journal'] = ensureInclude(files.value['main.journal']?.text ?? '', SCHEDULE_FILE)
    }
    verifyAfter(changed)
    const after = parseJournal({ ...texts.value, ...changed })
    if (tx.id && !after.schedules.some((x) => x.id === tx.id)) throw new Error('The schedule is not reachable from main.journal.')
    const what = `${tx.payee ?? 'payment'} (${describeRule(rule).toLowerCase()})`
    return commitChanges(changed, `schedule: ${old ? 'edit' : 'add'} ${what}`)
  }

  async function deleteSchedule(x: Schedule) {
    if (!x.src) throw new Error('Schedule has no source position.')
    const text = await currentText({ ...x.tx, src: x.src })
    const changed = { [x.src.file]: deleteRange(text, x.src.startLine, x.src.endLine) }
    verifyAfter(changed)
    return commitChanges(changed, `schedule: delete ${x.tx.payee ?? x.period}`)
  }

  /** Mark one occurrence as skipped (tag skip:<dates> on the schedule). */
  async function skipOccurrence(x: Schedule, date: string) {
    if (!x.rule) throw new Error('This schedule is read-only.')
    const skipped = new Set((x.tx.tags.skip ?? '').split(/\s+/).filter(Boolean))
    skipped.add(date)
    const tags = { ...x.tx.tags, skip: [...skipped].sort().join(' ') }
    return saveSchedule(x.rule, { ...x.tx, tags }, x)
  }

  // ── Outbox ───────────────────────────────────────────────────────────
  async function enqueue(tx: Transaction) {
    const item: OutboxItem = { id: tx.id!, date: tx.date, text: format(tx), createdAt: new Date().toISOString() }
    outbox.value = [...outbox.value.filter((i) => i.id !== item.id), item]
    await db.setOutbox(outbox.value)
  }

  let flushing = false
  async function flushOutbox() {
    if (flushing || !outbox.value.length) return
    flushing = true
    try {
      for (const item of [...outbox.value]) {
        const exists = journal.value.transactions.some((t) => t.id === item.id)
        if (!exists) {
          const tx = parseFile(item.text, 'outbox').transactions[0]
          delete tx.src
          try {
            await addTransaction(tx, { queueOffline: false })
          } catch (e) {
            if (e instanceof BackendError && e.network) break
            item.error = (e as Error).message
            outbox.value = [...outbox.value]
            await db.setOutbox(outbox.value)
            continue
          }
        }
        outbox.value = outbox.value.filter((i) => i.id !== item.id)
        await db.setOutbox(outbox.value)
      }
    } finally {
      flushing = false
    }
  }

  async function discardOutboxItem(id: string) {
    outbox.value = outbox.value.filter((i) => i.id !== id)
    await db.setOutbox(outbox.value)
  }

  return {
    files,
    headSha,
    state,
    error,
    syncedAt,
    offline,
    outbox,
    journal,
    config,
    warnings,
    prices,
    balanceMap,
    hasData,
    init,
    reload,
    refresh,
    resetBackend,
    check,
    addTransaction,
    replaceTransaction,
    saveFile,
    addAccount,
    renameAccountsEverywhere,
    setAccountTags,
    declarePersonAccount,
    saveSchedule,
    deleteSchedule,
    skipOccurrence,
    deleteTransaction,
    flushOutbox,
    discardOutboxItem,
    api
  }
})

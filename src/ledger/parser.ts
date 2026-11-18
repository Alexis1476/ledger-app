import { Decimal } from './decimal'
import { parseRule, type Schedule } from './periodic'
import type {
  AccountDecl,
  Amount,
  Assertion,
  CommodityDecl,
  Diagnostic,
  IncludeDecl,
  Journal,
  ParsedFile,
  Posting,
  PriceDecl,
  Transaction,
  TxStatus,
  UnsupportedBlock
} from './types'

const DATE_RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/
// characters that can never be part of an unquoted commodity symbol
const COMMODITY_RE = /^(?:"[^"]+"|[^\s\d\-+.,@;=*"{}()[\]]+)/
const NUMBER_RE = /^[-+]?\d[\d,']*(?:\.\d*)?|^[-+]?\.\d+/

export function normalizeDate(y: string, m: string, d: string): string {
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

/** Parse tags from a comment, hledger style: `name:value` separated by commas. */
export function parseTags(comment: string): Record<string, string> {
  const tags: Record<string, string> = {}
  let i = 0
  const n = comment.length
  while (i < n) {
    // a tag name starts at the beginning, after whitespace or after a comma
    const prev = i === 0 ? ' ' : comment[i - 1]
    if (/[\s,]/.test(prev)) {
      const m = /^([^\s,:]+):/.exec(comment.slice(i))
      if (m) {
        const start = i + m[0].length
        let end = comment.indexOf(',', start)
        if (end < 0) end = n
        tags[m[1]] = comment.slice(start, end).trim()
        i = end + 1
        continue
      }
    }
    i++
  }
  return tags
}

/** Split `text  ; comment` at the first `;`. */
function splitComment(s: string): [string, string | undefined] {
  const i = s.indexOf(';')
  if (i < 0) return [s, undefined]
  return [s.slice(0, i), s.slice(i + 1).trim()]
}

function parseNumber(raw: string): Decimal | undefined {
  // dot is the decimal mark; commas and apostrophes are digit-group marks
  const clean = raw.replace(/[,']/g, '')
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(clean)) return undefined
  return new Decimal(clean.endsWith('.') ? clean.slice(0, -1) : clean)
}

function unquote(sym: string): string {
  return sym.startsWith('"') ? sym.slice(1, -1) : sym
}

interface AmountParse {
  amount: Amount | undefined
  rest: string
  error?: string
}

/** Parse one simple amount (no cost) at the start of `s`. */
export function parseSimpleAmount(s: string): { qty: Decimal; commodity: string; rest: string } | undefined {
  let rest = s.trimStart()
  let sign = ''
  if (rest[0] === '-' || rest[0] === '+') {
    sign = rest[0] === '-' ? '-' : ''
    rest = rest.slice(1).trimStart()
  }
  let commodity = ''
  // commodity on the left
  let m = COMMODITY_RE.exec(rest)
  if (m) {
    commodity = unquote(m[0])
    rest = rest.slice(m[0].length).trimStart()
    if (rest[0] === '-' || rest[0] === '+') {
      if (rest[0] === '-') sign = sign === '-' ? '' : '-'
      rest = rest.slice(1)
    }
  }
  const nm = NUMBER_RE.exec(rest)
  if (!nm) return undefined
  const qtyRaw = nm[0]
  rest = rest.slice(qtyRaw.length)
  let qty = parseNumber(qtyRaw)
  if (!qty) return undefined
  if (sign === '-') qty = qty.neg()
  if (!commodity) {
    const after = rest.replace(/^ +/, '')
    m = COMMODITY_RE.exec(after)
    if (m) {
      commodity = unquote(m[0])
      rest = after.slice(m[0].length)
    }
  }
  return { qty, commodity, rest }
}

/** Parse `AMOUNT [@|@@ COST]` */
function parseAmount(s: string): AmountParse {
  const a = parseSimpleAmount(s)
  if (!a) return { amount: undefined, rest: s, error: `cannot parse amount "${s.trim()}"` }
  const amount: Amount = { qty: a.qty, commodity: a.commodity }
  let rest = a.rest.trimStart()
  if (rest.startsWith('{')) return { amount, rest, error: 'lot prices {} are not supported' }
  if (rest.startsWith('@')) {
    const kind = rest.startsWith('@@') ? 'total' : 'unit'
    rest = rest.slice(kind === 'total' ? 2 : 1)
    const c = parseSimpleAmount(rest)
    if (!c) return { amount, rest, error: 'cannot parse cost' }
    amount.cost = { qty: c.qty, commodity: c.commodity, kind }
    rest = c.rest.trimStart()
  }
  return { amount, rest }
}

function parseStatus(s: string): [TxStatus, string] {
  if (s.startsWith('*')) return ['*', s.slice(1).trimStart()]
  if (s.startsWith('!')) return ['!', s.slice(1).trimStart()]
  return ['', s]
}

export function splitDescription(desc: string): { payee?: string; note?: string } {
  const d = desc.trim()
  if (!d) return {}
  const i = d.indexOf('|')
  if (i < 0) return { payee: d }
  const payee = d.slice(0, i).trim()
  const note = d.slice(i + 1).trim()
  return { payee: payee || undefined, note: note || undefined }
}

export function description(tx: Pick<Transaction, 'payee' | 'note'>): string {
  if (tx.payee && tx.note) return `${tx.payee} | ${tx.note}`
  return tx.payee ?? tx.note ?? ''
}

function isBlank(line: string): boolean {
  return line.trim() === ''
}

function isIndented(line: string): boolean {
  return line.length > 0 && (line[0] === ' ' || line[0] === '\t')
}

/** Account name ends at two spaces, a tab, or end of text. */
function splitAccount(s: string): [string, string] {
  const m = /( {2,}|\t)/.exec(s)
  if (!m) return [s.trimEnd(), '']
  return [s.slice(0, m.index).trimEnd(), s.slice(m.index)]
}

function parsePosting(body: string, file: string, line: number, diags: Diagnostic[]): Posting | 'unsupported' {
  let rest = body.trim()
  let pstatus: TxStatus = ''
  ;[pstatus, rest] = parseStatus(rest)
  const [main, comment] = splitComment(rest)
  let [account, tail] = splitAccount(main)
  let virtual: Posting['virtual']
  if ((account.startsWith('(') && account.endsWith(')')) || (account.startsWith('[') && account.endsWith(']'))) {
    virtual = account.startsWith('(') ? 'round' : 'square'
    account = account.slice(1, -1)
  }
  const posting: Posting = { account, tags: comment ? parseTags(comment) : {} }
  if (pstatus) posting.status = pstatus
  if (comment !== undefined) posting.comment = comment
  if (virtual) posting.virtual = virtual
  tail = tail.trim()
  if (tail && !tail.startsWith('=')) {
    const r = parseAmount(tail)
    if (r.error) {
      diags.push({ file, line, message: r.error, severity: 'error' })
      return 'unsupported'
    }
    posting.amount = r.amount
    tail = r.rest.trim()
  }
  if (tail.startsWith('=')) {
    let t = tail.slice(1)
    let total = false
    let inclusive = false
    if (t.startsWith('=')) {
      total = true
      t = t.slice(1)
    }
    if (t.startsWith('*')) {
      inclusive = true
      t = t.slice(1)
    }
    const r = parseAmount(t)
    if (r.error || !r.amount) {
      diags.push({ file, line, message: r.error ?? 'bad assertion', severity: 'error' })
      return 'unsupported'
    }
    const assertion: Assertion = { amount: r.amount, inclusive, total }
    posting.assertion = assertion
    tail = r.rest.trim()
  }
  if (tail) {
    diags.push({ file, line, message: `unexpected text after amount: "${tail}"`, severity: 'error' })
    return 'unsupported'
  }
  if (virtual) return 'unsupported'
  return posting
}

/** Parse one journal file. Never throws: problems become diagnostics. */
export function parseFile(text: string, file = 'main.journal'): ParsedFile {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: ParsedFile = {
    file,
    transactions: [],
    accounts: [],
    commodities: [],
    prices: [],
    includes: [],
    schedules: [],
    unsupported: [],
    diagnostics: []
  }
  const diags = out.diagnostics
  let i = 0

  /** index (0-based) of the last line of the indented block starting after line `start` */
  const blockEnd = (start: number): number => {
    let end = start
    let j = start + 1
    while (j < lines.length && isIndented(lines[j])) {
      if (!isBlank(lines[j])) end = j
      j++
    }
    return end
  }
  const range = (s: number, e: number) => ({
    file,
    startLine: s + 1,
    endLine: e + 1,
    raw: lines.slice(s, e + 1).join('\n')
  })

  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line) || /^[;#*%|]/.test(line)) {
      i++
      continue
    }
    if (isIndented(line)) {
      // stray indented line outside a block
      if (!/^\s*;/.test(line)) {
        diags.push({ file, line: i + 1, message: 'unexpected indented line', severity: 'warning' })
      }
      i++
      continue
    }
    if (/^comment\s*$/.test(line)) {
      while (i < lines.length && !/^end comment\s*$/.test(lines[i])) i++
      i++
      continue
    }

    const dm = DATE_RE.exec(line)
    if (dm) {
      const end = blockEnd(i)
      const tx = parseTransaction(lines, i, end, file, diags)
      if (tx) out.transactions.push(tx)
      i = end + 1
      continue
    }

    const [head] = splitComment(line)
    const word = head.split(/\s+/, 1)[0]
    if (word === 'account') {
      const end = blockEnd(i)
      // like hledger: the comment starts after two spaces (or a tab); with one space before ';'
      // the rest of the line is part of the account name
      const body = line.slice(line.indexOf('account') + 'account'.length).trim()
      const cm = /(?: {2,}|\t)\s*;/.exec(body)
      const name = splitAccount(cm ? body.slice(0, cm.index) : body)[0]
      const comment = cm ? body.slice(cm.index).replace(/^\s*;\s?/, '') : undefined
      const decl: AccountDecl = { name, tags: comment ? parseTags(comment) : {}, src: range(i, end) }
      if (comment) decl.comment = comment
      out.accounts.push(decl)
      i = end + 1
      continue
    }
    if (word === 'commodity') {
      const end = blockEnd(i)
      const arg = head.slice('commodity'.length).trim()
      const decl: CommodityDecl = { symbol: arg, src: range(i, end) }
      const a = parseSimpleAmount(arg)
      if (a && a.commodity) {
        decl.symbol = a.commodity
        decl.format = arg
        const dot = arg.match(/\.(\d+)/)
        decl.precision = dot ? dot[1].length : 0
      } else {
        decl.symbol = unquote(arg)
        for (let j = i + 1; j <= end; j++) {
          const fm = /^\s+format\s+(.+)$/.exec(lines[j])
          if (fm) {
            decl.format = fm[1].trim()
            const dot = decl.format.match(/\.(\d+)/)
            decl.precision = dot ? dot[1].length : 0
          }
        }
      }
      out.commodities.push(decl)
      i = end + 1
      continue
    }
    if (word === 'P') {
      const m = /^P\s+(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\s+[\d:]+)?\s+("[^"]+"|\S+)\s+(.+)$/.exec(head.trim())
      const a = m ? parseSimpleAmount(m[5]) : undefined
      if (m && a && a.commodity) {
        const decl: PriceDecl = {
          date: normalizeDate(m[1], m[2], m[3]),
          commodity: unquote(m[4]),
          price: { qty: a.qty, commodity: a.commodity },
          src: range(i, i)
        }
        out.prices.push(decl)
      } else {
        diags.push({ file, line: i + 1, message: 'cannot parse price directive', severity: 'error' })
      }
      i++
      continue
    }
    if (word === 'include') {
      const p = head.slice('include'.length).trim()
      const decl: IncludeDecl = { path: p, src: range(i, i) }
      out.includes.push(decl)
      i++
      continue
    }
    if (line.startsWith('~')) {
      // periodic transaction: "~ PERIOD  description  ; tags" — parsed like a transaction whose
      // date is the period's start (a schedule; never part of the balances)
      const end = blockEnd(i)
      const after = line.slice(1).trim()
      const sep = /\s{2,}|\t/.exec(after)
      const period = (sep ? after.slice(0, sep.index) : splitComment(after)[0]).trim()
      const rest = sep ? after.slice(sep.index).trim() : (() => {
        const c = splitComment(after)[1]
        return c !== undefined ? `; ${c}` : ''
      })()
      const rule = parseRule(period)
      const copy = [...lines]
      copy[i] = `${rule?.from ?? '1900-01-01'} ${rest}`
      const tx = parseTransaction(copy, i, end, file, diags)
      if (tx) {
        tx.src = range(i, end)
        const s: Schedule = { period, tx, src: range(i, end) }
        if (rule) s.rule = rule
        if (tx.id) s.id = tx.id
        out.schedules.push(s)
      }
      i = end + 1
      continue
    }
    if (word === '=' || line.startsWith('=')) {
      const end = blockEnd(i)
      const block: UnsupportedBlock = {
        ...range(i, end),
        reason: 'auto posting rule'
      }
      out.unsupported.push(block)
      i = end + 1
      continue
    }
    // other directives (alias, decimal-mark, payee, tag, Y, D, apply …): keep, don't interpret
    const end = blockEnd(i)
    out.unsupported.push({ ...range(i, end), reason: `directive "${word}"` })
    diags.push({ file, line: i + 1, message: `unsupported directive "${word}" ignored`, severity: 'warning' })
    i = end + 1
  }
  return out
}

function parseTransaction(
  lines: string[],
  start: number,
  end: number,
  file: string,
  diags: Diagnostic[]
): Transaction | undefined {
  const header = lines[start]
  const dm = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:=(\d{4})[-/.](\d{1,2})[-/.](\d{1,2}))?/.exec(header)!
  const date = normalizeDate(dm[1], dm[2], dm[3])
  let rest = header.slice(dm[0].length)
  const [headMain, headComment] = splitComment(rest)
  rest = headMain.trim()
  const [status, afterStatus] = parseStatus(rest)
  rest = afterStatus
  let code: string | undefined
  const cm = /^\(([^)]*)\)\s*/.exec(rest)
  if (cm) {
    code = cm[1]
    rest = rest.slice(cm[0].length)
  }
  const { payee, note } = splitDescription(rest)
  const tx: Transaction = {
    date,
    status,
    postings: [],
    tags: {},
    src: {
      file,
      startLine: start + 1,
      endLine: end + 1,
      raw: lines.slice(start, end + 1).join('\n')
    }
  }
  if (dm[4]) tx.date2 = normalizeDate(dm[4], dm[5], dm[6])
  if (code !== undefined) tx.code = code
  if (payee !== undefined) tx.payee = payee
  if (note !== undefined) tx.note = note

  const commentLines: string[] = []
  if (headComment !== undefined) commentLines.push(headComment)

  let last: Posting | undefined
  for (let j = start + 1; j <= end; j++) {
    const l = lines[j]
    if (isBlank(l)) continue
    const t = l.trim()
    if (t.startsWith(';') || t.startsWith('#')) {
      const c = t.slice(1).trim()
      if (last) {
        last.comment = last.comment !== undefined ? `${last.comment}\n${c}` : c
        Object.assign(last.tags, parseTags(c))
      } else {
        commentLines.push(c)
      }
      continue
    }
    const p = parsePosting(l, file, j + 1, diags)
    if (p === 'unsupported') {
      tx.unsupported = true
      last = undefined
      continue
    }
    tx.postings.push(p)
    last = p
  }
  if (commentLines.length) {
    tx.comment = commentLines.join('\n')
    for (const c of commentLines) Object.assign(tx.tags, parseTags(c))
  }
  if (tx.tags.id) tx.id = tx.tags.id
  if (!tx.unsupported && tx.postings.filter((p) => !p.amount).length > 1) {
    diags.push({ file, line: start + 1, message: 'more than one posting without amount', severity: 'error' })
  }
  if (tx.postings.length === 0 && !tx.unsupported) {
    diags.push({ file, line: start + 1, message: 'transaction without postings', severity: 'warning' })
  }
  return tx
}

// ── Multi-file journals ────────────────────────────────────────────────

export function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

export function joinPath(dir: string, rel: string): string {
  const parts = (dir ? `${dir}/${rel}` : rel).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '' || p === '.') continue
    if (p === '..') out.pop()
    else out.push(p)
  }
  return out.join('/')
}

function globToRegExp(glob: string): RegExp {
  const re = glob
    .split('')
    .map((c) => (c === '*' ? '[^/]*' : c === '?' ? '[^/]' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('')
  return new RegExp(`^${re}$`)
}

/** Resolve an include path against the including file and the list of known files. */
export function resolveInclude(fromFile: string, includePath: string, knownFiles: string[]): string[] {
  const target = joinPath(dirname(fromFile), includePath)
  if (!/[*?]/.test(target)) return [target]
  const re = globToRegExp(target)
  return knownFiles.filter((f) => re.test(f)).sort()
}

/**
 * Parse a journal made of several files. `files` maps repo-relative paths to text.
 * Includes are followed depth-first in order, like hledger.
 */
export function parseJournal(files: Record<string, string>, entry = 'main.journal'): Journal {
  const journal: Journal = {
    files: [],
    transactions: [],
    accounts: [],
    commodities: [],
    prices: [],
    includes: [],
    schedules: [],
    unsupported: [],
    diagnostics: []
  }
  const known = Object.keys(files)
  const visiting = new Set<string>()

  const visit = (path: string, from?: { file: string; line: number }) => {
    if (visiting.has(path) || journal.files.includes(path)) return
    const text = files[path]
    if (text === undefined) {
      journal.diagnostics.push({
        file: from?.file ?? path,
        line: from?.line ?? 0,
        message: `included file not found: ${path}`,
        severity: 'error'
      })
      return
    }
    visiting.add(path)
    journal.files.push(path)
    const pf = parseFile(text, path)
    journal.diagnostics.push(...pf.diagnostics)
    journal.unsupported.push(...pf.unsupported)
    journal.schedules.push(...pf.schedules)
    // process items in source order so includes interleave correctly
    type Item =
      | { line: number; kind: 'tx'; v: Transaction }
      | { line: number; kind: 'acc'; v: AccountDecl }
      | { line: number; kind: 'com'; v: CommodityDecl }
      | { line: number; kind: 'price'; v: PriceDecl }
      | { line: number; kind: 'inc'; v: IncludeDecl }
    const items: Item[] = [
      ...pf.transactions.map((v) => ({ line: v.src!.startLine, kind: 'tx' as const, v })),
      ...pf.accounts.map((v) => ({ line: v.src!.startLine, kind: 'acc' as const, v })),
      ...pf.commodities.map((v) => ({ line: v.src!.startLine, kind: 'com' as const, v })),
      ...pf.prices.map((v) => ({ line: v.src!.startLine, kind: 'price' as const, v })),
      ...pf.includes.map((v) => ({ line: v.src!.startLine, kind: 'inc' as const, v }))
    ].sort((a, b) => a.line - b.line)
    for (const it of items) {
      switch (it.kind) {
        case 'tx':
          it.v.index = journal.transactions.length
          journal.transactions.push(it.v)
          break
        case 'acc':
          journal.accounts.push(it.v)
          break
        case 'com':
          journal.commodities.push(it.v)
          break
        case 'price':
          journal.prices.push(it.v)
          break
        case 'inc': {
          journal.includes.push(it.v)
          const targets = resolveInclude(path, it.v.path, known)
          if (targets.length === 0) {
            journal.diagnostics.push({
              file: path,
              line: it.line,
              message: `include matched no files: ${it.v.path}`,
              severity: /[*?]/.test(it.v.path) ? 'warning' : 'error'
            })
          }
          for (const t of targets) visit(t, { file: path, line: it.line })
          break
        }
      }
    }
    visiting.delete(path)
  }
  visit(entry)
  return journal
}

/** Files referenced (directly or by glob) from the entry file, in include order. */
export function includedFiles(files: Record<string, string>, entry = 'main.journal'): string[] {
  return parseJournal(files, entry).files
}

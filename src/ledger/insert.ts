import { parseFile } from './parser'

export interface EditResult {
  text: string
  /** 1-based line range of the inserted / replaced transaction in the new text */
  startLine: number
  endLine: number
}

function toLines(text: string): string[] {
  const t = text.replace(/\r\n?/g, '\n')
  const lines = t.split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function toText(lines: string[]): string {
  return lines.length ? lines.join('\n') + '\n' : ''
}

const blank = (l: string | undefined) => l === undefined || l.trim() === ''
const isComment = (l: string) => /^[;#]/.test(l)

/** Target file of an app-written transaction. */
export function yearFile(date: string): string {
  return `journals/${date.slice(0, 4)}.journal`
}

/**
 * 0-based line index where a transaction dated `date` must be inserted:
 * after the last transaction with date ≤ `date`, else before the first one
 * (and its preceding comment lines), else at the end of the file.
 */
export function findInsertIndex(text: string, date: string): { index: number; mode: 'after' | 'before' | 'end' } {
  const lines = toLines(text)
  const txs = parseFile(text).transactions
  let last: number | undefined
  for (const tx of txs) if (tx.date <= date) last = tx.src!.endLine
  if (last !== undefined) return { index: last, mode: 'after' }
  if (txs.length) {
    let i = txs[0].src!.startLine - 1
    while (i > 0 && isComment(lines[i - 1])) i--
    return { index: i, mode: 'before' }
  }
  return { index: lines.length, mode: 'end' }
}

/** Insert a formatted transaction at its chronological position, keeping one blank line between entries. */
export function insertTransaction(fileText: string, txText: string, date: string): EditResult {
  const lines = toLines(fileText)
  const txLines = toLines(txText)
  const { index } = findInsertIndex(fileText, date)
  const block: string[] = []
  if (index > 0 && !blank(lines[index - 1])) block.push('')
  const start = index + block.length
  block.push(...txLines)
  if (index < lines.length && !blank(lines[index])) block.push('')
  lines.splice(index, 0, ...block)
  return { text: toText(lines), startLine: start + 1, endLine: start + txLines.length }
}

/** Replace lines startLine..endLine (1-based, inclusive) with a new transaction text. */
export function replaceRange(fileText: string, startLine: number, endLine: number, txText: string): EditResult {
  const lines = toLines(fileText)
  const txLines = toLines(txText)
  lines.splice(startLine - 1, endLine - startLine + 1, ...txLines)
  return { text: toText(lines), startLine, endLine: startLine + txLines.length - 1 }
}

/** Delete lines startLine..endLine and one now-redundant blank line. */
export function deleteRange(fileText: string, startLine: number, endLine: number): string {
  const lines = toLines(fileText)
  let s = startLine - 1
  let count = endLine - startLine + 1
  if (blank(lines[s + count]) && s + count < lines.length) count++
  else if (s > 0 && blank(lines[s - 1])) {
    s--
    count++
  }
  lines.splice(s, count)
  return toText(lines)
}

/**
 * Move a transaction to a new date: delete it, then insert at the new position.
 * Only valid when old and new dates are in the same file.
 */
export function moveTransaction(
  fileText: string,
  startLine: number,
  endLine: number,
  txText: string,
  date: string
): EditResult {
  return insertTransaction(deleteRange(fileText, startLine, endLine), txText, date)
}

/** Add `include <path>` to main.journal if missing (after the last include line). */
export function ensureInclude(mainText: string, path: string): string {
  const lines = toLines(mainText)
  const re = new RegExp(`^include\\s+${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`)
  if (lines.some((l) => re.test(l))) return toText(lines)
  let last = -1
  lines.forEach((l, i) => {
    if (/^include\s/.test(l)) last = i
  })
  lines.splice(last + 1, 0, `include ${path}`)
  return toText(lines)
}

/** Whether every transaction of a file is in date order (hledger ordereddates). */
export function isOrdered(fileText: string): boolean {
  const txs = parseFile(fileText).transactions
  return txs.every((t, i) => i === 0 || txs[i - 1].date <= t.date)
}

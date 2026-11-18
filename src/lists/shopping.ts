/**
 * Shopping list = a Markdown checklist in ledger-data (lists/shopping.md):
 *
 *   # Shopping list
 *
 *   - [ ] Milk
 *   - [x] Bread
 *
 * Other lines (title, notes, headings) are kept as they are. Changes are operations replayed on
 * the latest file text, so two devices editing the list do not overwrite each other.
 */

export const SHOPPING_FILE = 'lists/shopping.md'
export const EMPTY_LIST = '# Shopping list\n'

export interface Item {
  text: string
  done: boolean
}

type Line = { item: Item } | { raw: string }

export interface ShoppingList {
  lines: Line[]
}

export type ListOp =
  | { op: 'add'; text: string }
  | { op: 'toggle'; text: string; done: boolean }
  | { op: 'remove'; text: string }
  | { op: 'clearDone' }

const ITEM = /^\s*[-*+] \[( |x|X)\]\s+(.*?)\s*$/

export function parseList(md: string | undefined): ShoppingList {
  const text = (md ?? EMPTY_LIST).replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  return {
    lines: text.split('\n').map((l) => {
      const m = ITEM.exec(l)
      return m ? { item: { text: m[2], done: m[1] !== ' ' } } : { raw: l }
    })
  }
}

export function formatList(list: ShoppingList): string {
  const out = list.lines.map((l) => ('item' in l ? `- [${l.item.done ? 'x' : ' '}] ${l.item.text}` : l.raw))
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '')}\n`
}

export const items = (list: ShoppingList): Item[] => list.lines.flatMap((l) => ('item' in l ? [l.item] : []))

const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()

/** Applies one change (by item text, case-insensitive), returning a new list. */
export function applyOp(list: ShoppingList, o: ListOp): ShoppingList {
  const lines = list.lines.map((l) => ('item' in l ? { item: { ...l.item } } : l))
  const find = (t: string) => lines.findIndex((l) => 'item' in l && same(l.item.text, t))
  switch (o.op) {
    case 'add': {
      const text = o.text.trim()
      if (!text) return list
      const i = find(text)
      if (i >= 0) {
        // already there: back on the list
        ;(lines[i] as { item: Item }).item.done = false
        return { lines }
      }
      // after the last item (or after the header, separated by a blank line)
      let at = -1
      lines.forEach((l, k) => {
        if ('item' in l) at = k
      })
      if (at < 0) {
        while (lines.length && 'raw' in lines[lines.length - 1] && !(lines[lines.length - 1] as { raw: string }).raw.trim()) lines.pop()
        lines.push({ raw: '' }, { item: { text, done: false } })
      } else lines.splice(at + 1, 0, { item: { text, done: false } })
      return { lines }
    }
    case 'toggle': {
      const i = find(o.text)
      if (i >= 0) (lines[i] as { item: Item }).item.done = o.done
      return { lines }
    }
    case 'remove': {
      const i = find(o.text)
      if (i >= 0) lines.splice(i, 1)
      return { lines }
    }
    case 'clearDone':
      return { lines: lines.filter((l) => !('item' in l) || !l.item.done) }
  }
}

/** "milk, bread; eggs" → three items. */
export function splitInput(s: string): string[] {
  return s
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

/** Commit message for a batch of changes. */
export function describeOps(ops: ListOp[]): string {
  if (ops.length === 1) {
    const o = ops[0]
    if (o.op === 'add') return `list: add ${o.text}`
    if (o.op === 'remove') return `list: remove ${o.text}`
    if (o.op === 'toggle') return `list: ${o.done ? 'bought' : 'to buy'} ${o.text}`
    return 'list: clear bought items'
  }
  return `list: ${ops.length} changes`
}

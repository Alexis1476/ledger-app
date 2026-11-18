import { describe, expect, it } from 'vitest'
import { applyOp, describeOps, formatList, items, parseList, splitInput, type ListOp } from '../../src/lists/shopping'

const run = (md: string | undefined, ops: ListOp[]) => formatList(ops.reduce(applyOp, parseList(md)))

describe('shopping list (Markdown checklist)', () => {
  it('reads and writes the checklist, keeping other lines', () => {
    const md = '# Shopping list\n\nWeekend:\n\n- [ ] Milk\n- [x] Bread\n'
    expect(items(parseList(md))).toEqual([
      { text: 'Milk', done: false },
      { text: 'Bread', done: true }
    ])
    expect(formatList(parseList(md))).toBe(md)
  })

  it('adds after the last item, or below the title of an empty list', () => {
    expect(run(undefined, [{ op: 'add', text: 'Milk' }])).toBe('# Shopping list\n\n- [ ] Milk\n')
    expect(run('# Shopping list\n\n- [ ] Milk\n\nnotes\n', [{ op: 'add', text: ' Eggs ' }])).toBe('# Shopping list\n\n- [ ] Milk\n- [ ] Eggs\n\nnotes\n')
  })

  it('adding an item already there puts it back on the list (no duplicate)', () => {
    expect(run('- [x] Milk\n', [{ op: 'add', text: 'milk' }])).toBe('- [ ] Milk\n')
  })

  it('toggles, removes and clears bought items by text', () => {
    const md = '# L\n\n- [ ] Milk\n- [ ] Bread\n- [ ] Eggs\n'
    expect(
      run(md, [
        { op: 'toggle', text: 'bread', done: true },
        { op: 'remove', text: 'Eggs' }
      ])
    ).toBe('# L\n\n- [ ] Milk\n- [x] Bread\n')
    expect(run('- [x] A\n- [ ] B\n- [x] C\n', [{ op: 'clearDone' }])).toBe('- [ ] B\n')
  })

  it('replays changes made on another device without losing them', () => {
    // this device toggled Milk; meanwhile the other added Butter
    const other = '# Shopping list\n\n- [ ] Milk\n- [ ] Butter\n'
    expect(run(other, [{ op: 'toggle', text: 'Milk', done: true }])).toBe('# Shopping list\n\n- [x] Milk\n- [ ] Butter\n')
  })

  it('splits several items typed at once; commit messages', () => {
    expect(splitInput('milk, bread; eggs\n')).toEqual(['milk', 'bread', 'eggs'])
    expect(describeOps([{ op: 'add', text: 'Milk' }])).toBe('list: add Milk')
    expect(describeOps([{ op: 'clearDone' }, { op: 'add', text: 'x' }])).toBe('list: 2 changes')
  })
})

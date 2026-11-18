import { ref, shallowRef } from 'vue'
import type { Template } from '@/config/schema'
import type { Schedule } from '@/ledger/periodic'
import type { Transaction } from '@/ledger/types'

export type EntryKind = 'expense' | 'income' | 'transfer'

export const ENTRY_KINDS: EntryKind[] = ['expense', 'income', 'transfer']

const open = ref(false)
const kind = ref<EntryKind>('expense')
const template = ref<Template>()
/** transaction being edited (undefined = new entry) */
const editing = shallowRef<Transaction>()
/** scheduled payment being edited */
const schedule = shallowRef<Schedule>()
/** one occurrence of a scheduled payment being recorded */
const occurrence = shallowRef<{ schedule: Schedule; date: string }>()
/** a new entry that starts as a repeating one (Scheduled page) */
const repeat = ref(false)

/** Global quick-entry drawer state (the + button, manifest shortcuts, templates, edit, schedules). */
export function useEntry() {
  function reset() {
    template.value = undefined
    editing.value = undefined
    schedule.value = undefined
    occurrence.value = undefined
    repeat.value = false
  }
  function start(k: EntryKind = 'expense', t?: Template) {
    reset()
    kind.value = k
    template.value = t
    open.value = true
  }
  function startEdit(tx: Transaction, k: EntryKind) {
    reset()
    kind.value = k
    editing.value = tx
    open.value = true
  }
  /** new scheduled payment (s undefined) or edit one */
  function startSchedule(k: EntryKind, s?: Schedule) {
    reset()
    kind.value = k
    schedule.value = s
    repeat.value = true
    open.value = true
  }
  function startOccurrence(s: Schedule, date: string, k: EntryKind) {
    reset()
    kind.value = k
    occurrence.value = { schedule: s, date }
    open.value = true
  }
  return { open, kind, template, editing, schedule, occurrence, repeat, start, startEdit, startSchedule, startOccurrence }
}

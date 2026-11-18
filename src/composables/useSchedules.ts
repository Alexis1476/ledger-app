import { computed } from 'vue'
import { useToast } from '@nuxt/ui/composables'
import { valueAt } from '@/ledger/analytics'
import { ZERO } from '@/ledger/decimal'
import { describeRule, scheduleState, type Schedule, type ScheduleState } from '@/ledger/periodic'
import { reverse } from '@/ledger/reverse'
import type { Transaction } from '@/ledger/types'
import { today } from '@/lib/format'
import { useJournalStore } from '@/stores/journal'
import { useEntry, type EntryKind } from './useEntry'
import { useLedger } from './useLedger'

export interface ScheduleItem {
  schedule: Schedule
  state: ScheduleState
  kind?: EntryKind
  label: string
  /** "Monthly", "Every 2 weeks" (or the raw period when read-only) */
  every: string
}

export interface DueItem extends ScheduleItem {
  date: string
  overdue: boolean
  /** the schedule's transaction on that date (for display) */
  tx: Transaction
}

/** Scheduled payments of the journal, what is due, and the actions on them. */
export function useSchedules(horizonDays = 30) {
  const store = useJournalStore()
  const L = useLedger()
  const entry = useEntry()
  const toast = useToast()
  const isPocket = (a: string) => L.assetAccounts.value.some((x) => x.name === a)

  const items = computed<ScheduleItem[]>(() =>
    store.journal.schedules
      .map((s) => {
        const r = s.rule ? reverse(s.tx, L.buildContext.value, isPocket) : undefined
        return {
          schedule: s,
          state: scheduleState(s, store.journal.transactions, today(), horizonDays),
          kind: r?.kind as EntryKind | undefined,
          label: s.tx.payee ?? s.tx.note ?? L.style(L.mainAccount(s.tx)).label,
          every: s.rule ? describeRule(s.rule) : s.period
        }
      })
      .sort((a, b) => (a.state.next ?? '9999').localeCompare(b.state.next ?? '9999') || a.label.localeCompare(b.label))
  )

  const due = computed<DueItem[]>(() =>
    items.value
      .flatMap((i) => i.state.due.map((d) => ({ ...i, ...d, tx: { ...i.schedule.tx, date: d.date, status: '' as const } })))
      .sort((a, b) => a.date.localeCompare(b.date))
  )

  /** What is due, in the reference currency: what comes in and what goes out (both positive). */
  const dueSplit = computed(() => {
    const ref = L.refCurrency.value
    let incoming = ZERO
    let outgoing = ZERO
    for (const d of due.value) {
      const a = L.displayAmount(d.tx)
      if (!a) continue
      const v = valueAt({ qty: a.qty, commodity: a.commodity }, ref, d.date, store.prices) ?? ZERO
      if (v.isNeg()) outgoing = outgoing.minus(v)
      else incoming = incoming.plus(v)
    }
    return { incoming, outgoing }
  })

  /** Net effect on my pockets of what is due (in the reference currency, expenses negative). */
  const dueTotal = computed(() => {
    const ref = L.refCurrency.value
    let sum = ZERO
    for (const d of due.value) {
      const a = L.displayAmount(d.tx)
      if (!a) continue
      sum = sum.plus(valueAt({ qty: a.qty, commodity: a.commodity }, ref, d.date, store.prices) ?? ZERO)
    }
    return sum
  })

  function record(d: DueItem) {
    if (!d.kind) {
      toast.add({ title: 'Read-only schedule', description: 'Record it by hand: the app cannot edit this kind of entry.', color: 'warning' })
      return
    }
    entry.startOccurrence(d.schedule, d.date, d.kind)
  }

  async function skip(d: DueItem) {
    try {
      await store.skipOccurrence(d.schedule, d.date)
      toast.add({ title: 'Skipped', description: `${d.label} on ${d.date}`, icon: 'material-symbols:event-busy-outline-rounded', color: 'neutral' })
    } catch (e) {
      toast.add({ title: 'Not skipped', description: (e as Error).message, color: 'error' })
    }
  }

  function edit(i: ScheduleItem) {
    if (!i.kind || !i.schedule.rule) {
      toast.add({ title: 'Read-only schedule', description: `Edit it in ${i.schedule.src?.file}.`, color: 'warning' })
      return
    }
    entry.startSchedule(i.kind, i.schedule)
  }

  return { items, due, dueTotal, dueSplit, record, skip, edit, create: (k: EntryKind = 'expense') => entry.startSchedule(k) }
}

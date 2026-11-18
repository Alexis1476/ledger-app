import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { cashFlow, lastMonths, monthlyFlows, netWorthSeries, topAccounts } from '@/ledger/analytics'
import { Decimal, ZERO } from '@/ledger/decimal'
import { isAssetType } from '@/ledger/reports'
import type { Transaction } from '@/ledger/types'
import { today } from '@/lib/format'
import { useJournalStore } from '@/stores/journal'
import { useLedger } from './useLedger'
import { useScope } from './useScope'

/** Tracks Nuxt UI's color mode (class "dark" on <html>) so charts can pick their steps. */
export function useIsDark() {
  const dark = ref(typeof document !== 'undefined' && document.documentElement.classList.contains('dark'))
  let obs: MutationObserver | undefined
  onMounted(() => {
    obs = new MutationObserver(() => (dark.value = document.documentElement.classList.contains('dark')))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  })
  onBeforeUnmount(() => obs?.disconnect())
  return dark
}

/** Reads a CSS custom property (chart colors live in main.css, per light/dark). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export interface Delta {
  /** change vs the comparison value, in % (undefined when the base is zero) */
  pct?: number
  up: boolean
}

function delta(now: Decimal, before: Decimal): Delta {
  // a % is only meaningful between two positive values (no sign flip, no near-zero base)
  if (!before.gt(0) || !now.gte(0)) return { up: now.gte(before) }
  return { pct: now.minus(before).div(before.abs()).times(100).toNumber(), up: now.gte(before) }
}

/**
 * Numbers for the Home dashboard, all in the reference currency. With the "My money" scope a
 * transaction counts only when it touches one of my own pockets (not the pockets kept for people).
 */
export function useDashboard() {
  const store = useJournalStore()
  const L = useLedger()
  const ref_ = computed(() => L.refCurrency.value)
  const thisMonth = computed(() => today().slice(0, 7))
  const months6 = computed(() => lastMonths(thisMonth.value, 6))
  const months12 = computed(() => lastMonths(thisMonth.value, 12))

  const mine = (account: string) => isAssetType(L.typeOf(account)) && !L.keptPockets.value.all.has(account)
  const scope = useScope()
  const include = (tx: Transaction) => scope.value === 'all' || tx.postings.some((p) => mine(p.account))
  const expenses = computed(() => monthlyFlows(store.journal, L.typeOf, 'X', ref_.value, store.prices, include))
  const income = computed(() => monthlyFlows(store.journal, L.typeOf, 'R', ref_.value, store.prices, include))

  const month = computed(() => {
    const [prev, cur] = lastMonths(thisMonth.value, 2)
    const spent = expenses.value.get(cur)?.total ?? ZERO
    const spentPrev = expenses.value.get(prev)?.total ?? ZERO
    const earned = income.value.get(cur)?.total ?? ZERO
    return {
      month: cur,
      spent,
      spentDelta: delta(spent, spentPrev),
      spentPrev,
      earned,
      saved: earned.minus(spent)
    }
  })

  /** top categories this month; beyond 6, folded into "Other" */
  const topCategories = computed(() => {
    const all = topAccounts(expenses.value, [thisMonth.value]).filter((x) => x.value.gt(0))
    const head = all.slice(0, 6)
    const rest = all.slice(6).reduce((s, x) => s.plus(x.value), ZERO)
    const total = all.reduce((s, x) => s.plus(x.value), ZERO)
    return { items: head, other: rest, total }
  })

  const flow = computed(() => cashFlow(income.value, expenses.value, months6.value))

  const netWorth = computed(() =>
    netWorthSeries(
      store.journal,
      (a) => (scope.value === 'all' ? isAssetType(L.typeOf(a)) : mine(a)) || L.typeOf(a) === 'L',
      months12.value,
      ref_.value,
      store.prices
    )
  )
  const netWorthDelta = computed(() => {
    const s = netWorth.value
    if (s.length < 2) return undefined
    return { abs: s[s.length - 1].value.minus(s[s.length - 2].value), ...delta(s[s.length - 1].value, s[s.length - 2].value) }
  })

  /** headline: my money (without the pockets kept for people) or the whole net worth */
  const worth = computed(() => (scope.value === 'all' ? { label: 'Net worth', value: L.netWorth.value.total } : { label: 'My money', value: L.myWorth.value.total }))

  return { thisMonth, month, topCategories, flow, netWorth, netWorthDelta, worth, include }
}

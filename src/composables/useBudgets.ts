import { computed } from 'vue'
import { lastMonths, monthlyFlows } from '@/ledger/analytics'
import { budgetStatus, monthElapsed, withBudget } from '@/ledger/budgets'
import { ZERO } from '@/ledger/decimal'
import { groupOf } from '@/ledger/insights'
import { isAssetType } from '@/ledger/reports'
import type { Transaction } from '@/ledger/types'
import { today } from '@/lib/format'
import { useJournalStore } from '@/stores/journal'
import { useLedger } from './useLedger'

/**
 * Budgets of app.config.json against my own spending (transactions touching my pockets, not the
 * money kept for people), in the reference currency.
 */
export function useBudgets() {
  const store = useJournalStore()
  const L = useLedger()
  const refC = computed(() => L.refCurrency.value)
  const thisMonth = computed(() => today().slice(0, 7))
  /** the months that can be looked at: this one and the eleven before */
  const monthItems = computed(() => lastMonths(thisMonth.value, 12).reverse())

  const mine = (a: string) => isAssetType(L.typeOf(a)) && !L.keptPockets.value.all.has(a)
  const include = (tx: Transaction) => tx.postings.some((p) => mine(p.account))
  const flows = computed(() => monthlyFlows(store.journal, L.typeOf, 'X', refC.value, store.prices, include))
  const budgets = computed(() => store.config.budgets ?? {})

  function status(month: string) {
    const elapsed = month === thisMonth.value ? monthElapsed(today()) : 1
    const lines = budgetStatus(flows.value, [month], budgets.value, elapsed)
    const total = lines.reduce((s, l) => s.plus(l.limit), ZERO)
    const spent = lines.reduce((s, l) => s.plus(l.spent), ZERO)
    return { lines, total, spent, left: total.minus(spent), elapsed }
  }

  /** a name for a group or a category */
  const label = (key: string) => (L.expenseCategories.value.includes(key) ? L.style(key).label : L.groupLabel(key))
  const icon = (key: string) => L.style(L.expenseCategories.value.includes(key) ? key : (L.expenseCategories.value.find((c) => groupOf(c) === key) ?? key))

  /** what a budget can be on: each expense group, then its categories */
  const categoryItems = computed(() => {
    const groups = [...new Set(L.expenseCategories.value.map(groupOf))]
    return groups.flatMap((g) => {
      const leaves = L.expenseCategories.value.filter((c) => c !== g && groupOf(c) === g)
      return [
        { label: leaves.length ? `${label(g)} (all)` : label(g), value: g },
        ...leaves.map((c) => ({ label: `${label(g)} · ${L.style(c).label}`, value: c }))
      ]
    })
  })

  async function save(key: string, amount: string) {
    await store.saveFile('app.config.json', (text) => withBudget(text, key, amount), `budget: ${label(key)} ${amount} ${refC.value} per month`)
  }
  async function remove(key: string) {
    await store.saveFile('app.config.json', (text) => withBudget(text, key), `budget: remove ${label(key)}`)
  }

  return { refC, thisMonth, monthItems, budgets, status, label, icon, categoryItems, save, remove }
}

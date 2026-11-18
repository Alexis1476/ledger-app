import { computed, reactive, watch } from 'vue'
import { cashFlow, monthlyFlows, netWorthSeries } from '@/ledger/analytics'
import { breakdown, change, filterFlows, groupOf, PERIODS, periodMonths, previousMonths, seriesMonths, sumFlows, topSeries, totals, within, type PeriodKey } from '@/ledger/insights'
import { isAssetType } from '@/ledger/reports'
import type { Transaction } from '@/ledger/types'
import { today } from '@/lib/format'
import { useJournalStore } from '@/stores/journal'
import { useLedger } from './useLedger'
import { useScope } from './useScope'

/** The charts of the Insights page, and the forms each one can take (the first is the default). */
export const CHARTS = {
  summary: { title: 'Summary', types: ['tiles'] },
  spending: { title: 'Spending by category', types: ['bars', 'donut'] },
  cashflow: { title: 'Income vs expenses', types: ['bars', 'lines'] },
  networth: { title: 'Net worth over time', types: ['area', 'bars'] },
  trend: { title: 'Spending over time', types: ['stacked', 'lines'] }
} as const
export type ChartId = keyof typeof CHARTS
export const CHART_IDS = Object.keys(CHARTS) as ChartId[]
/** the largest groups or categories drawn on their own over time (one validated color each); the rest is "Other" */
export const TREND_TOP = 4

export interface InsightsSettings {
  period: PeriodKey
  /** every chart, in display order */
  order: ChartId[]
  hidden: ChartId[]
  types: Record<ChartId, string>
  /** spending: by group (Food) or by category (Groceries) */
  level: 'group' | 'category'
  /** only the transactions touching these accounts (empty: the My money / All choice decides) */
  accounts: string[]
  /** only these expense groups or categories (empty: all) */
  categories: string[]
}

const KEY = 'ledger.insights'
const defaults = (): InsightsSettings => ({
  period: '6m',
  order: [...CHART_IDS],
  hidden: [],
  types: Object.fromEntries(CHART_IDS.map((id) => [id, CHARTS[id].types[0]])) as Record<ChartId, string>,
  level: 'group',
  accounts: [],
  categories: []
})

/** What was saved, made safe: unknown values fall back to the defaults, new charts are appended. */
export function sanitize(raw: unknown): InsightsSettings {
  const d = defaults()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Partial<Record<keyof InsightsSettings, unknown>>
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const ids = (v: unknown) => [...new Set(strings(v).filter((x): x is ChartId => (CHART_IDS as string[]).includes(x)))]
  const order = ids(r.order)
  const types = { ...d.types }
  if (r.types && typeof r.types === 'object') {
    for (const id of CHART_IDS) {
      const t = (r.types as Record<string, unknown>)[id]
      if (typeof t === 'string' && (CHARTS[id].types as readonly string[]).includes(t)) types[id] = t
    }
  }
  return {
    period: (PERIODS as readonly string[]).includes(r.period as string) ? (r.period as PeriodKey) : d.period,
    order: [...order, ...CHART_IDS.filter((id) => !order.includes(id))],
    hidden: ids(r.hidden),
    types,
    level: r.level === 'category' ? 'category' : 'group',
    accounts: strings(r.accounts),
    categories: strings(r.categories)
  }
}

function read(): InsightsSettings {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return defaults()
  }
}

/** One set of choices for the page, remembered on this device (like the My money / All choice). */
const settings = reactive<InsightsSettings>(read())
watch(
  settings,
  (v) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(v))
    } catch {
      // storage unavailable (private mode): the choices last for this session
    }
  },
  { deep: true }
)

export function useInsights() {
  const store = useJournalStore()
  const L = useLedger()
  const scope = useScope()
  const refC = computed(() => L.refCurrency.value)

  const thisMonth = computed(() => today().slice(0, 7))
  const firstMonth = computed(() => store.journal.transactions.reduce((m, t) => (t.date.slice(0, 7) < m ? t.date.slice(0, 7) : m), thisMonth.value))
  const months = computed(() => periodMonths(settings.period, thisMonth.value, firstMonth.value))
  /** the charts over time need a few points: a short period is widened for them */
  const timeMonths = computed(() => seriesMonths(months.value))
  const widened = computed(() => timeMonths.value.length !== months.value.length)

  // filters that still make sense for the data (an account or category may have been renamed)
  const accounts = computed(() => settings.accounts.filter((a) => L.assetAccounts.value.some((x) => x.name === a)))
  const groups = computed(() => [...new Set(L.expenseCategories.value.map(groupOf))])
  const known = (key: string) => groups.value.includes(key) || L.expenseCategories.value.includes(key)
  const categories = computed(() => settings.categories.filter(known))

  const mine = (account: string) => isAssetType(L.typeOf(account)) && !L.keptPockets.value.all.has(account)
  const include = (tx: Transaction) =>
    accounts.value.length ? tx.postings.some((p) => accounts.value.includes(p.account)) : scope.value === 'all' || tx.postings.some((p) => mine(p.account))
  const keepCategory = (account: string) => !categories.value.length || categories.value.some((k) => within(account, k))

  const income = computed(() => monthlyFlows(store.journal, L.typeOf, 'R', refC.value, store.prices, include))
  /** every expense of the scope, then only the filtered categories */
  const allExpenses = computed(() => monthlyFlows(store.journal, L.typeOf, 'X', refC.value, store.prices, include))
  const expenses = computed(() => (categories.value.length ? filterFlows(allExpenses.value, keepCategory) : allExpenses.value))

  /**
   * With a category filter the page is about those categories only: income, net and net worth
   * say nothing about them, so the charts switch to what does (share of the spending, change,
   * spending per month) and the breakdown goes down to the categories.
   */
  const focused = computed(() => categories.value.length > 0)
  const level = computed(() => (focused.value ? 'category' : settings.level))

  const summary = computed(() => {
    const t = totals(cashFlow(income.value, expenses.value, months.value))
    const before = settings.period === 'all' ? undefined : sumFlows(expenses.value, previousMonths(months.value))
    const all = sumFlows(allExpenses.value, months.value)
    return {
      ...t,
      /** spending vs the same number of months just before, in % */
      change: before ? change(t.expenses, before) : undefined,
      /** part of all the spending of the period, in % (with a category filter) */
      share: focused.value && all.gt(0) ? t.expenses.div(all).times(100).toDecimalPlaces(0).toNumber() : undefined
    }
  })
  const spending = computed(() => breakdown(expenses.value, months.value, level.value, 7))
  const flow = computed(() => cashFlow(income.value, expenses.value, timeMonths.value))
  const netWorth = computed(() =>
    netWorthSeries(
      store.journal,
      (a) => (accounts.value.length ? accounts.value.includes(a) : (scope.value === 'all' ? isAssetType(L.typeOf(a)) : mine(a)) || L.typeOf(a) === 'L'),
      timeMonths.value,
      refC.value,
      store.prices
    )
  )
  /** spending month by month: the largest groups (or categories) of the period, and the rest */
  const overTime = computed(() => topSeries(expenses.value, timeMonths.value, level.value, TREND_TOP))

  /** a name for a group or a category */
  const label = (key: string) => (groups.value.includes(key) && !L.expenseCategories.value.includes(key) ? L.groupLabel(key) : L.style(key).label)
  /** choices for the category pickers: each group, then its categories */
  const categoryItems = computed(() =>
    groups.value.flatMap((g) => {
      const leaves = L.expenseCategories.value.filter((c) => c !== g && groupOf(c) === g)
      return [{ label: leaves.length ? `${label(g)} (all)` : label(g), value: g }, ...leaves.map((c) => ({ label: `${label(g)} · ${L.style(c).label}`, value: c }))]
    })
  )
  const accountItems = computed(() => L.assetAccounts.value.map((a) => ({ label: a.label, value: a.name })))

  /**
   * The charts shown. Net worth says nothing about a category: it steps aside while one is
   * filtered. So does the split over time when there is nothing to split.
   */
  /** nothing to split: the filtered spending is a single category (the chart per month already shows it) */
  const single = computed(() => focused.value && overTime.value.series.length <= 1 && overTime.value.other.total.isZero())
  const visible = computed(() =>
    settings.order.filter((id) => !settings.hidden.includes(id) && !(id === 'networth' && focused.value) && !(id === 'trend' && single.value))
  )
  /** zoom on a group: every chart then shows only that group, by category */
  function focus(key: string) {
    settings.categories = [key]
  }
  const filtersActive = computed(() => accounts.value.length + categories.value.length)
  function move(id: ChartId, by: -1 | 1) {
    const i = settings.order.indexOf(id)
    const j = i + by
    if (i < 0 || j < 0 || j >= settings.order.length) return
    settings.order.splice(j, 0, ...settings.order.splice(i, 1))
  }
  function toggle(id: ChartId, shown: boolean) {
    settings.hidden = shown ? settings.hidden.filter((x) => x !== id) : [...new Set([...settings.hidden, id])]
  }
  function reset() {
    Object.assign(settings, defaults())
  }

  return {
    settings,
    refC,
    months,
    timeMonths,
    widened,
    summary,
    spending,
    flow,
    netWorth,
    overTime,
    focused,
    level,
    focus,
    label,
    categoryItems,
    accountItems,
    accounts,
    categories,
    visible,
    filtersActive,
    move,
    toggle,
    reset
  }
}

<script setup lang="ts">
import { computed, ref } from 'vue'
import StatusBanner from '@/components/StatusBanner.vue'
import { useLedger } from '@/composables/useLedger'
import type { Decimal } from '@/ledger/decimal'
import { isAssetType } from '@/ledger/reports'
import { balanceSheet, cashFlowStatement, incomeStatement, type Section, type StatementRow } from '@/ledger/statements'
import { money, today } from '@/lib/format'
import { useJournalStore } from '@/stores/journal'

/**
 * Accounting view, like hledger's `bs`, `is` and `cf`: every account (including the money kept
 * for people), as a tree, valued in the reference currency.
 */
const store = useJournalStore()
const L = useLedger()
const refC = computed(() => L.refCurrency.value)

type Tab = 'bs' | 'is' | 'cf'
const tabs: { key: Tab; label: string }[] = [
  { key: 'bs', label: 'Balance sheet' },
  { key: 'is', label: 'Income statement' },
  { key: 'cf', label: 'Cash flow' }
]
const tab = ref<Tab>('bs')

// period: a year (or all time) and optionally one month
const years = computed(() => {
  const ys = new Set(store.journal.transactions.map((t) => t.date.slice(0, 4)))
  ys.add(today().slice(0, 4))
  return [...ys].sort().reverse()
})
const year = ref(today().slice(0, 4))
const month = ref('all')
const yearItems = computed(() => [...years.value.map((y) => ({ label: y, value: y })), { label: 'All time', value: 'all' }])
const monthItems = [
  { label: 'Whole year', value: 'all' },
  ...['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m, i) => ({ label: m, value: String(i + 1).padStart(2, '0') }))
]

const period = computed(() => {
  if (year.value === 'all') return { begin: undefined, end: undefined, last: today(), label: 'All time' }
  const y = Number(year.value)
  if (month.value === 'all') {
    const last = `${y}-12-31`
    return { begin: `${y}-01-01`, end: `${y + 1}-01-01`, last: last > today() ? today() : last, label: String(y) }
  }
  const m = Number(month.value)
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  const lastDay = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  return { begin: `${y}-${month.value}-01`, end, last: lastDay > today() ? today() : lastDay, label: `${monthItems[m].label} ${y}` }
})

const depth = ref(2)
const depthItems = [1, 2, 3, 9]
const showCurrencies = ref(false)

const bs = computed(() => balanceSheet(store.journal, L.typeOf, period.value.last, refC.value, store.prices))
const is = computed(() => incomeStatement(store.journal, L.typeOf, period.value.begin, period.value.end, refC.value, store.prices))
const cf = computed(() => cashFlowStatement(store.journal, L.typeOf, period.value.begin, period.value.end, refC.value, store.prices))
const missing = computed(() => (tab.value === 'bs' ? bs.value.missing : tab.value === 'is' ? is.value.missing : cf.value.missing))

/**
 * The rows down to the chosen depth. A group with a single account would print the same amount
 * twice (Digi, then Digi CHF): the account takes the group's place.
 */
function visible(s: Section) {
  const out: Section['rows'] = []
  for (let i = 0; i < s.rows.length; i++) {
    const r = s.rows[i]
    if (r.depth >= depth.value) continue
    const child = s.rows[i + 1]
    const after = s.rows[i + 2]
    const onlyChild = child && child.leaf && child.depth === r.depth + 1 && (!after || after.depth <= r.depth)
    if (onlyChild && child.depth < depth.value) {
      out.push({ ...child, depth: r.depth })
      i++
    } else out.push(r)
  }
  return out
}
const lines = (m: Map<string, Decimal>) => [...m].map(([c, q]) => money(q, c)).join(' · ')

/** Configured names everywhere: leaves ("Sam · Neo EUR"), groups ("Food", "Bank", "Sam"). */
function label(r: StatementRow) {
  return r.leaf ? L.accountLabel(r.account) : L.groupLabel(r.account)
}
function link(r: StatementRow) {
  if (!r.leaf) return undefined
  const t = L.typeOf(r.account)
  if (t === 'R' || t === 'X') return { path: '/transactions', query: { category: r.account } }
  if (isAssetType(t) && !r.account.startsWith('assets:receivables') && !r.account.startsWith('assets:transit')) return `/accounts/${encodeURIComponent(r.account)}`
  return { path: '/transactions', query: { account: r.account } }
}

const sections = computed(() => {
  if (tab.value === 'bs') {
    const b = bs.value
    return [
      { key: 'assets', title: 'Assets', section: b.assets },
      { key: 'liabilities', title: 'Liabilities', section: b.liabilities },
      { key: 'equity', title: 'Equity', section: b.equity }
    ]
  }
  if (tab.value === 'is') {
    return [
      { key: 'revenues', title: 'Revenues', section: is.value.revenues },
      { key: 'expenses', title: 'Expenses', section: is.value.expenses }
    ]
  }
  return [{ key: 'cash', title: 'Cash accounts (change)', section: cf.value.cash }]
})

/** Lines under the sections: the result, and for the balance sheet the closing equation. */
const summary = computed(() => {
  if (tab.value === 'bs') {
    const b = bs.value
    const right = b.liabilities.total.plus(b.equity.total).plus(b.result).plus(b.exchange)
    return [
      { label: 'Result to date (income − expenses)', value: b.result },
      { label: 'Exchange differences', value: b.exchange },
      { label: 'Liabilities + equity + result', value: right, strong: true }
    ]
  }
  if (tab.value === 'is') return [{ label: 'Net result', value: is.value.result, strong: true, signed: true }]
  return [{ label: 'Net change in cash', value: cf.value.cash.total, strong: true, signed: true }]
})
const subtitle = computed(() => (tab.value === 'bs' ? `at ${period.value.last}` : period.value.label))
</script>

<template>
  <UDashboardPanel id="accounting">
    <template #header>
      <UDashboardNavbar title="Accounting" :toggle="false" />
    </template>
    <template #body>
      <div class="stagger max-w-3xl w-full mx-auto space-y-4 pb-44 lg:pb-8">
        <StatusBanner />

        <!-- connected button group: 2dp apart, 8dp inner corners, the selected one takes the full shape -->
        <div role="tablist" aria-label="Statement" class="grid grid-cols-3 gap-0.5">
          <button
            v-for="t in tabs"
            :key="t.key"
            type="button"
            role="tab"
            :aria-selected="tab === t.key"
            class="md-label-large cursor-pointer [-webkit-tap-highlight-color:transparent] min-h-10 pointer-coarse:min-h-12 px-2 leading-tight transition-[border-radius,background-color,color] duration-(--md-sys-motion-spring-fast-spatial-duration) ease-(--md-sys-motion-spring-fast-spatial) active:rounded-(--md-sys-shape-corner-small) first:rounded-l-full last:rounded-r-full"
            :class="tab === t.key ? 'rounded-full! bg-primary text-(--md-sys-color-on-primary)' : 'rounded-(--md-sys-shape-corner-small) bg-(--md-sys-color-surface-container-highest) text-(--md-sys-color-on-surface-variant)'"
            @click="tab = t.key"
          >
            {{ t.label }}
          </button>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <USelect v-model="year" :items="yearItems" class="w-28" aria-label="Year" />
          <USelect v-if="year !== 'all'" v-model="month" :items="monthItems" class="w-36" aria-label="Month" />
          <div class="flex items-center gap-1 ml-auto" role="group" aria-label="Depth">
            <span class="text-xs text-muted mr-1">Depth</span>
            <UButton
              v-for="d in depthItems"
              :key="d"
              size="sm"
              class="tap"
              :variant="depth === d ? 'solid' : 'ghost'"
              :color="depth === d ? 'primary' : 'neutral'"
              :aria-pressed="depth === d"
              @click="depth = d"
            >
              {{ d === 9 ? 'All' : d }}
            </UButton>
          </div>
          <USwitch v-model="showCurrencies" label="Currencies" />
        </div>

        <UCard :ui="{ body: 'p-4 sm:p-5' }">
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <h2 class="text-sm font-semibold">{{ tabs.find((t) => t.key === tab)!.label }}</h2>
              <span class="text-xs text-muted">{{ subtitle }} · {{ refC }}</span>
            </div>
          </template>

          <div class="space-y-5">
            <section v-for="s in sections" :key="s.key" :aria-labelledby="`h-${s.key}`">
              <div class="flex items-baseline justify-between gap-2 border-b border-default pb-1.5">
                <h3 :id="`h-${s.key}`" class="font-semibold">
                  {{ s.title }}
                </h3>
                <span class="tabular font-semibold">{{ money(s.section.total, refC) }}</span>
              </div>
              <ul class="mt-1">
                <li v-for="r in visible(s.section)" :key="r.account">
                  <component
                    :is="link(r) ? 'RouterLink' : 'div'"
                    :to="link(r)"
                    class="flex items-baseline gap-2 py-1.5 pointer-coarse:py-3 rounded-md -mx-1 px-1"
                    :class="link(r) ? 'press' : ''"
                    :style="{ paddingLeft: `${0.25 + r.depth * 1}rem` }"
                    :title="r.account"
                  >
                    <span class="flex-1 min-w-0">
                      <span class="block truncate text-sm" :class="r.leaf ? '' : 'font-medium'">{{ label(r) }}</span>
                      <span v-if="showCurrencies && r.byCommodity.size" class="block text-xs text-muted tabular">{{ lines(r.byCommodity) }}</span>
                    </span>
                    <span class="tabular text-sm whitespace-nowrap" :class="r.leaf ? '' : 'font-medium'">{{ money(r.value, refC) }}</span>
                  </component>
                </li>
                <li v-if="!s.section.rows.length" class="py-1.5 text-sm text-muted">—</li>
              </ul>
            </section>

            <dl class="border-t border-default pt-2 space-y-1">
              <div v-for="x in summary" :key="x.label" class="flex items-baseline justify-between gap-2 py-1">
                <dt :class="x.strong ? 'font-semibold' : 'text-sm'">
                  {{ x.label }}
                </dt>
                <dd
                  class="tabular whitespace-nowrap"
                  :class="[x.strong ? 'font-semibold' : 'text-sm', 'signed' in x && x.signed ? (x.value.isNeg() ? 'text-error' : 'text-success') : '']"
                >
                  {{ money(x.value, refC) }}
                </dd>
              </div>
            </dl>
          </div>
        </UCard>

        <p v-if="missing.length" class="text-xs text-warning flex items-center gap-1">
          <UIcon name="material-symbols:warning-outline-rounded" class="size-3.5" aria-hidden="true" />
          No {{ refC }} rate for {{ missing.join(', ') }}: left out of the {{ refC }} values.
        </p>
        <p class="text-xs text-muted">
          Balance sheet values at the date's rates; income statement and cash flow at each transaction's date. Includes
          the money kept for people.
        </p>
        <details class="text-xs text-muted">
          <summary class="cursor-pointer py-2">Technical details</summary>
          <p>
            Same reports as hledger: <code>hledger bs</code>, <code>hledger is</code>, <code>hledger cf</code> with
            <code>-X {{ refC }}</code>.
          </p>
        </details>
      </div>
    </template>
  </UDashboardPanel>
</template>

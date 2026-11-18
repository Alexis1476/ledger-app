<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import AccountIcon from '@/components/AccountIcon.vue'
import ChartTypeToggle from '@/components/ChartTypeToggle.vue'
import ScopeToggle from '@/components/ScopeToggle.vue'
import StatusBanner from '@/components/StatusBanner.vue'
import { CHARTS, CHART_IDS, useInsights, type ChartId } from '@/composables/useInsights'
import { useLedger } from '@/composables/useLedger'
import { Decimal } from '@/ledger/decimal'
import { PERIOD_LABEL, PERIODS } from '@/ledger/insights'
import { money } from '@/lib/format'
import { useJournalStore } from '@/stores/journal'

// charts load on demand: ECharts stays out of the first bundle
const NetWorthChart = defineAsyncComponent(() => import('@/components/charts/NetWorthChart.vue'))
const CashFlowChart = defineAsyncComponent(() => import('@/components/charts/CashFlowChart.vue'))
const TrendChart = defineAsyncComponent(() => import('@/components/charts/TrendChart.vue'))
const DonutChart = defineAsyncComponent(() => import('@/components/charts/DonutChart.vue'))

/**
 * Insights: a few charts over a period I choose, that I can filter, reorder, hide, and switch
 * between forms (bars, lines, donut). The choices are remembered on this device.
 */
const store = useJournalStore()
const L = useLedger()
const I = useInsights()
const S = I.settings

const periodItems = PERIODS.map((p) => ({ label: PERIOD_LABEL[p], value: p }))
const filtersOpen = ref(false)
const customizeOpen = ref(false)

const refC = computed(() => I.refC.value)
const withYear = computed(() => I.timeMonths.value.length > 12)
/** what a chart over time covers (a short period is widened for it) */
const timeLabel = computed(() => (I.widened.value ? `Last ${I.timeMonths.value.length} months` : PERIOD_LABEL[S.period]))
const subtitle = (id: ChartId) => (id === 'summary' || id === 'spending' ? PERIOD_LABEL[S.period] : timeLabel.value)
/** with a category filter, the page is about those categories: the titles say so */
const focusName = computed(() => (I.categories.value.length === 1 ? I.label(I.categories.value[0]) : 'the filtered categories'))
const title = (id: ChartId) => {
  if (!I.focused.value) return CHARTS[id].title
  if (id === 'summary') return `Spending on ${focusName.value}`
  if (id === 'cashflow') return 'Spending per month'
  return CHARTS[id].title
}

// ── Spending by category ───────────────────────────────────────────────
const OTHER = 'var(--md-sys-color-outline)'
const spendRows = computed(() => {
  const b = I.spending.value
  const max = b.items.reduce((m, x) => (x.value.gt(m) ? x.value : m), b.other)
  const row = (name: string, value: Decimal, color: string, icon?: string, account?: string) => ({
    name,
    value,
    color,
    icon,
    account,
    pct: b.total.isZero() ? 0 : value.div(b.total).times(100).toDecimalPlaces(0).toNumber(),
    width: max.isZero() ? 0 : Math.max(2, value.div(max).times(100).toNumber())
  })
  const rows = b.items.map((x) => row(I.label(x.account), x.value, L.style(x.account).color, L.style(x.account).icon, x.account))
  if (b.other.gt(0)) rows.push(row('Other', b.other, OTHER))
  return rows
})
/** a category opens its transactions (of the month, when the period is one month) */
const spendLink = (account?: string) =>
  account && I.level.value === 'category' ? { path: '/transactions', query: { category: account, ...(I.months.value.length === 1 ? { month: I.months.value[0] } : {}) } } : undefined

// ── Spending over time: the largest of the period, and the rest ─────────
const OTHER_SERIES = 'var(--md-sys-color-outline)'
const trendRows = computed(() => {
  const t = I.overTime.value
  const rows = t.series.map((x, i) => ({ name: I.label(x.key), values: x.values, total: x.total, color: `var(--app-series-${i + 1})`, chart: undefined as string | undefined }))
  if (t.other.total.gt(0)) rows.push({ name: 'Other', values: t.other.values, total: t.other.total, color: OTHER_SERIES, chart: outline.value })
  return rows
})
/** ECharts needs a real color, not a CSS variable */
const outline = computed(() => (typeof document === 'undefined' ? '#888' : getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-outline').trim()))

// ── Filters ────────────────────────────────────────────────────────────
const chips = computed(() => [
  ...I.accounts.value.map((a) => ({ key: a, label: L.style(a).label, remove: () => (S.accounts = S.accounts.filter((x) => x !== a)) })),
  ...I.categories.value.map((c) => ({ key: c, label: I.label(c), remove: () => (S.categories = S.categories.filter((x) => x !== c)) }))
])
function clearFilters() {
  S.accounts = []
  S.categories = []
}
const pct = (n?: number) => (n === undefined ? '—' : `${n}%`)
const signed = (n?: number) => (n === undefined ? '—' : `${n > 0 ? '+' : ''}${n}%`)
</script>

<template>
  <UDashboardPanel id="insights">
    <template #header>
      <UDashboardNavbar title="Insights" :toggle="false">
        <template #right>
          <UButton icon="material-symbols:dashboard-customize-outline-rounded" variant="soft" color="neutral" label="Customize" class="tap" aria-haspopup="dialog" @click="customizeOpen = true" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="stagger max-w-3xl xl:max-w-6xl w-full mx-auto space-y-4 pb-44 lg:pb-8">
        <StatusBanner />

        <!-- what the page shows: the period, whose money, the filters -->
        <div class="flex flex-wrap items-center gap-2">
          <USelect v-model="S.period" :items="periodItems" size="lg" aria-label="Period" icon="material-symbols:calendar-month-outline-rounded" class="w-52" />
          <UChip :show="I.filtersActive.value > 0" :text="I.filtersActive.value" size="2xl">
            <UButton size="lg" variant="soft" color="neutral" icon="material-symbols:tune-rounded" label="Filters" aria-haspopup="dialog" @click="filtersOpen = true" />
          </UChip>
          <div v-if="L.keptPockets.value.all.size && !I.accounts.value.length" class="ml-auto"><ScopeToggle /></div>
        </div>
        <ul v-if="chips.length" class="flex flex-wrap gap-2" aria-label="Active filters">
          <li v-for="c in chips" :key="c.key">
            <UButton class="tap rounded-(--md-sys-shape-corner-small)" size="sm" variant="soft" :label="c.label" trailing-icon="material-symbols:close-rounded" :aria-label="`Remove filter ${c.label}`" @click="c.remove()" />
          </li>
        </ul>

        <UCard v-if="!store.hasData" :ui="{ body: 'p-6 text-center space-y-3' }">
          <UIcon name="material-symbols:monitoring" class="size-10 text-primary mx-auto" />
          <p class="font-medium">No journal loaded yet</p>
          <UButton to="/settings" label="Open settings" icon="material-symbols:power-outline-rounded" />
        </UCard>
        <UCard v-else-if="!I.visible.value.length" :ui="{ body: 'p-6 text-center space-y-3' }">
          <p class="font-medium">Every chart is hidden</p>
          <UButton label="Customize" icon="material-symbols:dashboard-customize-outline-rounded" @click="customizeOpen = true" />
        </UCard>

        <!-- the charts, in my order; two columns on wide screens -->
        <div v-else class="space-y-4 xl:space-y-0 xl:columns-2 xl:gap-4 *:break-inside-avoid xl:*:mb-4">
          <section v-for="id in I.visible.value" :key="id" :aria-labelledby="`ins-${id}`">
            <UCard :ui="{ body: 'p-4 sm:p-5' }">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <h2 :id="`ins-${id}`" class="md-title-medium">{{ title(id) }}</h2>
                  <p class="md-body-small text-muted">{{ subtitle(id) }} · {{ refC }}</p>
                </div>
                <ChartTypeToggle v-if="CHARTS[id].types.length > 1" v-model="S.types[id]" :types="CHARTS[id].types" :label="CHARTS[id].title" />
              </div>

              <!-- Summary: the period in four numbers; with a category filter, what those categories cost -->
              <dl v-if="id === 'summary' && I.focused.value" class="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
                <div>
                  <dt class="md-body-small text-muted">Spent</dt>
                  <dd class="md-title-large tabular font-medium">{{ money(I.summary.value.expenses, undefined, 0) }}</dd>
                </div>
                <div>
                  <dt class="md-body-small text-muted">Per month</dt>
                  <dd class="md-title-large tabular font-medium">{{ money(I.summary.value.monthly, undefined, 0) }}</dd>
                  <dd class="md-body-small text-muted">on average</dd>
                </div>
                <div>
                  <dt class="md-body-small text-muted">Share</dt>
                  <dd class="md-title-large tabular font-medium">{{ pct(I.summary.value.share) }}</dd>
                  <dd class="md-body-small text-muted">of all my spending</dd>
                </div>
                <div>
                  <dt class="md-body-small text-muted">Change</dt>
                  <dd class="md-title-large tabular font-medium">{{ signed(I.summary.value.change) }}</dd>
                  <dd class="md-body-small text-muted">vs the period before</dd>
                </div>
              </dl>
              <dl v-else-if="id === 'summary'" class="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
                <div>
                  <dt class="md-body-small text-muted">Income</dt>
                  <dd class="md-title-large tabular font-medium">{{ money(I.summary.value.income, undefined, 0) }}</dd>
                </div>
                <div>
                  <dt class="md-body-small text-muted">Spent</dt>
                  <dd class="md-title-large tabular font-medium">{{ money(I.summary.value.expenses, undefined, 0) }}</dd>
                  <dd v-if="I.summary.value.change !== undefined" class="md-body-small text-muted tabular">{{ signed(I.summary.value.change) }} vs the period before</dd>
                </div>
                <div>
                  <dt class="md-body-small text-muted">Net</dt>
                  <dd class="md-title-large tabular font-medium" :class="I.summary.value.net.isNeg() ? 'text-error' : ''">{{ money(I.summary.value.net, undefined, 0) }}</dd>
                  <dd class="md-body-small text-muted">income − spent</dd>
                </div>
                <div>
                  <dt class="md-body-small text-muted">Savings rate</dt>
                  <dd class="md-title-large tabular font-medium" :class="(I.summary.value.savingsRate ?? 0) < 0 ? 'text-error' : ''">{{ pct(I.summary.value.savingsRate) }}</dd>
                  <dd class="md-body-small text-muted">net ÷ income</dd>
                </div>
              </dl>

              <!-- Spending by category: ranked bars, or a donut with the same list as its legend -->
              <template v-else-if="id === 'spending'">
                <div v-if="!I.focused.value" role="radiogroup" aria-label="Spending by" class="mt-3 inline-flex gap-0.5">
                  <button
                    v-for="(o, i) in [{ value: 'group', label: 'Groups' }, { value: 'category', label: 'Categories' }] as const"
                    :key="o.value"
                    type="button"
                    role="radio"
                    :aria-checked="S.level === o.value"
                    class="px-4 min-h-10 pointer-coarse:min-h-12 md-label-large cursor-pointer transition-[border-radius,background-color,color] duration-(--md-sys-motion-spring-fast-spatial-duration) ease-(--md-sys-motion-spring-fast-spatial)"
                    :class="
                      S.level === o.value
                        ? 'rounded-full bg-(--md-sys-color-secondary-container) text-(--md-sys-color-on-secondary-container)'
                        : 'bg-(--md-sys-color-surface-container-highest) text-(--md-sys-color-on-surface-variant) ' + (i === 0 ? 'rounded-l-full rounded-r-(--md-sys-shape-corner-small)' : 'rounded-r-full rounded-l-(--md-sys-shape-corner-small)')
                    "
                    @click="S.level = o.value"
                  >
                    {{ o.label }}
                  </button>
                </div>
                <p v-if="!spendRows.length" class="py-6 text-center text-sm text-muted">No expenses in this period.</p>
                <template v-else>
                  <DonutChart v-if="S.types.spending === 'donut'" class="mt-4" :items="spendRows" :total="I.spending.value.total" :currency="refC" label="Spending by category" />
                  <ul class="mt-3 space-y-1">
                    <li v-for="r in spendRows" :key="r.name">
                      <!-- a group zooms the page on it; a category opens its transactions -->
                      <component
                        :is="spendLink(r.account) ? 'RouterLink' : r.account ? 'button' : 'div'"
                        :to="spendLink(r.account)"
                        :type="!spendLink(r.account) && r.account ? 'button' : undefined"
                        class="w-full flex items-center gap-3 rounded-lg px-1 py-2 min-h-12 text-left"
                        :class="r.account ? 'press cursor-pointer' : ''"
                        :aria-label="!spendLink(r.account) && r.account ? `Focus on ${r.name}` : undefined"
                        @click="!spendLink(r.account) && r.account ? I.focus(r.account) : undefined"
                      >
                        <AccountIcon v-if="r.icon" :icon="r.icon" :color="r.color" size="sm" />
                        <span v-else class="size-7 shrink-0 inline-flex items-center justify-center" aria-hidden="true"><span class="size-3 rounded-full" :style="{ backgroundColor: r.color }" /></span>
                        <div class="flex-1 min-w-0">
                          <div class="flex items-baseline justify-between gap-2 md-body-medium">
                            <span class="truncate">{{ r.name }}</span>
                            <span class="tabular md-label-large whitespace-nowrap">{{ money(r.value, refC) }}</span>
                          </div>
                          <div class="mt-1 flex items-center gap-2">
                            <div class="h-1.5 flex-1 rounded-full bg-elevated overflow-hidden">
                              <div
                                class="h-full rounded-full"
                                :style="{ width: (S.types.spending === 'donut' ? r.pct : r.width) + '%', backgroundColor: S.types.spending === 'donut' ? r.color : 'var(--app-series-1)' }"
                              />
                            </div>
                            <span class="md-body-small text-muted tabular w-9 text-right">{{ r.pct }}%</span>
                          </div>
                        </div>
                      </component>
                    </li>
                  </ul>
                  <div class="mt-2 flex items-baseline justify-between border-t border-default px-1 pt-3">
                    <span class="md-label-large">Total</span>
                    <span class="md-label-large tabular">{{ money(I.spending.value.total, refC) }}</span>
                  </div>
                  <p class="mt-2 px-1 md-body-small text-muted">{{ I.level.value === 'group' ? 'Tap a group to focus the page on it.' : 'Tap a category to see its transactions.' }}</p>
                </template>
              </template>

              <!-- Income vs expenses -->
              <template v-else-if="id === 'cashflow'">
                <CashFlowChart class="mt-3" :rows="I.flow.value" :currency="refC" :type="S.types.cashflow === 'lines' ? 'lines' : 'bars'" :with-year="withYear" :expenses-only="I.focused.value" />
              </template>

              <!-- Net worth over time -->
              <template v-else-if="id === 'networth'">
                <NetWorthChart class="mt-3" :points="I.netWorth.value" :currency="refC" :type="S.types.networth === 'bars' ? 'bars' : 'area'" :with-year="withYear" :name="I.accounts.value.length ? 'Selected accounts' : 'Net worth'" />
                <p v-if="I.accounts.value.length" class="mt-2 md-body-small text-muted">Only the filtered accounts.</p>
              </template>

              <!-- Spending over time: the largest groups (or categories) and the rest, nothing to choose -->
              <template v-else-if="id === 'trend'">
                <p v-if="!trendRows.length" class="py-6 text-center text-sm text-muted">No expenses in this period.</p>
                <template v-else>
                  <TrendChart
                    class="mt-3"
                    :months="I.timeMonths.value"
                    :series="trendRows.map((r) => ({ name: r.name, values: r.values, color: r.chart }))"
                    :currency="refC"
                    :type="S.types.trend === 'lines' ? 'lines' : 'stacked'"
                    :with-year="withYear"
                  />
                  <!-- the legend, with what each one cost over these months -->
                  <ul class="mt-2 space-y-1" aria-label="Legend">
                    <li v-for="r in trendRows" :key="r.name" class="flex items-center gap-3 px-1 py-1 md-body-medium">
                      <span class="size-3 shrink-0 rounded-full" :style="{ backgroundColor: r.color }" aria-hidden="true" />
                      <span class="flex-1 min-w-0 truncate">{{ r.name }}</span>
                      <span class="tabular md-label-large whitespace-nowrap">{{ money(r.total, refC) }}</span>
                    </li>
                  </ul>
                </template>
              </template>
            </UCard>
          </section>
        </div>
        <p v-if="store.hasData && I.focused.value && !S.hidden.includes('networth')" class="px-1 md-body-small text-muted">
          Net worth is not shown while a category is filtered: it does not depend on categories.
        </p>
      </div>

      <!-- Filters -->
      <UDrawer v-model:open="filtersOpen" title="Filters" description="They apply to every chart of this page." :ui="{ container: 'w-full max-w-xl mx-auto' }">
        <template #body>
          <div class="space-y-4 pb-4 safe-bottom">
            <UFormField label="Accounts" hint="empty: all">
              <USelectMenu v-model="S.accounts" multiple :items="I.accountItems.value" value-key="value" size="xl" placeholder="Any account" aria-label="Accounts" class="w-full" />
            </UFormField>
            <UFormField label="Expense categories" hint="empty: all" help="With a category chosen, the page shows only what it cost: net worth and income step aside.">
              <USelectMenu v-model="S.categories" multiple :items="I.categoryItems.value" value-key="value" size="xl" placeholder="Any category" aria-label="Expense categories" class="w-full" />
            </UFormField>
            <div class="grid grid-cols-2 gap-2 pt-1">
              <UButton size="xl" variant="ghost" color="neutral" label="Clear" class="justify-center" :disabled="!I.filtersActive.value" @click="clearFilters" />
              <UButton size="xl" label="Done" class="justify-center" @click="filtersOpen = false" />
            </div>
          </div>
        </template>
      </UDrawer>

      <!-- Customize: which charts, in which order -->
      <UDrawer v-model:open="customizeOpen" title="Customize" description="Show, hide and reorder the charts. Remembered on this device." :ui="{ container: 'w-full max-w-xl mx-auto' }">
        <template #body>
          <div class="pb-4 safe-bottom">
            <ul aria-label="Charts">
              <li v-for="(id, i) in S.order" :key="id" class="md-item flex items-center gap-2 pr-2!">
                <USwitch :model-value="!S.hidden.includes(id)" :aria-label="`Show ${CHARTS[id].title}`" @update:model-value="(v: boolean) => I.toggle(id, v)" />
                <span class="flex-1 min-w-0 truncate md-body-large pl-2" :class="S.hidden.includes(id) ? 'text-muted' : ''">{{ CHARTS[id].title }}</span>
                <UButton icon="material-symbols:arrow-upward-rounded" variant="ghost" color="neutral" square class="tap" :disabled="i === 0" :aria-label="`Move ${CHARTS[id].title} up`" @click="I.move(id, -1)" />
                <UButton
                  icon="material-symbols:arrow-downward-rounded"
                  variant="ghost"
                  color="neutral"
                  square
                  class="tap"
                  :disabled="i === CHART_IDS.length - 1"
                  :aria-label="`Move ${CHARTS[id].title} down`"
                  @click="I.move(id, 1)"
                />
              </li>
            </ul>
            <div class="grid grid-cols-2 gap-2 pt-4">
              <UButton size="xl" variant="ghost" color="neutral" label="Reset" class="justify-center" @click="I.reset()" />
              <UButton size="xl" label="Done" class="justify-center" @click="customizeOpen = false" />
            </div>
          </div>
        </template>
      </UDrawer>
    </template>
  </UDashboardPanel>
</template>

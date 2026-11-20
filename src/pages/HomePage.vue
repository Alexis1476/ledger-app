<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import AccountGroups from '@/components/AccountGroups.vue'
import AccountIcon from '@/components/AccountIcon.vue'
import BalanceSheet from '@/components/BalanceSheet.vue'
import CategoryBars from '@/components/CategoryBars.vue'
import CiBadge from '@/components/CiBadge.vue'
import PrivacyToggle from '@/components/PrivacyToggle.vue'
import StatusBanner from '@/components/StatusBanner.vue'
import TxDetail from '@/components/TxDetail.vue'
import TxRow from '@/components/TxRow.vue'
import { useEntry } from '@/composables/useEntry'
import ScopeToggle from '@/components/ScopeToggle.vue'
import DueRow from '@/components/DueRow.vue'
import { useDashboard } from '@/composables/useDashboard'
import { useSchedules, type DueItem } from '@/composables/useSchedules'
import { useScope } from '@/composables/useScope'
import { useBudgets } from '@/composables/useBudgets'
import BudgetBar from '@/components/BudgetBar.vue'
import { useCountUp } from '@/composables/useCountUp'
import { useLedger, type AccountView } from '@/composables/useLedger'
import type { Decimal } from '@/ledger/decimal'
import type { Transaction } from '@/ledger/types'
import { money, monthLabel } from '@/lib/format'
import { useJournalStore } from '@/stores/journal'

// charts load on demand: ECharts stays out of the first bundle
const NetWorthChart = defineAsyncComponent(() => import('@/components/charts/NetWorthChart.vue'))
const CashFlowChart = defineAsyncComponent(() => import('@/components/charts/CashFlowChart.vue'))

const store = useJournalStore()
const L = useLedger()
const D = useDashboard()
const S = useSchedules(7)
const upcoming = computed(() => S.due.value.slice(0, 4))
const skipping = ref(false)
async function skipDue(d: DueItem) {
  skipping.value = true
  try {
    await S.skip(d)
  } finally {
    skipping.value = false
  }
}
const scope = useScope()
const hasKept = computed(() => L.keptPockets.value.all.size > 0)
const B = useBudgets()
const budget = computed(() => B.status(B.thisMonth.value))
/** a new ledger: nothing recorded yet besides the opening balances */
const fresh = computed(() => store.journal.transactions.every((t) => t.payee === 'Opening balance'))
/** a chart that would only draw a flat line says nothing */
const flat = computed(() => D.netWorth.value.every((p) => p.value.eq(D.netWorth.value[0]?.value ?? 0)))
/** the headline number rolls to its new value (first load, My money ↔ All, a new entry) */
const worthShown = useCountUp(() => D.worth.value.value)
const entry = useEntry()

const selected = ref<Transaction>()
const detailOpen = ref(false)
function select(tx: Transaction) {
  selected.value = tx
  detailOpen.value = true
}

/** Group pockets by institution (assets:neo:chf + assets:neo:eur → Neo). */
const groups = computed(() => {
  const visible = L.assetAccounts.value.filter(
    (a) => !a.archived && (a.balance.size > 0 || store.config.accounts[a.name]) && (scope.value === 'all' || !L.keptPockets.value.all.has(a.name))
  )
  const map = new Map<string, AccountView[]>()
  for (const a of visible) {
    const inst = a.name.split(':')[1] ?? a.name
    map.set(inst, [...(map.get(inst) ?? []), a])
  }
  return [...map].map(([inst, accounts]) => ({ key: `assets:${inst}`, label: L.groupLabel(`assets:${inst}`), accounts }))
})

const recent = computed(() => L.recent.value.filter(D.include).slice(0, 8))
const keptFor = computed(() => L.people.value.filter((p) => p.pockets.length))
const refC = computed(() => L.refCurrency.value)
const balanceLines = (m: Map<string, Decimal>) => [...m].map(([c, q]) => money(q, c))
const pct = (n?: number) => (n === undefined ? '' : `${n > 0 ? '+' : ''}${n.toFixed(0)}%`)
const hasFlows = computed(() => D.flow.value.some((r) => !r.income.isZero() || !r.expenses.isZero()))
</script>

<template>
  <UDashboardPanel id="home">
    <template #header>
      <UDashboardNavbar title="Home" :toggle="false">
        <template #right>
          <!-- on desktop the sidebar already shows it -->
          <span class="lg:hidden"><CiBadge /></span>
          <PrivacyToggle class="lg:hidden" />
          <UButton
            icon="material-symbols:refresh-rounded"
            color="neutral"
            variant="ghost"
            size="lg"
            :loading="store.state === 'loading'"
            aria-label="Refresh"
            @click="store.refresh().catch(() => {})"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="stagger max-w-3xl xl:max-w-6xl w-full mx-auto space-y-4 pb-44 lg:pb-8">
        <StatusBanner />

        <!-- loading: reserve the layout (no jump when data arrives) -->
        <div v-if="store.state === 'loading' && !store.hasData" class="space-y-4" aria-busy="true">
          <USkeleton class="h-48 w-full rounded-xl" />
          <div class="grid grid-cols-3 gap-3"><USkeleton v-for="i in 3" :key="i" class="h-20 rounded-xl" /></div>
          <USkeleton class="h-56 w-full rounded-xl" />
        </div>

        <!-- empty: nothing connected or no data yet -->
        <UCard v-else-if="!store.hasData" :ui="{ body: 'p-6 text-center space-y-3' }">
          <UIcon name="material-symbols:wallet" class="size-10 text-primary mx-auto" />
          <p class="font-medium">No journal loaded yet</p>
          <p class="text-sm text-muted">Connect your ledger-data repository to see balances and charts.</p>
          <UButton to="/settings" label="Open settings" icon="material-symbols:power-outline-rounded" />
        </UCard>

        <!-- wide screens: the cards flow in two columns -->
        <div v-else class="stagger space-y-4 xl:space-y-0 xl:columns-2 xl:gap-4 *:break-inside-avoid xl:*:mb-4">
          <!-- a new ledger: what to do first -->
          <UCard v-if="fresh" class="hero" :ui="{ body: 'p-5 sm:p-6' }">
            <h2 class="md-headline-small">Welcome</h2>
            <p class="md-body-medium mt-1 opacity-80">Your ledger is ready. Three things to start with:</p>
            <ol class="mt-4 space-y-2">
              <li>
                <RouterLink to="/accounts" class="press flex items-center gap-3 rounded-(--md-sys-shape-corner-large) bg-(--app-card) text-default px-4 py-3">
                  <UIcon name="material-symbols:account-balance-wallet-outline-rounded" class="size-6 text-primary shrink-0" aria-hidden="true" />
                  <span class="flex-1 md-body-large">Check your accounts</span>
                  <UIcon name="material-symbols:chevron-right-rounded" class="size-5 text-muted" aria-hidden="true" />
                </RouterLink>
              </li>
              <li>
                <button type="button" class="press w-full flex items-center gap-3 rounded-(--md-sys-shape-corner-large) bg-(--app-card) text-default px-4 py-3 text-left cursor-pointer" @click="entry.start('expense')">
                  <UIcon name="material-symbols:add-rounded" class="size-6 text-primary shrink-0" aria-hidden="true" />
                  <span class="flex-1 md-body-large">Record your first expense</span>
                  <UIcon name="material-symbols:chevron-right-rounded" class="size-5 text-muted" aria-hidden="true" />
                </button>
              </li>
              <li>
                <RouterLink to="/chart" class="press flex items-center gap-3 rounded-(--md-sys-shape-corner-large) bg-(--app-card) text-default px-4 py-3">
                  <UIcon name="material-symbols:account-tree-outline-rounded" class="size-6 text-primary shrink-0" aria-hidden="true" />
                  <span class="flex-1 md-body-large">Adjust your categories</span>
                  <UIcon name="material-symbols:chevron-right-rounded" class="size-5 text-muted" aria-hidden="true" />
                </RouterLink>
              </li>
            </ol>
            <p class="md-body-small mt-3 opacity-70">The + button always adds what the page you are on is about.</p>
          </UCard>
          <!-- Scheduled payments due soon (late + next 7 days) -->
          <UCard v-if="upcoming.length" :ui="{ body: 'md-list' }">
            <template #header>
              <div class="flex items-center justify-between">
                <h2 class="text-sm font-semibold">Upcoming payments</h2>
                <RouterLink to="/scheduled" class="text-xs text-primary inline-flex items-center gap-0.5">
                  All scheduled<UIcon name="material-symbols:chevron-right-rounded" class="size-3.5" aria-hidden="true" />
                </RouterLink>
              </div>
            </template>
            <DueRow
              v-for="d in upcoming"
              :key="`${d.schedule.id}:${d.date}`"
              :item="d"
              :busy="skipping"
              @record="S.record(d)"
              @skip="skipDue(d)"
            />
          </UCard>

          <!-- Headline: the number the toggle selects (my money / everything), and its trend -->
          <UCard class="hero" :ui="{ body: 'p-5 sm:p-6' }">
            <!-- the toggle keeps its own row: it must not move when the text under it changes length -->
            <ScopeToggle v-if="hasKept" class="mb-4" />
            <div>
              <div class="min-w-0">
                <h2 class="text-sm font-medium opacity-80">{{ D.worth.value.label }}</h2>
                <div class="md-display-small font-semibold tabular mt-1" :class="D.worth.value.value.isNeg() ? 'text-error' : ''">
                  {{ money(worthShown, refC) }}
                </div>
                <div v-if="D.netWorthDelta.value" class="mt-1 text-sm tabular flex items-center gap-1">
                  <UIcon
                    :name="D.netWorthDelta.value.up ? 'material-symbols:trending-up-rounded' : 'material-symbols:trending-down-rounded'"
                    class="size-4"
                    :class="D.netWorthDelta.value.up ? 'text-success' : 'text-error'"
                    aria-hidden="true"
                  />
                  <span :class="D.netWorthDelta.value.up ? 'text-success' : 'text-error'">
                    {{ D.netWorthDelta.value.up ? '+' : '' }}{{ money(D.netWorthDelta.value.abs, refC) }} {{ pct(D.netWorthDelta.value.pct) }}
                  </span>
                  <span class="opacity-70">vs last month</span>
                </div>
                <p class="mt-1 text-xs opacity-70">
                  {{ scope === 'mine' && hasKept ? 'Without the money kept for people.' : 'Everything in my accounts and owed to me, minus debts.' }}
                </p>
              </div>
            </div>
            <NetWorthChart v-if="D.netWorth.value.length > 3 && !flat" :points="D.netWorth.value" :currency="refC" :name="D.worth.value.label" class="mt-3" />
          </UCard>

          <!-- Balance sheet: in my accounts (kept for people / free), owed to me, debts -->
          <UCard :ui="{ body: 'p-4 sm:p-5' }">
            <template #header>
              <div class="flex items-center justify-between gap-2">
                <div>
                  <h2 class="text-sm font-semibold">Balance sheet</h2>
                  <p v-if="hasKept" class="text-xs text-muted">Everything, including the money kept for people</p>
                </div>
                <UButton to="/accounting" size="sm" class="tap shrink-0" variant="link" label="Details" trailing-icon="material-symbols:chevron-right-rounded" />
              </div>
            </template>
            <BalanceSheet />
          </UCard>

          <!-- Budgets: the closest to their limit -->
          <UCard v-if="budget.lines.length" :ui="{ body: 'md-list' }">
            <template #header>
              <div class="flex items-center justify-between gap-2">
                <h2 class="text-sm font-semibold">Budgets</h2>
                <UButton to="/budgets" size="sm" class="tap" variant="link" label="All budgets" trailing-icon="material-symbols:chevron-right-rounded" />
              </div>
            </template>
            <RouterLink v-for="l in budget.lines.slice(0, 3)" :key="l.key" to="/budgets" class="md-item press block py-3">
              <div class="flex items-baseline justify-between gap-2">
                <span class="truncate md-body-large">{{ B.label(l.key) }}</span>
                <span class="tabular md-label-large whitespace-nowrap" :class="l.state === 'over' ? 'text-error' : ''">
                  {{ l.left.isNeg() ? `${money(l.left.abs(), refC)} over` : `${money(l.left, refC)} left` }}
                </span>
              </div>
              <BudgetBar class="mt-2" :ratio="l.ratio" :state="l.state" :elapsed="budget.elapsed" :label="B.label(l.key)" />
            </RouterLink>
          </UCard>

          <!-- This month at a glance -->
          <section aria-labelledby="month-h">
            <div class="flex items-baseline justify-between mb-2 px-1">
              <h2 id="month-h" class="text-sm font-semibold">{{ monthLabel(D.month.value.month) }}</h2>
              <UButton
                :to="{ path: '/transactions', query: { month: D.month.value.month } }"
                size="sm"
                class="tap"
                variant="link"
                label="Details"
                trailing-icon="material-symbols:chevron-right-rounded"
              />
            </div>
            <div class="grid grid-cols-3 gap-3">
              <UCard :ui="{ body: 'p-3' }">
                <div class="text-xs text-muted">Spent</div>
                <div class="text-lg font-semibold tabular leading-tight mt-0.5">{{ money(D.month.value.spent, refC, 0) }}</div>
                <div v-if="D.month.value.spentDelta.pct !== undefined" class="text-xs tabular mt-0.5" :class="D.month.value.spentDelta.up ? 'text-error' : 'text-success'">
                  {{ pct(D.month.value.spentDelta.pct) }} <span class="text-muted">vs last</span>
                </div>
              </UCard>
              <UCard :ui="{ body: 'p-3' }">
                <div class="text-xs text-muted">Income</div>
                <div class="text-lg font-semibold tabular leading-tight mt-0.5">{{ money(D.month.value.earned, refC, 0) }}</div>
              </UCard>
              <UCard :ui="{ body: 'p-3' }">
                <div class="text-xs text-muted">Net</div>
                <div class="text-lg font-semibold tabular leading-tight mt-0.5" :class="D.month.value.saved.isNeg() ? 'text-error' : ''">
                  {{ money(D.month.value.saved, refC, 0) }}
                </div>
                <div class="text-xs text-muted mt-0.5">income − spent</div>
              </UCard>
            </div>
          </section>

          <!-- Top categories this month -->
          <UCard v-if="D.topCategories.value.items.length" :ui="{ body: 'p-2 sm:p-3' }">
            <template #header>
              <div class="flex items-center justify-between">
                <h2 class="text-sm font-semibold">Where it went</h2>
                <span class="text-xs text-muted">this month</span>
              </div>
            </template>
            <CategoryBars
              :items="D.topCategories.value.items"
              :other="D.topCategories.value.other"
              :total="D.topCategories.value.total"
              :currency="refC"
              :month="D.thisMonth.value"
            />
          </UCard>
          <UCard v-else :ui="{ body: 'p-5 text-center space-y-2' }">
            <p class="text-sm text-muted">No expenses yet this month.</p>
            <UButton icon="material-symbols:add-rounded" label="Add an expense" @click="entry.start('expense')" />
          </UCard>

          <!-- Cash flow -->
          <UCard v-if="hasFlows" :ui="{ body: 'p-3 sm:p-4' }">
            <template #header>
              <div class="flex items-center justify-between">
                <h2 class="text-sm font-semibold">Income vs expenses</h2>
                <span class="text-xs text-muted">6 months · {{ refC }}</span>
              </div>
            </template>
            <CashFlowChart :rows="D.flow.value" :currency="refC" />
          </UCard>

          <!-- Money kept for people (my money, labelled for them) + what to put back -->
          <div v-if="keptFor.length" class="grid gap-3 sm:grid-cols-2">
            <RouterLink v-for="p in keptFor" :key="p.key" to="/people" class="block">
              <UCard :ui="{ body: 'p-4' }" class="press h-full">
                <div class="flex items-center gap-2 text-sm">
                  <span class="size-2.5 rounded-full" :style="{ backgroundColor: p.color }" aria-hidden="true" />
                  {{ p.label }}
                </div>
                <div class="text-xl font-semibold tabular mt-1">{{ p.kept.ref ? money(p.kept.ref, refC) : `no ${refC} rate` }}</div>
                <div class="text-xs text-muted tabular">{{ balanceLines(p.kept.balance).join(' · ') || '—' }}</div>
                <div v-if="p.toReturn" class="text-xs mt-1.5">
                  <span v-if="p.toReturn.remaining.gt(0)" class="inline-flex items-center gap-1 text-warning">
                    <UIcon name="material-symbols:notifications-outline-rounded" class="size-3.5" aria-hidden="true" />
                    To put back: <span class="tabular font-medium">{{ money(p.toReturn.remaining, p.toReturn.currency) }}</span>
                  </span>
                  <span v-else class="inline-flex items-center gap-1 text-success">
                    <UIcon name="material-symbols:check-circle-outline-rounded" class="size-3.5" aria-hidden="true" />All put back
                  </span>
                </div>
              </UCard>
            </RouterLink>
          </div>

          <!-- Accounts -->
          <section aria-labelledby="acc-h">
            <h2 id="acc-h" class="text-sm font-semibold mb-2 px-1">Accounts</h2>
            <UCard :ui="{ body: 'md-list' }">
              <AccountGroups :groups="groups" />
              <div v-for="a in L.otherAssets.value" :key="a.name" class="md-item flex items-center gap-3 py-2.5">
                <AccountIcon :icon="a.icon" :color="a.color" />
                <div class="flex-1 min-w-0 truncate md-body-large">{{ a.label }}</div>
                <div class="text-right tabular md-label-large">
                  <div v-for="line in balanceLines(a.balance)" :key="line">{{ line }}</div>
                </div>
              </div>
            </UCard>
          </section>

          <!-- Recent -->
          <section aria-labelledby="recent-h">
            <div class="flex items-center justify-between mb-2 px-1">
              <h2 id="recent-h" class="text-sm font-semibold">Last transactions</h2>
              <UButton to="/transactions" size="sm" class="tap" variant="link" label="See all" trailing-icon="material-symbols:chevron-right-rounded" />
            </div>
            <UCard :ui="{ body: 'md-list' }">
              <TxRow v-for="tx in recent" :key="`${tx.src?.file}:${tx.src?.startLine}`" :tx="tx" show-date @select="select" />
              <div v-if="!recent.length" class="p-4 text-sm text-muted">No transactions yet.</div>
            </UCard>
          </section>
        </div>
      </div>
      <TxDetail v-model:open="detailOpen" :tx="selected" />
    </template>
  </UDashboardPanel>
</template>

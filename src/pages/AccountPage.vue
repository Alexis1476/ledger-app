<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import { useRoute } from 'vue-router'
import AccountIcon from '@/components/AccountIcon.vue'
import StatusBanner from '@/components/StatusBanner.vue'
import TxDetail from '@/components/TxDetail.vue'
import TxRow from '@/components/TxRow.vue'
import { useLedger } from '@/composables/useLedger'
import { lastMonths, monthEnd, valueAt, type NetWorthPoint } from '@/ledger/analytics'
import { Decimal, ZERO } from '@/ledger/decimal'
import { register, valueIn } from '@/ledger/reports'
import type { Transaction } from '@/ledger/types'
import { money, monthLabel, today } from '@/lib/format'
import { useJournalStore } from '@/stores/journal'

// charts load on demand: ECharts stays out of the first bundle
const NetWorthChart = defineAsyncComponent(() => import('@/components/charts/NetWorthChart.vue'))

const route = useRoute()
const store = useJournalStore()
const L = useLedger()

const name = computed(() => String(route.params.name ?? ''))
const view = computed(() => L.assetAccounts.value.find((a) => a.name === name.value))
/**
 * A bank with several pockets (assets:bank) has no account of its own: the page then shows all its
 * pockets as one account (total, every movement), valued in the reference currency.
 */
const members = computed(() => (view.value ? [] : L.assetAccounts.value.filter((a) => a.name.startsWith(name.value + ':'))))
const isGroup = computed(() => members.value.length > 0)
const refC = computed(() => L.refCurrency.value)
const st = computed(() => (isGroup.value ? { ...L.style(members.value[0].name), label: L.groupLabel(name.value) } : L.style(name.value)))
const currency = computed(() => (isGroup.value ? refC.value : view.value?.currency ?? L.accountCurrency(name.value) ?? refC.value))
/** what the bank holds: per currency, and in the reference currency */
const groupBalance = computed(() => {
  const by = new Map<string, Decimal>()
  for (const a of members.value) for (const [c, q] of a.balance) by.set(c, (by.get(c) ?? ZERO).plus(q))
  return { by, total: valueIn(by, refC.value, today(), store.prices).total }
})
const lines = (m: Map<string, Decimal>) => [...m].map(([c, q]) => money(q, c)).join(' · ')

/** postings of this account (of all its pockets for a bank), newest first, with the running balance after each */
const rows = computed(() => register(store.journal, name.value, isGroup.value).reverse())
/** the balance to show under a movement: the account's, or the bank's in that movement's currency */
const after = (r: (typeof rows.value)[number]) => {
  const c = isGroup.value ? r.amounts[0]?.commodity ?? currency.value : currency.value
  return money(r.balance.get(c) ?? ZERO, c)
}

/** balance at each of the last 12 month ends, in the account currency */
const points = computed<NetWorthPoint[]>(() => {
  const asc = [...rows.value].reverse()
  let i = 0
  let bal = ZERO
  return lastMonths(today().slice(0, 7), 12).map((month) => {
    const end = monthEnd(month)
    let last: Map<string, Decimal> | undefined
    for (; i < asc.length && asc[i].tx.date <= end; i++) {
      last = asc[i].balance
      if (!isGroup.value) bal = last.get(currency.value) ?? bal
    }
    if (isGroup.value && last) bal = valueIn(last, refC.value, end < today() ? end : today(), store.prices).total
    return { month, value: bal, missing: [] }
  })
})

const limit = ref(100)
const grouped = computed(() => {
  const out: { month: string; rows: typeof rows.value; inflow: Decimal; outflow: Decimal }[] = []
  for (const r of rows.value.slice(0, limit.value)) {
    const m = r.tx.date.slice(0, 7)
    let g = out[out.length - 1]
    if (!g || g.month !== m) out.push((g = { month: m, rows: [], inflow: ZERO, outflow: ZERO }))
    g.rows.push(r)
    for (const a of r.amounts) {
      // a bank: every currency counts, at the day's rate
      const q = isGroup.value ? valueAt(a, refC.value, r.tx.date, store.prices) : a.commodity === currency.value ? a.qty : undefined
      if (!q) continue
      if (q.isPos()) g.inflow = g.inflow.plus(q)
      else g.outflow = g.outflow.plus(q.abs())
    }
  }
  return out
})

const selected = ref<Transaction>()
const detailOpen = ref(false)
function select(tx: Transaction) {
  selected.value = tx
  detailOpen.value = true
}
</script>

<template>
  <UDashboardPanel id="account">
    <template #header>
      <UDashboardNavbar :title="st.label" :toggle="false">
        <template #leading>
          <UButton icon="material-symbols:arrow-back-rounded" color="neutral" variant="ghost" size="lg" aria-label="Back" @click="$router.back()" />
        </template>
      </UDashboardNavbar>
    </template>
    <template #body>
      <div class="stagger max-w-3xl w-full mx-auto space-y-4 pb-44 lg:pb-8">
        <StatusBanner />
        <UCard :ui="{ body: 'p-4 sm:p-5' }">
          <div class="flex items-center gap-3">
            <AccountIcon :icon="st.icon" :color="st.color" size="lg" />
            <div class="min-w-0">
              <div v-if="isGroup" class="md-body-medium text-muted">{{ members.length }} pockets · total in {{ refC }}</div>
              <div v-else class="text-sm text-muted truncate font-mono">{{ name }}</div>
              <div v-if="isGroup" class="md-headline-medium font-semibold tabular">{{ money(groupBalance.total, refC) }}</div>
              <div v-if="isGroup && groupBalance.by.size > 1" class="md-body-medium text-muted tabular">{{ lines(groupBalance.by) }}</div>
              <div v-if="!isGroup" class="text-3xl font-semibold tabular tracking-tight">
                <template v-if="view?.balance.size">
                  <div v-for="[c, q] in view.balance" :key="c">{{ money(q, c) }}</div>
                </template>
                <template v-else>{{ money(new Decimal(0), currency) }}</template>
              </div>
              <div v-if="view?.valueRef && currency !== L.refCurrency.value" class="text-sm text-muted tabular">
                ≈ {{ money(view.valueRef, L.refCurrency.value) }}
              </div>
            </div>
          </div>
          <NetWorthChart v-if="rows.length" :points="points" :currency="currency" name="Balance" class="mt-3" />
        </UCard>

        <!-- a bank: its pockets, each with its own details -->
        <section v-if="isGroup" aria-labelledby="pockets-h">
          <h2 id="pockets-h" class="text-sm font-semibold mb-2 px-1">Pockets</h2>
          <UCard :ui="{ body: 'md-list' }">
            <div v-for="a in members" :key="a.name" class="md-item flex items-center gap-3 py-2 pr-2!">
              <AccountIcon :icon="a.icon" :color="a.color" />
              <span class="flex-1 min-w-0 truncate md-body-large">{{ a.label }}</span>
              <span class="tabular md-label-large" :class="a.balance.size ? '' : 'text-muted'">{{ a.balance.size ? lines(a.balance) : `0.00 ${a.currency ?? ''}` }}</span>
              <UButton
                :to="`/accounts/${encodeURIComponent(a.name)}`"
                icon="material-symbols:visibility-outline-rounded"
                variant="ghost"
                color="neutral"
                square
                class="tap shrink-0"
                :aria-label="`Details of ${a.label}`"
              />
            </div>
          </UCard>
        </section>

        <div v-for="g in grouped" :key="g.month">
          <div class="sticky top-0 z-10 bg-default/95 backdrop-blur py-2 px-1 flex items-baseline justify-between">
            <h2 class="text-sm font-semibold">{{ monthLabel(g.month) }}</h2>
            <span class="text-xs tabular text-muted">
              <span class="text-success">+{{ money(g.inflow) }}</span> · <span>−{{ money(g.outflow) }}</span> {{ currency }}
            </span>
          </div>
          <UCard :ui="{ body: 'md-list' }">
            <!-- the balance after each movement sits inside the row, under the amount -->
            <TxRow
              v-for="r in g.rows"
              :key="`${r.tx.src?.file}:${r.tx.src?.startLine}:${r.postingIndex}`"
              :tx="r.tx"
              :amount="r.amounts[0]"
              :after="after(r)"
              show-date
              @select="select"
            />
          </UCard>
        </div>
        <div v-if="!rows.length && store.hasData" class="text-center text-sm text-muted p-6">No movements on this account yet.</div>
        <div v-if="rows.length > limit" class="text-center">
          <UButton variant="soft" label="Show more" @click="limit += 100" />
        </div>
      </div>
      <TxDetail v-model:open="detailOpen" :tx="selected" />
    </template>
  </UDashboardPanel>
</template>

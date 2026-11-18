<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import ScopeToggle from '@/components/ScopeToggle.vue'
import StatusBanner from '@/components/StatusBanner.vue'
import TxDetail from '@/components/TxDetail.vue'
import TxRow from '@/components/TxRow.vue'
import { useLedger } from '@/composables/useLedger'
import { useScope } from '@/composables/useScope'
import { valueAt } from '@/ledger/analytics'
import { ZERO, type Decimal } from '@/ledger/decimal'
import { isAssetType, postingAmounts } from '@/ledger/reports'
import type { Transaction } from '@/ledger/types'
import { dayLabel, money, monthLabel } from '@/lib/format'
import { useJournalStore } from '@/stores/journal'

const store = useJournalStore()
const L = useLedger()
const scope = useScope()

const search = ref('')
const account = ref<string>()
const category = ref<string>()
const currency = ref<string>()
const month = ref<string>()
const limit = ref(300)
const route = useRoute()

// links from Home ("Where it went", "Details") and account pages pre-set the filters
watch(
  () => route.query,
  (q) => {
    if (typeof q.category === 'string') category.value = q.category
    if (typeof q.month === 'string') month.value = q.month
    if (typeof q.account === 'string') account.value = q.account
  },
  { immediate: true }
)

const accountItems = computed(() => L.assetAccounts.value.map((a) => ({ label: a.label, value: a.name })))
const categoryItems = computed(() =>
  [...L.expenseCategories.value, ...L.incomeCategories.value].map((c) => ({ label: L.style(c).label, value: c }))
)
const currencyItems = computed<string[]>(() => store.journal.commodities.map((c) => String(c.symbol)))
const monthItems = computed(() =>
  [...new Set(store.journal.transactions.map((t) => t.date.slice(0, 7)))]
    .sort()
    .reverse()
    .map((m) => ({ label: monthLabel(m), value: m }))
)

const filtersActive = computed(() => !!(account.value || category.value || currency.value || month.value))
/** the filters in use, as chips that can be removed one by one */
const chips = computed(() =>
  [
    month.value && { key: 'month', label: monthLabel(month.value), remove: () => (month.value = undefined) },
    account.value && { key: 'account', label: L.style(account.value).label, remove: () => (account.value = undefined) },
    category.value && { key: 'category', label: L.style(category.value).label, remove: () => (category.value = undefined) },
    currency.value && { key: 'currency', label: currency.value, remove: () => (currency.value = undefined) }
  ].filter((c): c is { key: string; label: string; remove: () => undefined } => !!c)
)
const filtersOpen = ref(false)
function clear() {
  account.value = category.value = currency.value = month.value = undefined
  search.value = ''
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  const mine = (a: string) => isAssetType(L.typeOf(a)) && !L.keptPockets.value.all.has(a)
  return L.recent.value.filter((t) => {
    // "My money": hide what only moves the money kept for people (unless filtering on one of their pockets)
    if (scope.value === 'mine' && !account.value && !t.postings.some((p) => mine(p.account))) return false
    if (month.value && !t.date.startsWith(month.value)) return false
    if (account.value && !t.postings.some((p) => p.account === account.value)) return false
    if (category.value && !t.postings.some((p) => p.account === category.value || p.account.startsWith(category.value + ':'))) return false
    if (currency.value && !t.postings.some((p) => p.amount?.commodity === currency.value)) return false
    if (q) {
      const hay = [t.payee, t.note, t.date, ...t.postings.map((p) => p.account), ...Object.keys(t.tags), ...Object.values(t.tags)]
        .join(' ')
        .toLowerCase()
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false
    }
    return true
  })
})

const grouped = computed(() => {
  const months: { month: string; days: { date: string; txs: Transaction[] }[]; spent: Decimal; earned: Decimal }[] = []
  const refC = L.refCurrency.value
  for (const t of filtered.value.slice(0, limit.value)) {
    const m = t.date.slice(0, 7)
    let g = months[months.length - 1]
    if (!g || g.month !== m) months.push((g = { month: m, days: [], spent: ZERO, earned: ZERO }))
    const amounts = postingAmounts(t)
    t.postings.forEach((p, i) => {
      const type = L.typeOf(p.account)
      if (type !== 'X' && type !== 'R') return
      for (const a of amounts[i]) {
        const v = valueAt(a, refC, t.date, store.prices)
        if (!v) continue
        if (type === 'X') g!.spent = g!.spent.plus(v)
        else g!.earned = g!.earned.minus(v)
      }
    })
    let d = g.days[g.days.length - 1]
    if (!d || d.date !== t.date) g.days.push((d = { date: t.date, txs: [] }))
    d.txs.push(t)
  }
  return months
})

const selected = ref<Transaction>()
const detailOpen = ref(false)
function select(tx: Transaction) {
  selected.value = tx
  detailOpen.value = true
}
</script>

<template>
  <UDashboardPanel id="transactions">
    <template #header>
      <UDashboardNavbar title="Transactions" :toggle="false">
        <template #right>
          <span class="text-xs text-muted tabular">{{ filtered.length }} {{ filtered.length === 1 ? 'transaction' : 'transactions' }}</span>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="stagger max-w-3xl w-full mx-auto space-y-3 pb-44 lg:pb-6">
        <StatusBanner />
        <div class="flex items-center gap-2">
          <UInput v-model="search" icon="material-symbols:search-rounded" placeholder="Search payee, note, account, tag…" aria-label="Search" size="lg" class="flex-1 min-w-0" :ui="{ base: 'bg-(--md-sys-color-surface-container-high)' }" />
          <!-- phone: the filters open in a sheet -->
          <UChip :show="chips.length > 0" :text="chips.length" size="2xl" class="lg:hidden">
            <UButton
              size="lg"
              variant="soft"
              color="neutral"
              icon="material-symbols:tune-rounded"
              label="Filters"
              aria-haspopup="dialog"
              @click="filtersOpen = true"
            />
          </UChip>
          <div v-if="L.keptPockets.value.all.size" class="hidden lg:block shrink-0"><ScopeToggle /></div>
        </div>
        <!-- desktop: the filters stay in the page -->
        <div class="hidden lg:flex flex-wrap gap-2">
          <USelect v-model="month" :items="monthItems" placeholder="Month" aria-label="Month" size="lg" class="w-44" />
          <USelectMenu v-model="account" :items="accountItems" value-key="value" placeholder="Account" aria-label="Account" size="lg" class="w-48" />
          <USelectMenu v-model="category" :items="categoryItems" value-key="value" placeholder="Category" aria-label="Category" size="lg" class="w-48" />
          <USelect v-model="currency" :items="currencyItems" placeholder="Currency" aria-label="Currency" size="lg" class="w-32" />
          <UButton v-if="filtersActive || search" size="lg" variant="ghost" color="neutral" icon="material-symbols:close-rounded" label="Clear" @click="clear" />
        </div>
        <ul v-if="chips.length" class="flex flex-wrap gap-2 lg:hidden" aria-label="Active filters">
          <li v-for="c in chips" :key="c.key">
            <UButton
              class="tap rounded-(--md-sys-shape-corner-small)"
              size="sm"
              variant="soft"
              :label="c.label"
              trailing-icon="material-symbols:close-rounded"
              :aria-label="`Remove filter ${c.label}`"
              @click="c.remove()"
            />
          </li>
        </ul>

        <UDrawer v-model:open="filtersOpen" title="Filters" :ui="{ container: 'w-full max-w-xl mx-auto' }">
          <template #body>
            <div class="space-y-3 pb-4 safe-bottom">
              <ScopeToggle v-if="L.keptPockets.value.all.size" class="w-full" />
              <UFormField label="Month">
                <USelect v-model="month" :items="monthItems" placeholder="Any month" size="xl" class="w-full" />
              </UFormField>
              <UFormField label="Account">
                <USelectMenu v-model="account" :items="accountItems" value-key="value" placeholder="Any account" size="xl" class="w-full" />
              </UFormField>
              <UFormField label="Category">
                <USelectMenu v-model="category" :items="categoryItems" value-key="value" placeholder="Any category" size="xl" class="w-full" />
              </UFormField>
              <UFormField label="Currency">
                <USelect v-model="currency" :items="currencyItems" placeholder="Any currency" size="xl" class="w-full" />
              </UFormField>
              <div class="grid grid-cols-2 gap-2 pt-1">
                <UButton size="xl" variant="ghost" color="neutral" label="Clear" class="justify-center" :disabled="!filtersActive" @click="clear" />
                <UButton size="xl" :label="`Show ${filtered.length}`" class="justify-center" @click="filtersOpen = false" />
              </div>
            </div>
          </template>
        </UDrawer>

        <div v-for="g in grouped" :key="g.month">
          <div class="sticky top-0 z-10 bg-default/95 backdrop-blur py-2 px-1 flex items-baseline justify-between gap-2">
            <h2 class="text-sm font-semibold">{{ monthLabel(g.month) }}</h2>
            <span class="text-xs tabular text-muted whitespace-nowrap">
              <template v-if="!g.earned.isZero()"><span class="text-success">+{{ money(g.earned, L.refCurrency.value, 0) }}</span> · </template>
              −{{ money(g.spent, L.refCurrency.value, 0) }}
            </span>
          </div>
          <UCard :ui="{ body: 'md-list' }">
            <div v-for="d in g.days" :key="d.date">
              <div class="px-4 pt-3 pb-1.5 md-label-medium text-muted">{{ dayLabel(d.date) }}</div>
              <TxRow v-for="tx in d.txs" :key="`${tx.src?.file}:${tx.src?.startLine}`" :tx="tx" @select="select" />
            </div>
          </UCard>
        </div>
        <div v-if="!filtered.length" class="text-sm text-muted p-4 text-center">No matching transactions.</div>
        <div v-if="filtered.length > limit" class="text-center">
          <UButton variant="soft" label="Show more" @click="limit += 300" />
        </div>
      </div>
      <TxDetail v-model:open="detailOpen" :tx="selected" />
    </template>
  </UDashboardPanel>
</template>

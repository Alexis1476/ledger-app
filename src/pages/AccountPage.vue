<script setup lang="ts">
import { computed, defineAsyncComponent, reactive, ref } from 'vue'
import { ulid } from 'ulid'
import { useToast } from '@nuxt/ui/composables'
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
import { money, monthLabel, parseUserAmount, shortDate, signedMoney, today } from '@/lib/format'
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

// ── Correct the balance: what the bank shows, the difference as an adjustment ──
const toast = useToast()
const ADJUST = 'equity:adjustments'
const fix = reactive({ open: false, amount: '', date: today() })
/** the balance of this account at the end of a day */
const balanceAt = (date: string) => rows.value.find((r) => r.tx.date <= date)?.balance.get(currency.value) ?? ZERO
const fixTarget = computed(() => parseUserAmount(fix.amount.replace(/^-/, '')))
const fixNegative = computed(() => fix.amount.trim().startsWith('-'))
const fixDelta = computed(() => (fixTarget.value ? (fixNegative.value ? fixTarget.value.neg() : fixTarget.value).minus(balanceAt(fix.date)) : undefined))
const fixBusy = ref(false)
function openFix() {
  Object.assign(fix, { open: true, amount: '', date: today() })
}
async function saveFix() {
  const delta = fixDelta.value
  if (!delta || delta.isZero()) return
  fixBusy.value = true
  try {
    if (!L.declared.value.includes(ADJUST)) await store.addAccount(ADJUST, { type: 'E', label: 'Adjustments' })
    const id = ulid()
    const tx: Transaction = {
      date: fix.date,
      status: '*',
      payee: 'Balance correction',
      note: st.value.label,
      id,
      tags: { via: 'app', id },
      postings: [
        { account: name.value, amount: { qty: delta, commodity: currency.value }, tags: {} },
        { account: ADJUST, amount: { qty: delta.neg(), commodity: currency.value }, tags: {} }
      ]
    }
    await store.addTransaction(tx, { queueOffline: false })
    toast.add({ title: 'Balance corrected', description: `${st.value.label} · ${signedMoney(delta, currency.value)}`, icon: 'material-symbols:check-rounded', color: 'success' })
    fix.open = false
  } catch (e) {
    toast.add({ title: 'Not saved', description: (e as Error).message, color: 'error', icon: 'material-symbols:cancel-outline-rounded' })
  } finally {
    fixBusy.value = false
  }
}

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
          <div v-if="!isGroup && view" class="mt-3 flex justify-end">
            <UButton variant="soft" color="neutral" icon="material-symbols:edit-outline-rounded" label="Correct balance" aria-haspopup="dialog" @click="openFix" />
          </div>
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

      <!-- Correct the balance -->
      <UModal v-model:open="fix.open" title="Correct the balance" description="Enter what your bank shows. The difference is recorded as an adjustment, nothing else changes.">
        <template #body>
          <form class="space-y-4" @submit.prevent="saveFix">
            <UFormField label="Balance on the bank">
              <UInput v-model="fix.amount" size="xl" inputmode="decimal" placeholder="0.00" aria-label="Balance on the bank" class="w-full" autofocus>
                <template #trailing><span class="text-muted">{{ currency }}</span></template>
              </UInput>
            </UFormField>
            <UFormField label="On">
              <UInput v-model="fix.date" type="date" size="xl" aria-label="Date" class="w-full" />
            </UFormField>
            <div class="rounded-(--md-sys-shape-corner-large) bg-(--md-sys-color-surface-container) p-4 md-body-medium space-y-1">
              <div class="flex justify-between gap-2">
                <span class="text-muted">In the app on {{ shortDate(fix.date) }}</span><span class="tabular">{{ money(balanceAt(fix.date), currency) }}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-muted">Difference</span>
                <span class="tabular md-label-large">{{ fixDelta ? signedMoney(fixDelta, currency) : '—' }}</span>
              </div>
            </div>
            <p v-if="fixDelta && fixDelta.isZero()" class="text-xs text-muted">Nothing to correct: the app already shows this balance.</p>
            <div class="flex justify-end gap-2 pt-2">
              <UButton variant="ghost" label="Cancel" @click="fix.open = false" />
              <UButton type="submit" label="Correct" icon="material-symbols:check-rounded" :loading="fixBusy" :disabled="!fixDelta || fixDelta.isZero()" />
            </div>
          </form>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>

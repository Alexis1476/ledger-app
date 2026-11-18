<script setup lang="ts">
import { computed, ref } from 'vue'
import AccountIcon from '@/components/AccountIcon.vue'
import StatusBanner from '@/components/StatusBanner.vue'
import TxDetail from '@/components/TxDetail.vue'
import TxRow from '@/components/TxRow.vue'
import { useLedger, type PersonView } from '@/composables/useLedger'
import type { Decimal } from '@/ledger/decimal'
import type { Transaction } from '@/ledger/types'
import { money, shortDate } from '@/lib/format'
import { useJournalStore } from '@/stores/journal'

/**
 * People: the money I keep for them (my money, in pockets labelled for them) and a reminder of
 * what to put back. Loans (who owes me, whom I owe) have their own page.
 */
const store = useJournalStore()
const L = useLedger()
const refC = computed(() => L.refCurrency.value)
const lines = (m: Map<string, Decimal>) => [...m].map(([c, q]) => money(q, c))

const people = computed(() =>
  L.people.value
    .filter((p) => p.pockets.length)
    .sort((a, b) => Number(b.pockets.length > 0) - Number(a.pockets.length > 0) || a.label.localeCompare(b.label))
)

function history(p: PersonView) {
  const set = new Set([...p.pockets.map((a) => a.name), ...p.categories].filter(Boolean) as string[])
  return L.recent.value.filter((t) => t.postings.some((x) => set.has(x.account))).slice(0, 10)
}

const progress = (p: PersonView) =>
  p.toReturn && p.toReturn.amount.gt(0) ? Math.min(100, p.toReturn.returned.div(p.toReturn.amount).times(100).toNumber()) : 0

const selected = ref<Transaction>()
const detailOpen = ref(false)
function select(tx: Transaction) {
  selected.value = tx
  detailOpen.value = true
}
</script>

<template>
  <UDashboardPanel id="people">
    <template #header>
      <UDashboardNavbar title="People" :toggle="false" />
    </template>
    <template #body>
      <div class="stagger max-w-3xl w-full mx-auto space-y-5 pb-44 lg:pb-8">
        <StatusBanner />
        <UCard v-for="p in people" :key="p.key">
          <template #header>
            <div class="flex items-center gap-2 font-semibold">
              <span class="size-3 rounded-full" :style="{ backgroundColor: p.color }" aria-hidden="true" />
              {{ p.label }}
            </div>
          </template>
          <div class="space-y-4">
            <div v-if="p.pockets.length">
              <div class="text-xl font-semibold tabular">{{ p.kept.ref ? money(p.kept.ref, refC) : `no ${refC} rate` }}</div>
              <ul class="mt-2 space-y-1">
                <li v-for="a in p.pockets" :key="a.name">
                  <RouterLink :to="`/accounts/${encodeURIComponent(a.name)}`" class="press tap flex items-center gap-2 rounded-md py-1 -mx-1 px-1 text-sm">
                    <AccountIcon :icon="a.icon" :color="a.color" size="sm" />
                    <span class="flex-1 min-w-0 truncate">{{ a.label }}</span>
                    <span class="tabular">{{ lines(a.balance).join(' · ') || '—' }}</span>
                  </RouterLink>
                </li>
              </ul>
            </div>

            <div v-if="p.toReturn" class="rounded-lg border border-default p-3">
              <div class="flex items-center gap-2 text-sm font-medium">
                <UIcon
                  :name="p.toReturn.remaining.gt(0) ? 'material-symbols:notifications-outline-rounded' : 'material-symbols:check-circle-outline-rounded'"
                  :class="p.toReturn.remaining.gt(0) ? 'text-warning' : 'text-success'"
                  class="size-4"
                  aria-hidden="true"
                />
                <span class="flex-1">
                  {{ p.toReturn.remaining.gt(0) ? `To put back into ${p.label}'s pockets` : 'All put back' }}
                </span>
                <span class="tabular">{{ money(p.toReturn.remaining, p.toReturn.currency) }}</span>
              </div>
              <div
                class="mt-2 h-1.5 rounded-full bg-elevated overflow-hidden"
                role="progressbar"
                :aria-valuenow="Math.round(progress(p))"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-label="`Put back ${Math.round(progress(p))}%`"
              >
                <div class="h-full bg-primary rounded-full" :style="{ width: `${progress(p)}%` }" />
              </div>
              <p class="text-xs text-muted mt-1.5">
                <span class="tabular">{{ money(p.toReturn.returned, p.toReturn.currency) }}</span> of <span class="tabular">{{ money(p.toReturn.amount, p.toReturn.currency) }}</span> put back
                since {{ shortDate(p.toReturn.since) }}<template v-if="p.toReturn.note"> · {{ p.toReturn.note }}</template>. A transfer from
                one of my pockets to one of {{ p.label }}'s counts.
              </p>
            </div>
          </div>
          <div class="mt-4">
            <div class="text-xs font-medium text-muted mb-1">History</div>
            <TxRow v-for="tx in history(p)" :key="`${tx.src?.file}:${tx.src?.startLine}`" :tx="tx" show-date @select="select" />
          </div>
        </UCard>
        <div v-if="!people.length && store.hasData" class="text-sm text-muted">
          Nobody yet. Add people in app.config.json with the pockets you keep for them. Loans are on the
          <RouterLink to="/loans" class="text-primary">Loans</RouterLink> page.
        </div>
      </div>
      <TxDetail v-model:open="detailOpen" :tx="selected" />
    </template>
  </UDashboardPanel>
</template>

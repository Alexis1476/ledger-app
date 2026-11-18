<script setup lang="ts">
import { computed, ref } from 'vue'
import AccountIcon from '@/components/AccountIcon.vue'
import DueRow from '@/components/DueRow.vue'
import StatusBanner from '@/components/StatusBanner.vue'
import { usePageFab } from '@/composables/useFab'
import { useLedger } from '@/composables/useLedger'
import { useSchedules, type DueItem, type ScheduleItem } from '@/composables/useSchedules'
import { money, shortDate, signedMoney } from '@/lib/format'
import { useJournalStore } from '@/stores/journal'

/**
 * Scheduled payments (hledger periodic transactions in journals/scheduled.journal): what is due
 * (late + next 30 days) with Record / Skip, and every schedule (tap to edit).
 */
const store = useJournalStore()
const L = useLedger()
const S = useSchedules(30)
const refC = computed(() => L.refCurrency.value)
const busy = ref(false)

async function skip(d: DueItem) {
  busy.value = true
  try {
    await S.skip(d)
  } finally {
    busy.value = false
  }
}

usePageFab({ label: 'New scheduled payment', run: () => S.create() })

const st = (i: ScheduleItem) => L.style(L.mainAccount(i.schedule.tx))
const amount = (i: ScheduleItem) => L.displayAmount(i.schedule.tx)
</script>

<template>
  <UDashboardPanel id="scheduled">
    <template #header>
      <UDashboardNavbar title="Scheduled" :toggle="false" />
    </template>
    <template #body>
      <div class="stagger max-w-3xl w-full mx-auto space-y-4 pb-44 lg:pb-8">
        <StatusBanner />

        <UCard :ui="{ body: 'md-list' }">
          <template #header>
            <div>
              <h2 class="text-sm font-semibold">Due · next 30 days</h2>
              <span v-if="S.due.value.length" class="block text-xs tabular text-muted">
                <template v-if="!S.dueSplit.value.incoming.isZero()">
                  to receive <span class="text-success font-medium">+{{ money(S.dueSplit.value.incoming, refC) }}</span>
                </template>
                <template v-if="!S.dueSplit.value.incoming.isZero() && !S.dueSplit.value.outgoing.isZero()"> · </template>
                <template v-if="!S.dueSplit.value.outgoing.isZero()">
                  to pay <span class="text-default font-medium">{{ money(S.dueSplit.value.outgoing, refC) }}</span>
                </template>
              </span>
            </div>
          </template>
          <DueRow
            v-for="d in S.due.value"
            :key="`${d.schedule.id}:${d.date}`"
            :item="d"
            :busy="busy"
            @record="S.record(d)"
            @skip="skip(d)"
          />
          <p v-if="!S.due.value.length" class="px-3 py-4 text-sm text-muted">Nothing due in the next 30 days.</p>
        </UCard>

        <UCard :ui="{ body: 'md-list' }">
          <template #header>
            <h2 class="text-sm font-semibold">All scheduled payments</h2>
          </template>
          <button
            v-for="i in S.items.value"
            :key="i.schedule.id ?? i.schedule.src?.startLine"
            type="button"
            class="md-item press w-full flex items-center gap-3 py-2.5 text-left cursor-pointer"
            @click="S.edit(i)"
          >
            <AccountIcon :icon="st(i).icon" :color="st(i).color" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <span class="truncate font-medium">{{ i.label }}</span>
                <UIcon v-if="!i.kind || !i.schedule.rule" name="material-symbols:lock-outline" class="size-3.5 text-muted shrink-0" aria-label="Read-only" />
              </div>
              <div class="text-xs text-muted truncate">
                {{ i.every }} ·
                <template v-if="i.state.ended">ended</template>
                <template v-else-if="i.state.next">next {{ shortDate(i.state.next) }}</template>
                <template v-if="i.schedule.rule?.to"> · until {{ shortDate(i.schedule.rule.to) }}</template>
              </div>
            </div>
            <span v-if="amount(i)" class="tabular text-sm whitespace-nowrap">{{ signedMoney(amount(i)!.qty, amount(i)!.commodity) }}</span>
          </button>
          <div v-if="!S.items.value.length && store.hasData" class="px-3 py-4 text-sm text-muted space-y-2">
            <p>No scheduled payments yet: rent, insurance, subscriptions…</p>
            <UButton icon="material-symbols:add-rounded" label="New scheduled payment" @click="S.create()" />
          </div>
        </UCard>

        <p class="text-xs text-muted">A payment is only written to your accounts when you record it.</p>
        <details class="text-xs text-muted">
          <summary class="cursor-pointer py-2">Technical details</summary>
          <p>
            Stored as hledger periodic transactions in <code>journals/scheduled.journal</code>: see the forecast with
            <code>hledger bal --forecast</code>.
          </p>
        </details>
      </div>
    </template>
  </UDashboardPanel>
</template>

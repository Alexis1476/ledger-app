<script setup lang="ts">
import { computed } from 'vue'
import AccountIcon from './AccountIcon.vue'
import { useLedger } from '@/composables/useLedger'
import type { DueItem } from '@/composables/useSchedules'
import { shortDate, signedMoney, today } from '@/lib/format'

/** One due occurrence of a scheduled payment, with Record / Skip. */
const props = defineProps<{ item: DueItem; busy?: boolean }>()
defineEmits<{ record: []; skip: [] }>()

const L = useLedger()
const st = computed(() => L.style(L.mainAccount(props.item.tx)))
const amount = computed(() => L.displayAmount(props.item.tx))
const when = computed(() => {
  const d = props.item.date
  const t = today()
  const days = Math.round((Date.parse(d) - Date.parse(t)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} late`
  return `In ${days} days`
})
</script>

<template>
  <!--
    Two lines: what and how much, then the actions (on a phone the buttons have their own row,
    side by side; from sm up they sit at the end of the first line).
  -->
  <div class="md-item flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
    <AccountIcon :icon="st.icon" :color="st.color" />
    <div class="min-w-0 flex-1">
      <div class="flex items-baseline justify-between gap-3">
        <span class="truncate md-body-large">{{ item.label }}</span>
        <span
          v-if="amount"
          class="tabular md-label-large whitespace-nowrap"
          :class="amount.qty.isPos() && !amount.qty.isZero() ? 'text-success' : ''"
        >
          {{ signedMoney(amount.qty, amount.commodity) }}
        </span>
      </div>
      <div class="md-body-medium" :class="item.overdue ? 'text-error' : 'text-muted'">
        {{ when }} · {{ shortDate(item.date) }} · {{ item.every }}
      </div>
    </div>
    <div class="flex w-full gap-2 pl-12 sm:w-auto sm:pl-0">
      <UButton
        class="flex-1 justify-center sm:flex-none"
        variant="soft"
        color="neutral"
        label="Skip"
        :disabled="busy"
        :aria-label="`Skip ${item.label} on ${item.date}`"
        @click="$emit('skip')"
      />
      <UButton
        class="flex-1 justify-center sm:flex-none"
        label="Record"
        icon="material-symbols:check-rounded"
        :disabled="busy"
        :aria-label="`Record ${item.label} on ${item.date}`"
        @click="$emit('record')"
      />
    </div>
  </div>
</template>

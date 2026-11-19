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
    What, then how much with the actions: the amount sits on the same line as Skip / Record,
    vertically centred with them (on a phone that line is under the name; from sm up it is all
    one row).
  -->
  <div class="md-item flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
    <AccountIcon :icon="st.icon" :color="st.color" />
    <div class="min-w-0 flex-1">
      <div class="truncate md-body-large">{{ item.label }}</div>
      <div class="md-body-medium" :class="item.overdue ? 'text-error' : 'text-muted'">
        {{ when }} · {{ shortDate(item.date) }} · {{ item.every }}
      </div>
    </div>
    <!-- the buttons go under the amount when both do not fit on one line (a large amount) -->
    <div class="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 pl-12 sm:w-auto sm:pl-0">
      <span
        v-if="amount"
        class="mr-auto min-w-0 break-all tabular md-title-medium sm:pr-2"
        :class="amount.qty.isPos() && !amount.qty.isZero() ? 'text-success' : ''"
      >
        {{ signedMoney(amount.qty, amount.commodity) }}
      </span>
      <div class="flex shrink-0 gap-2">
        <UButton
          variant="soft"
          color="neutral"
          label="Skip"
          :disabled="busy"
          :aria-label="`Skip ${item.label} on ${item.date}`"
          @click="$emit('skip')"
        />
        <UButton
          label="Record"
          icon="material-symbols:check-rounded"
          :ui="{ leadingIcon: 'max-sm:hidden' }"
          :disabled="busy"
          :aria-label="`Record ${item.label} on ${item.date}`"
          @click="$emit('record')"
        />
      </div>
    </div>
  </div>
</template>

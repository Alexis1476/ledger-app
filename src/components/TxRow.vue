<script setup lang="ts">
import { computed } from 'vue'
import AccountIcon from './AccountIcon.vue'
import { useLedger } from '@/composables/useLedger'
import type { Decimal } from '@/ledger/decimal'
import type { Transaction } from '@/ledger/types'
import { shortDate, signedMoney } from '@/lib/format'

/**
 * `amount` overrides the shown amount (e.g. this account's own movement on an account page);
 * `after` is the account's balance after this movement, shown under the amount.
 */
const props = defineProps<{ tx: Transaction; showDate?: boolean; amount?: { qty: Decimal; commodity: string }; after?: string }>()
defineEmits<{ select: [tx: Transaction] }>()

const L = useLedger()
const main = computed(() => L.mainAccount(props.tx))
const st = computed(() => L.style(main.value))
const amount = computed(() => props.amount ?? L.displayAmount(props.tx))
const source = computed(() => {
  const p = props.tx.postings.find((p) => L.assetAccounts.value.some((a) => a.name === p.account))
  return p ? L.style(p.account).label : ''
})
</script>

<template>
  <button
    type="button"
    class="md-item press w-full flex items-center gap-3 py-2.5 text-left cursor-pointer"
    @click="$emit('select', tx)"
  >
    <AccountIcon :icon="st.icon" :color="st.color" />
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-1.5">
        <span class="truncate md-body-large">{{ tx.payee ?? tx.note ?? st.label }}</span>
        <UIcon v-if="tx.status === '!'" name="material-symbols:schedule-outline-rounded" class="size-3.5 text-warning shrink-0" />
        <UIcon v-if="tx.unsupported" name="material-symbols:warning-outline-rounded" class="size-3.5 text-warning shrink-0" />
      </div>
      <div class="flex items-center gap-1.5 md-body-medium text-muted truncate">
        <span v-if="showDate" class="shrink-0">{{ shortDate(tx.date) }} ·</span>
        <span class="truncate">{{ st.label }}<template v-if="source"> · {{ source }}</template></span>
      </div>
    </div>
    <div v-if="amount" class="text-right tabular whitespace-nowrap">
      <div class="md-label-large" :class="amount.qty.isNeg() ? '' : 'text-success'">{{ signedMoney(amount.qty, amount.commodity) }}</div>
      <div v-if="after" class="md-body-small text-muted" title="Balance after">{{ after }}</div>
    </div>
  </button>
</template>

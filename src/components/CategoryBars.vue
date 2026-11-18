<script setup lang="ts">
import { computed } from 'vue'
import AccountIcon from './AccountIcon.vue'
import { useLedger } from '@/composables/useLedger'
import { Decimal } from '@/ledger/decimal'
import { money } from '@/lib/format'

/**
 * Top categories as ranked bars with direct labels (not a donut: > 5 categories and exact
 * values matter). One magnitude → one hue; the category color only marks identity (icon).
 * Being plain HTML, it is also the table view. Tapping a row opens those transactions.
 */
const props = defineProps<{
  items: { account: string; value: Decimal }[]
  other: Decimal
  total: Decimal
  currency: string
  month: string
}>()
const L = useLedger()

const max = computed(() => props.items.reduce((m, x) => (x.value.gt(m) ? x.value : m), props.other))
const pct = (v: Decimal) => (props.total.isZero() ? 0 : v.div(props.total).times(100).toDecimalPlaces(0).toNumber())
const width = (v: Decimal) => (max.value.isZero() ? 0 : Math.max(2, v.div(max.value).times(100).toNumber()))
</script>

<template>
  <ul class="space-y-1">
    <li v-for="c in items" :key="c.account">
      <RouterLink
        :to="{ path: '/transactions', query: { category: c.account, month } }"
        class="press flex items-center gap-3 rounded-lg px-2 py-2 min-h-12"
      >
        <AccountIcon :icon="L.style(c.account).icon" :color="L.style(c.account).color" size="sm" />
        <div class="flex-1 min-w-0">
          <div class="flex items-baseline justify-between gap-2 text-sm">
            <span class="truncate">{{ L.style(c.account).label }}</span>
            <span class="tabular font-medium whitespace-nowrap">{{ money(c.value, currency) }}</span>
          </div>
          <div class="mt-1 flex items-center gap-2">
            <div class="h-1.5 flex-1 rounded-full bg-elevated overflow-hidden">
              <div class="h-full rounded-full" :style="{ width: width(c.value) + '%', backgroundColor: 'var(--app-series-1)' }" />
            </div>
            <span class="text-xs text-muted tabular w-9 text-right">{{ pct(c.value) }}%</span>
          </div>
        </div>
      </RouterLink>
    </li>
    <li v-if="other.gt(0)" class="flex items-center gap-3 px-2 py-2 text-sm text-muted">
      <span class="size-7 shrink-0" />
      <span class="flex-1">Other</span>
      <span class="tabular">{{ money(other, currency) }}</span>
    </li>
  </ul>
</template>

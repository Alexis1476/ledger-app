<script setup lang="ts">
import { computed, ref } from 'vue'
import { useLedger, type BalanceLine } from '@/composables/useLedger'
import type { Decimal } from '@/ledger/decimal'
import { money } from '@/lib/format'

/**
 * Balance sheet: in my accounts (split: kept for each person / free) + owed to me − debts =
 * net worth. Each line: CHF total + amounts per currency. Headline numbers, so a table.
 */
const L = useLedger()
const B = computed(() => L.balanceSheet.value)
const refC = computed(() => L.refCurrency.value)
const open = ref<Record<string, boolean>>({})

const lines = (b: BalanceLine) => [...b.byCommodity].map(([c, q]) => money(q, c))
const missingNote = computed(() => {
  const all = new Set([...B.value.inAccounts.missing, ...B.value.owed.missing, ...B.value.owedToMe.missing])
  return [...all]
})
type Row = {
  key: string
  label: string
  sign: '' | '−' | '+' | '='
  line?: BalanceLine
  total: Decimal
  people?: { key: string; label: string; byCommodity: Map<string, Decimal>; total: Decimal }[]
  strong?: boolean
}
const rows = computed<Row[]>(() => {
  const b = B.value
  const split = b.inAccountsSplit.length > 1 ? b.inAccountsSplit : undefined
  const r: Row[] = [{ key: 'in', label: 'In my accounts', sign: '', line: b.inAccounts, total: b.inAccounts.total, people: split }]
  if (b.owedToMe.byCommodity.size) r.push({ key: 'owed-to-me', label: 'Owed to me', sign: '+', line: b.owedToMe, total: b.owedToMe.total, people: b.owedToMeByPerson })
  if (b.owed.byCommodity.size) r.push({ key: 'owed', label: 'Debts', sign: '−', line: b.owed, total: b.owed.total, people: b.owedByPerson })
  r.push({ key: 'net', label: 'Net worth', sign: '=', total: L.netWorth.value.total, strong: true })
  return r
})
</script>

<template>
  <div>
    <dl class="divide-y divide-default">
      <div v-for="row in rows" :key="row.key" class="py-2.5 first:pt-0 last:pb-0">
        <component
          :is="row.people?.length ? 'button' : 'div'"
          :type="row.people?.length ? 'button' : undefined"
          class="w-full flex items-start gap-2 text-left"
          :class="row.people?.length ? 'press rounded-md -mx-1 px-1 cursor-pointer' : ''"
          :aria-expanded="row.people?.length ? !!open[row.key] : undefined"
          @click="row.people?.length && (open[row.key] = !open[row.key])"
        >
          <span class="w-4 shrink-0 text-muted tabular font-medium" aria-hidden="true">{{ row.sign }}</span>
          <dt class="flex-1 min-w-0">
            <span :class="row.strong ? 'font-semibold' : ''">{{ row.label }}</span>
            <span v-if="row.line?.byCommodity.size" class="block text-xs text-muted tabular">{{ lines(row.line).join(' · ') }}</span>
          </dt>
          <dd
            class="tabular whitespace-nowrap text-right"
            :class="[row.strong ? 'font-semibold text-base' : 'text-sm', row.strong && row.total.isNeg() ? 'text-error' : '']"
          >
            {{ money(row.total, refC) }}
          </dd>
          <UIcon
            v-if="row.people?.length"
            :name="open[row.key] ? 'material-symbols:keyboard-arrow-up-rounded' : 'material-symbols:keyboard-arrow-down-rounded'"
            class="size-4 text-muted shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <span v-else class="size-4 shrink-0" aria-hidden="true" />
        </component>
        <ul v-if="row.people?.length && open[row.key]" class="mt-1.5 ml-6 space-y-1">
          <li v-for="p in row.people" :key="p.key" class="flex items-baseline justify-between gap-2 text-xs">
            <span class="text-muted">{{ p.label }}</span>
            <span class="tabular">{{ [...p.byCommodity].map(([c, q]) => money(q, c)).join(' · ') }}</span>
          </li>
        </ul>
      </div>
    </dl>
    <p v-if="missingNote.length" class="text-xs text-warning mt-2 flex items-center gap-1">
      <UIcon name="material-symbols:warning-outline-rounded" class="size-3.5" aria-hidden="true" />
      No {{ refC }} rate for {{ missingNote.join(', ') }}: left out of the {{ refC }} totals.
    </p>
  </div>
</template>

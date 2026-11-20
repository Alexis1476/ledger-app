<script setup lang="ts">
import { reactive } from 'vue'
import AccountIcon from './AccountIcon.vue'
import { useLedger, type AccountView } from '@/composables/useLedger'
import { Decimal, ZERO } from '@/ledger/decimal'
import { money } from '@/lib/format'

/**
 * Accounts by bank, as a segmented list. One rule for every row: the row shows, its trailing
 * icon buttons act. Every row has "details" (the eye): an account, or a bank with all its
 * pockets as one. A bank with several pockets also has "show / hide the pockets".
 * The two actions keep their own column on every row (an empty place where a row has no
 * pockets to show), so the eyes and the amounts line up down the list.
 */
export interface AccountGroup {
  /** the account the pockets share: assets:bank */
  key: string
  label: string
  accounts: AccountView[]
  /** money kept for a person (no pockets can be added there) */
  kept?: boolean
}
/** `addable`: an "Add a pocket" row at the end of an unfolded bank */
const props = defineProps<{ groups: AccountGroup[]; collapsed?: boolean; addable?: boolean }>()
defineEmits<{ add: [bank: string] }>()

const L = useLedger()
/** what the user folded or unfolded; otherwise `collapsed` decides */
const toggled = reactive<Record<string, boolean>>({})
const isOpen = (key: string) => toggled[key] ?? !props.collapsed
const lines = (m: Map<string, Decimal>) => [...m].map(([c, q]) => money(q, c))
const total = (g: AccountGroup) => g.accounts.reduce((sum, a) => sum.plus(a.valueRef ?? ZERO), ZERO)
const to = (account: string) => `/accounts/${encodeURIComponent(account)}`
</script>

<template>
  <template v-for="g in groups" :key="g.key">
    <div v-if="g.accounts.length === 1" class="md-item flex items-center gap-3 py-2 pr-2!">
      <AccountIcon :icon="g.accounts[0].icon" :color="g.accounts[0].color" />
      <div class="flex-1 min-w-0 line-clamp-2 md-body-large">{{ g.accounts[0].label }}</div>
      <div class="text-right tabular md-label-large">
        <div v-for="line in lines(g.accounts[0].balance)" :key="line">{{ line }}</div>
        <div v-if="!g.accounts[0].balance.size" class="text-muted">0.00 {{ g.accounts[0].currency }}</div>
      </div>
      <UButton
        :to="to(g.accounts[0].name)"
        icon="material-symbols:visibility-outline-rounded"
        variant="ghost"
        color="neutral"
        square
        class="tap shrink-0"
        :aria-label="`Details of ${g.accounts[0].label}`"
      />
      <span class="tap w-10 shrink-0" aria-hidden="true" />
    </div>
    <div v-else>
      <div class="md-item flex items-center gap-3 py-2 pr-2!">
        <AccountIcon :icon="g.accounts[0].icon" :color="g.accounts[0].color" />
        <div class="flex-1 min-w-0">
          <div class="truncate md-body-large">{{ g.label }}</div>
          <div class="md-body-medium text-muted truncate">{{ g.accounts.length }} pockets</div>
        </div>
        <div class="text-right tabular md-label-large whitespace-nowrap">{{ money(total(g), L.refCurrency.value) }}</div>
        <UButton
          :to="to(g.key)"
          icon="material-symbols:visibility-outline-rounded"
          variant="ghost"
          color="neutral"
          square
          class="tap shrink-0"
          :aria-label="`Details of ${g.label}`"
        />
        <UButton
          :icon="isOpen(g.key) ? 'material-symbols:keyboard-arrow-up-rounded' : 'material-symbols:keyboard-arrow-down-rounded'"
          variant="soft"
          color="neutral"
          square
          class="tap shrink-0"
          :aria-expanded="isOpen(g.key)"
          :aria-controls="`pockets-${g.key}`"
          :aria-label="`${isOpen(g.key) ? 'Hide' : 'Show'} the pockets of ${g.label}`"
          @click="toggled[g.key] = !isOpen(g.key)"
        />
      </div>
      <div v-if="isOpen(g.key)" :id="`pockets-${g.key}`" class="pb-2">
        <div v-for="a in g.accounts" :key="a.name" class="md-item flex items-center gap-3 py-1 pl-16! pr-2!">
          <span class="flex-1 min-w-0 truncate md-body-medium">{{ a.label }}</span>
          <span class="tabular md-label-large">
            <template v-if="a.balance.size">{{ lines(a.balance).join(' · ') }}</template>
            <span v-else class="text-muted">0.00 {{ a.currency }}</span>
          </span>
          <UButton
            :to="to(a.name)"
            icon="material-symbols:visibility-outline-rounded"
            variant="ghost"
            color="neutral"
            square
            class="tap shrink-0"
            :aria-label="`Details of ${a.label}`"
          />
          <span class="tap w-10 shrink-0" aria-hidden="true" />
        </div>
        <button
          v-if="addable && !g.kept"
          type="button"
          class="md-item press flex w-full items-center gap-3 py-2 pl-16! text-primary md-label-large cursor-pointer"
          :aria-label="`Add a pocket to ${g.label}`"
          @click="$emit('add', g.key)"
        >
          <UIcon name="material-symbols:add-rounded" class="size-5" aria-hidden="true" />
          Add a pocket
        </button>
      </div>
    </div>
  </template>
</template>

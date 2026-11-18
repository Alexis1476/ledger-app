<script setup lang="ts">
import { computed, ref } from 'vue'
import { useToast } from '@nuxt/ui/composables'
import AccountIcon from '@/components/AccountIcon.vue'
import StatusBanner from '@/components/StatusBanner.vue'
import TxDetail from '@/components/TxDetail.vue'
import { usePageFab } from '@/composables/useFab'
import { useLedger } from '@/composables/useLedger'
import { ZERO } from '@/ledger/decimal'
import { items, removeItem, searchPurchases, setItem } from '@/ledger/inventory'
import type { Transaction } from '@/ledger/types'
import { money, shortDate } from '@/lib/format'
import { useJournalStore, ValidationError } from '@/stores/journal'

/**
 * Inventory: the things I own and what they cost. Search a purchase to add it; the purchase
 * stays an expense, its header gets `item:<name>`.
 */
const store = useJournalStore()
const L = useLedger()
const toast = useToast()
const refC = computed(() => L.refCurrency.value)
/** + = add a thing: it goes to the search of purchases */
const search = ref<{ inputRef?: HTMLInputElement } | null>(null)
usePageFab({ label: 'Add a thing', run: () => search.value?.inputRef?.focus() })
const isExpense = (a: string) => L.typeOf(a) === 'X'
const category = (tx: Transaction) => tx.postings.find((p) => isExpense(p.account))?.account ?? L.mainAccount(tx)

const all = computed(() => items(store.journal.transactions, isExpense, refC.value, store.prices))
const total = computed(() => all.value.reduce((s, i) => s.plus(i.cost), ZERO))

const query = ref('')
const results = computed(() => (query.value.trim().length < 2 ? [] : searchPurchases(store.journal.transactions, query.value, isExpense, refC.value, store.prices)))

const busy = ref(false)
async function save(old: Transaction, next: Transaction, title: string) {
  busy.value = true
  try {
    await store.replaceTransaction(old, next)
    toast.add({ title, description: next.tags.item ?? old.tags.item, icon: 'material-symbols:package-2-outline', color: 'success' })
    return true
  } catch (e) {
    const msg = e instanceof ValidationError ? e.issues.map((i) => i.message).join(' · ') : (e as Error).message
    toast.add({ title: 'Not saved', description: msg, color: 'error', icon: 'material-symbols:cancel-outline-rounded' })
    return false
  } finally {
    busy.value = false
  }
}
async function add(tx: Transaction) {
  if (await save(tx, setItem(tx, tx.payee ?? tx.note ?? ''), 'Added to the inventory')) query.value = ''
}

// tap an item: rename, see the purchase, remove
const open = ref<string>()
const name = ref('')
const key = (tx: Transaction) => `${tx.src?.file}:${tx.src?.startLine}`
function toggle(tx: Transaction, current: string) {
  open.value = open.value === key(tx) ? undefined : key(tx)
  name.value = current
}
async function rename(tx: Transaction) {
  if (await save(tx, setItem(tx, name.value), 'Saved')) open.value = undefined
}

const selected = ref<Transaction>()
const detailOpen = ref(false)
function showPurchase(tx: Transaction) {
  selected.value = tx
  detailOpen.value = true
}
</script>

<template>
  <UDashboardPanel id="inventory">
    <template #header>
      <UDashboardNavbar title="Inventory" :toggle="false" />
    </template>
    <template #body>
      <div class="stagger max-w-3xl w-full mx-auto space-y-4 pb-44 lg:pb-8">
        <StatusBanner />

        <UCard :ui="{ body: 'p-4 sm:p-5' }">
          <h2 class="text-sm text-muted">{{ all.length }} thing{{ all.length === 1 ? '' : 's' }} · what they cost</h2>
          <div class="text-2xl font-semibold tabular tracking-tight mt-0.5">{{ money(total, refC) }}</div>
        </UCard>

        <!-- Add: search a purchase -->
        <div class="relative">
          <UInput
            ref="search"
            v-model="query"
            size="xl"
            icon="material-symbols:search-rounded"
            placeholder="Add a thing: search your purchases"
            :ui="{ base: 'bg-(--md-sys-color-surface-container-high)' }"
            aria-label="Search your purchases"
            autocomplete="off"
            class="w-full"
          />
          <UCard v-if="results.length" class="mt-2" :ui="{ body: 'md-list' }">
            <ul aria-label="Purchases found">
              <li v-for="r in results" :key="key(r.tx)">
                <button
                  type="button"
                  class="md-item press w-full flex items-center gap-3 py-2 text-left cursor-pointer"
                  :disabled="busy"
                  :aria-label="`Add ${r.tx.payee ?? r.tx.note ?? r.tx.date} (${r.tx.date}) to the inventory`"
                  @click="add(r.tx)"
                >
                  <AccountIcon :icon="L.style(category(r.tx)).icon" :color="L.style(category(r.tx)).color" size="sm" />
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium">{{ r.tx.payee ?? r.tx.note ?? '—' }}</div>
                    <div class="text-xs text-muted truncate">{{ shortDate(r.tx.date) }} · {{ L.style(category(r.tx)).label }}</div>
                  </div>
                  <span class="tabular text-sm whitespace-nowrap">{{ money(r.cost, refC) }}</span>
                  <UIcon name="material-symbols:add-rounded" class="size-5 text-primary shrink-0" aria-hidden="true" />
                </button>
              </li>
            </ul>
          </UCard>
          <p v-else-if="query.trim().length >= 2" class="mt-2 px-1 text-sm text-muted">No purchase found.</p>
        </div>

        <!-- My things -->
        <UCard :ui="{ body: 'md-list' }">
          <div v-for="i in all" :key="key(i.tx)">
            <button
              type="button"
              class="md-item press w-full flex items-center gap-3 py-2.5 text-left cursor-pointer"
              :aria-expanded="open === key(i.tx)"
              @click="toggle(i.tx, i.name)"
            >
              <AccountIcon :icon="L.style(category(i.tx)).icon" :color="L.style(category(i.tx)).color" />
              <div class="min-w-0 flex-1">
                <div class="truncate font-medium">{{ i.name }}</div>
                <div class="text-xs text-muted truncate">{{ shortDate(i.date) }}</div>
              </div>
              <span class="tabular text-sm whitespace-nowrap">{{ money(i.cost, refC) }}</span>
            </button>
            <form v-if="open === key(i.tx)" class="grid grid-cols-2 gap-2 px-3 pb-3" @submit.prevent="rename(i.tx)">
              <UInput v-model="name" placeholder="Name" aria-label="Name" class="col-span-2" />
              <UButton variant="ghost" color="neutral" icon="material-symbols:receipt-long-outline-rounded" label="Purchase" class="justify-center" @click="showPurchase(i.tx)" />
              <UButton type="submit" label="Save" class="justify-center" :loading="busy" />
              <UButton
                variant="ghost"
                color="error"
                icon="material-symbols:delete-outline-rounded"
                label="Remove from inventory"
                class="col-span-2 justify-center"
                :disabled="busy"
                @click="save(i.tx, removeItem(i.tx), 'Removed from inventory')"
              />
            </form>
          </div>
          <p v-if="!all.length && store.hasData" class="px-3 py-4 text-sm text-muted">Nothing yet. Search a purchase above to add it.</p>
        </UCard>

        <p class="text-xs text-muted">The purchase stays a normal expense: it only gets the tag <code>item:</code>.</p>
      </div>
      <TxDetail v-model:open="detailOpen" :tx="selected" />
    </template>
  </UDashboardPanel>
</template>

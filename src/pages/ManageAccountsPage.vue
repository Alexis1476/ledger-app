<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ulid } from 'ulid'
import { useToast } from '@nuxt/ui/composables'
import AccountGroups from '@/components/AccountGroups.vue'
import StatusBanner from '@/components/StatusBanner.vue'
import { usePageFab } from '@/composables/useFab'
import { useLedger, type AccountView } from '@/composables/useLedger'
import { pocketAccount, slug } from '@/ledger/chart'
import { Decimal } from '@/ledger/decimal'
import type { Transaction } from '@/ledger/types'
import { currencyFlag, parseUserAmount, today } from '@/lib/format'
import { useJournalStore, ValidationError } from '@/stores/journal'

/**
 * My accounts (bank, card, cash): add one with its currency and today's balance, on its own (a new
 * bank) or as a pocket inside a bank (assets:neo:insurance). The name is stored as an account tag
 * (label:) in accounts.journal. Categories: the Chart of accounts page.
 */
const store = useJournalStore()
const L = useLedger()
const toast = useToast()
const busy = ref(false)
const errorText = (e: unknown) => (e instanceof ValidationError ? e.issues.map((i) => i.message).join(' · ') : (e as Error).message)

// ── Accounts ────────────────────────────────────────────────────────────
const currencies = computed(() => store.journal.commodities.map((c) => String(c.symbol)))
const currencyItems = computed(() => [...currencies.value.map((c) => ({ label: c, value: c, icon: currencyFlag(c) })), { label: 'Other…', value: 'other' }])
const NEW = '_new'
const acc = reactive({ open: false, bank: NEW, name: '', currency: store.config.referenceCurrency, other: '', balance: '' })
/** open the dialog, inside a bank or for a new one */
function openAdd(bank = NEW) {
  Object.assign(acc, { open: true, bank, name: '', other: '', balance: '' })
}
usePageFab({ label: 'Add an account', run: () => openAdd() })
/**
 * Banks a pocket can go into: my groups of accounts (assets:neo), not the money kept for people,
 * and not a group that is itself an account (assets:revolut with no pockets under it).
 */
const bankItems = computed(() => [
  { label: 'A new bank (on its own)', value: NEW },
  ...groups.value
    .filter((g) => !g.kept && !L.assetAccounts.value.some((a) => a.name === g.key))
    .map((g) => ({ label: g.label, value: g.key }))
])
const bankLabel = computed(() => (acc.bank === NEW ? '' : L.groupLabel(acc.bank)))
// a pocket takes the bank's currency by default
watch(
  () => acc.bank,
  (bank) => {
    const first = groups.value.find((g) => g.key === bank)?.accounts[0]?.currency
    if (first) acc.currency = first
  }
)
const accCurrency = computed(() => (acc.currency === 'other' ? acc.other.trim().toUpperCase() : acc.currency))
const accAccount = computed(() => (acc.bank === NEW ? pocketAccount(acc.name) : `${acc.bank}:${slug(acc.name) || 'pocket'}`))
/** the name shown everywhere: a pocket carries its bank's name ("Neo Insurance") */
const accLabel = computed(() => {
  const name = acc.name.trim()
  if (!bankLabel.value || name.toLowerCase().startsWith(bankLabel.value.toLowerCase())) return name
  return `${bankLabel.value} ${name}`
})
const accError = computed(() => {
  if (!acc.name.trim()) return ''
  if (store.journal.accounts.some((a) => a.name === accAccount.value)) return 'An account with this name already exists.'
  if (!/^[A-Z]{3}$/.test(accCurrency.value)) return 'Currency: three letters (e.g. GBP).'
  if (acc.balance.trim() && !parseUserAmount(acc.balance)) return 'Balance: a number (e.g. 1250.50).'
  return ''
})
async function addPocket() {
  if (!acc.name.trim() || accError.value) return
  busy.value = true
  try {
    const account = accAccount.value
    await store.addAccount(account, { type: 'C', currency: accCurrency.value, label: accLabel.value }, accCurrency.value)
    const q = acc.balance.trim() ? parseUserAmount(acc.balance) : undefined
    if (q && !q.isZero()) {
      const id = ulid()
      const tx: Transaction = {
        date: today(),
        status: '*',
        payee: 'Opening balance',
        note: accLabel.value,
        id,
        tags: { via: 'app', id },
        postings: [
          { account, amount: { qty: new Decimal(q), commodity: accCurrency.value }, tags: {} },
          { account: 'equity:opening', amount: { qty: new Decimal(q).neg(), commodity: accCurrency.value }, tags: {} }
        ]
      }
      await store.addTransaction(tx, { queueOffline: false })
    }
    toast.add({ title: 'Account added', description: accLabel.value, icon: 'material-symbols:account-balance-outline-rounded', color: 'success' })
    Object.assign(acc, { open: false, bank: NEW, name: '', other: '', balance: '' })
  } catch (e) {
    toast.add({ title: 'Not added', description: errorText(e), color: 'error', icon: 'material-symbols:cancel-outline-rounded' })
  } finally {
    busy.value = false
  }
}
/** every account, by bank (or by the person the money is kept for); mine first */
const groups = computed(() => {
  const map = new Map<string, AccountView[]>()
  for (const a of L.assetAccounts.value) {
    const key = a.name.split(':').slice(0, 2).join(':')
    map.set(key, [...(map.get(key) ?? []), a])
  }
  return [...map]
    .map(([key, accounts]) => ({ key, label: L.groupLabel(key), accounts, kept: accounts.every((a) => L.keptPockets.value.all.has(a.name)) }))
    .sort((a, b) => Number(a.kept) - Number(b.kept))
})
</script>

<template>
  <UDashboardPanel id="manage-accounts">
    <template #header>
      <UDashboardNavbar title="Accounts" :toggle="false" />
    </template>
    <template #body>
      <div class="stagger max-w-3xl w-full mx-auto space-y-4 pb-44 lg:pb-8">
        <StatusBanner />

        <UCard :ui="{ body: 'md-list' }">
          <template #header>
            <h2 class="text-sm font-semibold">Accounts ({{ L.assetAccounts.value.length }})</h2>
          </template>
          <!-- by bank (or by the person the money is kept for): a bank's pockets unfold under it -->
          <AccountGroups :groups="groups" collapsed addable @add="openAdd" />
        </UCard>
      </div>

      <!-- New account: a dialog with its own title and labelled fields -->
      <UModal v-model:open="acc.open" title="New account" description="A bank account, a card or cash in one currency, on its own or as a pocket inside one of your banks.">
        <template #body>
          <form class="space-y-4" @submit.prevent="addPocket">
            <UFormField label="Bank">
              <USelect v-model="acc.bank" size="xl" :items="bankItems" aria-label="Bank" class="w-full" />
            </UFormField>
            <UFormField label="Name" :help="acc.name.trim() && acc.bank !== NEW ? `Shown as ${accLabel}` : undefined">
              <UInput
                v-model="acc.name"
                size="xl"
                :placeholder="acc.bank === NEW ? 'e.g. Revolut EUR' : 'e.g. Insurance'"
                aria-label="Account name"
                class="w-full"
                autofocus
              />
            </UFormField>
            <div class="grid grid-cols-2 gap-3">
              <UFormField label="Currency">
                <USelect v-model="acc.currency" size="xl" :items="currencyItems" aria-label="Currency" class="w-full" />
              </UFormField>
              <UFormField v-if="acc.currency === 'other'" label="Code">
                <UInput v-model="acc.other" size="xl" placeholder="e.g. GBP" aria-label="Currency code" maxlength="3" class="w-full" />
              </UFormField>
            </div>
            <UFormField label="Balance today" hint="optional">
              <UInput v-model="acc.balance" size="xl" inputmode="decimal" placeholder="0.00" aria-label="Balance today" class="w-full" />
            </UFormField>
            <p v-if="accError" class="text-xs text-error">{{ accError }}</p>
            <div class="flex justify-end gap-2 pt-2">
              <UButton variant="ghost" label="Cancel" @click="acc.open = false" />
              <UButton type="submit" label="Add" icon="material-symbols:check-rounded" :loading="busy" :disabled="!acc.name.trim() || !!accError" />
            </div>
          </form>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ulid } from 'ulid'
import { useToast } from '@nuxt/ui/composables'
import { pocketAccount, setupFiles } from '@/ledger/chart'
import type { Backend } from '@/github/types'
import { currencyFlag, today } from '@/lib/format'

/**
 * First run on an empty data repository: choose the main currency and the accounts, then the
 * app writes every file of a new ledger (journals, categories, workflows) in the repository.
 */
const props = defineProps<{ backend: Backend; repo: string }>()
const emit = defineEmits<{ done: [] }>()
const toast = useToast()

const CURRENCIES = ['CHF', 'EUR', 'USD', 'GBP', 'CAD', 'COP', 'MXN', 'BRL', 'JPY']
const currencyItems = CURRENCIES.map((c) => ({ label: c, value: c, icon: currencyFlag(c) }))
const form = reactive({
  referenceCurrency: 'CHF',
  pockets: [
    { name: 'Bank', currency: 'CHF', balance: '' },
    { name: 'Cash', currency: 'CHF', balance: '' }
  ]
})
const busy = ref(false)
const error = ref<string>()

const duplicates = computed(() => {
  const seen = new Set<string>()
  return form.pockets.some((p) => {
    const a = pocketAccount(p.name)
    if (!p.name.trim()) return false
    if (seen.has(a)) return true
    seen.add(a)
    return false
  })
})
const badBalance = computed(() => form.pockets.some((p) => p.balance.trim() && !/^-?[\d' ]+([.,]\d{1,2})?$/.test(p.balance.trim())))
const canCreate = computed(() => form.pockets.some((p) => p.name.trim()) && !duplicates.value && !badBalance.value && !busy.value)

function add() {
  form.pockets.push({ name: '', currency: form.referenceCurrency, balance: '' })
}

async function create() {
  if (!canCreate.value) return
  busy.value = true
  error.value = undefined
  try {
    const files = setupFiles({ referenceCurrency: form.referenceCurrency, pockets: form.pockets, date: today(), openingId: ulid() })
    const r = await props.backend.initialize(files, 'setup: new ledger')
    toast.add({
      title: 'Your ledger is ready',
      description: r.workflows
        ? 'Files, categories and the hledger check are in the repository.'
        : 'Files and categories are in the repository. The hledger check was not installed: the token needs "Workflows: Read and write".',
      color: r.workflows ? 'success' : 'warning',
      icon: 'material-symbols:celebration-outline-rounded'
    })
    emit('done')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="material-symbols:auto-awesome-outline-rounded" class="size-5 text-primary" aria-hidden="true" />
        <h2 class="font-semibold">Set up {{ repo }}</h2>
      </div>
      <p class="text-sm text-muted mt-1">This repository has no ledger yet. Choose your currency and your accounts: the app creates every file.</p>
    </template>
    <form class="space-y-4" @submit.prevent="create">
      <UFormField label="Main currency" help="Totals and charts are shown in it.">
        <USelect v-model="form.referenceCurrency" :items="currencyItems" size="xl" class="w-44">
          <template #leading><UIcon :name="currencyFlag(form.referenceCurrency)" class="size-5" aria-hidden="true" /></template>
        </USelect>
      </UFormField>

      <div>
        <div class="text-sm font-medium mb-1">My accounts</div>
        <p class="text-xs text-muted mb-2">Bank accounts, cards, cash… with today's balance (optional). You can add more later.</p>
        <div v-for="(p, i) in form.pockets" :key="i" class="grid grid-cols-[1fr_6.5rem_7rem_auto] gap-2 mb-2">
          <UInput v-model="p.name" size="xl" placeholder="Name (e.g. Revolut EUR)" :aria-label="`Account ${i + 1} name`" class="min-w-0" />
          <USelect v-model="p.currency" :items="currencyItems" size="xl" :aria-label="`Account ${i + 1} currency`" />
          <UInput v-model="p.balance" size="xl" inputmode="decimal" placeholder="Balance" :aria-label="`Account ${i + 1} balance`" class="min-w-0" />
          <UButton icon="material-symbols:close-rounded" variant="ghost" color="neutral" :aria-label="`Remove account ${i + 1}`" @click="form.pockets.splice(i, 1)" />
        </div>
        <UButton size="sm" variant="soft" icon="material-symbols:add-rounded" label="Add an account" @click="add" />
        <p v-if="duplicates" class="text-xs text-error mt-1">Two accounts have the same name.</p>
        <p v-if="badBalance" class="text-xs text-error mt-1">A balance is not a number (e.g. 1250.50).</p>
      </div>

      <p class="text-xs text-muted">
        Also created: a standard list of categories (groceries, rent, transport…), the currencies, and two GitHub Actions: the
        <code>hledger check</code> on every save and the daily exchange rates (needs the token permission "Workflows: Read and
        write").
      </p>
      <UAlert v-if="error" color="error" variant="subtle" icon="material-symbols:cancel-outline-rounded" :description="error" />
      <UButton type="submit" icon="material-symbols:auto-fix-high" label="Create my ledger" :loading="busy" :disabled="!canCreate" />
    </form>
  </UCard>
</template>

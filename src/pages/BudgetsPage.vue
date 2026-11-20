<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useToast } from '@nuxt/ui/composables'
import AccountIcon from '@/components/AccountIcon.vue'
import BudgetBar from '@/components/BudgetBar.vue'
import StatusBanner from '@/components/StatusBanner.vue'
import { useBudgets } from '@/composables/useBudgets'
import { usePageFab } from '@/composables/useFab'
import { money, monthLabel, parseUserAmount } from '@/lib/format'
import { useJournalStore } from '@/stores/journal'

/**
 * Budgets: a monthly limit per expense category or group, and where each one stands this month
 * (or another month). Stored in app.config.json; the spending is read from the journal.
 */
const store = useJournalStore()
const B = useBudgets()
const toast = useToast()

const month = ref(B.thisMonth.value)
const monthItems = computed(() => B.monthItems.value.map((m) => ({ label: monthLabel(m), value: m })))
const S = computed(() => B.status(month.value))
const isNow = computed(() => month.value === B.thisMonth.value)
const STATE_TEXT = { ok: 'On track', ahead: 'Spending fast', over: 'Over budget' } as const

// ── New / edit ───────────────────────────────────────────────────────────
const form = reactive({ open: false, editing: '', key: '', amount: '' })
function openNew() {
  Object.assign(form, { open: true, editing: '', key: '', amount: '' })
}
function openEdit(key: string) {
  Object.assign(form, { open: true, editing: key, key, amount: B.budgets.value[key] ?? '' })
}
usePageFab({ label: 'New budget', run: openNew })
const amount = computed(() => parseUserAmount(form.amount))
const formError = computed(() => {
  if (!form.amount.trim()) return ''
  if (!amount.value || !amount.value.gt(0)) return 'Amount: a number above zero (e.g. 200).'
  if (!form.editing && B.budgets.value[form.key]) return 'This category already has a budget: tap it to change it.'
  return ''
})
const busy = ref(false)
async function save() {
  if (!form.key || !amount.value || formError.value) return
  busy.value = true
  try {
    await B.save(form.key, amount.value.toFixed(2))
    toast.add({ title: form.editing ? 'Budget saved' : 'Budget added', description: `${B.label(form.key)} · ${money(amount.value, B.refC.value)} per month`, icon: 'material-symbols:check-rounded', color: 'success' })
    form.open = false
  } catch (e) {
    toast.add({ title: 'Not saved', description: (e as Error).message, color: 'error', icon: 'material-symbols:cancel-outline-rounded' })
  } finally {
    busy.value = false
  }
}
async function remove() {
  busy.value = true
  try {
    await B.remove(form.editing)
    toast.add({ title: 'Budget removed', description: B.label(form.editing), icon: 'material-symbols:delete-outline-rounded', color: 'neutral' })
    form.open = false
  } catch (e) {
    toast.add({ title: 'Not removed', description: (e as Error).message, color: 'error', icon: 'material-symbols:cancel-outline-rounded' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="budgets">
    <template #header>
      <UDashboardNavbar title="Budgets" :toggle="false" />
    </template>

    <template #body>
      <div class="stagger max-w-3xl w-full mx-auto space-y-4 pb-44 lg:pb-8">
        <StatusBanner />

        <USelect v-model="month" :items="monthItems" size="lg" aria-label="Month" icon="material-symbols:calendar-month-outline-rounded" class="w-56" />

        <UCard v-if="!S.lines.length && store.hasData" :ui="{ body: 'p-6 text-center space-y-2' }">
          <UIcon name="material-symbols:savings-outline-rounded" class="size-10 text-primary mx-auto" />
          <p class="md-body-large">No budget yet</p>
          <p class="md-body-medium text-muted">Set a monthly limit on a category or a whole group, e.g. 200 CHF for Eating out.</p>
          <UButton label="New budget" icon="material-symbols:add-rounded" @click="openNew" />
        </UCard>

        <template v-else-if="S.lines.length">
          <!-- the month in one card -->
          <UCard class="hero" :ui="{ body: 'p-5 sm:p-6' }">
            <h2 class="text-sm font-medium opacity-80">{{ isNow ? 'Left this month' : `Left in ${monthLabel(month)}` }}</h2>
            <div class="md-display-small font-semibold tabular mt-1" :class="S.left.isNeg() ? 'text-error' : ''">{{ money(S.left, B.refC.value) }}</div>
            <p class="mt-1 text-sm opacity-80 tabular">{{ money(S.spent, B.refC.value) }} spent of {{ money(S.total, B.refC.value) }}</p>
            <BudgetBar class="mt-3" :ratio="S.total.gt(0) ? S.spent.div(S.total).toNumber() : 0" :state="S.spent.gt(S.total) ? 'over' : 'ok'" :elapsed="isNow ? S.elapsed : undefined" label="All budgets" />
          </UCard>

          <section aria-labelledby="budgets-h">
            <div class="px-1 pb-2">
              <h2 id="budgets-h" class="text-sm font-semibold">By category</h2>
              <p class="md-body-small text-muted">My own spending (not the money kept for people), in {{ B.refC.value }}. The mark is today.</p>
            </div>
            <UCard :ui="{ body: 'md-list' }">
              <button
                v-for="l in S.lines"
                :key="l.key"
                type="button"
                class="md-item press w-full flex items-center gap-3 py-3 text-left cursor-pointer"
                aria-haspopup="dialog"
                :aria-label="`${B.label(l.key)}: ${money(l.spent, B.refC.value)} of ${money(l.limit, B.refC.value)}`"
                @click="openEdit(l.key)"
              >
                <AccountIcon :icon="B.icon(l.key).icon" :color="B.icon(l.key).color" />
                <div class="min-w-0 flex-1">
                  <div class="flex items-baseline justify-between gap-2">
                    <span class="truncate md-body-large">{{ B.label(l.key) }}</span>
                    <span class="tabular md-label-large whitespace-nowrap" :class="l.state === 'over' ? 'text-error' : ''">
                      {{ l.left.isNeg() ? `${money(l.left.abs(), B.refC.value)} over` : `${money(l.left, B.refC.value)} left` }}
                    </span>
                  </div>
                  <BudgetBar class="mt-2" :ratio="l.ratio" :state="l.state" :elapsed="isNow ? S.elapsed : undefined" :label="B.label(l.key)" />
                  <div class="mt-1.5 flex items-center justify-between gap-2 md-body-small text-muted">
                    <span class="tabular">{{ money(l.spent, B.refC.value) }} of {{ money(l.limit, B.refC.value) }}</span>
                    <span :class="l.state === 'over' ? 'text-error' : l.state === 'ahead' ? 'text-warning' : ''">{{ STATE_TEXT[l.state] }}</span>
                  </div>
                </div>
              </button>
            </UCard>
          </section>
        </template>
      </div>

      <!-- New / edit a budget -->
      <UModal v-model:open="form.open" :title="form.editing ? 'Edit budget' : 'New budget'" :description="`A monthly limit, in ${B.refC.value}. A group counts all its categories.`">
        <template #body>
          <form class="space-y-4" @submit.prevent="save">
            <UFormField label="Category">
              <USelectMenu
                v-model="form.key"
                :items="B.categoryItems.value"
                value-key="value"
                size="xl"
                placeholder="Choose a category or a group"
                aria-label="Category"
                class="w-full"
                :disabled="!!form.editing"
              />
            </UFormField>
            <UFormField label="Per month">
              <UInput v-model="form.amount" size="xl" inputmode="decimal" placeholder="e.g. 200" aria-label="Per month" class="w-full">
                <template #trailing><span class="text-muted">{{ B.refC.value }}</span></template>
              </UInput>
            </UFormField>
            <p v-if="formError" class="text-xs text-error">{{ formError }}</p>
            <div class="flex items-center gap-2 pt-2">
              <UButton v-if="form.editing" variant="ghost" color="error" icon="material-symbols:delete-outline-rounded" label="Remove" :disabled="busy" @click="remove" />
              <div class="flex-1" />
              <UButton variant="ghost" label="Cancel" @click="form.open = false" />
              <UButton type="submit" label="Save" icon="material-symbols:check-rounded" :loading="busy" :disabled="!form.key || !amount || !!formError" />
            </div>
          </form>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>

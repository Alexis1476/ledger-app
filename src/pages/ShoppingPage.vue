<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import StatusBanner from '@/components/StatusBanner.vue'
import { usePageFab } from '@/composables/useFab'
import { useEntry } from '@/composables/useEntry'
import { splitInput } from '@/lists/shopping'
import { useJournalStore } from '@/stores/journal'
import { useShoppingStore } from '@/stores/shopping'

/**
 * Shopping list (lists/shopping.md in ledger-data): add what to buy, tick it in the shop, clear
 * the ticked ones, optionally record the expense. Changes are committed after a short pause.
 */
const store = useJournalStore()
const S = useShoppingStore()
const entry = useEntry()
const text = ref('')
const input = ref<{ inputRef?: HTMLInputElement } | null>(null)
usePageFab({ label: 'Add an item', run: () => input.value?.inputRef?.focus() })
const showBought = ref(true)

function add() {
  const t = splitInput(text.value)
  if (!t.length) return
  S.add(t)
  text.value = ''
  void nextTick(() => input.value?.inputRef?.focus())
}

const status = computed(() => {
  if (S.error) return { icon: 'material-symbols:error-outline-rounded', text: 'Not saved', cls: 'text-error' }
  if (S.offline) return { icon: 'material-symbols:cloud-off-outline-rounded', text: 'Offline · will sync', cls: 'text-warning' }
  if (S.saving || S.pending.length) return { icon: 'material-symbols:progress-activity', text: 'Saving…', cls: 'text-muted' }
  return { icon: 'material-symbols:cloud-done-outline-rounded', text: 'Saved', cls: 'text-muted' }
})

/** Groceries expense with the bought items in the note. */
function recordExpense() {
  entry.start('expense', {
    name: 'Shopping',
    kind: 'expense',
    category: 'expenses:food:groceries',
    note: S.bought.map((i) => i.text).join(', ').slice(0, 120)
  })
}

onMounted(() => void S.flush())
</script>

<template>
  <UDashboardPanel id="shopping">
    <template #header>
      <UDashboardNavbar title="Shopping list" :toggle="false">
        <template #right>
          <span class="inline-flex items-center gap-1 text-xs" :class="status.cls" role="status" :title="S.error">
            <UIcon :name="status.icon" class="size-4" :class="S.saving ? 'animate-spin' : ''" aria-hidden="true" />
            {{ status.text }}
          </span>
        </template>
      </UDashboardNavbar>
    </template>
    <template #body>
      <div class="stagger max-w-xl w-full mx-auto space-y-4 pb-44 lg:pb-8">
        <StatusBanner />

        <form class="flex gap-2" @submit.prevent="add">
          <UInput
            ref="input"
            v-model="text"
            size="xl"
            icon="material-symbols:add-rounded"
            placeholder="Add an item (or several: milk, bread)"
            aria-label="Add an item"
            autocomplete="off"
            enterkeyhint="done"
            class="flex-1 min-w-0"
          />
          <UButton type="submit" size="xl" label="Add" :disabled="!text.trim()" />
        </form>
        <p v-if="S.error" class="text-xs text-error">{{ S.error }}</p>

        <UCard :ui="{ body: 'md-list' }">
          <ul aria-label="To buy">
            <li v-for="i in S.toBuy" :key="i.text" class="md-item flex items-center gap-1 pr-1!">
              <button
                type="button"
                class="flex-1 min-w-0 flex items-center gap-4 min-h-14 text-left cursor-pointer md-body-large"
                role="checkbox"
                :aria-checked="false"
                @click="S.toggle(i.text, true)"
              >
                <span class="size-4.5 shrink-0 rounded-[2px] border-2 border-(--md-sys-color-on-surface-variant)" aria-hidden="true" />
                <span class="truncate">{{ i.text }}</span>
              </button>
              <UButton icon="material-symbols:close-rounded" variant="ghost" color="neutral" size="lg" :aria-label="`Remove ${i.text}`" @click="S.remove(i.text)" />
            </li>
          </ul>
          <p v-if="!S.toBuy.length && store.hasData" class="px-3 py-6 text-center text-sm text-muted">
            {{ S.bought.length ? 'Everything is in the cart.' : 'Nothing to buy. Add the first item above.' }}
          </p>
        </UCard>

        <UCard v-if="S.bought.length" :ui="{ body: 'md-list' }">
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <button type="button" class="press inline-flex items-center gap-1 text-sm font-semibold cursor-pointer" :aria-expanded="showBought" @click="showBought = !showBought">
                In the cart ({{ S.bought.length }})
                <UIcon :name="showBought ? 'material-symbols:keyboard-arrow-up-rounded' : 'material-symbols:keyboard-arrow-down-rounded'" class="size-4 text-muted" aria-hidden="true" />
              </button>
              <div class="flex gap-1">
                <UButton size="sm" class="tap" variant="ghost" color="neutral" icon="material-symbols:receipt-long-outline-rounded" label="Record expense" @click="recordExpense" />
                <UButton size="sm" class="tap" variant="ghost" color="neutral" icon="material-symbols:delete-outline-rounded" label="Clear" @click="S.clearDone()" />
              </div>
            </div>
          </template>
          <ul v-if="showBought" aria-label="In the cart">
            <li v-for="i in S.bought" :key="i.text" class="md-item flex">
              <button
                type="button"
                class="w-full flex items-center gap-4 min-h-14 text-left cursor-pointer text-muted md-body-large"
                role="checkbox"
                :aria-checked="true"
                @click="S.toggle(i.text, false)"
              >
                <span class="size-4.5 shrink-0 rounded-[2px] bg-primary text-(--md-sys-color-on-primary) inline-flex items-center justify-center" aria-hidden="true">
                  <UIcon name="material-symbols:check-rounded" class="size-4" />
                </span>
                <span class="truncate line-through">{{ i.text }}</span>
              </button>
            </li>
          </ul>
        </UCard>

        <p class="text-xs text-muted">Saved in <code>lists/shopping.md</code> in your data repository, synced between your devices.</p>
      </div>
    </template>
  </UDashboardPanel>
</template>

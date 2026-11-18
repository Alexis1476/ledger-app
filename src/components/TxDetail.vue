<script setup lang="ts">
import { computed, ref } from 'vue'
import { useToast } from '@nuxt/ui/composables'
import { useEntry } from '@/composables/useEntry'
import { useLedger } from '@/composables/useLedger'
import { reverse } from '@/ledger/reverse'
import type { Transaction } from '@/ledger/types'
import { dayLabel, money } from '@/lib/format'
import { useJournalStore } from '@/stores/journal'

const props = defineProps<{ tx?: Transaction }>()
const open = defineModel<boolean>('open', { default: false })

const L = useLedger()
const store = useJournalStore()
const toast = useToast()
const confirming = ref(false)
const busy = ref(false)

const entry = useEntry()
const canDelete = computed(() => !!props.tx?.src && !props.tx.src.file.startsWith('outbox'))
const pockets = computed(() => new Set(L.assetAccounts.value.map((a) => a.name)))
/** the form can rebuild this transaction exactly → it can be edited */
const editable = computed(() => (props.tx && canDelete.value ? reverse(props.tx, L.buildContext.value, (a) => pockets.value.has(a)) : undefined))

function edit() {
  if (!props.tx || !editable.value) return
  open.value = false
  entry.startEdit(props.tx, editable.value.kind)
}

async function remove() {
  if (!props.tx) return
  busy.value = true
  try {
    await store.deleteTransaction(props.tx)
    toast.add({ title: 'Transaction deleted', icon: 'material-symbols:delete-outline-rounded', color: 'neutral' })
    open.value = false
  } catch (e) {
    toast.add({ title: 'Delete failed', description: (e as Error).message, color: 'error' })
  } finally {
    busy.value = false
    confirming.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="tx?.payee ?? tx?.note ?? 'Transaction'" :description="tx ? `${dayLabel(tx.date)} ${tx.date.slice(0, 4)}${tx.note && tx.payee ? ' · ' + tx.note : ''}` : ''">
    <template #body>
      <div v-if="tx" class="space-y-4">
        <ul class="divide-y divide-default">
          <li v-for="(p, i) in tx.postings" :key="i" class="flex items-center justify-between gap-3 py-2 text-sm">
            <div class="min-w-0">
              <div class="truncate">{{ L.style(p.account).label }}</div>
              <div class="text-xs text-muted font-mono truncate">{{ p.account }}</div>
            </div>
            <div class="text-right tabular whitespace-nowrap">
              <div v-if="p.amount">{{ money(p.amount.qty, p.amount.commodity) }}</div>
              <div v-else class="text-muted">(implicit)</div>
              <div v-if="p.amount?.cost" class="text-xs text-muted">
                {{ p.amount.cost.kind === 'total' ? '@@' : '@' }} {{ money(p.amount.cost.qty, p.amount.cost.commodity) }}
              </div>
              <div v-if="p.assertion" class="text-xs text-muted">= {{ money(p.assertion.amount.qty, p.assertion.amount.commodity) }}</div>
            </div>
          </li>
        </ul>
        <div v-if="Object.keys(tx.tags).length" class="flex flex-wrap gap-1">
          <UBadge v-for="(v, k) in tx.tags" :key="k" variant="soft" color="neutral" size="sm" :label="v ? `${k}: ${v}` : String(k)" />
        </div>
        <p v-if="canDelete && !editable" class="text-xs text-muted">
          This entry has a shape the form cannot rebuild (e.g. several categories or a balance check): it can only be
          deleted here, or edited in a text editor.
        </p>
        <div v-if="tx.src">
          <div class="text-xs text-muted mb-1 font-mono">{{ tx.src.file }}:{{ tx.src.startLine }}</div>
          <pre class="text-xs bg-elevated rounded p-2 overflow-x-auto">{{ tx.src.raw }}</pre>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-between gap-2">
        <template v-if="canDelete">
          <UButton v-if="!confirming" color="error" variant="ghost" icon="material-symbols:delete-outline-rounded" label="Delete" @click="confirming = true" />
          <div v-else class="flex items-center gap-2">
            <span class="text-sm">Delete this transaction?</span>
            <UButton color="error" label="Yes, delete" :loading="busy" @click="remove" />
            <UButton variant="ghost" label="Cancel" @click="confirming = false" />
          </div>
        </template>
        <span v-else />
        <div v-if="!confirming" class="flex gap-2">
          <UButton v-if="editable" icon="material-symbols:edit-outline-rounded" label="Edit" @click="edit" />
          <UButton variant="soft" label="Close" @click="open = false" />
        </div>
      </div>
    </template>
  </UModal>
</template>

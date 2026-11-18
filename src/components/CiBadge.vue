<script setup lang="ts">
import { computed, ref } from 'vue'
import { useJournalStore } from '@/stores/journal'
import { useSyncStore } from '@/stores/sync'

const sync = useSyncStore()
const journal = useJournalStore()
const open = ref(false)

const failing = computed(() => {
  const loc = sync.last?.location
  if (!loc) return undefined
  return journal.journal.transactions.find(
    (t) => t.src && t.src.file === loc.file && loc.line >= t.src.startLine && loc.line <= t.src.endLine
  )
})
</script>

<template>
  <UBadge
    :color="sync.badge.color"
    variant="subtle"
    :icon="sync.badge.icon"
    :label="sync.badge.label"
    class="cursor-pointer"
    :ui="{ leadingIcon: sync.last?.state === 'pending' ? 'animate-spin' : '' }"
    @click="open = true"
  />
  <UModal v-model:open="open" title="Validation (hledger check)">
    <template #body>
      <div v-if="!sync.last" class="text-sm text-muted">Nothing committed from this device yet.</div>
      <div v-else class="space-y-3 text-sm">
        <div class="flex items-center gap-2">
          <UBadge :color="sync.badge.color" variant="subtle" :icon="sync.badge.icon" :label="sync.badge.label" />
          <span class="text-muted font-mono text-xs truncate">{{ sync.last.sha.slice(0, 12) }}</span>
        </div>
        <p>{{ sync.last.message }}</p>
        <p v-if="sync.last.location" class="font-mono text-xs">
          {{ sync.last.location.file }}:{{ sync.last.location.line }}<template v-if="sync.last.location.column">:{{ sync.last.location.column }}</template>
        </p>
        <pre v-if="failing" class="text-xs bg-elevated rounded p-2 overflow-x-auto">{{ failing.src?.raw }}</pre>
        <pre v-if="sync.last.log" class="text-xs bg-error/10 text-error rounded p-2 overflow-x-auto whitespace-pre-wrap">{{ sync.last.log }}</pre>
        <div class="flex gap-2">
          <UButton size="sm" variant="soft" icon="material-symbols:refresh-rounded" label="Check again" :loading="sync.polling" @click="sync.poll()" />
          <UButton v-if="sync.last.url" size="sm" variant="ghost" icon="material-symbols:open-in-new-rounded" label="Open run" :to="sync.last.url" target="_blank" />
        </div>
      </div>
    </template>
  </UModal>
</template>

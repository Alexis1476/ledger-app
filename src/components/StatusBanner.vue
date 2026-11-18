<script setup lang="ts">
import { computed } from 'vue'
import { useJournalStore } from '@/stores/journal'
import { useSettingsStore } from '@/stores/settings'
import { useSyncStore } from '@/stores/sync'

const journal = useJournalStore()
const settings = useSettingsStore()
const sync = useSyncStore()

const errors = computed(() => journal.journal.diagnostics.filter((d) => d.severity === 'error'))
</script>

<template>
  <div class="space-y-2">
    <UAlert
      v-if="!settings.configured && settings.loaded"
      color="primary"
      variant="subtle"
      icon="material-symbols:power-outline-rounded"
      title="Connect your ledger-data repository"
      description="Add a GitHub token (or use the local folder in dev mode) to load your journal."
      :actions="[{ label: 'Open settings', to: '/settings', color: 'primary', variant: 'solid' }]"
    />
    <UAlert
      v-if="sync.last?.state === 'failure'"
      color="error"
      variant="subtle"
      icon="material-symbols:cancel-outline-rounded"
      title="hledger check failed on the last commit"
      :description="sync.last.location ? `${sync.last.location.file}:${sync.last.location.line}` : sync.last.message"
    />
    <UAlert
      v-if="journal.error"
      :color="journal.offline ? 'warning' : 'error'"
      variant="subtle"
      :icon="journal.offline ? 'material-symbols:wifi-off-rounded' : 'material-symbols:warning-outline-rounded'"
      :title="journal.offline ? 'Offline: showing cached data' : 'Could not refresh'"
      :description="journal.error"
    />
    <UAlert
      v-if="journal.outbox.length"
      color="warning"
      variant="subtle"
      icon="material-symbols:inbox-outline-rounded"
      :title="`${journal.outbox.length} entr${journal.outbox.length === 1 ? 'y' : 'ies'} waiting to be sent`"
      :description="journal.outbox.find((o) => o.error)?.error ?? 'They will be committed when you are back online.'"
      :actions="[{ label: 'Retry now', onClick: () => journal.flushOutbox(), variant: 'soft', color: 'warning' }]"
    />
    <UAlert
      v-if="settings.daysToExpiry !== undefined && settings.daysToExpiry <= 30"
      color="warning"
      variant="subtle"
      icon="material-symbols:key-outline-rounded"
      :title="settings.daysToExpiry <= 0 ? 'GitHub token expired' : `GitHub token expires in ${settings.daysToExpiry} days`"
      :actions="[{ label: 'Renew', to: '/settings', variant: 'soft', color: 'warning' }]"
    />
    <UAlert
      v-if="errors.length"
      color="error"
      variant="subtle"
      icon="material-symbols:problem-outline-rounded"
      :title="`${errors.length} parse error${errors.length === 1 ? '' : 's'} in the journal`"
      :description="errors.slice(0, 3).map((e) => `${e.file}:${e.line} ${e.message}`).join(' · ')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { BudgetState } from '@/ledger/budgets'

/**
 * A budget's progress: a Material linear progress indicator (4dp track, rounded, 4dp gap before
 * the rest of the track). A tick shows how much of the month has gone by.
 */
const props = defineProps<{ ratio: number; state: BudgetState; elapsed?: number; label: string }>()
const pct = computed(() => Math.min(100, Math.max(0, props.ratio * 100)))
const color = computed(() => (props.state === 'over' ? 'var(--md-sys-color-error)' : props.state === 'ahead' ? 'var(--ui-warning)' : 'var(--md-sys-color-primary)'))
</script>

<template>
  <div class="relative h-1.5 w-full" role="progressbar" :aria-label="label" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(ratio * 100)">
    <div class="absolute inset-0 flex gap-1">
      <div class="h-full rounded-full transition-[width] duration-(--md-sys-motion-spring-default-spatial-duration) ease-(--md-sys-motion-spring-default-spatial)" :style="{ width: `${pct}%`, backgroundColor: color }" />
      <div v-if="pct < 100" class="h-full flex-1 rounded-full bg-(--md-sys-color-surface-container-highest)" />
    </div>
    <div
      v-if="elapsed !== undefined && elapsed < 1"
      class="absolute -top-0.5 h-2.5 w-0.5 rounded-full bg-(--md-sys-color-on-surface-variant)"
      :style="{ left: `calc(${elapsed * 100}% - 1px)` }"
      title="Today"
      aria-hidden="true"
    />
  </div>
</template>

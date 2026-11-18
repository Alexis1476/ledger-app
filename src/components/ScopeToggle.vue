<script setup lang="ts">
import { useScope } from '@/composables/useScope'

/**
 * "My money" (only my own pockets) / "All" (including the money kept for people).
 * A connected button group (Material 3 Expressive): 2dp apart, 8dp inner corners, full outer
 * corners; the selected button takes the full shape and the primary color.
 */
const scope = useScope()
const options = [
  { value: 'mine', label: 'My money', icon: 'material-symbols:person-outline-rounded' },
  { value: 'all', label: 'All', icon: 'material-symbols:group-outline-rounded' }
] as const
</script>

<template>
  <div role="radiogroup" aria-label="Show" class="inline-grid grid-cols-2 gap-0.5">
    <button
      v-for="(o, i) in options"
      :key="o.value"
      type="button"
      role="radio"
      :aria-checked="scope === o.value"
      class="inline-flex items-center justify-center gap-2 px-4 min-h-10 pointer-coarse:min-h-12 md-label-large cursor-pointer [-webkit-tap-highlight-color:transparent] transition-[border-radius,background-color,color] duration-(--md-sys-motion-spring-fast-spatial-duration) ease-(--md-sys-motion-spring-fast-spatial) active:rounded-(--md-sys-shape-corner-small)"
      :class="[
        scope === o.value
          ? 'rounded-full bg-primary text-(--md-sys-color-on-primary)'
          : 'bg-(--md-sys-color-surface-container-highest) text-(--md-sys-color-on-surface-variant) ' +
            (i === 0 ? 'rounded-l-full rounded-r-(--md-sys-shape-corner-small)' : 'rounded-r-full rounded-l-(--md-sys-shape-corner-small)')
      ]"
      @click="scope = o.value"
    >
      <UIcon :name="scope === o.value ? 'material-symbols:check-rounded' : o.icon" class="size-4.5" aria-hidden="true" />
      {{ o.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * The form of a chart (bars, lines, donut…): a small connected button group of icon buttons
 * (2dp apart, 8dp inner corners; the selected one takes the full shape and the primary color).
 */
const model = defineModel<string>({ required: true })
defineProps<{ types: readonly string[]; label: string }>()

const TYPES: Record<string, { icon: string; label: string }> = {
  bars: { icon: 'material-symbols:bar-chart-rounded', label: 'Bars' },
  donut: { icon: 'material-symbols:donut-large-rounded', label: 'Donut' },
  lines: { icon: 'material-symbols:show-chart-rounded', label: 'Lines' },
  area: { icon: 'material-symbols:area-chart-outline-rounded', label: 'Area' },
  stacked: { icon: 'material-symbols:stacked-bar-chart-rounded', label: 'Stacked bars' }
}
</script>

<template>
  <div role="radiogroup" :aria-label="`${label}: chart type`" class="inline-flex shrink-0 gap-0.5">
    <button
      v-for="(t, i) in types"
      :key="t"
      type="button"
      role="radio"
      :aria-checked="model === t"
      :aria-label="TYPES[t]?.label ?? t"
      :title="TYPES[t]?.label ?? t"
      class="inline-flex size-10 pointer-coarse:size-12 items-center justify-center cursor-pointer [-webkit-tap-highlight-color:transparent] transition-[border-radius,background-color,color] duration-(--md-sys-motion-spring-fast-spatial-duration) ease-(--md-sys-motion-spring-fast-spatial) active:rounded-(--md-sys-shape-corner-small)"
      :class="[
        model === t
          ? 'rounded-full bg-primary text-(--md-sys-color-on-primary)'
          : 'bg-(--md-sys-color-surface-container-highest) text-(--md-sys-color-on-surface-variant) ' +
            (i === 0 ? 'rounded-l-full rounded-r-(--md-sys-shape-corner-small)' : i === types.length - 1 ? 'rounded-r-full rounded-l-(--md-sys-shape-corner-small)' : 'rounded-(--md-sys-shape-corner-small)')
      ]"
      @click="model = t"
    >
      <UIcon :name="TYPES[t]?.icon ?? 'material-symbols:bar-chart-rounded'" class="size-5" aria-hidden="true" />
    </button>
  </div>
</template>

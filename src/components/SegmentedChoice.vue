<script setup lang="ts" generic="T extends string">
/**
 * One choice among a few: a connected button group (Material 3 Expressive). The buttons are
 * 2dp apart with 8dp inner corners; the selected one takes the full shape and the primary color.
 */
const model = defineModel<T>({ required: true })
defineProps<{ options: readonly { value: T; label: string; icon?: string }[]; label: string; block?: boolean }>()
</script>

<template>
  <div role="radiogroup" :aria-label="label" class="gap-0.5" :class="block ? 'grid w-full' : 'inline-grid'" :style="{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }">
    <button
      v-for="(o, i) in options"
      :key="o.value"
      type="button"
      role="radio"
      :aria-checked="model === o.value"
      class="inline-flex items-center justify-center gap-2 px-4 min-h-10 pointer-coarse:min-h-12 md-label-large cursor-pointer [-webkit-tap-highlight-color:transparent] transition-[border-radius,background-color,color] duration-(--md-sys-motion-spring-fast-spatial-duration) ease-(--md-sys-motion-spring-fast-spatial) active:rounded-(--md-sys-shape-corner-small)"
      :class="[
        model === o.value
          ? 'rounded-full bg-primary text-(--md-sys-color-on-primary)'
          : 'bg-(--md-sys-color-surface-container-highest) text-(--md-sys-color-on-surface-variant) ' +
            (i === 0 ? 'rounded-l-full rounded-r-(--md-sys-shape-corner-small)' : i === options.length - 1 ? 'rounded-r-full rounded-l-(--md-sys-shape-corner-small)' : 'rounded-(--md-sys-shape-corner-small)')
      ]"
      @click="model = o.value"
    >
      <UIcon v-if="model === o.value || o.icon" :name="model === o.value ? 'material-symbols:check-rounded' : o.icon!" class="size-4.5 shrink-0" aria-hidden="true" />
      <span class="truncate">{{ o.label }}</span>
    </button>
  </div>
</template>

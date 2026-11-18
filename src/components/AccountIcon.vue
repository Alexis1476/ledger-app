<script setup lang="ts">
import { materialIcon } from '@/lib/icons'

defineProps<{ icon: string; color: string; size?: 'sm' | 'md' | 'lg' }>()
</script>

<template>
  <span
    class="inline-flex items-center justify-center rounded-(--md-sys-shape-corner-medium) shrink-0"
    :class="size === 'sm' ? 'size-7' : size === 'lg' ? 'size-12' : 'size-9'"
    :style="{ backgroundColor: color + '26', color }"
  >
    <UIcon :name="materialIcon(icon)" :class="size === 'sm' ? 'size-4' : size === 'lg' ? 'size-6' : 'size-5'" />
  </span>
</template>

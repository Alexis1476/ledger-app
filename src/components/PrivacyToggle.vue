<script setup lang="ts">
import { usePrivacy } from '@/composables/usePrivacy'

/** Hide / show the amounts (an icon button that stays selected while they are hidden). */
const hidden = usePrivacy()
</script>

<template>
  <UButton
    :icon="hidden ? 'material-symbols:visibility-off-outline-rounded' : 'material-symbols:visibility-outline-rounded'"
    :variant="hidden ? 'soft' : 'ghost'"
    :color="hidden ? 'primary' : 'neutral'"
    size="lg"
    square
    class="tap"
    :aria-pressed="hidden"
    :aria-label="hidden ? 'Show amounts' : 'Hide amounts'"
    :title="hidden ? 'Show amounts' : 'Hide amounts'"
    @click="hidden = !hidden"
  />
</template>

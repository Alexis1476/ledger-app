<script setup lang="ts">
import { computed } from 'vue'
import { cssVar, useIsDark } from '@/composables/useDashboard'
import { Decimal } from '@/ledger/decimal'
import { money } from '@/lib/format'
import { animationOn, VChart } from './echarts'

/**
 * Parts of a whole: a few slices (the page folds the tail into "Other"), 2px apart, the total in
 * the middle. Each slice wears its category's own color; the list under the chart names them
 * with their amounts, in the same order (clockwise from the top).
 */
const props = defineProps<{ items: { name: string; value: Decimal; color: string }[]; total: Decimal; currency: string; label: string }>()
const dark = useIsDark()

const option = computed(() => {
  void dark.value // re-read the CSS variables when the color mode changes
  const surface = cssVar('--app-card')
  return {
    aria: { enabled: true },
    animation: animationOn(),
    animationDuration: 400,
    tooltip: {
      trigger: 'item',
      backgroundColor: surface,
      borderColor: cssVar('--ui-border'),
      textStyle: { color: cssVar('--ui-text') },
      formatter: (p: { name: string; value: number; percent: number }) => `${p.name}<br><b>${money(new Decimal(p.value), props.currency)}</b> · ${Math.round(p.percent)}%`
    },
    series: [
      {
        type: 'pie',
        radius: ['62%', '88%'],
        startAngle: 90,
        clockwise: true,
        avoidLabelOverlap: false,
        label: { show: false },
        labelLine: { show: false },
        itemStyle: { borderColor: surface, borderWidth: 2, borderRadius: 4 },
        emphasis: { scaleSize: 4 },
        data: props.items.map((x) => ({ name: x.name, value: x.value.toDecimalPlaces(2).toNumber(), itemStyle: { color: x.color } }))
      }
    ]
  }
})
</script>

<template>
  <div class="relative mx-auto size-52">
    <VChart :option="option" autoresize role="img" :aria-label="`${label}: ${items.map((x) => x.name).join(', ')}`" />
    <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
      <div class="md-body-small text-muted">Total</div>
      <div class="md-title-medium tabular">{{ money(total, currency, 0) }}</div>
    </div>
  </div>
</template>

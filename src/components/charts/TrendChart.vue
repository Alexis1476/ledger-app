<script setup lang="ts">
import { computed } from 'vue'
import { cssVar, useIsDark } from '@/composables/useDashboard'
import { Decimal } from '@/ledger/decimal'
import { money } from '@/lib/format'
import { animationOn, compact, monthTick, VChart } from './echarts'

/**
 * A few categories month by month, on one axis. Each series takes the next categorical slot,
 * in the order given (at most four); a series may bring its own color ("Other": a neutral). `lines`: 2px lines; `stacked`: bars stacked, 2px apart.
 * The legend with the totals is drawn by the page (the colors alone do not carry the names).
 */
const props = withDefaults(defineProps<{ months: string[]; series: { name: string; values: Decimal[]; color?: string }[]; currency: string; type?: 'lines' | 'stacked'; withYear?: boolean }>(), {
  type: 'lines'
})
const dark = useIsDark()

const option = computed(() => {
  void dark.value // re-read the CSS variables when the color mode changes
  const text = cssVar('--ui-text-muted')
  const surface = cssVar('--app-card')
  return {
    aria: { enabled: true },
    animation: animationOn(),
    animationDuration: 300,
    grid: { left: 8, right: 16, top: 12, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: props.type === 'stacked' ? 'shadow' : 'line', lineStyle: { color: cssVar('--ui-border-accented') } },
      backgroundColor: surface,
      borderColor: cssVar('--ui-border'),
      textStyle: { color: cssVar('--ui-text') },
      valueFormatter: (v: number) => money(new Decimal(v), props.currency)
    },
    xAxis: {
      type: 'category',
      boundaryGap: props.type === 'stacked',
      data: props.months.map((m) => monthTick(m, props.withYear)),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: cssVar('--app-grid') } },
      axisLabel: { color: text }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: cssVar('--app-grid') } },
      axisLabel: { color: text, formatter: compact }
    },
    series: props.series.map((s, i) => {
      const color = s.color ?? cssVar(`--app-series-${i + 1}`)
      const data = s.values.map((v) => v.toDecimalPlaces(2).toNumber())
      return props.type === 'stacked'
        ? { name: s.name, type: 'bar', stack: 'total', data, barMaxWidth: 22, itemStyle: { color, borderColor: surface, borderWidth: 1, borderRadius: 2 } }
        : { name: s.name, type: 'line', data, showSymbol: props.months.length <= 12, symbolSize: 8, lineStyle: { width: 2, color }, itemStyle: { color } }
    })
  }
})
</script>

<template>
  <!-- fixed height on a wrapper: vue-echarts' unlayered CSS sets height:100% on its element -->
  <div class="h-56 w-full">
    <VChart :option="option" autoresize role="img" :aria-label="`${series.map((s) => s.name).join(', ')} per month`" />
  </div>
</template>

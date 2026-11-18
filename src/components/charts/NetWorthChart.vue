<script setup lang="ts">
import { computed } from 'vue'
import type { NetWorthPoint } from '@/ledger/analytics'
import { cssVar, useIsDark } from '@/composables/useDashboard'
import { Decimal } from '@/ledger/decimal'
import { money } from '@/lib/format'
import { animationOn, compact, monthTick, VChart } from './echarts'

/**
 * Net worth at month ends: one series (no legend; the card title and hero number label it).
 * `area`: 2px line, 20% area. `bars`: one bar per month.
 */
const props = withDefaults(defineProps<{ points: NetWorthPoint[]; currency: string; name?: string; type?: 'area' | 'bars'; withYear?: boolean }>(), {
  name: 'Net worth',
  type: 'area'
})
const dark = useIsDark()

const option = computed(() => {
  void dark.value
  const color = cssVar('--app-series-1')
  const text = cssVar('--ui-text-muted')
  const data = props.points.map((p) => p.value.toDecimalPlaces(2).toNumber())
  return {
    aria: { enabled: true },
    animation: animationOn(),
    animationDuration: 300,
    grid: { left: 8, right: 16, top: 12, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: cssVar('--ui-border-accented') } },
      backgroundColor: cssVar('--app-card'),
      borderColor: cssVar('--ui-border'),
      textStyle: { color: cssVar('--ui-text') },
      valueFormatter: (v: number) => money(new Decimal(v), props.currency)
    },
    xAxis: {
      type: 'category',
      boundaryGap: props.type === 'bars',
      data: props.points.map((p) => monthTick(p.month, props.withYear)),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: cssVar('--app-grid') } },
      axisLabel: { color: text, interval: 'auto' }
    },
    yAxis: {
      type: 'value',
      // a filled area is read from its baseline: keep zero on the axis
      scale: false,
      splitLine: { lineStyle: { color: cssVar('--app-grid') } },
      axisLabel: { color: text, formatter: compact }
    },
    series: [
      props.type === 'bars'
        ? { name: props.name, type: 'bar', data, barMaxWidth: 18, itemStyle: { color, borderRadius: [4, 4, 0, 0] } }
        : {
            name: props.name,
            type: 'line',
            data,
            smooth: false,
            showSymbol: false,
            symbolSize: 8,
            lineStyle: { width: 2, color },
            itemStyle: { color },
            areaStyle: { color, opacity: 0.2 }
          }
    ]
  }
})
</script>

<template>
  <!-- fixed height on a wrapper: vue-echarts' unlayered CSS sets height:100% on its element -->
  <div class="h-44 w-full">
    <VChart :option="option" autoresize role="img" :aria-label="`${name} over the last ${points.length} months`" />
  </div>
</template>

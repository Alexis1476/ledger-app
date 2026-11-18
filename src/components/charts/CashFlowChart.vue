<script setup lang="ts">
import { computed } from 'vue'
import type { CashFlowRow } from '@/ledger/analytics'
import { cssVar, useIsDark } from '@/composables/useDashboard'
import { Decimal } from '@/ledger/decimal'
import { money } from '@/lib/format'
import { animationOn, compact, monthTick, VChart } from './echarts'

/** Income vs expenses per month: two categorical series (slot 1 blue, slot 2 orange), one axis. */
const props = withDefaults(defineProps<{ rows: CashFlowRow[]; currency: string; type?: 'bars' | 'lines'; withYear?: boolean; expensesOnly?: boolean }>(), { type: 'bars' })
const dark = useIsDark()

const option = computed(() => {
  void dark.value // re-read the CSS variables when the color mode changes
  const text = cssVar('--ui-text-muted')
  const series = [
    { name: 'Income', key: 'income' as const, color: cssVar('--app-series-1') },
    { name: 'Expenses', key: 'expenses' as const, color: cssVar('--app-series-2') }
  ].filter((s) => !props.expensesOnly || s.key === 'expenses')
  return {
    aria: { enabled: true },
    animation: animationOn(),
    animationDuration: 300,
    grid: { left: 8, right: 8, top: props.expensesOnly ? 12 : 36, bottom: 4, containLabel: true },
    legend: { show: !props.expensesOnly, top: 0, left: 0, itemWidth: 10, itemHeight: 10, icon: 'roundRect', textStyle: { color: cssVar('--ui-text') } },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: props.type === 'lines' ? 'line' : 'shadow' },
      backgroundColor: cssVar('--app-card'),
      borderColor: cssVar('--ui-border'),
      textStyle: { color: cssVar('--ui-text') },
      valueFormatter: (v: number) => money(new Decimal(v), props.currency)
    },
    xAxis: {
      type: 'category',
      boundaryGap: props.type !== 'lines',
      data: props.rows.map((r) => monthTick(r.month, props.withYear)),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: cssVar('--app-grid') } },
      axisLabel: { color: text }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: cssVar('--app-grid') } },
      axisLabel: { color: text, formatter: compact }
    },
    series: series.map((s) => {
      const data = props.rows.map((r) => r[s.key].toDecimalPlaces(2).toNumber())
      return props.type === 'lines'
        ? { name: s.name, type: 'line', data, showSymbol: props.rows.length <= 12, symbolSize: 8, lineStyle: { width: 2, color: s.color }, itemStyle: { color: s.color } }
        : { name: s.name, type: 'bar', barGap: '8%', barMaxWidth: 18, itemStyle: { color: s.color, borderRadius: [4, 4, 0, 0] }, data }
    })
  }
})
</script>

<template>
  <!-- fixed height on a wrapper: vue-echarts' unlayered CSS sets height:100% on its element -->
  <div class="h-56 w-full">
    <VChart :option="option" autoresize role="img" :aria-label="expensesOnly ? 'Spending per month' : 'Income and expenses per month'" />
  </div>
</template>

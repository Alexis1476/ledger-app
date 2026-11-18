// Tree-shaken ECharts: only what the dashboard uses. SVG renderer (< 1000 points per chart).
import 'vue-echarts/style.css'
import { use } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent, AriaComponent } from 'echarts/components'

use([SVGRenderer, BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, AriaComponent])

export { default as VChart } from 'vue-echarts'

/** Swiss compact format for axis labels: 1'200, 12k, 1.2M. */
export function compact(v: number): string {
  const a = Math.abs(v)
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (a >= 10_000) return `${Math.round(v / 1000)}k`
  return Math.round(v).toLocaleString('de-CH')
}

export function monthShort(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short' })
}

/** Axis label of a month: "Nov", or "Nov 26" when the chart spans more than a year. */
export function monthTick(ym: string, withYear = false): string {
  return withYear ? `${monthShort(ym)} ${ym.slice(2, 4)}` : monthShort(ym)
}

/** No chart animation when the user asked the OS for reduced motion. */
export function animationOn(): boolean {
  return !(typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
}

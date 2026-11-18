import { onUnmounted, shallowRef, watch, type ShallowRef } from 'vue'
import { Decimal } from '@/ledger/decimal'

/**
 * A displayed amount that rolls to its new value (display only: it always ends on the exact
 * value). Jumps straight to it when the user prefers reduced motion.
 */
export function useCountUp(source: () => Decimal, ms = 700): ShallowRef<Decimal> {
  const shown = shallowRef(source())
  let frame = 0
  const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  watch(source, (to) => {
    cancelAnimationFrame(frame)
    const from = shown.value
    if (still() || from.eq(to)) {
      shown.value = to
      return
    }
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      const eased = 1 - Math.pow(1 - t, 4) // fast start, long soft landing
      shown.value = t === 1 ? to : from.plus(to.minus(from).times(eased))
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
  })
  onUnmounted(() => cancelAnimationFrame(frame))
  return shown
}

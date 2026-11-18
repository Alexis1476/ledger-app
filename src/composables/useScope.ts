import { ref, watch } from 'vue'

/**
 * What the stats and lists show: "mine" = only transactions touching my own pockets (not the
 * pockets kept for people), "all" = everything. Remembered on this device only.
 */
export type Scope = 'mine' | 'all'
const KEY = 'ledger.scope'

function read(): Scope {
  try {
    return localStorage.getItem(KEY) === 'all' ? 'all' : 'mine'
  } catch {
    return 'mine'
  }
}

const scope = ref<Scope>(read())
watch(scope, (v) => {
  try {
    localStorage.setItem(KEY, v)
  } catch {
    // storage unavailable (private mode): the choice lasts for this session
  }
})

export function useScope() {
  return scope
}

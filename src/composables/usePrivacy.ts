import { ref, watch } from 'vue'

/**
 * Privacy mode: amounts and charts are blurred, to show the app to someone without showing the
 * money. A class on <html> does it (see main.css); remembered on this device only.
 */
const KEY = 'ledger.privacy'

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

const hidden = ref(read())
const apply = (on: boolean) => {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('privacy', on)
}
apply(hidden.value)
watch(hidden, (on) => {
  apply(on)
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // storage unavailable (private mode): the choice lasts for this session
  }
})

export function usePrivacy() {
  return hidden
}

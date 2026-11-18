import { onActivated, onBeforeUnmount, onMounted, shallowRef } from 'vue'

/**
 * The floating "+" button does what "adding" means on the page in front: a new loan on Loans,
 * a new account on Accounts… A page that says nothing gets the default: a new entry.
 */
export interface FabAction {
  /** what the button creates here, e.g. "New loan" (its label on desktop, its name for a screen reader) */
  label: string
  run: () => void
}

const current = shallowRef<FabAction>()

/** The action of the page in front, if it declared one. */
export function useFab() {
  return current
}

/** Call in a page's setup: the "+" button runs this while the page is shown. */
export function usePageFab(action: FabAction) {
  const set = () => (current.value = action)
  onMounted(set)
  onActivated(set)
  // the next page may already have set its own action: only clear ours
  onBeforeUnmount(() => {
    if (current.value === action) current.value = undefined
  })
}

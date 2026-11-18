import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { BackendError } from '@/github/types'
import { applyOp, describeOps, formatList, items, parseList, SHOPPING_FILE, type ListOp } from '@/lists/shopping'
import { prefs } from '@/offline/db'
import { useJournalStore } from './journal'

const PENDING_KEY = 'shopping:pending'
const DELAY_MS = 1500

/**
 * The shopping list (lists/shopping.md in ledger-data). Changes show at once and are committed
 * together after a short pause; offline they wait on this device and are sent later.
 */
export const useShoppingStore = defineStore('shopping', () => {
  const journal = useJournalStore()
  const pending = ref<ListOp[]>(prefs.get<ListOp[]>(PENDING_KEY, []))
  const saving = ref(false)
  const error = ref<string>()
  const offline = ref(false)

  const list = computed(() => pending.value.reduce(applyOp, parseList(journal.files[SHOPPING_FILE]?.text)))
  const all = computed(() => items(list.value))
  const toBuy = computed(() => all.value.filter((i) => !i.done))
  const bought = computed(() => all.value.filter((i) => i.done))

  let timer: ReturnType<typeof setTimeout> | undefined
  function persist() {
    prefs.set(PENDING_KEY, pending.value)
  }
  function schedule(ms = DELAY_MS) {
    clearTimeout(timer)
    timer = setTimeout(() => void flush(), ms)
  }

  function act(...ops: ListOp[]) {
    pending.value = [...pending.value, ...ops]
    persist()
    schedule()
  }

  async function flush() {
    if (saving.value || !pending.value.length || !journal.hasData) return
    saving.value = true
    const ops = [...pending.value]
    try {
      await journal.saveFile(SHOPPING_FILE, (text) => formatList(ops.reduce(applyOp, parseList(text))), describeOps(ops))
      pending.value = pending.value.slice(ops.length)
      persist()
      error.value = undefined
      offline.value = false
    } catch (e) {
      offline.value = e instanceof BackendError && !!e.network
      error.value = offline.value ? undefined : (e as Error).message
    } finally {
      saving.value = false
    }
    if (pending.value.length && !offline.value && !error.value) schedule(200)
  }

  if (typeof window !== 'undefined') window.addEventListener('online', () => void flush())

  return {
    list,
    all,
    toBuy,
    bought,
    pending,
    saving,
    error,
    offline,
    flush,
    add: (texts: string[]) => act(...texts.map((text) => ({ op: 'add' as const, text }))),
    toggle: (text: string, done: boolean) => act({ op: 'toggle', text, done }),
    remove: (text: string) => act({ op: 'remove', text }),
    clearDone: () => act({ op: 'clearDone' })
  }
})

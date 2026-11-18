import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { parseLogLocation } from '@/github/types'
import { db, type LastCommit } from '@/offline/db'
import { useJournalStore } from './journal'

const POLL_MS = 5_000
const POLL_MAX_MS = 90_000

/** CI status of the last commit made by the app (validation layer 3). */
export const useSyncStore = defineStore('sync', () => {
  const last = ref<LastCommit>()
  const polling = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  async function load() {
    last.value = await db.getLastCommit()
    if (last.value && (last.value.state === 'pending' || last.value.state === 'unknown')) void poll(true)
  }

  function track(sha: string, message: string) {
    last.value = { sha, message, at: new Date().toISOString(), state: 'pending' }
    void db.setLastCommit(last.value)
    void poll()
  }

  async function checkOnce() {
    if (!last.value) return
    const journal = useJournalStore()
    try {
      const s = await journal.api().ciStatus(last.value.sha)
      const location = s.log ? parseLogLocation(s.log, Object.keys(journal.files)) : s.location
      last.value = { ...last.value, ...s, location }
      await db.setLastCommit(last.value)
    } catch {
      /* offline or no permission: keep the previous state */
    }
  }

  async function poll(once = false) {
    if (timer) clearTimeout(timer)
    polling.value = true
    const started = Date.now()
    const step = async () => {
      await checkOnce()
      if (last.value?.state === 'pending' && !once && Date.now() - started < POLL_MAX_MS) {
        timer = setTimeout(step, POLL_MS)
      } else {
        polling.value = false
      }
    }
    await step()
  }

  const badge = computed<{ color: 'success' | 'warning' | 'error' | 'neutral'; label: string; icon: string }>(() => {
    switch (last.value?.state) {
      case 'success':
        return { color: 'success', label: 'Check passed', icon: 'material-symbols:check-circle-outline-rounded' }
      case 'pending':
        return { color: 'warning', label: 'Checking…', icon: 'material-symbols:progress-activity' }
      case 'failure':
        return { color: 'error', label: 'Check failed', icon: 'material-symbols:cancel-outline-rounded' }
      case 'unknown':
        return { color: 'neutral', label: 'Check unavailable', icon: 'material-symbols:help-outline-rounded' }
      default:
        return { color: 'neutral', label: 'Nothing saved yet', icon: 'material-symbols:pending-outline-rounded' }
    }
  })

  return { last, polling, load, track, poll, badge }
})

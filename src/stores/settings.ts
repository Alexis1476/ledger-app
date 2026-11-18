import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { GitHubBackend } from '@/github/client'
import { LocalBackend } from '@/github/local'
import type { Backend } from '@/github/types'
import { db, emptySettings, type Settings } from '@/offline/db'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>({ ...emptySettings })
  const loaded = ref(false)

  async function load() {
    settings.value = await db.getSettings()
    loaded.value = true
  }

  async function save(s: Settings) {
    settings.value = { ...s }
    await db.setSettings(settings.value)
  }

  const configured = computed(() => {
    const s = settings.value
    if (s.mode === 'local') return true
    return s.mode === 'github' && !!s.token && !!s.owner && !!s.repo && !!s.branch
  })

  /** identity of the data source, used to invalidate the cache when it changes */
  const source = computed(() => {
    const s = settings.value
    return s.mode === 'local' ? 'local' : `github:${s.owner}/${s.repo}@${s.branch}`
  })

  const daysToExpiry = computed(() => {
    const e = settings.value.tokenExpiry
    if (settings.value.mode !== 'github' || !e) return undefined
    return Math.ceil((new Date(e + 'T00:00:00').getTime() - Date.now()) / 86_400_000)
  })

  function makeBackend(s: Settings = settings.value): Backend {
    if (s.mode === 'local') return new LocalBackend()
    return new GitHubBackend({ token: s.token.trim(), owner: s.owner.trim(), repo: s.repo.trim(), branch: s.branch.trim() || 'main' })
  }

  return { settings, loaded, load, save, configured, source, daysToExpiry, makeBackend }
})

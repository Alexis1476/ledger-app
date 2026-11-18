<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from '@nuxt/ui/composables'
import { ENTRY_KINDS, useEntry, type EntryKind } from '@/composables/useEntry'
import SegmentedChoice from '@/components/SegmentedChoice.vue'
import SetupLedger from '@/components/SetupLedger.vue'
import { localBackendAvailable } from '@/github/local'
import type { Backend } from '@/github/types'
import type { Settings } from '@/offline/db'
import { useJournalStore } from '@/stores/journal'
import { useSettingsStore } from '@/stores/settings'

const settings = useSettingsStore()
const journal = useJournalStore()
const entry = useEntry()
const toast = useToast()
const router = useRouter()

const form = reactive<Settings>({ ...settings.settings })
const local = ref<{ dir: string }>()
const testing = ref(false)
const error = ref<string>()
const showToken = ref(false)

onMounted(async () => {
  if (!settings.loaded) await settings.load()
  Object.assign(form, settings.settings)
  local.value = await localBackendAvailable()
  if (!form.mode) form.mode = local.value ? 'local' : 'github'
})

/** a connected repository without a ledger yet: offer to create it */
const setup = ref<Backend>()

/** what is missing before trying GitHub (instead of a network error) */
const missing = () => {
  if (form.mode !== 'github') return ''
  if (!form.token?.trim()) return 'Paste your access token (step 2 above).'
  if (!form.owner?.trim()) return 'Enter your GitHub user name in Owner.'
  if (!form.repo?.trim()) return 'Enter the name of your repository.'
  return ''
}

async function connect() {
  error.value = missing() || undefined
  setup.value = undefined
  if (error.value) return
  testing.value = true
  try {
    const b = settings.makeBackend(form)
    if ((await b.repoState()) !== 'ready') {
      await settings.save(form)
      setup.value = b
      return
    }
    await b.verify()
    const changed = settings.source !== (form.mode === 'local' ? 'local' : `github:${form.owner}/${form.repo}@${form.branch}`)
    await settings.save(form)
    journal.resetBackend()
    if (changed) await journal.reload()
    else await journal.refresh()
    toast.add({ title: 'Connected', description: `${journal.journal.transactions.length} transactions loaded`, color: 'success', icon: 'material-symbols:electrical-services-rounded' })
    void router.push('/')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    testing.value = false
  }
}

async function afterSetup() {
  setup.value = undefined
  journal.resetBackend()
  await journal.reload()
  void router.push('/')
}

async function disconnect() {
  await settings.save({ ...form, token: '', mode: '' })
  await journal.reload()
  Object.assign(form, settings.settings)
}

const stats = computed(() => ({
  files: journal.journal.files.length,
  transactions: journal.journal.transactions.length,
  accounts: journal.journal.accounts.length,
  prices: journal.journal.prices.length
}))
</script>

<template>
  <UDashboardPanel id="settings">
    <template #header>
      <UDashboardNavbar title="Settings" :toggle="false">
        <template #right><UColorModeButton /></template>
      </UDashboardNavbar>
    </template>
    <template #body>
      <div class="stagger max-w-xl w-full mx-auto space-y-5 pb-44 lg:pb-6">
        <!-- first visit: what the app needs, in three steps -->
        <UCard v-if="!settings.configured && form.mode === 'github'" :ui="{ body: 'p-4 sm:p-5' }">
          <h2 class="md-title-medium">Get started</h2>
          <p class="md-body-medium text-muted mt-1">
            Your data stays in your own private GitHub repository, as plain text files. The app only reads and writes them.
          </p>
          <ol class="mt-4 space-y-3">
            <li class="flex gap-3">
              <span class="size-7 shrink-0 rounded-full bg-(--md-sys-color-secondary-container) text-(--md-sys-color-on-secondary-container) inline-flex items-center justify-center md-label-large">1</span>
              <div class="md-body-medium">
                Create an empty <b>private</b> repository, for example <code>ledger-data</code> (no README).
                <a href="https://github.com/new" target="_blank" rel="noopener" class="text-primary underline">Open GitHub</a>
              </div>
            </li>
            <li class="flex gap-3">
              <span class="size-7 shrink-0 rounded-full bg-(--md-sys-color-secondary-container) text-(--md-sys-color-on-secondary-container) inline-flex items-center justify-center md-label-large">2</span>
              <div class="md-body-medium">
                Create a fine-grained token for <b>only that repository</b>, with Contents: read and write, Actions: read and Workflows: read
                and write.
                <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener" class="text-primary underline">Create the token</a>
              </div>
            </li>
            <li class="flex gap-3">
              <span class="size-7 shrink-0 rounded-full bg-(--md-sys-color-secondary-container) text-(--md-sys-color-on-secondary-container) inline-flex items-center justify-center md-label-large">3</span>
              <div class="md-body-medium">Paste the token, your user name and the repository name below, then <b>Connect &amp; load</b>. The app then sets up your ledger.</div>
            </li>
          </ol>
        </UCard>

        <!-- Data source: where the ledger lives, and the connection to it -->
        <UCard :ui="{ body: 'p-4 sm:p-5' }">
          <div class="flex items-start gap-3">
            <span class="size-10 shrink-0 rounded-(--md-sys-shape-corner-medium) bg-(--md-sys-color-primary-container) text-(--md-sys-color-on-primary-container) inline-flex items-center justify-center" aria-hidden="true">
              <UIcon name="material-symbols:database-outline" class="size-6" />
            </span>
            <div class="min-w-0">
              <h2 class="md-title-medium">Data source</h2>
              <p class="md-body-medium text-muted">Where your data lives: your private <code>ledger-data</code> repository.</p>
            </div>
          </div>

          <!-- connected: what to, and until when -->
          <div v-if="settings.configured" class="mt-4 flex items-center gap-3 rounded-(--md-sys-shape-corner-large) bg-(--md-sys-color-surface-container) px-4 py-3">
            <UIcon name="material-symbols:cloud-done-outline-rounded" class="size-6 shrink-0 text-success" aria-hidden="true" />
            <div class="min-w-0 flex-1">
              <div class="md-body-large">Connected</div>
              <div class="md-body-medium text-muted truncate">
                {{ settings.settings.mode === 'local' ? 'Local folder' : `${settings.settings.owner}/${settings.settings.repo} · ${settings.settings.branch || 'main'}` }}
              </div>
            </div>
            <UBadge
              v-if="settings.daysToExpiry !== undefined"
              :color="settings.daysToExpiry <= 14 ? 'warning' : 'neutral'"
              variant="soft"
              :label="settings.daysToExpiry < 0 ? 'Token expired' : `Token: ${settings.daysToExpiry} days`"
            />
          </div>

          <form class="mt-4 space-y-4" @submit.prevent="connect">
            <!-- the choice only exists on the dev server -->
            <UFormField v-if="local" label="Source">
              <SegmentedChoice
                v-model="form.mode"
                :options="[
                  { value: 'github', label: 'GitHub', icon: 'material-symbols:cloud-outline-rounded' },
                  { value: 'local', label: 'Local folder', icon: 'material-symbols:folder-outline-rounded' }
                ]"
                label="Source"
                block
              />
            </UFormField>

            <template v-if="form.mode === 'github'">
              <UFormField
                label="Access token"
                help="A fine-grained token for this repository only: Contents read and write, Actions read; for the first setup also Workflows read and write."
              >
                <UInput
                  v-model="form.token"
                  :type="showToken ? 'text' : 'password'"
                  size="xl"
                  placeholder="github_pat_…"
                  aria-label="Access token"
                  class="w-full"
                  autocomplete="off"
                  spellcheck="false"
                >
                  <template #trailing>
                    <UButton
                      variant="ghost"
                      color="neutral"
                      size="sm"
                      square
                      :icon="showToken ? 'material-symbols:visibility-off-outline-rounded' : 'material-symbols:visibility-outline-rounded'"
                      :aria-label="showToken ? 'Hide token' : 'Show token'"
                      @click="showToken = !showToken"
                    />
                  </template>
                </UInput>
              </UFormField>
              <UFormField label="Owner">
                <UInput v-model="form.owner" size="xl" placeholder="your GitHub user name" aria-label="Owner" class="w-full" autocomplete="off" spellcheck="false" />
              </UFormField>
              <UFormField label="Repository">
                <UInput v-model="form.repo" size="xl" placeholder="e.g. ledger-data" aria-label="Repository" class="w-full" autocomplete="off" spellcheck="false" />
              </UFormField>
              <div class="grid grid-cols-2 gap-3">
                <UFormField label="Branch">
                  <UInput v-model="form.branch" size="xl" placeholder="main" aria-label="Branch" class="w-full" autocomplete="off" spellcheck="false" />
                </UFormField>
                <UFormField label="Token expires on">
                  <UInput v-model="form.tokenExpiry" type="date" size="xl" aria-label="Token expires on" class="w-full" />
                </UFormField>
              </div>
            </template>
            <div v-else-if="form.mode === 'local'" class="flex gap-3 rounded-(--md-sys-shape-corner-large) bg-(--md-sys-color-secondary-container) text-(--md-sys-color-on-secondary-container) p-4">
              <UIcon name="material-symbols:folder-outline-rounded" class="size-6 shrink-0" aria-hidden="true" />
              <div class="min-w-0">
                <div class="md-title-small">Local folder (development only)</div>
                <p class="md-body-medium mt-0.5">Reads and writes a folder on this computer; validation runs the real hledger check.</p>
                <p class="md-body-small font-mono mt-1 break-all opacity-80">{{ local?.dir }}</p>
              </div>
            </div>

            <div v-if="error" role="alert" class="flex gap-3 rounded-(--md-sys-shape-corner-large) bg-(--md-sys-color-error-container) text-(--md-sys-color-on-error-container) p-4">
              <UIcon name="material-symbols:warning-outline-rounded" class="size-6 shrink-0" aria-hidden="true" />
              <p class="md-body-medium">{{ error }}</p>
            </div>

            <div class="flex flex-wrap items-center justify-end gap-2 pt-1">
              <UButton
                v-if="settings.configured"
                variant="ghost"
                color="neutral"
                icon="material-symbols:link-off-rounded"
                label="Disconnect"
                @click="disconnect"
              />
              <UButton type="submit" :loading="testing" icon="material-symbols:electrical-services-rounded" label="Connect & load" />
            </div>
          </form>
        </UCard>
        <SetupLedger v-if="setup" :backend="setup" :repo="form.mode === 'local' ? 'the local folder' : `${form.owner}/${form.repo}`" @done="afterSetup" />

        <UCard v-if="journal.hasData">
          <template #header><div class="font-semibold">Journal</div></template>
          <dl class="grid grid-cols-2 gap-y-1 text-sm">
            <dt class="text-muted">Files</dt><dd class="tabular">{{ stats.files }}</dd>
            <dt class="text-muted">Transactions</dt><dd class="tabular">{{ stats.transactions }}</dd>
            <dt class="text-muted">Accounts</dt><dd class="tabular">{{ stats.accounts }}</dd>
            <dt class="text-muted">Exchange rates</dt><dd class="tabular">{{ stats.prices }}</dd>
            <dt class="text-muted">Last sync</dt><dd>{{ journal.syncedAt ? new Date(journal.syncedAt).toLocaleString() : '—' }}</dd>
          </dl>
          <ul v-if="journal.warnings.length" class="mt-3 text-xs text-warning list-disc pl-4">
            <li v-for="w in journal.warnings" :key="w">{{ w }}</li>
          </ul>
          <div class="mt-3 flex gap-2">
            <UButton size="sm" class="tap" variant="soft" icon="material-symbols:refresh-rounded" label="Refresh" :loading="journal.state === 'loading'" @click="journal.refresh().catch(() => {})" />
            <UButton size="sm" class="tap" variant="ghost" color="neutral" icon="material-symbols:database-outline" label="Clear cache & reload" @click="journal.reload()" />
          </div>
        </UCard>

        <UCard v-if="journal.config.templates.length">
          <template #header><div class="font-semibold">Templates</div></template>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="t in journal.config.templates"
              :key="t.name"
              size="sm"
              class="tap"
              variant="soft"
              :label="t.name"
              @click="entry.start(ENTRY_KINDS.includes(t.kind as EntryKind) ? (t.kind as EntryKind) : 'expense', t)"
            />
          </div>
        </UCard>

        <UCard v-if="journal.outbox.length">
          <template #header><div class="font-semibold">Outbox</div></template>
          <div v-for="o in journal.outbox" :key="o.id" class="space-y-1 mb-3">
            <pre class="text-[11px] bg-elevated rounded p-2 overflow-x-auto">{{ o.text }}</pre>
            <div v-if="o.error" class="text-xs text-error">{{ o.error }}</div>
            <UButton size="sm" class="tap" variant="ghost" color="error" label="Discard" @click="journal.discardOutboxItem(o.id)" />
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>

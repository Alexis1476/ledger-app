<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { NavigationMenuItem } from '@nuxt/ui'
import { navColor, navGroups } from '@/lib/nav'
import { useLedger } from '@/composables/useLedger'
import EntryDrawer from '@/components/EntryDrawer.vue'
import BottomNav from '@/components/BottomNav.vue'
import CiBadge from '@/components/CiBadge.vue'
import PrivacyToggle from '@/components/PrivacyToggle.vue'
import { ENTRY_KINDS, useEntry, type EntryKind } from '@/composables/useEntry'
import { useFab } from '@/composables/useFab'
import { useJournalStore } from '@/stores/journal'
import { useSettingsStore } from '@/stores/settings'
import { useSyncStore } from '@/stores/sync'

const settings = useSettingsStore()
const journal = useJournalStore()
const sync = useSyncStore()
const entry = useEntry()
const fab = useFab()
const route = useRoute()
const router = useRouter()

/** the shared menu: one group per section (separators), each icon in its own color */
const L = useLedger()
const nav = computed<NavigationMenuItem[][]>(() =>
  navGroups(L.keptPockets.value.all.size > 0).map((g) =>
    g.items.map((i) => ({ label: i.label, icon: i.icon, to: i.to, ui: { linkLeadingIcon: navColor(i.key) } }))
  )
)

// manifest shortcuts open the drawer with ?new=<kind>
watch(
  () => route.query.new,
  (k) => {
    if (typeof k === 'string' && (ENTRY_KINDS as string[]).includes(k)) {
      entry.start(k as EntryKind)
      void router.replace({ query: { ...route.query, new: undefined } })
    }
  },
  { immediate: true }
)

function onOnline() {
  void journal.refresh().then(() => journal.flushOutbox()).catch(() => {})
}

onMounted(async () => {
  await settings.load()
  await sync.load()
  await journal.init()
  if (!settings.configured && route.name !== 'settings') void router.push('/settings')
  window.addEventListener('online', onOnline)
})
onUnmounted(() => window.removeEventListener('online', onOnline))
</script>

<template>
  <!-- snackbars: at the bottom, above the navigation bar on a phone -->
  <UApp :toaster="{ position: 'bottom-center', progress: false, ui: { viewport: 'max-lg:bottom-22!' } }">
    <UDashboardGroup unit="rem" storage="local">
      <UDashboardSidebar
        id="main"
        collapsible
        :toggle="false"
        class="hidden lg:flex bg-(--md-sys-color-surface-container)"
        :ui="{ footer: 'lg:border-t lg:border-default' }"
      >
        <template #header="{ collapsed }">
          <div class="flex items-center gap-2 px-1">
            <UIcon name="material-symbols:menu-book-outline-rounded" class="size-6 text-primary shrink-0" />
            <span v-if="!collapsed" class="font-semibold">Ledger</span>
          </div>
        </template>

        <template #default="{ collapsed }">
          <!-- the extended FAB adds what the page in front is about (default: a new entry) -->
          <button v-if="journal.hasData" type="button" class="fab mb-3" :class="collapsed ? '' : 'fab-extended'" :aria-label="fab?.label ?? 'New entry'" @click="fab ? fab.run() : entry.start('expense')">
            <UIcon name="material-symbols:add-rounded" class="size-6 shrink-0" aria-hidden="true" />
            <span v-if="!collapsed" class="truncate">{{ fab?.label ?? 'New entry' }}</span>
          </button>
          <UNavigationMenu
            :collapsed="collapsed"
            :items="nav"
            orientation="vertical"
            :ui="{
              link: 'min-h-12 px-4 gap-3 md-label-large text-(--md-sys-color-on-surface-variant) before:rounded-full aria-[current=page]:text-(--md-sys-color-on-secondary-container) aria-[current=page]:before:bg-(--md-sys-color-secondary-container)',
              linkLeadingIcon: 'size-6'
            }"
          />
        </template>

        <template #footer="{ collapsed }">
          <div class="flex w-full items-center justify-between gap-2">
            <CiBadge v-if="!collapsed" />
            <div class="flex items-center gap-1">
              <PrivacyToggle />
              <UColorModeButton />
            </div>
          </div>
        </template>
      </UDashboardSidebar>

      <RouterView />
    </UDashboardGroup>

    <BottomNav class="lg:hidden" />
    <EntryDrawer />
  </UApp>
</template>

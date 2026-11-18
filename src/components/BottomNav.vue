<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useEntry } from '@/composables/useEntry'
import { useFab } from '@/composables/useFab'
import { usePrivacy } from '@/composables/usePrivacy'
import { navColor, navGroups, navTile } from '@/lib/nav'
import { useLedger } from '@/composables/useLedger'
import { useJournalStore } from '@/stores/journal'

/** Phone navigation bar: Home · List · Shopping · More, and the FAB (new entry) (the rest of the shared menu, by section, in color). */
const route = useRoute()
const entry = useEntry()
/** what "+" means on the page in front (default: a new entry) */
const fab = useFab()
const hidden = usePrivacy()

const left = [
  { label: 'Home', icon: 'material-symbols:home-outline-rounded', to: '/' },
  { label: 'List', icon: 'material-symbols:format-list-bulleted-rounded', to: '/transactions' }
]
const shopping = { label: 'Shopping', icon: 'material-symbols:shopping-cart-outline-rounded', to: '/shopping' }
/** the shared menu without what the tab bar already shows (Home, List, Shopping) */
const IN_BAR = ['home', 'transactions', 'shopping']
const L = useLedger()
const journal = useJournalStore()
const moreGroups = computed(() =>
  navGroups(L.keptPockets.value.all.size > 0)
    .map((g) => ({ ...g, items: g.items.filter((i) => !IN_BAR.includes(i.key)) }))
    .filter((g) => g.items.length)
)
const more = computed(() => moreGroups.value.flatMap((g) => g.items))
const active = (to: string) => (to === '/' ? route.path === '/' : route.path.startsWith(to))
const moreActive = computed(() => more.value.some((m) => active(m.to)))
const moreOpen = ref(false)
watch(
  () => route.path,
  () => (moreOpen.value = false)
)
</script>

<template>
  <!-- Material 3 navigation bar: the active destination sits in a pill; the main action floats above it -->
  <nav class="fixed inset-x-0 bottom-0 z-40 bg-(--md-sys-color-surface-container) safe-bottom" aria-label="Main">
    <!-- FAB: 56dp, 16dp from the edge and from the bar; it adds what the page in front is about -->
    <button v-if="journal.hasData" type="button" class="fab absolute right-4 -top-18" :aria-label="fab?.label ?? 'New entry'" @click="fab ? fab.run() : entry.start('expense')">
      <UIcon name="material-symbols:add-rounded" class="size-6" aria-hidden="true" />
    </button>
    <div class="grid grid-cols-4 items-center h-16">
      <RouterLink
        v-for="item in left"
        :key="item.to"
        :to="item.to"
        class="flex h-full flex-col items-center justify-center gap-1 md-label-medium [-webkit-tap-highlight-color:transparent]"
        :class="active(item.to) ? 'text-(--md-sys-color-secondary)' : 'text-muted'"
        :aria-current="active(item.to) ? 'page' : undefined"
      >
        <span class="nav-pill inline-flex items-center justify-center rounded-full" :data-active="active(item.to)">
          <UIcon :name="item.icon" class="size-6" />
        </span>
        {{ item.label }}
      </RouterLink>
      <RouterLink
        :to="shopping.to"
        class="flex h-full flex-col items-center justify-center gap-1 md-label-medium [-webkit-tap-highlight-color:transparent]"
        :class="active(shopping.to) ? 'text-(--md-sys-color-secondary)' : 'text-muted'"
        :aria-current="active(shopping.to) ? 'page' : undefined"
      >
        <span class="nav-pill inline-flex items-center justify-center rounded-full" :data-active="active(shopping.to)">
          <UIcon :name="shopping.icon" class="size-6" />
        </span>
        {{ shopping.label }}
      </RouterLink>
      <button
        type="button"
        class="flex h-full flex-col items-center justify-center gap-1 md-label-medium cursor-pointer [-webkit-tap-highlight-color:transparent]"
        :class="moreActive || moreOpen ? 'text-(--md-sys-color-secondary)' : 'text-muted'"
        :aria-expanded="moreOpen"
        aria-haspopup="dialog"
        @click="moreOpen = true"
      >
        <span class="nav-pill inline-flex items-center justify-center rounded-full" :data-active="moreActive || moreOpen">
          <UIcon name="material-symbols:menu-rounded" class="size-6" />
        </span>
        More
      </button>
    </div>

    <UDrawer v-model:open="moreOpen" title="More" :ui="{ container: 'w-full max-w-xl mx-auto' }">
      <template #body>
        <div class="pb-4 safe-bottom space-y-3">
          <!-- privacy mode, reachable from every page -->
          <label class="md-item flex items-center gap-3 min-h-14 cursor-pointer">
            <span class="size-10 shrink-0 rounded-(--md-sys-shape-corner-medium) inline-flex items-center justify-center bg-(--md-sys-color-secondary-container) text-(--md-sys-color-on-secondary-container)" aria-hidden="true">
              <UIcon :name="hidden ? 'material-symbols:visibility-off-outline-rounded' : 'material-symbols:visibility-outline-rounded'" class="size-5" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block font-medium">Hide amounts</span>
              <span class="block text-xs text-muted truncate">Blur the money to show the app to someone</span>
            </span>
            <USwitch v-model="hidden" aria-label="Hide amounts" />
          </label>
          <section v-for="g in moreGroups" :key="g.title" :aria-labelledby="`more-${g.title}`">
            <h3 :id="`more-${g.title}`" class="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted">{{ g.title }}</h3>
            <ul>
              <li v-for="m in g.items" :key="m.to">
                <RouterLink
                  :to="m.to"
                  class="md-item press flex items-center gap-3 min-h-14"
                  :class="active(m.to) ? 'bg-primary/10 text-highlighted' : ''"
                  :aria-current="active(m.to) ? 'page' : undefined"
                >
                  <span class="size-10 shrink-0 rounded-(--md-sys-shape-corner-medium) inline-flex items-center justify-center" :class="navTile(m.key)" aria-hidden="true">
                    <UIcon :name="m.icon" class="size-5" :class="navColor(m.key)" />
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block font-medium">{{ m.label }}</span>
                    <span class="block text-xs text-muted truncate">{{ m.description }}</span>
                  </span>
                  <UIcon name="material-symbols:chevron-right-rounded" class="size-4 text-muted" aria-hidden="true" />
                </RouterLink>
              </li>
            </ul>
          </section>
        </div>
      </template>
    </UDrawer>
  </nav>
</template>

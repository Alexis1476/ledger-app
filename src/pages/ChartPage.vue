<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useToast } from '@nuxt/ui/composables'
import AccountIcon from '@/components/AccountIcon.vue'
import StatusBanner from '@/components/StatusBanner.vue'
import { usePageFab } from '@/composables/useFab'
import { useLedger } from '@/composables/useLedger'
import { chartTree, slug, type ChartNode } from '@/ledger/chart'
import { useJournalStore, ValidationError } from '@/stores/journal'

/**
 * Chart of accounts: the expense accounts (what the money is for) and the revenue accounts
 * (where it comes from), as a tree of groups and categories. Add a category in a group (or a
 * new group), rename, move to another group (renamed everywhere) or archive.
 */
const store = useJournalStore()
const L = useLedger()
const toast = useToast()
const busy = ref(false)
const errorText = (e: unknown) => (e instanceof ValidationError ? e.issues.map((i) => i.message).join(' · ') : (e as Error).message)

type Root = 'expenses' | 'income'
const SECTIONS: { root: Root; title: string; help: string; type: 'X' | 'R' }[] = [
  { root: 'expenses', title: 'Expenses', help: 'What the money is for', type: 'X' },
  { root: 'income', title: 'Revenue', help: 'Where the money comes from', type: 'R' }
]

const declared = computed(() => store.journal.accounts.map((a) => a.name))
const trees = computed(() => Object.fromEntries(SECTIONS.map((s) => [s.root, chartTree(declared.value, s.root)])) as Record<Root, ChartNode[]>)

/** postings per account (a group: its categories) */
const usage = computed(() => {
  const m = new Map<string, number>()
  for (const t of store.journal.transactions)
    for (const p of t.postings) {
      const parts = p.account.split(':')
      for (let k = 2; k <= parts.length; k++) {
        const a = parts.slice(0, k).join(':')
        m.set(a, (m.get(a) ?? 0) + 1)
      }
    }
  return m
})
const countOf = (n: ChartNode) => usage.value.get(n.account) ?? 0
const label = (n: ChartNode) => (n.leaf ? L.style(n.account).label : L.groupLabel(n.account))

// collapsed groups (all open by default)
const collapsed = ref(new Set<string>())
function toggle(n: ChartNode) {
  const s = new Set(collapsed.value)
  if (s.has(n.account)) s.delete(n.account)
  else s.add(n.account)
  collapsed.value = s
}
/** visible rows, depth-first */
function rows(nodes: ChartNode[]): ChartNode[] {
  return nodes.flatMap((n) => [n, ...(n.leaf || collapsed.value.has(n.account) ? [] : rows(n.children))])
}
const groupsOf = (root: Root) => {
  const out: string[] = []
  const walk = (ns: ChartNode[]) => ns.forEach((n) => !n.leaf && (out.push(n.account), walk(n.children)))
  walk(trees.value[root])
  return out
}

// ── One inline form at a time: add (in a group or at the top) or edit ────
const TOP = '_top'
const NEW = '_new'
const form = reactive({ mode: '' as '' | 'add' | 'edit', root: 'expenses' as Root, at: '', account: '', name: '', group: TOP, newGroup: '', archived: false })
const groupItems = computed(() => [
  { label: '(no group)', value: TOP },
  ...groupsOf(form.root)
    .filter((g) => form.mode !== 'edit' || (g !== form.account && !g.startsWith(form.account + ':')))
    .map((g) => ({ label: L.groupLabel(g), value: g })),
  { label: 'New group…', value: NEW }
])
function openAdd(root: Root, group = TOP, name = '') {
  Object.assign(form, { mode: 'add', root, at: `${root}:${group}`, account: '', name, group, newGroup: '', archived: false })
}
usePageFab({ label: 'New category', run: () => openAdd('expenses') })
function openEdit(root: Root, n: ChartNode) {
  if (form.mode === 'edit' && form.account === n.account) return close()
  const parent = n.account.split(':').length > 2 ? n.account.split(':').slice(0, -1).join(':') : TOP
  Object.assign(form, { mode: 'edit', root, at: n.account, account: n.account, name: label(n), group: parent, newGroup: '', archived: L.archived.value.has(n.account) })
}
/** the "new category" dialog is open while adding */
const addOpen = computed({
  get: () => form.mode === 'add',
  set: (open) => {
    if (!open && form.mode === 'add') close()
  }
})
function close() {
  form.mode = ''
  form.at = ''
}
const parentAccount = computed(() => (form.group === TOP ? form.root : form.group === NEW ? `${form.root}:${slug(form.newGroup)}` : form.group))
const target = computed(() => {
  const leaf = form.mode === 'edit' ? form.account.split(':').at(-1)! : slug(form.name)
  return `${parentAccount.value}:${leaf}`
})
const formError = computed(() => {
  if (!form.mode || !form.name.trim()) return ''
  if (form.group === NEW && !slug(form.newGroup)) return 'Name the new group.'
  if (form.mode === 'add' && !slug(form.name)) return 'Use letters or digits.'
  if (target.value !== form.account && declared.value.includes(target.value)) return 'This group already has a category with this name.'
  if (form.group !== TOP && form.group !== NEW && L.leaves.value.includes(form.group)) return 'A category cannot hold other categories.'
  return ''
})
const sectionType = (root: Root) => SECTIONS.find((s) => s.root === root)!.type

async function save() {
  if (!form.name.trim() || formError.value) return
  busy.value = true
  try {
    const type = sectionType(form.root)
    // a new group is declared with its name
    if (form.group === NEW && !declared.value.includes(parentAccount.value)) await store.addAccount(parentAccount.value, { type, label: form.newGroup.trim() })
    if (form.mode === 'add') {
      await store.addAccount(target.value, { type, label: form.name.trim() })
      toast.add({ title: 'Category added', description: form.name.trim(), icon: 'material-symbols:sell-outline-rounded', color: 'success' })
    } else {
      let account = form.account
      if (target.value !== account) {
        await store.renameAccountsEverywhere({ [account]: target.value })
        account = target.value
      }
      const tags: Record<string, string> = {}
      if (form.name.trim() !== L.style(account).label) tags.label = form.name.trim()
      if (form.archived !== L.archived.value.has(account)) tags.archived = form.archived ? 'yes' : ''
      if (Object.keys(tags).length) await store.setAccountTags(account, tags)
      toast.add({ title: 'Category saved', description: form.name.trim(), icon: 'material-symbols:check-rounded', color: 'success' })
    }
    close()
  } catch (e) {
    toast.add({ title: 'Not saved', description: errorText(e), color: 'error', icon: 'material-symbols:cancel-outline-rounded' })
  } finally {
    busy.value = false
  }
}
/** a group's name: declared with a label (declared now if it was implicit) */
async function renameGroup(n: ChartNode, root: Root, name: string) {
  busy.value = true
  try {
    if (declared.value.includes(n.account)) await store.setAccountTags(n.account, { label: name })
    else await store.addAccount(n.account, { type: sectionType(root), label: name })
    toast.add({ title: 'Group renamed', description: name, icon: 'material-symbols:check-rounded', color: 'success' })
    close()
  } catch (e) {
    toast.add({ title: 'Not saved', description: errorText(e), color: 'error', icon: 'material-symbols:cancel-outline-rounded' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="chart">
    <template #header>
      <UDashboardNavbar title="Chart of accounts" :toggle="false" />
    </template>
    <template #body>
      <div class="stagger max-w-3xl w-full mx-auto space-y-4 pb-44 lg:pb-8">
        <StatusBanner />

        <UCard v-for="s in SECTIONS" :key="s.root" :ui="{ body: 'md-list' }">
          <template #header>
            <div>
              <h2 class="font-semibold">{{ s.title }}</h2>
              <p class="text-xs text-muted">{{ s.help }}</p>
            </div>
          </template>

          <ul role="tree" :aria-label="s.title">
            <template v-for="n in rows(trees[s.root])" :key="n.account">
              <li
                role="treeitem"
                :aria-level="n.depth + 1"
                :aria-expanded="n.leaf ? undefined : !collapsed.has(n.account)"
                class="md-item flex items-center gap-1 pr-1!"
                :style="{ paddingLeft: `${0.25 + n.depth * 1.25}rem` }"
              >
                <button
                  v-if="!n.leaf"
                  type="button"
                  class="press tap size-8 shrink-0 inline-flex items-center justify-center rounded-md cursor-pointer"
                  :aria-label="collapsed.has(n.account) ? `Expand ${label(n)}` : `Collapse ${label(n)}`"
                  @click="toggle(n)"
                >
                  <UIcon :name="collapsed.has(n.account) ? 'material-symbols:chevron-right-rounded' : 'material-symbols:keyboard-arrow-down-rounded'" class="size-4 text-muted" />
                </button>
                <span v-else class="tap size-8 shrink-0" aria-hidden="true" />
                <button
                  type="button"
                  class="press flex-1 min-w-0 flex items-center gap-2 px-1 py-1.5 min-h-11 text-left rounded-md cursor-pointer"
                  :class="L.archived.value.has(n.account) ? 'opacity-50' : ''"
                  :title="n.account"
                  @click="n.leaf ? openEdit(s.root, n) : Object.assign(form, { mode: 'edit', root: s.root, at: n.account, account: n.account, name: label(n), group: TOP })"
                >
                  <AccountIcon :icon="L.style(n.account).icon" :color="L.style(n.account).color" size="sm" />
                  <span class="truncate" :class="n.leaf ? 'text-sm' : 'text-sm font-semibold'">{{ label(n) }}</span>
                  <UIcon v-if="L.archived.value.has(n.account)" name="material-symbols:archive-outline-rounded" class="size-3.5 shrink-0" aria-label="archived" />
                  <span class="ml-auto text-xs text-muted tabular shrink-0">{{ countOf(n) || '' }}</span>
                </button>
                <UButton
                  v-if="!n.leaf"
                  size="sm"
                  class="tap"
                  variant="ghost"
                  color="neutral"
                  icon="material-symbols:add-rounded"
                  :aria-label="`Add a category in ${label(n)}`"
                  @click="openAdd(s.root, n.account)"
                />
              </li>

              <!-- editing this row: a category (name, group, archived) or a group (name) -->
              <li v-if="form.mode === 'edit' && form.at === n.account" class="px-2 pb-3" :style="{ paddingLeft: `${n.depth * 1.25 + 2.5}rem` }">
                <form v-if="n.leaf" class="grid grid-cols-2 gap-2" @submit.prevent="save">
                  <UInput v-model="form.name" placeholder="Name" aria-label="Category name (edit)" class="col-span-2" />
                  <USelect v-model="form.group" :items="groupItems" aria-label="Move to group" class="col-span-2" />
                  <UInput v-if="form.group === NEW" v-model="form.newGroup" placeholder="New group name" aria-label="New group name" class="col-span-2" />
                  <USwitch v-model="form.archived" label="Archived (hidden from the forms)" class="col-span-2" />
                  <p v-if="formError" class="col-span-2 text-xs text-error">{{ formError }}</p>
                  <p v-else-if="target !== form.account" class="col-span-2 text-xs text-muted">
                    Moves <code>{{ form.account }}</code> → <code>{{ target }}</code> in every journal (balances unchanged).
                  </p>
                  <UButton variant="ghost" color="neutral" label="Cancel" class="justify-center" @click="close" />
                  <UButton type="submit" label="Save" class="justify-center" :loading="busy" :disabled="!!formError" />
                </form>
                <form v-else class="grid grid-cols-2 gap-2" @submit.prevent="renameGroup(n, s.root, form.name.trim())">
                  <UInput v-model="form.name" placeholder="Group name" aria-label="Group name" class="col-span-2" />
                  <UButton variant="ghost" color="neutral" label="Cancel" class="justify-center" @click="close" />
                  <UButton type="submit" label="Rename group" class="justify-center" :loading="busy" :disabled="!form.name.trim()" />
                </form>
              </li>
            </template>
          </ul>
        </UCard>

        <p class="text-xs text-muted">
          A group only holds categories; transactions go to the categories. The number is how many lines use it. Moving a
          category renames it in every journal; archiving hides it from the forms and keeps its history.
        </p>
      </div>

      <!-- New category: a dialog, in sight wherever the list is scrolled -->
      <UModal v-model:open="addOpen" title="New category" description="An expense or a revenue category: choose its group, or create one.">
        <template #body>
          <form class="space-y-4" @submit.prevent="save">
            <UFormField label="Name">
              <UInput v-model="form.name" size="xl" placeholder="e.g. Coffee" aria-label="Category name" class="w-full" autofocus />
            </UFormField>
            <UFormField label="Kind">
              <USelect :model-value="form.root" size="xl" :items="SECTIONS.map((x) => ({ label: x.title, value: x.root }))" aria-label="Kind" class="w-full" @update:model-value="(v: Root) => openAdd(v, TOP, form.name)" />
            </UFormField>
            <UFormField label="Group">
              <USelect v-model="form.group" size="xl" :items="groupItems" aria-label="Group" class="w-full" />
            </UFormField>
            <UFormField v-if="form.group === NEW" label="New group">
              <UInput v-model="form.newGroup" size="xl" placeholder="New group name" aria-label="New group name" class="w-full" />
            </UFormField>
            <p v-if="formError" class="text-xs text-error">{{ formError }}</p>
            <p v-else-if="form.name.trim()" class="text-xs text-muted"><code>{{ target }}</code></p>
            <div class="flex justify-end gap-2 pt-2">
              <UButton variant="ghost" label="Cancel" @click="close" />
              <UButton type="submit" label="Add" icon="material-symbols:check-rounded" :loading="busy" :disabled="!form.name.trim() || !!formError" />
            </div>
          </form>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>

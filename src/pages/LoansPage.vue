<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ulid } from 'ulid'
import { useToast } from '@nuxt/ui/composables'
import AccountIcon from '@/components/AccountIcon.vue'
import SegmentedChoice from '@/components/SegmentedChoice.vue'
import StatusBanner from '@/components/StatusBanner.vue'
import TxDetail from '@/components/TxDetail.vue'
import TxRow from '@/components/TxRow.vue'
import { useEntry, type EntryKind } from '@/composables/useEntry'
import { usePageFab } from '@/composables/useFab'
import { useLedger, type PersonView } from '@/composables/useLedger'
import { ZERO, type Decimal } from '@/ledger/decimal'
import {
  extras,
  GIFT_GIVEN,
  GIFT_RECEIVED,
  KIND_LABEL,
  KINDS_BY_DIRECTION,
  loanAccount,
  personKey,
  searchConvertible,
  settleExtra,
  settleInKind,
  toLoan,
  type Convertible,
  type Extra,
  type ExtraAs,
  type LoanKind
} from '@/ledger/loans'
import type { Transaction } from '@/ledger/types'
import { money, parseUserAmount, shortDate, today } from '@/lib/format'
import { useJournalStore, ValidationError } from '@/stores/journal'

/**
 * Loans: who owes me (assets:receivables:<who>, actif) and whom I owe (liabilities:people:<who>,
 * passif). Record a new loan or a repayment with the entry form, or turn an existing
 * transaction (e.g. an imported "Nina Loan") into a loan.
 */
const store = useJournalStore()
const L = useLedger()
const entry = useEntry()
const toast = useToast()
const refC = computed(() => L.refCurrency.value)
const lines = (m: Map<string, Decimal>) => [...m].map(([c, q]) => money(q, c)).join(' · ')
const isPocket = (a: string) => L.assetAccounts.value.some((x) => x.name === a)

const people = computed(() => L.people.value.filter((p) => p.owesMe || p.owed))
const open = (p: PersonView) => !!(p.owesMe?.balance.size || p.owed?.balance.size)
const active = computed(() => people.value.filter(open))
const settled = computed(() => people.value.filter((p) => !open(p)))
// an extra payment waiting for a decision (a negative balance) is neither owed to me nor by me
const atLeastZero = (q?: Decimal) => (q && q.gt(0) ? q : ZERO)
const totalOwedToMe = computed(() => active.value.reduce((s, p) => s.plus(atLeastZero(p.owesMe?.ref)), ZERO))
const totalIOwe = computed(() => active.value.reduce((s, p) => s.plus(atLeastZero(p.owed?.ref)), ZERO))

const expanded = ref<string>()
function history(p: PersonView) {
  const accounts = [p.owesMe?.account, p.owed?.account].filter(Boolean) as string[]
  return L.recent.value.filter((t) => t.postings.some((x) => accounts.includes(x.account))).slice(0, 12)
}
/** the movement on the person's account (positive = they owe me more / I owe them less) */
function movement(t: Transaction, p: PersonView) {
  const x = t.postings.find((y) => y.account === p.owesMe?.account || y.account === p.owed?.account)
  return x?.amount ? { qty: x.amount.qty, commodity: x.amount.commodity } : undefined
}

/** open the entry form already on the person's account */
function record(kind: LoanKind, who: string, label: string) {
  const formKind: EntryKind = kind === 'lent' || kind === 'repaidByMe' ? 'expense' : 'income'
  entry.start(formKind, { name: KIND_LABEL[kind], kind: formKind, category: loanAccount(kind, who), payee: label })
}

const busy = ref(false)

// ── Paid more than the loan: the extra is a gift, or a loan the other way round ──
const positive = (m?: Map<string, Decimal>) => new Map([...(m ?? [])].filter(([, q]) => q.gt(0)))
const extrasOf = (p: PersonView) => extras(p.owesMe?.balance, p.owed?.balance)
async function settle(p: PersonView, x: Extra, as: ExtraAs) {
  busy.value = true
  try {
    const id = ulid()
    const tx = settleExtra(p.key, x, as, { date: today(), id, payee: p.label })
    // the accounts of the entry exist before it is written
    for (const post of tx.postings) {
      if (L.declared.value.includes(post.account)) continue
      if (post.account === GIFT_RECEIVED || post.account === GIFT_GIVEN) await store.addAccount(post.account, { type: post.account === GIFT_RECEIVED ? 'R' : 'X', label: 'Gifts' })
      else await store.declarePersonAccount(post.account)
    }
    await store.addTransaction(tx, { queueOffline: false })
    toast.add({ title: as === 'gift' ? 'Recorded as a gift' : 'Recorded as a loan', description: `${p.label} · ${money(x.qty, x.commodity)}`, icon: 'material-symbols:check-rounded', color: 'success' })
  } catch (e) {
    toast.add({ title: 'Not saved', description: errorText(e), color: 'error', icon: 'material-symbols:cancel-outline-rounded' })
  } finally {
    busy.value = false
  }
}
const errorText = (e: unknown) => (e instanceof ValidationError ? e.issues.map((i) => i.message).join(' · ') : (e as Error).message)

// ── Settled another way: a service or a thing instead of money ──────────
const kind = reactive({ open: false, who: '', label: '', side: 'receivable' as 'receivable' | 'debt', amount: '', currency: '', category: '', note: '', date: today(), balance: new Map<string, Decimal>() })
function openKind(p: PersonView, side: 'receivable' | 'debt') {
  const balance = positive(side === 'receivable' ? p.owesMe?.balance : p.owed?.balance)
  const [currency, qty] = [...balance][0] ?? [refC.value, ZERO]
  Object.assign(kind, { open: true, who: p.key, label: p.label, side, amount: qty.toFixed(2), currency, category: '', note: '', date: today(), balance })
}
const kindCurrencies = computed(() => [...kind.balance.keys()])
/** what I got (an expense) or what I gave (an income) */
const kindCategories = computed(() =>
  (kind.side === 'receivable' ? L.expenseCategories.value : L.incomeCategories.value).map((c) => {
    const group = c.split(':').slice(0, 2).join(':')
    return { label: group === c ? L.style(c).label : `${L.groupLabel(group)} · ${L.style(c).label}`, value: c, icon: L.style(c).icon }
  })
)
const kindQty = computed(() => parseUserAmount(kind.amount))
const kindLeft = computed(() => (kind.balance.get(kind.currency) ?? ZERO).minus(kindQty.value ?? ZERO))
const kindError = computed(() => {
  if (!kind.amount.trim()) return ''
  if (!kindQty.value || !kindQty.value.gt(0)) return 'Amount: a number above zero.'
  if (kindLeft.value.isNeg()) return `More than what is owed (${money(kind.balance.get(kind.currency) ?? ZERO, kind.currency)}).`
  return ''
})
async function saveKind() {
  if (!kindQty.value || kindError.value || !kind.category) return
  busy.value = true
  try {
    const id = ulid()
    await store.addTransaction(settleInKind(kind.who, kind.side, { qty: kindQty.value, commodity: kind.currency }, kind.category, { date: kind.date, id, payee: kind.label, note: kind.note }), {
      queueOffline: false
    })
    toast.add({ title: 'Settled another way', description: `${kind.label} · ${money(kindQty.value, kind.currency)}`, icon: 'material-symbols:check-rounded', color: 'success' })
    kind.open = false
  } catch (e) {
    toast.add({ title: 'Not saved', description: errorText(e), color: 'error', icon: 'material-symbols:cancel-outline-rounded' })
  } finally {
    busy.value = false
  }
}

// ── New loan ─────────────────────────────────────────────────────────────
const newOpen = ref(false)
usePageFab({ label: 'New loan', run: () => (newOpen.value = true) })
const newLoan = reactive({ name: '', kind: 'lent' as LoanKind })
const knownNames = computed(() => people.value.map((p) => p.label))
async function startNew() {
  const name = newLoan.name.trim()
  const who = personKey(name)
  if (!who) return
  busy.value = true
  try {
    await store.declarePersonAccount(loanAccount(newLoan.kind, who))
    newOpen.value = false
    record(newLoan.kind, who, people.value.find((p) => p.key === who)?.label ?? name)
    newLoan.name = ''
  } catch (e) {
    toast.add({ title: 'Not saved', description: errorText(e), color: 'error', icon: 'material-symbols:cancel-outline-rounded' })
  } finally {
    busy.value = false
  }
}

// ── Turn an existing transaction into a loan ────────────────────────────
const query = ref('')
const results = computed(() => (query.value.trim().length < 2 ? [] : searchConvertible(store.journal.transactions, query.value, isPocket)))
const picked = ref<string>()
const conv = reactive({ name: '', kind: 'lent' as LoanKind })
const key = (t: Transaction) => `${t.src?.file}:${t.src?.startLine}`
/** the transaction being turned into a loan (its dialog is open) */
const pickedTx = computed(() => results.value.find((c) => key(c.tx) === picked.value))
const convOpen = computed({ get: () => !!pickedTx.value, set: (open) => (open ? undefined : (picked.value = undefined)) })
function pick(c: Convertible) {
  picked.value = key(c.tx)
  conv.kind = KINDS_BY_DIRECTION[c.direction][0]
  conv.name = ''
}
const kindOptions = (kinds: readonly LoanKind[]) => kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))
/** what one person's loan is worth for me, in the reference currency (negative: I owe) */
const net = (p: PersonView) => (p.owesMe?.ref ?? ZERO).minus(p.owed?.ref ?? ZERO)
async function convert(c: Convertible) {
  const who = personKey(conv.name)
  if (!who) return
  const account = loanAccount(conv.kind, who)
  busy.value = true
  try {
    await store.declarePersonAccount(account)
    await store.replaceTransaction(c.tx, toLoan(c, account))
    toast.add({ title: 'Recorded as a loan', description: `${c.tx.payee ?? c.tx.date} · ${KIND_LABEL[conv.kind]}`, icon: 'material-symbols:handshake-outline-rounded', color: 'success' })
    picked.value = undefined
    query.value = ''
  } catch (e) {
    toast.add({ title: 'Not saved', description: errorText(e), color: 'error', icon: 'material-symbols:cancel-outline-rounded' })
  } finally {
    busy.value = false
  }
}
const amountOf = (c: Convertible) => {
  const p = c.tx.postings[1 - c.postingIndex].amount!
  return money(p.qty, p.commodity)
}

const selected = ref<Transaction>()
const detailOpen = ref(false)
function show(t: Transaction) {
  selected.value = t
  detailOpen.value = true
}
</script>

<template>
  <UDashboardPanel id="loans">
    <template #header>
      <UDashboardNavbar title="Loans" :toggle="false" />
    </template>
    <template #body>
      <div class="stagger max-w-3xl w-full mx-auto space-y-4 pb-44 lg:pb-8">
        <StatusBanner />
        <!-- names already known, suggested in both "Person" fields -->
        <datalist id="loan-people">
          <option v-for="n in knownNames" :key="n" :value="n" />
        </datalist>

        <div class="grid grid-cols-2 gap-3">
          <UCard :ui="{ body: 'p-4' }">
            <div class="text-xs text-muted">Owed to me</div>
            <div class="text-xl font-semibold tabular mt-0.5 text-success">{{ money(totalOwedToMe, refC) }}</div>
          </UCard>
          <UCard :ui="{ body: 'p-4' }">
            <div class="text-xs text-muted">I owe</div>
            <div class="text-xl font-semibold tabular mt-0.5" :class="totalIOwe.gt(0) ? 'text-error' : ''">{{ money(totalIOwe, refC) }}</div>
          </UCard>
        </div>

        <!-- People with an open loan: one list; a row shows, its trailing button unfolds the actions and the history -->
        <UCard v-if="active.length" :ui="{ body: 'md-list' }">
          <template #header>
            <h2 class="text-sm font-semibold">Open loans ({{ active.length }})</h2>
          </template>
          <div v-for="p in active" :key="p.key" class="pb-1">
            <div class="md-item flex items-center gap-3 py-2 pr-2!">
              <AccountIcon icon="material-symbols:person-outline-rounded" :color="p.color" />
              <div class="min-w-0 flex-1">
                <div class="md-body-large truncate">{{ p.label }}</div>
                <div v-if="positive(p.owesMe?.balance).size" class="md-body-medium text-success tabular">owes me {{ lines(positive(p.owesMe?.balance)) }}</div>
                <div v-if="positive(p.owed?.balance).size" class="md-body-medium text-error tabular">I owe {{ lines(positive(p.owed?.balance)) }}</div>
                <div v-for="x in extrasOf(p)" :key="x.side + x.commodity" class="md-body-medium text-warning tabular">
                  {{ x.side === 'receivable' ? 'paid' : 'I paid' }} {{ money(x.qty, x.commodity) }} too much
                </div>
              </div>
              <span class="tabular md-label-large whitespace-nowrap">{{ money(net(p), refC) }}</span>
              <UButton
                :icon="expanded === p.key ? 'material-symbols:keyboard-arrow-up-rounded' : 'material-symbols:keyboard-arrow-down-rounded'"
                variant="soft"
                color="neutral"
                square
                class="tap shrink-0"
                :aria-expanded="expanded === p.key"
                :aria-label="`${expanded === p.key ? 'Hide' : 'Show'} the details of ${p.label}`"
                @click="expanded = expanded === p.key ? undefined : p.key"
              />
            </div>
            <!-- paid more than the loan: say what the extra is -->
            <div
              v-for="x in extrasOf(p)"
              :key="'extra' + x.side + x.commodity"
              class="mt-2 rounded-(--md-sys-shape-corner-large) bg-(--md-sys-color-secondary-container) p-4 text-(--md-sys-color-on-secondary-container)"
              role="group"
              :aria-label="`Extra payment, ${p.label}`"
            >
              <p class="md-title-small">
                {{ x.side === 'receivable' ? `${p.label} paid ${money(x.qty, x.commodity)} more than the loan.` : `I paid ${p.label} ${money(x.qty, x.commodity)} more than my debt.` }}
              </p>
              <p class="md-body-medium mt-0.5">What is the difference?</p>
              <div class="mt-3 flex flex-wrap gap-2">
                <UButton icon="material-symbols:redeem-rounded" :label="x.side === 'receivable' ? 'A gift to me' : 'A gift from me'" :loading="busy" @click="settle(p, x, 'gift')" />
                <UButton variant="outline" color="neutral" icon="material-symbols:handshake-outline-rounded" :label="x.side === 'receivable' ? 'I owe it back' : 'They owe it back'" :disabled="busy" @click="settle(p, x, 'loan')" />
              </div>
            </div>
            <div v-if="expanded === p.key" class="pt-2 pb-2">
              <div class="grid grid-cols-2 gap-2 pb-2">
                <template v-if="p.owesMe">
                  <UButton variant="soft" icon="material-symbols:arrow-outward-rounded" label="Lent more" class="justify-center" @click="record('lent', p.key, p.label)" />
                  <UButton variant="soft" color="success" icon="material-symbols:south-west-rounded" label="Got repaid" class="justify-center" @click="record('repaidToMe', p.key, p.label)" />
                  <UButton
                    v-if="positive(p.owesMe.balance).size"
                    variant="ghost"
                    color="neutral"
                    icon="material-symbols:swap-horiz-rounded"
                    label="Settled another way"
                    class="col-span-2 justify-center"
                    :aria-label="`${p.label} settled another way`"
                    @click="openKind(p, 'receivable')"
                  />
                </template>
                <template v-if="p.owed">
                  <UButton variant="soft" icon="material-symbols:south-west-rounded" label="Borrowed more" class="justify-center" @click="record('borrowed', p.key, p.label)" />
                  <UButton variant="soft" color="success" icon="material-symbols:arrow-outward-rounded" label="Repaid" class="justify-center" @click="record('repaidByMe', p.key, p.label)" />
                  <UButton
                    v-if="positive(p.owed.balance).size"
                    variant="ghost"
                    color="neutral"
                    icon="material-symbols:swap-horiz-rounded"
                    label="I settled another way"
                    class="col-span-2 justify-center"
                    @click="openKind(p, 'debt')"
                  />
                </template>
              </div>
              <TxRow v-for="t in history(p)" :key="key(t)" :tx="t" :amount="movement(t, p)" show-date @select="show" />
            </div>
          </div>
        </UCard>
        <UCard v-else-if="store.hasData" :ui="{ body: 'p-6 text-center' }">
          <p class="md-body-large">No open loan.</p>
          <p class="md-body-medium text-muted">Use + to record one.</p>
        </UCard>

        <!-- Turn an existing transaction into a loan -->
        <div>
          <UInput
            v-model="query"
            size="xl"
            icon="material-symbols:search-rounded"
            placeholder="Find a transaction that was a loan"
            :ui="{ base: 'bg-(--md-sys-color-surface-container-high)' }"
            aria-label="Find a transaction that was a loan"
            autocomplete="off"
            class="w-full"
          />
          <UCard v-if="results.length" class="mt-2" :ui="{ body: 'md-list' }">
            <div v-for="c in results" :key="key(c.tx)" role="list" aria-label="Transactions found">
              <button
                type="button"
                class="md-item press w-full flex items-center gap-3 py-2 text-left cursor-pointer"
                aria-haspopup="dialog"
                :aria-label="`${c.tx.payee ?? c.tx.note ?? '—'} ${c.tx.date}`"
                @click="pick(c)"
              >
                <UIcon :name="c.direction === 'out' ? 'material-symbols:arrow-outward-rounded' : 'material-symbols:south-west-rounded'" class="size-5 text-muted shrink-0" aria-hidden="true" />
                <div class="min-w-0 flex-1">
                  <div class="truncate md-body-large">{{ c.tx.payee ?? c.tx.note ?? '—' }}</div>
                  <div class="md-body-medium text-muted truncate">{{ shortDate(c.tx.date) }} · {{ L.accountLabel(c.tx.postings[c.postingIndex].account) }}</div>
                </div>
                <span class="tabular md-label-large whitespace-nowrap">{{ amountOf(c) }}</span>
              </button>
            </div>
          </UCard>
          <p v-else-if="query.trim().length >= 2" class="mt-2 px-1 text-sm text-muted">No transaction found.</p>
          <p class="mt-2 px-1 text-xs text-muted">
            A loan recorded as a plain expense or income? Find it here to move it to the person's account.
          </p>
        </div>

        <details v-if="settled.length">
          <summary class="tap flex items-center px-1 py-2 md-body-medium text-muted cursor-pointer">Settled ({{ settled.length }})</summary>
          <UCard class="mt-1" :ui="{ body: 'md-list' }">
            <div v-for="p in settled" :key="p.key" class="md-item flex items-center gap-3 py-2">
              <AccountIcon icon="material-symbols:person-outline-rounded" :color="p.color" size="sm" />
              <span class="md-body-large truncate">{{ p.label }}</span>
            </div>
          </UCard>
        </details>
      </div>
      <!-- New loan: who and which way; the entry form then opens on that person's account -->
      <UModal v-model:open="newOpen" title="New loan" description="Who, and which way. The amount comes next.">
        <template #body>
          <form class="space-y-4" @submit.prevent="startNew">
            <UFormField label="Person">
              <UInput v-model="newLoan.name" list="loan-people" size="xl" placeholder="e.g. Ana" aria-label="Person" class="w-full" autocomplete="off" autofocus />
            </UFormField>
            <UFormField label="Direction">
              <SegmentedChoice v-model="newLoan.kind" :options="kindOptions(['lent', 'borrowed'])" label="Direction" block />
            </UFormField>
            <div class="flex justify-end gap-2 pt-2">
              <UButton variant="ghost" label="Cancel" @click="newOpen = false" />
              <UButton type="submit" label="Next" trailing-icon="material-symbols:arrow-forward-rounded" :loading="busy" :disabled="!newLoan.name.trim()" />
            </div>
          </form>
        </template>
      </UModal>

      <!-- An existing transaction becomes a loan -->
      <UModal
        v-model:open="convOpen"
        title="Record as a loan"
        :description="pickedTx ? `${pickedTx.tx.payee ?? pickedTx.tx.note ?? '—'} · ${shortDate(pickedTx.tx.date)} · ${amountOf(pickedTx)}. The amount stays; it moves to the person's account.` : ''"
      >
        <template #body>
          <form v-if="pickedTx" class="space-y-4" @submit.prevent="convert(pickedTx)">
            <UFormField label="Person">
              <UInput v-model="conv.name" list="loan-people" size="xl" placeholder="e.g. Ana" aria-label="Person" class="w-full" autocomplete="off" autofocus />
            </UFormField>
            <UFormField label="Direction">
              <SegmentedChoice v-model="conv.kind" :options="kindOptions(KINDS_BY_DIRECTION[pickedTx.direction])" label="Direction" block />
            </UFormField>
            <div class="flex justify-end gap-2 pt-2">
              <UButton variant="ghost" label="Cancel" @click="picked = undefined" />
              <UButton type="submit" label="Record as loan" icon="material-symbols:check-rounded" :loading="busy" :disabled="!conv.name.trim()" />
            </div>
          </form>
        </template>
      </UModal>

      <!-- Settled another way: a dialog, the entry moves no money -->
      <UModal
        v-model:open="kind.open"
        title="Settled another way"
        :description="
          kind.side === 'receivable'
            ? `${kind.label} gave you something else than money (a service, a thing). It counts as an expense, and no account moves.`
            : `You gave ${kind.label} something else than money. It counts as an income, and no account moves.`
        "
      >
        <template #body>
          <form class="space-y-4" @submit.prevent="saveKind">
            <div class="grid grid-cols-3 gap-3">
              <UFormField label="Amount" class="col-span-2">
                <UInput v-model="kind.amount" size="xl" inputmode="decimal" aria-label="Amount" class="w-full" />
              </UFormField>
              <UFormField label="Currency">
                <USelect v-model="kind.currency" size="xl" :items="kindCurrencies" :disabled="kindCurrencies.length < 2" aria-label="Currency" class="w-full" />
              </UFormField>
            </div>
            <UFormField :label="kind.side === 'receivable' ? 'What you got' : 'What you gave'">
              <USelectMenu v-model="kind.category" size="xl" :items="kindCategories" value-key="value" placeholder="Choose a category" aria-label="Category" class="w-full" />
            </UFormField>
            <UFormField label="Note" hint="optional">
              <UInput v-model="kind.note" size="xl" placeholder="e.g. Spotify family, 1 year" aria-label="Note" class="w-full" />
            </UFormField>
            <UFormField label="Date">
              <UInput v-model="kind.date" type="date" size="xl" aria-label="Date" class="w-full" />
            </UFormField>
            <p v-if="kindError" class="text-xs text-error">{{ kindError }}</p>
            <p v-else-if="kindQty" class="md-body-small text-muted">
              {{ kindLeft.isZero() ? `${kind.label} is settled after this.` : `${money(kindLeft, kind.currency)} will still be owed.` }}
            </p>
            <div class="flex justify-end gap-2 pt-2">
              <UButton variant="ghost" label="Cancel" @click="kind.open = false" />
              <UButton type="submit" label="Save" icon="material-symbols:check-rounded" :loading="busy" :disabled="!kindQty || !!kindError || !kind.category" />
            </div>
          </form>
        </template>
      </UModal>
      <TxDetail v-model:open="detailOpen" :tx="selected" />
    </template>
  </UDashboardPanel>
</template>

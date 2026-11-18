<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useToast } from '@nuxt/ui/composables'
import { ulid } from 'ulid'
import { z } from 'zod'
import AccountIcon from './AccountIcon.vue'
import SplitEditor from './SplitEditor.vue'
import { useEntry, type EntryKind } from '@/composables/useEntry'
import { useLedger } from '@/composables/useLedger'
import { build, equalSplit, type KindInputs } from '@/ledger/builder'
import { Decimal } from '@/ledger/decimal'
import { format } from '@/ledger/formatter'
import { describeRule, formatSchedule, type Rule, type Unit } from '@/ledger/periodic'
import { reverse, type FormInput } from '@/ledger/reverse'
import type { Transaction } from '@/ledger/types'
import { isValidDate } from '@/ledger/validate'
import { currencyFlag, parseUserAmount, today } from '@/lib/format'
import { prefs } from '@/offline/db'
import { useJournalStore, ValidationError } from '@/stores/journal'

/**
 * Quick entry. Generic: every field picks an account (pockets, categories, people accounts)
 * and the transaction posts exactly to the accounts picked. No hidden rules (docs/02).
 */
const entry = useEntry()
const store = useJournalStore()
const L = useLedger()
const toast = useToast()

/** "Me" in the split = the chosen category */
const ME = 'me'
/** one control height for the whole form */
const SIZE = 'xl' as const

const kindTabs = [
  { label: 'Expense', value: 'expense', icon: 'material-symbols:arrow-outward-rounded' },
  { label: 'Income', value: 'income', icon: 'material-symbols:south-west-rounded' },
  { label: 'Transfer', value: 'transfer', icon: 'material-symbols:swap-horiz-rounded' }
]

function blank() {
  return {
    id: ulid(),
    date: today(),
    amount: '',
    /** currency of the amount (expense/income), or of a transfer whose source has no fixed currency */
    currency: 'CHF',
    /** transfer: currency received when the destination has no fixed currency */
    toCurrency: '',
    payee: '',
    note: '',
    source: prefs.get('lastSource', ''),
    category: '',
    debited: '',
    /** split of an expense: ME (= the category) and/or other accounts */
    forWhom: [ME] as string[],
    splitAmounts: {} as Record<string, string>,
    customSplit: false,
    to: '',
    toAmount: '',
    fee: '',
    pending: false,
    /** tags kept from an edited transaction (item:, schedule:, …) */
    extraTags: {} as Record<string, string>,
    showDetails: false,
    showMore: false,
    showPreview: false,
    /** scheduled payment: key of REPEATS ('none' = a normal entry) and optional end (exclusive) */
    repeat: 'none',
    until: ''
  }
}

/** Repeat choices → hledger interval (more can be read from the journal, see repeatItems). */
const REPEATS: Record<string, { label: string; unit: Unit; every: number }> = {
  daily: { label: 'Daily', unit: 'day', every: 1 },
  weekly: { label: 'Weekly', unit: 'week', every: 1 },
  biweekly: { label: 'Every 2 weeks', unit: 'week', every: 2 },
  monthly: { label: 'Monthly', unit: 'month', every: 1 },
  quarterly: { label: 'Every 3 months', unit: 'month', every: 3 },
  yearly: { label: 'Yearly', unit: 'year', every: 1 }
}
const repeatKey = (r: Rule) =>
  Object.entries(REPEATS).find(([, v]) => v.unit === r.unit && v.every === r.every)?.[0] ?? `${r.unit}:${r.every}`
function repeatOf(key: string): { unit: Unit; every: number } | undefined {
  if (REPEATS[key]) return REPEATS[key]
  const m = /^(day|week|month|year):(\d+)$/.exec(key)
  return m ? { unit: m[1] as Unit, every: Number(m[2]) } : undefined
}
const form = reactive(blank())
const saving = ref(false)
const touched = ref(false)
const touchedCurrency = ref(false)
const categoryTouched = ref(false)
const amountInput = ref<{ inputRef?: HTMLInputElement } | null>(null)

const kind = computed({
  get: () => entry.kind.value,
  set: (k: EntryKind) => (entry.kind.value = k)
})
const editing = computed(() => entry.editing.value)
/** scheduled payment being edited / occurrence being recorded */
const sched = computed(() => entry.schedule.value)
const occurrence = computed(() => entry.occurrence.value)
/** saving writes a schedule (periodic transaction) instead of a transaction */
const scheduleMode = computed(() => !editing.value && !occurrence.value && form.repeat !== 'none')
const rule = computed<Rule | undefined>(() => {
  const r = repeatOf(form.repeat)
  if (!scheduleMode.value || !r) return undefined
  return form.until ? { ...r, from: form.date, to: form.until } : { ...r, from: form.date }
})
const repeatItems = computed(() => {
  const items = Object.entries(REPEATS).map(([value, v]) => ({ label: v.label, value }))
  if (!REPEATS[form.repeat] && form.repeat !== 'none') {
    const r = repeatOf(form.repeat)
    if (r) items.push({ label: describeRule({ ...r, from: form.date }), value: form.repeat })
  }
  return sched.value ? items : [{ label: 'Does not repeat', value: 'none' }, ...items]
})
const untilError = computed(() => (scheduleMode.value && form.until && form.until <= form.date ? 'The end must be after the first date' : undefined))

// ── Options ────────────────────────────────────────────────────────────
const pockets = computed(() => new Set(L.assetAccounts.value.map((a) => a.name)))
const isPocket = (a: string) => pockets.value.has(a)
const pocketItems = computed(() =>
  L.assetAccounts.value
    .filter((a) => !a.archived || a.name === form.source || a.name === form.to)
    .map((a) => ({ label: a.label, value: a.name, icon: a.icon }))
)
const personItems = computed(() => L.personAccounts.value.map((p) => ({ label: p.label, value: p.account, icon: p.icon })))
/** transfers: any pocket or person account, in two groups */
const transferItems = computed(() => [pocketItems.value, personItems.value])
const currencyItems = computed(() =>
  store.journal.commodities.map((c) => ({ label: String(c.symbol), value: String(c.symbol), icon: currencyFlag(String(c.symbol)) }))
)
/** destination (expense) or origin (income): categories + people accounts */
const categoryItems = computed(() => {
  const cats = kind.value === 'income' ? L.incomeCategories.value : L.expenseCategories.value
  const items = [...cats.map((c) => ({ label: L.style(c).label, value: c, icon: L.style(c).icon })), ...personItems.value]
  // an edited transaction may use an account outside the usual list (e.g. a refund on an expense account)
  if (form.category && !items.some((i) => i.value === form.category)) {
    items.push({ label: L.accountLabel(form.category), value: form.category, icon: L.style(form.category).icon })
  }
  return items
})
/** split options: "Me" (the category) + people (their category or account) + any other account of an edited entry */
const forWhomOptions = computed(() => {
  const opts = [
    { key: ME, label: 'Me', color: L.personColor(ME) },
    ...L.forPeople.value.map((p) => ({ key: p.account, label: p.label, color: p.color }))
  ]
  for (const k of form.forWhom) if (!opts.some((o) => o.key === k)) opts.push({ key: k, label: L.accountLabel(k), color: L.style(k).color })
  return opts
})

/** Favorite categories, completed with the most used ones (6 chips). */
const quickCategories = computed(() => {
  const pool = categoryItems.value.map((c) => c.value)
  const fav = kind.value === 'income' ? [] : store.config.favorites.categories.filter((c) => pool.includes(c))
  const counts = new Map<string, number>()
  for (const t of store.journal.transactions) for (const p of t.postings) if (pool.includes(p.account)) counts.set(p.account, (counts.get(p.account) ?? 0) + 1)
  const byUse = [...counts].sort((a, b) => b[1] - a[1]).map(([c]) => c)
  const list = [...new Set([...fav, ...byUse, ...pool])].slice(0, 6)
  if (form.category && !list.includes(form.category)) list[list.length - 1] = form.category
  return list.map((c) => ({ value: c, ...L.style(c), label: L.accountLabel(c) }))
})

/** Last transaction of each payee that the form can rebuild, newest first. */
const lastByPayee = computed(() => {
  const out = new Map<string, FormInput>()
  for (const t of L.recent.value.slice(0, 600)) {
    if (!t.payee || out.has(t.payee)) continue
    const r = reverse(t, L.buildContext.value, isPocket)
    if (r) out.set(t.payee, r)
  }
  return out
})
const payeeNames = computed(() => [...L.payees.value.keys()].sort())
/** payee suggestions: only from 3 typed characters, at most 6 that contain the text */
const payeeFocused = ref(false)
const payeeSuggestions = computed(() => {
  const q = form.payee.trim().toLowerCase()
  if (q.length < 3) return []
  return payeeNames.value.filter((p) => p.toLowerCase().includes(q) && p.toLowerCase() !== q).slice(0, 6)
})
const showSuggestions = computed(() => payeeFocused.value && payeeSuggestions.value.length > 0)
function choosePayee(p: string) {
  pickPayee(p)
  payeeFocused.value = false
}

// ── Currencies ─────────────────────────────────────────────────────────
/** an account's fixed currency (pockets), undefined for people accounts (any currency) */
const fixedCurrency = (a: string) => L.accountCurrency(a)
const sourceCurrency = computed(() => fixedCurrency(form.source))
/** transfer: the currency leaving `from` and arriving in `to` */
const fromCur = computed(() => fixedCurrency(form.source) ?? form.currency)
const toCur = computed(() => fixedCurrency(form.to) ?? (form.toCurrency || fromCur.value))
const foreign = computed(() => kind.value === 'expense' && !!sourceCurrency.value && sourceCurrency.value !== form.currency)
const crossTransfer = computed(() => kind.value === 'transfer' && !!form.to && toCur.value !== fromCur.value)
const rate = computed(() => {
  const a = parseUserAmount(form.amount)
  const b = parseUserAmount(form.toAmount)
  if (!a || !b || a.isZero()) return ''
  return `1 ${fromCur.value} = ${b.div(a).toDecimalPlaces(6).toString()} ${toCur.value}`
})
const total = computed(() => parseUserAmount(form.amount))
/** the hero amount shows a currency picker unless the currency comes from the source pocket */
const showCurrencyPicker = computed(() => kind.value !== 'transfer' || !fixedCurrency(form.source))
const amountCurrency = computed(() => (kind.value === 'transfer' ? fromCur.value : form.currency))

// ── Prefill ────────────────────────────────────────────────────────────
/** Fill the form from a rebuilt transaction: everything (edit) or only the habits (payee). */
function apply(r: FormInput, full: boolean) {
  const i = r.input
  if (full) {
    kind.value = r.kind
    form.date = i.date
    form.payee = i.payee ?? ''
    form.note = i.note ?? ''
    form.pending = i.status === '!'
    form.extraTags = { ...(i.tags ?? {}) }
    if (i.id) form.id = i.id
  }
  if (r.kind === 'expense') {
    form.source = r.input.source
    form.currency = r.input.currency
    const lines = r.input.lines?.length ? r.input.lines : [{ account: r.input.category, amount: r.input.amount }]
    // the first non-person line is "Me" (the category); other lines keep their account
    const persons = new Set([...L.personAccounts.value.map((p) => p.account), ...L.forPeople.value.map((p) => p.account)])
    const meLine = lines.find((l) => !persons.has(l.account))
    form.category = meLine?.account ?? ''
    form.forWhom = lines.map((l) => (l === meLine ? ME : l.account))
    if (full) {
      form.amount = new Decimal(r.input.amount).toFixed(2)
      const eq = equalSplit(r.input.amount, lines.length)
      form.customSplit = lines.some((l, k) => !new Decimal(l.amount).eq(eq[k]))
      form.splitAmounts = Object.fromEntries(lines.map((l) => [l === meLine ? ME : l.account, new Decimal(l.amount).toFixed(2)]))
      form.debited = r.input.debited ? new Decimal(r.input.debited).toFixed(2) : ''
    }
    touchedCurrency.value = true
  } else if (r.kind === 'income') {
    form.source = r.input.account
    form.category = r.input.category
    form.currency = r.input.currency
    if (full) form.amount = new Decimal(r.input.amount).toFixed(2)
  } else {
    form.source = r.input.from
    form.to = r.input.to
    form.currency = r.input.currency
    form.toCurrency = r.input.toCurrency ?? ''
    if (full) {
      form.amount = new Decimal(r.input.amount).toFixed(2)
      form.toAmount = r.input.toAmount ? new Decimal(r.input.toAmount).toFixed(2) : ''
      form.fee = r.input.fee ? new Decimal(r.input.fee).toFixed(2) : ''
    }
  }
  categoryTouched.value = true
  form.showDetails = form.forWhom.length > 1 || form.forWhom[0] !== ME || !!form.fee
}

function pickPayee(p: string) {
  form.payee = p
  const r = lastByPayee.value.get(p)
  if (r && r.kind === kind.value) apply(r, false)
}
// typed payee → the habits of that payee, unless a category was already chosen
function onPayee() {
  const r = lastByPayee.value.get(form.payee.trim())
  if (r && r.kind === kind.value && !categoryTouched.value) apply(r, false)
}
function pickCategory(c: string) {
  form.category = c
  categoryTouched.value = true
}

// ── Defaults that follow the account ───────────────────────────────────
watch(
  () => form.source,
  (s, old) => {
    const a = L.assetAccounts.value.find((x) => x.name === s)
    if (!a || !old || editing.value) return
    if (a.currency && (kind.value !== 'expense' || !touchedCurrency.value)) form.currency = a.currency
  }
)

// ── Reset on open ──────────────────────────────────────────────────────
function defaults() {
  if (!form.source || !pocketItems.value.some((a) => a.value === form.source)) form.source = pocketItems.value[0]?.value ?? ''
  const acc = L.assetAccounts.value.find((a) => a.name === form.source)
  form.currency = acc?.currency ?? store.config.referenceCurrency
}
watch(
  () => entry.open.value,
  async (open) => {
    if (!open) return
    Object.assign(form, blank())
    touched.value = false
    touchedCurrency.value = false
    categoryTouched.value = false
    const tx = editing.value
    if (tx) {
      const r = reverse(tx, L.buildContext.value, isPocket)
      if (r) apply(r, true)
      return
    }
    const s = sched.value
    if (s?.rule) {
      const r = reverse(s.tx, L.buildContext.value, isPocket)
      if (r) apply(r, true)
      form.repeat = repeatKey(s.rule)
      form.date = s.rule.from
      form.until = s.rule.to ?? ''
      return
    }
    const o = occurrence.value
    if (o) {
      const r = reverse(o.schedule.tx, L.buildContext.value, isPocket)
      if (r) apply(r, true)
      form.date = o.date
      form.id = ulid()
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { skip, id, via, ...kept } = form.extraTags
      form.extraTags = { ...kept, schedule: o.schedule.id ?? '', planned: o.date }
      return
    }
    defaults()
    if (entry.repeat.value) form.repeat = 'monthly'
    const t = entry.template.value
    if (t) {
      if (t.account) form.source = t.account
      if (t.category) {
        form.category = t.category
        categoryTouched.value = true
      }
      if (t.payee) form.payee = t.payee
      if (t.note) form.note = t.note
      if (t.amount) form.amount = t.amount
      if (t.currency) form.currency = t.currency
    }
    if (!form.category) form.category = prefs.get(`lastCategory:${kind.value}`, '') || ''
    await nextTick()
    amountInput.value?.inputRef?.focus()
  }
)
// opened before the journal finished loading (cold start from a shortcut): fill defaults when it arrives
watch(pocketItems, (items) => {
  if (!entry.open.value || form.source || !items.length || editing.value) return
  defaults()
})
watch(kind, (k, old) => {
  if (editing.value && old === undefined) return
  if (!editing.value) {
    categoryTouched.value = false
    form.category = prefs.get(`lastCategory:${k}`, '')
  }
  form.forWhom = [ME]
  form.customSplit = false
})

// ── Validation (layer 1: form, Zod) ─────────────────────────────────────
const amount = z.string().refine((s) => {
  const d = parseUserAmount(s)
  return !!d && d.gt(0) && d.decimalPlaces() <= 2
}, 'Amount > 0, at most 2 decimals')
const optAmount = z.string().refine((s) => s.trim() === '' || (parseUserAmount(s)?.decimalPlaces() ?? 3) <= 2, 'At most 2 decimals')
const account = z.string().min(1, 'Choose an account')

/** split amounts actually used (equal split unless edited) */
const shares = computed(() => {
  const A = total.value
  if (!A) return []
  if (!form.customSplit) return equalSplit(A, form.forWhom.length)
  return form.forWhom.map((k) => parseUserAmount(form.splitAmounts[k]) ?? new Decimal(NaN))
})

const schema = computed(() => {
  const base = z.object({
    date: z.string().refine(isValidDate, 'Invalid date'),
    amount,
    source: account
  })
  switch (kind.value) {
    case 'expense':
      return base.extend({
        category: form.forWhom.includes(ME) ? z.string().min(1, 'Choose a category') : z.string(),
        debited: foreign.value ? amount : z.string(),
        forWhom: z.array(z.string()).refine(
          () =>
            !total.value ||
            (shares.value.every((s) => s.isFinite() && s.gt(0) && s.decimalPlaces() <= 2) &&
              shares.value.reduce((a, b) => a.plus(b), new Decimal(0)).eq(total.value)),
          'The split must add up to the amount'
        )
      })
    case 'income':
      return base.extend({ category: z.string().min(1, 'Choose where it comes from') })
    case 'transfer':
    default:
      return base.extend({
        to: account.refine((v) => v !== form.source || toCur.value !== fromCur.value, 'Choose a different account'),
        toAmount: crossTransfer.value ? amount : z.string(),
        fee: optAmount
      })
  }
})

const formErrors = computed<Record<string, string>>(() => {
  const r = schema.value.safeParse(form)
  if (r.success) return {}
  const out: Record<string, string> = {}
  for (const i of r.error.issues) out[String(i.path[0])] ??= i.message
  return out
})
const err = (k: string) => (touched.value ? formErrors.value[k] : undefined)

// ── Build the transaction ──────────────────────────────────────────────
const num = (s: string) => parseUserAmount(s)!.toString()

const tx = computed<Transaction | undefined>(() => {
  if (Object.keys(formErrors.value).length) return undefined
  const common = {
    date: form.date,
    payee: form.payee,
    note: form.note,
    id: form.id,
    status: (form.pending ? '!' : '*') as '!' | '*',
    tags: form.extraTags
  }
  const ctx = L.buildContext.value
  try {
    switch (kind.value) {
      case 'expense': {
        const single = form.forWhom.length === 1
        const input: KindInputs['expense'] = {
          ...common,
          amount: total.value!.toString(),
          currency: form.currency,
          source: form.source,
          category: single && form.forWhom[0] === ME ? form.category : single ? form.forWhom[0] : form.category,
          lines: single ? undefined : form.forWhom.map((k, i) => ({ account: k === ME ? form.category : k, amount: shares.value[i] }))
        }
        if (foreign.value) Object.assign(input, { sourceCurrency: sourceCurrency.value, debited: num(form.debited) })
        return build('expense', input, ctx)
      }
      case 'income':
        return build('income', { ...common, amount: num(form.amount), currency: form.currency, account: form.source, category: form.category }, ctx)
      case 'transfer':
        return build(
          'transfer',
          {
            ...common,
            from: form.source,
            to: form.to,
            amount: num(form.amount),
            currency: fromCur.value,
            ...(crossTransfer.value ? { toAmount: num(form.toAmount), toCurrency: toCur.value } : {}),
            fee: form.fee.trim() ? num(form.fee) : undefined
          },
          ctx
        )
    }
  } catch {
    return undefined
  }
  return undefined
})

// layer 2: pre-commit validation against the whole journal
const issues = computed(() => (tx.value ? store.check(tx.value, editing.value) : []))
const preview = computed(() => {
  if (!tx.value) return ''
  return rule.value ? formatSchedule(rule.value, tx.value) : format(tx.value)
})
const previewFile = computed(() => (rule.value ? 'journals/scheduled.journal' : `journals/${form.date.slice(0, 4)}.journal`))
const canSave = computed(() => !!tx.value && issues.value.length === 0 && !untilError.value && !saving.value)
const original = computed(() => editing.value?.src?.raw ?? sched.value?.src?.raw)
const unchanged = computed(() => !!original.value && preview.value === original.value)
const title = computed(() => {
  if (editing.value) return 'Edit transaction'
  if (sched.value) return 'Edit scheduled payment'
  if (occurrence.value) return 'Record scheduled payment'
  return scheduleMode.value ? 'New scheduled payment' : 'New entry'
})

async function save() {
  touched.value = true
  if (!canSave.value || !tx.value) return
  if (unchanged.value) {
    entry.open.value = false
    return
  }
  saving.value = true
  const id = tx.value.id
  try {
    if (rule.value) {
      await saveScheduled(rule.value, tx.value)
      entry.open.value = false
      return
    }
    if (editing.value) {
      await store.replaceTransaction(editing.value, tx.value)
      toast.add({ title: 'Updated', description: 'Committed. hledger check is running…', icon: 'material-symbols:check-rounded', color: 'success' })
    } else {
      const r = await store.addTransaction(tx.value)
      prefs.set('lastSource', form.source)
      if (form.category) prefs.set(`lastCategory:${kind.value}`, form.category)
      if (r.queued) {
        toast.add({ title: 'Saved offline', description: 'It will be committed when you are back online.', icon: 'material-symbols:inbox-outline-rounded', color: 'warning' })
      } else {
        toast.add({
          title: 'Saved',
          description: 'Committed. hledger check is running…',
          icon: 'material-symbols:check-rounded',
          color: 'success',
          actions: [{ label: 'Undo', icon: 'material-symbols:undo-rounded', color: 'neutral', variant: 'outline', onClick: () => void undo(id) }]
        })
      }
    }
    entry.open.value = false
  } catch (e) {
    const msg = e instanceof ValidationError ? e.issues.map((i) => i.message).join(' · ') : (e as Error).message
    toast.add({ title: 'Not saved', description: msg, color: 'error', icon: 'material-symbols:cancel-outline-rounded' })
  } finally {
    saving.value = false
  }
}

/** Save the schedule; a new one starting today or earlier also records its first payment. */
async function saveScheduled(r: Rule, t: Transaction) {
  await store.saveSchedule(r, t, sched.value)
  let recorded = false
  if (!sched.value && r.from <= today()) {
    const occId = ulid()
    await store.addTransaction({ ...t, id: occId, tags: { ...t.tags, id: occId, schedule: t.id ?? '', planned: r.from } }, { queueOffline: false })
    recorded = true
  }
  prefs.set('lastSource', form.source)
  toast.add({
    title: sched.value ? 'Schedule updated' : 'Scheduled',
    description: `${describeRule(r)} from ${r.from}${recorded ? ' · this payment is recorded too' : ''}.`,
    icon: 'material-symbols:event-available-outline-rounded',
    color: 'success'
  })
}

const confirmDelete = ref(false)
watch(
  () => entry.open.value,
  () => (confirmDelete.value = false)
)
async function removeSchedule() {
  const s = sched.value
  if (!s) return
  if (!confirmDelete.value) {
    confirmDelete.value = true
    return
  }
  saving.value = true
  try {
    await store.deleteSchedule(s)
    toast.add({ title: 'Schedule deleted', description: 'Past payments stay in the journal.', icon: 'material-symbols:delete-outline-rounded', color: 'neutral' })
    entry.open.value = false
  } catch (e) {
    toast.add({ title: 'Not deleted', description: (e as Error).message, color: 'error' })
  } finally {
    saving.value = false
  }
}

async function undo(id?: string) {
  const saved = store.journal.transactions.find((t) => t.id === id)
  if (!saved) return
  try {
    await store.deleteTransaction(saved)
    toast.add({ title: 'Undone', description: 'The entry was removed (one more commit).', icon: 'material-symbols:undo-rounded', color: 'neutral' })
  } catch (e) {
    toast.add({ title: 'Undo failed', description: (e as Error).message, color: 'error' })
  }
}

function setDate(offsetDays: number) {
  const d = new Date()
  d.setDate(d.getDate() - offsetDays)
  const p = (n: number) => String(n).padStart(2, '0')
  form.date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const isToday = computed(() => form.date === today())
const isYesterday = computed(() => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const p = (n: number) => String(n).padStart(2, '0')
  return form.date === `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})

/** one-line summary of the folded details */
const detailsSummary = computed(() => {
  if (kind.value === 'transfer') return form.fee ? `Fee ${form.fee} ${fromCur.value}` : 'Fee (optional)'
  if (form.forWhom.length === 1 && form.forWhom[0] === ME) return 'Split with someone…'
  return 'Split: ' + form.forWhom.map((k) => forWhomOptions.value.find((o) => o.key === k)?.label ?? k).join(', ')
})
</script>

<template>
  <UDrawer
    v-model:open="entry.open.value"
    :ui="{ content: 'max-h-[94dvh]', container: 'w-full max-w-xl mx-auto', body: 'overflow-y-auto' }"
    :title="title"
  >
    <template #header>
      <div class="w-full space-y-2">
        <div v-if="editing" class="flex items-center gap-2 text-sm font-medium">
          <UIcon name="material-symbols:edit-outline-rounded" class="size-4 text-primary" />
          Edit transaction
          <span class="text-xs text-muted font-mono ml-auto">{{ editing.src?.file }}:{{ editing.src?.startLine }}</span>
        </div>
        <div v-else-if="sched || occurrence || scheduleMode" class="flex items-center gap-2 text-sm font-medium">
          <UIcon name="material-symbols:event-repeat-outline-rounded" class="size-4 text-primary" />
          {{ title }}
          <span v-if="occurrence" class="text-xs text-muted ml-auto">due {{ occurrence.date }}</span>
        </div>
        <!-- connected button group (2dp apart, 8dp inner corners, the selected one takes the full shape) -->
        <UTabs
          v-model="kind"
          :items="kindTabs"
          :content="false"
          class="w-full"
          :ui="{
            list: 'bg-transparent p-0 gap-0.5 rounded-none',
            indicator: 'hidden',
            trigger:
              'h-10 pointer-coarse:h-12 md-label-large rounded-(--md-sys-shape-corner-small) first:rounded-l-full last:rounded-r-full bg-(--md-sys-color-surface-container-highest) text-(--md-sys-color-on-surface-variant) data-[state=active]:rounded-full data-[state=active]:bg-primary data-[state=active]:text-(--md-sys-color-on-primary) transition-[border-radius,background-color,color] duration-(--md-sys-motion-spring-fast-spatial-duration) ease-(--md-sys-motion-spring-fast-spatial)'
          }"
        />
      </div>
    </template>

    <template #body>
      <form class="space-y-4 pb-2" @submit.prevent="save">
        <!-- Amount (hero) -->
        <div class="flex flex-col items-center gap-1 pt-1">
          <div class="flex items-baseline justify-center gap-2 w-full">
            <UInput
              ref="amountInput"
              v-model="form.amount"
              inputmode="decimal"
              placeholder="0.00"
              variant="none"
              class="min-w-0 flex-1 max-w-[14rem]"
              :ui="{ base: 'text-4xl! font-semibold tabular text-center p-0' }"
              autocomplete="off"
              aria-label="Amount"
            />
            <USelect
              v-if="showCurrencyPicker"
              v-model="form.currency"
              :items="currencyItems"
              variant="ghost"
              :size="SIZE"
              class="w-32 shrink-0"
              aria-label="Currency"
              @update:model-value="touchedCurrency = true"
            >
              <template #leading><UIcon :name="currencyFlag(form.currency)" class="size-5" aria-hidden="true" /></template>
            </USelect>
            <span v-else class="inline-flex items-center gap-1.5 text-xl text-muted shrink-0">
              <UIcon v-if="amountCurrency" :name="currencyFlag(amountCurrency)" class="size-5" aria-hidden="true" />{{ amountCurrency }}
            </span>
          </div>
          <p v-if="err('amount')" class="text-xs text-error">{{ err('amount') }}</p>
        </div>

        <!-- Category (expense: where it goes / income: where it comes from); people accounts included -->
        <div v-if="kind !== 'transfer'">
          <div class="flex flex-wrap gap-2" role="group" aria-label="Category">
            <button
              v-for="c in quickCategories"
              :key="c.value"
              type="button"
              class="press inline-flex items-center gap-2 h-(--field-h) max-w-full rounded-full pl-2 pr-4 md-label-large cursor-pointer"
              :class="form.category === c.value ? 'bg-(--md-sys-color-secondary-container) text-(--md-sys-color-on-secondary-container)' : 'bg-(--md-sys-color-surface-container-highest)'"
              :aria-pressed="form.category === c.value"
              @click="pickCategory(c.value)"
            >
              <AccountIcon :icon="c.icon" :color="c.color" size="sm" />
              <span class="truncate">{{ c.label }}</span>
            </button>
            <USelectMenu
              v-model="form.category"
              :items="categoryItems"
              value-key="value"
              icon="material-symbols:search-rounded"
              placeholder="More…"
              :size="SIZE"
              class="min-w-36 flex-1"
              :aria-label="kind === 'income' ? 'Comes from' : 'Category'"
              @update:model-value="categoryTouched = true"
            />
          </div>
          <p v-if="err('category')" class="mt-1 text-xs text-error">{{ err('category') }}</p>
        </div>

        <!-- Accounts (no visible labels: icon + aria-label say what each one is) -->
        <div class="grid gap-3" :class="kind === 'transfer' ? 'grid-cols-2' : 'grid-cols-1'">
          <UFormField :error="err('source')">
            <USelect
              v-model="form.source"
              :items="kind === 'transfer' ? transferItems : pocketItems"
              :size="SIZE"
              :icon="kind === 'expense' ? 'material-symbols:account-balance-wallet-outline-rounded' : kind === 'income' ? 'material-symbols:download-rounded' : 'material-symbols:upload-rounded'"
              :aria-label="kind === 'expense' ? 'Paid with' : kind === 'income' ? 'Into account' : 'From account'"
              class="w-full"
            />
          </UFormField>
          <UFormField v-if="kind === 'transfer'" :error="err('to')">
            <USelect
              v-model="form.to"
              :items="transferItems"
              :size="SIZE"
              icon="material-symbols:download-rounded"
              placeholder="To account"
              aria-label="To account"
              class="w-full"
            />
          </UFormField>
        </div>

        <!-- Transfer to an account without a fixed currency (a person): choose what arrives -->
        <USelect
          v-if="kind === 'transfer' && form.to && !fixedCurrency(form.to)"
          :model-value="toCur"
          :items="currencyItems"
          :size="SIZE"
          aria-label="Currency received"
          class="w-full"
          @update:model-value="(v: string) => (form.toCurrency = v)"
        >
          <template #leading><UIcon :name="currencyFlag(toCur)" class="size-5" aria-hidden="true" /></template>
        </USelect>

        <!-- Received amount when currencies differ / foreign expense: debited amount -->
        <UFormField v-if="crossTransfer" :error="err('toAmount')" :hint="rate">
          <UInput v-model="form.toAmount" inputmode="decimal" :size="SIZE" :placeholder="`Received in ${toCur}`" aria-label="Received amount" class="w-full">
            <template #trailing>
              <span class="inline-flex items-center gap-1 text-xs text-muted">
                <UIcon :name="currencyFlag(toCur)" class="size-4" aria-hidden="true" />{{ toCur }}
              </span>
            </template>
          </UInput>
        </UFormField>
        <UFormField v-if="foreign" :error="err('debited')">
          <UInput v-model="form.debited" inputmode="decimal" :size="SIZE" :placeholder="`Debited from the account in ${sourceCurrency}`" aria-label="Debited amount" class="w-full">
            <template #trailing>
              <span class="inline-flex items-center gap-1 text-xs text-muted">
                <UIcon v-if="sourceCurrency" :name="currencyFlag(sourceCurrency)" class="size-4" aria-hidden="true" />{{ sourceCurrency }}
              </span>
            </template>
          </UInput>
        </UFormField>

        <!-- Split (expense) or fee (transfer): folded into one line unless needed -->
        <div v-if="kind !== 'income'" class="rounded-(--md-sys-shape-corner-extra-large) bg-(--md-sys-color-surface-container-highest)">
          <button
            type="button"
            class="w-full flex items-center justify-between gap-2 px-5 h-(--field-h) rounded-(--md-sys-shape-corner-extra-large) cursor-pointer"
            :aria-expanded="form.showDetails"
            @click="form.showDetails = !form.showDetails"
          >
            <span class="text-muted truncate">{{ detailsSummary }}</span>
            <UIcon :name="form.showDetails ? 'material-symbols:keyboard-arrow-up-rounded' : 'material-symbols:keyboard-arrow-down-rounded'" class="size-4 text-muted shrink-0" aria-hidden="true" />
          </button>
          <div v-if="form.showDetails" class="px-4 pb-4 space-y-3">
            <UFormField v-if="kind === 'expense'" :error="err('forWhom')">
              <SplitEditor
                v-model:for-whom="form.forWhom"
                v-model:amounts="form.splitAmounts"
                v-model:custom="form.customSplit"
                :options="forWhomOptions"
                :total="total"
                :currency="form.currency"
              />
            </UFormField>
            <UFormField v-if="kind === 'transfer'" :error="err('fee')">
              <UInput v-model="form.fee" inputmode="decimal" :size="SIZE" icon="material-symbols:receipt-long-outline-rounded" :placeholder="`Fee in ${fromCur} (optional)`" aria-label="Fee" class="w-full" />
            </UFormField>
          </div>
        </div>
        <p v-if="!form.showDetails && err('forWhom')" class="text-xs text-error -mt-2">{{ err('forWhom') }}</p>

        <!-- Payee: suggestions only after 3 characters -->
        <div class="relative">
          <UInput
            v-model="form.payee"
            :size="SIZE"
            icon="material-symbols:storefront-outline-rounded"
            placeholder="Payee"
            aria-label="Payee"
            class="w-full"
            autocomplete="off"
            role="combobox"
            aria-autocomplete="list"
            :aria-expanded="showSuggestions"
            aria-controls="payee-suggestions"
            @focus="payeeFocused = true"
            @blur="payeeFocused = false"
            @keydown.enter.prevent="payeeSuggestions[0] && choosePayee(payeeSuggestions[0])"
            @change="onPayee"
          />
          <ul
            v-if="showSuggestions"
            id="payee-suggestions"
            role="listbox"
            aria-label="Payee suggestions"
            class="absolute z-20 inset-x-0 mt-1 rounded-(--md-sys-shape-corner-large) bg-(--md-sys-color-surface-container) shadow-md overflow-hidden"
          >
            <li v-for="p in payeeSuggestions" :key="p" role="option" :aria-selected="false">
              <button type="button" class="press w-full text-left px-3 h-(--field-h) text-sm truncate cursor-pointer" @mousedown.prevent="choosePayee(p)">
                {{ p }}
              </button>
            </li>
          </ul>
        </div>

        <!-- Date -->
        <div class="flex flex-wrap items-start gap-2">
          <UButton :size="SIZE" :variant="isToday ? 'solid' : 'soft'" color="neutral" label="Today" @click="setDate(0)" />
          <UButton :size="SIZE" :variant="isYesterday ? 'solid' : 'soft'" color="neutral" label="Yesterday" @click="setDate(1)" />
          <UInput v-model="form.date" type="date" :size="SIZE" class="flex-1 min-w-36" aria-label="Date" />
          <p v-if="err('date')" class="w-full text-xs text-error">{{ err('date') }}</p>
        </div>

        <UButton
          variant="link"
          color="neutral"
          size="sm"
          class="tap"
          :icon="form.showMore ? 'material-symbols:keyboard-arrow-up-rounded' : 'material-symbols:keyboard-arrow-down-rounded'"
          :label="form.showMore ? 'Less' : editing || occurrence || scheduleMode ? 'Note, status' : 'Repeat, note, status'"
          @click="form.showMore = !form.showMore"
        />
        <!-- Repeat: a scheduled payment (hledger periodic transaction); under "More" unless one is being set -->
        <div v-if="!editing && !occurrence && (form.showMore || scheduleMode)" class="grid grid-cols-2 gap-3">
          <USelect
            v-model="form.repeat"
            :items="repeatItems"
            :size="SIZE"
            icon="material-symbols:repeat-rounded"
            aria-label="Repeat"
            class="w-full"
            :class="form.repeat === 'none' ? 'col-span-2' : ''"
          />
          <UInput
            v-if="form.repeat !== 'none'"
            v-model="form.until"
            type="date"
            :size="SIZE"
            aria-label="Until (optional)"
            title="Until (optional, not included)"
            class="w-full"
          >
            <template #leading><span class="text-xs text-muted">Until</span></template>
          </UInput>
          <p v-if="untilError" class="col-span-2 text-xs text-error">{{ untilError }}</p>
          <p v-else-if="scheduleMode && rule" class="col-span-2 text-xs text-muted">
            {{ describeRule(rule) }} from {{ rule.from }}<template v-if="rule.to">, until {{ rule.to }} (not included)</template>.
            <template v-if="!sched && rule.from <= today()"> This first payment is recorded now.</template>
          </p>
        </div>

        <div v-if="form.showMore" class="grid grid-cols-2 gap-3">
          <UInput v-model="form.note" :size="SIZE" icon="material-symbols:sticky-note-2-outline-rounded" placeholder="Note" aria-label="Note" class="col-span-2 w-full" />
          <div class="flex items-center">
            <USwitch v-model="form.pending" :size="SIZE" label="Pending" />
          </div>
        </div>

        <!-- Issues + preview -->
        <UAlert
          v-if="issues.length"
          color="error"
          variant="subtle"
          icon="material-symbols:cancel-outline-rounded"
          title="Cannot save"
          :description="issues.map((i) => i.message).join(' · ')"
        />
        <div v-if="preview">
          <UButton
            variant="link"
            color="neutral"
            size="xs"
            icon="material-symbols:code-blocks-outline-rounded"
            :label="form.showPreview ? 'Hide journal text' : `Journal text (${previewFile})`"
            @click="form.showPreview = !form.showPreview"
          />
          <pre v-if="form.showPreview" class="mt-1 text-[11px] leading-snug bg-elevated rounded p-2 whitespace-pre-wrap break-all">{{ preview }}</pre>
        </div>
      </form>
    </template>

    <template #footer>
      <div class="flex gap-2 safe-bottom">
        <UButton
          v-if="sched"
          variant="ghost"
          color="error"
          icon="material-symbols:delete-outline-rounded"
          :label="confirmDelete ? 'Tap again to delete' : 'Delete'"
          :size="SIZE"
          :disabled="saving"
          class="flex-1 justify-center"
          @click="removeSchedule"
        />
        <UButton v-else variant="ghost" color="neutral" label="Cancel" :size="SIZE" class="flex-1 justify-center" @click="entry.open.value = false" />
        <UButton
          :label="editing || sched ? (unchanged ? 'No changes' : 'Save changes') : scheduleMode ? 'Schedule' : 'Save'"
          icon="material-symbols:check-rounded"
          class="flex-[2] justify-center"
          :size="SIZE"
          :loading="saving"
          :disabled="touched && !canSave"
          @click="save"
        />
      </div>
    </template>
  </UDrawer>
</template>

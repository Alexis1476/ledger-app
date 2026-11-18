import { computed } from 'vue'
import { defaultIcon, defaultLabel, hashColor, lighten } from '@/config/schema'
import { Decimal, ZERO } from '@/ledger/decimal'
import { makeContext, type BuildContext } from '@/ledger/builder'
import { accountType, inclusiveBalance, isAssetType, leafAccounts, valueIn } from '@/ledger/reports'
import type { Transaction } from '@/ledger/types'
import { today } from '@/lib/format'
import { materialIcon } from '@/lib/icons'
import { useJournalStore } from '@/stores/journal'

export interface AccountView {
  name: string
  label: string
  icon: string
  color: string
  order: number
  archived: boolean
  currency?: string
  balance: Map<string, Decimal>
  valueRef?: Decimal
}

/** Balance of one account per commodity, + its value in the reference currency. */
export interface Balances {
  account: string
  balance: Map<string, Decimal>
  /** undefined when a currency has no rate to the reference currency */
  ref?: Decimal
}

/** Money to put back into someone's pockets (app.config.json → people.<key>.toReturn). */
export interface ToReturn {
  amount: Decimal
  currency: string
  since: string
  note?: string
  /** moved from my pockets into theirs since `since`, valued in `currency` */
  returned: Decimal
  remaining: Decimal
}

/**
 * A person: the money I keep for them in their pockets (mine, labelled for them), what they owe
 * me (assets:receivables:<key>) and a real debt to them if any (liabilities:people:<key>).
 */
export interface PersonView {
  key: string
  label: string
  color: string
  pockets: AccountView[]
  /** sum of their pockets */
  kept: Balances
  owed?: Balances
  owesMe?: Balances
  toReturn?: ToReturn
  /** expense/income categories for this person (accounts ending in `:<key>`) */
  categories: string[]
}

/** Per-commodity amounts plus their total in the reference currency. */
export interface BalanceLine {
  byCommodity: Map<string, Decimal>
  total: Decimal
  /** commodities without a rate to the reference currency (left out of `total`) */
  missing: string[]
}

/** a real debt to a person (liability) */
export const PEOPLE = 'liabilities:people:'
/** what each person owes me (asset) */
export const RECEIVABLES = 'assets:receivables:'

const neg = (m: Map<string, Decimal>) => new Map([...m].map(([c, q]) => [c, q.neg()]))
const complete = (v: { total: Decimal; missing: Map<string, Decimal> }) => (v.missing.size ? undefined : v.total)

export function useLedger() {
  const store = useJournalStore()

  const refCurrency = computed(() => store.config.referenceCurrency)
  const valuationDate = computed(() => {
    const last = store.journal.transactions.reduce((d, t) => (t.date > d ? t.date : d), '')
    const t = today()
    return last > t ? last : t
  })

  const declared = computed(() => store.journal.accounts.map((a) => a.name))
  const leaves = computed(() => leafAccounts(store.journal.accounts))
  const typeOf = (name: string) => accountType(name, store.journal.accounts)

  /**
   * Categories share the color of their top group (expenses:food → groceries), a bit lighter for
   * each level below it, so a group and its categories read as one family. The group's color: its
   * own in the config, else the one of its first category with a color, else a stable hash.
   */
  function groupColor(top: string): string {
    const own = store.config.categories[top]?.color
    if (own) return own
    const child = Object.entries(store.config.categories).find(([k, v]) => k.startsWith(top + ':') && v.color)?.[1].color
    return child ?? hashColor(top)
  }
  function categoryColor(name: string): string | undefined {
    const parts = name.split(':')
    if (parts[0] !== 'expenses' && parts[0] !== 'income') return undefined
    const top = parts.slice(0, 2).join(':')
    const isGroup = store.journal.accounts.some((a) => a.name.startsWith(top + ':'))
    if (!isGroup) return undefined // a category without a group keeps its own color
    return lighten(groupColor(top), Math.min(0.5, 0.22 * (parts.length - 2)))
  }

  function style(name: string) {
    const c = store.config.accounts[name] ?? store.config.categories[name] ?? {}
    // a name set in the app lives in the journal, as an account tag (label: Revolut EUR): it wins
    const tagged = store.journal.accounts.find((a) => a.name === name)?.tags.label
    return {
      label: tagged ?? c.label ?? defaultLabel(name),
      icon: materialIcon(c.icon ?? defaultIcon(name)),
      color: categoryColor(name) ?? c.color ?? hashColor(name)
    }
  }

  function accountCurrency(name: string): string | undefined {
    return store.journal.accounts.find((a) => a.name === name)?.tags.currency
  }

  function toRef(m: Map<string, Decimal>): { total: Decimal; missing: Map<string, Decimal> } {
    return valueIn(m, refCurrency.value, valuationDate.value, store.prices)
  }

  /** Physical asset accounts (leaves), ordered as in the config. */
  const assetAccounts = computed<AccountView[]>(() =>
    leaves.value
      .filter((n) => isAssetType(typeOf(n)) && !n.startsWith('assets:receivables') && !n.startsWith('assets:transit'))
      .map((name) => {
        const cfg = store.config.accounts[name] ?? {}
        const balance = store.balanceMap.get(name)?.byCommodity() ?? new Map()
        const v = toRef(balance)
        return {
          name,
          ...style(name),
          order: cfg.order ?? 100,
          archived: cfg.archived ?? false,
          currency: accountCurrency(name),
          balance,
          valueRef: v.missing.size ? undefined : v.total
        }
      })
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  )

  const otherAssets = computed(() =>
    leaves.value
      .filter((n) => n.startsWith('assets:transit'))
      .map((name) => ({ name, ...style(name), balance: store.balanceMap.get(name)?.byCommodity() ?? new Map<string, Decimal>() }))
      .filter((a) => a.balance.size > 0)
  )

  /** archived categories (tag `archived:` on the declaration) are hidden from the pickers */
  const archived = computed(() => new Set(store.journal.accounts.filter((a) => a.tags.archived).map((a) => a.name)))
  const expenseCategories = computed(() => leaves.value.filter((n) => typeOf(n) === 'X' && !archived.value.has(n)))
  const incomeCategories = computed(() => leaves.value.filter((n) => typeOf(n) === 'R' && !archived.value.has(n)))

  /** Assets − liabilities (money kept for people is mine: it counts). */
  const netWorth = computed(() => worth(() => true))
  /** My money: net worth without the pockets kept for people (what the stats are about). */
  const myWorth = computed(() => worth((a) => !keptPockets.value.all.has(a)))

  function worth(keep: (account: string) => boolean) {
    const byC = new Map<string, Decimal>()
    for (const [name, m] of store.balanceMap) {
      const t = typeOf(name)
      if (!(isAssetType(t) || t === 'L') || !keep(name)) continue
      for (const [c, q] of m.byCommodity()) byC.set(c, (byC.get(c) ?? ZERO).plus(q))
    }
    for (const [c, q] of byC) if (q.toDecimalPlaces(2).isZero()) byC.delete(c)
    return { byCommodity: byC, ...toRef(byC) }
  }

  /** Sum of several accounts per commodity (optionally negated: liabilities shown positive). */
  function total(accounts: string[], negate = false): BalanceLine {
    const byC = new Map<string, Decimal>()
    for (const a of accounts) {
      for (const [c, q] of store.balanceMap.get(a)?.byCommodity() ?? []) byC.set(c, (byC.get(c) ?? ZERO).plus(negate ? q.neg() : q))
    }
    for (const [c, q] of byC) if (q.toDecimalPlaces(2).isZero()) byC.delete(c)
    const v = toRef(byC)
    return { byCommodity: byC, total: v.total, missing: [...v.missing.keys()] }
  }

  /** Pockets kept for each person (config), and the set of all of them. */
  const keptPockets = computed(() => {
    const byPerson = new Map<string, string[]>()
    for (const [key, p] of Object.entries(store.config.people)) {
      const list = (p.pockets ?? []).filter((a) => leaves.value.includes(a))
      if (list.length) byPerson.set(key, list)
    }
    return { byPerson, all: new Set([...byPerson.values()].flat()) }
  })

  /**
   * Balance sheet: in my accounts (split: kept for each person / free) + owed to me − debts = net worth.
   */
  const balanceSheet = computed(() => {
    const L = leaves.value
    const pockets = assetAccounts.value.map((a) => a.name)
    const receivables = L.filter((n) => n.startsWith(RECEIVABLES))
    const transit = L.filter((n) => n.startsWith('assets:transit'))
    const liabilities = L.filter((n) => typeOf(n) === 'L')
    const perPerson = (accounts: string[], negate: boolean) =>
      accounts
        .map((a) => ({ key: a, label: accountLabel(a), ...total([a], negate) }))
        .filter((x) => x.byCommodity.size)
    const kept = [...keptPockets.value.byPerson].map(([key, list]) => ({ key, label: `Kept for ${personLabel(key)}`, ...total(list) }))
    const free = total([...pockets.filter((a) => !keptPockets.value.all.has(a)), ...transit])
    return {
      inAccounts: total([...pockets, ...transit]),
      inAccountsSplit: [...kept.filter((k) => k.byCommodity.size), { key: 'free', label: 'Free (mine)', ...free }],
      owedToMe: total(receivables),
      owedToMeByPerson: perPerson(receivables, false),
      owed: total(liabilities, true),
      owedByPerson: perPerson(liabilities, true)
    }
  })

  const buildContext = computed<BuildContext>(() => makeContext(refCurrency.value))

  /**
   * People accounts, shown by the person's name only ("Eva"): the account type says the side
   * (actif: they owe me / passif: a real debt to them). Picking one in a form posts exactly to that account.
   */
  const personAccounts = computed(() => {
    const list = leaves.value.flatMap((n) => {
      for (const prefix of [PEOPLE, RECEIVABLES]) {
        if (!n.startsWith(prefix)) continue
        const key = n.slice(prefix.length)
        return [{ account: n, key, label: personLabel(key), icon: 'material-symbols:person-outline-rounded', color: personColor(key) }]
      }
      return []
    })
    // same person on both sides: tell them apart
    const names = new Map<string, number>()
    for (const p of list) names.set(p.label, (names.get(p.label) ?? 0) + 1)
    return list.map((p) => (names.get(p.label)! > 1 ? { ...p, label: `${p.label} (${p.account.startsWith(PEOPLE) ? 'I owe' : 'owes me'})` } : p))
  })

  /** Display name of any account: pocket/category label, or the person's name. */
  function accountLabel(name: string): string {
    return personAccounts.value.find((p) => p.account === name)?.label ?? style(name).label
  }

  /**
   * Name of a group (parent account), e.g. "expenses:food" → "Food": its label in the config,
   * else the person's name for assets:<person>, else the segment with a capital.
   */
  function groupLabel(name: string): string {
    const c = store.journal.accounts.find((a) => a.name === name)?.tags.label ?? store.config.accounts[name]?.label ?? store.config.categories[name]?.label
    if (c) return c
    const parts = name.split(':')
    if (parts.length === 2 && store.config.people[parts[1]]) return personLabel(parts[1])
    return defaultLabel(name)
  }

  function personLabel(key: string): string {
    if (key === 'me') return 'Me'
    return store.config.people[key]?.label ?? defaultLabel(key)
  }

  function personColor(key: string): string {
    if (key === 'me') return '#10b981'
    return store.config.people[key]?.color ?? hashColor(key)
  }

  function balancesOf(account: string, negate: boolean): Balances | undefined {
    if (!leaves.value.includes(account)) return undefined
    const raw = inclusiveBalance(store.balanceMap, account).byCommodity()
    const balance = negate ? neg(raw) : raw
    return { account, balance, ref: complete(toRef(balance)) }
  }

  /** Categories for a person: expense/income leaves ending in `:<key>` (e.g. expenses:transfers:family:max). */
  function personCategories(key: string) {
    return leaves.value.filter((n) => n.endsWith(`:${key}`) && ['X', 'R'].includes(typeOf(n) ?? ''))
  }

  /**
   * "For whom" in a split: the person's expense category (expenses:family:max) or their account (Eva),
   * shown by the person's name.
   */
  const forPeople = computed(() => {
    const keys = new Set<string>(Object.keys(store.config.people))
    for (const p of personAccounts.value) keys.add(p.key)
    return [...keys].flatMap((key) => {
      const account = personCategories(key).find((n) => typeOf(n) === 'X') ?? personAccounts.value.find((p) => p.key === key)?.account
      return account ? [{ key, account, label: personLabel(key), color: personColor(key) }] : []
    })
  })

  /** Money moved from my pockets into the person's pockets since `since`, valued in `currency`. */
  function returnedTo(pockets: string[], currency: string, since: string): Decimal {
    let sum = ZERO
    for (const t of store.journal.transactions) {
      if (t.date < since) continue
      const fromMine = t.postings.some(
        (p) => p.amount?.qty.isNeg() && isAssetType(typeOf(p.account)) && !keptPockets.value.all.has(p.account) && !p.account.startsWith(RECEIVABLES)
      )
      if (!fromMine) continue
      for (const p of t.postings) {
        if (!p.amount || !pockets.includes(p.account) || !p.amount.qty.gt(0)) continue
        const m = new Map([[p.amount.commodity, p.amount.qty]])
        sum = sum.plus(valueIn(m, currency, t.date, store.prices).total)
      }
    }
    return sum
  }

  /** Everyone in the config, with receivables or debts. */
  const people = computed<PersonView[]>(() => {
    const keys = new Set<string>(Object.keys(store.config.people))
    for (const n of leaves.value) for (const prefix of [PEOPLE, RECEIVABLES]) if (n.startsWith(prefix)) keys.add(n.slice(prefix.length))
    const accounts = new Map(assetAccounts.value.map((a) => [a.name, a]))
    return [...keys].map((key) => {
      const pocketNames = keptPockets.value.byPerson.get(key) ?? []
      const balance = new Map<string, Decimal>()
      for (const a of pocketNames) for (const [c, q] of store.balanceMap.get(a)?.byCommodity() ?? []) balance.set(c, (balance.get(c) ?? ZERO).plus(q))
      for (const [c, q] of balance) if (q.toDecimalPlaces(2).isZero()) balance.delete(c)
      const cfg = store.config.people[key]?.toReturn
      let toReturn: ToReturn | undefined
      if (cfg) {
        const amount = new Decimal(cfg.amount)
        const returned = returnedTo(pocketNames, cfg.currency, cfg.since)
        const remaining = Decimal.max(ZERO, amount.minus(returned)).toDecimalPlaces(2)
        toReturn = { amount, currency: cfg.currency, since: cfg.since, note: cfg.note, returned, remaining }
      }
      return {
        key,
        label: personLabel(key),
        color: personColor(key),
        pockets: pocketNames.map((n) => accounts.get(n)).filter((a): a is AccountView => !!a),
        kept: { account: '', balance, ref: complete(toRef(balance)) },
        owed: balancesOf(PEOPLE + key, true),
        owesMe: balancesOf(RECEIVABLES + key, false),
        toReturn,
        categories: personCategories(key)
      }
    })
  })

  const payees = computed(() => {
    const seen = new Map<string, Transaction>()
    for (const t of store.journal.transactions) if (t.payee) seen.set(t.payee, t)
    return seen
  })

  const recent = computed(() =>
    [...store.journal.transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.index ?? 0) - (a.index ?? 0)))
  )

  /** The category posting of a transaction, for the list icon. */
  function mainAccount(tx: Transaction): string {
    const order = ['X', 'R']
    for (const t of order) {
      const p = tx.postings.find((p) => typeOf(p.account) === t)
      if (p) return p.account
    }
    return tx.postings[0]?.account ?? ''
  }

  /** Amount shown in lists: the change of my physical accounts, else the first posting. */
  function displayAmount(tx: Transaction): { qty: Decimal; commodity: string } | undefined {
    const assetPosts = tx.postings.filter((p) => p.amount && isAssetType(typeOf(p.account)))
    if (assetPosts.length) {
      const c = assetPosts[0].amount!.commodity
      const qty = assetPosts.filter((p) => p.amount!.commodity === c).reduce((s, p) => s.plus(p.amount!.qty), ZERO)
      if (!qty.isZero()) return { qty, commodity: c }
      // transfers between my accounts: show the moved amount
      const out = assetPosts.find((p) => p.amount!.qty.isNeg())
      if (out) return { qty: out.amount!.qty.abs(), commodity: out.amount!.commodity }
    }
    const p = tx.postings.find((p) => p.amount)
    return p ? { qty: p.amount!.qty, commodity: p.amount!.commodity } : undefined
  }

  return {
    refCurrency,
    valuationDate,
    declared,
    leaves,
    typeOf,
    style,
    accountCurrency,
    toRef,
    assetAccounts,
    otherAssets,
    expenseCategories,
    incomeCategories,
    archived,
    buildContext,
    personAccounts,
    forPeople,
    keptPockets,
    accountLabel,
    groupLabel,
    personLabel,
    personColor,
    netWorth,
    myWorth,
    balanceSheet,
    people,
    payees,
    recent,
    mainAccount,
    displayAmount
  }
}

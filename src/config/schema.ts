import { z } from 'zod'

/** `app.config.json` in ledger-data (docs/08). Presentation only, never financial data. */

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be #rrggbb')

/**
 * A person, by key. `pockets`: my pockets kept for them (an internal label: the money is mine).
 * Accounts by convention: assets:receivables:<key> (they owe me), liabilities:people:<key> (a real
 * debt), expense/income categories ending in `:<key>` (e.g. expenses:transfers:family:<key>).
 * `toReturn`: a reminder of money to put back into their pockets (counted from `since`).
 */
export const PersonSchema = z.looseObject({
  label: z.string(),
  color: color.optional(),
  pockets: z.array(z.string()).optional(),
  toReturn: z
    .object({ amount: z.string(), currency: z.string(), since: z.string(), note: z.string().optional() })
    .optional()
})

export const AccountStyleSchema = z.looseObject({
  label: z.string().optional(),
  icon: z.string().optional(),
  color: color.optional(),
  order: z.number().optional(),
  archived: z.boolean().optional(),
  /** legacy (rules-based form), ignored */
  defaultOwner: z.string().optional()
})

export const CategoryStyleSchema = z.looseObject({
  label: z.string().optional(),
  icon: z.string().optional(),
  color: color.optional()
})

export const TemplateSchema = z.looseObject({
  name: z.string(),
  kind: z.string(),
  account: z.string().optional(),
  category: z.string().optional(),
  payee: z.string().optional(),
  note: z.string().optional(),
  amount: z.string().optional(),
  currency: z.string().optional()
})

export const AppConfigSchema = z.looseObject({
  version: z.literal(1).default(1),
  referenceCurrency: z.string().default('CHF'),
  people: z.record(z.string(), PersonSchema).default({}),
  accounts: z.record(z.string(), AccountStyleSchema).default({}),
  categories: z.record(z.string(), CategoryStyleSchema).default({}),
  templates: z.array(TemplateSchema).default([]),
  favorites: z.looseObject({ categories: z.array(z.string()).default([]) }).default({ categories: [] })
})

export type AppConfig = z.infer<typeof AppConfigSchema>
export type AccountStyle = z.infer<typeof AccountStyleSchema>
export type CategoryStyle = z.infer<typeof CategoryStyleSchema>
export type Template = z.infer<typeof TemplateSchema>

export const defaultConfig: AppConfig = AppConfigSchema.parse({
  people: {}
})

export interface ConfigResult {
  config: AppConfig
  errors: string[]
}

export function parseConfig(text: string | undefined): ConfigResult {
  if (!text) return { config: defaultConfig, errors: [] }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { config: defaultConfig, errors: [`app.config.json is not valid JSON: ${(e as Error).message}`] }
  }
  const r = AppConfigSchema.safeParse(raw)
  if (!r.success) {
    return { config: defaultConfig, errors: r.error.issues.map((i) => `app.config.json ${i.path.join('.')}: ${i.message}`) }
  }
  return { config: r.data, errors: [] }
}

/** Keys under accounts/categories that are neither declared accounts nor their parents (docs/08: warn). */
export function configWarnings(config: AppConfig, declared: string[]): string[] {
  const set = new Set(declared)
  const known = (k: string) => set.has(k) || declared.some((d) => d.startsWith(k + ':'))
  const keys = [...Object.keys(config.accounts), ...Object.keys(config.categories)]
  return keys.filter((k) => !known(k)).map((k) => `app.config.json: "${k}" is not a declared account`)
}

/** Stable color from an account name, for accounts missing from the config. */
export function hashColor(name: string): string {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const hue = h % 360
  // hsl(hue, 65%, 50%) → hex
  const s = 0.65
  const l = 0.5
  const k = (n: number) => (n + hue / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0')
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`
}

/** `hex` mixed with white: ratio 0 = the same color, 1 = white. */
export function lighten(hex: string, ratio: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const ch = (shift: number) => {
    const v = (n >> shift) & 255
    return Math.round(v + (255 - v) * ratio)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${ch(16)}${ch(8)}${ch(0)}`
}

const defaultIcons: [RegExp, string][] = [
  [/^assets:cash/, 'material-symbols:payments-outline-rounded'],
  [/^assets:receivables/, 'material-symbols:volunteer-activism-outline-rounded'],
  [/^assets:transit/, 'material-symbols:route-outline'],
  [/^assets/, 'material-symbols:account-balance-outline-rounded'],
  [/^liabilities:people/, 'material-symbols:person-outline-rounded'],
  [/^liabilities/, 'material-symbols:credit-card-outline'],
  [/^income:work:freelance/, 'material-symbols:laptop-mac-outline-rounded'],
  [/^income:work:allowances/, 'material-symbols:receipt-long-outline-rounded'],
  [/^income:work/, 'material-symbols:work-outline-rounded'],
  [/^income:transfers:gifts/, 'material-symbols:redeem-rounded'],
  [/^income:transfers/, 'material-symbols:volunteer-activism-outline-rounded'],
  [/^income:interest/, 'material-symbols:percent-rounded'],
  [/^income/, 'material-symbols:trending-up-rounded'],
  [/^expenses:food/, 'material-symbols:shopping-cart-outline-rounded'],
  [/^expenses:dining:bars/, 'material-symbols:local-cafe-outline-rounded'],
  [/^expenses:dining/, 'material-symbols:restaurant-rounded'],
  [/^expenses:housing/, 'material-symbols:home-outline-rounded'],
  [/^expenses:shopping:clothes/, 'material-symbols:apparel-outline-rounded'],
  [/^expenses:shopping:electronics/, 'material-symbols:laptop-mac-outline-rounded'],
  [/^expenses:shopping/, 'material-symbols:shopping-bag-outline-rounded'],
  [/^expenses:health/, 'material-symbols:ecg-heart-outline-rounded'],
  [/^expenses:insurance/, 'material-symbols:shield-outline-rounded'],
  [/^expenses:transport:taxi/, 'material-symbols:local-taxi-outline-rounded'],
  [/^expenses:transport:car/, 'material-symbols:directions-car-outline-rounded'],
  [/^expenses:transport/, 'material-symbols:train-outline-rounded'],
  [/^expenses:travel/, 'material-symbols:flight-rounded'],
  [/^expenses:leisure:photo/, 'material-symbols:photo-camera-outline-rounded'],
  [/^expenses:leisure:streaming/, 'material-symbols:tv-outline-rounded'],
  [/^expenses:leisure:video-games/, 'material-symbols:sports-esports-outline-rounded'],
  [/^expenses:leisure:sport/, 'material-symbols:fitness-center-rounded'],
  [/^expenses:leisure/, 'material-symbols:celebration-outline-rounded'],
  [/^expenses:communication:mobile/, 'material-symbols:smartphone-outline'],
  [/^expenses:communication:software/, 'material-symbols:web-asset-rounded'],
  [/^expenses:communication/, 'material-symbols:wifi-rounded'],
  [/^expenses:education/, 'material-symbols:school-outline-rounded'],
  [/^expenses:pets/, 'material-symbols:pets'],
  [/^expenses:personal-care/, 'material-symbols:auto-awesome-outline-rounded'],
  [/^expenses:taxes/, 'material-symbols:account-balance-outline-rounded'],
  [/^expenses:fees/, 'material-symbols:receipt-long-outline-rounded'],
  [/^expenses:transfers:gifts/, 'material-symbols:redeem-rounded'],
  [/^expenses:transfers/, 'material-symbols:send-outline-rounded'],
  [/^expenses/, 'material-symbols:paid-outline-rounded']
]

export function defaultIcon(account: string): string {
  return defaultIcons.find(([re]) => re.test(account))?.[1] ?? 'material-symbols:circle-outline'
}

/** Last segment(s) of an account name, title-cased: expenses:food:groceries → Groceries */
export function defaultLabel(account: string): string {
  const parts = account.split(':')
  const last = parts[parts.length - 1]
  return last.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

/**
 * The app's menu, shared by the desktop sidebar and the phone's "More" menu: grouped sections,
 * each entry with its own color (CSS variables --nav-<key> in main.css, light and dark).
 */
export interface NavItem {
  key: string
  label: string
  description: string
  icon: string
  to: string
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Daily',
    items: [
      { key: 'home', label: 'Home', description: 'Balances and this month', icon: 'material-symbols:home-outline-rounded', to: '/' },
      { key: 'transactions', label: 'Transactions', description: 'Every entry, with filters', icon: 'material-symbols:format-list-bulleted-rounded', to: '/transactions' },
      { key: 'budgets', label: 'Budgets', description: 'A monthly limit per category', icon: 'material-symbols:savings-outline-rounded', to: '/budgets' },
      { key: 'insights', label: 'Insights', description: 'Charts you can arrange and filter', icon: 'material-symbols:monitoring', to: '/insights' },
      { key: 'shopping', label: 'Shopping list', description: 'What to buy', icon: 'material-symbols:shopping-cart-outline-rounded', to: '/shopping' },
      { key: 'scheduled', label: 'Scheduled', description: 'Planned payments, what is due', icon: 'material-symbols:event-repeat-outline-rounded', to: '/scheduled' }
    ]
  },
  {
    title: 'People',
    items: [
      { key: 'people', label: 'People', description: 'Money you keep for someone', icon: 'material-symbols:group-outline-rounded', to: '/people' },
      { key: 'loans', label: 'Loans', description: 'Who owes me, whom I owe', icon: 'material-symbols:handshake-outline-rounded', to: '/loans' }
    ]
  },
  {
    title: 'My things',
    items: [
      { key: 'accounts', label: 'Accounts', description: 'Bank accounts, cards, cash', icon: 'material-symbols:account-balance-wallet-outline-rounded', to: '/accounts' },
      { key: 'inventory', label: 'Inventory', description: 'My things and what they cost', icon: 'material-symbols:package-2-outline', to: '/inventory' }
    ]
  },
  {
    title: 'Accounting',
    items: [
      { key: 'accounting', label: 'Accounting', description: 'Balance sheet, income statement, cash flow', icon: 'material-symbols:balance-rounded', to: '/accounting' },
      { key: 'chart', label: 'Chart of accounts', description: 'Expense and revenue categories', icon: 'material-symbols:account-tree-outline-rounded', to: '/chart' }
    ]
  },
  {
    title: 'App',
    items: [{ key: 'settings', label: 'Settings', description: 'Data source, token, preferences', icon: 'material-symbols:settings-outline-rounded', to: '/settings' }]
  }
]

/**
 * Classes of an entry's color, written out in full so that Tailwind generates them: the icon
 * (text) and its tile (a light tint of the same color).
 */
const COLORS: Record<string, { text: string; tile: string }> = {
  home: { text: 'text-(--nav-home)', tile: 'bg-(--nav-home)/12' },
  transactions: { text: 'text-(--nav-transactions)', tile: 'bg-(--nav-transactions)/12' },
  budgets: { text: 'text-(--nav-budgets)', tile: 'bg-(--nav-budgets)/12' },
  insights: { text: 'text-(--nav-insights)', tile: 'bg-(--nav-insights)/12' },
  shopping: { text: 'text-(--nav-shopping)', tile: 'bg-(--nav-shopping)/12' },
  scheduled: { text: 'text-(--nav-scheduled)', tile: 'bg-(--nav-scheduled)/12' },
  people: { text: 'text-(--nav-people)', tile: 'bg-(--nav-people)/12' },
  loans: { text: 'text-(--nav-loans)', tile: 'bg-(--nav-loans)/12' },
  accounts: { text: 'text-(--nav-accounts)', tile: 'bg-(--nav-accounts)/12' },
  inventory: { text: 'text-(--nav-inventory)', tile: 'bg-(--nav-inventory)/12' },
  accounting: { text: 'text-(--nav-accounting)', tile: 'bg-(--nav-accounting)/12' },
  chart: { text: 'text-(--nav-chart)', tile: 'bg-(--nav-chart)/12' },
  settings: { text: 'text-(--nav-settings)', tile: 'bg-(--nav-settings)/12' },
}
/** The menu for this ledger: People only appears once money is kept for someone (app.config.json). */
export function navGroups(hasPeople: boolean): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => hasPeople || i.key !== 'people') })).filter((g) => g.items.length)
}
export const navColor = (key: string) => COLORS[key]?.text ?? 'text-muted'
export const navTile = (key: string) => COLORS[key]?.tile ?? 'bg-elevated'

import { createRouter, createWebHistory } from 'vue-router'
import HomePage from './pages/HomePage.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomePage },
    { path: '/transactions', name: 'transactions', component: () => import('./pages/TransactionsPage.vue') },
    { path: '/budgets', name: 'budgets', component: () => import('./pages/BudgetsPage.vue') },
    { path: '/insights', name: 'insights', component: () => import('./pages/InsightsPage.vue') },
    { path: '/chart', name: 'chart', component: () => import('./pages/ChartPage.vue') },
    { path: '/accounts', name: 'manage-accounts', component: () => import('./pages/ManageAccountsPage.vue') },
    { path: '/accounts/:name', name: 'account', component: () => import('./pages/AccountPage.vue') },
    { path: '/people', name: 'people', component: () => import('./pages/PeoplePage.vue') },
    { path: '/shopping', name: 'shopping', component: () => import('./pages/ShoppingPage.vue') },
    { path: '/loans', name: 'loans', component: () => import('./pages/LoansPage.vue') },
    { path: '/inventory', name: 'inventory', component: () => import('./pages/InventoryPage.vue') },
    { path: '/scheduled', name: 'scheduled', component: () => import('./pages/SchedulePage.vue') },
    { path: '/accounting', name: 'accounting', component: () => import('./pages/AccountingPage.vue') },
    { path: '/settings', name: 'settings', component: () => import('./pages/SettingsPage.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})

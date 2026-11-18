/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'
import { VitePWA } from 'vite-plugin-pwa'
import localData from './vite-plugin-local-data.ts'

export default defineConfig({
  plugins: [
    vue(),
    localData(),
    ui({
      ui: {
        colors: { primary: 'blue', neutral: 'slate' },
        // Material Symbols (rounded) for the icons the components draw themselves
        icons: {
          arrowDown: 'material-symbols:arrow-downward-rounded',
          arrowLeft: 'material-symbols:arrow-back-rounded',
          arrowRight: 'material-symbols:arrow-forward-rounded',
          arrowUp: 'material-symbols:arrow-upward-rounded',
          caution: 'material-symbols:error-outline-rounded',
          check: 'material-symbols:check-rounded',
          chevronDoubleLeft: 'material-symbols:keyboard-double-arrow-left-rounded',
          chevronDoubleRight: 'material-symbols:keyboard-double-arrow-right-rounded',
          chevronDown: 'material-symbols:keyboard-arrow-down-rounded',
          chevronLeft: 'material-symbols:chevron-left-rounded',
          chevronRight: 'material-symbols:chevron-right-rounded',
          chevronUp: 'material-symbols:keyboard-arrow-up-rounded',
          close: 'material-symbols:close-rounded',
          copy: 'material-symbols:content-copy-outline-rounded',
          copyCheck: 'material-symbols:check-rounded',
          dark: 'material-symbols:dark-mode-outline-rounded',
          drag: 'material-symbols:drag-indicator',
          ellipsis: 'material-symbols:more-horiz',
          error: 'material-symbols:cancel-outline-rounded',
          external: 'material-symbols:arrow-outward-rounded',
          eye: 'material-symbols:visibility-outline-rounded',
          eyeOff: 'material-symbols:visibility-off-outline-rounded',
          file: 'material-symbols:draft-outline-rounded',
          folder: 'material-symbols:folder-outline-rounded',
          folderOpen: 'material-symbols:folder-open-outline-rounded',
          hash: 'material-symbols:tag-rounded',
          info: 'material-symbols:info-outline-rounded',
          light: 'material-symbols:light-mode-outline-rounded',
          loading: 'material-symbols:progress-activity',
          menu: 'material-symbols:menu-rounded',
          minus: 'material-symbols:remove-rounded',
          panelClose: 'material-symbols:left-panel-close-outline-rounded',
          panelOpen: 'material-symbols:left-panel-open-outline-rounded',
          plus: 'material-symbols:add-rounded',
          reload: 'material-symbols:refresh-rounded',
          search: 'material-symbols:search-rounded',
          stop: 'material-symbols:stop-outline-rounded',
          star: 'material-symbols:star-outline-rounded',
          success: 'material-symbols:check-circle-outline-rounded',
          system: 'material-symbols:computer-outline-rounded',
          tip: 'material-symbols:lightbulb-outline-rounded',
          upload: 'material-symbols:upload-rounded',
          warning: 'material-symbols:warning-outline-rounded'
        },
        // Material 3 Expressive, component by component (specs: Material Components docs + Compose tokens)
        // card: corner medium, surface-bright on the surface-container page, no outline, no shadow
        card: {
          slots: { root: 'bg-(--app-card) rounded-(--md-sys-shape-corner-medium)' },
          variants: { variant: { outline: { root: 'bg-(--app-card) ring-0 divide-y divide-default' } } }
        },
        // buttons: full shape, label-large; pressed, the shape morphs to the small corner (fast spatial spring)
        button: {
          slots: {
            base: 'rounded-full font-medium transition-[border-radius,background-color,color,box-shadow] duration-(--md-sys-motion-spring-fast-spatial-duration) ease-(--md-sys-motion-spring-fast-spatial) active:rounded-(--md-sys-shape-corner-small)'
          },
          // heights: XS 32dp, S 40dp (default), M 56dp
          variants: {
            size: {
              sm: { base: 'h-8 px-3' },
              md: { base: 'h-10 px-4' },
              lg: { base: 'h-12 px-5' },
              xl: { base: 'h-14 px-6 text-base' }
            }
          },
          compoundVariants: [
            { square: true, size: 'sm', class: 'w-8 px-0 justify-center' },
            { square: true, size: 'md', class: 'w-10 px-0 justify-center' },
            { square: true, size: 'lg', class: 'w-12 px-0 justify-center' },
            { square: true, size: 'xl', class: 'w-14 px-0 justify-center' },
            // filled tonal = secondary container
            {
              color: 'primary',
              variant: 'soft',
              class: 'bg-(--md-sys-color-secondary-container) text-(--md-sys-color-on-secondary-container) hover:bg-(--md-sys-color-secondary-container)/80 active:bg-(--md-sys-color-secondary-container)/80'
            },
            { color: 'primary', variant: 'solid', class: 'text-(--md-sys-color-on-primary)' }
          ]
        },
        badge: { slots: { base: 'rounded-(--md-sys-shape-corner-small)' } },
        // color roles of the fields: container surface-container-highest, input on-surface,
        // placeholder and icons on-surface-variant; their menus: surface-container, corner large
        // fields: one style everywhere. Filled (surface-container-highest), no outline, full shape,
        // a 2dp primary ring on focus; 40 / 48 / 56dp by size
        input: { slots: { base: 'rounded-full', leadingIcon: 'text-(--md-sys-color-on-surface-variant)', trailingIcon: 'text-(--md-sys-color-on-surface-variant)' }, variants: { variant: { outline: 'text-(--md-sys-color-on-surface) placeholder:text-(--md-sys-color-on-surface-variant) bg-(--md-sys-color-surface-container-highest) ring-0' }, size: { md: { base: 'h-10 px-4' }, lg: { base: 'h-12 px-4' }, xl: { base: 'h-14 px-5' } } } },
        select: { slots: { base: 'rounded-full', leadingIcon: 'text-(--md-sys-color-on-surface-variant)', trailingIcon: 'text-(--md-sys-color-on-surface-variant)', content: 'bg-(--md-sys-color-surface-container) ring-0 shadow-md rounded-(--md-sys-shape-corner-large)' }, variants: { variant: { outline: 'text-(--md-sys-color-on-surface) placeholder:text-(--md-sys-color-on-surface-variant) bg-(--md-sys-color-surface-container-highest) ring-0' }, size: { md: { base: 'h-10 px-4' }, lg: { base: 'h-12 px-4' }, xl: { base: 'h-14 px-5' } } } },
        selectMenu: { slots: { base: 'rounded-full', leadingIcon: 'text-(--md-sys-color-on-surface-variant)', trailingIcon: 'text-(--md-sys-color-on-surface-variant)', content: 'bg-(--md-sys-color-surface-container) ring-0 shadow-md rounded-(--md-sys-shape-corner-large)' }, variants: { variant: { outline: 'text-(--md-sys-color-on-surface) placeholder:text-(--md-sys-color-on-surface-variant) bg-(--md-sys-color-surface-container-highest) ring-0' }, size: { md: { base: 'h-10 px-4' }, lg: { base: 'h-12 px-4' }, xl: { base: 'h-14 px-5' } } } },
        inputMenu: { slots: { base: 'rounded-full', leadingIcon: 'text-(--md-sys-color-on-surface-variant)', trailingIcon: 'text-(--md-sys-color-on-surface-variant)', content: 'bg-(--md-sys-color-surface-container) ring-0 shadow-md rounded-(--md-sys-shape-corner-large)' }, variants: { variant: { outline: 'text-(--md-sys-color-on-surface) placeholder:text-(--md-sys-color-on-surface-variant) bg-(--md-sys-color-surface-container-highest) ring-0' }, size: { md: { base: 'h-10 px-4' }, lg: { base: 'h-12 px-4' }, xl: { base: 'h-14 px-5' } } } },
        textarea: {
          slots: { base: 'rounded-(--md-sys-shape-corner-large)' },
          variants: { variant: { outline: 'text-(--md-sys-color-on-surface) placeholder:text-(--md-sys-color-on-surface-variant) bg-(--md-sys-color-surface-container-highest) ring-0' } }
        },
        // checkbox: 2dp corner, 2dp on-surface-variant outline
        checkbox: { slots: { base: 'rounded-[2px] ring-2 ring-(--md-sys-color-on-surface-variant)' } },
        // menus: surface-container, corner large, no outline
        dropdownMenu: { slots: { content: 'bg-(--md-sys-color-surface-container) ring-0 shadow-md rounded-(--md-sys-shape-corner-large)' } },
        popover: { slots: { content: 'bg-(--md-sys-color-surface-container) ring-0 shadow-md rounded-(--md-sys-shape-corner-large)' } },
        // bottom sheet: surface-container-low, corner extra-large on top, on-surface-variant handle, scrim 32%
        drawer: {
          slots: {
            overlay: 'fixed inset-0 bg-(--md-sys-color-scrim)/32',
            handle: '!bg-(--md-sys-color-on-surface-variant) opacity-40',
            title: 'md-title-large font-normal text-(--md-sys-color-on-surface)',
            description: 'md-body-medium text-(--md-sys-color-on-surface-variant)'
          },
          variants: { direction: { bottom: { content: 'rounded-t-(--md-sys-shape-corner-extra-large) ring-0 bg-(--md-sys-color-surface-container-low)' } } }
        },
        // dialog: surface-container-high, corner extra-large, 24dp padding, scrim 32%;
        // headline-small title (on-surface), body-medium supporting text (on-surface-variant)
        modal: {
          slots: {
            content: 'bg-(--md-sys-color-surface-container-high) rounded-(--md-sys-shape-corner-extra-large)! ring-0! shadow-none! divide-y-0',
            header: 'p-6 pb-0 sm:px-6 min-h-0',
            body: 'p-6 sm:p-6 text-(--md-sys-color-on-surface-variant)',
            footer: 'p-6 pt-0 sm:px-6 justify-end',
            title: 'md-headline-small font-normal text-(--md-sys-color-on-surface)',
            description: 'md-body-medium text-(--md-sys-color-on-surface-variant)',
            close: 'top-5 end-5'
          },
          variants: { overlay: { true: { overlay: 'bg-(--md-sys-color-scrim)/32' } } }
        },
        // snackbar: inverse surface, corner extra-small
        toast: {
          slots: {
            root: 'bg-inverted ring-0 rounded-(--md-sys-shape-corner-extra-small) shadow-lg',
            title: 'text-inverted font-normal',
            description: 'text-inverted/80',
            close: 'text-inverted'
          }
        },
        // top app bar (small): flat on the page, title-large
        dashboardNavbar: { slots: { root: 'border-b-0', title: 'md-title-large font-normal' } }
      }
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Ledger',
        short_name: 'Ledger',
        description: 'Personal finance on plain-text accounting',
        theme_color: '#1e40af',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ],
        shortcuts: [
          { name: 'New expense', short_name: 'Expense', url: '/?new=expense', icons: [{ src: 'pwa-192.png', sizes: '192x192' }] },
          { name: 'New income', short_name: 'Income', url: '/?new=income', icons: [{ src: 'pwa-192.png', sizes: '192x192' }] },
          { name: 'New transfer', short_name: 'Transfer', url: '/?new=transfer', icons: [{ src: 'pwa-192.png', sizes: '192x192' }] }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        // GitHub API responses are cached by the app itself (IndexedDB), never by the SW
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Nuxt UI fetches icons from Iconify on first use: keep them for offline starts
            urlPattern: /^https:\/\/api\.(iconify\.design|simplesvg\.com|unisvg\.com)\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'iconify',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      }
    })
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node'
  }
})

<script setup lang="ts">
import { computed } from 'vue'
import { equalSplit } from '@/ledger/builder'
import { Decimal, ZERO } from '@/ledger/decimal'
import { money, parseUserAmount } from '@/lib/format'

/** Who an expense was for, with an amount per person (equal split unless edited). */
const props = defineProps<{
  options: { key: string; label: string; color: string }[]
  total?: Decimal
  currency: string
}>()
const forWhom = defineModel<string[]>('forWhom', { required: true })
const amounts = defineModel<Record<string, string>>('amounts', { required: true })
const custom = defineModel<boolean>('custom', { required: true })

function toggle(k: string) {
  const i = forWhom.value.indexOf(k)
  if (i >= 0) {
    if (forWhom.value.length > 1) forWhom.value = forWhom.value.filter((x) => x !== k)
  } else forWhom.value = [...forWhom.value, k]
  custom.value = false
}

const equal = computed(() => (props.total && forWhom.value.length ? equalSplit(props.total, forWhom.value.length) : []))
const shown = (k: string, i: number) => (custom.value ? amounts.value[k] ?? '' : equal.value[i]?.toFixed(2) ?? '')

function edit(k: string, v: string | number) {
  if (!custom.value) {
    amounts.value = Object.fromEntries(forWhom.value.map((w, i) => [w, equal.value[i]?.toFixed(2) ?? '']))
    custom.value = true
  }
  amounts.value = { ...amounts.value, [k]: String(v) }
}

const sum = computed(() => forWhom.value.reduce((s, k, i) => s.plus(parseUserAmount(shown(k, i)) ?? ZERO), ZERO))
const off = computed(() => (props.total && custom.value && !sum.value.eq(props.total) ? props.total.minus(sum.value) : undefined))
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap gap-2" role="group" aria-label="For whom">
      <UButton
        v-for="o in options"
        :key="o.key"
        size="xl"
        :variant="forWhom.includes(o.key) ? 'solid' : 'outline'"
        color="neutral"
        :label="o.label"
        @click="toggle(o.key)"
      >
        <template #leading><span class="size-2 rounded-full" :style="{ backgroundColor: o.color }" /></template>
      </UButton>
    </div>
    <div v-if="forWhom.length > 1" class="rounded-md border border-default p-2 space-y-1.5">
      <div v-for="(k, i) in forWhom" :key="k" class="flex items-center gap-2">
        <span class="text-sm flex-1 truncate">{{ options.find((o) => o.key === k)?.label ?? k }}</span>
        <UInput
          :model-value="shown(k, i)"
          inputmode="decimal"
          size="xl"
          class="w-32"
          :ui="{ base: 'text-right tabular' }"
          @update:model-value="(v: string | number) => edit(k, v)"
        />
        <span class="text-xs text-muted w-10">{{ currency }}</span>
      </div>
      <div class="flex items-center justify-between text-xs">
        <span :class="off ? 'text-error' : 'text-muted'">
          <template v-if="off">{{ money(off.abs(), currency) }} {{ off.isPos() ? 'left to assign' : 'too much' }}</template>
          <template v-else>{{ custom ? 'Custom split' : 'Equal split' }}</template>
        </span>
        <UButton v-if="custom" size="xs" variant="link" label="Split equally" @click="custom = false" />
      </div>
    </div>
  </div>
</template>

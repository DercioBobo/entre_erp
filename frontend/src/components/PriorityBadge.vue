<script setup>
import { computed } from "vue";

const props = defineProps({ priority: String });

const CONFIG = {
    Low:    "text-slate-400",
    Medium: "text-blue-500",
    High:   "text-orange-500",
    Urgent: "text-red-600 font-semibold",
};

const cls = computed(() => CONFIG[props.priority] ?? "text-slate-400");
</script>

<template>
    <span :class="['text-xs', cls]">{{ priority }}</span>
</template>

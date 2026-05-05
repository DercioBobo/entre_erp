<script setup>
import { computed } from "vue";

const props = defineProps({ status: String });

const CONFIG = {
    Open:     { bg: "bg-blue-50",    text: "text-blue-700",    dot: "bg-blue-500"    },
    Replied:  { bg: "bg-amber-50",   text: "text-amber-700",   dot: "bg-amber-500"   },
    Resolved: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
    Closed:   { bg: "bg-slate-100",  text: "text-slate-600",   dot: "bg-slate-400"   },
    "On Hold":{ bg: "bg-orange-50",  text: "text-orange-700",  dot: "bg-orange-500"  },
};

const c = computed(
    () => CONFIG[props.status] ?? { bg: "bg-gray-100", text: "text-gray-600", dot: "bg-gray-400" }
);
</script>

<template>
    <span
        :class="[
            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
            c.bg,
            c.text,
        ]"
    >
        <span :class="['w-1.5 h-1.5 rounded-full shrink-0', c.dot]" />
        {{ status }}
    </span>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
    fieldname: { type: String,  required: true },
    label:     { type: String,  required: true },
    fieldtype: { type: String,  default: "Data" },
    options:   { type: String,  default: "" },
    modelValue:{ type: [String, Number, Boolean], default: "" },
    required:  { type: Boolean, default: false },
});

const emit = defineEmits(["update:modelValue"]);

const BASE_INPUT = [
    "w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5",
    "placeholder:text-slate-300",
    "focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent",
    "transition",
].join(" ");

const selectOptions = computed(() =>
    props.options
        ? props.options.split("\n").map((o) => o.trim()).filter(Boolean)
        : []
);

const isTextarea  = computed(() =>
    ["Text", "Small Text", "Long Text", "Text Editor"].includes(props.fieldtype)
);
const isNumber    = computed(() =>
    ["Int", "Float", "Currency", "Percent"].includes(props.fieldtype)
);
const isDate      = computed(() => props.fieldtype === "Date");
const isSelect    = computed(() => props.fieldtype === "Select");
const isCheck     = computed(() => props.fieldtype === "Check");
</script>

<template>
    <div>
        <label class="block text-sm font-medium text-slate-700 mb-1.5">
            {{ label }}
            <span v-if="required" class="text-red-400">*</span>
        </label>

        <!-- Textarea -->
        <textarea
            v-if="isTextarea"
            :value="modelValue"
            @input="emit('update:modelValue', $event.target.value)"
            rows="3"
            :required="required"
            :placeholder="label"
            :class="[BASE_INPUT, 'resize-y']"
        />

        <!-- Select -->
        <select
            v-else-if="isSelect"
            :value="modelValue"
            @change="emit('update:modelValue', $event.target.value)"
            :required="required"
            :class="BASE_INPUT"
        >
            <option value="">Select…</option>
            <option v-for="opt in selectOptions" :key="opt" :value="opt">{{ opt }}</option>
        </select>

        <!-- Date -->
        <input
            v-else-if="isDate"
            type="date"
            :value="modelValue"
            @input="emit('update:modelValue', $event.target.value)"
            :required="required"
            :class="BASE_INPUT"
        />

        <!-- Check -->
        <label v-else-if="isCheck" class="flex items-center gap-2 cursor-pointer">
            <input
                type="checkbox"
                :checked="!!modelValue"
                @change="emit('update:modelValue', $event.target.checked ? 1 : 0)"
                class="w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span class="text-sm text-slate-600">{{ label }}</span>
        </label>

        <!-- Number -->
        <input
            v-else-if="isNumber"
            type="number"
            :value="modelValue"
            @input="emit('update:modelValue', $event.target.value)"
            :required="required"
            :placeholder="label"
            :class="BASE_INPUT"
        />

        <!-- Default: text -->
        <input
            v-else
            type="text"
            :value="modelValue"
            @input="emit('update:modelValue', $event.target.value)"
            :required="required"
            :placeholder="label"
            :class="BASE_INPUT"
        />
    </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "@/utils/api";
import { timeAgo, fullDate, initials, textToHtml } from "@/utils/format";
import { loadFieldConfig, fieldConfig } from "@/stores/fieldConfig";
import StatusBadge from "@/components/StatusBadge.vue";
import PriorityBadge from "@/components/PriorityBadge.vue";

const route  = useRoute();
const router = useRouter();

const issue          = ref(null);
const communications = ref([]);
const loading        = ref(true);
const error          = ref(null);
const replyText      = ref("");
const submitting     = ref(false);
const replyError     = ref(null);

// Fields that are always shown via the fixed sidebar sections — exclude from dynamic list
const BUILTIN_FIELDS = new Set([
    "name", "subject", "status", "priority", "description",
    "customer", "creation", "modified", "owner", "modified_by",
    "docstatus", "idx",
]);

const dynamicVisibleFields = computed(() =>
    fieldConfig.fields.value.filter(
        (f) => f.visible && !BUILTIN_FIELDS.has(f.fieldname)
    )
);

function fieldValue(fieldname, fieldtype) {
    if (!issue.value) return "—";
    const raw = issue.value[fieldname];
    if (raw === null || raw === undefined || raw === "") return "—";
    if (fieldtype === "Check") return raw ? "Yes" : "No";
    if (fieldtype === "Date") return fullDate(raw);
    return String(raw);
}

async function load() {
    loading.value = true;
    error.value = null;
    try {
        const [data] = await Promise.all([
            api.getIssue(route.params.id),
            loadFieldConfig(),
        ]);
        issue.value = data.issue;
        communications.value = data.communications ?? [];
    } catch (e) {
        error.value = e.message;
    } finally {
        loading.value = false;
    }
}

async function submitReply() {
    if (!replyText.value.trim()) return;
    submitting.value = true;
    replyError.value = null;
    try {
        const html = textToHtml(replyText.value);
        const newComm = await api.addReply(issue.value.name, html);
        communications.value.push(newComm);
        replyText.value = "";
        if (["Resolved", "Closed"].includes(issue.value.status)) {
            issue.value.status = "Open";
        }
    } catch (e) {
        replyError.value = e.message;
    } finally {
        submitting.value = false;
    }
}

function isCustomer(comm) {
    return comm.sent_or_received === "Received";
}

onMounted(load);
</script>

<template>
    <div class="max-w-5xl mx-auto px-4 sm:px-6 py-8">

        <!-- Back -->
        <button
            @click="router.push('/')"
            class="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-6 transition-colors group"
        >
            <svg class="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to tickets
        </button>

        <!-- Error -->
        <div v-if="error" class="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
            {{ error }}
        </div>

        <!-- Loading skeleton -->
        <div v-else-if="loading" class="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-pulse">
            <div class="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div class="h-6 bg-slate-200 rounded w-3/4"></div>
                <div class="h-4 bg-slate-200 rounded w-1/2"></div>
                <div class="h-32 bg-slate-100 rounded-lg"></div>
            </div>
            <div class="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div class="h-4 bg-slate-200 rounded w-1/3"></div>
                <div class="h-6 bg-slate-200 rounded w-1/2"></div>
                <div class="h-4 bg-slate-200 rounded w-2/3"></div>
            </div>
        </div>

        <!-- Content -->
        <div v-else-if="issue" class="grid grid-cols-1 lg:grid-cols-3 gap-6">

            <!-- ── Left: conversation ── -->
            <div class="lg:col-span-2 space-y-4">

                <!-- Subject -->
                <div class="bg-white border border-slate-200 rounded-xl p-6">
                    <div class="flex items-start gap-3 mb-3">
                        <StatusBadge :status="issue.status" />
                        <PriorityBadge :priority="issue.priority" />
                    </div>
                    <h1 class="text-lg font-semibold text-slate-900 mb-1">{{ issue.subject }}</h1>
                    <p class="text-xs text-slate-400">
                        Opened {{ timeAgo(issue.creation) }} &middot; {{ issue.name }}
                    </p>
                </div>

                <!-- Description -->
                <div class="bg-white border border-slate-200 rounded-xl p-6">
                    <p class="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">Description</p>
                    <div
                        class="content-prose"
                        v-html="issue.description || '<em class=\'text-slate-400\'>No description provided.</em>'"
                    />
                </div>

                <!-- Conversation timeline -->
                <div v-if="communications.length" class="bg-white border border-slate-200 rounded-xl p-6">
                    <p class="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">Conversation</p>
                    <div class="space-y-5">
                        <div v-for="comm in communications" :key="comm.name" class="flex gap-3">
                            <!-- Avatar -->
                            <div
                                :class="[
                                    'w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 mt-0.5',
                                    isCustomer(comm) ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600',
                                ]"
                            >
                                {{ initials(comm.sender_full_name || comm.sender) }}
                            </div>

                            <div class="flex-1 min-w-0">
                                <div class="flex items-baseline gap-2 mb-1">
                                    <span class="text-sm font-medium text-slate-800">
                                        {{ comm.sender_full_name || comm.sender }}
                                        <span v-if="isCustomer(comm)" class="text-xs text-brand-500 font-normal ml-1">(You)</span>
                                    </span>
                                    <span class="text-xs text-slate-400">{{ fullDate(comm.creation) }}</span>
                                </div>
                                <div
                                    :class="[
                                        'text-sm text-slate-700 leading-relaxed rounded-lg px-3 py-2.5',
                                        isCustomer(comm)
                                            ? 'bg-brand-50 border border-brand-100'
                                            : 'bg-slate-50 border border-slate-100',
                                    ]"
                                    v-html="comm.content"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Reply box -->
                <div class="bg-white border border-slate-200 rounded-xl p-6">
                    <p class="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">Your Reply</p>

                    <div v-if="replyError" class="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-3 py-2 mb-3">
                        {{ replyError }}
                    </div>

                    <textarea
                        v-model="replyText"
                        rows="4"
                        placeholder="Write your reply here…"
                        class="w-full text-sm text-slate-800 border border-slate-200 rounded-lg px-3 py-2.5 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none transition"
                    />
                    <div class="flex justify-end mt-3">
                        <button
                            @click="submitReply"
                            :disabled="!replyText.trim() || submitting"
                            class="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                            <svg v-if="submitting" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                            </svg>
                            <svg v-else class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                            </svg>
                            {{ submitting ? "Sending…" : "Send Reply" }}
                        </button>
                    </div>
                </div>
            </div>

            <!-- ── Right: sidebar ── -->
            <div class="space-y-4">

                <!-- Status -->
                <div class="bg-white border border-slate-200 rounded-xl p-5">
                    <p class="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">Status</p>
                    <StatusBadge :status="issue.status" />
                </div>

                <!-- Built-in details -->
                <div class="bg-white border border-slate-200 rounded-xl p-5">
                    <p class="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">Details</p>
                    <dl class="space-y-3">
                        <div>
                            <dt class="text-xs text-slate-400 mb-0.5">Ticket ID</dt>
                            <dd class="text-sm font-medium text-slate-700 font-mono">{{ issue.name }}</dd>
                        </div>
                        <div>
                            <dt class="text-xs text-slate-400 mb-0.5">Priority</dt>
                            <dd><PriorityBadge :priority="issue.priority" /></dd>
                        </div>
                        <div>
                            <dt class="text-xs text-slate-400 mb-0.5">Opened</dt>
                            <dd class="text-sm text-slate-700">{{ fullDate(issue.creation) }}</dd>
                        </div>
                        <div>
                            <dt class="text-xs text-slate-400 mb-0.5">Last updated</dt>
                            <dd class="text-sm text-slate-700">{{ timeAgo(issue.modified) }}</dd>
                        </div>

                        <!-- Dynamic visible fields -->
                        <template v-for="field in dynamicVisibleFields" :key="field.fieldname">
                            <div>
                                <dt class="text-xs text-slate-400 mb-0.5">{{ field.label }}</dt>
                                <dd class="text-sm text-slate-700">
                                    {{ fieldValue(field.fieldname, field.fieldtype) }}
                                </dd>
                            </div>
                        </template>
                    </dl>
                </div>
            </div>
        </div>
    </div>
</template>

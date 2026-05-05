<script setup>
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "@/utils/api";
import { timeAgo } from "@/utils/format";
import StatusBadge from "@/components/StatusBadge.vue";
import PriorityBadge from "@/components/PriorityBadge.vue";

const router  = useRouter();
const tickets = ref([]);
const loading = ref(true);
const error   = ref(null);
const activeTab = ref("All");

const TABS = ["All", "Open", "Replied", "Resolved", "Closed"];

const filtered = computed(() => {
    if (activeTab.value === "All") return tickets.value;
    return tickets.value.filter((t) => t.status === activeTab.value);
});

const tabCount = (tab) =>
    tab === "All"
        ? tickets.value.length
        : tickets.value.filter((t) => t.status === tab).length;

async function load() {
    loading.value = true;
    error.value = null;
    try {
        const data = await api.getIssues(1, 100);
        tickets.value = data.issues ?? [];
    } catch (e) {
        error.value = e.message;
    } finally {
        loading.value = false;
    }
}

onMounted(load);
</script>

<template>
    <div class="max-w-5xl mx-auto px-4 sm:px-6 py-8">

        <!-- Page header -->
        <div class="flex items-center justify-between mb-6">
            <div>
                <h1 class="text-xl font-semibold text-slate-900">My Tickets</h1>
                <p class="text-sm text-slate-500 mt-0.5">Track and manage your support requests</p>
            </div>
            <RouterLink
                to="/new"
                class="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg shadow-sm transition-colors"
            >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                New Ticket
            </RouterLink>
        </div>

        <!-- Status tabs -->
        <div class="flex gap-1 bg-slate-100 rounded-xl p-1 mb-6 overflow-x-auto">
            <button
                v-for="tab in TABS"
                :key="tab"
                @click="activeTab = tab"
                :class="[
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all',
                    activeTab === tab
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700',
                ]"
            >
                {{ tab }}
                <span
                    :class="[
                        'text-xs px-1.5 py-0.5 rounded-md',
                        activeTab === tab ? 'bg-slate-100 text-slate-600' : 'bg-slate-200 text-slate-500',
                    ]"
                >
                    {{ tabCount(tab) }}
                </span>
            </button>
        </div>

        <!-- Error -->
        <div
            v-if="error"
            class="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-4"
        >
            {{ error }}
        </div>

        <!-- Loading skeletons -->
        <div v-if="loading" class="space-y-3">
            <div
                v-for="i in 4"
                :key="i"
                class="bg-white border border-slate-200 rounded-xl p-5 animate-pulse"
            >
                <div class="flex items-start justify-between mb-3">
                    <div class="h-4 bg-slate-200 rounded-full w-16"></div>
                    <div class="h-4 bg-slate-200 rounded w-20"></div>
                </div>
                <div class="h-5 bg-slate-200 rounded w-2/3 mb-2"></div>
                <div class="h-4 bg-slate-200 rounded w-1/3"></div>
            </div>
        </div>

        <!-- Empty state -->
        <div
            v-else-if="!loading && filtered.length === 0"
            class="bg-white border border-slate-200 rounded-xl py-16 px-6 text-center"
        >
            <div class="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg class="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
            </div>
            <p class="text-slate-600 font-medium mb-1">
                {{ activeTab === "All" ? "No tickets yet" : `No ${activeTab.toLowerCase()} tickets` }}
            </p>
            <p class="text-sm text-slate-400 mb-5">
                {{ activeTab === "All" ? "When you open a support request it will appear here." : "Try switching to another tab." }}
            </p>
            <RouterLink
                v-if="activeTab === 'All'"
                to="/new"
                class="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
                Open a ticket
            </RouterLink>
        </div>

        <!-- Ticket list -->
        <div v-else class="space-y-2">
            <button
                v-for="ticket in filtered"
                :key="ticket.name"
                @click="router.push(`/tickets/${ticket.name}`)"
                class="w-full bg-white border border-slate-200 hover:border-brand-300 hover:shadow-sm rounded-xl p-5 text-left transition-all group"
            >
                <div class="flex items-start justify-between gap-3">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1.5">
                            <StatusBadge :status="ticket.status" />
                            <PriorityBadge :priority="ticket.priority" />
                        </div>
                        <p class="font-medium text-slate-900 truncate group-hover:text-brand-600 transition-colors">
                            {{ ticket.subject }}
                        </p>
                        <p class="text-xs text-slate-400 mt-1">
                            {{ ticket.name }} &middot; {{ timeAgo(ticket.modified) }}
                        </p>
                    </div>
                    <!-- Arrow -->
                    <svg
                        class="w-4 h-4 text-slate-300 group-hover:text-brand-400 shrink-0 mt-1 transition-colors"
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
                    >
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                </div>
            </button>
        </div>
    </div>
</template>

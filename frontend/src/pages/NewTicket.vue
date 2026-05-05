<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "@/utils/api";
import { textToHtml } from "@/utils/format";

const router     = useRouter();
const subject    = ref("");
const description = ref("");
const priority   = ref("Medium");
const submitting = ref(false);
const error      = ref(null);

const PRIORITIES = ["Low", "Medium", "High", "Urgent"];

async function submit() {
    if (!subject.value.trim() || !description.value.trim()) return;
    submitting.value = true;
    error.value = null;
    try {
        const html = textToHtml(description.value);
        const res = await api.createIssue(subject.value, html, priority.value);
        router.push(`/tickets/${res.issue_id}`);
    } catch (e) {
        error.value = e.message;
        submitting.value = false;
    }
}
</script>

<template>
    <div class="max-w-2xl mx-auto px-4 sm:px-6 py-8">

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

        <div class="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
            <!-- Header -->
            <div class="mb-6">
                <h1 class="text-lg font-semibold text-slate-900">Open a Support Ticket</h1>
                <p class="text-sm text-slate-500 mt-1">Describe your issue and our team will get back to you.</p>
            </div>

            <!-- Error -->
            <div
                v-if="error"
                class="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-3 mb-5"
            >
                {{ error }}
            </div>

            <form @submit.prevent="submit" class="space-y-5">

                <!-- Subject -->
                <div>
                    <label class="block text-sm font-medium text-slate-700 mb-1.5">
                        Subject <span class="text-red-400">*</span>
                    </label>
                    <input
                        v-model="subject"
                        type="text"
                        maxlength="140"
                        placeholder="Brief summary of your issue"
                        required
                        class="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
                    />
                </div>

                <!-- Priority -->
                <div>
                    <label class="block text-sm font-medium text-slate-700 mb-1.5">Priority</label>
                    <div class="flex gap-2 flex-wrap">
                        <button
                            v-for="p in PRIORITIES"
                            :key="p"
                            type="button"
                            @click="priority = p"
                            :class="[
                                'px-3 py-1.5 rounded-lg text-sm font-medium border transition-all',
                                priority === p
                                    ? 'bg-brand-600 border-brand-600 text-white shadow-sm'
                                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300',
                            ]"
                        >
                            {{ p }}
                        </button>
                    </div>
                </div>

                <!-- Description -->
                <div>
                    <label class="block text-sm font-medium text-slate-700 mb-1.5">
                        Description <span class="text-red-400">*</span>
                    </label>
                    <textarea
                        v-model="description"
                        rows="6"
                        placeholder="Please describe your issue in detail — steps to reproduce, expected vs. actual behaviour, screenshots if relevant…"
                        required
                        class="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-y transition"
                    />
                </div>

                <!-- Actions -->
                <div class="flex items-center justify-between pt-2">
                    <button
                        type="button"
                        @click="router.push('/')"
                        class="text-sm text-slate-500 hover:text-slate-700 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        :disabled="!subject.trim() || !description.trim() || submitting"
                        class="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                        <svg v-if="submitting" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                        </svg>
                        {{ submitting ? "Submitting…" : "Submit Ticket" }}
                    </button>
                </div>
            </form>
        </div>
    </div>
</template>

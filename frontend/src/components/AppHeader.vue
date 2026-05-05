<script setup>
import { computed } from "vue";
import { portalCtx } from "@/config";
import { initials } from "@/utils/format";

const avatarInitials = computed(() =>
    initials(portalCtx.userFullname || portalCtx.user)
);

const displayName = computed(
    () => portalCtx.customerLabel || portalCtx.customer
);

function logout() {
    window.location.href = "/logout";
}
</script>

<template>
    <header class="sticky top-0 z-40 bg-white border-b border-slate-200">
        <div class="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
            <!-- Brand -->
            <RouterLink to="/" class="flex items-center gap-2.5 group">
                <div class="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center shadow-sm">
                    <!-- Headset icon -->
                    <svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round"
                            d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                </div>
                <span class="font-semibold text-slate-800 group-hover:text-brand-600 transition-colors">
                    Support Portal
                </span>
            </RouterLink>

            <!-- Right side -->
            <div class="flex items-center gap-4">
                <span class="text-sm text-slate-400 hidden sm:block truncate max-w-[180px]">
                    {{ displayName }}
                </span>

                <div class="flex items-center gap-3">
                    <!-- Avatar -->
                    <div
                        class="w-8 h-8 bg-brand-100 text-brand-700 rounded-full flex items-center justify-center text-xs font-semibold select-none"
                        :title="portalCtx.userFullname"
                    >
                        {{ avatarInitials }}
                    </div>

                    <!-- Sign out -->
                    <button
                        @click="logout"
                        class="text-sm text-slate-400 hover:text-slate-700 transition-colors"
                    >
                        Sign out
                    </button>
                </div>
            </div>
        </div>
    </header>
</template>

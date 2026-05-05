import { ref } from "vue";
import { api } from "@/utils/api";

const fields  = ref([]);
const loaded  = ref(false);
const loading = ref(false);

export async function loadFieldConfig() {
    if (loaded.value || loading.value) return;
    loading.value = true;
    try {
        const data = await api.getFieldConfig();
        fields.value = data.fields ?? [];
        loaded.value = true;
    } catch {
        // Config not yet set up — silently ignore, portal works without it
    } finally {
        loading.value = false;
    }
}

export const fieldConfig = { fields, loaded };

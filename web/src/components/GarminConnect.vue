<script setup lang="ts">
import { ref } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Password from "primevue/password";
import Message from "primevue/message";
import { api, ApiError } from "../api";

defineProps<{ notice: string | null }>();
const emit = defineEmits<{ connected: [] }>();

const email = ref("");
const password = ref("");
const code = ref("");
const step = ref<"credentials" | "mfa">("credentials");
const busy = ref(false);
const error = ref("");

async function submitCredentials() {
  busy.value = true;
  error.value = "";
  try {
    const { status } = await api.garminLogin(email.value, password.value);
    password.value = "";
    if (status === "mfa_required") step.value = "mfa";
    else emit("connected");
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "Не вдалося підключити Garmin.";
  } finally {
    busy.value = false;
  }
}

async function submitCode() {
  busy.value = true;
  error.value = "";
  try {
    await api.garminMfa(code.value);
    emit("connected");
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "Не вдалося підтвердити код.";
    if (e instanceof ApiError && e.message.startsWith("Сесія входу минула")) step.value = "credentials";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="card connect">
    <h2>Підключи Garmin Connect</h2>
    <p class="hint">
      Пароль використовується один раз, щоб отримати доступ, і ніде не зберігається. Далі дані підтягуються самі.
    </p>

    <Message v-if="notice && step === 'credentials'" severity="warn" class="block">{{ notice }}</Message>
    <Message v-if="error" severity="error" class="block">{{ error }}</Message>

    <form v-if="step === 'credentials'" class="form" @submit.prevent="submitCredentials">
      <label class="field">
        <span>Пошта Garmin</span>
        <InputText v-model="email" type="email" autocomplete="username" required fluid />
      </label>
      <label class="field">
        <span>Пароль</span>
        <Password v-model="password" :feedback="false" placeholder="" toggle-mask autocomplete="current-password" required fluid />
      </label>
      <Button type="submit" label="Підключити" icon="pi pi-link" :loading="busy" :disabled="!email || !password" />
    </form>

    <form v-else class="form" @submit.prevent="submitCode">
      <p class="hint">Garmin надіслав код підтвердження на пошту або в застосунок. Введи його тут.</p>
      <label class="field">
        <span>Код</span>
        <InputText v-model="code" inputmode="numeric" autocomplete="one-time-code" required fluid />
      </label>
      <Button type="submit" label="Підтвердити" icon="pi pi-check" :loading="busy" :disabled="code.length < 4" />
    </form>
  </section>
</template>

<style scoped>
.card {
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 12px;
  padding: 24px;
}
.connect {
  max-width: 440px;
  margin: 32px auto;
}
.connect h2 {
  margin-top: 0;
}
.hint {
  color: var(--p-text-muted-color);
  font-size: 0.9rem;
}
.block {
  margin-bottom: 16px;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.9rem;
}
</style>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import Button from "primevue/button";
import Message from "primevue/message";
import ProgressSpinner from "primevue/progressspinner";
import { auth, googleProvider } from "./firebase";
import { api, ApiError, type Me } from "./api";
import GarminConnect from "./components/GarminConnect.vue";
import ReportView from "./components/ReportView.vue";
import { isDark, toggleTheme } from "./theme";

const user = ref<User | null>(null);
const authReady = ref(false);
const me = ref<Me | null>(null);
const error = ref("");
const signingIn = ref(false);

let unsubscribe: (() => void) | undefined;

onMounted(() => {
  unsubscribe = onAuthStateChanged(auth, async (u) => {
    user.value = u;
    me.value = null;
    error.value = "";
    authReady.value = true;
    if (u) await loadMe();
  });
});

onBeforeUnmount(() => unsubscribe?.());

async function loadMe() {
  try {
    me.value = await api.me();
    error.value = "";
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "Не вдалося завантажити профіль.";
  }
}

async function signIn() {
  signingIn.value = true;
  error.value = "";
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
      error.value = "Не вдалося увійти через Google.";
    }
  } finally {
    signingIn.value = false;
  }
}

async function disconnectGarmin() {
  try {
    await api.garminDisconnect();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "Не вдалося відключити Garmin.";
    return;
  }
  await loadMe();
}
</script>

<template>
  <header class="topbar">
    <div class="brand"><i class="pi pi-chart-line" /> My Garmin</div>
    <div class="account">
      <Button
        :icon="isDark ? 'pi pi-sun' : 'pi pi-moon'"
        :aria-label="isDark ? 'Світла тема' : 'Темна тема'"
        severity="secondary"
        text
        rounded
        @click="toggleTheme"
      />
      <template v-if="user">
      <span class="who">{{ user.displayName || user.email }}</span>
      <Button
        v-if="me?.garminConnected"
        label="Відключити Garmin"
        icon="pi pi-link"
        severity="secondary"
        outlined
        size="small"
        @click="disconnectGarmin"
      />
      <Button label="Вийти" icon="pi pi-sign-out" severity="secondary" outlined size="small" @click="signOut(auth)" />
      </template>
    </div>
  </header>

  <Message v-if="error" severity="error" class="block">{{ error }}</Message>

  <div v-if="!authReady || (user && !me && !error)" class="center">
    <ProgressSpinner style="width: 48px; height: 48px" />
  </div>

  <section v-else-if="!user" class="card login">
    <h1>Звіти з твого Garmin</h1>
    <p>Темп, обсяг і пульс за будь-який період — по тренуваннях, тижнях або місяцях.</p>
    <Button label="Увійти через Google" icon="pi pi-google" :loading="signingIn" @click="signIn" />
  </section>

  <GarminConnect v-else-if="me && !me.garminConnected" :notice="me.lastSyncError" @connected="loadMe" />

  <ReportView v-else-if="me" :me="me" @refresh-me="loadMe" />
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.brand {
  font-size: 1.25rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 8px;
}
.account {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.who {
  color: var(--p-text-muted-color);
  font-size: 0.9rem;
}
.center {
  display: flex;
  justify-content: center;
  padding: 64px 0;
}
.block {
  margin-bottom: 16px;
}
.card {
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 12px;
  padding: 24px;
}
.login {
  max-width: 480px;
  margin: 48px auto;
  text-align: center;
}
.login h1 {
  margin-top: 0;
  font-size: 1.5rem;
}
.login p {
  color: var(--p-text-muted-color);
  margin-bottom: 24px;
}
</style>

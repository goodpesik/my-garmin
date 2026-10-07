import { ref } from "vue";

const STORAGE_KEY = "my-garmin-theme";
const DARK_CLASS = "app-dark";

function stored(): "dark" | "light" | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null;
  }
}

// Dark unless the person switched to light before.
export const isDark = ref(stored() !== "light");

export function applyTheme() {
  document.documentElement.classList.toggle(DARK_CLASS, isDark.value);
}

export function toggleTheme() {
  isDark.value = !isDark.value;
  applyTheme();
  try {
    localStorage.setItem(STORAGE_KEY, isDark.value ? "dark" : "light");
  } catch {
    // Storage blocked: the choice lasts until reload.
  }
}

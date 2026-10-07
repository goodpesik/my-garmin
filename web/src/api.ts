import { auth } from "./firebase";
import type { Activity } from "./report/aggregate";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:8010";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new ApiError("Потрібен вхід.", 401);
  const token = await user.getIdToken();
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Сервер недоступний.", 0);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data && typeof data.detail === "string" ? data.detail : "Щось пішло не так.";
    throw new ApiError(detail, response.status);
  }
  return data as T;
}

export interface Me {
  garminConnected: boolean;
  garminName: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  syncing: boolean;
  activityCount: number;
}

export const api = {
  me: () => request<Me>("GET", "/api/me"),
  garminLogin: (email: string, password: string) =>
    request<{ status: "connected" | "mfa_required" }>("POST", "/api/garmin/login", { email, password }),
  garminMfa: (code: string) => request<{ status: "connected" }>("POST", "/api/garmin/mfa", { code }),
  garminDisconnect: () => request<{ status: string }>("DELETE", "/api/garmin"),
  sync: () => request<{ started: boolean }>("POST", "/api/sync"),
  activities: (from: string, to: string) =>
    request<{ activities: Activity[] }>("GET", `/api/activities?from=${from}&to=${to}`),
};

import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { authHeaders, clearAuth } from "./auth";
import { triggerSubscriptionError } from "@/components/SubscriptionModal";

// In production the "__PORT_5000__" placeholder is never substituted, so the app
// calls its OWN origin (relative ""), letting the lab site and the SEPARATE
// VeritaStock deployment each talk to their own backend instead of a hardcoded
// domain. (A baked-in lab domain made the VeritaStock service call the lab API
// cross-origin, which CORS blocked, so every lab/plan lookup failed and the
// inventory app showed an "upgrade your plan" wall.) In Replit dev the
// placeholder is replaced with the real cross-origin dev API URL.
export const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    // Check for subscription-related errors
    try {
      const parsed = JSON.parse(text);
      if (parsed.code === 'SUBSCRIPTION_EXPIRED_READ_ONLY' || parsed.code === 'DATA_RETENTION_EXPIRED' || parsed.code === 'TRIAL_EXPIRED') {
        triggerSubscriptionError(parsed.code, parsed.error);
      }
    } catch {}
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...authHeaders(),
    ...(data ? { "Content-Type": "application/json" } : {}),
  };
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = `${API_BASE}${queryKey[0]}`;
    const extraSegments = queryKey.slice(1).filter(Boolean);
    const fullUrl = extraSegments.length ? `${url}/${extraSegments.join("/")}` : url;

    const res = await fetch(fullUrl, {
      headers: authHeaders(),
    });

    if (res.status === 401) {
      if (unauthorizedBehavior === "returnNull") {
        return null;
      }
      // Stale or expired token: clear auth and redirect to login
      clearAuth();
      window.location.href = "/login";
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuthStore } from "@/store/auth-store";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

export default function Home() {
  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);
  const hydrated = useAuthStore((state) => state.hydrated);
  const token = useAuthStore((state) => state.token);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!hydrated) return;

    if (token) {
      router.push("/dashboard");
      return;
    }

    let cancelled = false;
    let attempt = 0;

    const fetchDemoToken = async (): Promise<Response> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        return await fetch(`${API_BASE_URL}/api/auth/demo-token/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    };

    (async () => {
      while (attempt < 3 && !cancelled) {
        attempt++;
        try {
          setRetrying(attempt > 1);
          const res = await fetchDemoToken();

          if (!res.ok) {
            const payload = await res.json().catch(() => null);
            throw new Error(payload?.detail ?? "Nie udało się pobrać tokenu demo.");
          }

          const payload = (await res.json()) as {
            access: string;
            refresh: string;
          };

          if (cancelled) return;

          setAuth({ token: payload.access, refresh: payload.refresh });
          router.push("/dashboard");
          return;
        } catch (err) {
          if (cancelled) return;
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 3000));
            continue;
          }
          setError(err instanceof Error ? err.message : "Nieznany błąd.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrated, token, router, setAuth]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="glass-card w-full max-w-md space-y-4 p-8 text-center">
        <h1 className="text-2xl font-semibold text-slate-900">CRM Demo</h1>
        {error ? (
          <div className="space-y-4">
            <p className="text-sm text-red-600">{error}</p>
            <a
              href="/auth/login"
              className="inline-block rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
            >
              Przejdź do logowania
            </a>
          </div>
        ) : (
          <p className="text-sm text-slate-600">
            {retrying ? "Łączenie z serwerem (ponowna próba)…" : "Logowanie jako administrator…"}
          </p>
        )}
      </div>
    </main>
  );
}

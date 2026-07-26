"use client";

import { useAuthStore } from "@/store/auth-store";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";
const API_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN ?? null;

const resolveUrl = (input: string) => {
  if (input.startsWith("http")) {
    return input;
  }
  if (input.startsWith("/")) {
    return `${API_BASE_URL}${input}`;
  }
  return `${API_BASE_URL}/${input}`;
};

export async function authorizedFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const { token, refreshToken, setAuth, clear } = useAuthStore.getState();

  const performRequest = async (accessToken?: string | null) => {
    const headers = new Headers(init.headers as HeadersInit | undefined);
    const effectiveToken = accessToken ?? API_TOKEN;
    if (effectiveToken) {
      headers.set("Authorization", `Bearer ${effectiveToken}`);
    }
    return fetch(resolveUrl(input), {
      ...init,
      headers,
    });
  };

  if (!token && !refreshToken) {
    throw new Error("Brak danych logowania. Zaloguj się ponownie.");
  }

  let response = await performRequest(token);

  if (response.status === 401 && refreshToken) {
    const refreshResponse = await fetch(`${API_BASE_URL}/api/auth/token/refresh/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh: refreshToken }),
    });

    if (refreshResponse.ok) {
      const payload = await refreshResponse.json();
      const nextAccess: string = payload.access;
      const nextRefresh: string = payload.refresh ?? refreshToken;
      setAuth({ token: nextAccess, refresh: nextRefresh });
      response = await performRequest(nextAccess);
    } else {
      clear();
      throw new Error("Sesja wygasła. Zaloguj się ponownie.");
    }
  }

  if (response.status === 401) {
    clear();
    throw new Error("Sesja wygasła. Zaloguj się ponownie.");
  }

  return response;
}

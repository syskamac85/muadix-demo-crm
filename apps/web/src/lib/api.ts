"use client";

export interface ApiError extends Error {
  status?: number;
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";
const API_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function fetchJson<T>(
  endpoint: string,
  init?: RequestInit,
  token?: string | null,
): Promise<T> {
  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE_URL}${endpoint}`;

  const headers = new Headers({
    "Content-Type": "application/json",
  });
  const authToken = token ?? API_TOKEN;
  if (authToken) {
    headers.set("Authorization", `Bearer ${API_TOKEN}`);
  }

  if (init?.headers) {
    const extra = new Headers(init.headers as HeadersInit);
    extra.forEach((value, key) => headers.set(key, value));
  }

  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const error: ApiError = new Error("API request failed");
    error.status = response.status;
    throw error;
  }

  return response.json() as Promise<T>;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

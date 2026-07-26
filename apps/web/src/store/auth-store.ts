"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type AuthState = {
  token: string | null;
  refreshToken: string | null;
  hydrated: boolean;
  setAuth: (payload: { token: string; refresh: string }) => void;
  setHydrated: () => void;
  clear: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      hydrated: false,
      setAuth: ({ token, refresh }) =>
        set({
          token,
          refreshToken: refresh,
        }),
      setHydrated: () => set({ hydrated: true }),
      clear: () =>
        set({
          token: null,
          refreshToken: null,
        }),
    }),
    {
      name: "sun-crm-auth",
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
      },
    },
  ),
);

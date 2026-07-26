"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { authorizedFetch } from "@/lib/auth-fetch";
import { useAuthStore } from "@/store/auth-store";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";
const WS_BASE_URL =
  process.env.NEXT_PUBLIC_WS_URL?.replace(/\/$/, "") ?? API_BASE_URL.replace(/^http/, (match: string) => (match === "https" ? "wss" : "ws"));

const QUICK_LINKS = [
  {
    title: "CRM",
    description: "Zarządzaj kontaktami i follow-upami.",
    href: "/manager/contacts",
    cta: "Otwórz CRM",
  },
  {
    title: "Planer",
    description: "Układaj dzienne trasy i dziel się nimi z zespołem.",
    href: "/manager/routes",
    cta: "Otwórz planer",
  },
  {
    title: "Zadania",
    description: "Wyznaczaj i śledź zadania handlowców",
    href: "/manager/tasks",
    cta: "Przejdź do zadań",
  },
  {
    title: "Karta klienta",
    description: "Plan wizyt, notatki i kontakt dla wybranego klienta.",
    href: "/manager/visits",
    cta: "Przejdź do kart",
  },
  {
    title: "Baza klientów",
    description: "Dodawaj i zarządzaj klientami w całej organizacji.",
    href: "/manager/import",
    cta: "Otwórz bazę",
  },
];

type CurrentUser = {
  id: number;
  username: string;
  role: string;
  tenant?: { id: number } | null;
};

type DeletionRequest = {
  id: number;
  client: number;
  client_name: string;
  requested_by_name: string;
  created_at: string;
  reason: string;
};

type ContactNextDateRequest = {
  id: number;
  client: number;
  client_name: string;
  requested_by_name: string;
  cycle_days: number;
  proposed_days: number;
  reason: string;
  created_at: string;
};

type DashboardRouteStop = {
  id: number;
  order: number;
  client_name?: string;
  client_city?: string;
};

type DashboardRoute = {
  id: number;
  owner: number;
  owner_name: string;
  date: string;
  approval_status: "pending" | "approved" | "rejected";
  approved_by_name?: string | null;
  stops?: DashboardRouteStop[];
};

const APPROVAL_LABELS: Record<DashboardRoute["approval_status"], string> = {
  pending: "Do akceptacji",
  approved: "Zaakceptowana",
  rejected: "Odrzucona",
};

type DashboardTask = {
  id: number;
  assigned_to: number;
  client_name: string;
  title: string;
  status: "pending" | "in_progress" | "awaiting_review" | "completed" | "cancelled";
  due_date: string | null;
  days_until_due: number | null;
  assigned_to_name: string | null;
  created_by_name: string | null;
};

const TASK_STATUS_LABELS: Record<DashboardTask["status"], string> = {
  pending: "Nowe",
  in_progress: "W trakcie",
  awaiting_review: "Do potwierdzenia",
  completed: "Zamknięte",
  cancelled: "Anulowane",
};

const TASK_STATUS_TONE: Record<DashboardTask["status"], string> = {
  pending: "bg-amber-50 text-amber-700 border border-amber-100",
  in_progress: "bg-blue-50 text-blue-700 border border-blue-100",
  awaiting_review: "bg-purple-50 text-purple-700 border border-purple-100",
  completed: "bg-emerald-50 text-emerald-700 border border-emerald-100",
  cancelled: "bg-slate-100 text-slate-500 border border-slate-200",
};

export default function DashboardPage() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);
  const clearAuth = useAuthStore((state) => state.clear);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [pendingRoutes, setPendingRoutes] = useState<DashboardRoute[]>([]);
  const [latestRepRoute, setLatestRepRoute] = useState<DashboardRoute | null>(null);
  const [routesError, setRoutesError] = useState<string | null>(null);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false);
  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const tasksSocketRef = useRef<WebSocket | null>(null);
  const [deletionRequests, setDeletionRequests] = useState<DeletionRequest[]>([]);
  const [deletionRequestsLoading, setDeletionRequestsLoading] = useState(false);
  const [deletionRequestsError, setDeletionRequestsError] = useState<string | null>(null);
  const [deletionActionStatus, setDeletionActionStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [contactNextDateRequests, setContactNextDateRequests] = useState<ContactNextDateRequest[]>([]);
  const [contactNextDateRequestsLoading, setContactNextDateRequestsLoading] = useState(false);
  const [contactNextDateRequestsError, setContactNextDateRequestsError] = useState<string | null>(null);
  const [contactNextDateActionStatus, setContactNextDateActionStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const hasElevatedAccess = currentUser?.role === "admin" || currentUser?.role === "manager";
  const tenantId = currentUser?.tenant?.id ?? 0;

  const filterTasksForRole = useCallback(
    (list: DashboardTask[]) => {
      if (!currentUser || currentUser.role !== "rep") {
        return list;
      }
      return list.filter((task) => task.assigned_to === currentUser.id);
    },
    [currentUser],
  );

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (!token) {
      router.replace("/auth/login");
    }
  }, [token, hydrated, router]);

  useEffect(() => {
    if (!hydrated || !token) {
      return;
    }
    let cancelled = false;
    const fetchCurrentUser = async () => {
      try {
        const response = await authorizedFetch("/api/accounts/users/me/");
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as CurrentUser;
        if (!cancelled) {
          setCurrentUser(payload);
        }
      } catch (error) {
        console.error("Nie udało się pobrać danych użytkownika", error);
      }
    };
    fetchCurrentUser();
    return () => {
      cancelled = true;
    };
  }, [hydrated, token]);

  useEffect(() => {
    if (!hydrated || !token || !currentUser) {
      return;
    }
    let cancelled = false;
    const fetchRouteSummaries = async () => {
      setIsLoadingRoutes(true);
      setRoutesError(null);
      try {
        if (currentUser.role === "admin" || currentUser.role === "manager") {
          const response = await authorizedFetch(
            `/api/routes/?approval_status=pending&ordering=-date&limit=5`,
          );
          if (!response.ok) {
            throw new Error("Nie udało się pobrać tras oczekujących na akceptację.");
          }
          const payload = await response.json();
          const items: DashboardRoute[] = Array.isArray(payload)
            ? payload
            : (payload.results ?? []);
          if (!cancelled) {
            setPendingRoutes(items);
          }
        }
        if (currentUser.role === "rep") {
          const response = await authorizedFetch(
            `/api/routes/?owner=${currentUser.id}&ordering=-date&limit=1`,
          );
          if (!response.ok) {
            throw new Error("Nie udało się pobrać statusu trasy.");
          }
          const payload = await response.json();
          const items: DashboardRoute[] = Array.isArray(payload)
            ? payload
            : (payload.results ?? []);
          if (!cancelled) {
            setLatestRepRoute(items[0] ?? null);
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setRoutesError(error instanceof Error ? error.message : "Błąd pobierania tras.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRoutes(false);
        }
      }
    };

    fetchRouteSummaries();
    return () => {
      cancelled = true;
    };
  }, [hydrated, token, currentUser]);

  const loadContactNextDateRequests = useCallback(async () => {
    if (!token || !hasElevatedAccess) {
      return;
    }
    setContactNextDateRequestsLoading(true);
    setContactNextDateRequestsError(null);
    try {
      const response = await authorizedFetch(`/api/contact-next-date-requests/?status=pending`);
      if (!response.ok) {
        throw new Error("Nie udało się pobrać wniosków o termin kontaktu.");
      }
      const payload = await response.json();
      const items: ContactNextDateRequest[] = Array.isArray(payload) ? payload : payload.results ?? [];
      setContactNextDateRequests(items);
    } catch (error) {
      setContactNextDateRequestsError(error instanceof Error ? error.message : "Błąd pobierania wniosków.");
    } finally {
      setContactNextDateRequestsLoading(false);
    }
  }, [token, hasElevatedAccess]);

  const loadDeletionRequests = useCallback(async () => {
    if (!token || !hasElevatedAccess) {
      return;
    }
    setDeletionRequestsLoading(true);
    setDeletionRequestsError(null);
    try {
      const response = await authorizedFetch(`/api/client-deletion-requests/?status=pending`);
      if (!response.ok) {
        throw new Error("Nie udało się pobrać wniosków o usunięcie.");
      }
      const payload = await response.json();
      const items: DeletionRequest[] = Array.isArray(payload) ? payload : payload.results ?? [];
      setDeletionRequests(items);
    } catch (error) {
      setDeletionRequestsError(error instanceof Error ? error.message : "Błąd pobierania wniosków.");
    } finally {
      setDeletionRequestsLoading(false);
    }
  }, [token, hasElevatedAccess]);

  useEffect(() => {
    if (!hydrated || !token || !hasElevatedAccess) {
      return;
    }
    loadDeletionRequests().catch(() => undefined);
    loadContactNextDateRequests().catch(() => undefined);
  }, [hydrated, token, hasElevatedAccess, loadDeletionRequests, loadContactNextDateRequests]);

  const handleDeletionRequestAction = useCallback(
    async (requestId: number, action: "approve" | "reject") => {
      if (!token) {
        return;
      }
      setDeletionActionStatus(null);
      try {
        const response = await authorizedFetch(`/api/client-deletion-requests/${requestId}/${action}/`, {
          method: "POST",
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.detail ?? "Nie udało się zaktualizować wniosku.");
        }
        setDeletionActionStatus({
          type: "success",
          text: action === "approve" ? "Wniosek zatwierdzony." : "Wniosek odrzucony.",
        });
        await loadDeletionRequests();
      } catch (error) {
        setDeletionActionStatus({
          type: "error",
          text: error instanceof Error ? error.message : "Operacja nie powiodła się.",
        });
      }
    },
    [token, loadDeletionRequests],
  );

  useEffect(() => {
    if (!deletionActionStatus) {
      return;
    }
    const timeout = window.setTimeout(() => setDeletionActionStatus(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [deletionActionStatus]);

  const handleContactNextDateAction = useCallback(
    async (requestId: number, action: "approve" | "reject") => {
      if (!token) {
        return;
      }
      setContactNextDateActionStatus(null);
      try {
        const response = await authorizedFetch(`/api/contact-next-date-requests/${requestId}/${action}/`, {
          method: "POST",
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.detail ?? "Nie udało się zaktualizować wniosku.");
        }
        setContactNextDateActionStatus({
          type: "success",
          text: action === "approve" ? "Termin zatwierdzony." : "Wniosek odrzucony.",
        });
        await loadContactNextDateRequests();
      } catch (error) {
        setContactNextDateActionStatus({
          type: "error",
          text: error instanceof Error ? error.message : "Operacja nie powiodła się.",
        });
      }
    },
    [token, loadContactNextDateRequests],
  );

  useEffect(() => {
    if (!contactNextDateActionStatus) {
      return;
    }
    const timeout = window.setTimeout(() => setContactNextDateActionStatus(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [contactNextDateActionStatus]);

  const handleLogout = () => {
    clearAuth();
    router.replace("/auth/login");
  };

  const formatTaskDue = useCallback((task: DashboardTask) => {
    if (!task.due_date) {
      return "Brak terminu";
    }
    const label = new Date(task.due_date).toLocaleDateString("pl-PL");
    if (task.days_until_due === null) {
      return `Termin ${label}`;
    }
    if (task.days_until_due < 0) {
      return `Po terminie (${label})`;
    }
    if (task.days_until_due === 0) {
      return `Termin dzisiaj (${label})`;
    }
    if (task.days_until_due === 1) {
      return `Termin jutro (${label})`;
    }
    return `Za ${task.days_until_due} dni (${label})`;
  }, []);

  const fetchTasksSummary = useCallback(async () => {
    if (!hydrated || !token || !currentUser) {
      return;
    }
    setIsLoadingTasks(true);
    setTasksError(null);
    try {
      const params = new URLSearchParams();
      if (currentUser.role === "rep") {
        params.set("assigned_to", String(currentUser.id));
      }
      const response = await authorizedFetch(`/api/tasks/${params.toString() ? `?${params.toString()}` : ""}`);
      if (!response.ok) {
        throw new Error("Nie udało się pobrać listy zadań.");
      }
      const payload = await response.json();
      const items: DashboardTask[] = Array.isArray(payload) ? payload : payload.results ?? [];
      setTasks(filterTasksForRole(items));
    } catch (error) {
      console.error(error);
      setTasksError(error instanceof Error ? error.message : "Błąd pobierania zadań.");
    } finally {
      setIsLoadingTasks(false);
    }
  }, [hydrated, token, currentUser, filterTasksForRole]);

  useEffect(() => {
    if (!token || !currentUser || !tenantId) {
      return;
    }
    fetchTasksSummary().catch(() => undefined);
  }, [token, currentUser, tenantId, fetchTasksSummary]);

  useEffect(() => {
    if (!token || !currentUser?.tenant?.id) {
      return;
    }
    const wsUrl = `${WS_BASE_URL}/ws/tasks/${currentUser.tenant.id}/?token=${token}`;
    const socket = new WebSocket(wsUrl);
    tasksSocketRef.current = socket;
    socket.onopen = () => undefined;
    socket.onclose = () => undefined;
    socket.onerror = () => undefined;
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!data?.type) {
          return;
        }
        if (data.type === "task.snapshot") {
          const items: DashboardTask[] = data.payload ?? [];
          setTasks(filterTasksForRole(items));
        }
        if (data.type === "task.update") {
          const next = data.payload as DashboardTask;
          setTasks((prev) => {
            if (currentUser?.role === "rep" && next.assigned_to !== currentUser.id) {
              return prev.filter((task) => task.id !== next.id);
            }
            const exists = prev.findIndex((task) => task.id === next.id);
            if (exists >= 0) {
              const copy = [...prev];
              copy[exists] = {
                ...copy[exists],
                ...next,
              };
              return copy;
            }
            return [next, ...prev];
          });
        }
      } catch (error) {
        console.error("WebSocket zadania", error);
      }
    };
    return () => {
      socket.close();
      tasksSocketRef.current = null;
    };
  }, [token, currentUser, filterTasksForRole]);

  const managerTasks = useMemo(() => {
    if (!hasElevatedAccess) {
      return [] as DashboardTask[];
    }
    return tasks
      .filter((task) => task.status !== "completed" && task.status !== "cancelled")
      .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""))
      .slice(0, 5);
  }, [tasks, hasElevatedAccess]);

  const repTasks = useMemo(() => {
    if (hasElevatedAccess) {
      return [] as DashboardTask[];
    }
    return tasks
      .filter((task) => task.status !== "completed" && task.status !== "cancelled")
      .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""))
      .slice(0, 5);
  }, [tasks, hasElevatedAccess]);

  if (!hydrated) {
    return null;
  }

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="glass-card w-full max-w-md space-y-4 p-8 text-center">
          <p className="text-sm font-semibold text-slate-900">
            Dostęp do dashboardu wymaga zalogowania.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-12">
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <div className="flex flex-wrap justify-end gap-3">
          {hasElevatedAccess && (
            <>
              <Link
                href="/dashboard/analytics"
                className="inline-flex items-center rounded-2xl bg-gradient-to-r from-purple-500 to-indigo-500 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110"
              >
                Analityka
              </Link>
              <Link
                href="/dashboard/journal"
                className="inline-flex items-center rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110"
              >
                Dziennik zdarzeń
              </Link>
              <Link
                href="/dashboard/admin"
                className="inline-flex items-center rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110"
              >
                Administracja
              </Link>
            </>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-blue-500 hover:text-blue-600"
          >
            Wyloguj się
          </button>
        </div>
        <header>
          <Image src="/logo.jpg" alt="Sun CRM" width={120} height={40} priority className="h-10 w-auto" />
        </header>

        <section className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 md:grid md:grid-flow-col md:auto-cols-[220px] md:overflow-visible md:snap-none">
          {QUICK_LINKS.map((link) => (
            <div
              key={link.href}
              className="min-w-[200px] snap-start rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:min-w-0"
            >
              <h2 className="text-base font-semibold text-slate-900">{link.title}</h2>
              <p className="mt-1 text-sm text-slate-500">{link.description}</p>
              <Link
                href={link.href}
                className="mt-3 inline-flex w-full items-center justify-center rounded-2xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500"
              >
                {link.cta}
              </Link>
            </div>
          ))}
        </section>

        {(hasElevatedAccess || currentUser?.role === "rep") && (
          <section className="space-y-4">
            {hasElevatedAccess && (
              <div className="mx-auto max-w-3xl rounded-3xl border border-amber-100 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-amber-500">Trasy do akceptacji</p>
                    <h2 className="text-lg font-semibold text-slate-900">Oczekujące zgody</h2>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-4 py-1 text-sm font-semibold text-amber-700">
                      {pendingRoutes.length}
                    </span>
                    <Link
                      href="/manager/routes"
                      className="inline-flex items-center rounded-2xl border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:border-amber-400"
                    >
                      Otwórz Planer tras
                    </Link>
                  </div>
                </div>
                {routesError && <p className="mt-3 text-sm text-red-500">{routesError}</p>}
                {!routesError && (
                  <div className="mt-4 space-y-3">
                    {pendingRoutes.length === 0 && !isLoadingRoutes && (
                      <p className="text-sm text-slate-500">Brak tras oczekujących na akceptację.</p>
                    )}
                    {isLoadingRoutes && (
                      <p className="text-sm text-slate-500">Ładuję listę tras…</p>
                    )}
                    {pendingRoutes.map((route) => (
                      <div
                        key={route.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3"
                      >
                        <div className="flex flex-1 flex-col gap-2">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{route.owner_name}</p>
                            <p className="text-xs text-slate-500">Data trasy: {route.date}</p>
                            <span className="mt-1 inline-flex items-center rounded-full border border-amber-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                              {APPROVAL_LABELS[route.approval_status]}
                            </span>
                          </div>
                          {route.stops && route.stops.length > 0 && (
                            <div className="rounded-2xl border border-amber-100/80 bg-white/70 px-3 py-2">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-amber-600">
                                Punkty trasy
                              </p>
                              <ol className="mt-1 space-y-1 text-sm text-slate-700">
                                {route.stops
                                  .slice()
                                  .sort((a, b) => a.order - b.order)
                                  .map((stop) => (
                                    <li key={stop.id} className="flex items-center gap-2">
                                      <span className="text-[10px] font-semibold text-amber-400">
                                        {stop.order < 10 ? `0${stop.order}` : stop.order}.
                                      </span>
                                      <span>
                                        {stop.client_name ?? "Klient"}
                                        {stop.client_city ? (
                                          <span className="text-slate-500"> · {stop.client_city}</span>
                                        ) : null}
                                      </span>
                                    </li>
                                  ))}
                              </ol>
                            </div>
                          )}
                        </div>
                        <Link
                          href={`/manager/routes?routeId=${route.id}&ownerId=${route.owner}`}
                          className="inline-flex items-center rounded-2xl border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:border-amber-400"
                        >
                          Otwórz planer
                        </Link>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {hasElevatedAccess && (
              <div className="mx-auto max-w-3xl rounded-3xl border border-rose-100 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-rose-500">Wnioski</p>
                    <h2 className="text-lg font-semibold text-slate-900">Usunięcia klientów</h2>
                  </div>
                  <span className="rounded-full border border-rose-200 bg-rose-50 px-4 py-1 text-sm font-semibold text-rose-700">
                    {deletionRequests.length}
                  </span>
                </div>
                {deletionActionStatus && (
                  <p
                    className={`mt-3 rounded-2xl px-3 py-2 text-sm ${
                      deletionActionStatus.type === "success"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-red-50 text-red-600"
                    }`}
                  >
                    {deletionActionStatus.text}
                  </p>
                )}
                {deletionRequestsError && <p className="mt-3 text-sm text-red-500">{deletionRequestsError}</p>}
                {!deletionRequestsError && (
                  <div className="mt-4 space-y-3">
                    {deletionRequests.length === 0 && !deletionRequestsLoading && (
                      <p className="text-sm text-slate-500">Brak wniosków oczekujących na rozpatrzenie.</p>
                    )}
                    {deletionRequestsLoading && (
                      <p className="text-sm text-slate-500">Ładuję wnioski o usunięcie…</p>
                    )}
                    {deletionRequests.map((request) => (
                      <div
                        key={request.id}
                        className="flex flex-col gap-3 rounded-2xl border border-rose-100 bg-rose-50/70 p-4 text-sm text-slate-700"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="font-semibold text-slate-900">{request.client_name}</p>
                            <p className="text-xs text-slate-500">
                              Wnioskował: {request.requested_by_name} · {new Date(request.created_at).toLocaleString("pl-PL")}
                            </p>
                          </div>
                        </div>
                        {request.reason && (
                          <p className="rounded-2xl border border-rose-100 bg-white px-3 py-2 text-sm text-slate-600">
                            {request.reason}
                          </p>
                        )}
                        {!request.reason && (
                          <p className="rounded-2xl border border-rose-100 bg-white px-3 py-2 text-sm text-slate-400 italic">
                            Brak uzasadnienia.
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleDeletionRequestAction(request.id, "approve")}
                            className="inline-flex items-center rounded-2xl border border-emerald-300 bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110"
                          >
                            Zatwierdź
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletionRequestAction(request.id, "reject")}
                            className="inline-flex items-center rounded-2xl border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:border-red-400"
                          >
                            Odrzuć
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {currentUser?.role === "rep" && (
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Status trasy</p>
                {latestRepRoute ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <h3 className="text-lg font-semibold text-slate-900">{latestRepRoute.date}</h3>
                    <p className="text-sm text-slate-600">
                      Ostatnia trasa: {APPROVAL_LABELS[latestRepRoute.approval_status]}
                    </p>
                    {latestRepRoute.approved_by_name && latestRepRoute.approval_status === "approved" && (
                      <p className="text-xs text-slate-500">Zatwierdził: {latestRepRoute.approved_by_name}</p>
                    )}
                    {latestRepRoute.stops && latestRepRoute.stops.length > 0 && (
                      <div className="mt-2 space-y-1 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">Punkty trasy</p>
                        <ol className="space-y-1 text-sm text-slate-700">
                          {latestRepRoute.stops
                            .slice()
                            .sort((a, b) => a.order - b.order)
                            .map((stop) => (
                              <li key={stop.id} className="flex items-center gap-2">
                                <span className="text-[10px] font-semibold text-slate-400">
                                  {stop.order < 10 ? `0${stop.order}` : stop.order}.
                                </span>
                                <span>
                                  {stop.client_name ?? "Klient"}
                                  {stop.client_city ? <span className="text-slate-500"> · {stop.client_city}</span> : null}
                                </span>
                              </li>
                            ))}
                        </ol>
                      </div>
                    )}
                    <Link
                      href={`/manager/routes?routeId=${latestRepRoute.id}&ownerId=${currentUser.id}`}
                      className="inline-flex w-fit items-center rounded-2xl border border-blue-200 bg-blue-50 px-4 py-1.5 text-xs font-semibold text-blue-700 transition hover:border-blue-400"
                    >
                      Przejdź do planera
                    </Link>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">
                    Nie masz jeszcze zapisanych tras. Rozpocznij planowanie, aby zobaczyć status akceptacji.
                  </p>
                )}
              </div>
            )}

            {hasElevatedAccess && (
              <div className="mx-auto max-w-3xl rounded-3xl border border-orange-100 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-orange-500">Wnioski Kontakty</p>
                    <h2 className="text-lg font-semibold text-slate-900">Przedłużone terminy kontaktu</h2>
                  </div>
                  <span className="rounded-full border border-orange-200 bg-orange-50 px-4 py-1 text-sm font-semibold text-orange-700">
                    {contactNextDateRequests.length}
                  </span>
                </div>
                {contactNextDateActionStatus && (
                  <p
                    className={`mt-3 rounded-2xl px-3 py-2 text-sm ${
                      contactNextDateActionStatus.type === "success"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-red-50 text-red-600"
                    }`}
                  >
                    {contactNextDateActionStatus.text}
                  </p>
                )}
                {contactNextDateRequestsError && (
                  <p className="mt-3 text-sm text-red-500">{contactNextDateRequestsError}</p>
                )}
                {!contactNextDateRequestsError && (
                  <div className="mt-4 space-y-3">
                    {contactNextDateRequests.length === 0 && !contactNextDateRequestsLoading && (
                      <p className="text-sm text-slate-500">Brak wniosków oczekujących na rozpatrzenie.</p>
                    )}
                    {contactNextDateRequestsLoading && (
                      <p className="text-sm text-slate-500">Ładuję wnioski…</p>
                    )}
                    {contactNextDateRequests.map((req) => (
                      <div
                        key={req.id}
                        className="flex flex-col gap-3 rounded-2xl border border-orange-100 bg-orange-50/70 p-4 text-sm text-slate-700"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-slate-900">{req.client_name}</p>
                            <p className="text-xs text-slate-500">
                              Handlowiec: {req.requested_by_name} · {new Date(req.created_at).toLocaleString("pl-PL")}
                            </p>
                            <p className="mt-1 text-xs">
                              Cykl klienta:{" "}
                              <span className="font-semibold text-orange-700">{req.cycle_days} dni</span>
                              {" → Proponowany termin: "}
                              <span className="font-semibold text-red-600">{req.proposed_days} dni</span>
                              {" ("}{Math.round((req.proposed_days / req.cycle_days) * 10) / 10}{"× cyklu)"}
                            </p>
                            {req.reason && (
                              <p className="mt-1.5 rounded-xl border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-xs text-slate-700">
                                <span className="font-semibold text-orange-600">Uzasadnienie: </span>
                                {req.reason}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleContactNextDateAction(req.id, "approve")}
                            className="inline-flex items-center rounded-2xl border border-emerald-300 bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110"
                          >
                            Zatwierdź
                          </button>
                          <button
                            type="button"
                            onClick={() => handleContactNextDateAction(req.id, "reject")}
                            className="inline-flex items-center rounded-2xl border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:border-red-400"
                          >
                            Odrzuć
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {hasElevatedAccess && (
              <div className="mx-auto max-w-3xl rounded-3xl border border-emerald-100 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-emerald-500">Zadania</p>
                    <h2 className="text-lg font-semibold text-slate-900">Najnowsze do zespołu</h2>
                  </div>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-1 text-sm font-semibold text-emerald-700">
                    {managerTasks.length}
                  </span>
                </div>
                {tasksError && <p className="mt-3 text-sm text-red-500">{tasksError}</p>}
                {!tasksError && (
                  <div className="mt-4 space-y-3">
                    {managerTasks.length === 0 && !isLoadingTasks && (
                      <p className="text-sm text-slate-500">Brak aktywnych zadań wymagających działania.</p>
                    )}
                    {isLoadingTasks && <p className="text-sm text-slate-500">Ładuję zadania…</p>}
                    {managerTasks.map((task) => (
                      <div
                        key={task.id}
                        className="rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-sm text-slate-700"
                      >
                        <p className="font-semibold text-slate-900">{task.title}</p>
                        <p className="text-xs text-slate-500">Klient: {task.client_name}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TASK_STATUS_TONE[task.status]}`}>
                            {TASK_STATUS_LABELS[task.status]}
                          </span>
                          <span>{formatTaskDue(task)}</span>
                          <Link
                            href={`/manager/tasks?taskId=${task.id}`}
                            className="inline-flex items-center rounded-full border border-emerald-300 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 transition hover:border-emerald-500"
                          >
                            Szczegóły
                          </Link>
                        </div>
                      </div>
                    ))}
                    <Link
                      href="/manager/tasks"
                      className="inline-flex items-center rounded-2xl border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:border-emerald-400"
                    >
                      Otwórz zadania
                    </Link>
                  </div>
                )}
              </div>
            )}

            {currentUser?.role === "rep" && (
              <div className="mx-auto max-w-3xl rounded-3xl border border-blue-100 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-blue-500">Twoje zadania</p>
                    <h2 className="text-lg font-semibold text-slate-900">Najbliższe terminy</h2>
                  </div>
                  <span className="rounded-full border border-blue-200 bg-blue-50 px-4 py-1 text-sm font-semibold text-blue-700">
                    {repTasks.length}
                  </span>
                </div>
                {tasksError && <p className="mt-3 text-sm text-red-500">{tasksError}</p>}
                {!tasksError && (
                  <div className="mt-4 space-y-3">
                    {repTasks.length === 0 && !isLoadingTasks && (
                      <p className="text-sm text-slate-500">Nie masz obecnie aktywnych zadań.</p>
                    )}
                    {isLoadingTasks && <p className="text-sm text-slate-500">Ładuję zadania…</p>}
                    {repTasks.map((task) => (
                      <div
                        key={task.id}
                        className="rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm text-slate-700"
                      >
                        <p className="font-semibold text-slate-900">{task.title}</p>
                        <p className="text-xs text-slate-500">Klient: {task.client_name}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TASK_STATUS_TONE[task.status]}`}>
                            {TASK_STATUS_LABELS[task.status]}
                          </span>
                          <span>{formatTaskDue(task)}</span>
                          <Link
                            href={`/manager/tasks?taskId=${task.id}`}
                            className="inline-flex items-center rounded-full border border-blue-300 px-2 py-0.5 text-[11px] font-semibold text-blue-700 transition hover:border-blue-500"
                          >
                            Otwórz
                          </Link>
                        </div>
                      </div>
                    ))}
                    <Link
                      href="/manager/tasks"
                      className="inline-flex items-center rounded-2xl border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:border-blue-400"
                    >
                      Przejdź do zadań
                    </Link>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

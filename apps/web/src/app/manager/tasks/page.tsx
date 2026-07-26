"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import type { ReactNode } from "react";

import { authorizedFetch } from "@/lib/auth-fetch";
import { useAuthStore } from "@/store/auth-store";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";
const WS_BASE_URL =
  process.env.NEXT_PUBLIC_WS_URL?.replace(/\/$/, "") ?? API_BASE_URL.replace(/^http/, (match) => (match === "https" ? "wss" : "ws"));
const DEFAULT_TENANT_ID = 4;

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Nowe",
  in_progress: "W trakcie",
  awaiting_review: "Do potwierdzenia",
  completed: "Zamknięte",
  cancelled: "Anulowane",
};

const STATUS_TONE: Record<TaskStatus, string> = {
  pending: "bg-amber-50 text-amber-700 border border-amber-100",
  in_progress: "bg-blue-50 text-blue-700 border border-blue-100",
  awaiting_review: "bg-purple-50 text-purple-700 border border-purple-100",
  completed: "bg-emerald-50 text-emerald-700 border border-emerald-100",
  cancelled: "bg-slate-100 text-slate-500 border border-slate-200",
};

const STATUS_OPTIONS: { value: TaskStatus | "all"; label: string }[] = [
  { value: "all", label: "Wszystkie" },
  { value: "pending", label: STATUS_LABELS.pending },
  { value: "in_progress", label: STATUS_LABELS.in_progress },
  { value: "awaiting_review", label: STATUS_LABELS.awaiting_review },
  { value: "completed", label: STATUS_LABELS.completed },
  { value: "cancelled", label: STATUS_LABELS.cancelled },
];

type TaskStatus = "pending" | "in_progress" | "awaiting_review" | "completed" | "cancelled";

type TaskMessage = {
  id: number;
  task: number;
  author: number;
  author_name: string | null;
  author_role: string | null;
  body: string;
  is_completion: boolean;
  is_manager_reply: boolean;
  created_at: string;
};

type TaskRecord = {
  id: number;
  client: number;
  client_name: string;
  client_city: string | null;
  title: string;
  description: string;
  due_date: string;
  days_until_due: number | null;
  status: TaskStatus;
  created_by: number;
  created_by_name: string | null;
  assigned_to: number;
  assigned_to_name: string | null;
  completed_at: string | null;
  completed_by: number | null;
  messages: TaskMessage[];
  updated_at: string;
};

type TaskFilters = {
  status: TaskStatus | "all";
  assignedTo: string;
  client: string;
  overdueOnly: boolean;
  search: string;
};

type NewTaskForm = {
  client: string;
  assignedTo: string;
  title: string;
  description: string;
  dueDate: string;
};

type ClientOption = {
  id: number;
  name: string;
  city?: string | null;
  salesman_id?: number | null;
};

type SalesRepOption = { id: number; username: string; first_name?: string | null; last_name?: string | null };

type CurrentUser = {
  id: number;
  username: string;
  role: string;
  tenant?: { id: number } | null;
};

const formatRepName = (rep: SalesRepOption) => {
  const name = [rep.first_name, rep.last_name].filter(Boolean).join(" ");
  return name || rep.username;
};

const formatDateTime = (value: string | null) => {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatDueInfo = (task: TaskRecord) => {
  if (!task.due_date) {
    return "Brak terminu";
  }
  const dateLabel = new Date(task.due_date).toLocaleDateString("pl-PL");
  if (task.days_until_due === null) {
    return `Termin ${dateLabel}`;
  }
  if (task.days_until_due < 0) {
    return `Po terminie o ${Math.abs(task.days_until_due)} dni (termin ${dateLabel})`;
  }
  if (task.days_until_due === 0) {
    return `Termin dzisiaj (${dateLabel})`;
  }
  if (task.days_until_due === 1) {
    return `Termin jutro (${dateLabel})`;
  }
  return `Termin za ${task.days_until_due} dni (${dateLabel})`;
};

const getStatusTone = (status: TaskStatus) => STATUS_TONE[status] ?? "bg-slate-100 text-slate-600";

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const highlightMatch = (text: string, query: string): ReactNode => {
  if (!query.trim()) {
    return text;
  }
  const safe = escapeRegExp(query.trim());
  const regex = new RegExp(`(${safe})`, "ig");
  const parts = text.split(regex);
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <mark key={`${part}-${index}`} className="rounded bg-amber-100 px-0.5 text-amber-900">
        {part}
      </mark>
    ) : (
      part
    ),
  );
};

export default function TasksPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Ładowanie...</div>}>
      <TasksPageInner />
    </Suspense>
  );
}

function TasksPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);
  const clearAuth = useAuthStore((state) => state.clear);

  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [isLoadingUser, setIsLoadingUser] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);

  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [salesReps, setSalesReps] = useState<SalesRepOption[]>([]);
  const [filters, setFilters] = useState<TaskFilters>({ status: "all", assignedTo: "", client: "", overdueOnly: false, search: "" });
  const [newTaskForm, setNewTaskForm] = useState<NewTaskForm>({ client: "", assignedTo: "", title: "", description: "", dueDate: "" });
  const [clientPickerQuery, setClientPickerQuery] = useState("");
  const [clientPickerActive, setClientPickerActive] = useState(false);
  const [clientPickerHighlightIndex, setClientPickerHighlightIndex] = useState(0);
  const [creatingTask, setCreatingTask] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [managerDueDrafts, setManagerDueDrafts] = useState<Record<number, string>>({});
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const socketRef = useRef<WebSocket | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [focusedTaskId, setFocusedTaskId] = useState<number | null>(null);

  const isManager = currentUser?.role === "admin" || currentUser?.role === "manager";
  const isRep = currentUser?.role === "rep";
  const tenantId = currentUser?.tenant?.id ?? DEFAULT_TENANT_ID;

  const salesRepMap = useMemo(() => {
    const map = new Map<number, SalesRepOption>();
    salesReps.forEach((rep) => map.set(rep.id, rep));
    return map;
  }, [salesReps]);

  const selectedClient = useMemo(() => clients.find((client) => String(client.id) === newTaskForm.client) ?? null, [clients, newTaskForm.client]);

  useEffect(() => {
    if (selectedClient) {
      setClientPickerQuery((prev) => (prev === selectedClient.name ? prev : selectedClient.name));
    } else if (!newTaskForm.client) {
      setClientPickerQuery((prev) => (prev ? "" : prev));
    }
  }, [selectedClient, newTaskForm.client]);

  const clientSuggestions = useMemo(() => {
    const query = clientPickerQuery.trim().toLowerCase();
    if (!query) {
      return clients.slice(0, 8);
    }
    const scored = clients
      .map((client) => {
        const name = (client.name ?? "").toLowerCase();
        const city = (client.city ?? "").toLowerCase();
        const haystack = `${name} ${city}`.trim();
        const matchIndex = haystack.indexOf(query);
        if (matchIndex === -1) {
          return null;
        }
        const startsWith = name.startsWith(query) ? -2 : city.startsWith(query) ? -1 : 0;
        return {
          client,
          score: matchIndex + startsWith,
        };
      })
      .filter((entry): entry is { client: ClientOption; score: number } => Boolean(entry))
      .sort((a, b) => a.score - b.score || a.client.name.localeCompare(b.client.name, "pl", { sensitivity: "base" }));
    return scored.slice(0, 8).map((entry) => entry.client);
  }, [clients, clientPickerQuery]);

  const clientPickerBlurTimeout = useRef<NodeJS.Timeout | null>(null);
  const clientSuggestionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleClientPick = useCallback(
    (client: ClientOption) => {
      setNewTaskForm((prev) => ({
        ...prev,
        client: String(client.id),
        assignedTo: client.salesman_id ? String(client.salesman_id) : prev.assignedTo,
      }));
      setClientPickerQuery(client.name);
      setClientPickerActive(false);
    },
    [],
  );

  const handleClientPickerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (!clientPickerActive && ["ArrowDown", "ArrowUp"].includes(event.key)) {
        setClientPickerActive(true);
      }
      if (!clientSuggestions.length) {
        if (event.key === "Escape") {
          setClientPickerActive(false);
        }
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setClientPickerHighlightIndex((prev) => (prev + 1) % clientSuggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setClientPickerHighlightIndex((prev) => (prev - 1 + clientSuggestions.length) % clientSuggestions.length);
        return;
      }
      if (event.key === "Enter") {
        const target = clientSuggestions[clientPickerHighlightIndex];
        if (target) {
          event.preventDefault();
          handleClientPick(target);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setClientPickerActive(false);
        (event.currentTarget as HTMLInputElement).blur();
      }
    },
    [clientPickerActive, clientPickerHighlightIndex, clientSuggestions, handleClientPick],
  );

  useEffect(() => {
    setClientPickerHighlightIndex(0);
  }, [clientPickerQuery]);

  useEffect(() => {
    if (!clientSuggestions.length) {
      setClientPickerHighlightIndex(0);
      return;
    }
    setClientPickerHighlightIndex((prev) => Math.min(prev, clientSuggestions.length - 1));
  }, [clientSuggestions]);

  useEffect(() => {
    const node = clientSuggestionRefs.current[clientPickerHighlightIndex];
    if (node) {
      node.scrollIntoView({ block: "nearest" });
    }
  }, [clientPickerHighlightIndex, clientSuggestions]);

  const selectedClientSalesmanName = useMemo(() => {
    if (!selectedClient?.salesman_id) {
      return null;
    }
    const rep = salesRepMap.get(selectedClient.salesman_id);
    return rep ? formatRepName(rep) : `Handlowiec #${selectedClient.salesman_id}`;
  }, [selectedClient, salesRepMap]);

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
    const loadUser = async () => {
      setIsLoadingUser(true);
      setUserError(null);
      try {
        const response = await authorizedFetch("/api/accounts/users/me/");
        if (!response.ok) {
          throw new Error("Nie udało się pobrać danych użytkownika.");
        }
        const payload = (await response.json()) as CurrentUser;
        if (!cancelled) {
          setCurrentUser(payload);
        }
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setUserError(error instanceof Error ? error.message : "Błąd ładowania użytkownika.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingUser(false);
        }
      }
    };
    loadUser();
    return () => {
      cancelled = true;
    };
  }, [hydrated, token]);

  const fetchSalesReps = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const response = await authorizedFetch("/api/accounts/sales-reps/?limit=200");
      if (!response.ok) {
        throw new Error("Nie udało się pobrać listy handlowców.");
      }
      const payload = await response.json();
      const items = Array.isArray(payload) ? payload : payload.results ?? [];
      const reps: SalesRepOption[] = items.map((item: any) => ({
        id: item.id,
        username: item.username,
        first_name: item.first_name ?? item.firstName ?? null,
        last_name: item.last_name ?? item.lastName ?? null,
      }));
      setSalesReps(reps);
    } catch (error) {
      console.error(error);
      setSalesReps([]);
    }
  }, [token]);

  const fetchClients = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const response = await authorizedFetch("/api/clients/?limit=500");
      if (!response.ok) {
        throw new Error("Nie udało się pobrać listy klientów.");
      }
      const payload = await response.json();
      const items = Array.isArray(payload) ? payload : payload.results ?? [];
      const data: ClientOption[] = items.map((item: any) => ({
        id: item.id,
        name: item.name,
        city: item.city,
        salesman_id: item.salesman ?? item.salesman_id ?? null,
      }));
      setClients(data);
    } catch (error) {
      console.error(error);
      setClients([]);
    }
  }, [token]);

  const applyTaskUpdate = useCallback((nextTask: TaskRecord | null, updateOnly?: Partial<TaskRecord>) => {
    setTasks((prev) => {
      if (!nextTask && !updateOnly) {
        return prev;
      }
      const copy = [...prev];
      const findIndex = nextTask ? copy.findIndex((task) => task.id === nextTask.id) : updateOnly ? copy.findIndex((task) => task.id === updateOnly.id) : -1;
      if (nextTask) {
        if (findIndex >= 0) {
          const existing = copy[findIndex];
          copy[findIndex] = { ...existing, ...nextTask, messages: nextTask.messages ?? existing.messages };
        } else {
          copy.unshift(nextTask);
        }
      } else if (updateOnly && findIndex >= 0) {
        copy[findIndex] = { ...copy[findIndex], ...updateOnly } as TaskRecord;
      }
      return copy.sort((a, b) => a.due_date.localeCompare(b.due_date));
    });
  }, []);

  const mergeTasksFromApi = useCallback((items: TaskRecord[]) => {
    setTasks((prev) => {
      const prevMap = new Map(prev.map((t) => [t.id, t]));
      const merged = items.map((item) => {
        const existing = prevMap.get(item.id);
        // Preserve existing messages if API returns empty array
        const messages = Array.isArray(item.messages) && item.messages.length > 0
          ? item.messages
          : existing?.messages ?? [];
        return { ...item, messages };
      });
      return merged.sort((a, b) => a.due_date.localeCompare(b.due_date));
    });
  }, []);

  const fetchTasks = useCallback(async () => {
    if (!token) {
      return;
    }
    setIsLoadingTasks(true);
    setTasksError(null);
    try {
      const params = new URLSearchParams();
      if (filters.status !== "all") {
        params.set("status", filters.status);
      }
      if (filters.assignedTo) {
        params.set("assigned_to", filters.assignedTo);
      }
      if (filters.client) {
        params.set("client", filters.client);
      }
      if (filters.overdueOnly) {
        params.set("overdue", "1");
      }
      const url = `/api/tasks/${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await authorizedFetch(url);
      if (!response.ok) {
        throw new Error("Nie udało się pobrać listy zadań.");
      }
      const payload = await response.json();
      const items: TaskRecord[] = (Array.isArray(payload) ? payload : payload.results ?? []).map((item: TaskRecord) => ({
        ...item,
        messages: Array.isArray(item.messages) ? item.messages : [],
      }));
      mergeTasksFromApi(items);
    } catch (error) {
      console.error(error);
      setTasksError(error instanceof Error ? error.message : "Błąd pobierania zadań.");
    } finally {
      setIsLoadingTasks(false);
    }
  }, [token, filters, mergeTasksFromApi]);

  useEffect(() => {
    if (!token || !currentUser) {
      return;
    }
    fetchSalesReps().catch(() => undefined);
    fetchClients().catch(() => undefined);
  }, [token, currentUser, fetchSalesReps, fetchClients]);

  useEffect(() => {
    if (!token || !currentUser) {
      return;
    }
    fetchTasks().catch(() => undefined);
  }, [token, currentUser, fetchTasks]);

  useEffect(() => {
    if (!token || !tenantId || !hydrated) {
      return;
    }
    const wsUrl = `${WS_BASE_URL}/ws/tasks/${tenantId}/?token=${token}`;
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;
    socket.onopen = () => {
      setWsConnected(true);
    };
    socket.onclose = () => {
      setWsConnected(false);
    };
    socket.onerror = () => {
      setWsConnected(false);
    };
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!data?.type) {
          return;
        }
        if (data.type === "task.snapshot") {
          setTasks((prev) => {
            const prevMap = new Map(prev.map((t) => [t.id, t]));
            const items: TaskRecord[] = (data.payload ?? []).map((item: TaskRecord) => {
              const existing = prevMap.get(item.id);
              const messages = Array.isArray(item.messages) && item.messages.length > 0
                ? item.messages
                : existing?.messages ?? [];
              return { ...item, messages };
            });
            return items.sort((a, b) => a.due_date.localeCompare(b.due_date));
          });
        } else if (data.type === "task.update") {
          const update = data.payload as TaskRecord;
          applyTaskUpdate({ ...update, messages: tasks.find((task) => task.id === update.id)?.messages ?? [] });
        } else if (data.type === "task.message") {
          const message = data.payload as TaskMessage;
          setTasks((prev) =>
            prev.map((task) =>
              task.id === message.task
                ? { ...task, messages: [...task.messages, message], status: task.status === "pending" ? "in_progress" : task.status }
                : task,
            ),
          );
        }
      } catch (error) {
        console.error("Błąd WebSocket", error);
      }
    };
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [token, tenantId, hydrated, mergeTasksFromApi, applyTaskUpdate, tasks]);

  const visibleTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (!isManager && isRep && task.assigned_to !== currentUser?.id) {
        return false;
      }
      if (filters.status !== "all" && task.status !== filters.status) {
        return false;
      }
      if (filters.client && String(task.client) !== filters.client) {
        return false;
      }
      if (filters.assignedTo && String(task.assigned_to) !== filters.assignedTo) {
        return false;
      }
      if (filters.overdueOnly && task.days_until_due !== null && task.days_until_due >= 0) {
        return false;
      }
      if (filters.search.trim()) {
        const query = filters.search.trim().toLowerCase();
        if (!task.title.toLowerCase().includes(query) && !task.description.toLowerCase().includes(query) && !task.client_name.toLowerCase().includes(query)) {
          return false;
        }
      }
      return true;
    });
  }, [tasks, filters, isManager, isRep, currentUser?.id]);

  const filteredSalesReps = useMemo(() => {
    if (!isManager) {
      return salesReps.filter((rep) => rep.id === currentUser?.id);
    }
    return salesReps;
  }, [isManager, salesReps, currentUser?.id]);

  const hasScrolledToTaskRef = useRef<number | null>(null);

  useEffect(() => {
    const paramId = searchParams?.get("taskId");
    if (paramId) {
      const parsed = Number(paramId);
      if (!Number.isNaN(parsed)) {
        // Reset scroll ref when taskId changes to allow highlighting new task
        if (hasScrolledToTaskRef.current !== parsed) {
          hasScrolledToTaskRef.current = null;
        }
        setFocusedTaskId(parsed);
        setFilters((prev) => ({ ...prev, status: "all", overdueOnly: false }));
      }
    } else {
      setFocusedTaskId(null);
      hasScrolledToTaskRef.current = null;
    }
  }, [searchParams]);

  useEffect(() => {
    if (!focusedTaskId) {
      return;
    }
    // Only scroll once per taskId
    if (hasScrolledToTaskRef.current === focusedTaskId) {
      return;
    }
    const el = document.getElementById(`task-card-${focusedTaskId}`);
    if (el) {
      hasScrolledToTaskRef.current = focusedTaskId;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("ring", "ring-blue-400");
      setTimeout(() => {
        el.classList.remove("ring", "ring-blue-400");
      }, 2000);
    }
  }, [focusedTaskId, tasks]);

  const handleCreateTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      return;
    }
    if (!newTaskForm.client || !newTaskForm.assignedTo || !newTaskForm.title || !newTaskForm.dueDate) {
      setCreateError("Uzupełnij klienta, handlowca, tytuł i termin.");
      return;
    }
    setCreatingTask(true);
    setCreateError(null);
    try {
      const payload = {
        client: Number(newTaskForm.client),
        assigned_to: Number(newTaskForm.assignedTo),
        title: newTaskForm.title,
        description: newTaskForm.description,
        due_date: newTaskForm.dueDate,
      };
      const response = await authorizedFetch("/api/tasks/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? "Nie udało się dodać zadania.");
      }
      setNewTaskForm({ client: "", assignedTo: "", title: "", description: "", dueDate: "" });
      fetchTasks().catch(() => undefined);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Nie udało się dodać zadania.");
    } finally {
      setCreatingTask(false);
    }
  };

  const sendMessage = async (task: TaskRecord, isManagerReply = false) => {
    const draft = replyDrafts[task.id]?.trim();
    if (!draft) {
      setTasksError("Treść wiadomości jest wymagana.");
      return;
    }
    setActionLoading((prev) => ({ ...prev, [`reply-${task.id}`]: true }));
    try {
      const payload: Record<string, unknown> = { body: draft };
      if (isManagerReply && managerDueDrafts[task.id]) {
        payload.due_date = managerDueDrafts[task.id];
      }
      const response = await authorizedFetch(`/api/tasks/${task.id}/messages/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? "Nie udało się dodać odpowiedzi.");
      }
      setReplyDrafts((prev) => ({ ...prev, [task.id]: "" }));
      if (isManagerReply) {
        setManagerDueDrafts((prev) => ({ ...prev, [task.id]: "" }));
      }
      fetchTasks().catch(() => undefined);
    } catch (error) {
      setTasksError(error instanceof Error ? error.message : "Nie udało się dodać odpowiedzi.");
    } finally {
      setActionLoading((prev) => ({ ...prev, [`reply-${task.id}`]: false }));
    }
  };

  const markTaskComplete = async (task: TaskRecord) => {
    const draft = replyDrafts[task.id]?.trim();
    if (!draft) {
      setTasksError("Dodaj krótką notatkę, zanim oznaczysz zadanie jako wykonane.");
      return;
    }
    setActionLoading((prev) => ({ ...prev, [`complete-${task.id}`]: true }));
    try {
      const response = await authorizedFetch(`/api/tasks/${task.id}/complete/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? "Nie udało się oznaczyć zadania.");
      }
      setReplyDrafts((prev) => ({ ...prev, [task.id]: "" }));
      fetchTasks().catch(() => undefined);
    } catch (error) {
      setTasksError(error instanceof Error ? error.message : "Nie udało się oznaczyć zadania.");
    } finally {
      setActionLoading((prev) => ({ ...prev, [`complete-${task.id}`]: false }));
    }
  };

  const confirmTask = async (task: TaskRecord) => {
    const draft = replyDrafts[task.id]?.trim();
    setActionLoading((prev) => ({ ...prev, [`confirm-${task.id}`]: true }));
    try {
      const payload = draft ? { body: draft } : {};
      const response = await authorizedFetch(`/api/tasks/${task.id}/confirm/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? "Nie udało się potwierdzić zadania.");
      }
      setReplyDrafts((prev) => ({ ...prev, [task.id]: "" }));
      fetchTasks().catch(() => undefined);
    } catch (error) {
      setTasksError(error instanceof Error ? error.message : "Nie udało się potwierdzić zadania.");
    } finally {
      setActionLoading((prev) => ({ ...prev, [`confirm-${task.id}`]: false }));
    }
  };

  const reopenTask = async (task: TaskRecord) => {
    setActionLoading((prev) => ({ ...prev, [`reopen-${task.id}`]: true }));
    try {
      const response = await authorizedFetch(`/api/tasks/${task.id}/reopen/`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? "Nie udało się wznowić zadania.");
      }
      fetchTasks().catch(() => undefined);
    } catch (error) {
      setTasksError(error instanceof Error ? error.message : "Nie udało się wznowić zadania.");
    } finally {
      setActionLoading((prev) => ({ ...prev, [`reopen-${task.id}`]: false }));
    }
  };

  if (!hydrated || isLoadingUser) {
    return null;
  }

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="glass-card w-full max-w-md space-y-4 p-8 text-center">
          <p className="text-sm font-semibold text-slate-900">Dostęp wymaga zalogowania.</p>
          <button
            onClick={() => router.push("/auth/login")}
            className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
          >
            Przejdź do logowania
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-6xl space.gridy-6">
        <nav className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-blue-500 hover:text-blue-600"
          >
            ← Powrót na dashboard
          </Link>
          <button
            type="button"
            onClick={() => {
              clearAuth();
              router.replace("/auth/login");
            }}
            className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-blue-500 hover:text-blue-600"
          >
            Wyloguj się
          </button>
        </nav>

        <header className="glass-card p-6">
          <p className="text-xs uppercase tracking-[0.35em] text-blue-500">Zadania</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Koordynacja pracy handlowców</h1>
          <p className="text-sm text-slate-600">
            Twórz zadania powiązane z klientami, monitoruj odpowiedzi i terminy. Aktualizacje spływają w czasie rzeczywistym.
          </p>
          {userError && <p className="mt-2 text-sm text-red-600">{userError}</p>}
        </header>

        <section className="glass-card space-y-4 p-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
              Status
              <select
                value={filters.status}
                onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value as TaskStatus | "all" }))}
                className="rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {isManager && (
              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
                Handlowiec
                <select
                  value={filters.assignedTo}
                  onChange={(event) => setFilters((prev) => ({ ...prev, assignedTo: event.target.value }))}
                  className="rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Wszyscy</option>
                  {filteredSalesReps.map((rep) => (
                    <option key={rep.id} value={rep.id}>
                      {formatRepName(rep)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
              Klient
              <select
                value={filters.client}
                onChange={(event) => setFilters((prev) => ({ ...prev, client: event.target.value }))}
                className="rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              >
                <option value="">Wszyscy</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
              Wyszukaj
              <input
                type="text"
                value={filters.search}
                onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
                placeholder="np. nazwa klienta, zadania"
                className="rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
              <input
                type="checkbox"
                checked={filters.overdueOnly}
                onChange={(event) => setFilters((prev) => ({ ...prev, overdueOnly: event.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              Tylko zaległe
            </label>
            <button
              type="button"
              onClick={() => fetchTasks().catch(() => undefined)}
              className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-blue-400"
              disabled={isLoadingTasks}
            >
              {isLoadingTasks ? "Odświeżam…" : "Odśwież"}
            </button>
            {tasksError && <p className="text-sm font-semibold text-red-600">{tasksError}</p>}
          </div>
        </section>

        {isManager && (
          <section className="glass-card space-y-4 p-6">
            <header>
              <p className="text-xs uppercase tracking-[0.35em] text-emerald-500">Dodaj zadanie</p>
              <h2 className="text-lg font-semibold text-slate-900">Nowe polecenie dla handlowca</h2>
            </header>
            <form onSubmit={handleCreateTask} className="grid gap-4 md:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700">
                Klient
                <div className="mt-1 space-y-2">
                  <div className="relative">
                    <input
                      type="text"
                      value={clientPickerQuery}
                      onChange={(event) => {
                        setClientPickerQuery(event.target.value);
                        setClientPickerActive(true);
                        setClientPickerHighlightIndex(0);
                      }}
                      onFocus={() => {
                        if (clientPickerBlurTimeout.current) {
                          clearTimeout(clientPickerBlurTimeout.current);
                          clientPickerBlurTimeout.current = null;
                        }
                        setClientPickerActive(true);
                      }}
                      onBlur={() => {
                        clientPickerBlurTimeout.current = setTimeout(() => setClientPickerActive(false), 150);
                      }}
                      onKeyDown={handleClientPickerKeyDown}
                      placeholder="Wpisz nazwę lub miasto"
                      className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                      required
                    />
                    {clientPickerActive && (
                      <div className="absolute z-20 mt-2 w-full max-h-64 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
                        {clientSuggestions.length > 0 ? (
                          clientSuggestions.map((client, index) => (
                            <button
                              key={client.id}
                              type="button"
                              ref={(node) => {
                                clientSuggestionRefs.current[index] = node;
                              }}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => handleClientPick(client)}
                              className={`flex w-full flex-col gap-1 rounded-xl px-3 py-2 text-left text-sm transition ${
                                index === clientPickerHighlightIndex ? "bg-blue-50" : "hover:bg-slate-50"
                              } ${String(client.id) === newTaskForm.client ? "ring-1 ring-blue-300" : ""}`}
                            >
                              <span className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-400">
                                <span>{client.salesman_id ? `Klient #${client.id}` : "Nowy klient"}</span>
                                {client.salesman_id && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">MA HANDLOWCA</span>}
                              </span>
                              <span className="text-sm font-semibold text-slate-900">
                                {highlightMatch(client.name ?? "", clientPickerQuery)}
                              </span>
                              <span className="text-xs text-slate-500">
                                {client.city ? highlightMatch(client.city, clientPickerQuery) : "Brak miasta"}
                              </span>
                            </button>
                          ))
                        ) : (
                          <p className="px-3 py-4 text-center text-sm text-slate-500">
                            {clientPickerQuery.trim()
                              ? "Brak klientów pasujących do wyszukiwania."
                              : "Zacznij pisać nazwę klienta lub miasta."}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    {selectedClient ? (
                      <span>
                        Wybrano: <span className="font-semibold text-slate-900">{selectedClient.name}</span>
                        {selectedClient.city ? ` • ${selectedClient.city}` : ""}
                      </span>
                    ) : (
                      <span>Nie wybrano klienta.</span>
                    )}
                    {selectedClient && (
                      <button
                        type="button"
                        onClick={() => {
                          setNewTaskForm((prev) => ({ ...prev, client: "" }));
                          setClientPickerQuery("");
                        }}
                        className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:border-rose-200 hover:text-rose-500"
                      >
                        Wyczyść
                      </button>
                    )}
                  </div>
                  {selectedClientSalesmanName && (
                    <p className="text-xs text-emerald-600">
                      Automatycznie przypisano handlowca: <span className="font-semibold">{selectedClientSalesmanName}</span>
                    </p>
                  )}
                </div>
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Handlowiec
                <select
                  value={newTaskForm.assignedTo}
                  onChange={(event) => setNewTaskForm((prev) => ({ ...prev, assignedTo: event.target.value }))}
                  required
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">– wybierz handlowca –</option>
                  {salesReps.map((rep) => (
                    <option key={rep.id} value={rep.id}>
                      {formatRepName(rep)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Tytuł
                <input
                  type="text"
                  value={newTaskForm.title}
                  onChange={(event) => setNewTaskForm((prev) => ({ ...prev, title: event.target.value }))}
                  required
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Termin
                <input
                  type="date"
                  value={newTaskForm.dueDate}
                  onChange={(event) => setNewTaskForm((prev) => ({ ...prev, dueDate: event.target.value }))}
                  required
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="text-sm font-semibold text-slate-700 md:col-span-2">
                Opis
                <textarea
                  value={newTaskForm.description}
                  onChange={(event) => setNewTaskForm((prev) => ({ ...prev, description: event.target.value }))}
                  rows={3}
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <div className="md:col-span-2 flex flex-wrap items-center gap-4">
                <button
                  type="submit"
                  disabled={creatingTask}
                  className="rounded-2xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  {creatingTask ? "Zapisuję…" : "Dodaj zadanie"}
                </button>
                {createError && <p className="text-sm text-red-600">{createError}</p>}
              </div>
            </form>
          </section>
        )}

        <section className="space-y-4">
          {isLoadingTasks && (
            <div className="rounded-3xl border border-blue-100 bg-blue-50/60 p-4 text-sm text-blue-700">
              Ładuję zadania…
            </div>
          )}

          {!isLoadingTasks && visibleTasks.length === 0 && (
            <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
              Brak zadań spełniających kryteria.
            </div>
          )}

          {visibleTasks.map((task) => (
            <article
              key={task.id}
              id={`task-card-${task.id}`}
              className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Zadanie #{task.id}</p>
                  <h3 className="text-lg font-semibold text-slate-900">{task.title}</h3>
                  <p className="text-sm text-slate-500">
                    Klient: <span className="font-semibold text-slate-900">{task.client_name}</span>
                    {task.client_city ? ` • ${task.client_city}` : ""} • Przydzielono do {task.assigned_to_name}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 text-sm">
                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusTone(task.status)}`}>
                    {STATUS_LABELS[task.status]}
                  </span>
                  <span className="text-xs text-slate-500">{formatDueInfo(task)}</span>
                </div>
              </header>

              {task.description && <p className="text-sm text-slate-700">{task.description}</p>}

              <div className="space-y-3">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Historia</p>
                <div className="space-y-3">
                  {task.messages.length === 0 && <p className="text-sm text-slate-500">Brak komentarzy.</p>}
                  {task.messages.map((message) => {
                    const isManagerMessage = message.is_manager_reply || message.author_role === "manager" || message.author_role === "admin";
                    return (
                      <div
                        key={message.id}
                        className={`rounded-2xl border p-3 text-sm ${
                          isManagerMessage
                            ? "border-blue-200 bg-blue-50/80"
                            : "border-emerald-200 bg-emerald-50/80"
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className={`font-semibold ${isManagerMessage ? "text-blue-900" : "text-emerald-900"}`}>
                            {message.author_name} {message.author_role ? `(${message.author_role})` : ""}
                          </span>
                          <span className={isManagerMessage ? "text-blue-600" : "text-emerald-600"}>{formatDateTime(message.created_at)}</span>
                        </div>
                        <p className={`mt-1 ${isManagerMessage ? "text-blue-800" : "text-emerald-800"}`}>{message.body}</p>
                        {message.is_completion && (
                          <span className="mt-1 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                            Potwierdzenie wykonania
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3">
                <textarea
                  value={replyDrafts[task.id] ?? ""}
                  onChange={(event) => setReplyDrafts((prev) => ({ ...prev, [task.id]: event.target.value }))}
                  placeholder="Dodaj odpowiedź"
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
                {isManager && (
                  <div className="flex flex-col gap-2 text-xs text-slate-500">
                    <label className="flex items-center gap-2">
                      Kolejny termin:
                      <input
                        type="date"
                        value={managerDueDrafts[task.id] ?? ""}
                        onChange={(event) => setManagerDueDrafts((prev) => ({ ...prev, [task.id]: event.target.value }))}
                        className="rounded-2xl border border-slate-200 px-3 py-1 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                      />
                    </label>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {isManager && (
                    <button
                      type="button"
                      onClick={() => sendMessage(task, isManager)}
                      disabled={actionLoading[`reply-${task.id}`]}
                      className="rounded-2xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {actionLoading[`reply-${task.id}`] ? "Aktualizuję…" : "Zaktualizuj zadanie"}
                    </button>
                  )}
                  {isManager &&
                    task.status !== "completed" &&
                    task.status !== "cancelled" &&
                    task.status !== "awaiting_review" && (
                    <button
                      type="button"
                      onClick={() => confirmTask(task)}
                      disabled={actionLoading[`confirm-inline-${task.id}`]}
                      className="rounded-2xl border border-emerald-300 px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {actionLoading[`confirm-inline-${task.id}`] ? "Zamykam…" : "Zakończ zadanie"}
                    </button>
                  )}
                  {isRep && task.status !== "completed" && task.status !== "awaiting_review" && (
                    <button
                      type="button"
                      onClick={() => markTaskComplete(task)}
                      disabled={actionLoading[`complete-${task.id}`]}
                      className="rounded-2xl border border-emerald-300 px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {actionLoading[`complete-${task.id}`] ? "Zgłaszam…" : "Oznacz wykonane"}
                    </button>
                  )}
                  {isManager && task.status === "awaiting_review" && (
                    <button
                      type="button"
                      onClick={() => confirmTask(task)}
                      disabled={actionLoading[`confirm-${task.id}`]}
                      className="rounded-2xl border border-emerald-300 px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {actionLoading[`confirm-${task.id}`] ? "Zamykam…" : "Zakończ zadanie"}
                    </button>
                  )}
                  {isManager && task.status === "completed" && (
                    <button
                      type="button"
                      onClick={() => reopenTask(task)}
                      disabled={actionLoading[`reopen-${task.id}`]}
                      className="rounded-2xl border border-purple-300 px-4 py-2 text-xs font-semibold text-purple-700 transition hover:border-purple-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {actionLoading[`reopen-${task.id}`] ? "Przywracam…" : "Przywróć zadanie"}
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuthStore } from "@/store/auth-store";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

type NoteStyle = {
  container: string;
  heading: string;
  meta: string;
  body: string;
};

type SalesRepOption = {
  id: number;
  username: string;
  first_name?: string | null;
  last_name?: string | null;
};

type CurrentUser = {
  id: number;
  username: string;
  role: string;
};

const getNoteStyles = (role?: string | null): NoteStyle => {
  if (role === "admin" || role === "manager") {
    return {
      container: "bg-indigo-50 text-indigo-700 border border-indigo-100",
      heading: "text-indigo-900",
      meta: "text-indigo-500",
      body: "text-indigo-700",
    };
  }
  return {
    container: "bg-emerald-50 text-emerald-700 border border-emerald-100",
    heading: "text-emerald-900",
    meta: "text-emerald-500",
    body: "text-emerald-700",
  };
};

const formatSalesRepName = (rep?: SalesRepOption | null) => {
  if (!rep) {
    return "Handlowiec";
  }
  const names = [rep.first_name, rep.last_name].filter(Boolean).join(" ");
  return names || rep.username;
};

type RouteStopRecord = {
  id: number | string;
  clientId: number | null;
  clientName: string;
  city?: string;
  street?: string;
  postalCode?: string;
  comment: string;
  order: number;
};

type ReturnToStartMeta = {
  __returnToStart: true;
  latitude?: number;
  longitude?: number;
  address?: string;
};

type StopCommentEntry = {
  id: string;
  authorName: string;
  authorRole?: string | null;
  body: string;
  createdAt: string;
};

type RoutePlanRecord = {
  id: number;
  date: string;
  ownerId: number | null;
  ownerName: string;
  totalDriveMinutes: number;
  totalVisitMinutes: number;
  stops: RouteStopRecord[];
};

type VisitRecord = {
  id: number;
  clientId: number | null;
  clientName: string;
  salesmanId: number | null;
  salesmanName: string;
  plannedAt: string;
  plannedDate: string;
  comment: string;
  status: string;
  locationName?: string;
};

type ContactRecord = {
  id: number;
  clientId: number | null;
  clientName: string;
  clientCity?: string | null;
  handlerId: number | null;
  handlerName: string;
  contactDate: string;
  nextContactAt?: string | null;
  outcome?: string;
  comment?: string;
};

type TaskStatus = "pending" | "in_progress" | "awaiting_review" | "completed" | "cancelled";

type TaskRecord = {
  id: number;
  clientId: number | null;
  clientName: string;
  clientCity?: string | null;
  assignedToId: number | null;
  assignedToName: string;
  title: string;
  description: string;
  dueDate: string | null;
  createdAt: string | null;
  completedAt: string | null;
  status: TaskStatus;
  messages?: TaskMessage[];
};

type TaskMessage = {
  id: number;
  authorName?: string | null;
  authorRole?: string | null;
  body: string;
  createdAt: string;
};

type RawTaskMessage = {
  id?: number;
  author_name?: string | null;
  authorName?: string | null;
  author_role?: string | null;
  authorRole?: string | null;
  body?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
};

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Nowe",
  in_progress: "W trakcie",
  awaiting_review: "Do potwierdzenia",
  completed: "Zamknięte",
  cancelled: "Anulowane",
};

const TASK_STATUS_TONES: Record<TaskStatus, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-100",
  in_progress: "bg-blue-50 text-blue-700 border-blue-100",
  awaiting_review: "bg-purple-50 text-purple-700 border-purple-100",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-100",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
};

type Filters = {
  dateFrom: string;
  dateTo: string;
  salesman: string;
};

type StopHistoryEntry = {
  stop: RouteStopRecord;
  visit?: VisitRecord;
};

type RouteCard = {
  plan: RoutePlanRecord;
  stops: StopHistoryEntry[];
  confirmedCount: number;
  pendingCount: number;
};

const formatMinutes = (minutes: number) => {
  if (!minutes) {
    return "0 min";
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hours) {
    return `${mins} min`;
  }
  if (!mins) {
    return `${hours} h`;
  }
  return `${hours} h ${mins} min`;
};

const formatDateLabel = (isoDate: string) => {
  return new Date(isoDate).toLocaleDateString("pl-PL", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
};

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

const defaultFilters = (): Filters => {
  const today = new Date();
  const from = new Date();
  from.setDate(today.getDate() - 6);
  return {
    dateFrom: toIsoDate(from),
    dateTo: toIsoDate(today),
    salesman: "",
  };
};

type PaginatedResponse<T> = {
  results?: T[];
};

type RawRouteStop = {
  id?: number | string;
  client?: number | null;
  client_id?: number | null;
  client_name?: string;
  clientName?: string;
  client_city?: string;
  client_street?: string;
  client_postal_code?: string;
  comment?: string;
  order?: number;
};

type RawRoutePlan = {
  id?: number;
  date?: string;
  owner?: number | null;
  owner_id?: number | null;
  ownerId?: number | null;
  owner_name?: string;
  ownerName?: string;
  total_drive_minutes?: number;
  total_visit_minutes?: number;
  stops?: RawRouteStop[];
};

type RawVisit = {
  id: number;
  client?: number | RawClient | null;
  client_id?: number | null;
  client_name?: string;
  salesman?: number | RawSalesman | null;
  salesman_id?: number | null;
  salesman_name?: string;
  planned_at?: string;
  comment?: unknown;
  status?: string;
  location_name?: string;
};

type RawCallRecord = {
  id: number;
  client?: number | RawClient | null;
  client_id?: number | null;
  client_name?: string;
  handler?: number | RawSalesman | null;
  handler_id?: number | null;
  handler_name?: string;
  contact_date?: string;
  next_contact_at?: string | null;
  outcome?: string;
  current_comment?: string;
};

type RawTask = {
  id: number;
  client?: number | RawClient | null;
  client_id?: number | null;
  client_name?: string;
  client_city?: string;
  assigned_to?: number | RawSalesman | null;
  assigned_to_id?: number | null;
  assigned_to_name?: string;
  title?: string;
  description?: string;
  due_date?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
  status?: TaskStatus;
  messages?: RawTaskMessage[];
};

type RawClient = {
  id?: number | null;
  name?: string | null;
  city?: string | null;
};

type RawSalesman = {
  id?: number | null;
  username?: string | null;
  first_name?: string | null;
  firstName?: string | null;
  last_name?: string | null;
  lastName?: string | null;
};

const extractResultsArray = <T,>(payload: unknown): T[] => {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (payload && typeof payload === "object" && "results" in payload) {
    const results = (payload as PaginatedResponse<T>).results;
    if (Array.isArray(results)) {
      return results;
    }
  }
  return [];
};

const normalizeRoutePlans = (payload: unknown): RoutePlanRecord[] => {
  const items = extractResultsArray<RawRoutePlan>(payload);
  return items.map((plan, outerIndex) => ({
    id: plan.id ?? outerIndex + 1,
    date: plan.date ?? new Date().toISOString().slice(0, 10),
    ownerId: plan.owner ?? plan.owner_id ?? plan.ownerId ?? null,
    ownerName: plan.owner_name ?? plan.ownerName ?? "Handlowiec",
    totalDriveMinutes: plan.total_drive_minutes ?? 0,
    totalVisitMinutes: plan.total_visit_minutes ?? 0,
    stops: (plan.stops ?? []).map((stop, index) => ({
      id: stop.id ?? `${plan.id ?? "plan"}-${index}`,
      clientId: stop.client ?? stop.client_id ?? null,
      clientName: stop.client_name ?? stop.clientName ?? "Klient",
      city: stop.client_city ?? "",
      street: stop.client_street ?? "",
      postalCode: stop.client_postal_code ?? "",
      comment: stop.comment ?? "",
      order: stop.order ?? index + 1,
    })),
  }));
};

const normalizeVisits = (payload: unknown): VisitRecord[] => {
  const items = extractResultsArray<RawVisit>(payload);
  return items.map((visit) => {
    const clientObject: RawClient | null =
      visit && typeof visit.client === "object" && visit.client ? (visit.client as RawClient) : null;
    const salesmanObject: RawSalesman | null =
      visit && typeof visit.salesman === "object" && visit.salesman ? (visit.salesman as RawSalesman) : null;
    const clientId = clientObject?.id ?? (typeof visit.client === "number" ? visit.client : visit.client_id ?? null);
    const salesmanId =
      salesmanObject?.id ?? (typeof visit.salesman === "number" ? visit.salesman : visit.salesman_id ?? null);
    const salesmanName =
      [salesmanObject?.first_name ?? salesmanObject?.firstName, salesmanObject?.last_name ?? salesmanObject?.lastName]
        .filter(Boolean)
        .join(" ") ||
      salesmanObject?.username ||
      visit.salesman_name ||
      (salesmanId ? `Handlowiec #${salesmanId}` : "Handlowiec");
    const clientName = clientObject?.name || visit.client_name || (clientId ? `Klient #${clientId}` : "Klient");
    const commentText = typeof visit.comment === "string" ? visit.comment : "";
    const plannedAt = typeof visit.planned_at === "string" ? visit.planned_at : String(visit.planned_at ?? "");
    return {
      id: visit.id,
      clientId,
      clientName,
      salesmanId,
      salesmanName,
      plannedAt,
      plannedDate: plannedAt ? plannedAt.slice(0, 10) : "",
      comment: commentText,
      status: visit.status ?? "planned",
      locationName: visit.location_name ?? "",
    };
  });
};

const normalizeCallRecords = (payload: unknown): ContactRecord[] => {
  const items = extractResultsArray<RawCallRecord>(payload);
  return items
    .map((record) => {
      const clientObject: RawClient | null =
        record && typeof record.client === "object" && record.client ? (record.client as RawClient) : null;
      const handlerObject: RawSalesman | null =
        record && typeof record.handler === "object" && record.handler ? (record.handler as RawSalesman) : null;
      const clientId = clientObject?.id ?? (typeof record.client === "number" ? record.client : record.client_id ?? null);
      const handlerId =
        handlerObject?.id ?? (typeof record.handler === "number" ? record.handler : record.handler_id ?? null);
      const handlerName =
        [handlerObject?.first_name ?? handlerObject?.firstName, handlerObject?.last_name ?? handlerObject?.lastName]
          .filter(Boolean)
          .join(" ") ||
        handlerObject?.username ||
        record.handler_name ||
        (handlerId ? `Handlowiec #${handlerId}` : "Handlowiec");
      const clientName = clientObject?.name || record.client_name || (clientId ? `Klient #${clientId}` : "Klient");
      const clientCity = clientObject?.city ?? null;
      const contactDate = typeof record.contact_date === "string" ? record.contact_date : "";
      return {
        id: record.id,
        clientId,
        clientName,
        clientCity,
        handlerId,
        handlerName,
        contactDate,
        nextContactAt: record.next_contact_at ?? null,
        outcome: record.outcome ?? "",
        comment: record.current_comment ?? "",
      } satisfies ContactRecord;
    })
    .filter((record) => Boolean(record.contactDate));
};

const normalizeTasks = (payload: unknown): TaskRecord[] => {
  const items = extractResultsArray<RawTask>(payload);
  return items.map((task) => {
    const clientObject: RawClient | null = task && typeof task.client === "object" ? (task.client as RawClient) : null;
    const assignedObject: RawSalesman | null =
      task && typeof task.assigned_to === "object" ? (task.assigned_to as RawSalesman) : null;
    const clientId = clientObject?.id ?? (typeof task.client === "number" ? task.client : task.client_id ?? null);
    const assignedToId =
      assignedObject?.id ?? (typeof task.assigned_to === "number" ? task.assigned_to : task.assigned_to_id ?? null);
    const assignedToName =
      [assignedObject?.first_name ?? assignedObject?.firstName, assignedObject?.last_name ?? assignedObject?.lastName]
        .filter(Boolean)
        .join(" ") ||
      assignedObject?.username ||
      task.assigned_to_name ||
      (assignedToId ? `Handlowiec #${assignedToId}` : "Handlowiec");
    const clientName = clientObject?.name || task.client_name || (clientId ? `Klient #${clientId}` : "Klient");
    const messages: TaskMessage[] = Array.isArray(task.messages)
      ? task.messages.map((message, index) => ({
          id: message.id ?? index,
          authorName: message.author_name ?? message.authorName ?? null,
          authorRole: message.author_role ?? message.authorRole ?? null,
          body: message.body ?? "",
          createdAt: message.created_at ?? message.createdAt ?? new Date().toISOString(),
        }))
      : [];

    return {
      id: task.id,
      clientId,
      clientName,
      clientCity: task.client_city ?? null,
      assignedToId,
      assignedToName,
      title: task.title ?? "Zadanie",
      description: task.description ?? "",
      dueDate: task.due_date ?? null,
      createdAt: task.created_at ?? null,
      completedAt: task.completed_at ?? null,
      status: task.status ?? "pending",
      messages,
    } satisfies TaskRecord;
  });
};

const RETURN_TO_START_FLAG = "__returnToStart";
const LEGACY_RETURN_TO_START_FLAG = "__RETURN_TO_START__";
const COMMENTS_FLAG = "__stopComments";

const parseReturnToStartMeta = (comment: string | null | undefined): ReturnToStartMeta | null => {
  if (!comment || (!comment.includes(RETURN_TO_START_FLAG) && !comment.includes(LEGACY_RETURN_TO_START_FLAG))) {
    return null;
  }
  try {
    const parsed = JSON.parse(comment);
    if (parsed && (parsed.__returnToStart || parsed[RETURN_TO_START_FLAG])) {
      return parsed;
    }
  } catch (_error) {
    // ignore malformed meta
  }
  return null;
};

const summarizeLocation = (stop: RouteStopRecord) => {
  const returnMeta = parseReturnToStartMeta(stop.comment);
  const address = [stop.street, stop.postalCode, stop.city].filter(Boolean).join(", ");
  if (address) {
    return address;
  }
  if (returnMeta?.__returnToStart) {
    return returnMeta.address || "Powrót do punktu startowego";
  }
  return "Brak adresu";
};

const parseStopCommentEntries = (comment: string | null | undefined): StopCommentEntry[] => {
  if (!comment) {
    return [];
  }
  try {
    const parsed = JSON.parse(comment);
    const hasFlag = parsed && (parsed[COMMENTS_FLAG] || parsed.__stopComments);
    if (hasFlag && Array.isArray(parsed.items)) {
      return parsed.items
        .map((item: Partial<StopCommentEntry>) => ({
          id: typeof item.id === "string" && item.id ? item.id : crypto.randomUUID(),
          authorName:
            typeof item.authorName === "string" && item.authorName ? item.authorName : "Użytkownik",
          authorRole: typeof item.authorRole === "string" ? item.authorRole : null,
          body: typeof item.body === "string" ? item.body : "",
          createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
        }))
        .filter((entry: StopCommentEntry) => entry.body.trim().length > 0);
    }
  } catch (_error) {
    // fallback to legacy plain string below
  }
  return [];
};

export default function VisitsPage() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);
  const clearAuth = useAuthStore((state) => state.clear);

  const [filters, setFilters] = useState<Filters>(() => defaultFilters());
  const [salesmen, setSalesmen] = useState<SalesRepOption[]>([]);
  const [routePlans, setRoutePlans] = useState<RoutePlanRecord[]>([]);
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [contactRecords, setContactRecords] = useState<ContactRecord[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [clientsLookup, setClientsLookup] = useState<Record<string, { name: string; city?: string | null }>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [userError, setUserError] = useState<string | null>(null);
  const [_userLoading, setUserLoading] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [expandedTaskDays, setExpandedTaskDays] = useState<Record<string, boolean>>({});

  const salesmanLabels = useMemo(() => {
    const map = new Map<number, string>();
    salesmen.forEach((rep) => map.set(rep.id, formatSalesRepName(rep)));
    return map;
  }, [salesmen]);

  const isSalesRep = currentUser?.role === "rep";

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (!token) {
      router.replace("/auth/login");
    }
  }, [token, hydrated, router]);

  const handleLogout = useCallback(() => {
    clearAuth();
    router.replace("/auth/login");
  }, [clearAuth, router]);

  useEffect(() => {
    if (!hydrated || !token) {
      return;
    }
    const controller = new AbortController();
    setUserLoading(true);
    setUserError(null);

    const loadCurrentUser = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/accounts/users/me/`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.detail ?? "Nie udało się pobrać danych użytkownika.");
        }
        const payload: CurrentUser = await response.json();
        if (!controller.signal.aborted) {
          setCurrentUser(payload);
        }
      } catch (_fetchError) {
        if (controller.signal.aborted) {
          return;
        }
        setUserError(
          _fetchError instanceof Error ? _fetchError.message : "Nieznany błąd pobierania użytkownika.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setUserLoading(false);
        }
      }
    };

    loadCurrentUser();

    return () => controller.abort();
  }, [hydrated, token]);

  useEffect(() => {
    if (!isSalesRep || !currentUser) {
      return;
    }
    setFilters((prev) => {
      const repId = String(currentUser.id);
      if (prev.salesman === repId) {
        return prev;
      }
      return { ...prev, salesman: repId };
    });
  }, [isSalesRep, currentUser]);

  useEffect(() => {
    if (!token || !isSalesRep || !currentUser) {
      return;
    }
    const repId = String(currentUser.id);
    if (filters.salesman !== repId) {
      setFilters((prev) => ({ ...prev, salesman: repId }));
    }
  }, [token, isSalesRep, currentUser, filters.salesman]);

  useEffect(() => {
    if (!hydrated || !token) {
      return;
    }
    fetch(`${API_BASE_URL}/api/accounts/sales-reps/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (response.status === 401) {
          handleLogout();
          return [];
        }
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
        setSalesmen(reps);
      })
      .catch((err) => {
        console.error(err);
        setSalesmen([]);
      });
  }, [token, hydrated, handleLogout]);

  const fetchHistory = useCallback(async () => {
    if (!token) {
      return;
    }
    if (isSalesRep) {
      const repId = currentUser?.id ? String(currentUser.id) : null;
      if (!repId || filters.salesman !== repId) {
        return;
      }
    }
    setIsLoading(true);
    setError(null);
    try {
      const authHeaders = { Authorization: `Bearer ${token}` };
      const routeParams = new URLSearchParams();
      if (filters.salesman) {
        routeParams.set("owner", filters.salesman);
      }
      if (filters.dateFrom) {
        routeParams.set("date_from", filters.dateFrom);
      }
      if (filters.dateTo) {
        routeParams.set("date_to", filters.dateTo);
      }
      routeParams.set("limit", "200");

      const visitsParams = new URLSearchParams({ ordering: "-planned_at", limit: "500" });

      const [routesRes, visitsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/routes/?${routeParams.toString()}`, { headers: authHeaders }),
        fetch(`${API_BASE_URL}/api/visits/?${visitsParams.toString()}`, { headers: authHeaders }),
      ]);

      if (routesRes.status === 401 || visitsRes.status === 401) {
        handleLogout();
        return;
      }
      if (!routesRes.ok) {
        throw new Error("Nie udało się pobrać zaplanowanych tras.");
      }
      if (!visitsRes.ok) {
        throw new Error("Nie udało się pobrać historii wizyt.");
      }

      const routesPayload = await routesRes.json();
      const visitsPayload = await visitsRes.json();

      const normalizedRoutes = normalizeRoutePlans(routesPayload).sort((a, b) => b.date.localeCompare(a.date));

      const normalizedVisits = normalizeVisits(visitsPayload).filter((visit) => {
        if (!visit.plannedDate) {
          return false;
        }
        if (filters.dateFrom && visit.plannedDate < filters.dateFrom) {
          return false;
        }
        if (filters.dateTo && visit.plannedDate > filters.dateTo) {
          return false;
        }
        if (filters.salesman && String(visit.salesmanId ?? "") !== filters.salesman) {
          return false;
        }
        return true;
      });

      setRoutePlans(normalizedRoutes);
      setVisits(normalizedVisits);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wystąpił nieznany błąd.");
    } finally {
      setIsLoading(false);
    }
  }, [token, filters, handleLogout, isSalesRep, currentUser]);

  const toggleTaskDetails = useCallback((date: string) => {
    setExpandedTaskDays((prev) => ({
      ...prev,
      [date]: !prev[date],
    }));
  }, []);

  const fetchContacts = useCallback(async () => {
    if (!token) {
      return;
    }
    setContactsLoading(true);
    setContactsError(null);
    try {
      const authHeaders = { Authorization: `Bearer ${token}` };
      const params = new URLSearchParams({ ordering: "-contact_date", limit: "500" });
      const response = await fetch(`${API_BASE_URL}/api/call-records/?${params.toString()}`, { headers: authHeaders });
      if (response.status === 401) {
        handleLogout();
        return;
      }
      if (!response.ok) {
        throw new Error("Nie udało się pobrać rejestru kontaktów.");
      }
      const payload = await response.json();
      const normalized = normalizeCallRecords(payload);
      setContactRecords(normalized);
    } catch (err) {
      setContactsError(err instanceof Error ? err.message : "Wystąpił błąd podczas ładowania kontaktów.");
    } finally {
      setContactsLoading(false);
    }
  }, [token, handleLogout]);

  const fetchClientsLookup = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const authHeaders = { Authorization: `Bearer ${token}` };
      const response = await fetch(`${API_BASE_URL}/api/clients/?limit=500`, { headers: authHeaders });
      if (response.status === 401) {
        handleLogout();
        return;
      }
      if (!response.ok) {
        throw new Error("Nie udało się pobrać listy klientów.");
      }
      const payload = await response.json();
      const entries = extractResultsArray<any>(payload);
      const map: Record<string, { name: string; city?: string | null }> = {};
      entries.forEach((client) => {
        if (!client?.id) {
          return;
        }
        map[String(client.id)] = {
          name: client.name ?? `Klient #${client.id}`,
          city: client.city ?? null,
        };
      });
      setClientsLookup(map);
    } catch (err) {
      console.error(err);
    }
  }, [token, handleLogout]);

  const fetchTasksData = useCallback(async () => {
    if (!token) {
      return;
    }
    setTasksLoading(true);
    setTasksError(null);
    try {
      const authHeaders = { Authorization: `Bearer ${token}` };
      const params = new URLSearchParams({ ordering: "-due_date", limit: "500" });
      const response = await fetch(`${API_BASE_URL}/api/tasks/${params.toString() ? `?${params.toString()}` : ""}`, {
        headers: authHeaders,
      });
      if (response.status === 401) {
        handleLogout();
        return;
      }
      if (!response.ok) {
        throw new Error("Nie udało się pobrać listy zadań.");
      }
      const payload = await response.json();
      const normalized = normalizeTasks(payload);
      setTasks(normalized);
    } catch (err) {
      setTasksError(err instanceof Error ? err.message : "Wystąpił błąd podczas ładowania zadań.");
    } finally {
      setTasksLoading(false);
    }
  }, [token, handleLogout]);

  useEffect(() => {
    if (!hydrated || !token) {
      return;
    }
    fetchHistory().catch(() => undefined);
    fetchContacts().catch(() => undefined);
    fetchTasksData().catch(() => undefined);
    fetchClientsLookup().catch(() => undefined);
  }, [hydrated, token, fetchHistory, fetchContacts, fetchTasksData, fetchClientsLookup]);

  const cards = useMemo<RouteCard[]>(() => {
    const bucket = new Map<string, VisitRecord[]>();
    visits.forEach((visit) => {
      if (!visit.clientId || !visit.plannedDate) {
        return;
      }
      const key = `${visit.clientId}|${visit.plannedDate}`;
      const list = bucket.get(key) ?? [];
      list.push(visit);
      bucket.set(key, list);
    });
    bucket.forEach((list) => list.sort((a, b) => a.plannedAt.localeCompare(b.plannedAt)));

    const consumeVisit = (clientId: number | null, date: string, ownerId: number | null) => {
      if (!clientId) {
        return undefined;
      }
      const key = `${clientId}|${date}`;
      const list = bucket.get(key);
      if (!list || list.length === 0) {
        return undefined;
      }
      let index = list.findIndex((item) => item.salesmanId === ownerId);
      if (index === -1) {
        index = 0;
      }
      const [match] = list.splice(index, 1);
      if (list.length === 0) {
        bucket.delete(key);
      }
      return match;
    };

    return routePlans.map((plan) => {
      const stopsSorted = [...plan.stops].sort((a, b) => a.order - b.order);
      const stops = stopsSorted.map<StopHistoryEntry>((stop) => ({
        stop,
        visit: consumeVisit(stop.clientId, plan.date, plan.ownerId ?? null),
      }));
      const confirmedCount = stops.filter((entry) => entry.visit).length;
      const pendingCount = stops.length - confirmedCount;
      return { plan, stops, confirmedCount, pendingCount };
    });

  }, [routePlans, visits]);

  const filteredCards = useMemo<RouteCard[]>(() => {
    return cards
      .map((card) => {
        let visibleStops = card.stops;
        if (selectedClientId) {
          visibleStops = visibleStops.filter((entry) => String(entry.stop.clientId ?? "") === selectedClientId);
        }
        return { ...card, stops: visibleStops };
      })
      .filter((card) => card.stops.length > 0);
  }, [cards, selectedClientId]);

  const latestDataDate = useMemo(() => {
    const candidates: string[] = [];
    routePlans.forEach((plan) => {
      if (plan.date) {
        candidates.push(plan.date.slice(0, 10));
      }
    });
    contactRecords.forEach((record) => {
      if (record.contactDate) {
        candidates.push(record.contactDate.slice(0, 10));
      }
    });
    tasks.forEach((task) => {
      const reference = task.dueDate ?? task.createdAt ?? null;
      if (reference) {
        candidates.push(reference.slice(0, 10));
      }
    });
    if (!candidates.length) {
      return null;
    }
    return candidates.sort((a, b) => b.localeCompare(a))[0];
  }, [routePlans, contactRecords, tasks]);

  const earliestDataDate = useMemo(() => {
    const candidates: string[] = [];
    routePlans.forEach((plan) => {
      if (plan.date) {
        candidates.push(plan.date.slice(0, 10));
      }
    });
    contactRecords.forEach((record) => {
      if (record.contactDate) {
        candidates.push(record.contactDate.slice(0, 10));
      }
    });
    tasks.forEach((task) => {
      const reference = task.createdAt ?? task.dueDate ?? null;
      if (reference) {
        candidates.push(reference.slice(0, 10));
      }
    });
    if (!candidates.length) {
      return null;
    }
    return candidates.sort((a, b) => a.localeCompare(b))[0];
  }, [routePlans, contactRecords, tasks]);

  const contactGroups = useMemo(() => {
    const selectedSalesmanId = filters.salesman ? Number(filters.salesman) : null;
    const selectedSalesmanName = selectedSalesmanId ? salesmanLabels.get(selectedSalesmanId) : null;
    const matches = contactRecords.filter((record) => {
      if (!record.contactDate) {
        return false;
      }
      if (filters.dateFrom && record.contactDate < filters.dateFrom) {
        return false;
      }
      if (filters.dateTo && record.contactDate > filters.dateTo) {
        return false;
      }
      if (filters.salesman) {
        const handlerMatchesId = record.handlerId && String(record.handlerId) === filters.salesman;
        const handlerMatchesName = selectedSalesmanName
          ? (record.handlerName ?? "").trim() === selectedSalesmanName.trim()
          : false;
        if (!handlerMatchesId && !handlerMatchesName) {
          return false;
        }
      }
      if (selectedClientId && String(record.clientId ?? "") !== selectedClientId) {
        return false;
      }
      return true;
    });
    const bucket = new Map<string, ContactRecord[]>();
    matches.forEach((record) => {
      const resolved = record.clientId ? clientsLookup[String(record.clientId)] : undefined;
      const handlerResolved = record.handlerId ? salesmanLabels.get(record.handlerId) : undefined;
      const enriched: ContactRecord = {
        ...record,
        clientName: resolved?.name ?? record.clientName,
        clientCity: resolved?.city ?? record.clientCity ?? null,
        handlerName: handlerResolved ?? record.handlerName,
      };
      const list = bucket.get(record.contactDate) ?? [];
      list.push(enriched);
      bucket.set(record.contactDate, list);
    });
    return Array.from(bucket.entries()).map(([date, records]) => ({
      date,
      records: records.sort((a, b) => a.clientName.localeCompare(b.clientName)),
    }));
  }, [
    contactRecords,
    filters.dateFrom,
    filters.dateTo,
    filters.salesman,
    selectedClientId,
    clientsLookup,
    salesmanLabels,
  ]);

  const { taskGroups, undatedTasks } = useMemo(() => {
    const matches = tasks.filter((task) => {
      if (filters.salesman && String(task.assignedToId ?? "") !== filters.salesman) {
        return false;
      }
      if (selectedClientId && String(task.clientId ?? "") !== selectedClientId) {
        return false;
      }
      const referenceDateRaw = task.dueDate ?? task.createdAt ?? null;
      const referenceDay = referenceDateRaw ? referenceDateRaw.slice(0, 10) : null;
      if (!referenceDay) {
        return true;
      }
      if (filters.dateFrom && referenceDay < filters.dateFrom) {
        return false;
      }
      if (filters.dateTo && referenceDay > filters.dateTo) {
        return false;
      }
      return true;
    });
    const bucket = new Map<string, TaskRecord[]>();
    const undated: TaskRecord[] = [];
    matches.forEach((task) => {
      const referenceDateRaw = task.dueDate ?? task.createdAt ?? null;
      const referenceDay = referenceDateRaw ? referenceDateRaw.slice(0, 10) : null;
      if (!referenceDay) {
        undated.push(task);
        return;
      }
      const list = bucket.get(referenceDay) ?? [];
      list.push(task);
      bucket.set(referenceDay, list);
    });
    const grouped = Array.from(bucket.entries())
      .map(([date, records]) => ({
        date,
        records: records.sort((a, b) => a.title.localeCompare(b.title)),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
    const undatedSorted = undated.sort((a, b) => a.title.localeCompare(b.title));
    return { taskGroups: grouped, undatedTasks: undatedSorted };
  }, [tasks, filters.salesman, filters.dateFrom, filters.dateTo, selectedClientId]);

  type TimelineDay = {
    date: string;
    routes: RouteCard[];
    contacts: ContactRecord[];
    tasks: TaskRecord[];
  };

  const timelineDays = useMemo<TimelineDay[]>(() => {
    const map = new Map<string, Omit<TimelineDay, "date">>();
    const ensure = (date: string) => {
      if (!map.has(date)) {
        map.set(date, { routes: [], contacts: [], tasks: [] });
      }
      return map.get(date)!;
    };

    filteredCards.forEach((card) => {
      const bucket = ensure(card.plan.date);
      bucket.routes.push(card);
    });

    contactGroups.forEach((group) => {
      const bucket = ensure(group.date);
      bucket.contacts.push(...group.records);
    });

    taskGroups.forEach((group) => {
      const bucket = ensure(group.date);
      bucket.tasks.push(...group.records);
    });

    return Array.from(map.entries())
      .map(([date, data]) => ({ date, routes: data.routes, contacts: data.contacts, tasks: data.tasks }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [filteredCards, contactGroups, taskGroups]);

  useEffect(() => {
    if (!latestDataDate && !earliestDataDate) {
      return;
    }
    setFilters((prev) => {
      let nextFrom = prev.dateFrom;
      let nextTo = prev.dateTo;
      if (earliestDataDate && (!nextFrom || earliestDataDate < nextFrom)) {
        nextFrom = earliestDataDate;
      }
      if (latestDataDate && (!nextTo || latestDataDate > nextTo)) {
        nextTo = latestDataDate;
      }
      if (nextFrom === prev.dateFrom && nextTo === prev.dateTo) {
        return prev;
      }
      return { ...prev, dateFrom: nextFrom, dateTo: nextTo };
    });
  }, [latestDataDate, earliestDataDate]);

  useEffect(() => {
    if (timelineDays.length === 0) {
      return;
    }
    setExpandedTaskDays((prev) => {
      const next = { ...prev };
      let changed = false;
      timelineDays.forEach((day) => {
        if (day.tasks.length > 0 && !next[day.date]) {
          next[day.date] = true;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [timelineDays]);

  const clientOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; city?: string | null }>();
    routePlans.forEach((plan) => {
      plan.stops.forEach((stop) => {
        if (!stop.clientId) {
          return;
        }
        const key = String(stop.clientId);
        if (!map.has(key)) {
          map.set(key, { id: key, name: stop.clientName, city: stop.city });
        }
      });
    });
    Object.entries(clientsLookup).forEach(([id, entry]) => {
      if (!map.has(id)) {
        map.set(id, { id, name: entry.name, city: entry.city ?? undefined });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [routePlans, clientsLookup]);

  if (!token) {
    return null;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <nav className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/manager/routes"
            className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-blue-500 hover:text-blue-600"
          >
            ← Powrót do planera tras
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-blue-500 hover:text-blue-600"
          >
            ← Wróć do dashboardu
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-blue-500 hover:text-blue-600"
          >
            Wyloguj się
          </button>
        </nav>

        <header className="glass-card p-6">
          <p className="text-xs uppercase tracking-[0.35em] text-blue-500">Historia działań</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Trasy, kontakty i zadania w jednym miejscu</h1>
          <p className="text-sm text-slate-600">
            Ten widok pokazuje dzienną chronologię pracy terenowej – planowane trasy, zrealizowane kontakty oraz zadania zespołu. Dzięki
            temu możesz błyskawicznie ocenić obłożenie handlowców, postęp prac i bieżące priorytety u każdego klienta.
          </p>
        </header>

        <section className="glass-card space-y-4 p-5">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
              Od
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, dateFrom: event.target.value || prev.dateFrom }))
                }
                className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 shadow-inner focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
              Do
              <input
                type="date"
                value={filters.dateTo}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, dateTo: event.target.value || prev.dateTo }))
                }
                className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 shadow-inner focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
              Handlowiec
              <select
                value={isSalesRep ? String(currentUser?.id ?? "") : filters.salesman}
                onChange={(event) => {
                  if (isSalesRep) {
                    return;
                  }
                  setFilters((prev) => ({ ...prev, salesman: event.target.value }));
                }}
                disabled={isSalesRep}
                className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 shadow-inner focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100"
              >
                {isSalesRep ? (
                  <option value={currentUser?.id ?? ""}>{currentUser?.username ?? "Twoje konto"}</option>
                ) : (
                  <>
                    <option value="">Wszyscy</option>
                    {salesmen.map((rep) => (
                      <option key={rep.id} value={rep.id}>
                        {formatSalesRepName(rep)}
                      </option>
                    ))}
                  </>
                )}
              </select>
              {isSalesRep && (
                <span className="text-[11px] text-slate-500">Wyświetlam tylko wizyty przypisane do Twojego konta.</span>
              )}
              {userError && (
                <span className="text-[11px] text-red-600">{userError}</span>
              )}
            </label>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Klient</label>
            <div className="rounded-2xl border border-slate-200 p-3">
              <input
                type="text"
                value={clientSearch}
                onChange={(event) => {
                  setClientSearch(event.target.value);
                }}
                placeholder="Wpisz nazwę lub miasto klienta"
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none"
              />
              {clientSearch.trim() && (
                <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-2xl border border-slate-100 bg-slate-50/80 p-2 text-sm shadow-inner">
                  {clientOptions
                    .filter((client) => {
                      const query = clientSearch.toLowerCase();
                      return (
                        client.name.toLowerCase().includes(query) ||
                        (client.city ? client.city.toLowerCase().includes(query) : false)
                      );
                    })
                    .slice(0, 10)
                    .map((client) => (
                      <button
                        key={client.id}
                        type="button"
                        onClick={() => {
                          setSelectedClientId(client.id);
                          setClientSearch(client.name);
                        }}
                        className={`flex w-full flex-col rounded-xl px-3 py-2 text-left transition hover:bg-white ${selectedClientId === client.id ? "bg-white" : ""}`}
                      >
                        <span className="font-semibold text-slate-900">{client.name}</span>
                        <span className="text-xs text-slate-500">{client.city || "Brak miasta"}</span>
                      </button>
                    ))}
                  {!clientOptions.some((client) => {
                    const query = clientSearch.toLowerCase();
                    return (
                      client.name.toLowerCase().includes(query) ||
                      (client.city ? client.city.toLowerCase().includes(query) : false)
                    );
                  }) && (
                    <p className="px-2 py-1 text-xs text-slate-500">Brak klientów pasujących do wyszukiwania.</p>
                  )}
                </div>
              )}
              {selectedClientId && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>Wybrano klienta: {clientOptions.find((client) => client.id === selectedClientId)?.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedClientId("");
                      setClientSearch("");
                    }}
                    className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:border-blue-400"
                  >
                    Wyczyść filtr
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setFilters(defaultFilters())}
              className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-blue-400"
            >
              Resetuj zakres
            </button>
            <button
              type="button"
              onClick={() => Promise.all([fetchHistory(), fetchContacts(), fetchTasksData()]).catch(() => undefined)}
              disabled={isLoading || contactsLoading || tasksLoading}
              className="rounded-2xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {isLoading || contactsLoading || tasksLoading ? "Odświeżanie…" : "Odśwież dane"}
            </button>
            {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
            {contactsError && <p className="text-sm font-semibold text-red-600">{contactsError}</p>}
            {tasksError && <p className="text-sm font-semibold text-red-600">{tasksError}</p>}
          </div>
        </section>

        <section className="space-y-4">
          {(isLoading || contactsLoading || tasksLoading) && (
            <div className="rounded-3xl border border-blue-100 bg-blue-50/60 p-4 text-sm text-blue-700">
              Odświeżam dane osi czasu…
            </div>
          )}

          {!isLoading && !contactsLoading && !tasksLoading && timelineDays.length === 0 && (
            <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
              Brak aktywności w wybranym zakresie dat.
            </div>
          )}

          {timelineDays.map((day) => (
            <article key={day.date} className="space-y-4 rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Dzień</p>
                  <h2 className="text-xl font-semibold text-slate-900">{formatDateLabel(day.date)}</h2>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                  <span className="rounded-full bg-slate-100 px-3 py-1">Trasy: {day.routes.length}</span>
                  <span className="rounded-full bg-slate-100 px-3 py-1">Kontakty: {day.contacts.length}</span>
                  <span className="rounded-full bg-slate-100 px-3 py-1">Zadania: {day.tasks.length}</span>
                </div>
                {day.tasks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleTaskDetails(day.date)}
                    className="rounded-full border border-blue-200 px-3 py-1 text-xs font-semibold text-blue-600 transition hover:border-blue-400"
                  >
                    {expandedTaskDays[day.date] ? "Ukryj szczegóły zadań" : "Pokaż szczegóły zadań"}
                  </button>
                )}
              </header>

              <div className="space-y-4">
                {day.tasks.length > 0 && expandedTaskDays[day.date] && (
                  <div className="space-y-2 rounded-2xl border border-slate-100 bg-blue-50/30 p-4">
                    <p className="text-xs uppercase tracking-[0.35em] text-blue-600">Zadania dnia</p>
                    <div className="divide-y divide-slate-100 rounded-xl border border-slate-100 bg-white/80">
                      {day.tasks.map((task) => {
                        const history = [...(task.messages ?? [])]
                          .filter((message) => Boolean(message.body?.trim()))
                          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
                        const lastMessages = history.slice(-3).reverse();
                        return (
                          <div key={`expanded-${task.id}`} className="space-y-3 border-b border-slate-100 p-4 last:border-b-0">
                            <div className="grid gap-4 md:grid-cols-3">
                              <div className="space-y-1">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-400">Tytuł</p>
                                <p className="text-sm font-semibold text-slate-900">{task.title}</p>
                                <p className="text-xs text-slate-500">Klient: {task.clientName}</p>
                                {task.description && <p className="text-xs text-slate-500 line-clamp-3">{task.description}</p>}
                              </div>
                              <div className="space-y-1 text-sm text-slate-700">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-400">Opiekun i termin</p>
                                <p>{task.assignedToName}</p>
                                {task.clientCity && <p className="text-xs text-slate-500">{task.clientCity}</p>}
                                {task.dueDate ? (
                                  <p className="text-xs text-slate-500">
                                    Termin: {new Date(task.dueDate).toLocaleDateString("pl-PL")}
                                  </p>
                                ) : (
                                  <p className="text-xs text-slate-500">Brak terminu</p>
                                )}
                              </div>
                              <div className="space-y-1 text-xs text-slate-500 md:text-right">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-400">Status i daty</p>
                                <span className={`inline-flex justify-end rounded-full border px-3 py-1 text-xs font-semibold ${TASK_STATUS_TONES[task.status]}`}>
                                  {TASK_STATUS_LABELS[task.status]}
                                </span>
                                <p>
                                  {task.createdAt
                                    ? `Utworzone: ${new Date(task.createdAt).toLocaleDateString("pl-PL")}`
                                    : "Brak daty utworzenia"}
                                </p>
                                <p>
                                  {task.completedAt
                                    ? `Wykonano: ${new Date(task.completedAt).toLocaleDateString("pl-PL")}`
                                    : "Nie zakończono"}
                                </p>
                              </div>
                            </div>
                            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 px-3 py-2">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">
                                Historia komentarzy
                              </p>
                              {lastMessages.length === 0 ? (
                                <p className="text-xs text-slate-500">Brak komentarzy do tego zadania.</p>
                              ) : (
                                <ul className="mt-2 space-y-2">
                                  {lastMessages.map((message) => {
                                    const styles = getNoteStyles(message.authorRole);
                                    return (
                                      <li key={message.id} className={`rounded-xl px-3 py-2 text-xs ${styles.container}`}>
                                        <div className="flex items-center justify-between gap-2">
                                          <span className={`font-semibold ${styles.heading}`}>
                                            {message.authorName ?? "Użytkownik"}
                                          </span>
                                          <span className={`text-[11px] ${styles.meta}`}>
                                            {new Date(message.createdAt).toLocaleString("pl-PL", {
                                              day: "2-digit",
                                              month: "2-digit",
                                              hour: "2-digit",
                                              minute: "2-digit",
                                            })}
                                          </span>
                                        </div>
                                        <p className={`mt-1 ${styles.body}`}>{message.body}</p>
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {day.routes.map((card: RouteCard) => (
                  <div key={card.plan.id} className="space-y-3 rounded-2xl border border-slate-100 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Trasa</p>
                        <p className="text-sm font-semibold text-slate-900">
                          {card.plan.ownerName} • {card.plan.stops.length} punktów • {" "}
                          {formatMinutes(card.plan.totalDriveMinutes + card.plan.totalVisitMinutes)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                          Potwierdzone: {card.confirmedCount}
                        </span>
                        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                          Oczekujące: {card.pendingCount}
                        </span>
                        <Link
                          href={`/manager/routes?owner=${card.plan.ownerId ?? ""}&date=${card.plan.date}`}
                          className="rounded-2xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-blue-400"
                        >
                          Otwórz trasę
                        </Link>
                      </div>
                    </div>
                    <div className="divide-y divide-slate-100 rounded-2xl border border-slate-100">
                      {card.stops.map((entry: StopHistoryEntry, index: number) => {
                        const visit = entry.visit;
                        const statusLabel = visit ? "Potwierdzono" : "Brak potwierdzenia";
                        const statusColor = visit ? "text-emerald-700 bg-emerald-50" : "text-amber-700 bg-amber-50";
                        return (
                          <div key={`${entry.stop.id}-${index}`} className="grid gap-3 p-4 md:grid-cols-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                {entry.stop.order}. {entry.stop.clientName}
                              </p>
                              <p className="text-xs text-slate-500">{summarizeLocation(entry.stop)}</p>
                              {entry.stop.comment && !parseReturnToStartMeta(entry.stop.comment) && (
                                <div className="mt-2 space-y-1">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-400">
                                    Notatki planu
                                  </p>
                                  {parseStopCommentEntries(entry.stop.comment).length > 0 ? (
                                    <ul className="space-y-1">
                                      {parseStopCommentEntries(entry.stop.comment).map((note) => {
                                        const styles = getNoteStyles(note.authorRole);
                                        return (
                                          <li key={note.id} className={`rounded-xl px-3 py-2 text-xs ${styles.container}`}>
                                            <p className={`font-semibold ${styles.heading}`}>{note.authorName}</p>
                                            <p className={`text-[11px] ${styles.meta}`}>
                                              {new Date(note.createdAt).toLocaleString("pl-PL", {
                                                day: "2-digit",
                                                month: "2-digit",
                                                hour: "2-digit",
                                                minute: "2-digit",
                                              })}
                                            </p>
                                            <p className={`mt-1 ${styles.body}`}>{note.body}</p>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  ) : (
                                    <p className="whitespace-pre-line text-xs text-slate-500">{entry.stop.comment}</p>
                                  )}
                                </div>
                              )}
                            </div>
                            <div>
                              {visit ? (
                                <div className="space-y-1 text-sm text-slate-700">
                                  <p>
                                    Potwierdzono: {new Date(visit.plannedAt).toLocaleString("pl-PL", {
                                      day: "2-digit",
                                      month: "2-digit",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </p>
                                  {visit.locationName && <p className="text-xs text-slate-500">📍 {visit.locationName}</p>}
                                  {visit.comment && (
                                    <p className="text-xs text-slate-500">Komentarz: {visit.comment}</p>
                                  )}
                                </div>
                              ) : (
                                <p className="text-sm text-slate-500">Brak potwierdzenia wizyty w tym punkcie.</p>
                              )}
                            </div>
                            <div className="flex flex-col items-start gap-2 md:items-end">
                              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusColor}`}>
                                {statusLabel}
                              </span>
                              {visit && (
                                <span className="text-xs text-slate-500">
                                  {visit.salesmanId ? salesmanLabels.get(visit.salesmanId) ?? visit.salesmanName : visit.salesmanName}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {day.contacts.length > 0 && (
                  <div className="space-y-2 rounded-2xl border border-slate-100 p-4">
                    <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Kontakty</p>
                    <div className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                      {day.contacts.map((record) => (
                        <div key={record.id} className="grid gap-4 p-4 md:grid-cols-3">
                          <div className="space-y-1">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-400">Klient</p>
                            <p className="text-sm font-semibold text-slate-900">{record.clientName}</p>
                            {record.clientCity && <p className="text-xs text-slate-500">{record.clientCity}</p>}
                            {record.comment && <p className="text-xs text-slate-500">{record.comment}</p>}
                          </div>
                          <div className="space-y-1">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-400">Opiekun &amp; wynik</p>
                            <p className="text-sm text-slate-700">{record.handlerName}</p>
                            {record.outcome?.trim() && (
                              <p className="text-xs text-slate-500">{record.outcome.trim()}</p>
                            )}
                            {record.nextContactAt && (
                              <p className="text-xs text-slate-500">
                                Następny kontakt: {new Date(record.nextContactAt).toLocaleDateString("pl-PL")}
                              </p>
                            )}
                          </div>
                          <div className="space-y-1 text-xs text-slate-500 md:text-right">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-400">Daty</p>
                            <p className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600 inline-block">
                              {new Date(record.contactDate).toLocaleDateString("pl-PL")}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </article>
          ))}
        </section>

        {undatedTasks.length > 0 && (
          <section className="space-y-3 rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm">
            <header>
              <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Zadania bez daty utworzenia</p>
              <h3 className="text-lg font-semibold text-slate-900">Wymagają uwagi</h3>
            </header>
            <div className="divide-y divide-slate-100 rounded-2xl border border-slate-100">
              {undatedTasks.map((task) => {
                const history = [...(task.messages ?? [])]
                  .filter((message) => Boolean(message.body?.trim()))
                  .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
                const lastMessages = history.slice(-3).reverse();
                return (
                  <div key={task.id} className="space-y-3 border-b border-slate-100 p-4 last:border-b-0">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-1">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-400">Tytuł</p>
                        <p className="text-sm font-semibold text-slate-900">{task.title}</p>
                        <p className="text-xs text-slate-500">Klient: {task.clientName}</p>
                        {task.description && <p className="text-xs text-slate-500 line-clamp-3">{task.description}</p>}
                      </div>
                      <div className="space-y-1 text-sm text-slate-700">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-400">Opiekun i termin</p>
                        <p>{task.assignedToName}</p>
                        {task.clientCity && <p className="text-xs text-slate-500">{task.clientCity}</p>}
                        <p className="text-xs text-slate-500">Brak określonego terminu</p>
                      </div>
                      <div className="space-y-1 text-xs text-slate-500 md:text-right">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-400">Status i daty</p>
                        <span className={`inline-flex justify-end rounded-full border px-3 py-1 text-xs font-semibold ${TASK_STATUS_TONES[task.status]}`}>
                          {TASK_STATUS_LABELS[task.status]}
                        </span>
                        <p>
                          {task.createdAt
                            ? `Utworzone: ${new Date(task.createdAt).toLocaleDateString("pl-PL")}`
                            : "Brak daty utworzenia"}
                        </p>
                        <p>
                          {task.completedAt
                            ? `Wykonano: ${new Date(task.completedAt).toLocaleDateString("pl-PL")}`
                            : "Nie zakończono"}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 px-3 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">
                        Historia komentarzy
                      </p>
                      {lastMessages.length === 0 ? (
                        <p className="text-xs text-slate-500">Brak komentarzy do tego zadania.</p>
                      ) : (
                        <ul className="mt-2 space-y-2">
                          {lastMessages.map((message) => {
                            const styles = getNoteStyles(message.authorRole);
                            return (
                              <li key={message.id} className={`rounded-xl px-3 py-2 text-xs ${styles.container}`}>
                                <div className="flex items-center justify-between gap-2">
                                  <span className={`font-semibold ${styles.heading}`}>
                                    {message.authorName ?? "Użytkownik"}
                                  </span>
                                  <span className={`text-[11px] ${styles.meta}`}>
                                    {new Date(message.createdAt).toLocaleString("pl-PL", {
                                      day: "2-digit",
                                      month: "2-digit",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </span>
                                </div>
                                <p className={`mt-1 ${styles.body}`}>{message.body}</p>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

      </div>
    </main>
  );
}

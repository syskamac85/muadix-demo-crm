"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useAuthStore } from "@/store/auth-store";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

const EVENT_TYPE_STYLES = {
  visit: {
    label: "Wizyta",
    badge: "bg-rose-100 text-rose-800 border-rose-200",
  },
  visit_edit: {
    label: "Edycja wizyty",
    badge: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200",
  },
  call: {
    label: "Kontakt",
    badge: "bg-amber-100 text-amber-800 border-amber-200",
  },
  call_edit: {
    label: "Edycja kontaktu",
    badge: "bg-amber-200 text-amber-900 border-amber-300",
  },
  route: {
    label: "Trasa",
    badge: "bg-blue-100 text-blue-800 border-blue-200",
  },
  route_status: {
    label: "Status trasy",
    badge: "bg-blue-200 text-blue-900 border-blue-300",
  },
  client: {
    label: "Klient",
    badge: "bg-emerald-100 text-emerald-800 border-emerald-200",
  },
  client_edit: {
    label: "Edycja klienta",
    badge: "bg-emerald-200 text-emerald-900 border-emerald-300",
  },
  task: {
    label: "Zadanie",
    badge: "bg-purple-100 text-purple-800 border-purple-200",
  },
  task_status: {
    label: "Status zadania",
    badge: "bg-purple-200 text-purple-900 border-purple-300",
  },
  import: {
    label: "Import",
    badge: "bg-slate-100 text-slate-800 border-slate-200",
  },
} as const;

const CLASSIFICATION_COLOR_CLASSES = [
  "bg-rose-500",
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-600",
  "bg-purple-500",
  "bg-cyan-500",
  "bg-pink-500",
  "bg-lime-500",
  "bg-orange-500",
  "bg-teal-500",
];

const DEFAULT_CLASSIFICATION_LABEL = "Brak klasyfikacji";

type SalesRepOption = {
  id: number;
  username: string;
  first_name?: string;
  last_name?: string;
};

type ClientRecord = {
  id: number;
  name: string;
  city?: string;
  street?: string;
  postal_code?: string;
  nip?: string;
  classification?: string | null;
  salesman?: number | null;
};

type TaskRecord = {
  id: number;
  title: string;
  status: string;
  assigned_to?: number | { id: number } | SalesRepOption | null;
  assigned_to_id?: number | null;
  client?: number | ClientRecord | null;
  client_id?: number | null;
};

type JournalEvent = {
  id: string;
  type: keyof typeof EVENT_TYPE_STYLES;
  title: string;
  description: string;
  timestamp: string;
  createdAt?: string;
  salesmanId: number | null;
  salesmanName?: string;
  clientName: string;
  classification: string;
  locationName?: string | null;
};

type AuditLogRecord = {
  id: number;
  actor: number | null;
  actor_username?: string;
  event_type: string;
  entity_type: string;
  entity_id: number;
  changes: Record<string, { from: any; to: any }>;
  created_at: string;
};

const TASK_EVENT_LABELS: Record<string, string> = {
  'task.created': 'Nowe zadanie',
  'task.updated': 'Zmieniono zadanie',
  'task.deleted': 'Usunięto zadanie',
  'task.message': 'Komentarz do zadania',
  'task.completed_request': 'Zgłoszenie wykonania',
  'task.confirmed': 'Zadanie potwierdzone',
  'task.reopened': 'Zadanie ponownie otwarte',
};

const formatSalesRepName = (rep: SalesRepOption) => {
  const names = [rep.first_name, rep.last_name].filter(Boolean).join(" ");
  return names || rep.username;
};

const getClassificationLabel = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_CLASSIFICATION_LABEL;
};

const stripGpsNote = (text?: string | null) => {
  if (!text) {
    return "";
  }
  return text.replace(/\s*\[GPS:[^\]]+\]\s*$/i, "").trim();
};

const formatAuditChanges = (changes: AuditLogRecord["changes"], lookups: {
  repsMap: Map<number, SalesRepOption>;
  clientsMap: Map<number, ClientRecord>;
}) => {
  const parts: string[] = [];

  const describeUser = (value: any) => {
    const id = Number(value);
    if (!Number.isFinite(id)) {
      return value;
    }
    const rep = lookups.repsMap.get(id);
    return rep ? formatSalesRepName(rep) : `#${id}`;
  };

  const describeClient = (value: any) => {
    const id = Number(value);
    if (!Number.isFinite(id)) {
      return value;
    }
    const client = lookups.clientsMap.get(id);
    return client ? client.name : `#${id}`;
  };

  const describeDate = (value: any) => {
    if (!value) return "";
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  };

  Object.entries(changes ?? {}).forEach(([field, delta]) => {
    if (!delta) {
      return;
    }
    if (field === "client") {
      parts.push(`klient: ${describeClient(delta.from)} → ${describeClient(delta.to)}`);
      return;
    }
    if (field === "salesman") {
      parts.push(`handlowiec: ${describeUser(delta.from)} → ${describeUser(delta.to)}`);
      return;
    }
    if (field === "handler") {
      parts.push(`opiekun: ${describeUser(delta.from)} → ${describeUser(delta.to)}`);
      return;
    }
    if (field === "planned_at") {
      parts.push(`termin: ${describeDate(delta.from)} → ${describeDate(delta.to)}`);
      return;
    }
    if (field === "contact_date") {
      parts.push(`data kontaktu: ${describeDate(delta.from)} → ${describeDate(delta.to)}`);
      return;
    }
    if (field === "next_contact_at") {
      parts.push(`przypomnienie: ${describeDate(delta.from)} → ${describeDate(delta.to)}`);
      return;
    }
    if (field === "comment") {
      parts.push("komentarz: zmieniono");
      return;
    }
    if (field === "current_comment") {
      parts.push("komentarz: zmieniono");
      return;
    }
    if (field === "outcome") {
      parts.push(`status kontaktu: ${delta.from ?? "-"} → ${delta.to ?? "-"}`);
      return;
    }
    parts.push(`${field}: zmieniono`);
  });

  return parts.length ? `Zmieniono: ${parts.join(", ")}` : "Zmieniono rekord.";
};

const getChangeValue = (changes: AuditLogRecord["changes"], field: string) => {
  const entry = changes?.[field];
  if (!entry) {
    return undefined;
  }
  return entry.to ?? entry.from;
};

export default function JournalPage() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);
  const clearAuth = useAuthStore((state) => state.clear);

  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [salesmen, setSalesmen] = useState<SalesRepOption[]>([]);
  const [events, setEvents] = useState<JournalEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [salesmanFilter, setSalesmanFilter] = useState<string[]>([]);
  const [clientQuery, setClientQuery] = useState("");
  const [classificationFilter, setClassificationFilter] = useState<string[]>([]);

  const classificationLabels = useMemo(() => {
    const labels = new Set<string>();
    clients.forEach((client) => {
      labels.add(getClassificationLabel(client.classification));
    });
    events.forEach((event) => labels.add(event.classification));
    return Array.from(labels).sort((a, b) => a.localeCompare(b, "pl"));
  }, [clients, events]);

  const classificationColorMap = useMemo(() => {
    const map = new Map<string, string>();
    classificationLabels.forEach((label, index) => {
      map.set(label, CLASSIFICATION_COLOR_CLASSES[index % CLASSIFICATION_COLOR_CLASSES.length]);
    });
    return map;
  }, [classificationLabels]);

  const allSalesmanValues = useMemo(() => salesmen.map((rep) => String(rep.id)), [salesmen]);

  const toggleMultiValue = (value: string, setter: (updater: (prev: string[]) => string[]) => void) => {
    setter((prev) => (prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]));
  };

  const selectAllSalesmen = () => setSalesmanFilter(allSalesmanValues);
  const clearSalesmen = () => setSalesmanFilter([]);

  const selectAllClassifications = () => setClassificationFilter(classificationLabels);
  const clearClassifications = () => setClassificationFilter([]);

  const compareEventsByCreation = (a: JournalEvent, b: JournalEvent) => {
    const dateA = new Date(a.createdAt ?? a.timestamp).getTime();
    const dateB = new Date(b.createdAt ?? b.timestamp).getTime();
    return dateB - dateA;
  };

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (!token) {
      router.replace("/auth/login");
      return;
    }
    setLoading(true);
    setError(null);

    const fetchJson = async (url: string) => {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(`Nie udało się pobrać danych z ${url}`);
      }
      const payload = await response.json();
      return Array.isArray(payload) ? payload : payload.results ?? [];
    };

    Promise.all([
      fetchJson(`${API_BASE_URL}/api/clients/?limit=500`),
      fetchJson(`${API_BASE_URL}/api/accounts/sales-reps/`),
      fetchJson(`${API_BASE_URL}/api/visits/?ordering=-planned_at&limit=200`),
      fetchJson(`${API_BASE_URL}/api/call-records/?ordering=-contact_date&limit=200`),
      fetchJson(`${API_BASE_URL}/api/routes/?ordering=-date&limit=200`),
      fetchJson(`${API_BASE_URL}/api/tasks/?ordering=-updated_at&limit=200`),
      fetchJson(`${API_BASE_URL}/api/audit-logs/?limit=400`),
    ])
      .then(([clientsPayload, repsPayload, visits, calls, routes, tasksPayload, auditLogs]) => {
        const normalizedClients: ClientRecord[] = (Array.isArray(clientsPayload)
          ? clientsPayload
          : clientsPayload.results ?? []) as ClientRecord[];
        setClients(normalizedClients);

        const reps: SalesRepOption[] = (Array.isArray(repsPayload)
          ? repsPayload
          : repsPayload.results ?? []) as SalesRepOption[];
        setSalesmen(reps);

        const normalizedTasks: TaskRecord[] = (Array.isArray(tasksPayload)
          ? tasksPayload
          : tasksPayload.results ?? []) as TaskRecord[];

        const clientsMap = new Map<number, ClientRecord>();
        normalizedClients.forEach((client) => clientsMap.set(client.id, client));

        const repsMap = new Map<number, SalesRepOption>();
        reps.forEach((rep) => repsMap.set(rep.id, rep));

        const tasksMap = new Map<number, TaskRecord>();
        normalizedTasks.forEach((task) => tasksMap.set(task.id, task));

        const visitsMap = new Map<number, any>();
        (visits as any[]).forEach((visit) => {
          if (visit && typeof visit.id === "number") {
            visitsMap.set(visit.id, visit);
          }
        });

        const callsMap = new Map<number, any>();
        (calls as any[]).forEach((call) => {
          if (call && typeof call.id === "number") {
            callsMap.set(call.id, call);
          }
        });

        const routesMap = new Map<number, any>();
        (routes as any[]).forEach((route) => {
          if (route && typeof route.id === "number") {
            routesMap.set(route.id, route);
          }
        });

        const resolveClient = (payload: any): ClientRecord | undefined => {
          if (!payload) return undefined;
          if (typeof payload === "number") return clientsMap.get(payload);
          if (typeof payload === "object" && typeof payload.id === "number") {
            return (
              clientsMap.get(payload.id) ?? {
                id: payload.id,
                name: payload.name ?? "Klient",
                city: payload.city,
                street: payload.street,
                postal_code: payload.postal_code,
                nip: payload.nip,
                classification: payload.classification,
              }
            );
          }
          return undefined;
        };

        const visitEvents: JournalEvent[] = visits.map((visit: any) => {
          const client = resolveClient(visit.client) ?? resolveClient(visit.client_id);
          const salesmanId = typeof visit.salesman === "number" ? visit.salesman : visit.salesman?.id;
          const salesman = salesmanId ? repsMap.get(salesmanId) : undefined;
          const titleClient = client?.name ?? visit.client_name ?? "Klient";
          const cleanedComment = stripGpsNote(visit.comment);
          return {
            id: `visit-${visit.id}`,
            type: "visit",
            title: `Wizyta • ${titleClient}`,
            description: cleanedComment || visit.location_name || "Planowana wizyta",
            timestamp: visit.planned_at,
            createdAt: visit.created_at ?? visit.planned_at,
            salesmanId: salesmanId ?? null,
            salesmanName: salesman ? formatSalesRepName(salesman) : undefined,
            clientName: titleClient,
            classification: getClassificationLabel(client?.classification),
            locationName: visit?.location_name ?? null,
          };
        });

        const auditEvents: JournalEvent[] = [];

        const resolveRepId = (value: any) => {
          const id = Number(value);
          return Number.isFinite(id) ? id : undefined;
        };

        const resolveRep = (value: any) => {
          const id = resolveRepId(value);
          return id ? repsMap.get(id) : undefined;
        };

        const taskStatusEvents = new Set([
          "task.updated",
          "task.deleted",
          "task.completed_request",
          "task.confirmed",
          "task.reopened",
        ]);

        (auditLogs as AuditLogRecord[]).forEach((log) => {
          if (log.event_type === "visit.updated") {
            const visit = visitsMap.get(log.entity_id);
            const clientFromChange = log.changes?.client?.to ?? log.changes?.client?.from;
            const resolvedClient =
              resolveClient(clientFromChange) ?? resolveClient(visit?.client) ?? resolveClient(visit?.client_id);
            const clientName = resolvedClient?.name ?? "Wizyta";
            const actorId = typeof log.actor === "number" ? log.actor : null;
            const actor = actorId ? repsMap.get(actorId) : undefined;
            auditEvents.push({
              id: `visit-audit-${log.id}`,
              type: "visit_edit",
              title: `Edycja wizyty • ${clientName}`,
              description: formatAuditChanges(log.changes, { repsMap, clientsMap }),
              timestamp: log.created_at,
              createdAt: log.created_at,
              salesmanId: actorId,
              salesmanName: actor ? formatSalesRepName(actor) : log.actor_username,
              clientName,
              classification: getClassificationLabel(resolvedClient?.classification),
              locationName: visit?.location_name ?? null,
            });
            return;
          }

          if (log.event_type === "call.updated") {
            const callRecord = callsMap.get(log.entity_id);
            const clientFromChange = log.changes?.client?.to ?? log.changes?.client?.from;
            const resolvedClient =
              resolveClient(clientFromChange) ?? resolveClient(callRecord?.client) ?? resolveClient(callRecord?.client_id);
            const clientName = resolvedClient?.name ?? "Kontakt";
            const actorId = typeof log.actor === "number" ? log.actor : null;
            const actor = actorId ? repsMap.get(actorId) : undefined;
            auditEvents.push({
              id: `call-audit-${log.id}`,
              type: "call_edit",
              title: `Edycja kontaktu • ${clientName}`,
              description: formatAuditChanges(log.changes, { repsMap, clientsMap }),
              timestamp: log.created_at,
              createdAt: log.created_at,
              salesmanId: actorId,
              salesmanName: actor ? formatSalesRepName(actor) : log.actor_username,
              clientName,
              classification: getClassificationLabel(resolvedClient?.classification),
              locationName: resolvedClient?.city
                ? `${resolvedClient.city}${resolvedClient.street ? `, ${resolvedClient.street}` : ""}`
                : undefined,
            });
            return;
          }

          if (log.entity_type === "client") {
            const client = clientsMap.get(log.entity_id);
            const clientName = client?.name ?? `Klient #${log.entity_id}`;
            const salesmanId =
              (typeof client?.salesman === "number" ? client.salesman : undefined) ??
              resolveRepId(getChangeValue(log.changes, "salesman"));
            const salesman = salesmanId ? repsMap.get(salesmanId) : undefined;
            const baseEvent = {
              description: formatAuditChanges(log.changes, { repsMap, clientsMap }),
              timestamp: log.created_at,
              createdAt: log.created_at,
              salesmanId: salesmanId ?? null,
              salesmanName: salesman ? formatSalesRepName(salesman) : undefined,
              clientName,
              classification: getClassificationLabel(client?.classification),
              locationName: client?.city ? `${client.city}${client.street ? `, ${client.street}` : ""}` : undefined,
            } satisfies Omit<JournalEvent, "id" | "type" | "title">;

            if (log.event_type === "client.created" || log.event_type === "client.deleted") {
              auditEvents.push({
                id: `client-${log.id}`,
                type: "client",
                title: `${log.event_type === "client.created" ? "Nowy klient" : "Usunięto klienta"} • ${clientName}`,
                ...baseEvent,
              });
            } else {
              auditEvents.push({
                id: `client-edit-${log.id}`,
                type: "client_edit",
                title: `Edycja klienta • ${clientName}`,
                ...baseEvent,
              });
            }
            return;
          }

          if (log.entity_type === "route") {
            const route = routesMap.get(log.entity_id);
            const routeDate = (route?.date ?? getChangeValue(log.changes, "date"))?.toString();
            const ownerId =
              (typeof route?.owner === "number" ? route.owner : route?.owner_id) ??
              resolveRepId(getChangeValue(log.changes, "owner"));
            const owner = ownerId ? repsMap.get(ownerId) : resolveRep(log.actor);
            const eventLabel =
              log.event_type === "route.created"
                ? "Nowa trasa"
                : log.event_type === "route.deleted"
                  ? "Usunięto trasę"
                  : "Zmiana statusu trasy";
            auditEvents.push({
              id: `route-audit-${log.id}`,
              type: log.event_type.startsWith("route.") ? "route_status" : "route",
              title: `${eventLabel} • ${routeDate ?? "Trasa"}`,
              description: formatAuditChanges(log.changes, { repsMap, clientsMap }),
              timestamp: log.created_at,
              createdAt: log.created_at,
              salesmanId: ownerId ?? null,
              salesmanName: owner ? formatSalesRepName(owner) : log.actor_username,
              clientName: "Trasa",
              classification: DEFAULT_CLASSIFICATION_LABEL,
            });
            return;
          }

          if (log.entity_type === "task") {
            const task = tasksMap.get(log.entity_id);
            const taskTitle = task?.title ?? `Zadanie #${log.entity_id}`;
            const assignedId =
              task?.assigned_to_id ??
              (typeof task?.assigned_to === "number" ? task.assigned_to : undefined) ??
              resolveRepId(getChangeValue(log.changes, "assigned_to"));
            const assignedRep = assignedId ? repsMap.get(assignedId) : undefined;
            const clientForTask = task?.client_id ? clientsMap.get(task.client_id) : undefined;
            const eventKey = taskStatusEvents.has(log.event_type) ? "task_status" : "task";
            auditEvents.push({
              id: `task-audit-${log.id}`,
              type: eventKey,
              title: `${TASK_EVENT_LABELS[log.event_type] ?? "Zdarzenie zadania"} • ${taskTitle}`,
              description: formatAuditChanges(log.changes, { repsMap, clientsMap }),
              timestamp: log.created_at,
              createdAt: log.created_at,
              salesmanId: assignedId ?? null,
              salesmanName: assignedRep ? formatSalesRepName(assignedRep) : undefined,
              clientName: clientForTask?.name ?? "Zadanie",
              classification: getClassificationLabel(clientForTask?.classification),
            });
            return;
          }

          if (log.entity_type === "import_job") {
            const label =
              log.event_type === "import.created"
                ? "Nowy import"
                : log.event_type === "import.cancel_requested"
                  ? "Anulowanie importu"
                  : "Import";
            auditEvents.push({
              id: `import-${log.id}`,
              type: "import",
              title: label,
              description: formatAuditChanges(log.changes, { repsMap, clientsMap }),
              timestamp: log.created_at,
              createdAt: log.created_at,
              salesmanId: null,
              clientName: "Baza klientów",
              classification: DEFAULT_CLASSIFICATION_LABEL,
            });
          }
        });

        const callEvents: JournalEvent[] = calls.map((call: any) => {
          const client = resolveClient(call.client) ?? resolveClient(call.client_id);
          const handlerId = typeof call.handler === "number" ? call.handler : call.handler?.id;
          const handler = handlerId ? repsMap.get(handlerId) : undefined;
          const clientName = client?.name ?? call.client_name ?? "Klient";
          return {
            id: `call-${call.id}`,
            type: "call",
            title: `Kontakt • ${clientName}`,
            description: call.outcome || call.current_comment || "Kontakt telefoniczny",
            timestamp: call.contact_date,
            createdAt: call.created_at ?? call.contact_date,
            salesmanId: handlerId ?? null,
            salesmanName: handler ? formatSalesRepName(handler) : undefined,
            clientName,
            classification: getClassificationLabel(client?.classification),
            locationName: client?.city ? `${client.city}${client.street ? `, ${client.street}` : ""}` : undefined,
          };
        });

        const routeEvents: JournalEvent[] = routes.flatMap((route: any) => {
          const ownerId = typeof route.owner === "number" ? route.owner : route.owner_id;
          const owner = ownerId ? repsMap.get(ownerId) : undefined;
          if (!Array.isArray(route.stops)) {
            return [];
          }
          return route.stops.map((stop: any, index: number) => {
            const client = resolveClient(stop.client) ?? clientsMap.get(stop.client);
            const clientName = client?.name ?? stop.client_name ?? "Klient";
            return {
              id: `route-${route.id}-${stop.id}`,
              type: "route",
              title: `Trasa ${route.date} • ${clientName}`,
              description: stop.notes || `Przystanek ${index + 1}`,
              timestamp: route.date,
              createdAt: route.created_at ?? route.date,
              salesmanId: ownerId ?? null,
              salesmanName: owner ? formatSalesRepName(owner) : route.owner_name,
              clientName,
              classification: getClassificationLabel(client?.classification ?? stop.client_classification),
              locationName: client?.city ? `${client.city}${client.street ? `, ${client.street}` : ""}` : undefined,
            };
          });
        });

        const combined = [...auditEvents, ...visitEvents, ...callEvents, ...routeEvents].filter(
          (event) => Boolean(event.timestamp),
        );

        combined.sort(compareEventsByCreation);

        setEvents(combined);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Błąd pobierania danych.");
      })
      .finally(() => setLoading(false));
  }, [hydrated, token, router]);

  const filteredEvents = useMemo(() => {
    const fromDate = dateFrom ? new Date(dateFrom) : null;
    const toDate = dateTo ? new Date(dateTo) : null;
    return events
      .filter((event) => {
        if (salesmanFilter.length > 0) {
          if (!event.salesmanId || !salesmanFilter.includes(String(event.salesmanId))) {
            return false;
          }
        }
        if (classificationFilter.length > 0 && !classificationFilter.includes(event.classification)) {
          return false;
        }
        if (clientQuery.trim()) {
          const query = clientQuery.trim().toLowerCase();
          if (!event.clientName.toLowerCase().includes(query)) {
            return false;
          }
        }
        if (fromDate && new Date(event.timestamp) < fromDate) {
          return false;
        }
        if (toDate && new Date(event.timestamp) > toDate) {
          return false;
        }
        return true;
      })
      .sort(compareEventsByCreation);
  }, [
    events,
    salesmanFilter,
    classificationFilter,
    clientQuery,
    dateFrom,
    dateTo,
  ]);

  const classificationBadgeClass = (label: string) =>
    classificationColorMap.get(label) ?? "bg-slate-500";

  const formatEventDate = (event: JournalEvent) => {
    const source = event.createdAt ?? event.timestamp;
    if (!source) {
      return "";
    }
    const parsed = new Date(source);
    if (Number.isNaN(parsed.getTime())) {
      return source;
    }
    return parsed.toLocaleString("pl-PL");
  };

  const handleLogout = () => {
    clearAuth();
    router.replace("/auth/login");
  };

  if (!hydrated) {
    return null;
  }

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="glass-card w-full max-w-md space-y-4 p-8 text-center">
          <p className="text-sm font-semibold text-slate-900">
            Dostęp do dziennika wymaga zalogowania.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-blue-500">Dashboard</p>
            <h1 className="text-3xl font-semibold text-slate-900">Dziennik zdarzeń</h1>
            <p className="text-sm text-slate-500">Monitoruj wszystkie aktywności handlowe w jednym miejscu.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-4 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-blue-500 hover:text-blue-600"
            >
              ← Wróć do dashboardu
            </Link>
            <Link
              href="/dashboard/analytics"
              className="inline-flex items-center rounded-2xl bg-gradient-to-r from-purple-500 to-indigo-500 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110"
            >
              Analityka
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-blue-500 hover:text-blue-600"
            >
              Wyloguj się
            </button>
          </div>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">Filtry</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2 rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Handlowiec</p>
                <span className="text-[11px] uppercase tracking-[0.25em] text-slate-400">
                  {salesmanFilter.length > 0 ? `${salesmanFilter.length} wybranych` : "Wszyscy"}
                </span>
              </div>
              <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                {salesmen.map((rep) => (
                  <label
                    key={rep.id}
                    className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                  >
                    <span>{formatSalesRepName(rep)}</span>
                    <input
                      type="checkbox"
                      checked={salesmanFilter.includes(String(rep.id))}
                      onChange={() => toggleMultiValue(String(rep.id), setSalesmanFilter)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                ))}
              </div>
              <div className="flex gap-2 text-[11px] font-semibold uppercase tracking-[0.25em]">
                <button
                  type="button"
                  onClick={selectAllSalesmen}
                  className="rounded-xl border border-slate-200 px-3 py-1 text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
                >
                  Zaznacz wszystkich
                </button>
                <button
                  type="button"
                  onClick={clearSalesmen}
                  className="rounded-xl border border-slate-200 px-3 py-1 text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
                >
                  Wyczyść
                </button>
              </div>
            </div>

            <label className="flex flex-col text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
              Szukaj klienta
              <input
                type="search"
                value={clientQuery}
                onChange={(event) => setClientQuery(event.target.value)}
                placeholder="Nazwa klienta"
                className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </label>

            <div className="space-y-2 rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Nazwa klasyfikacji</p>
                <span className="text-[11px] uppercase tracking-[0.25em] text-slate-400">
                  {classificationFilter.length > 0 ? `${classificationFilter.length} wybranych` : "Wszystkie"}
                </span>
              </div>
              <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                {classificationLabels.map((label) => (
                  <label
                    key={label}
                    className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                  >
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={classificationFilter.includes(label)}
                      onChange={() => toggleMultiValue(label, setClassificationFilter)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                ))}
              </div>
              <div className="flex gap-2 text-[11px] font-semibold uppercase tracking-[0.25em]">
                <button
                  type="button"
                  onClick={selectAllClassifications}
                  className="rounded-xl border border-slate-200 px-3 py-1 text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
                >
                  Zaznacz wszystkie
                </button>
                <button
                  type="button"
                  onClick={clearClassifications}
                  className="rounded-xl border border-slate-200 px-3 py-1 text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
                >
                  Wyczyść
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-4 md:col-span-2 lg:col-span-1">
              <label className="flex flex-col text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
                Data od
                <input
                  type="date"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="flex flex-col text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
                Data do
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </label>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-blue-500">Lista zdarzeń</p>
              <h2 className="text-lg font-semibold text-slate-900">
                Znaleziono {filteredEvents.length} / {events.length}
              </h2>
            </div>
            {loading && <span className="text-xs text-slate-500">Ładowanie…</span>}
          </div>

          <div className="mt-4 space-y-3">
            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {!loading && !error && filteredEvents.length === 0 && (
              <p className="text-sm text-slate-500">Brak zdarzeń spełniających filtry.</p>
            )}

            {filteredEvents.map((event) => (
              <article
                key={event.id}
                className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold text-slate-900">{event.title}</span>
                    <span
                      className={`rounded-full border px-3 py-0.5 text-xs font-semibold uppercase tracking-wide ${EVENT_TYPE_STYLES[event.type].badge}`}
                    >
                      {EVENT_TYPE_STYLES[event.type].label}
                    </span>
                  </div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{formatEventDate(event)}</p>
                </div>
                {event.description && (
                  <p className="mt-1 text-sm text-slate-600">{event.description}</p>
                )}
                {event.locationName && (
                  <p className="mt-1 text-xs text-slate-500">📍 {event.locationName}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                  {event.salesmanName && <span>Handlowiec: {event.salesmanName}</span>}
                  <span>Klient: {event.clientName}</span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-0.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-white ${classificationBadgeClass(event.classification)}`}
                  >
                    {event.classification}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

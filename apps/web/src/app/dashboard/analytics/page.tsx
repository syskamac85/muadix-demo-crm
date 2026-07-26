"use client";

import "mapbox-gl/dist/mapbox-gl.css";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import MapboxMap, { Marker, NavigationControl } from "react-map-gl/mapbox";

import { useAuthStore } from "@/store/auth-store";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const EVENTS_LIMIT = 500;
const DEFAULT_MONTH_WINDOW = 3;
const AVERAGE_SPEED_KMH = 55;
const DEFAULT_START_COORDS = { latitude: 52.3029, longitude: 20.9944 };

const haversineDistanceKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number => {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

type RouteReportStop = {
  order: number;
  clientId: number | null;
  clientName: string;
  city: string;
  distanceKm: number;
  comment: string;
  latitude: number | null;
  longitude: number | null;
  visitConfirmed: boolean;
};

type RouteReportRow = {
  id: number;
  date: string;
  ownerName: string;
  stopsCount: number;
  totalKm: number;
  driveMinutes: number;
  stops: RouteReportStop[];
  comments: { type: string; client: string; body: string }[];
};

const parseStopComment = (comment: string | null | undefined): string => {
  if (!comment) return "";
  try {
    const parsed = JSON.parse(comment);
    if (parsed && parsed.__stopComments && Array.isArray(parsed.items)) {
      return parsed.items
        .map((item: any) => {
          const author = item.authorName ?? "";
          const body = item.body ?? "";
          const reply = item.replyBody ? ` → Odp: ${item.replyBody}` : "";
          return author ? `[${author}] ${body}${reply}` : `${body}${reply}`;
        })
        .join("; ");
    }
  } catch {}
  return comment;
};

const EVENT_COLORS: Record<AnalyticsEvent["type"], { bg: string; ring: string; label: string }> = {
  visit: { bg: "bg-fuchsia-500", ring: "ring-fuchsia-200", label: "Wizyta" },
  call: { bg: "bg-amber-500", ring: "ring-amber-200", label: "Kontakt" },
  route: { bg: "bg-sky-500", ring: "ring-sky-200", label: "Trasa" },
  task: { bg: "bg-emerald-500", ring: "ring-emerald-200", label: "Zadanie" },
};

const TASK_STATUS_LABELS: Record<string, string> = {
  pending: "Nowe",
  in_progress: "W trakcie",
  awaiting_review: "Do potwierdzenia",
  completed: "Zamknięte",
  cancelled: "Anulowane",
};

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
const DEFAULT_CLIENT_COLOR = { bg: "bg-slate-400", label: "Klient" };

type MapMarkerPoint = {
  id: string;
  lat: number;
  lon: number;
  label: string;
  ringClass: string;
  fillClass: string;
  title: string;
  statusLabel: string;
};

type ClientRecord = {
  id: number;
  name: string;
  city?: string;
  street?: string;
  postal_code?: string;
  nip?: string;
  latitude: number | null;
  longitude: number | null;
  classification?: string | null;
};

type SalesRepOption = {
  id: number;
  username: string;
  first_name?: string;
  last_name?: string;
};

type AnalyticsEvent = {
  id: string;
  type: "visit" | "call" | "route" | "task";
  clientId: number | null;
  clientName: string;
  city?: string;
  street?: string;
  postal_code?: string;
  nip?: string;
  lat: number | null;
  lon: number | null;
  description: string;
  timestamp: string;
  salesmanId: number | null;
  salesmanName?: string;
  classification?: string | null;
  locationName?: string | null;
};

const formatSalesRepName = (rep: SalesRepOption) => {
  const names = [rep.first_name, rep.last_name].filter(Boolean).join(" ");
  return names || rep.username;
};

const getClassificationLabel = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_CLASSIFICATION_LABEL;
};

const buildSortedEventMap = (source: AnalyticsEvent[]) => {
  const map = new Map<number, AnalyticsEvent[]>();
  source.forEach((event) => {
    if (!event.clientId) {
      return;
    }
    const list = map.get(event.clientId) ?? [];
    list.push(event);
    map.set(event.clientId, list);
  });
  map.forEach((list) => {
    list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  });
  return map;
};

const getDateISO = (date: Date) => date.toISOString().slice(0, 10);

const stripGpsNote = (text?: string | null) => {
  if (!text) {
    return "";
  }
  return text.replace(/\s*\[GPS:[^\]]+\]\s*$/i, "").trim();
};

export default function AnalyticsPage() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);
  const clearAuth = useAuthStore((state) => state.clear);

  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [salesmen, setSalesmen] = useState<SalesRepOption[]>([]);
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const [selectedTypes, setSelectedTypes] = useState<AnalyticsEvent["type"][]>([
    "visit",
    "call",
    "route",
    "task",
  ]);
  const [salesmanFilter, setSalesmanFilter] = useState<string[]>([]);
  const [clientQuery, setClientQuery] = useState("");
  const [classificationFilter, setClassificationFilter] = useState<string[]>([]);
  const today = useMemo(() => new Date(), []);
  const defaultQuarterFrom = useMemo(() => {
    const date = new Date();
    date.setMonth(date.getMonth() - DEFAULT_MONTH_WINDOW);
    return getDateISO(date);
  }, []);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [limitLastQuarter, setLimitLastQuarter] = useState(false);
  const [showAllClients, setShowAllClients] = useState(false);

  const [mapViewState, setMapViewState] = useState({
    latitude: 52.237049,
    longitude: 21.017532,
    zoom: 5,
  });

  // Route report state
  const currentMonth = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, []);
  const [reportMonth, setReportMonth] = useState<string>(currentMonth);
  const [reportSalesmanId, setReportSalesmanId] = useState<string>("");
  const [routeReportRows, setRouteReportRows] = useState<RouteReportRow[]>([]);
  const [routeReportLoading, setRouteReportLoading] = useState(false);
  const [routeReportError, setRouteReportError] = useState<string | null>(null);
  const [expandedRouteId, setExpandedRouteId] = useState<number | null>(null);
  const [isRouteExporting, setIsRouteExporting] = useState(false);
  const [routeExportStatus, setRouteExportStatus] = useState<string | null>(null);

  const clientsMap = useMemo(() => {
    const map = new Map<number, ClientRecord>();
    clients.forEach((client) => map.set(client.id, client));
    return map;
  }, [clients]);

  const normalizeClientSearchHaystack = (client: ClientRecord) => {
    return [client.name, client.city, client.street, client.postal_code, client.nip]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  };

  const clientsWithCoords = useMemo(
    () =>
      clients.filter((client) => {
        if (!client.latitude || !client.longitude) return false;
        if (!showAllClients) return true;
        const haystack = normalizeClientSearchHaystack(client);
        return haystack.includes(clientQuery.toLowerCase());
      }),
    [clients, clientQuery, showAllClients],
  );

  const classificationLabels = useMemo(() => {
    const labels = new Set<string>();
    clients.forEach((client) => {
      labels.add(getClassificationLabel(client.classification));
    });
    return Array.from(labels).sort((a, b) => a.localeCompare(b, "pl"));
  }, [clients]);

  const allSalesmanValues = useMemo(() => salesmen.map((rep) => String(rep.id)), [salesmen]);
  const allClassificationValues = useMemo(() => [...classificationLabels], [classificationLabels]);

  const classificationColorMap = useMemo(() => {
    const map = new Map<string, string>();
    classificationLabels.forEach((label, index) => {
      map.set(label, CLASSIFICATION_COLOR_CLASSES[index % CLASSIFICATION_COLOR_CLASSES.length]);
    });
    return map;
  }, [classificationLabels]);

  const getClassificationColor = (label: string) =>
    classificationColorMap.get(label) ?? DEFAULT_CLIENT_COLOR.bg;

  const toggleMultiValue = (value: string, setter: (updater: (prev: string[]) => string[]) => void) => {
    setter((prev) => (prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]));
  };

  const selectAllSalesmen = () => setSalesmanFilter(allSalesmanValues);
  const clearSalesmen = () => setSalesmanFilter([]);
  const selectAllClassifications = () => setClassificationFilter(allClassificationValues);
  const clearClassifications = () => setClassificationFilter([]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (!token) {
      router.replace("/auth/login");
    }
  }, [token, hydrated, router]);

  useEffect(() => {
    if (!limitLastQuarter) {
      return;
    }
    setDateFrom(defaultQuarterFrom);
    setDateTo(getDateISO(today));
  }, [limitLastQuarter, defaultQuarterFrom, today]);

  useEffect(() => {
    if (!token) {
      setClients([]);
      setEvents([]);
      return;
    }
    setLoading(true);
    setError(null);

    const fetchJson = async (url: string) => {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 404) {
        return [];
      }
      if (!response.ok) {
        throw new Error(`Nie udało się pobrać danych z ${url}`);
      }
      const payload = await response.json();
      return Array.isArray(payload) ? payload : payload.results ?? [];
    };

    const fetchWithFallback = async (url: string) => {
      try {
        return await fetchJson(url);
      } catch (err) {
        console.warn(err);
        return [];
      }
    };

    Promise.all([
      fetchWithFallback(`${API_BASE_URL}/api/clients/?limit=500`),
      fetchWithFallback(`${API_BASE_URL}/api/accounts/sales-reps/`),
      fetchWithFallback(`${API_BASE_URL}/api/visits/?ordering=-planned_at&limit=${EVENTS_LIMIT}`),
      fetchWithFallback(`${API_BASE_URL}/api/call-records/?ordering=-contact_date&limit=${EVENTS_LIMIT}`),
      fetchWithFallback(`${API_BASE_URL}/api/routes/?ordering=-date&limit=${EVENTS_LIMIT}`),
      fetchWithFallback(`${API_BASE_URL}/api/tasks/?ordering=-created_at&limit=${EVENTS_LIMIT}`),
    ])
      .then(([clientsPayload, repsPayload, visits, calls, routes, tasks]) => {
        const normalizedClients: ClientRecord[] = (Array.isArray(clientsPayload)
          ? clientsPayload
          : clientsPayload.results ?? []) as ClientRecord[];
        setClients(normalizedClients);

        const reps: SalesRepOption[] = (Array.isArray(repsPayload)
          ? repsPayload
          : repsPayload.results ?? []) as SalesRepOption[];
        setSalesmen(reps);

        const clientsMap = new Map<number, ClientRecord>();
        normalizedClients.forEach((client) => {
          clientsMap.set(client.id, client);
        });

        const repsMap = new Map<number, SalesRepOption>();
        reps.forEach((rep) => repsMap.set(rep.id, rep));

        const resolveClient = (payload: any): ClientRecord | undefined => {
          if (!payload) return undefined;
          if (typeof payload === "number") return clientsMap.get(payload);
          if (typeof payload === "object" && typeof payload.id === "number") {
            return clientsMap.get(payload.id) ?? {
              id: payload.id,
              name: payload.name ?? "Klient",
              city: payload.city,
              street: payload.street,
              postal_code: payload.postal_code,
              nip: payload.nip,
              latitude: payload.latitude ?? null,
              longitude: payload.longitude ?? null,
              classification: payload.classification ?? null,
            };
          }
          return undefined;
        };

        const visitEvents: AnalyticsEvent[] = visits.map((visit: any) => {
          const client = resolveClient(visit.client) ?? resolveClient(visit.client_id);
          const salesmanId = typeof visit.salesman === "number" ? visit.salesman : visit.salesman?.id;
          const salesman = repsMap.get(salesmanId ?? -1);
          const cleanedComment = stripGpsNote(visit.comment);
          return {
            id: `visit-${visit.id}`,
            type: "visit",
            clientId: client?.id ?? null,
            clientName: client?.name ?? visit.client_name ?? "Klient",
            city: client?.city,
            street: client?.street,
            postal_code: client?.postal_code,
            nip: client?.nip,
            lat: client?.latitude ?? null,
            lon: client?.longitude ?? null,
            description: cleanedComment || visit.location_name || "Planowana wizyta",
            timestamp: visit.planned_at,
            salesmanId: salesmanId ?? null,
            salesmanName: salesman ? formatSalesRepName(salesman) : undefined,
            classification: getClassificationLabel(client?.classification),
            locationName: visit.location_name ?? null,
          };
        });

        const callEvents: AnalyticsEvent[] = calls.map((call: any) => {
          const client = resolveClient(call.client) ?? resolveClient(call.client_id);
          const handlerId = call.handler_id ?? (typeof call.handler === "number" ? call.handler : call.handler?.id);
          const handler = repsMap.get(handlerId ?? -1);
          return {
            id: `call-${call.id}`,
            type: "call",
            clientId: client?.id ?? null,
            clientName: client?.name ?? call.client_name ?? "Klient",
            city: client?.city,
            street: client?.street,
            postal_code: client?.postal_code,
            nip: client?.nip,
            lat: client?.latitude ?? null,
            lon: client?.longitude ?? null,
            description: call.outcome || call.current_comment || "Kontakt telefoniczny",
            timestamp: call.contact_date,
            salesmanId: handlerId ?? null,
            salesmanName: handler ? formatSalesRepName(handler) : (call.handler_name || undefined),
            classification: getClassificationLabel(client?.classification),
          };
        });

        const routeEvents: AnalyticsEvent[] = routes.flatMap((route: any) => {
          const ownerId = typeof route.owner === "number" ? route.owner : route.owner_id;
          const owner = repsMap.get(ownerId ?? -1);
          if (!Array.isArray(route.stops)) {
            return [];
          }
          return route.stops.map((stop: any) => {
            const client = resolveClient(stop.client) ?? clientsMap.get(stop.client);
            return {
              id: `route-${route.id}-${stop.id}`,
              type: "route",
              clientId: client?.id ?? stop.client ?? null,
              clientName: client?.name ?? stop.client_name ?? "Klient",
              city: client?.city ?? stop.client_city,
              street: client?.street ?? stop.client_street,
              postal_code: client?.postal_code ?? stop.client_postal_code,
              nip: client?.nip,
              lat: client?.latitude ?? stop.client_latitude ?? null,
              lon: client?.longitude ?? stop.client_longitude ?? null,
              description: `Przystanek trasy ${route.date}`,
              timestamp: route.date,
              salesmanId: ownerId ?? null,
              salesmanName: owner ? formatSalesRepName(owner) : route.owner_name,
              classification: getClassificationLabel(client?.classification ?? stop.client_classification),
              locationName: client?.city
                ? `${client.city}${client.street ? `, ${client.street}` : ""}`
                : stop.client_city
                  ? `${stop.client_city}${stop.client_street ? `, ${stop.client_street}` : ""}`
                  : undefined,
            };
          });
        });

        const taskEvents: AnalyticsEvent[] = tasks.map((task: any) => {
          const client = resolveClient(task.client);
          const assigneeId =
            typeof task.assigned_to === "number" ? task.assigned_to : task.assigned_to?.id;
          const assignee = repsMap.get(assigneeId ?? -1);
          const statusLabel = TASK_STATUS_LABELS[task.status] ?? "Zadanie";
          const timestamp =
            (task.due_date ? `${task.due_date}T00:00:00` : undefined) ||
            task.completed_at ||
            task.created_at;
          return {
            id: `task-${task.id}`,
            type: "task",
            clientId: client?.id ?? null,
            clientName: client?.name ?? task.client_name ?? task.title ?? "Klient",
            city: client?.city ?? task.client_city,
            street: client?.street ?? undefined,
            postal_code: client?.postal_code ?? undefined,
            nip: client?.nip,
            lat: client?.latitude ?? null,
            lon: client?.longitude ?? null,
            description: `${task.title} — ${statusLabel}${task.due_date ? ` (termin ${task.due_date})` : ""}`,
            timestamp,
            salesmanId: assigneeId ?? null,
            salesmanName: assignee ? formatSalesRepName(assignee) : undefined,
            classification: getClassificationLabel(client?.classification),
            locationName: client?.city
              ? `${client.city}${client.street ? `, ${client.street}` : ""}`
              : undefined,
          };
        });

        const combined = [...visitEvents, ...callEvents, ...routeEvents, ...taskEvents].filter(
          (event) => event.timestamp,
        );
        setEvents(combined);
      })
      .catch((err) => {
        console.error(err);
        setError(err instanceof Error ? err.message : "Błąd pobierania danych.");
      })
      .finally(() => setLoading(false));
  }, [token]);

  const toggleType = (type: AnalyticsEvent["type"]) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((item) => item !== type) : [...prev, type],
    );
  };

  const filteredEvents = useMemo(() => {
    const fromDate = dateFrom ? new Date(dateFrom) : null;
    const toDate = dateTo ? new Date(dateTo) : null;
    return events.filter((event) => {
      if (!selectedTypes.includes(event.type)) {
        return false;
      }
      const eventClassification = getClassificationLabel(event.classification);
      if (classificationFilter.length > 0 && !classificationFilter.includes(eventClassification)) {
        return false;
      }
      if (salesmanFilter.length > 0) {
        if (!event.salesmanId || !salesmanFilter.includes(String(event.salesmanId))) {
          return false;
        }
      }
      if (clientQuery.trim()) {
        const haystack = [
          event.clientName,
          event.city,
          event.street,
          event.postal_code,
          event.nip,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(clientQuery.trim().toLowerCase())) {
          return false;
        }
      }
      if (fromDate) {
        if (new Date(event.timestamp) < fromDate) {
          return false;
        }
      }
      if (toDate) {
        const eventDate = new Date(event.timestamp);
        if (eventDate > toDate) {
          return false;
        }
      }
      return true;
    });
  }, [events, selectedTypes, classificationFilter, salesmanFilter, clientQuery, dateFrom, dateTo]);

  const clientFilteredEventsMap = useMemo(() => buildSortedEventMap(filteredEvents), [filteredEvents]);
  const clientAllEventsMap = useMemo(() => buildSortedEventMap(events), [events]);

  const buildMarkerDisplay = useCallback(
    (label: string) => {
      const colorClass = getClassificationColor(label);
      return {
        fillClass: colorClass,
        textClass: "text-white",
      };
    },
    [classificationColorMap, getClassificationColor],
  );

  const clientMarkers: MapMarkerPoint[] = useMemo(() => {
    return clientsWithCoords
      .map((client) => {
        const filteredList = clientFilteredEventsMap.get(client.id) ?? [];
        const allEvents = clientAllEventsMap.get(client.id) ?? [];
        const latestEvent = filteredList[0];
        const hasEvents = filteredList.length > 0;
        const includeWithoutEvents = showAllClients && allEvents.length === 0;
        if (!hasEvents && !includeWithoutEvents) {
          return null;
        }
        if (includeWithoutEvents && clientQuery.trim()) {
          const haystack = normalizeClientSearchHaystack(client);
          if (!haystack.includes(clientQuery.trim().toLowerCase())) {
            return null;
          }
        }
        const baseLabel = getClassificationLabel(hasEvents ? latestEvent.classification : client.classification);
        const matchesClassification =
          classificationFilter.length === 0 || classificationFilter.includes(baseLabel);
        if (!matchesClassification) {
          return null;
        }
        const { fillClass } = buildMarkerDisplay(baseLabel);
        const ringClass = hasEvents ? "ring-green-400" : "ring-red-400";
        const statusLabel = hasEvents ? "w filtrach" : "brak zdarzeń";
        const title = hasEvents
          ? `${client.name} — ${EVENT_COLORS[latestEvent.type].label} (${new Date(latestEvent.timestamp).toLocaleDateString()})`
          : `${client.name} — brak zdarzeń spełniających filtry`;
        return {
          id: `client-${client.id}`,
          lat: client.latitude as number,
          lon: client.longitude as number,
          label: client.name,
          ringClass,
          fillClass,
          title,
          statusLabel,
        };
      })
      .filter(Boolean) as MapMarkerPoint[];
  }, [
    clientsWithCoords,
    clientFilteredEventsMap,
    clientAllEventsMap,
    showAllClients,
    classificationFilter,
    clientQuery,
    buildMarkerDisplay,
  ]);

  const orphanMarkers: MapMarkerPoint[] = useMemo(() => {
    return filteredEvents
      .filter((event) => {
        if (event.lat === null || event.lon === null) {
          return false;
        }
        if (event.clientId && clientsMap.has(event.clientId)) {
          return false;
        }
        return true;
      })
      .map((event) => {
        const baseLabel = getClassificationLabel(event.classification);
        const { fillClass } = buildMarkerDisplay(baseLabel);
        const ringClass = "ring-green-400";
        return {
          id: event.id,
          lat: event.lat as number,
          lon: event.lon as number,
          label: event.clientName,
          ringClass,
          fillClass,
          title: `${event.clientName} — ${EVENT_COLORS[event.type].label}`,
          statusLabel: "w filtrach",
        };
      });
  }, [filteredEvents, clientsMap, buildMarkerDisplay]);

  const mapMarkers: MapMarkerPoint[] = useMemo(
    () => [...clientMarkers, ...orphanMarkers],
    [clientMarkers, orphanMarkers],
  );

  const handleLogout = () => {
    clearAuth();
    router.replace("/auth/login");
  };

  const handleExportExcel = async () => {
    if (filteredEvents.length === 0) {
      setExportStatus("Brak zdarzeń spełniających filtry – nic do wyeksportowania.");
      return;
    }
    setIsExporting(true);
    setExportStatus(null);
    try {
      const XLSX = await import("xlsx");
      const rows = filteredEvents.map((event) => ({
        Typ: EVENT_COLORS[event.type].label,
        "Data zdarzenia": new Date(event.timestamp).toLocaleString("pl-PL"),
        Klient: event.clientName,
        "Klasyfikacja": getClassificationLabel(event.classification),
        Miasto: event.city ?? "",
        Ulica: event.street ?? "",
        "Kod pocztowy": event.postal_code ?? "",
        NIP: event.nip ?? "",
        Handlowiec: event.salesmanName ?? "",
        Opis: event.description,
        "Lokalizacja (GPS)":
          event.lat && event.lon ? `${event.lat.toFixed(6)}, ${event.lon.toFixed(6)}` : "",
      }));
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Zdarzenia");
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(workbook, `analytics-${stamp}.xlsx`);
      setExportStatus(`Wyeksportowano ${rows.length} zdarzeń do pliku XLSX.`);
    } catch (exportError) {
      const message =
        exportError instanceof Error
          ? exportError.message
          : "Nie udało się wygenerować pliku XLSX.";
      setExportStatus(message);
    } finally {
      setIsExporting(false);
    }
  };

  // Route report: fetch routes for selected month/salesman
  const fetchRouteReport = useCallback(async () => {
    if (!token) return;
    setRouteReportLoading(true);
    setRouteReportError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/routes/?ordering=-date&limit=500`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Nie udało się pobrać tras.");
      const payload = await res.json();
      const allRoutes: any[] = Array.isArray(payload) ? payload : payload.results ?? [];

      // Also fetch comments linked to routes
      let allComments: any[] = [];
      try {
        const commentsRes = await fetch(`${API_BASE_URL}/api/comments/?limit=2000`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (commentsRes.ok) {
          const cp = await commentsRes.json();
          allComments = Array.isArray(cp) ? cp : cp.results ?? [];
        }
      } catch {}

      // Fetch visits for matching confirmed visits to route stops
      let allVisits: any[] = [];
      try {
        const visitsRes = await fetch(`${API_BASE_URL}/api/visits/?ordering=-planned_at&limit=2000`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (visitsRes.ok) {
          const vp = await visitsRes.json();
          allVisits = Array.isArray(vp) ? vp : vp.results ?? [];
        }
      } catch {}

      // Build a set of "clientId|date" keys for confirmed visits
      const confirmedVisitKeys = new Set<string>();
      allVisits.forEach((v: any) => {
        const st = String(v.status ?? "").toLowerCase();
        if (st !== "confirmed") return;
        const cId = typeof v.client === "number" ? v.client : v.client?.id;
        const dateStr = typeof v.planned_at === "string" ? v.planned_at.slice(0, 10) : "";
        if (cId && dateStr) {
          confirmedVisitKeys.add(`${cId}|${dateStr}`);
        }
      });

      const [year, month] = reportMonth.split("-").map(Number);

      const filtered = allRoutes.filter((route: any) => {
        const routeDate = new Date(route.date);
        if (routeDate.getFullYear() !== year || routeDate.getMonth() + 1 !== month) return false;
        if (reportSalesmanId) {
          const ownerId = typeof route.owner === "number" ? route.owner : route.owner_id;
          if (String(ownerId) !== reportSalesmanId) return false;
        }
        return true;
      });

      const rows: RouteReportRow[] = filtered.map((route: any) => {
        const stops: any[] = Array.isArray(route.stops) ? route.stops : [];
        let totalKm = 0;

        // Determine start coords from __returnToStart stop or fallback to default
        let startLat = DEFAULT_START_COORDS.latitude;
        let startLon = DEFAULT_START_COORDS.longitude;
        for (const s of stops) {
          const c = s.comment ?? "";
          if (c.includes("__returnToStart") || c.includes("__RETURN_TO_START__")) {
            try {
              const meta = JSON.parse(c);
              if (meta && (meta.__returnToStart || meta["__returnToStart"])) {
                if (typeof meta.latitude === "number" && typeof meta.longitude === "number") {
                  startLat = meta.latitude;
                  startLon = meta.longitude;
                }
              }
            } catch {}
            break;
          }
        }

        let prevLat: number | null = startLat;
        let prevLon: number | null = startLon;

        // Filter out the return-to-start pseudo-stop from real stops
        const realStops = stops.filter((s: any) => {
          const c = s.comment ?? "";
          return !c.includes("__returnToStart") && !c.includes("__RETURN_TO_START__");
        });

        const reportStops: RouteReportStop[] = realStops.map((stop: any) => {
          let distanceKm = 0;
          const lat = stop.client_latitude ?? null;
          const lon = stop.client_longitude ?? null;
          const stopClientId = typeof stop.client === "number" ? stop.client : stop.client?.id ?? null;
          const visitKey = stopClientId ? `${stopClientId}|${route.date}` : "";
          const confirmed = visitKey ? confirmedVisitKeys.has(visitKey) : false;
          if (lat && lon && prevLat && prevLon) {
            distanceKm = haversineDistanceKm(prevLat, prevLon, lat, lon);
          }
          if (confirmed) {
            totalKm += distanceKm;
            // Update prevLat/prevLon only for confirmed stops
            prevLat = lat;
            prevLon = lon;
          }
          return {
            order: stop.order,
            clientId: stopClientId,
            clientName: stop.client_name ?? "Klient",
            city: stop.client_city ?? "",
            distanceKm: confirmed ? Math.round(distanceKm * 10) / 10 : 0,
            comment: parseStopComment(stop.comment),
            latitude: lat,
            longitude: lon,
            visitConfirmed: confirmed,
          };
        });

        // Gather comments for this route
        const routeComments = allComments
          .filter((c: any) => c.route === route.id)
          .map((c: any) => ({
            type: c.comment_type === "pre" ? "Przed wizytą" : "Po wizycie",
            client: c.client_name ?? "",
            body: c.body ?? "",
          }));

        const ownerId = typeof route.owner === "number" ? route.owner : route.owner_id;
        const ownerRep = salesmen.find((s) => s.id === ownerId);
        const ownerName = ownerRep ? formatSalesRepName(ownerRep) : (route.owner_name ?? "Nieznany");

        // Drive minutes based on confirmed km only
        const confirmedDriveMinutes = Math.round((totalKm / AVERAGE_SPEED_KMH) * 60);

        return {
          id: route.id,
          date: route.date,
          ownerName,
          stopsCount: realStops.length,
          totalKm: Math.round(totalKm * 10) / 10,
          driveMinutes: confirmedDriveMinutes,
          stops: reportStops,
          comments: routeComments,
        };
      });

      rows.sort((a, b) => a.date.localeCompare(b.date));
      setRouteReportRows(rows);
    } catch (err) {
      setRouteReportError(err instanceof Error ? err.message : "Błąd ładowania raportu.");
    } finally {
      setRouteReportLoading(false);
    }
  }, [token, reportMonth, reportSalesmanId, salesmen]);

  useEffect(() => {
    fetchRouteReport();
  }, [fetchRouteReport]);

  const routeReportTotalKm = useMemo(
    () => routeReportRows.reduce((sum, r) => sum + r.totalKm, 0),
    [routeReportRows],
  );

  const routeReportAvgKmPerDay = useMemo(() => {
    if (routeReportRows.length === 0) return 0;
    const uniqueDays = new Set(routeReportRows.map((r) => r.date)).size;
    return uniqueDays > 0 ? Math.round((routeReportTotalKm / uniqueDays) * 10) / 10 : 0;
  }, [routeReportRows, routeReportTotalKm]);

  const handleRouteReportExportXlsx = async () => {
    if (routeReportRows.length === 0) {
      setRouteExportStatus("Brak tras do wyeksportowania.");
      return;
    }
    setIsRouteExporting(true);
    setRouteExportStatus(null);
    try {
      const XLSX = await import("xlsx");
      const rows: any[] = [];
      routeReportRows.forEach((route) => {
        route.stops.forEach((stop) => {
          rows.push({
            Data: route.date,
            Handlowiec: route.ownerName,
            "Trasa ID": route.id,
            "Przystanek nr": stop.order,
            Klient: stop.clientName,
            Miasto: stop.city,
            "Km": stop.distanceKm,
            Wizyta: stop.visitConfirmed ? "Potwierdzona" : "Brak",
            Komentarz: stop.comment,
          });
        });
        route.comments.forEach((c) => {
          rows.push({
            Data: route.date,
            Handlowiec: route.ownerName,
            "Trasa ID": route.id,
            "Przystanek nr": "",
            Klient: c.client,
            Miasto: "",
            "Km": "",
            Wizyta: "",
            Komentarz: `[${c.type}] ${c.body}`,
          });
        });
      });
      rows.push({
        Data: "SUMA",
        Handlowiec: "",
        "Trasa ID": "",
        "Przystanek nr": "",
        Klient: "",
        Miasto: "",
        "Km": Math.round(routeReportTotalKm * 10) / 10,
        Wizyta: "",
        Komentarz: "",
      });
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Trasy");
      XLSX.writeFile(workbook, `raport-tras-${reportMonth}.xlsx`);
      setRouteExportStatus("Plik XLSX wygenerowany.");
    } catch (err) {
      setRouteExportStatus("Nie udało się wygenerować pliku XLSX.");
    } finally {
      setIsRouteExporting(false);
    }
  };

  const handleRouteReportExportPdf = async () => {
    if (routeReportRows.length === 0) {
      setRouteExportStatus("Brak tras do wyeksportowania.");
      return;
    }
    setIsRouteExporting(true);
    setRouteExportStatus(null);
    try {
      // Generate a simple printable HTML and open in new tab for PDF print
      const salesmanName = reportSalesmanId
        ? salesmen.find((s) => String(s.id) === reportSalesmanId)
          ? formatSalesRepName(salesmen.find((s) => String(s.id) === reportSalesmanId)!)
          : "Handlowiec"
        : "Wszyscy handlowcy";
      let html = `<html><head><title>Raport tras ${reportMonth}</title><style>
        body{font-family:sans-serif;padding:20px;font-size:12px}
        h1{font-size:18px}h2{font-size:14px;margin-top:16px}
        table{width:100%;border-collapse:collapse;margin-top:8px}
        th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}
        th{background:#f0f0f0}
        .summary{display:flex;gap:24px;margin:12px 0}
        .summary div{padding:8px 16px;border:1px solid #ddd;border-radius:8px}
      </style></head><body>`;
      html += `<h1>Raport tras – ${reportMonth}</h1>`;
      html += `<p>Handlowiec: ${salesmanName}</p>`;
      html += `<div class="summary">
        <div><strong>${Math.round(routeReportTotalKm)}</strong> km łącznie</div>
        <div><strong>${routeReportRows.length}</strong> tras</div>
        <div><strong>${routeReportAvgKmPerDay}</strong> km/dzień</div>
      </div>`;
      routeReportRows.forEach((route) => {
        html += `<h2>${route.date} — ${route.stopsCount} przystanków, ${route.totalKm} km</h2>`;
        html += `<table><tr><th>#</th><th>Klient</th><th>Miasto</th><th>Km</th><th>Komentarz</th></tr>`;
        route.stops.forEach((s) => {
          html += `<tr><td>${s.order}</td><td>${s.clientName}</td><td>${s.city}</td><td>${s.distanceKm}</td><td>${s.comment}</td></tr>`;
        });
        route.comments.forEach((c) => {
          html += `<tr><td colspan="2">[${c.type}]</td><td>${c.client}</td><td></td><td>${c.body}</td></tr>`;
        });
        html += `</table>`;
      });
      html += `</body></html>`;
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank");
      if (w) {
        w.addEventListener("load", () => {
          setTimeout(() => w.print(), 500);
        });
      }
      setRouteExportStatus("Otwarto podgląd PDF – użyj opcji drukowania przeglądarki.");
    } catch (err) {
      setRouteExportStatus("Nie udało się wygenerować podglądu PDF.");
    } finally {
      setIsRouteExporting(false);
    }
  };

  if (!hydrated) {
    return null;
  }

  if (!token) {
    return null;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-6xl space-y-8">
        <nav className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-blue-500 hover:text-blue-600"
          >
            ← Wróć do dashboardu
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-blue-500 hover:text-blue-600"
          >
            Wyloguj się
          </button>
        </nav>

        <header className="glass-card p-6">
          <p className="text-xs uppercase tracking-[0.35em] text-blue-500">Analityka</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Mapa zdarzeń klientów</h1>
          <p className="text-sm text-slate-600">
            Filtruj wizyty, kontakty i przystanki tras w ostatnich miesiącach. Każdy typ ma własny kolor
            na mapie.
          </p>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {(Object.keys(EVENT_COLORS) as AnalyticsEvent["type"][]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${
                  selectedTypes.includes(type)
                    ? `${EVENT_COLORS[type].bg} bg-opacity-90 text-white`
                    : "border-slate-200 bg-slate-50 text-slate-600"
                }`}
              >
                <span>{EVENT_COLORS[type].label}</span>
                <span className="text-xs">
                  {selectedTypes.includes(type) ? "Widoczne" : "Ukryte"}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowAllClients((prev) => !prev)}
              className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${
                showAllClients
                  ? "bg-slate-900 text-white"
                  : "border-slate-200 bg-slate-50 text-slate-600"
              }`}
            >
              <span>All</span>
              <span className="text-xs">{showAllClients ? "Widoczne" : "Ukryte"}</span>
            </button>
          </div>

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
                placeholder="Nazwa, miasto, NIP..."
                className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </label>

            <div className="space-y-2 rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Klasyfikacja</p>
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
            <div className="flex flex-col gap-4 md:col-span-2 md:flex-row">
              <label className="flex flex-1 flex-col text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
                Data od
                <input
                  type="date"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(event) => {
                    setDateFrom(event.target.value);
                    if (limitLastQuarter && event.target.value !== defaultQuarterFrom) {
                      setLimitLastQuarter(false);
                    }
                  }}
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </label>

              <label className="flex flex-1 flex-col text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
                Data do
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(event) => {
                    setDateTo(event.target.value);
                    if (limitLastQuarter && event.target.value !== getDateISO(today)) {
                      setLimitLastQuarter(false);
                    }
                  }}
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </label>
            </div>
          </div>

          <label className="mt-3 flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
            <input
              type="checkbox"
              checked={limitLastQuarter}
              onChange={(event) => {
                const checked = event.target.checked;
                setLimitLastQuarter(checked);
                if (!checked) {
                  setDateFrom("");
                  setDateTo("");
                }
              }}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-[11px] uppercase tracking-[0.25em] text-slate-500">
              Sprawdź ostatnie 3 miesiące
            </span>
          </label>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-blue-500">Mapa</p>
              <h2 className="text-lg font-semibold text-slate-900">Zdarzenia na tle klientów</h2>
              <p className="text-xs text-slate-500">Łącznie zdarzeń: {filteredEvents.length}</p>
            </div>
            {loading && <p className="text-xs text-slate-500">Ładuję...</p>}
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex flex-col items-end gap-1">
              <button
                type="button"
                onClick={handleExportExcel}
                disabled={isExporting}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:from-blue-500 hover:via-indigo-400 hover:to-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isExporting ? "Generuję plik…" : "Eksportuj do Excel"}
              </button>
              {exportStatus && (
                <span className="text-[11px] text-slate-500">{exportStatus}</span>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <div className="h-[460px] overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {MAPBOX_TOKEN ? (
                <MapboxMap
                  mapboxAccessToken={MAPBOX_TOKEN}
                  mapStyle="mapbox://styles/mapbox/streets-v11"
                  reuseMaps
                  style={{ width: "100%", height: "100%" }}
                  {...mapViewState}
                  onMove={(event) => setMapViewState(event.viewState)}
                >
                  <NavigationControl position="top-right" />
                  {mapMarkers.map((marker) => {
                    return (
                      <Marker
                        key={marker.id}
                        latitude={marker.lat}
                        longitude={marker.lon}
                        anchor="bottom"
                      >
                        <div>
                          <button
                            type="button"
                            className={`h-4 w-4 rounded-full border-2 border-white ${marker.fillClass} ring ring-offset-2 ${marker.ringClass}`}
                            title={`${marker.label} — ${marker.statusLabel}`}
                          />
                        </div>
                      </Marker>
                    );
                  })}
                </MapboxMap>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  Ustaw zmienną środowiskową NEXT_PUBLIC_MAPBOX_TOKEN, aby wyświetlić mapę.
                </div>
              )}
            </div>

            <div className="max-h-[460px] space-y-2 overflow-y-auto pr-2 text-sm">
              {filteredEvents.map((event) => (
                <div key={event.id} className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">{event.clientName}</p>
                    <span
                      className={`rounded-full px-3 py-0.5 text-[11px] font-semibold text-white ${EVENT_COLORS[event.type].bg}`}
                    >
                      {EVENT_COLORS[event.type].label}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white ${getClassificationColor(getClassificationLabel(event.classification))}`}>
                      {getClassificationLabel(event.classification)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {event.city || "Brak miasta"} • {event.street || "Brak adresu"}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">{event.description}</p>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.3em] text-slate-400">
                    {new Date(event.timestamp).toLocaleString()}
                  </p>
                  {event.salesmanName && (
                    <p className="text-[11px] text-slate-500">Handlowiec: {event.salesmanName}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── ROUTE REPORT SECTION ─── */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-sky-600">Raport tras</p>
              <h2 className="text-lg font-semibold text-slate-900">
                Wykonane trasy w miesiącu
              </h2>
            </div>
          </div>

          {/* Filters */}
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="flex flex-col text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
              Miesiąc
              <div className="mt-1 flex gap-2">
                <select
                  value={reportMonth.split("-")[0]}
                  onChange={(e) => setReportMonth(`${e.target.value}-${reportMonth.split("-")[1]}`)}
                  className="w-24 rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none"
                >
                  {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
                    <option key={y} value={String(y)}>{y}</option>
                  ))}
                </select>
                <select
                  value={reportMonth.split("-")[1]}
                  onChange={(e) => setReportMonth(`${reportMonth.split("-")[0]}-${e.target.value}`)}
                  className="flex-1 rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none"
                >
                  {["01","02","03","04","05","06","07","08","09","10","11","12"].map((m) => (
                    <option key={m} value={m}>
                      {new Date(2024, parseInt(m) - 1).toLocaleString("pl-PL", { month: "long" })}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label className="flex flex-col text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
              Handlowiec
              <select
                value={reportSalesmanId}
                onChange={(e) => setReportSalesmanId(e.target.value)}
                className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none"
              >
                <option value="">Wszyscy</option>
                {salesmen.map((rep) => (
                  <option key={rep.id} value={String(rep.id)}>
                    {formatSalesRepName(rep)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={handleRouteReportExportXlsx}
                disabled={isRouteExporting}
                className="rounded-2xl bg-gradient-to-r from-sky-600 to-blue-500 px-4 py-2 text-sm font-semibold text-white shadow transition hover:from-sky-500 hover:to-blue-400 disabled:opacity-60"
              >
                {isRouteExporting ? "Generuję…" : "Pobierz XLSX"}
              </button>
              <button
                type="button"
                onClick={handleRouteReportExportPdf}
                disabled={isRouteExporting}
                className="rounded-2xl border border-sky-300 bg-white px-4 py-2 text-sm font-semibold text-sky-700 shadow transition hover:bg-sky-50 disabled:opacity-60"
              >
                Pobierz PDF
              </button>
            </div>
          </div>
          {routeExportStatus && (
            <p className="mt-2 text-xs text-slate-500">{routeExportStatus}</p>
          )}

          {/* Summary cards */}
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 text-center">
              <p className="text-2xl font-bold text-sky-700">
                {Math.round(routeReportTotalKm)}
              </p>
              <p className="text-xs uppercase tracking-[0.25em] text-sky-600">km łącznie</p>
            </div>
            <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 text-center">
              <p className="text-2xl font-bold text-sky-700">{routeReportRows.length}</p>
              <p className="text-xs uppercase tracking-[0.25em] text-sky-600">tras</p>
            </div>
            <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 text-center">
              <p className="text-2xl font-bold text-sky-700">{routeReportAvgKmPerDay}</p>
              <p className="text-xs uppercase tracking-[0.25em] text-sky-600">km / dzień</p>
            </div>
          </div>

          {/* Loading / Error */}
          {routeReportLoading && (
            <p className="mt-4 text-sm text-slate-500">Ładuję raport…</p>
          )}
          {routeReportError && (
            <p className="mt-4 text-sm text-red-600">{routeReportError}</p>
          )}

          {/* Routes table */}
          {!routeReportLoading && routeReportRows.length > 0 && (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.2em] text-slate-500">
                    <th className="px-3 py-2">Data</th>
                    <th className="px-3 py-2">Handlowiec</th>
                    <th className="px-3 py-2">Klienci (trasa)</th>
                    <th className="px-3 py-2 text-right">Km</th>
                    <th className="px-3 py-2 text-right">Czas jazdy</th>
                    <th className="px-3 py-2 text-center">Komentarze</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {routeReportRows.map((route) => {
                    const isExpanded = expandedRouteId === route.id;
                    const clientNames = route.stops.map((s) => s.clientName).join(" → ");
                    const commentCount =
                      route.stops.filter((s) => s.comment).length + route.comments.length;
                    return (
                      <React.Fragment key={route.id}>
                        <tr
                          className="cursor-pointer border-b border-slate-100 transition hover:bg-slate-50"
                          onClick={() =>
                            setExpandedRouteId(isExpanded ? null : route.id)
                          }
                        >
                          <td className="px-3 py-2 font-medium text-slate-900">
                            {route.date}
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {route.ownerName}
                          </td>
                          <td className="max-w-xs truncate px-3 py-2 text-slate-700">
                            {clientNames}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-sky-700">
                            {route.totalKm}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600">
                            {route.driveMinutes} min
                          </td>
                          <td className="px-3 py-2 text-center">
                            {commentCount > 0 && (
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700">
                                {commentCount}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-400">
                            {isExpanded ? "▲" : "▼"}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={7} className="bg-slate-50 px-4 py-3">
                              <div className="space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                                  Przystanki
                                </p>
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-left text-slate-400">
                                      <th className="px-2 py-1">#</th>
                                      <th className="px-2 py-1">Klient</th>
                                      <th className="px-2 py-1">Miasto</th>
                                      <th className="px-2 py-1 text-right">Km</th>
                                      <th className="px-2 py-1 text-center">Wizyta</th>
                                      <th className="px-2 py-1">Komentarz</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {route.stops.map((stop) => (
                                      <tr
                                        key={stop.order}
                                        className="border-t border-slate-100"
                                      >
                                        <td className="px-2 py-1">{stop.order}</td>
                                        <td className="px-2 py-1 font-medium">
                                          {stop.clientName}
                                        </td>
                                        <td className="px-2 py-1 text-slate-600">
                                          {stop.city}
                                        </td>
                                        <td className="px-2 py-1 text-right font-semibold text-sky-700">
                                          {stop.distanceKm}
                                        </td>
                                        <td className="px-2 py-1 text-center">
                                          {stop.visitConfirmed ? (
                                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                              Potwierdzona
                                            </span>
                                          ) : (
                                            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                                              Brak
                                            </span>
                                          )}
                                        </td>
                                        <td className="px-2 py-1 text-slate-600">
                                          {stop.comment || "—"}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                {route.comments.length > 0 && (
                                  <div className="mt-3">
                                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                                      Komentarze do trasy
                                    </p>
                                    <div className="mt-1 space-y-1">
                                      {route.comments.map((c, idx) => (
                                        <div
                                          key={idx}
                                          className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2"
                                        >
                                          <span className="text-[10px] font-semibold uppercase text-amber-600">
                                            {c.type}
                                          </span>
                                          {c.client && (
                                            <span className="ml-2 text-[10px] text-slate-500">
                                              {c.client}
                                            </span>
                                          )}
                                          <p className="mt-0.5 text-xs text-slate-700">
                                            {c.body}
                                          </p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!routeReportLoading && routeReportRows.length === 0 && !routeReportError && (
            <p className="mt-5 text-center text-sm text-slate-400">
              Brak tras w wybranym miesiącu.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

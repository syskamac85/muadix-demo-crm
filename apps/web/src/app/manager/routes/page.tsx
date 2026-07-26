"use client";

import "mapbox-gl/dist/mapbox-gl.css";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent } from "react";
import MapboxMap, {
  Layer,
  Marker,
  NavigationControl,
  Source,
  ViewStateChangeEvent,
} from "react-map-gl/mapbox";
import type { MarkerDragEvent } from "react-map-gl/mapbox";
import type { Feature, LineString } from "geojson";

import { useAuthStore } from "@/store/auth-store";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";
const CURRENT_USER_ENDPOINT = `${API_BASE_URL}/api/accounts/users/me/`;
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const DEFAULT_DRIVE_MINUTES = 30;
const MIN_DRIVE_MINUTES = 5;
const AVERAGE_SPEED_KMH = 55;
const DEFAULT_VISIT_MINUTES = 30;
const DEFAULT_START_COORDS = {
  latitude: 52.3029,
  longitude: 20.9944,
};
const NO_CLASSIFICATION_VALUE = "__no_classification__";

const getClassificationKey = (value?: string | null) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length ? trimmed : NO_CLASSIFICATION_VALUE;
};

const getClassificationLabel = (key: string) => {
  if (!key || key === NO_CLASSIFICATION_VALUE) {
    return "Brak klasyfikacji";
  }
  return key;
};

const formatVisitDateTime = (value: string) => {
  try {
    return new Date(value).toLocaleString("pl-PL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (_error) {
    return value;
  }
};

const formatClockLabel = (value: string) => {
  try {
    return new Date(value).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  } catch (_error) {
    return value;
  }
};

const getRouteStartDate = (routeDate: string | null, routeTime: string | null) => {
  const safeDate = routeDate && /^\d{4}-\d{2}-\d{2}$/.test(routeDate) ? routeDate : new Date().toISOString().slice(0, 10);
  const safeTime = routeTime && /^\d{2}:\d{2}$/.test(routeTime) ? routeTime : "08:00";
  const combined = `${safeDate}T${safeTime}`;
  const parsed = new Date(combined);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

type VisitFormState = {
  client: string;
  plannedAt: string;
  comment: string;
  salesman: string;
};

const formatUserName = (user?: CurrentUser | null) => {
  if (!user) {
    return "Użytkownik";
  }
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return fullName || user.username;
};
const DEFAULT_START_ADDRESS = "ul. Annopol 4, 03-236 Warszawa";
const RETURN_TO_START_FLAG = "__returnToStart";
const LEGACY_RETURN_TO_START_FLAG = "__RETURN_TO_START__";
const COMMENTS_FLAG = "__stopComments";
const NO_SALESMAN_VALUE = "__no_salesman__";

const estimateEndTime = (startTime: string, totalMinutes: number): string | null => {
  if (!startTime || !/^\d{2}:\d{2}$/.test(startTime) || Number.isNaN(totalMinutes)) {
    return null;
  }
  const [hours, minutes] = startTime.split(":").map((value) => Number(value));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  const date = new Date();
  date.setHours(hours, minutes + totalMinutes, 0, 0);
  return date.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
};

const toDatetimeLocalValue = (date: Date) => {
  const isoString = date.toISOString();
  return isoString.slice(0, 16);
};

type ClientInfo = {
  id: number;
  name: string;
  city?: string;
  postal_code?: string;
  street?: string;
  nip?: string;
  latitude: number | null;
  longitude: number | null;
  salesman_id?: number | null;
  classification?: string | null;
};

type MapPin = {
  id: number;
  name: string;
  city?: string;
  postal_code?: string;
  street?: string;
  latitude: number;
  longitude: number;
  classificationKey: string;
  classificationLabel: string;
};

type RouteStop = {
  stopId: string;
  clientId: number;
  clientName: string;
  city?: string;
  address?: string;
  latitude: number | null;
  longitude: number | null;
  driveMinutes: number;
  visitMinutes: number;
  arrivalTime?: string | null;
  comment: string;
  phone: string;
  email: string;
};

type StartPointOptions = {
  includeStart?: boolean;
  startCoords?: { latitude: number; longitude: number };
  startAddress?: string;
};

type DeviceLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

type SalesRepOption = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
};

type RouteStopResponse = {
  id: number;
  client: number;
  order: number;
  drive_minutes: number;
  visit_minutes: number;
  arrival_time: string | null;
  phone: string;
  email: string;
  comment: string;
  client_name: string;
  client_city: string;
  client_street: string;
  client_postal_code: string;
  client_latitude: number | null;
  client_longitude: number | null;
};

type RoutePlanRecord = {
  id: number;
  owner: number;
  owner_name: string;
  date: string;
  total_drive_minutes: number;
  total_visit_minutes: number;
  shared_with_manager: boolean;
  approval_status: "pending" | "approved" | "rejected";
  approved_at: string | null;
  approved_by: number | null;
  approved_by_name: string | null;
  stops: RouteStopResponse[];
};

type StopCommentEntry = {
  id: string;
  authorId: number | null;
  authorName: string;
  authorRole?: string | null;
  body: string;
  createdAt: string;
  replyBody?: string;
  replyAuthorId?: number | null;
  replyAuthorName?: string;
  replyCreatedAt?: string;
};

type CommentModalState = {
  stopId: string | null;
  stopName: string;
  entries: StopCommentEntry[];
  draftBody: string;
  editingId: string | null;
  editingBody: string;
  error: string | null;
  replyDrafts: Record<string, string>;
  status: string | null;
};

const defaultCommentModalState: CommentModalState = {
  stopId: null,
  stopName: "",
  entries: [],
  draftBody: "",
  editingId: null,
  editingBody: "",
  error: null,
  replyDrafts: {},
  status: null,
};

type VisitConfirmation = {
  plannedAt: string;
  confirmedAt: string;
  comment?: string | null;
  salesman?: string | null;
  locationName?: string | null;
};

type CurrentUser = {
  id: number;
  username: string;
  first_name?: string;
  last_name?: string;
  role?: string;
};

const formatSalesRepName = (rep: SalesRepOption) => {
  const names = [rep.first_name, rep.last_name].filter(Boolean).join(" ");
  return names || rep.username;
};

const APPROVAL_LABELS: Record<RoutePlanRecord["approval_status"], string> = {
  pending: "Do akceptacji",
  approved: "Zaakceptowana",
  rejected: "Odrzucona",
};

const APPROVAL_BADGE_STYLES: Record<RoutePlanRecord["approval_status"], string> = {
  pending: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-rose-200 bg-rose-50 text-rose-700",
};

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

const haversineDistanceKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number => {
  const R = 6371; // km
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const estimateDriveMinutes = (from?: RouteStop, to?: RouteStop): number => {
  if (
    !from ||
    !to ||
    from.latitude === null ||
    from.longitude === null ||
    to.latitude === null ||
    to.longitude === null
  ) {
    return DEFAULT_DRIVE_MINUTES;
  }
  const distance = haversineDistanceKm(from.latitude, from.longitude, to.latitude, to.longitude);
  const hours = distance / AVERAGE_SPEED_KMH;
  const minutes = Math.max(MIN_DRIVE_MINUTES, Math.round(hours * 60));
  return minutes;
};

const estimateDriveMinutesFromOrigin = (
  origin: { latitude: number; longitude: number } | null,
  stop?: RouteStop,
): number => {
  if (!origin || !stop || stop.latitude === null || stop.longitude === null) {
    return DEFAULT_DRIVE_MINUTES;
  }
  const distance = haversineDistanceKm(origin.latitude, origin.longitude, stop.latitude, stop.longitude);
  const hours = distance / AVERAGE_SPEED_KMH;
  const minutes = Math.max(MIN_DRIVE_MINUTES, Math.round(hours * 60));
  return minutes;
};

const recalculateDriveTimes = (stops: RouteStop[], origin?: { latitude: number; longitude: number } | null): RouteStop[] =>
  stops.map((stop, index) => {
    if (index === 0) {
      if (origin) {
        return { ...stop, driveMinutes: estimateDriveMinutesFromOrigin(origin, stop) };
      }
      return { ...stop, driveMinutes: 0 };
    }
    const previous = stops[index - 1];
    return { ...stop, driveMinutes: estimateDriveMinutes(previous, stop) };
  });

const reorderStopsFromStart = (stops: RouteStop[], startId: string): RouteStop[] => {
  const index = stops.findIndex((stop) => stop.stopId === startId);
  if (index <= 0) {
    return stops;
  }
  return [...stops.slice(index), ...stops.slice(0, index)];
};

const encodeLocationForMaps = (stop: RouteStop) => {
  if (stop.latitude !== null && stop.longitude !== null) {
    return `${stop.latitude},${stop.longitude}`;
  }
  if (stop.address) {
    return encodeURIComponent(stop.address);
  }
  if (stop.city) {
    return encodeURIComponent(stop.city);
  }
  return encodeURIComponent(stop.clientName);
};

const buildGoogleMapsUrl = (stops: RouteStop[], options?: StartPointOptions) => {
  if (!stops.length) {
    return null;
  }

  const { includeStart, startCoords, startAddress } = options || {};
  const startFromMap = includeStart && startCoords;
  const startFromAddress = includeStart && startAddress;
  const origin = startFromMap
    ? "Current+Location"
    : startFromAddress
      ? "Current+Location"
      : "Current+Location";
  const destination = encodeLocationForMaps(stops[stops.length - 1]);
  const waypointStops = stops.slice(1, -1);
  const waypoints = waypointStops.length
    ? `&waypoints=${waypointStops.map((stop) => encodeLocationForMaps(stop)).join("%7C")}`
    : "";
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${origin}&destination=${destination}${waypoints}`;
};

type ReturnToStartMeta = {
  __returnToStart: true;
  latitude?: number;
  longitude?: number;
  address?: string;
};

const parseReturnToStartMeta = (comment: string | null | undefined): ReturnToStartMeta | null => {
  if (
    !comment ||
    (!comment.includes(RETURN_TO_START_FLAG) && !comment.includes(LEGACY_RETURN_TO_START_FLAG))
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(comment);
    if (parsed && (parsed.__returnToStart || parsed[RETURN_TO_START_FLAG])) {
      return parsed;
    }
  } catch (_error) {
    console.warn("Nie udało się sparsować informacji o powrocie do startu", _error);
  }
  return null;
};

const parseStopComments = (comment: string | null | undefined): StopCommentEntry[] => {
  if (!comment) {
    return [];
  }
  try {
    const parsed = JSON.parse(comment);
    if (parsed && (parsed[COMMENTS_FLAG] || parsed.__stopComments) && Array.isArray(parsed.items)) {
      return parsed.items
        .map((item: Partial<StopCommentEntry>) => ({
          id: typeof item.id === "string" && item.id ? item.id : crypto.randomUUID(),
          authorId: typeof item.authorId === "number" ? item.authorId : null,
          authorName:
            typeof item.authorName === "string" && item.authorName ? item.authorName : "Użytkownik",
          authorRole: typeof item.authorRole === "string" ? item.authorRole : null,
          body: typeof item.body === "string" ? item.body : "",
          createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
          replyBody: typeof item.replyBody === "string" ? item.replyBody : undefined,
          replyAuthorId: typeof item.replyAuthorId === "number" ? item.replyAuthorId : null,
          replyAuthorName:
            typeof item.replyAuthorName === "string" && item.replyAuthorName
              ? item.replyAuthorName
              : undefined,
          replyCreatedAt: typeof item.replyCreatedAt === "string" ? item.replyCreatedAt : undefined,
        }))
        .filter((entry: StopCommentEntry) => entry.body.trim().length > 0);
    }
  } catch (_error) {
    // fallback to legacy text format below
  }
  const legacy = comment.trim();
  if (!legacy) {
    return [];
  }
  return [
    {
      id: "legacy-comment",
      authorId: null,
      authorName: "Notatka",
      body: legacy,
      createdAt: "",
    },
  ];
};

const encodeStopComments = (entries: StopCommentEntry[]): string => {
  if (!entries.length) {
    return "";
  }
  return JSON.stringify({
    [COMMENTS_FLAG]: true,
    items: entries.map((entry) => ({
      id: entry.id,
      authorId: entry.authorId,
      authorName: entry.authorName,
      authorRole: entry.authorRole,
      body: entry.body,
      createdAt: entry.createdAt,
      replyBody: entry.replyBody,
      replyAuthorId: entry.replyAuthorId,
      replyAuthorName: entry.replyAuthorName,
      replyCreatedAt: entry.replyCreatedAt,
    })),
  });
};

const summarizeStopComments = (comment: string | null | undefined) => {
  const entries = parseStopComments(comment);
  if (!entries.length) {
    return "";
  }
  return entries
    .map((entry, index) => {
      const reply = entry.replyBody ? ` (odp: ${entry.replyBody})` : "";
      return `${index + 1}. ${entry.authorName}: ${entry.body}${reply}`;
    })
    .join("\n   ");
};

const formatTimestamp = (value: string) => {
  if (!value) {
    return "";
  }
  try {
    return new Date(value).toLocaleString("pl-PL", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch (_error) {
    return value;
  }
};

const getDefaultVisitPlannedAt = (routeDate: string | null, routeStartTime: string | null) => {
  if (routeDate) {
    const safeStart = routeStartTime && /^\d{2}:\d{2}$/.test(routeStartTime) ? routeStartTime : "08:00";
    const candidate = new Date(`${routeDate}T${safeStart}`);
    if (!Number.isNaN(candidate.getTime())) {
      return toDatetimeLocalValue(candidate);
    }
  }
  return toDatetimeLocalValue(new Date());
};

const convertStopResponseToRouteStop = (
  stop: RouteStopResponse,
  fallbackClient: ClientInfo | undefined,
): RouteStop => {
  const base = fallbackClient ?? {
    id: stop.client,
    name: stop.client_name,
    city: stop.client_city,
    street: stop.client_street,
    postal_code: stop.client_postal_code,
    latitude: stop.client_latitude,
    longitude: stop.client_longitude,
    nip: "",
  };

  const returnMeta = parseReturnToStartMeta(stop.comment);
  if (returnMeta) {
    return {
      stopId: `return-${stop.id ?? crypto.randomUUID()}`,
      clientId: -1,
      clientName: "Powrót do startu",
      city: undefined,
      address: returnMeta.address ?? DEFAULT_START_ADDRESS,
      latitude: returnMeta.latitude ?? DEFAULT_START_COORDS.latitude,
      longitude: returnMeta.longitude ?? DEFAULT_START_COORDS.longitude,
      driveMinutes: stop.drive_minutes ?? 0,
      visitMinutes: 0,
      arrivalTime: stop.arrival_time,
      comment: "",
      phone: "",
      email: "",
    };
  }

  return {
    stopId: `${stop.client}-${stop.order}-${stop.id ?? Math.random()}`,
    clientId: stop.client,
    clientName: stop.client_name || base.name,
    city: base.city,
    address: base.street ? `${base.street}, ${base.postal_code ?? ""} ${base.city ?? ""}` : base.city,
    latitude: stop.client_latitude ?? base.latitude ?? null,
    longitude: stop.client_longitude ?? base.longitude ?? null,
    driveMinutes: stop.drive_minutes ?? 0,
    visitMinutes: stop.visit_minutes ?? 30,
    arrivalTime: stop.arrival_time,
    comment: stop.comment ?? "",
    phone: stop.phone ?? "brak danych",
    email: stop.email ?? "brak danych",
  };
};

const convertStopsToPayload = (
  stops: RouteStop[],
  options?: { startCoords?: { latitude: number; longitude: number }; startingPoint?: string },
) => {
  const realStops = stops.filter((stop) => stop.clientId > 0);
  const fallbackClientId = realStops[0]?.clientId ?? null;
  return stops
    .map((stop, index) => {
      if (stop.clientId > 0) {
        return {
          client: stop.clientId,
          order: index + 1,
          drive_minutes: stop.driveMinutes,
          visit_minutes: stop.visitMinutes,
          comment: stop.comment,
        };
      }
      if (!fallbackClientId) {
        return null;
      }
      const meta: ReturnToStartMeta = {
        __returnToStart: true,
        latitude: options?.startCoords?.latitude ?? DEFAULT_START_COORDS.latitude,
        longitude: options?.startCoords?.longitude ?? DEFAULT_START_COORDS.longitude,
        address: options?.startingPoint ?? DEFAULT_START_ADDRESS,
      };
      return {
        client: fallbackClientId,
        order: index + 1,
        drive_minutes: stop.driveMinutes,
        visit_minutes: 0,
        comment: JSON.stringify(meta),
      };
    })
    .filter((payload): payload is {
      client: number;
      order: number;
      drive_minutes: number;
      visit_minutes: number;
      comment: string;
    } => payload !== null);
};

const areSetsEqual = <T,>(a: Set<T>, b: Set<T>) => {
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
};

function RoutesPlannerPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);
  const clearAuth = useAuthStore((state) => state.clear);

  const [clients, setClients] = useState<ClientInfo[]>([]);
  const [activeClassifications, setActiveClassifications] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [routeStops, setRouteStops] = useState<RouteStop[]>([]);
  const [draggingStopId, setDraggingStopId] = useState<string | null>(null);
  const [salesmen, setSalesmen] = useState<SalesRepOption[]>([]);
  const [isLoadingSalesmen, setIsLoadingSalesmen] = useState(false);
  const [selectedSalesman, setSelectedSalesman] = useState<string>("");
  const [activeSalesmen, setActiveSalesmen] = useState<Set<string>>(new Set());
  const salesmanAdjustmentRef = useRef<"user" | "system" | null>(null);
  const [routeDate, setRouteDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [savedRoutesDate, setSavedRoutesDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [savedRoutes, setSavedRoutes] = useState<RoutePlanRecord[]>([]);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false);
  const [isSavingRoute, setIsSavingRoute] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [routeSelection, setRouteSelection] = useState("");
  const [hiddenTooltipIds, setHiddenTooltipIds] = useState<Set<number>>(() => new Set());
  const [routeStartTime, setRouteStartTime] = useState("08:00");
  const [startingPoint, setStartingPoint] = useState(DEFAULT_START_ADDRESS);
  const [includeStartInPlan, setIncludeStartInPlan] = useState(true);
  const [startCoords, setStartCoords] = useState(DEFAULT_START_COORDS);
  const [isGeocodingStart, setIsGeocodingStart] = useState(false);
  const [startGeocodeError, setStartGeocodeError] = useState<string | null>(null);
  const [routeActionStatus, setRouteActionStatus] = useState<string | null>(null);
  const [routeActionError, setRouteActionError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [isLoadingCurrentUser, setIsLoadingCurrentUser] = useState(false);
  const [commentModal, setCommentModal] = useState<CommentModalState>(defaultCommentModalState);
  const [isVisitModalOpen, setIsVisitModalOpen] = useState(false);
  const [visitModalStop, setVisitModalStop] = useState<RouteStop | null>(null);
  const [visitForm, setVisitForm] = useState<VisitFormState>({
    client: "",
    plannedAt: "",
    comment: "",
    salesman: "",
  });
  const [isSubmittingVisit, setIsSubmittingVisit] = useState(false);
  const [visitStatus, setVisitStatus] = useState<string | null>(null);
  const [visitError, setVisitError] = useState<string | null>(null);
  const [visitDeviceLocation, setVisitDeviceLocation] = useState<DeviceLocation | null>(null);
  const [isUpdatingApproval, setIsUpdatingApproval] = useState(false);
  const [deepLinkRouteId, setDeepLinkRouteId] = useState<number | null>(null);
  const deepLinkOwnerIdRef = useRef<string | null>(null);
  const processedRouteParamRef = useRef<string | null>(null);
  const [latestConfirmedVisits, setLatestConfirmedVisits] = useState<Record<number, VisitConfirmation>>({});
  const [_latestVisitError, setLatestVisitError] = useState<string | null>(null);
  const [_isLoadingLatestVisits, setIsLoadingLatestVisits] = useState(false);
  const routeApprovalStatusRef = useRef<string | null>(null);

  type UpdateRouteOptions = {
    recalc?: boolean;
    afterUpdate?: (nextStops: RouteStop[]) => void;
  };
  const [visitLocationStatus, setVisitLocationStatus] = useState<string | null>(null);
  const [visitLocationPlaceName, setVisitLocationPlaceName] = useState<string | null>(null);
  const [visitLocationCheckedAt, setVisitLocationCheckedAt] = useState<Date | null>(null);
  const [visitConfirmations, setVisitConfirmations] = useState<Record<string, VisitConfirmation>>({});

  const resolveVisitLocationName = useCallback(async (latitude: number, longitude: number) => {
    if (!MAPBOX_TOKEN) {
      setVisitLocationPlaceName(null);
      setVisitLocationStatus("Lokalizacja potwierdzona (Mapbox nie jest skonfigurowany).");
      return;
    }
    try {
      setVisitLocationPlaceName(null);
      setVisitLocationStatus("Lokalizacja potwierdzona, ustalam nazwę miejsca…");
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?limit=1&language=pl&access_token=${MAPBOX_TOKEN}`,
      );
      if (!response.ok) {
        throw new Error("Nie udało się pobrać adresu z Mapbox.");
      }
      const payload = await response.json();
      const placeName: string | undefined = payload?.features?.[0]?.place_name;
      if (placeName) {
        setVisitLocationPlaceName(placeName);
        setVisitLocationStatus(`Lokalizacja potwierdzona: ${placeName}`);
      } else {
        setVisitLocationPlaceName(null);
        setVisitLocationStatus("Lokalizacja potwierdzona, ale nie udało się ustalić adresu.");
      }
    } catch (_error) {
      console.error(_error);
      setVisitLocationPlaceName(null);
      setVisitLocationStatus("Lokalizacja potwierdzona, ale wystąpił błąd podczas ustalania adresu.");
    }
  }, []);

  const requestVisitDeviceLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setVisitLocationStatus("Brak wsparcia lokalizacji w przeglądarce.");
      setVisitLocationPlaceName(null);
      return;
    }
    setVisitLocationStatus("Sprawdzam lokalizację urządzenia...");
    setVisitLocationPlaceName(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords: DeviceLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        setVisitDeviceLocation(coords);
        setVisitLocationCheckedAt(new Date());
        void resolveVisitLocationName(coords.latitude, coords.longitude);
      },
      (error) => {
        console.warn("Błąd geolokalizacji urządzenia", error);
        setVisitLocationStatus("Nie udało się pobrać lokalizacji (włącz GPS/przeglądarkę).");
        setVisitDeviceLocation(null);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [resolveVisitLocationName]);

  const openVisitModal = useCallback(
    (stop: RouteStop) => {
      if (stop.clientId <= 0) {
        return;
      }
      if (routeApprovalStatusRef.current !== "approved") {
        setRouteActionError("Trasa musi zostać zaakceptowana przez managera przed potwierdzeniem wizyt.");
        return;
      }
      setVisitModalStop(stop);
      setVisitForm({
        client: String(stop.clientId),
        plannedAt: toDatetimeLocalValue(new Date()),
        comment: "",
        salesman: selectedSalesman || "",
      });
      setVisitStatus(null);
      setVisitError(null);
      setVisitDeviceLocation(null);
      setVisitLocationPlaceName(null);
      setVisitLocationStatus(null);
      setVisitLocationCheckedAt(null);
      setIsVisitModalOpen(true);
      requestVisitDeviceLocation();
    },
    [requestVisitDeviceLocation, routeDate, routeStartTime, selectedSalesman],
    // eslint-disable-next-line react-hooks/exhaustive-deps
  );

  const closeVisitModal = useCallback(() => {
    setIsVisitModalOpen(false);
    setVisitModalStop(null);
  }, []);

  const handleVisitSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!token) {
        return;
      }
      if (!visitForm.client || !visitForm.plannedAt) {
        setVisitError("Uzupełnij termin wizyty.");
        return;
      }
      if (!visitDeviceLocation) {
        setVisitError("Potwierdź lokalizację urządzenia przed zapisaniem wizyty.");
        return;
      }
      if (!visitModalStop) {
        setVisitError("Brak przypisanego punktu wizyty.");
        return;
      }
      if (routeApprovalStatusRef.current !== "approved") {
        setVisitError("Trasa oczekuje na akceptację – potwierdzanie wizyt jest zablokowane.");
        return;
      }
      setIsSubmittingVisit(true);
      setVisitError(null);
      setVisitStatus(null);
      const locationNote = ` [GPS: ${visitDeviceLocation.latitude.toFixed(5)}, ${visitDeviceLocation.longitude.toFixed(5)}, ±${Math.round(visitDeviceLocation.accuracy)}m]`;
      const payload = {
        client: Number(visitForm.client),
        planned_at: new Date(visitForm.plannedAt).toISOString(),
        comment: `${visitForm.comment || ""}${locationNote}`.trim(),
        salesman: visitForm.salesman ? Number(visitForm.salesman) : undefined,
        latitude: visitDeviceLocation.latitude,
        longitude: visitDeviceLocation.longitude,
        location_accuracy: visitDeviceLocation.accuracy,
        location_name: visitLocationPlaceName ?? undefined,
      };
      try {
        const response = await fetch(`${API_BASE_URL}/api/visits/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.detail ?? "Nie udało się potwierdzić wizyty.");
        }
        setVisitStatus("Wizyta została potwierdzona.");
        setVisitForm((prev) => ({ ...prev, comment: "" }));
        const confirmationTimestamp = new Date().toISOString();
        setVisitConfirmations((prev) => ({
          ...prev,
          [visitModalStop.stopId]: {
            plannedAt: visitForm.plannedAt,
            comment: visitForm.comment || null,
            confirmedAt: confirmationTimestamp,
            salesman: visitForm.salesman || null,
            locationName: visitLocationPlaceName ?? null,
          },
        }));
        if (visitModalStop.clientId > 0) {
          setLatestConfirmedVisits((prev) => ({
            ...prev,
            [visitModalStop.clientId]: {
              plannedAt: visitForm.plannedAt,
              confirmedAt: confirmationTimestamp,
              comment: visitForm.comment || null,
              salesman: visitForm.salesman || null,
              locationName: visitLocationPlaceName ?? null,
            },
          }));
        }
      } catch (err) {
        setVisitError(err instanceof Error ? err.message : "Błąd podczas potwierdzania wizyty.");
      } finally {
        setIsSubmittingVisit(false);
      }
    },
    [token, visitForm, visitDeviceLocation, visitLocationPlaceName, visitModalStop],
  );
  const [mapViewState, setMapViewState] = useState({
    // Start with a wider view over central Poland so planner widens context by default
    latitude: 52.1,
    longitude: 19.4,
    zoom: 5,
  });
  const [isRouting, setIsRouting] = useState(false);
  const [routingError, setRoutingError] = useState<string | null>(null);
  const [routeGeometry, setRouteGeometry] = useState<Feature<LineString> | null>(null);
  const routingSignatureRef = useRef<string | null>(null);
  const routingAbortRef = useRef<AbortController | null>(null);
  const startGeocodeAbortRef = useRef<AbortController | null>(null);
  const classificationOptions = useMemo(() => {
    const unique = new Set<string>();
    clients.forEach((client) => {
      unique.add(getClassificationKey(client.classification));
    });
    return Array.from(unique).sort((a, b) => getClassificationLabel(a).localeCompare(getClassificationLabel(b)));
  }, [clients]);

  const classificationsInitializedRef = useRef(false);
  const classificationAdjustmentRef = useRef<"user" | "system" | null>(null);
  const suppressAutoCenterOnFilters = useRef(false);

  const setActiveClassificationsWithIntent = useCallback(
    (updater: (prev: Set<string>) => Set<string>, initiatedByUser: boolean) => {
      setActiveClassifications((prev) => {
        const next = updater(prev);
        if (areSetsEqual(prev, next)) {
          return prev;
        }
        classificationAdjustmentRef.current = initiatedByUser ? "user" : "system";
        if (initiatedByUser) {
          suppressAutoCenterOnFilters.current = true;
        }
        salesmanAdjustmentRef.current = initiatedByUser ? "user" : "system";
        return next;
      });
    },
    [],
  );

  const setActiveClassificationsFromUser = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => setActiveClassificationsWithIntent(updater, true),
    [setActiveClassificationsWithIntent],
  );

  const setActiveClassificationsFromSystem = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => setActiveClassificationsWithIntent(updater, false),
    [setActiveClassificationsWithIntent],
  );

  const toggleClassification = useCallback((key: string) => {
    setActiveClassificationsFromUser((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, [setActiveClassificationsFromUser]);

  const applyClassificationSelection = useCallback(
    (_keys: string[]) => {
      // This function is kept for API compatibility but currently not used
    },
    [],
  );

  const useAllClassifications = useCallback(() => {
    if (classificationOptions.length === 0) {
      return;
    }
    setActiveClassificationsFromUser((prev) => {
      if (prev.size === classificationOptions.length) {
        const alreadyAll = classificationOptions.every((option) => prev.has(option));
        if (alreadyAll) {
          return prev;
        }
      }
      return new Set(classificationOptions);
    });
  }, [classificationOptions, setActiveClassificationsFromUser]);

  const clearClassifications = useCallback(() => {
    setActiveClassificationsFromUser((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      return new Set();
    });
  }, [setActiveClassificationsFromUser]);

  const totalClassificationCount = classificationOptions.length;
  const activeClassificationCount = activeClassifications.size;

  const isAllClassificationsSelected =
    totalClassificationCount === 0 || activeClassificationCount === totalClassificationCount;
  const isNoClassificationSelected = totalClassificationCount > 0 && activeClassificationCount === 0;

  useEffect(() => {
    setActiveClassificationsFromSystem((prev) => {
      if (classificationOptions.length === 0) {
        classificationsInitializedRef.current = false;
        return prev.size === 0 ? prev : new Set();
      }

      const allOptionsSet = new Set(classificationOptions);
      const filteredSet = new Set(Array.from(prev).filter((key) => classificationOptions.includes(key)));

      if (!classificationsInitializedRef.current) {
        classificationsInitializedRef.current = true;
        return allOptionsSet;
      }

      if (!areSetsEqual(prev, filteredSet)) {
        return filteredSet.size > 0 ? filteredSet : allOptionsSet;
      }

      return prev;
    });
  }, [classificationOptions, setActiveClassificationsFromSystem]);

  useEffect(() => {
    if (classificationAdjustmentRef.current === "user") {
      classificationAdjustmentRef.current = null;
    }
  }, [activeClassifications]);

  const isPrivilegedUser = useMemo(() => {
    const role = currentUser?.role;
    return role === "admin" || role === "manager";
  }, [currentUser]);
  const isSalesRep = currentUser?.role === "rep";
  const isCommentModalOpen = commentModal.stopId !== null;
  const canReplyToManagerEntry = useCallback(
    (entry: StopCommentEntry) => {
      if (!isSalesRep || entry.authorId === currentUser?.id) {
        return false;
      }
      const role = entry.authorRole;
      if (!role) {
        return true;
      }
      if (role === "rep") {
        return false;
      }
      return role === "admin" || role === "manager";
    },
    [currentUser?.id, isSalesRep],
  );
  const canEditReply = useCallback(
    (entry: StopCommentEntry) => {
      if (!isSalesRep || !currentUser) {
        return false;
      }
      if (entry.replyBody) {
        return entry.replyAuthorId === currentUser.id;
      }
      return canReplyToManagerEntry(entry);
    },
    [canReplyToManagerEntry, currentUser, isSalesRep],
  );

  const handleUnauthorized = useCallback(() => {
    setError("Sesja wygasła. Zaloguj się ponownie.");
    clearAuth();
    router.replace("/auth/login");
  }, [clearAuth, router]);

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
    setIsLoadingCurrentUser(true);
    fetch(CURRENT_USER_ENDPOINT, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => {
        if (response.status === 401) {
          handleUnauthorized();
          return null;
        }
        if (!response.ok) {
          throw new Error("Nie udało się pobrać danych użytkownika.");
        }
        return response.json();
      })
      .then((payload) => {
        if (payload) {
          setCurrentUser(payload);
        }
      })
      .catch((_error) => {
        console.error("Nie udało się pobrać danych użytkownika", _error);
      })
      .finally(() => setIsLoadingCurrentUser(false));
  }, [hydrated, token, handleUnauthorized]);

  const canEditComment = useCallback(
    (entry: StopCommentEntry) => {
      if (isPrivilegedUser) {
        return true;
      }
      if (!currentUser) {
        return false;
      }
      return entry.authorId === currentUser.id;
    },
    [currentUser, isPrivilegedUser],
  );

  useEffect(() => {
    if (!hydrated || !token) {
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`${API_BASE_URL}/api/clients/?limit=500`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (response.status === 401) {
          handleUnauthorized();
          return [];
        }
        if (!response.ok) {
          throw new Error("Nie udało się pobrać listy klientów.");
        }
        const payload = await response.json();
        const items = Array.isArray(payload) ? payload : payload.results ?? [];
        const normalized: ClientInfo[] = items.map((item: any) => ({
          id: item.id,
          name: item.name,
          city: item.city ?? "",
          postal_code: item.postal_code ?? "",
          street: item.street ?? "",
          nip: item.nip ?? "",
          latitude: item.latitude ?? null,
          longitude: item.longitude ?? null,
          salesman_id:
            typeof item.salesman === "number"
              ? item.salesman
              : typeof item.salesman?.id === "number"
                ? item.salesman.id
                : null,
          classification: item.classification ?? null,
        }));
        const nextClients =
          currentUser?.role === "rep"
            ? normalized.filter((client) => client.salesman_id === currentUser.id)
            : normalized;

        setClients(nextClients);

        if (!classificationsInitializedRef.current && nextClients.length > 0) {
          const nextActive = new Set<string>();
          nextClients.forEach((client) => {
            nextActive.add(getClassificationKey(client.classification));
          });
          setActiveClassificationsFromSystem(() => new Set(nextActive));
          classificationsInitializedRef.current = true;
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Nieznany błąd pobierania klientów.");
      })
      .finally(() => setLoading(false));
  }, [token, hydrated]);

  useEffect(() => {
    if (!hydrated || !token) {
      return;
    }
    if (!clients.length) {
      setLatestConfirmedVisits({});
      return;
    }
    let cancelled = false;
    setIsLoadingLatestVisits(true);
    setLatestVisitError(null);
    const params = new URLSearchParams({ ordering: "-planned_at", limit: "500" });
    fetch(`${API_BASE_URL}/api/visits/?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (response.status === 401) {
          handleUnauthorized();
          return [];
        }
        if (!response.ok) {
          throw new Error("Nie udało się pobrać wizyt.");
        }
        const payload = await response.json();
        return Array.isArray(payload) ? payload : payload.results ?? [];
      })
      .then((items) => {
        if (cancelled) {
          return;
        }
        const latestMap: Record<number, VisitConfirmation> = {};
        (items as any[]).forEach((item) => {
          const statusValue = String(item.status ?? item.visit_status ?? "").toLowerCase();
          if (statusValue !== "confirmed") {
            return;
          }
          const clientField = item.client;
          let clientId: number | null = null;
          if (typeof clientField === "number") {
            clientId = clientField;
          } else if (clientField && typeof clientField.id === "number") {
            clientId = clientField.id;
          } else if (typeof item.client_id === "number") {
            clientId = item.client_id;
          }
          if (!clientId || latestMap[clientId]) {
            return;
          }
          const plannedAt =
            item.planned_at ?? item.plannedAt ?? item.date ?? item.created_at ?? item.updated_at ?? null;
          const confirmedAt =
            item.updated_at ?? item.confirmed_at ?? item.confirmedAt ?? item.created_at ?? plannedAt ?? new Date().toISOString();
          latestMap[clientId] = {
            plannedAt: plannedAt ?? confirmedAt,
            confirmedAt,
            comment: item.comment ?? null,
            locationName: item.location_name ?? item.locationName ?? null,
            salesman:
              typeof item.salesman_name === "string"
                ? item.salesman_name
                : typeof item.salesmanUsername === "string"
                  ? item.salesmanUsername
                  : typeof item.salesman === "object" && item.salesman !== null
                    ? item.salesman.name ?? item.salesman.username ?? null
                    : typeof item.salesman === "string"
                      ? item.salesman
                      : null,
          };
        });
        setLatestConfirmedVisits(latestMap);
      })
      .catch((err) => {
        if (!cancelled) {
          setLatestVisitError(err instanceof Error ? err.message : "Błąd pobierania wizyt.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingLatestVisits(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hydrated, token, clients, handleUnauthorized]);

  useEffect(() => {
    if (!hydrated || !token) {
      return;
    }
    setIsLoadingSalesmen(true);
    fetch(`${API_BASE_URL}/api/accounts/sales-reps/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (response.status === 401) {
          handleUnauthorized();
          return [];
        }
        if (!response.ok) {
          throw new Error("Nie udało się pobrać listy handlowców.");
        }
        const payload = await response.json();
        const reps: SalesRepOption[] = (Array.isArray(payload) ? payload : payload.results ?? []) as SalesRepOption[];
        if (currentUser?.role === "rep") {
          setSalesmen(reps.filter((rep) => rep.id === currentUser.id));
        } else {
          setSalesmen(reps);
        }
      })
      .catch((err) => {
        console.error(err);
        setSalesmen([]);
      })
      .finally(() => setIsLoadingSalesmen(false));
  }, [token, hydrated]);

  useEffect(() => {
    if (currentUser?.role === "rep") {
      const repId = String(currentUser.id);
      if (selectedSalesman !== repId) {
        setSelectedSalesman(repId);
      }
      return;
    }
    if (!selectedSalesman && salesmen.length > 0) {
      setSelectedSalesman(String(salesmen[0].id));
    }
  }, [salesmen, selectedSalesman, currentUser]);

  const effectiveSalesmanId = useMemo(() => {
    if (currentUser?.role === "rep") {
      return currentUser.id ? String(currentUser.id) : "";
    }
    return selectedSalesman;
  }, [currentUser, selectedSalesman]);

  const loadRoutes = useCallback(() => {
    if (!hydrated || !token || !effectiveSalesmanId) {
      setSavedRoutes([]);
      return;
    }
    setIsLoadingRoutes(true);
    setRouteActionError(null);
    const params = new URLSearchParams({ owner: effectiveSalesmanId, ordering: "-date", limit: "10" });
    fetch(`${API_BASE_URL}/api/routes/?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (response.status === 401) {
          handleUnauthorized();
          return [];
        }
        if (!response.ok) {
          throw new Error("Nie udało się pobrać zapisanych tras.");
        }
        const payload = await response.json();
        const items: RoutePlanRecord[] = Array.isArray(payload) ? payload : payload.results ?? [];
        setSavedRoutes(items);
      })
      .catch((err) => {
        console.error(err);
        setSavedRoutes([]);
        setRouteActionError(err instanceof Error ? err.message : "Błąd ładowania tras.");
      })
      .finally(() => setIsLoadingRoutes(false));
  }, [token, hydrated, effectiveSalesmanId]);

  useEffect(() => {
    loadRoutes();
  }, [loadRoutes]);

  const handleRouteSelectionChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setRouteSelection(value);
    setSelectedRouteId(value ? Number(value) : null);
  };

  const handleResetRoute = () => {
    setRouteStops([]);
    setSelectedRouteId(null);
    setRouteSelection("");
    setHiddenTooltipIds(new Set());
    setRouteActionStatus("Trasę wyczyszczono.");
  };

  const handleSetStartStop = (stopId: string) => {
    updateStops((prev) => reorderStopsFromStart(prev, stopId), { recalc: true });
  };

  const clearRouteFeedback = () => {
    setRouteActionStatus(null);
    setRouteActionError(null);
  };

  const handleLoadSelectedRoute = () => {
    if (!selectedRouteId) {
      setRouteActionError("Wybierz trasę do wczytania.");
      return;
    }
    const record = selectedRoute;
    if (!record) {
      setRouteActionError("Nie znaleziono wybranej trasy.");
      return;
    }
    clearRouteFeedback();
    applyRouteRecord(record);
    setRouteActionStatus(`Wczytano trasę handlowca na ${record.date}.`);
  };

  const handleSaveRoute = async (mode: "new" | "update") => {
    if (!effectiveSalesmanId) {
      setRouteActionError("Wybierz handlowca przed zapisem trasy.");
      return;
    }
    const realStops = routeStops.filter((stop) => stop.clientId > 0);
    if (!realStops.length) {
      setRouteActionError("Dodaj co najmniej jednego klienta do trasy.");
      return;
    }
    clearRouteFeedback();
    setIsSavingRoute(true);
    const isUpdate = mode === "update" && selectedRouteId;
    const endpoint = `${API_BASE_URL}/api/routes/${isUpdate ? `${selectedRouteId}/` : ""}`;
    const payload = {
      owner_id: Number(effectiveSalesmanId),
      date: routeDate,
      shared_with_manager: true,
      stops: convertStopsToPayload(routeStops, {
        startCoords,
        startingPoint,
      }),
    };
    try {
      const response = await fetch(endpoint, {
        method: isUpdate ? "PUT" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(isUpdate ? "Nie udało się zaktualizować trasy." : "Nie udało się zapisać trasy.");
      }
      const record: RoutePlanRecord = await response.json();
      setRouteActionStatus(isUpdate ? "Zaktualizowano trasę." : "Zapisano nową trasę.");
      setSelectedRouteId(record.id);
      setRouteSelection(String(record.id));
      applyRouteRecord(record);
      setSavedRoutes((prev) => {
        const next = prev.filter((route) => route.id !== record.id);
        return [record, ...next].slice(0, 10);
      });
    } catch (err) {
      setRouteActionError(err instanceof Error ? err.message : "Nieznany błąd zapisu trasy.");
    } finally {
      setIsSavingRoute(false);
    }
  };

  const handleApprovalAction = async (action: "approve" | "reject") => {
    if (!selectedRouteId || !token) {
      return;
    }
    setRouteActionError(null);
    setIsUpdatingApproval(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/routes/${selectedRouteId}/${action}/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (!response.ok) {
        throw new Error(
          action === "approve" ? "Nie udało się zatwierdzić trasy." : "Nie udało się odrzucić trasy.",
        );
      }
      const updated: RoutePlanRecord = await response.json();
      setSavedRoutes((prev) => prev.map((route) => (route.id === updated.id ? updated : route)));
      if (selectedRouteId === updated.id) {
        applyRouteRecord(updated);
      }
      setRouteActionStatus(
        action === "approve" ? "Trasę zatwierdzono." : "Trasa została oznaczona jako odrzucona.",
      );
    } catch (_error) {
      setRouteActionError(_error instanceof Error ? _error.message : "Błąd akcji akceptacji.");
    } finally {
      setIsUpdatingApproval(false);
    }
  };

  const handleDeleteRoute = async () => {
    if (!selectedRouteId) {
      setRouteActionError("Brak wybranej trasy do usunięcia.");
      return;
    }
    if (!window.confirm("Czy na pewno chcesz usunąć tę trasę?")) {
      return;
    }
    clearRouteFeedback();
    setIsSavingRoute(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/routes/${selectedRouteId}/`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error("Nie udało się usunąć trasy.");
      }
      setRouteActionStatus("Trasę usunięto.");
      setRouteStops([]);
      setHiddenTooltipIds(new Set());
      setSelectedRouteId(null);
      setRouteSelection("");
      loadRoutes();
    } catch (err) {
      setRouteActionError(err instanceof Error ? err.message : "Błąd podczas usuwania trasy.");
    } finally {
      setIsSavingRoute(false);
    }
  };

  const googleMapsUrl = useMemo(() => buildGoogleMapsUrl(routeStops), [routeStops]);

  useEffect(() => {
    setRouteStops((prev) => recalculateDriveTimes(prev, includeStartInPlan ? startCoords : null));
  }, [includeStartInPlan, startCoords]);

  useEffect(() => {
    const query = startingPoint.trim();

    startGeocodeAbortRef.current?.abort();

    if (!query) {
      setStartGeocodeError("Podaj adres punktu startowego.");
      setIsGeocodingStart(false);
      return;
    }

    if (!MAPBOX_TOKEN) {
      setStartGeocodeError("Brak tokenu Mapbox – pinezka startu nie zostanie zaktualizowana.");
      setIsGeocodingStart(false);
      return;
    }

    const controller = new AbortController();
    startGeocodeAbortRef.current = controller;
    setIsGeocodingStart(true);
    setStartGeocodeError(null);

    const timeoutId: ReturnType<typeof setTimeout> = setTimeout(async () => {
      try {
        const response = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?limit=1&language=pl&access_token=${MAPBOX_TOKEN}`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          throw new Error("Nie udało się pobrać danych geolokalizacji.");
        }

        const payload = await response.json();
        const feature = payload.features?.[0];

        if (!feature) {
          throw new Error("Nie znaleziono podanego adresu.");
        }

        const [lng, lat] = feature.center ?? [];
        if (typeof lat !== "number" || typeof lng !== "number") {
          throw new Error("Brak koordynatów dla wskazanego adresu.");
        }

        setStartCoords({ latitude: lat, longitude: lng });
        // Removed automatic map zoom to start point - user can manually navigate
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setStartGeocodeError(
          error instanceof Error ? error.message : "Błąd geokodowania punktu startowego.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsGeocodingStart(false);
        }
      }
    }, 500);

    return () => {
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [startingPoint, MAPBOX_TOKEN]);

  const handleStartMarkerDragEnd = (event: MarkerDragEvent) => {
    const { lat, lng } = event.lngLat;
    setStartCoords({ latitude: lat, longitude: lng });
  };

  useEffect(() => {
    const boundsPoints: { latitude: number; longitude: number }[] = [];
    if (startCoords.latitude && startCoords.longitude) {
      boundsPoints.push({ latitude: startCoords.latitude, longitude: startCoords.longitude });
    }
    routeStops.forEach((stop) => {
      if (typeof stop.latitude === "number" && typeof stop.longitude === "number") {
        boundsPoints.push({ latitude: stop.latitude, longitude: stop.longitude });
      }
    });
    if (boundsPoints.length < 2) {
      return;
    }
    const lats = boundsPoints.map((point) => point.latitude);
    const lngs = boundsPoints.map((point) => point.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    const latDelta = maxLat - minLat;
    const lngDelta = maxLng - minLng;
    const zoom = Math.max(4, Math.min(13, calculateZoomFromDelta(Math.max(latDelta, lngDelta))));
    setMapViewState((prev) => ({
      ...prev,
      latitude: centerLat,
      longitude: centerLng,
      zoom,
    }));
  }, [routeStops, startCoords.latitude, startCoords.longitude]);

  const handleResetStartCoords = () => {
    startGeocodeAbortRef.current?.abort();
    setStartCoords(DEFAULT_START_COORDS);
    setStartingPoint(DEFAULT_START_ADDRESS);
    setStartGeocodeError(null);
  };

  const handleShareGoogleMaps = () => {
    if (!googleMapsUrl) {
      alert("Trasa wymaga co najmniej dwóch punktów, aby otworzyć ją w Google Maps.");
      return;
    }
    window.open(googleMapsUrl, "_blank", "noopener,noreferrer");
  };

  const handleLogout = () => {
    clearAuth();
    router.replace("/auth/login");
  };

  const hasClassificationOptions = classificationOptions.length > 0;
  const classificationFilteringEnabled = hasClassificationOptions;
  const classificationFilterActive =
    hasClassificationOptions && activeClassifications.size !== classificationOptions.length;

  useEffect(() => {
    if (classificationAdjustmentRef.current === "user") {
      classificationAdjustmentRef.current = null;
    }
  }, [activeClassifications]);

  const salesmanCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const relevantClients = classificationFilteringEnabled && activeClassifications.size > 0
      ? clients.filter((client) => activeClassifications.has(getClassificationKey(client.classification)))
      : clients;
    relevantClients.forEach((client) => {
      const key = client.salesman_id ? String(client.salesman_id) : NO_SALESMAN_VALUE;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return counts;
  }, [clients, classificationFilteringEnabled, activeClassifications]);

  const salesmanOptions = useMemo(() => {
    const options = salesmen.map((rep) => ({ key: String(rep.id), label: formatSalesRepName(rep) }));
    const hasUnassigned = clients.some((client) => !client.salesman_id);
    if (hasUnassigned) {
      options.push({ key: NO_SALESMAN_VALUE, label: "Brak opiekuna" });
    }
    return options;
  }, [salesmen, clients]);

  const salesmenInitializedRef = useRef(false);

  const setActiveSalesmenWithIntent = useCallback(
    (updater: (prev: Set<string>) => Set<string>, initiatedByUser: boolean) => {
      setActiveSalesmen((prev) => {
        const next = updater(prev);
        if (areSetsEqual(prev, next)) {
          return prev;
        }
        if (initiatedByUser) {
          suppressAutoCenterOnFilters.current = true;
        }
        return next;
      });
    },
    [],
  );

  const setActiveSalesmenFromUser = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => setActiveSalesmenWithIntent(updater, true),
    [setActiveSalesmenWithIntent],
  );

  const setActiveSalesmenFromSystem = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => setActiveSalesmenWithIntent(updater, false),
    [setActiveSalesmenWithIntent],
  );

  useEffect(() => {
    setActiveSalesmenFromSystem((prev) => {
      if (salesmanOptions.length === 0) {
        salesmenInitializedRef.current = false;
        return prev.size === 0 ? prev : new Set();
      }

      const optionKeys = salesmanOptions.map((option) => option.key);
      const allowedSet = new Set(optionKeys);
      const filtered = new Set(Array.from(prev).filter((key) => allowedSet.has(key)));

      if (!salesmenInitializedRef.current) {
        salesmenInitializedRef.current = true;
        salesmanAdjustmentRef.current = "system";
        return allowedSet;
      }

      if (!areSetsEqual(prev, filtered)) {
        salesmanAdjustmentRef.current = "system";
        return filtered.size > 0 ? filtered : allowedSet;
      }

      return prev;
    });
  }, [salesmanOptions, setActiveSalesmenFromSystem]);

  useEffect(() => {
    if (salesmanAdjustmentRef.current === "user") {
      salesmanAdjustmentRef.current = null;
    }
  }, [activeSalesmen]);

  const toggleSalesmanFilter = useCallback(
    (key: string) => {
      setActiveSalesmenFromUser((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });
    },
    [setActiveSalesmenFromUser],
  );

  const useAllSalesmen = useCallback(() => {
    if (salesmanOptions.length === 0) {
      return;
    }
    setActiveSalesmenFromUser((prev) => {
      if (prev.size === salesmanOptions.length) {
        const alreadyAll = salesmanOptions.every((option) => prev.has(option.key));
        if (alreadyAll) {
          return prev;
        }
      }
      return new Set(salesmanOptions.map((option) => option.key));
    });
  }, [salesmanOptions, setActiveSalesmenFromUser]);

  const clearSalesmen = useCallback(() => {
    setActiveSalesmenFromUser((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      return new Set();
    });
  }, [setActiveSalesmenFromUser]);

  const totalSalesmanCount = salesmanOptions.length;
  const activeSalesmanCount = activeSalesmen.size;

  const salesmanFilteringEnabled = totalSalesmanCount > 0;
  const salesmanFilterActive =
    salesmanFilteringEnabled && activeSalesmanCount > 0 && activeSalesmanCount !== totalSalesmanCount;

  const isAllSalesmenSelected =
    totalSalesmanCount === 0 ||
    activeSalesmanCount === totalSalesmanCount ||
    (!salesmenInitializedRef.current && totalSalesmanCount > 0 && salesmanAdjustmentRef.current !== "user");
  const isNoSalesmanSelected =
    totalSalesmanCount > 0 && activeSalesmanCount === 0 && salesmanAdjustmentRef.current !== "system";

  const classificationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const relevantClients = salesmanFilteringEnabled && activeSalesmen.size > 0
      ? clients.filter((client) => activeSalesmen.has(client.salesman_id ? String(client.salesman_id) : NO_SALESMAN_VALUE))
      : clients;
    relevantClients.forEach((client) => {
      const key = getClassificationKey(client.classification);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return counts;
  }, [clients, salesmanFilteringEnabled, activeSalesmen]);

  const filteredClients = useMemo(() => {
    const query = clientSearch.trim().toLowerCase();
    return clients.filter((client) => {
      if (classificationFilteringEnabled) {
        if (activeClassifications.size === 0) {
          return false;
        }
        if (!activeClassifications.has(getClassificationKey(client.classification))) {
          return false;
        }
      }

      if (salesmanFilteringEnabled && activeSalesmen.size > 0) {
        const salesmanKey = client.salesman_id ? String(client.salesman_id) : NO_SALESMAN_VALUE;
        if (!activeSalesmen.has(salesmanKey)) {
          return false;
        }
      }

      if (query.length === 0) {
        return true;
      }
      return [client.name, client.city, client.street, client.nip].filter(Boolean).some((value) =>
        value?.toLowerCase().includes(query),
      );
    });
  }, [
    clientSearch,
    clients,
    activeClassifications,
    classificationFilteringEnabled,
    activeSalesmen,
    salesmanFilteringEnabled,
  ]);

  const mapPins = useMemo<MapPin[]>(
    () =>
      filteredClients
        .filter(
          (client): client is ClientInfo & { latitude: number; longitude: number } =>
            client.latitude !== null && client.longitude !== null,
        )
        .map((client) => ({
          id: client.id,
          name: client.name,
          city: client.city,
          street: client.street,
          postal_code: client.postal_code,
          latitude: client.latitude,
          longitude: client.longitude,
          classificationKey: getClassificationKey(client.classification),
          classificationLabel: getClassificationLabel(getClassificationKey(client.classification)),
        })),
    [filteredClients],
  );

  const clientsMap = useMemo(() => {
    const map = new Map<number, ClientInfo>();
    clients.forEach((client) => {
      map.set(client.id, client);
    });
    return map;
  }, [clients]);

  const shouldAutoCenterOnPins = useMemo(() => {
    const hasSearch = clientSearch.trim().length > 0;
    if (suppressAutoCenterOnFilters.current && !hasSearch) {
      suppressAutoCenterOnFilters.current = false;
      return false;
    }
    return (
      routeStops.length === 0 && (hasSearch || classificationFilterActive || salesmanFilterActive)
    );
  }, [clientSearch, routeStops.length, classificationFilterActive, salesmanFilterActive]);

  // Center map on filtered pins when search/filter changes
  useEffect(() => {
    if (!shouldAutoCenterOnPins || mapPins.length === 0) {
      return;
    }
    const lats = mapPins.map((pin) => pin.latitude);
    const lngs = mapPins.map((pin) => pin.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    const latDelta = maxLat - minLat;
    const lngDelta = maxLng - minLng;
    const zoom = Math.max(5, Math.min(13, calculateZoomFromDelta(Math.max(latDelta, lngDelta))));
    setMapViewState((prev) => ({
      ...prev,
      latitude: centerLat,
      longitude: centerLng,
      zoom,
    }));
  }, [mapPins, shouldAutoCenterOnPins]);

  const hasReturnStop = useMemo(() => routeStops.some((stop) => stop.clientId === -1), [routeStops]);

  const selectedRoute = useMemo(
    () => (selectedRouteId ? savedRoutes.find((route) => route.id === selectedRouteId) ?? null : null),
    [savedRoutes, selectedRouteId],
  );
  const routeApprovalStatus = selectedRoute?.approval_status ?? null;
  const canSalesRepConfirmVisits = !isSalesRep || routeApprovalStatus === "approved";

  const computedArrivalTimes = useMemo(() => {
    if (!routeStops.length) {
      return {} as Record<string, string>;
    }
    const startDate = getRouteStartDate(routeDate, routeStartTime);
    if (!startDate) {
      return {} as Record<string, string>;
    }
    let elapsedMinutes = 0;
    return routeStops.reduce((acc, stop) => {
      const drive = Number.isFinite(Number(stop.driveMinutes)) ? Number(stop.driveMinutes) : 0;
      elapsedMinutes += drive;
      const arrival = stop.arrivalTime
        ? stop.arrivalTime
        : new Date(startDate.getTime() + elapsedMinutes * 60 * 1000).toISOString();
      acc[stop.stopId] = arrival;
      const visit = Number.isFinite(Number(stop.visitMinutes)) ? Number(stop.visitMinutes) : 0;
      elapsedMinutes += visit;
      return acc;
    }, {} as Record<string, string>);
  }, [routeStops, routeDate, routeStartTime]);

  useEffect(() => {
    routeApprovalStatusRef.current = routeApprovalStatus ?? null;
  }, [routeApprovalStatus]);

  const routeApprovalWarning = isSalesRep && routeApprovalStatus !== "approved";
  const canManageApprovals = currentUser?.role === "admin" || currentUser?.role === "manager";
  const pendingApprovalCount = useMemo(
    () => savedRoutes.filter((route) => route.approval_status === "pending").length,
    [savedRoutes],
  );

  const applyRouteRecord = useCallback(
    (record: RoutePlanRecord) => {
      const sortedStops = [...record.stops].sort((a, b) => (a.order || 0) - (b.order || 0));
      const converted = sortedStops.map((stop) => convertStopResponseToRouteStop(stop, clientsMap.get(stop.client)));

      const returnStop = sortedStops.find((stop) => parseReturnToStartMeta(stop.comment));
      if (returnStop) {
        const meta = parseReturnToStartMeta(returnStop.comment);
        if (meta) {
          if (meta.address) {
            setStartingPoint(meta.address);
          }
          if (meta.latitude != null && meta.longitude != null) {
            setStartCoords({ latitude: meta.latitude, longitude: meta.longitude });
          }
        }
      }

      setRouteStops(recalculateDriveTimes(converted, includeStartInPlan ? startCoords : null));
    },
    [clientsMap, includeStartInPlan, startCoords],
  );

  useEffect(() => {
    if (!searchParams) {
      return;
    }
    const routeParam = searchParams.get("routeId");
    if (routeParam && routeParam !== processedRouteParamRef.current) {
      const parsed = Number(routeParam);
      if (!Number.isNaN(parsed)) {
        setDeepLinkRouteId(parsed);
        processedRouteParamRef.current = routeParam;
      }
    }
    const ownerParam = searchParams.get("ownerId");
    if (ownerParam && ownerParam !== deepLinkOwnerIdRef.current) {
      deepLinkOwnerIdRef.current = ownerParam;
      setSelectedSalesman(ownerParam);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!deepLinkRouteId || !token) {
      return;
    }
    const matched = savedRoutes.find((route) => route.id === deepLinkRouteId);
    if (matched) {
      setRouteSelection(String(matched.id));
      setSelectedRouteId(matched.id);
      setSelectedSalesman(String(matched.owner));
      applyRouteRecord(matched);
      setDeepLinkRouteId(null);
      return;
    }
    let cancelled = false;
    const fetchRoute = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/routes/${deepLinkRouteId}/`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          throw new Error("Nie udało się pobrać trasy wskazanej w linku.");
        }
        const record: RoutePlanRecord = await response.json();
        if (cancelled) {
          return;
        }
        setSavedRoutes((prev) => {
          const next = prev.filter((route) => route.id !== record.id);
          return [record, ...next].slice(0, 10);
        });
        setRouteSelection(String(record.id));
        setSelectedRouteId(record.id);
        setSelectedSalesman(String(record.owner));
        applyRouteRecord(record);
      } catch (error) {
        if (!cancelled) {
          setRouteActionError(error instanceof Error ? error.message : "Nie udało się wczytać trasy z linku.");
        }
      } finally {
        if (!cancelled) {
          setDeepLinkRouteId(null);
        }
      }
    };
    fetchRoute();
    return () => {
      cancelled = true;
    };
  }, [deepLinkRouteId, token, savedRoutes, applyRouteRecord]);

  const fallbackRouteLine = useMemo<Feature<LineString> | null>(() => {
    const coordinates = [
      ...(includeStartInPlan ? [[startCoords.longitude, startCoords.latitude] as [number, number]] : []),
      ...routeStops
        .filter((stop) => stop.latitude !== null && stop.longitude !== null)
        .map((stop) => [stop.longitude as number, stop.latitude as number]),
    ];
    if (coordinates.length < 2) {
      return null;
    }
    return {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates,
      },
      properties: {},
    };
  }, [routeStops, includeStartInPlan, startCoords]);

  const displayRouteLine = routeGeometry ?? fallbackRouteLine;

  useEffect(() => {
    if (!MAPBOX_TOKEN) {
      setRouteGeometry(null);
      routingSignatureRef.current = null;
      return;
    }

    const clientCoords = routeStops
      .filter((stop) => stop.latitude !== null && stop.longitude !== null)
      .map((stop) => ({
        stopId: stop.stopId,
        longitude: stop.longitude as number,
        latitude: stop.latitude as number,
      }));

    const stopsWithCoords = includeStartInPlan
      ? [
          {
            stopId: "start",
            longitude: startCoords.longitude,
            latitude: startCoords.latitude,
          },
          ...clientCoords,
        ]
      : clientCoords;

    if (stopsWithCoords.length < 2) {
      setRouteGeometry(null);
      routingSignatureRef.current = null;
      setIsRouting(false);
      setRoutingError(null);
      routingAbortRef.current?.abort();
      routingAbortRef.current = null;
      return;
    }

    const signature = stopsWithCoords
      .map((stop) => `${stop.stopId}:${stop.latitude.toFixed(6)},${stop.longitude.toFixed(6)}`)
      .join("|");

    if (routingSignatureRef.current === signature) {
      return;
    }

    routingAbortRef.current?.abort();
    const controller = new AbortController();
    routingAbortRef.current = controller;
    setIsRouting(true);
    setRoutingError(null);

    const coordsQuery = stopsWithCoords
      .map((stop) => `${stop.longitude},${stop.latitude}`)
      .join(";");

    const fetchDirections = async () => {
      try {
        const response = await fetch(
          `https://api.mapbox.com/directions/v5/mapbox/driving/${coordsQuery}?overview=full&geometries=geojson&access_token=${MAPBOX_TOKEN}`,
          { signal: controller.signal },
        );
        if (!response.ok) {
          throw new Error("Nie udało się pobrać trasy drogowej z Mapbox.");
        }
        const payload = await response.json();
        const route = payload.routes?.[0];
        if (!route || !route.geometry) {
          throw new Error("Brak danych o geometrii trasy.");
        }

        const newGeometry: Feature<LineString> = {
          type: "Feature",
          geometry: route.geometry as LineString,
          properties: {},
        };

        setRouteGeometry(newGeometry);
        routingSignatureRef.current = signature;

        const legs: { duration?: number }[] = Array.isArray(route.legs) ? route.legs : [];
        const legMinutes = legs.map((leg) => {
          const duration = typeof leg.duration === "number" ? leg.duration : 0;
          return Math.max(MIN_DRIVE_MINUTES, Math.round(duration / 60));
        });

        setRouteStops((prev) => {
          if (prev.length !== routeStops.length) {
            return prev;
          }
          let changed = false;
          const updated = prev.map((stop, index) => {
            const legIndex = includeStartInPlan ? index : index - 1;
            const newMinutes = legIndex >= 0 ? legMinutes[legIndex] ?? stop.driveMinutes : 0;
            if (newMinutes !== stop.driveMinutes) {
              changed = true;
              return { ...stop, driveMinutes: newMinutes };
            }
            if (!includeStartInPlan && index === 0 && stop.driveMinutes !== 0) {
              changed = true;
              return { ...stop, driveMinutes: 0 };
            }
            return stop;
          });
          return changed ? updated : prev;
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        routingSignatureRef.current = null;
        setRouteGeometry(null);
        setRoutingError(error instanceof Error ? error.message : "Błąd pobierania trasy drogowej.");
      } finally {
        if (!controller.signal.aborted) {
          setIsRouting(false);
        }
      }
    };

    fetchDirections();

    return () => {
      controller.abort();
    };
  }, [MAPBOX_TOKEN, routeStops, includeStartInPlan, startCoords]);

  const selectedRouteMarkers = useMemo(
    () =>
      routeStops
        .map((stop, index) => ({
          ...stop,
          order: index + 1,
        }))
        .filter((stop) => stop.latitude !== null && stop.longitude !== null),
    [routeStops],
  );

  const formatAddress = (client: { street?: string; postal_code?: string; city?: string } = {}) => {
    const baseStreet = client.street;
    const baseCity = client.city;
    const basePostal = client.postal_code;
    if (baseStreet) {
      return `${baseStreet}${basePostal ? `, ${basePostal}` : ""}${baseCity ? ` ${baseCity}` : ""}`.trim();
    }
    if (baseCity || basePostal) {
      return [basePostal, baseCity].filter(Boolean).join(" ");
    }
    return "brak adresu";
  };

  const updateStops = useCallback(
    (updater: (prev: RouteStop[]) => RouteStop[], options: UpdateRouteOptions = {}) => {
      setRouteStops((prev) => {
        const updated = updater(prev);
        const origin = includeStartInPlan ? startCoords : null;
        return options.recalc ? recalculateDriveTimes(updated, origin) : updated;
      });
    },
    [includeStartInPlan, startCoords],
  );

  const addClientToRoute = (client: ClientInfo) => {
    const baseStop: RouteStop = {
      stopId: crypto.randomUUID(),
      clientId: client.id,
      clientName: client.name,
      city: client.city,
      address: formatAddress(client),
      latitude: client.latitude ?? null,
      longitude: client.longitude ?? null,
      driveMinutes: 0,
      visitMinutes: DEFAULT_VISIT_MINUTES,
      comment: "",
      phone: "brak danych",
      email: "brak danych",
    };
    const driveMinutes = includeStartInPlan ? estimateDriveMinutesFromOrigin(startCoords, baseStop) : 0;
    const newStop: RouteStop = { ...baseStop, driveMinutes };
    updateStops((prev) => [...prev, newStop], { recalc: true });
    hideTooltipForClient(client.id);
  };

  const hideTooltipForClient = useCallback((clientId: number) => {
    setHiddenTooltipIds((prev) => {
      if (prev.has(clientId)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(clientId);
      return next;
    });
  }, []);

  const handleAddReturnToStart = () => {
    if (!routeStops.length || hasReturnStop) {
      return;
    }
    let targetStop: RouteStop;
    if (includeStartInPlan) {
      const lastStop = routeStops[routeStops.length - 1];
      targetStop = {
        stopId: crypto.randomUUID(),
        clientId: -1,
        clientName: "Powrót do startu",
        city: undefined,
        address: startingPoint,
        latitude: startCoords.latitude,
        longitude: startCoords.longitude,
        driveMinutes: lastStop ? estimateDriveMinutes(lastStop, {
          stopId: "start",
          clientId: -1,
          clientName: "",
          city: startingPoint,
          address: startingPoint,
          latitude: startCoords.latitude,
          longitude: startCoords.longitude,
          driveMinutes: 0,
          visitMinutes: 0,
          comment: "",
          phone: "",
          email: "",
        }) : 0,
        visitMinutes: 0,
        comment: "",
        phone: "",
        email: "",
      };
    } else {
      const firstStop = routeStops[0];
      targetStop = {
        ...firstStop,
        stopId: crypto.randomUUID(),
        driveMinutes: 0,
      };
    }
    updateStops((prev) => [...prev, targetStop], { recalc: true });
  };

  const pendingRouteSyncRef = useRef<{ stops: RouteStop[]; statusMessage?: string } | null>(null);
  const isSyncingRouteRef = useRef(false);

  const updateRouteStop = useCallback(
    (stopId: string, patch: Partial<RouteStop>, options: UpdateRouteOptions = {}) => {
      const shouldRecalc =
        Object.prototype.hasOwnProperty.call(patch, "latitude") ||
        Object.prototype.hasOwnProperty.call(patch, "longitude");
      setRouteStops((prev) => {
        const patched = prev.map((stop) => (stop.stopId === stopId ? { ...stop, ...patch } : stop));
        const next = options.recalc
          ? recalculateDriveTimes(patched, includeStartInPlan ? startCoords : null)
          : patched;
        options.afterUpdate?.(next);
        return next;
      });
    },
    [includeStartInPlan, startCoords],
  );

  const openCommentModal = (stop: RouteStop) => {
    const entries = parseStopComments(stop.comment);
    const replyDrafts = entries.reduce<Record<string, string>>((acc, entry) => {
      acc[entry.id] = entry.replyBody ?? "";
      return acc;
    }, {});
    setCommentModal({
      stopId: stop.stopId,
      stopName: stop.clientId === -1 ? "Powrót do startu" : stop.clientName,
      entries,
      draftBody: "",
      editingId: null,
      editingBody: "",
      error: null,
      replyDrafts,
      status: null,
    });
  };

  const closeCommentModal = () => setCommentModal(defaultCommentModalState);

  const flushRouteSync = useCallback(async () => {
    if (isSyncingRouteRef.current || !pendingRouteSyncRef.current) {
      return;
    }
    if (!selectedRouteId || !token) {
      pendingRouteSyncRef.current = null;
      return;
    }
    const { stops, statusMessage } = pendingRouteSyncRef.current;
    pendingRouteSyncRef.current = null;
    isSyncingRouteRef.current = true;
    try {
      const payload = {
        owner_id: Number(effectiveSalesmanId || selectedSalesman || currentUser?.id),
        date: routeDate,
        shared_with_manager: true,
        stops: convertStopsToPayload(stops, {
          startCoords,
          startingPoint,
        }),
      };
      const response = await fetch(`${API_BASE_URL}/api/routes/${selectedRouteId}/`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error("Nie udało się zapisać zmian trasy.");
      }
      if (statusMessage) {
        setCommentModal((prev) => (prev ? { ...prev, status: statusMessage } : prev));
      }
    } catch (error) {
      setRouteActionError(error instanceof Error ? error.message : "Błąd zapisu komentarza.");
    } finally {
      isSyncingRouteRef.current = false;
      if (pendingRouteSyncRef.current) {
        flushRouteSync();
      }
    }
  }, [
    selectedRouteId,
    token,
    effectiveSalesmanId,
    selectedSalesman,
    currentUser?.id,
    routeDate,
    startCoords,
    startingPoint,
  ]);

  const enqueueRouteSync = useCallback(
    (stopsSnapshot: RouteStop[], statusMessage?: string) => {
      if (!selectedRouteId || !token) {
        if (statusMessage) {
          setCommentModal((prev) => (prev ? { ...prev, status: statusMessage } : prev));
        }
        return;
      }
      const snapshotCopy = stopsSnapshot.map((stop) => ({ ...stop }));
      pendingRouteSyncRef.current = { stops: snapshotCopy, statusMessage };
      flushRouteSync();
    },
    [flushRouteSync, selectedRouteId, token],
  );

  const persistCommentEntries = (
    stopId: string,
    entries: StopCommentEntry[],
    statusMessage?: string,
  ) => {
    updateRouteStop(stopId, { comment: encodeStopComments(entries) }, {
      afterUpdate: (nextStops) => {
        if (selectedRouteId) {
          enqueueRouteSync(nextStops, statusMessage);
        } else if (statusMessage) {
          setCommentModal((prev) => (prev ? { ...prev, status: statusMessage } : prev));
        }
      },
    });
  };

  const cancelEditingComment = () => {
    setCommentModal((prev) => ({ ...prev, editingId: null, editingBody: "" }));
  };

  const saveEditingComment = () => {
    if (!commentModal.stopId || !commentModal.editingId) {
      return;
    }
    const body = commentModal.editingBody.trim();
    if (!body) {
      setCommentModal((prev) => ({ ...prev, error: "Treść komentarza nie może być pusta." }));
      return;
    }
    const nextEntries = commentModal.entries.map((entry) =>
      entry.id === commentModal.editingId ? { ...entry, body } : entry,
    );
    setCommentModal((prev) => ({
      ...prev,
      entries: nextEntries,
      editingId: null,
      editingBody: "",
      error: null,
    }));
    persistCommentEntries(commentModal.stopId, nextEntries, "Komentarz zaktualizowany");
  };

  const startEditingComment = (entry: StopCommentEntry) => {
    if (!canEditComment(entry)) {
      return;
    }
    setCommentModal((prev) => ({
      ...prev,
      editingId: entry.id,
      editingBody: entry.body,
      error: null,
    }));
  };

  const handleAddCommentEntry = () => {
    if (!commentModal.stopId) {
      return;
    }
    const body = commentModal.draftBody.trim();
    if (!body) {
      setCommentModal((prev) => ({ ...prev, error: "Treść komentarza nie może być pusta." }));
      return;
    }
    const newEntry: StopCommentEntry = {
      id: crypto.randomUUID(),
      authorId: currentUser?.id ?? null,
      authorName: formatUserName(currentUser),
      authorRole: currentUser?.role ?? null,
      body,
      createdAt: new Date().toISOString(),
    };
    const nextEntries = [...commentModal.entries, newEntry];
    setCommentModal((prev) => ({
      ...prev,
      entries: nextEntries,
      draftBody: "",
      replyDrafts: { ...prev.replyDrafts, [newEntry.id]: "" },
      error: null,
    }));
    persistCommentEntries(commentModal.stopId, nextEntries, "Komentarz zapisany");
  };

  const handleDraftBodyChange = (value: string) => {
    setCommentModal((prev) => ({ ...prev, draftBody: value, error: null }));
  };

  const handleEditingBodyChange = (value: string) => {
    setCommentModal((prev) => ({ ...prev, editingBody: value, error: null }));
  };

  const handleDeleteCommentEntry = (entry: StopCommentEntry) => {
    if (!commentModal.stopId || !canEditComment(entry)) {
      return;
    }
    const nextEntries = commentModal.entries.filter((item) => item.id !== entry.id);
    setCommentModal((prev) => {
      const nextState: CommentModalState = {
        ...prev,
        entries: nextEntries,
        error: null,
        replyDrafts: Object.fromEntries(
          Object.entries(prev.replyDrafts).filter(([key]) => key !== entry.id),
        ),
      };
      if (prev.editingId === entry.id) {
        nextState.editingId = null;
        nextState.editingBody = "";
      }
      return nextState;
    });
    persistCommentEntries(commentModal.stopId, nextEntries);
  };

  const handleReplyDraftChange = (entryId: string, value: string) => {
    setCommentModal((prev) => ({
      ...prev,
      replyDrafts: { ...prev.replyDrafts, [entryId]: value },
      error: null,
    }));
  };

  const handleSaveReply = (entry: StopCommentEntry) => {
    if (!commentModal.stopId || !currentUser || !canEditReply(entry)) {
      return;
    }
    const draft = (commentModal.replyDrafts[entry.id] ?? "").trim();
    if (!draft) {
      setCommentModal((prev) => ({ ...prev, error: "Treść odpowiedzi nie może być pusta." }));
      return;
    }
    const timestamp = new Date().toISOString();
    const nextEntries = commentModal.entries.map((item) =>
      item.id === entry.id
        ? {
            ...item,
            replyBody: draft,
            replyAuthorId: currentUser.id,
            replyAuthorName: formatUserName(currentUser),
            replyCreatedAt: timestamp,
          }
        : item,
    );
    setCommentModal((prev) => ({
      ...prev,
      entries: nextEntries,
      replyDrafts: { ...prev.replyDrafts, [entry.id]: draft },
      error: null,
    }));
    persistCommentEntries(commentModal.stopId, nextEntries, "Odpowiedź zapisana");
  };

  const removeRouteStop = (stopId: string) => {
    updateStops((prev) => prev.filter((stop) => stop.stopId !== stopId), { recalc: true });
  };

  const moveRouteStop = (stopId: string, direction: "up" | "down") => {
    updateStops((prev) => {
      const index = prev.findIndex((stop) => stop.stopId === stopId);
      if (index === -1) {
        return prev;
      }
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      next.splice(targetIndex, 0, removed);
      return next;
    }, { recalc: true });
  };

  const reorderStops = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) {
      return;
    }
    updateStops((prev) => {
      const next = [...prev];
      const sourceIndex = next.findIndex((stop) => stop.stopId === sourceId);
      if (sourceIndex === -1) {
        return prev;
      }
      const [removed] = next.splice(sourceIndex, 1);
      const targetIndex = next.findIndex((stop) => stop.stopId === targetId);
      if (targetIndex === -1) {
        next.splice(sourceIndex, 0, removed);
        return prev;
      }
      next.splice(targetIndex, 0, removed);
      return next;
    }, { recalc: true });
  }, [updateStops]);

  const handleDragStart = (event: DragEvent<HTMLDivElement>, stopId: string) => {
    setDraggingStopId(stopId);
    event.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, targetStopId: string) => {
    event.preventDefault();
    if (draggingStopId) {
      reorderStops(draggingStopId, targetStopId);
    }
    setDraggingStopId(null);
  };

  const handleDragEnd = () => {
    setDraggingStopId(null);
  };


  const totalDrive = routeStops.reduce((sum, stop) => sum + Number(stop.driveMinutes || 0), 0);
  const totalVisit = routeStops.reduce((sum, stop) => sum + Number(stop.visitMinutes || 0), 0);
  const estimatedEndTime = useMemo(() => estimateEndTime(routeStartTime, totalDrive + totalVisit), [routeStartTime, totalDrive, totalVisit]);

  const formatMinutes = (minutes: number) => {
    if (minutes <= 0) {
      return "0 min";
    }
    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;
    if (!hours) {
      return `${remaining} min`;
    }
    if (!remaining) {
      return `${hours}h`;
    }
    return `${hours}h ${remaining} min`;
  };

  const normalizeContactValue = (value?: string) =>
    value && value.toLowerCase() !== "brak danych" ? value : "";

  const calculateZoomFromDelta = (delta: number) => {
    const safeDelta = Math.max(delta, 0.005);
    if (safeDelta < 0.01) {
      return 13;
    }
    if (safeDelta < 0.05) {
      return 12;
    }
    if (safeDelta < 0.1) {
      return 11;
    }
    if (safeDelta < 0.25) {
      return 10;
    }
    if (safeDelta < 0.5) {
      return 9;
    }
    if (safeDelta < 1) {
      return 8;
    }
    if (safeDelta < 2) {
      return 7;
    }
    if (safeDelta < 4) {
      return 6;
    }
    return 5;
  };

  const selectedSalesmanName = useMemo(() => {
    const salesmanId = effectiveSalesmanId || selectedSalesman;
    if (!salesmanId) {
      return "";
    }
    const match = salesmen.find((rep) => String(rep.id) === String(salesmanId));
    if (!match) {
      return "";
    }
    return formatSalesRepName(match);
  }, [salesmen, selectedSalesman, effectiveSalesmanId]);
  const visitClientDetails = useMemo(() => {
    if (!visitForm.client) {
      return null;
    }
    return clients.find((client) => String(client.id) === visitForm.client) ?? null;
  }, [clients, visitForm.client]);

  const buildRouteSummary = () => {
    const header = [
      routeDate ? `Data: ${new Date(routeDate).toLocaleDateString("pl-PL")}` : null,
      routeStartTime ? `Start: ${routeStartTime}` : null,
      estimatedEndTime ? `Koniec: ${estimatedEndTime}` : null,
      selectedSalesmanName ? `Handlowiec: ${selectedSalesmanName}` : null,
      routeApprovalStatus ? `Status trasy: ${APPROVAL_LABELS[routeApprovalStatus]}` : "Status trasy: Brak informacji",
    ]
      .filter(Boolean)
      .join(" | ");
    const stopsSummary = routeStops
      .map((stop, index) => {
        const base = `${index + 1}. ${stop.clientName}${stop.address ? ` – ${stop.address}` : ""}`;
        const phone = normalizeContactValue(stop.phone);
        const email = normalizeContactValue(stop.email);
        const contactLine = [phone, email].filter(Boolean).join(" | ");
        const timing = `dojazd: ${stop.driveMinutes} min, wizyta: ${stop.visitMinutes} min`;
        const arrivalTime = computedArrivalTimes[stop.stopId];
        const arrivalLine = arrivalTime ? `Przyjazd: ${formatClockLabel(arrivalTime)}` : null;
        const commentSummary = summarizeStopComments(stop.comment);
        const persistedVisitConfirmation = stop.clientId > 0 ? latestConfirmedVisits[stop.clientId] : undefined;
        const visitConfirmation = visitConfirmations[stop.stopId] ?? persistedVisitConfirmation;
        const confirmationLine = visitConfirmation
          ? `Potwierdzenie wizyty: TAK (${new Date(visitConfirmation.confirmedAt).toLocaleString("pl-PL")}${visitConfirmation.locationName ? `, ${visitConfirmation.locationName}` : ""})`
          : "Potwierdzenie wizyty: NIE";
        let block = [base, contactLine, timing, arrivalLine].filter(Boolean).join("\n   ");
        block += `\n   ${confirmationLine}`;
        if (commentSummary) {
          block += `\n\n   ${commentSummary}`;
        }
        return block;
      })
      .join("\n\n\n\n");
    return header ? `${header}\n\n${stopsSummary}` : stopsSummary;
  };

  const handleShareRouteEmail = () => {
    if (!routeStops.length) {
      return;
    }
    const summary = `Plan trasy (${routeStops.length} punktów)\n${buildRouteSummary()}`;
    const mapsUrl = googleMapsUrl;
    const fullBody = mapsUrl ? `${summary}\n\nMapa Google: ${mapsUrl}` : summary;
    const subject = encodeURIComponent(`Plan trasy (${new Date().toLocaleDateString("pl-PL")})`);
    const body = encodeURIComponent(fullBody);
    const mailtoUrl = `mailto:?subject=${subject}&body=${body}`;
    if (typeof window !== "undefined") {
      window.location.href = mailtoUrl;
    }
  };

  const handleShareRoutePhone = async () => {
    if (!routeStops.length) {
      return;
    }

    const mapsUrl = googleMapsUrl;
    const text = mapsUrl
      ? `Plan trasy (${routeStops.length} punktów)\n\nMapa Google: ${mapsUrl}`
      : `Plan trasy (${routeStops.length} punktów)\n${buildRouteSummary()}`;

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: `Plan trasy (${new Date().toLocaleDateString("pl-PL")})`,
          text,
          url: mapsUrl ?? undefined,
        });
        return;
      } catch (error) {
        console.warn("Nie udało się udostępnić przez Web Share", error);
      }
    }

    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(mapsUrl ?? text);
        alert(
          mapsUrl
            ? "Skopiowano link Google Maps. Wklej go w SMS/WhatsApp/Messenger i wyślij na telefon."
            : "Skopiowano plan trasy. Wklej go w wiadomości i wyślij na telefon.",
        );
        return;
      } catch (error) {
        console.error("Clipboard copy failed", error);
      }
    }

    alert("Udostępnianie nie jest wspierane w tej przeglądarce.");
  };

  const handlePrintRoute = () => {
    if (!routeStops.length || typeof window === "undefined") {
      return;
    }
    const summary = buildRouteSummary().replace(/\n/g, "<br />");
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(`
        <html>
          <head>
            <title>Plan trasy</title>
            <style>
              body { font-family: sans-serif; padding: 24px; }
              h1 { font-size: 20px; margin-bottom: 16px; }
              p { margin: 8px 0; }
            </style>
          </head>
          <body>
            <h1>Plan trasy (${new Date().toLocaleDateString("pl-PL")})</h1>
            <p>${summary}</p>
            <script>window.print();</script>
          </body>
        </html>
      `);
      w.document.close();
    }
  };

  const handleMarkerClick = (clientId: number) => {
    const client = clients.find((item) => item.id === clientId);
    if (client) {
      addClientToRoute(client);
      hideTooltipForClient(clientId);
    }
  };

  const handleMapMove = (event: ViewStateChangeEvent) => {
    setMapViewState(event.viewState);
  };

  if (!token) {
    return null;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto w-full max-w-6xl space-y-8">
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
          <p className="text-xs uppercase tracking-[0.35em] text-blue-500">Planowanie tras</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Planowanie tras na mapie</h1>
          <p className="text-sm text-slate-600">
            Wyszukuj klientów, dodawaj ich do dziennej trasy, szacuj czasy jazdy i wizyt oraz udostępniaj plan.
          </p>
        </header>

        <div className="xl:flex xl:items-start xl:gap-10">
          <aside className="sticky top-28 hidden xl:block w-48 space-y-3 rounded-3xl border border-slate-200 bg-white/95 px-4 py-4 text-xs shadow-2xl shadow-slate-300">
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Podsumowanie</p>
              <div className="mt-2 space-y-1 text-[11px] font-semibold text-slate-700">
                <p>Punkty: {routeStops.length}</p>
                <p>Przejazd: {formatMinutes(totalDrive)}</p>
                <p>Wizyty: {formatMinutes(totalVisit)}</p>
                <p>Łącznie: {formatMinutes(totalDrive + totalVisit)}</p>
                <p>Start: {routeStartTime || "--:--"}</p>
                <p>Koniec: {estimatedEndTime ?? "--:--"}</p>
              </div>
            </div>
            <div className="space-y-2 border-t border-slate-100 pt-3">
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Akcje trasy</p>
              <button
                type="button"
                onClick={() => handleSaveRoute("new")}
                disabled={!routeStops.length || isSavingRoute}
                className="inline-flex w-full items-center justify-center rounded-2xl border border-blue-200 px-3 py-2 text-[11px] font-semibold text-blue-700 shadow-sm transition hover:border-blue-500 hover:text-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Zapisz jako nową
              </button>
              <button
                type="button"
                onClick={() => handleSaveRoute("update")}
                disabled={!selectedRouteId || isSavingRoute}
                className="inline-flex w-full items-center justify-center rounded-2xl border border-indigo-200 px-3 py-2 text-[11px] font-semibold text-indigo-700 shadow-sm transition hover:border-indigo-500 hover:text-indigo-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Nadpisz wybraną
              </button>
              <button
                type="button"
                onClick={handleResetRoute}
                className="inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 px-3 py-2 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:border-blue-500 hover:text-blue-700"
              >
                Wyczyść trasę
              </button>
              <button
                type="button"
                onClick={handleShareGoogleMaps}
                disabled={!googleMapsUrl}
                className="inline-flex w-full items-center justify-center rounded-2xl border border-teal-200 px-3 py-2 text-[11px] font-semibold text-teal-700 shadow-sm transition hover:border-teal-500 hover:text-teal-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Otwórz w Google Maps
              </button>
            </div>
          </aside>

          <section className="flex-1 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-5">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Twoja trasa</h2>
                <p className="text-sm text-slate-500">Buduj trasę z mapy lub listy klientów, a następnie edytuj punkty.</p>
              </div>
              <div className="stats-scroll flex gap-2 overflow-x-auto text-xs font-semibold [scrollbar-width:none] [-ms-overflow-style:none]">
                <style jsx>{`
                  .stats-scroll::-webkit-scrollbar { display: none; }
                `}</style>
                <div className="rounded-full border border-blue-200/70 bg-blue-50/80 px-4 py-1 text-blue-700 shadow-sm shadow-blue-100">
                  Punkty: {routeStops.length}
                </div>
                <div className="rounded-full border border-indigo-200/70 bg-indigo-50/80 px-4 py-1 text-indigo-700 shadow-sm shadow-indigo-100">
                  Przejazd: {formatMinutes(totalDrive)}
                </div>
                <div className="rounded-full border border-violet-200/70 bg-violet-50/80 px-4 py-1 text-violet-700 shadow-sm shadow-violet-100">
                  Wizyty: {formatMinutes(totalVisit)}
                </div>
                <div className="rounded-full border border-purple-200/70 bg-purple-50/80 px-4 py-1 text-purple-700 shadow-sm shadow-purple-100">
                  Łącznie: {formatMinutes(totalDrive + totalVisit)}
                </div>
                <div className="rounded-full border border-emerald-200/70 bg-emerald-50/80 px-4 py-1 text-emerald-700 shadow-sm shadow-emerald-100">
                  Start: {routeStartTime || "--:--"}
                </div>
                <div className="rounded-full border border-teal-200/70 bg-teal-50/80 px-4 py-1 text-teal-700 shadow-sm shadow-teal-100">
                  Koniec: {estimatedEndTime ?? "--:--"}
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-6 lg:flex-row">
            <div className="flex flex-1 flex-wrap gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
              <label className="flex flex-col text-[10px] uppercase tracking-[0.35em] text-blue-800">
                <span className="text-[11px] font-semibold tracking-[0.25em] text-blue-600">Handlowiec</span>
                {isSalesRep ? (
                  <div className="mt-2 min-w-[200px] rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2 text-sm font-semibold text-slate-700 shadow-inner">
                    {selectedSalesmanName || formatUserName(currentUser)}
                  </div>
                ) : (
                  <select
                    value={selectedSalesman}
                    onChange={(event) => setSelectedSalesman(event.target.value)}
                    className="mt-2 min-w-[200px] rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-inner focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    disabled={isLoadingSalesmen}
                  >
                    {!selectedSalesman && <option value="">Wybierz…</option>}
                    {salesmen.map((rep) => (
                      <option value={rep.id} key={rep.id}>
                        {formatSalesRepName(rep)}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <label className="flex flex-col text-[10px] uppercase tracking-[0.35em] text-emerald-800">
                <span className="text-[11px] font-semibold tracking-[0.25em] text-emerald-600">Data trasy</span>
                <input
                  type="date"
                  value={routeDate}
                  onChange={(event) => setRouteDate(event.target.value)}
                  className="mt-2 min-w-[180px] rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-inner focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                />
              </label>
              <label className="flex flex-col text-xs uppercase tracking-[0.35em] text-slate-500">
                Godzina startu
                <input
                  type="time"
                  value={routeStartTime}
                  onChange={(event) => setRouteStartTime(event.target.value)}
                  className="mt-1 rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="flex w-full flex-col text-xs uppercase tracking-[0.35em] text-slate-500">
                Punkt startowy
                <input
                  type="text"
                  value={startingPoint}
                  onChange={(event) => setStartingPoint(event.target.value)}
                  placeholder="Np. ul. Annopol 4, 03-236 Warszawa"
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
                <span className="mt-1 block min-h-[18px] text-[11px] text-slate-500" aria-live="polite">
                  {isGeocodingStart && !startGeocodeError && "Wyszukuję lokalizację punktu startu…"}
                  {startGeocodeError && <span className="text-red-500">{startGeocodeError}</span>}
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
                <label className="flex items-center gap-2 font-semibold uppercase tracking-[0.3em]">
                  <input
                    type="checkbox"
                    checked={includeStartInPlan}
                    onChange={(event) => setIncludeStartInPlan(event.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  Uwzględniaj punkt startowy
                </label>
                <div className="flex flex-wrap items-center gap-2 text-slate-500">
                  <span>
                    Koordynaty: {startCoords.latitude.toFixed(5)}, {startCoords.longitude.toFixed(5)}
                  </span>
                  <button
                    type="button"
                    onClick={handleResetStartCoords}
                    className="text-xs font-semibold text-blue-600 hover:underline"
                  >
                    Przywróć domyślne
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-1 flex-col gap-4 rounded-2xl border border-violet-100 bg-white/70 p-4">
              <label className="flex flex-col text-[10px] uppercase tracking-[0.35em] text-violet-800">
                <span className="text-[11px] font-semibold tracking-[0.25em] text-violet-600">Zapisane trasy</span>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <input
                    type="date"
                    value={savedRoutesDate}
                    onChange={(event) => {
                      setSavedRoutesDate(event.target.value);
                      setSelectedRouteId(null);
                      setRouteSelection("");
                    }}
                    className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-inner focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
                  />
                  <select
                    value={routeSelection}
                    onChange={handleRouteSelectionChange}
                    className="w-56 rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-inner focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
                    disabled={isLoadingRoutes || !savedRoutes.length}
                  >
                    <option value="">{isLoadingRoutes ? "Ładuję…" : "Wybierz trasę"}</option>
                    {savedRoutes.map((route) => (
                      <option key={route.id} value={route.id}>
                        {route.date} • {route.owner_name}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleLoadSelectedRoute}
                      disabled={!selectedRouteId}
                      className="inline-flex h-9 items-center justify-center rounded-2xl border border-violet-200 px-4 text-xs font-semibold text-violet-700 shadow-sm transition hover:border-violet-500 hover:text-violet-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Wczytaj
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteRoute}
                      disabled={!selectedRouteId || isSavingRoute}
                      className="inline-flex h-9 items-center justify-center rounded-2xl border border-red-200 px-4 text-xs font-semibold text-red-600 shadow-sm transition hover:border-red-400 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Usuń
                    </button>
                  </div>
                </div>
              </label>

              <div className="rounded-3xl border border-fuchsia-100 bg-gradient-to-r from-fuchsia-50 via-rose-50 to-amber-50 px-4 py-5 text-right shadow-sm">
                <div className="text-center">
                  <p className="text-xs uppercase tracking-[0.45em] text-fuchsia-600">Akcje trasy</p>
                  {selectedRoute && (
                    <div className="mt-2 flex flex-col items-center gap-2 text-xs">
                      <span
                        className={`inline-flex items-center rounded-full border px-3 py-0.5 text-[11px] font-semibold ${routeApprovalStatus ? APPROVAL_BADGE_STYLES[routeApprovalStatus] : "border-slate-200 bg-white text-slate-600"}`}
                      >
                        {routeApprovalStatus ? APPROVAL_LABELS[routeApprovalStatus] : "Brak statusu"}
                      </span>
                      {selectedRoute.approved_by_name && routeApprovalStatus === "approved" && (
                        <span className="text-[10px] text-slate-500">Zatwierdził: {selectedRoute.approved_by_name}</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleSaveRoute("new")}
                    disabled={!routeStops.length || isSavingRoute}
                    className="inline-flex h-10 min-w-[120px] items-center justify-center rounded-2xl border border-blue-200 bg-white px-3 py-2 text-[11px] font-semibold text-blue-700 shadow-sm transition hover:border-blue-500 hover:text-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Zapisz jako nową
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveRoute("update")}
                    disabled={!selectedRouteId || isSavingRoute}
                    className="inline-flex h-10 min-w-[120px] items-center justify-center rounded-2xl border border-indigo-200 bg-white px-3 py-2 text-[11px] font-semibold text-indigo-700 shadow-sm transition hover:border-indigo-500 hover:text-indigo-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Nadpisz wybraną
                  </button>
                  <button
                    type="button"
                    onClick={handleResetRoute}
                    className="inline-flex h-10 min-w-[120px] items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:border-blue-500 hover:text-blue-700"
                  >
                    Wyczyść trasę
                  </button>
                  <button
                    type="button"
                    onClick={handleShareGoogleMaps}
                    disabled={!googleMapsUrl}
                    className="inline-flex h-10 min-w-[120px] items-center justify-center rounded-2xl border border-teal-200 bg-white px-3 py-2 text-[11px] font-semibold text-teal-700 shadow-sm transition hover:border-teal-500 hover:text-teal-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Otwórz w Google Maps
                  </button>
                  {canManageApprovals && selectedRouteId && (
                    <button
                      type="button"
                      onClick={() => handleApprovalAction("approve")}
                      disabled={isUpdatingApproval || routeApprovalStatus === "approved"}
                      className="inline-flex h-10 min-w-[160px] items-center justify-center rounded-2xl bg-gradient-to-r from-fuchsia-500 via-red-500 to-amber-400 px-5 text-xs font-semibold text-white shadow transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isUpdatingApproval ? "Potwierdzanie…" : "Potwierdź trasę"}
                    </button>
                  )}
                </div>
              </div>

              {routeActionStatus && (
                <div className="text-center text-xs text-green-700">{routeActionStatus}</div>
              )}
              {routeActionError && (
                <div className="rounded-2xl bg-red-50 px-4 py-2 text-center text-xs text-red-600">{routeActionError}</div>
              )}
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Mapa klientów</p>
                    <span className="text-xs text-slate-500">Kliknij pinezkę, aby dodać klienta do trasy</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-600">
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                      Kategorie: {classificationOptions.length}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                      Widoczni klienci: {filteredClients.length}
                    </span>
                  </div>
                </div>
                <div className="mt-3 h-[520px] overflow-hidden rounded-2xl border border-slate-200 bg-white lg:h-[620px]">
                  {MAPBOX_TOKEN ? (
                    <MapboxMap
                      mapboxAccessToken={MAPBOX_TOKEN}
                      mapStyle="mapbox://styles/mapbox/streets-v11"
                      reuseMaps
                      style={{ width: "100%", height: "100%" }}
                      {...mapViewState}
                      onMove={handleMapMove}
                    >
                      <NavigationControl position="top-right" />
                      {displayRouteLine && (
                        <Source id="route-line" type="geojson" data={displayRouteLine}>
                          <Layer
                            id="route-line-layer"
                            type="line"
                            paint={{
                              "line-color": "#2563eb",
                              "line-width": 4,
                              "line-opacity": 0.8,
                            }}
                          />
                        </Source>
                      )}
                      {selectedRouteMarkers.map((stop) => (
                        <Marker
                          latitude={stop.latitude as number}
                          longitude={stop.longitude as number}
                          key={`route-${stop.stopId}`}
                          anchor="center"
                          style={{ pointerEvents: "none" }}
                        >
                          <div className="flex flex-col items-center gap-1 pointer-events-none">
                            <span className="rounded-full bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white shadow-lg">
                              {stop.order}
                            </span>
                          </div>
                        </Marker>
                      ))}
                      {mapPins.map((pin) => (
                        <Marker latitude={pin.latitude} longitude={pin.longitude} key={pin.id} anchor="bottom">
                          <div className="group relative flex flex-col items-center">
                            <button
                              type="button"
                              onClick={() => handleMarkerClick(pin.id)}
                              className="h-3 w-3 rounded-full border-2 border-white bg-blue-600 shadow ring-2 ring-blue-200 transition hover:bg-blue-500"
                              aria-label={`Dodaj ${pin.name} do trasy`}
                            />
                            {!hiddenTooltipIds.has(pin.id) && (
                              <div className="pointer-events-none absolute top-5 hidden min-w-[180px] rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-[10px] text-slate-700 shadow-lg backdrop-blur group-hover:flex group-hover:flex-col">
                                <span className="font-semibold text-slate-900">{pin.name}</span>
                                <span className="text-[10px] text-slate-500">{formatAddress(pin)}</span>
                                <span className="text-[10px] text-blue-600">{pin.classificationLabel}</span>
                              </div>
                            )}
                          </div>
                        </Marker>
                      ))}
                      <Marker
                        latitude={startCoords.latitude}
                        longitude={startCoords.longitude}
                        draggable
                        onDragEnd={handleStartMarkerDragEnd}
                      >
                        <div className="rounded-full border-2 border-white bg-green-600 px-2 py-1 text-[10px] font-semibold text-white shadow-lg">
                          START
                        </div>
                      </Marker>
                    </MapboxMap>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-500">
                      Ustaw zmienną NEXT_PUBLIC_MAPBOX_TOKEN, aby wyświetlić mapę.
                    </div>
                  )}
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={handleAddReturnToStart}
                    disabled={routeStops.length === 0}
                    className="rounded-2xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Dodaj powrót do startu
                  </button>
                </div>
                {isRouting && (
                  <p className="mt-2 text-xs text-blue-600">Wyznaczam trasę po drogach...</p>
                )}
                {routingError && (
                  <p className="mt-2 text-xs text-red-500">{routingError}</p>
                )}
                {loading && <p className="mt-3 text-xs text-slate-500">Ładuję lokalizacje klientów…</p>}
                {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
              </div>

              <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Trasa dzienna</p>
                    <p className="text-xs text-slate-500">
                      Zmieniaj kolejność, edytuj czasy i zapisuj notatki dla każdego punktu.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleShareRouteEmail}
                      disabled={!routeStops.length}
                      className="rounded-2xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Udostępnij e-mailem
                    </button>
                    <button
                      type="button"
                      onClick={handleShareRoutePhone}
                      disabled={!routeStops.length}
                      className="rounded-2xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Udostępnij na telefon
                    </button>
                    <button
                      type="button"
                      onClick={handlePrintRoute}
                      disabled={!routeStops.length}
                      className="rounded-2xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-200"
                    >
                      Drukuj
                    </button>
                  </div>
                </div>

                {routeStops.length === 0 && (
                  <p className="rounded-2xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
                    Dodaj pierwszego klienta z mapy lub listy, aby rozpocząć planowanie.
                  </p>
                )}

                <div className="space-y-3">
                  <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Punkt startu</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{startingPoint}</p>
                    <p className="text-xs text-slate-500">
                      {startCoords.latitude.toFixed(5)}, {startCoords.longitude.toFixed(5)}
                    </p>
                  </div>

                  {routeStops.map((stop, index, array) => {
                    const commentEntries = parseStopComments(stop.comment);
                    const commentCount = commentEntries.length;
                    const persistedVisitConfirmation =
                      stop.clientId > 0 ? latestConfirmedVisits[stop.clientId] : undefined;
                    const visitConfirmation = visitConfirmations[stop.stopId] ?? persistedVisitConfirmation;
                    const isVisitConfirmed = Boolean(visitConfirmation);
                    const confirmationLocked = routeApprovalStatus !== "approved";
                    const confirmButtonDisabled = isVisitConfirmed || confirmationLocked;
                    const confirmButtonLabel = isVisitConfirmed
                      ? "Wizyta potwierdzona"
                      : confirmationLocked
                        ? "Czeka na akceptację"
                        : "Potwierdź wizytę";
                    const latestStopVisit = persistedVisitConfirmation?.plannedAt;
                    const arrivalLabel = computedArrivalTimes[stop.stopId];
                    return (
                      <div
                        key={stop.stopId}
                        className="space-y-3 rounded-2xl border border-slate-100 bg-white p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            {stop.clientId === -1 ? (
                              <>
                                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{index + 1}. Powrót do startu</p>
                                <p className="mt-1 text-sm font-semibold text-slate-900">{stop.address ?? startingPoint}</p>
                                {stop.latitude !== null && stop.longitude !== null && (
                                  <p className="text-xs text-slate-500">
                                    {stop.latitude.toFixed(5)}, {stop.longitude.toFixed(5)}
                                  </p>
                                )}
                              </>
                            ) : (
                              <>
                                <p className="text-sm font-semibold text-slate-900">
                                  {index + 1}. {stop.clientName}
                                </p>
                                <p className="text-xs text-slate-500">
                                  {formatAddress({ street: stop.address, city: stop.city })}
                                </p>
                                <p className="text-xs text-slate-400">
                                  {stop.phone} • {stop.email}
                                </p>
                                {arrivalLabel && (
                                  <p className="text-xs font-semibold text-indigo-600">
                                    Przyjazd: {formatClockLabel(arrivalLabel)}
                                  </p>
                                )}
                                {latestStopVisit ? (
                                  <p className="text-xs text-blue-600">Ostatnia potwierdzona wizyta: {formatVisitDateTime(latestStopVisit)}</p>
                                ) : (
                                  <p className="text-xs text-slate-400">Brak wizyt</p>
                                )}
                              </>
                            )}
                          </div>
                          <div className="flex gap-2 text-xs">
                            <button
                              type="button"
                              onClick={() => moveRouteStop(stop.stopId, "up")}
                              disabled={index === 0}
                              className="rounded-full border border-slate-200 px-2 py-1 text-slate-600 transition hover:border-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => moveRouteStop(stop.stopId, "down")}
                              disabled={index === array.length - 1}
                              className="rounded-full border border-slate-200 px-2 py-1 text-slate-600 transition hover:border-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => removeRouteStop(stop.stopId)}
                              className="rounded-full border border-red-200 px-2 py-1 text-red-500 transition hover:border-red-400"
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="flex flex-col"
                            htmlFor={`drive-${stop.stopId}`}
                          >
                            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Dojazd (minuty)</span>
                            <input
                              id={`drive-${stop.stopId}`}
                              type="number"
                              min={0}
                              value={stop.driveMinutes ?? 0}
                              onChange={(event) =>
                                updateRouteStop(stop.stopId, { driveMinutes: Number(event.target.value) }, { recalc: true })
                              }
                              className="mt-1 rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                            />
                          </label>
                          <label className="flex flex-col" htmlFor={`visit-${stop.stopId}`}>
                            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Wizyta (minuty)</span>
                            <input
                              id={`visit-${stop.stopId}`}
                              type="number"
                              min={0}
                              value={stop.visitMinutes ?? 0}
                              onChange={(event) =>
                                updateRouteStop(stop.stopId, { visitMinutes: Number(event.target.value) }, { recalc: true })
                              }
                              className="mt-1 rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                            />
                          </label>
                        </div>

                        {visitConfirmation && (
                          <div className="space-y-1 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-xs text-emerald-800">
                            <p className="font-semibold text-emerald-900">Wizyta potwierdzona</p>
                            <p className="text-emerald-700">
                              Potwierdzono: {new Date(visitConfirmation.confirmedAt).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                            </p>
                            {visitConfirmation.locationName && (
                              <p className="text-emerald-700">Lokalizacja: {visitConfirmation.locationName}</p>
                            )}
                            {visitConfirmation.comment && (
                              <p className="text-emerald-700">Komentarz: {visitConfirmation.comment}</p>
                            )}
                          </div>
                        )}

                        <div className="space-y-2 rounded-2xl border border-slate-100 bg-slate-50/80 p-3 text-xs">
                          <p className="font-semibold text-slate-700">Uwagi i komentarze ({commentCount})</p>
                          <div className="space-y-2">
                            {commentEntries.map((entry) => (
                              <div
                                key={entry.id}
                                className={`rounded-xl border p-2 ${
                                  entry.authorRole === "admin" || entry.authorRole === "manager"
                                    ? "border-fuchsia-200 bg-fuchsia-50"
                                    : entry.authorRole === "rep"
                                      ? "border-blue-200 bg-blue-50"
                                      : "border-slate-200 bg-white"
                                }`}
                              >
                                <p className="text-[11px] font-semibold text-slate-700">
                                  {entry.authorName || "Użytkownik"}
                                  <span className="ml-1 text-[10px] text-slate-400">
                                    {entry.authorRole ?? "brak roli"}
                                  </span>
                                </p>
                                <p className="text-[11px] text-slate-600">{entry.body}</p>
                                {entry.replyBody && (
                                  <p className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-800">
                                    Odpowiedź: {entry.replyBody}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => openCommentModal(stop)}
                            className="w-full rounded-2xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-blue-400"
                          >
                            Zarządzaj komentarzami
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                          <button
                            type="button"
                            onClick={() => openVisitModal(stop)}
                            disabled={confirmButtonDisabled}
                            className={`rounded-full border px-3 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                              isVisitConfirmed
                                ? "border-emerald-200 text-emerald-600"
                                : confirmationLocked
                                  ? "border-amber-200 text-amber-600"
                                  : "border-slate-200 text-slate-600 hover:border-blue-400"
                            }`}
                          >
                            {confirmButtonLabel}
                          </button>
                          {confirmationLocked && !isVisitConfirmed && (
                            <p className="text-[10px] text-amber-600">Wymagana akceptacja trasy</p>
                          )}
                          <button
                            type="button"
                            onClick={() => handleSetStartStop(stop.stopId)}
                            className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-blue-400"
                          >
                            Ustaw jako początek trasy
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex h-full min-h-[520px] flex-col rounded-2xl border border-slate-200 p-4">
                <label className="text-xs uppercase tracking-[0.35em] text-slate-500">Wyszukaj klienta</label>
                <input
                  type="search"
                  value={clientSearch}
                  onChange={(event) => setClientSearch(event.target.value)}
                  placeholder="Nazwa, miasto, NIP…"
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />

                <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-600">Filtruj po klasyfikacji</p>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <button
                        type="button"
                        onClick={useAllClassifications}
                        disabled={classificationOptions.length === 0}
                        aria-pressed={isAllClassificationsSelected}
                        className={`rounded-full border px-3 py-1 font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                          isAllClassificationsSelected
                            ? "translate-y-[1px] border-blue-600 bg-blue-600 text-white shadow-inner"
                            : "border-blue-200 bg-white text-blue-600 hover:border-blue-400"
                        } disabled:cursor-not-allowed disabled:opacity-40`}
                      >
                        Zaznacz wszystkie
                      </button>
                      <button
                        type="button"
                        onClick={clearClassifications}
                        disabled={classificationOptions.length === 0}
                        aria-pressed={isNoClassificationSelected}
                        className={`rounded-full border px-3 py-1 font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 ${
                          isNoClassificationSelected
                            ? "translate-y-[1px] border-slate-500 bg-slate-600 text-white shadow-inner"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"
                        } disabled:cursor-not-allowed disabled:opacity-40`}
                      >
                        Wyczyść
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {classificationOptions.length === 0 && (
                      <p className="text-xs text-slate-500">Brak danych o klasyfikacjach.</p>
                    )}
                    {classificationOptions.map((key) => {
                      const label = getClassificationLabel(key);
                      const selected = activeClassifications.has(key);
                      const count = classificationCounts.get(key) ?? 0;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => toggleClassification(key)}
                          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                            selected
                              ? "border-blue-500 bg-blue-100 text-blue-700"
                              : "border-slate-200 bg-white text-slate-600 hover:border-blue-200"
                          }`}
                        >
                          {label}
                          <span className="ml-1 text-[10px] text-slate-500">({count})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {!isSalesRep && salesmanOptions.length > 0 && (
                  <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-600">
                        Filtruj po handlowcu
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <button
                          type="button"
                          onClick={useAllSalesmen}
                          disabled={salesmanOptions.length === 0}
                          aria-pressed={isAllSalesmenSelected}
                          className={`rounded-full border px-3 py-1 font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 ${
                            isAllSalesmenSelected
                              ? "translate-y-[1px] border-emerald-600 bg-emerald-600 text-white shadow-inner"
                              : "border-emerald-200 bg-white text-emerald-600 hover:border-emerald-400"
                          } disabled:cursor-not-allowed disabled:opacity-40`}
                        >
                          Zaznacz wszystkie
                        </button>
                        <button
                          type="button"
                          onClick={clearSalesmen}
                          disabled={salesmanOptions.length === 0}
                          aria-pressed={isNoSalesmanSelected}
                          className={`rounded-full border px-3 py-1 font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 ${
                            isNoSalesmanSelected
                              ? "translate-y-[1px] border-slate-500 bg-slate-600 text-white shadow-inner"
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"
                          } disabled:cursor-not-allowed disabled:opacity-40`}
                        >
                          Wyczyść
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {salesmanOptions.map((option) => {
                        const selected = activeSalesmen.has(option.key);
                        const count = salesmanCounts.get(option.key) ?? 0;
                        return (
                          <button
                            key={option.key}
                            type="button"
                            onClick={() => toggleSalesmanFilter(option.key)}
                            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                              selected
                                ? "border-emerald-500 bg-emerald-100 text-emerald-700"
                                : "border-slate-200 bg-white text-slate-600 hover:border-emerald-200"
                            }`}
                          >
                            {option.label}
                            <span className="ml-1 text-[10px] text-slate-500">({count})</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="mt-4 flex-1 space-y-2 overflow-y-auto pr-1">
                  {filteredClients.slice(0, 10).map((client) => {
                    const latestVisit = latestConfirmedVisits[client.id];
                    return (
                      <div
                        key={client.id}
                        className="flex items-start justify-between gap-3 rounded-2xl border border-slate-100 bg-white px-3 py-2"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{client.name}</p>
                          <p className="text-xs text-slate-500">{formatAddress(client)}</p>
                          <p className="text-[11px] text-blue-600">{getClassificationLabel(getClassificationKey(client.classification))}</p>
                          {client.nip && <p className="text-xs text-slate-400">NIP: {client.nip}</p>}
                          {latestVisit ? (
                            <p className="text-[11px] text-emerald-600">
                              Ostatnia wizyta: {formatVisitDateTime(latestVisit.confirmedAt)}
                            </p>
                          ) : (
                            <p className="text-[11px] text-slate-400">Brak potwierdzonych wizyt</p>
                          )}
                        </div>
                      <button
                        type="button"
                        onClick={() => addClientToRoute(client)}
                        className="rounded-2xl bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 transition hover:bg-blue-200"
                      >
                        Dodaj do trasy
                      </button>
                      </div>
                    );
                  })}
                  {filteredClients.length === 0 && (
                    <p className="text-xs text-slate-500">Brak klientów spełniających filtr.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>

      {isVisitModalOpen && visitModalStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 px-4 py-8">
          <div className="w-full max-w-3xl rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Potwierdź wizytę</p>
                <p className="text-lg font-semibold text-slate-900">
                  {visitModalStop.clientName}
                </p>
                {visitClientDetails && (
                  <p className="text-sm text-slate-500">{formatAddress(visitClientDetails)}</p>
                )}
              </div>
              <button
                type="button"
                onClick={closeVisitModal}
                className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 transition hover:border-slate-400"
                aria-label="Zamknij okno potwierdzenia wizyty"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleVisitSubmit} className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-4">
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-800">
                Dodaj wizytę bezpośrednio z planu trasy. Lokalizacja urządzenia zostanie dołączona do zgłoszenia.
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  Termin wizyty
                  <input
                    type="datetime-local"
                    value={visitForm.plannedAt}
                    readOnly
                    className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
                  />
                </label>
                <label className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  Handlowiec
                  <input
                    type="text"
                    value={selectedSalesmanName || visitForm.salesman || ""}
                    readOnly
                    className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
                  />
                </label>
              </div>

              <label className="text-xs uppercase tracking-[0.3em] text-slate-500">
                Komentarz
                <textarea
                  rows={4}
                  value={visitForm.comment}
                  onChange={(event) => setVisitForm((prev) => ({ ...prev, comment: event.target.value }))}
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  placeholder="Np. spotkanie w sprawie oferty serwisowej..."
                />
              </label>

              <div className="space-y-2 rounded-2xl border border-slate-200 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                  <span>Lokalizacja urządzenia</span>
                  <button
                    type="button"
                    onClick={requestVisitDeviceLocation}
                    className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-blue-400"
                  >
                    Sprawdź ponownie
                  </button>
                </div>
                {visitDeviceLocation ? (
                  <p className="text-sm text-slate-700">
                    {`lat: ${visitDeviceLocation.latitude.toFixed(5)}, lon: ${visitDeviceLocation.longitude.toFixed(5)}, dokładność: ±${Math.round(visitDeviceLocation.accuracy)}m`}
                    {visitLocationCheckedAt && ` • ${visitLocationCheckedAt.toLocaleTimeString()}`}
                  </p>
                ) : (
                  <p className="text-sm text-slate-500">Brak potwierdzonej lokalizacji.</p>
                )}
                {visitLocationPlaceName && (
                  <p className="text-xs text-slate-500">Adres: {visitLocationPlaceName}</p>
                )}
                {visitLocationStatus && <p className="text-xs text-slate-500">{visitLocationStatus}</p>}
              </div>

              {visitStatus && (
                <p className="rounded-2xl bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{visitStatus}</p>
              )}
              {visitError && (
                <p className="rounded-2xl bg-red-50 px-4 py-2 text-sm text-red-600">{visitError}</p>
              )}

              <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={closeVisitModal}
                  className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-400"
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingVisit}
                  className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                  {isSubmittingVisit ? "Zapisuję…" : "Potwierdź wizytę"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isCommentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 px-4 py-8">
          <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Komentarze dla</p>
                <p className="text-lg font-semibold text-slate-900">{commentModal.stopName}</p>
              </div>
              <button
                type="button"
                onClick={closeCommentModal}
                className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 transition hover:border-slate-400"
                aria-label="Zamknij okno komentarzy"
              >
                ✕
              </button>
            </div>

            <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6 py-4">
              {commentModal.entries.length === 0 && (
                <p className="rounded-2xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
                  Brak komentarzy dla tego punktu. Dodaj pierwszy wpis poniżej.
                </p>
              )}

              {commentModal.entries.map((entry, index) => {
                const isEditing = commentModal.editingId === entry.id;
                const editable = canEditComment(entry);
                const replyDraft = commentModal.replyDrafts[entry.id] ?? entry.replyBody ?? "";
                const modalEntryClassName =
                  entry.authorRole === "admin" || entry.authorRole === "manager"
                    ? "border-pink-200 bg-pink-50"
                    : entry.authorRole === "rep"
                      ? "border-blue-200 bg-blue-50"
                      : "border-slate-100 bg-white";
                return (
                  <div
                    key={entry.id}
                    className={`space-y-2 rounded-3xl border px-4 py-3 shadow-sm ${modalEntryClassName}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">
                          {index + 1 < 10 ? `0${index + 1}` : index + 1}. {entry.authorName}
                        </p>
                        <p className="text-[11px] text-slate-400">{formatTimestamp(entry.createdAt)}</p>
                      </div>
                      {editable && (
                        <div className="flex gap-2 text-xs">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                onClick={saveEditingComment}
                                className="rounded-2xl border border-green-200 px-3 py-1 font-semibold text-green-600 hover:border-green-400"
                              >
                                Zapisz
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditingComment}
                                className="rounded-2xl border border-slate-200 px-3 py-1 font-semibold text-slate-600 hover:border-slate-400"
                              >
                                Anuluj
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => startEditingComment(entry)}
                                className="rounded-2xl border border-slate-200 px-3 py-1 font-semibold text-slate-600 hover:border-blue-400"
                              >
                                Edytuj
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteCommentEntry(entry)}
                                className="rounded-2xl border border-red-200 px-3 py-1 font-semibold text-red-500 hover:border-red-400"
                              >
                                Usuń
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {isEditing ? (
                      <textarea
                        rows={3}
                        value={commentModal.editingBody}
                        onChange={(event) => handleEditingBodyChange(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                      />
                    ) : (
                      <p className="whitespace-pre-line text-sm text-slate-700">{entry.body}</p>
                    )}

                    {entry.replyBody && (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50/90 px-3 py-2 text-sm text-amber-900">
                        <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.3em] text-amber-600">
                          <span>Odpowiedź: {entry.replyAuthorName ?? "Handlowiec"}</span>
                          <span className="text-[10px] text-amber-500">{formatTimestamp(entry.replyCreatedAt ?? "")}</span>
                        </div>
                        <p className="mt-1 whitespace-pre-line text-sm">{entry.replyBody}</p>
                      </div>
                    )}

                    {canEditReply(entry) && (
                      <div className="space-y-2 rounded-2xl border border-slate-200 bg-white px-3 py-2">
                        <label className="text-[11px] uppercase tracking-[0.3em] text-slate-500">
                          Odpowiedź handlowca
                          <textarea
                            rows={2}
                            value={replyDraft}
                            onChange={(event) => handleReplyDraftChange(entry.id, event.target.value)}
                            className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => handleSaveReply(entry)}
                          className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
                        >
                          Zapisz odpowiedź
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="border-t border-slate-100 px-6 py-4">
              {commentModal.error && (
                <p className="mb-2 text-xs text-red-500">{commentModal.error}</p>
              )}
              <label className="text-xs uppercase tracking-[0.3em] text-slate-500">
                Dodaj komentarz
                <textarea
                  rows={3}
                  value={commentModal.draftBody}
                  onChange={(event) => handleDraftBodyChange(event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </label>
              {commentModal.status && (
                <p className="mt-2 text-[11px] text-emerald-600">{commentModal.status}</p>
              )}
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="text-[11px] text-slate-500">
                  {isPrivilegedUser
                    ? "Jako manager/admin możesz edytować każdy komentarz."
                    : "Możesz edytować tylko swoje komentarze."}
                </div>
                <button
                  type="button"
                  onClick={handleAddCommentEntry}
                  disabled={isLoadingCurrentUser}
                  className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-progress disabled:bg-blue-300"
                >
                  Dodaj komentarz
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function RoutesPlannerPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
          <div className="glass-card w-full max-w-md space-y-4 p-8 text-center">
            <p className="text-sm font-semibold text-slate-900">Ładuję planer tras…</p>
          </div>
        </main>
      }
    >
      <RoutesPlannerPageInner />
    </Suspense>
  );
}

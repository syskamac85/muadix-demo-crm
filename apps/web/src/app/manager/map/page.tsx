"use client";

import "mapbox-gl/dist/mapbox-gl.css";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Map, {
  Marker,
  NavigationControl,
  ViewStateChangeEvent,
} from "react-map-gl/mapbox";
import type { MarkerDragEvent } from "@vis.gl/react-mapbox";
import type { LngLat, MapMouseEvent } from "mapbox-gl";

import { useAuthStore } from "@/store/auth-store";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

const normalizeCoordinate = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = parseFloat(value.replace(",", "."));
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

type Client = {
  id: number;
  name: string;
  nip: string;
  city: string;
  street: string;
  postal_code: string;
  salesman: { id: number; username: string } | null;
  latitude: number | null;
  longitude: number | null;
  location_name: string;
};

type ApiClient = Client & {
  id: number;
  name: string;
  nip?: string | null;
  city?: string | null;
  street?: string | null;
  postal_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  location_name?: string | null;
};

type SalesRepOption = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
};

type CurrentUser = {
  id: number;
  username: string;
  role: string;
};

const MapPin = ({ variant = "default" }: { variant?: "default" | "selected" | "draft" }) => {
  const variantClasses = {
    default: "border-white bg-slate-900 shadow-[0_0_0_4px_rgba(15,23,42,0.25)]",
    selected: "border-white bg-blue-600 shadow-[0_0_0_4px_rgba(37,99,235,0.35)]",
    draft: "border-white bg-red-600 shadow-[0_0_0_4px_rgba(220,38,38,0.35)]",
  } as const;

  return (
    <span
      className={`inline-flex h-4 w-4 -translate-y-1.5 items-center justify-center rounded-full border-2 ${variantClasses[variant]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-white" />
    </span>
  );
};

export default function MapManagerPage() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);

  const [clients, setClients] = useState<Client[]>([]);
  const [salesReps, setSalesReps] = useState<SalesRepOption[]>([]);
  const [salesmanFilter, setSalesmanFilter] = useState<string>("");
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [draftPosition, setDraftPosition] = useState<{ latitude: number; longitude: number } | null>(
    null,
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [viewState, setViewState] = useState({
    latitude: 52.2297,
    longitude: 21.0122,
    zoom: 6,
  });
  const [mapSearchQuery, setMapSearchQuery] = useState("");
  const [copiedClientId, setCopiedClientId] = useState<number | null>(null);
  const [draftAddress, setDraftAddress] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [_userLoading, setUserLoading] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (!token) {
      router.replace("/auth/login");
    }
  }, [hydrated, token, router]);

  const fetchClients = useCallback((abortSignal?: AbortSignal) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    setStatusMessage(null);
    const params = new URLSearchParams();
    if (salesmanFilter) {
      params.append("salesman", salesmanFilter);
    }

    fetch(`${API_BASE_URL}/api/clients/?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: abortSignal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Nie udało się pobrać listy klientów.");
        }
        const payload = await response.json();
        const items = Array.isArray(payload)
          ? (payload as ApiClient[])
          : ((payload.results ?? []) as ApiClient[]);
        const mapped: Client[] = items.map((item) => ({
          id: item.id,
          name: item.name,
          nip: item.nip || "",
          city: item.city || "",
          street: item.street || "",
          postal_code: item.postal_code || "",
          salesman: item.salesman
            ? { id: item.salesman.id, username: item.salesman.username }
            : null,
          latitude: normalizeCoordinate(item.latitude),
          longitude: normalizeCoordinate(item.longitude),
          location_name: item.location_name || "",
        }));
        setClients(mapped);
        const firstWithCoords = mapped.find(
          (item) => item.latitude !== null && item.longitude !== null,
        );
        if (firstWithCoords && firstWithCoords.latitude !== null && firstWithCoords.longitude !== null) {
          setViewState((prev) => ({
            ...prev,
            latitude: firstWithCoords.latitude as number,
            longitude: firstWithCoords.longitude as number,
          }));
        }
      })
      .catch((err) => {
        if (!abortSignal || !abortSignal.aborted) {
          setError(err instanceof Error ? err.message : "Nieznany błąd pobierania klientów.");
        }
      })
      .finally(() => setLoading(false));
  }, [token, salesmanFilter]);

  const handleMapSearch = async () => {
    const query = mapSearchQuery.trim();
    if (!query) {
      setStatusMessage("Wpisz adres, aby wyszukać.");
      return;
    }
    if (!MAPBOX_TOKEN) {
      setStatusMessage("Brak tokenu Mapbox – nie mogę wykonać wyszukiwania.");
      return;
    }
    setStatusMessage("Szukam…");
    try {
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
          query,
        )}.json?limit=1&language=pl&access_token=${MAPBOX_TOKEN}`,
      );
      if (!response.ok) {
        throw new Error("Nie udało się pobrać danych geolokalizacji.");
      }
      const payload = await response.json();
      const feature = payload.features?.[0];
      if (!feature) {
        throw new Error("Nie znaleziono podanego adresu.");
      }
      const [lng, lat] = feature.center;
      setViewState((prev) => ({
        ...prev,
        latitude: lat,
        longitude: lng,
        zoom: 12,
      }));
      if (selectedClient) {
        setDraftPosition({ latitude: lat, longitude: lng });
        setStatusMessage("Zaktualizowano pinezkę na podstawie wyszukania adresu.");
      }
      setStatusMessage("Zlokalizowano adres na mapie.");
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : "Wystąpił błąd podczas wyszukiwania.",
      );
    }
  };

  useEffect(() => {
    if (!token) {
      return;
    }
    const controller = new AbortController();
    fetchClients(controller.signal);
    return () => controller.abort();
  }, [token, salesmanFilter, fetchClients]);

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
          headers: {
            Authorization: `Bearer ${token}`,
          },
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
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setUserError(error instanceof Error ? error.message : "Nieznany błąd pobierania użytkownika.");
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
    if (!currentUser || currentUser.role !== "rep") {
      return;
    }
    setSalesmanFilter((prev) => {
      const repId = String(currentUser.id);
      return prev === repId ? prev : repId;
    });
  }, [currentUser]);

  useEffect(() => {
    if (!copiedClientId) {
      return;
    }
    const timeout = window.setTimeout(() => setCopiedClientId(null), 2000);
    return () => window.clearTimeout(timeout);
  }, [copiedClientId]);

  useEffect(() => {
    if (!token) {
      return;
    }
    fetch(`${API_BASE_URL}/api/accounts/sales-reps/`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Nie udało się pobrać listy handlowców.");
        }
        const payload = await response.json();
        const reps = Array.isArray(payload) ? payload : payload.results ?? [];
        setSalesReps(reps);
      })
      .catch(() => {
        setSalesReps([]);
      });
  }, [token]);

  useEffect(() => {
    if (!selectedClientId) {
      setDraftPosition(null);
      return;
    }
    const client = clients.find((item) => item.id === selectedClientId);
    if (!client) {
      setDraftPosition(null);
      return;
    }
    const latitude = client.latitude ?? 52.2297;
    const longitude = client.longitude ?? 21.0122;
    setDraftPosition({ latitude, longitude });
    if (client.latitude !== null && client.longitude !== null && client.location_name) {
      setDraftAddress(client.location_name);
    } else if (client.latitude !== null && client.longitude !== null) {
      reverseGeocode(latitude, longitude);
    } else {
      const baseAddress = [client.street, client.postal_code, client.city].filter(Boolean).join(", ");
      setDraftAddress(baseAddress || null);
    }
    setViewState((prev) => ({
      ...prev,
      latitude,
      longitude,
      zoom: client.latitude && client.longitude ? Math.max(prev.zoom, 11) : 7,
    }));
  }, [selectedClientId, clients]);
  // eslint-disable-next-line react-hooks/exhaustive-deps

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) ?? null,
    [clients, selectedClientId],
  );

  const filteredClients = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return showMissingOnly
        ? clients.filter((client) => client.latitude === null || client.longitude === null)
        : clients;
    }
    return clients.filter((client) => {
      if (showMissingOnly && client.latitude !== null && client.longitude !== null) {
        return false;
      }
      const address = `${client.street} ${client.postal_code} ${client.city}`.toLowerCase();
      return (
        client.name.toLowerCase().includes(query) ||
        address.includes(query) ||
        String(client.id).includes(query)
      );
    });
  }, [clients, searchQuery, showMissingOnly]);

  const mapClients = useMemo(
    () => clients.filter((client) => client.latitude !== null && client.longitude !== null),
    [clients],
  );

  const isSalesRep = currentUser?.role === "rep";

  const hasPendingChanges =
    selectedClient &&
    draftPosition &&
    (selectedClient.latitude !== draftPosition.latitude ||
      selectedClient.longitude !== draftPosition.longitude);

  const reverseGeocode = useCallback(
    async (latitude: number, longitude: number) => {
      if (!MAPBOX_TOKEN) {
        setDraftAddress(null);
        return;
      }
      try {
        const response = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?limit=1&language=pl&access_token=${MAPBOX_TOKEN}`,
        );
        if (!response.ok) {
          throw new Error("Nie udało się pobrać nazwy lokalizacji.");
        }
        const payload = await response.json();
        const placeName = payload.features?.[0]?.place_name ?? null;
        setDraftAddress(placeName);
      } catch (_error) {
        setDraftAddress(null);
      }
    },
    [],
  );

  const handleSelectClient = (clientId: number) => {
    setSelectedClientId(clientId);
    setStatusMessage(null);
  };

  const handleMapClick = (event: MapMouseEvent) => {
    if (!selectedClient) {
      return;
    }
    const { lng, lat } = event.lngLat;
    setDraftPosition({ latitude: lat, longitude: lng });
    reverseGeocode(lat, lng);
    setStatusMessage("Zmieniono położenie – zapisz, aby utrwalić.");
  };

  const handleMarkerDragEnd = (event: MarkerDragEvent) => {
    const { lng, lat } = event.lngLat as LngLat;
    setDraftPosition({ latitude: lat, longitude: lng });
    reverseGeocode(lat, lng);
    setStatusMessage("Zmieniono położenie – zapisz, aby utrwalić.");
  };

  const handleSave = async () => {
    if (!token || !selectedClient || !draftPosition) {
      return;
    }
    setIsSaving(true);
    setStatusMessage("Zapisuję nową geolokalizację…");
    try {
      const response = await fetch(`${API_BASE_URL}/api/clients/${selectedClient.id}/`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          latitude: draftPosition.latitude,
          longitude: draftPosition.longitude,
          location_name: draftAddress ?? "",
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? "Nie udało się zapisać geolokalizacji.");
      }
      setClients((prev) =>
        prev.map((client) =>
          client.id === selectedClient.id
            ? {
                ...client,
                latitude: draftPosition.latitude,
                longitude: draftPosition.longitude,
                location_name: draftAddress ?? client.location_name,
              }
            : client,
        ),
      );
      setStatusMessage("Geolokalizacja została zaktualizowana.");
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : "Wystąpił błąd podczas zapisu geolokalizacji.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetDraft = () => {
    if (!selectedClient) {
      setDraftPosition(null);
      setDraftAddress(null);
      setStatusMessage("Wybierz klienta, aby przywrócić zapisane położenie.");
      return;
    }

    if (selectedClient.latitude !== null && selectedClient.longitude !== null) {
      setDraftPosition({
        latitude: selectedClient.latitude,
        longitude: selectedClient.longitude,
      });
      if (selectedClient.location_name) {
        setDraftAddress(selectedClient.location_name);
      } else {
        reverseGeocode(selectedClient.latitude, selectedClient.longitude);
      }
      setStatusMessage("Przywrócono zapisane położenie.");
      return;
    }

    setDraftPosition(null);
    const baseAddress = [selectedClient.street, selectedClient.postal_code, selectedClient.city]
      .filter(Boolean)
      .join(", ");
    setDraftAddress(baseAddress || null);
    setStatusMessage("Ten klient nie posiada zapisanego położenia.");
  };

  const handleCopyAddress = async (_client: Client, address: string) => {
    if (!address) {
      setStatusMessage("Brak adresu do skopiowania.");
      return;
    }
    try {
      await navigator.clipboard.writeText(address);
      setCopiedClientId(_client.id);
      setStatusMessage(null);
    } catch (_error) {
      setStatusMessage("Nie udało się skopiować adresu.");
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
      <div className="mx-auto max-w-6xl space-y-6">
        <nav className="flex justify-between">
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-blue-500 hover:text-blue-600"
          >
            ← Wróć do dashboardu
          </Link>
          <Link
            href="/manager/import"
            className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-blue-500 hover:text-blue-600"
          >
            Przejdź do importu →
          </Link>
        </nav>

        <header className="glass-card p-6">
          <p className="text-xs uppercase tracking-[0.35em] text-blue-500">Geolokalizacje</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">
            Edycja punktów klientów na mapie
          </h1>
          <p className="text-sm text-slate-600">
            Wybierz klienta z listy, przeciągnij pinezkę w nowe miejsce lub kliknij na mapie, a
            następnie zapisz aktualizację w bazie danych.
          </p>
        </header>

        {!MAPBOX_TOKEN ? (
          <div className="rounded-3xl border border-amber-200 bg-amber-50 px-6 py-4 text-amber-800">
            Aby skorzystać z mapy, ustaw zmienną środowiskową{" "}
            <code className="font-mono text-sm">NEXT_PUBLIC_MAPBOX_TOKEN</code> z ważnym tokenem
            Mapbox (np. w pliku <code>.env.local</code>), a następnie uruchom ponownie frontend.
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
            <section className="glass-card space-y-4 p-4">
              <div>
                <label className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  Wyszukaj klienta
                </label>
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Nazwa, miasto lub ID"
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                <input
                  type="checkbox"
                  checked={showMissingOnly}
                  onChange={(event) => setShowMissingOnly(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                Pokaż tylko klientów bez koordynatów
              </label>

              <div>
                <label className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  Sales Person
                </label>
                <select
                  value={isSalesRep ? String(currentUser?.id ?? "") : salesmanFilter}
                  onChange={(event) => {
                    if (isSalesRep) {
                      return;
                    }
                    setSalesmanFilter(event.target.value);
                  }}
                  disabled={isSalesRep}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100"
                >
                  {isSalesRep ? (
                    <option value={currentUser?.id ?? ""}>
                      {currentUser?.username ?? "Twoje konto"}
                    </option>
                  ) : (
                    <>
                      <option value="">Wszyscy handlowcy</option>
                      {salesReps.map((rep) => (
                        <option key={rep.id} value={rep.id}>
                          {rep.first_name || rep.last_name
                            ? `${rep.first_name ?? ""} ${rep.last_name ?? ""}`.trim()
                            : rep.username}
                        </option>
                      ))}
                    </>
                  )}
                </select>
                {isSalesRep && (
                  <p className="mt-1 text-xs text-slate-500">
                    Lista zawiera tylko klientów przypisanych do Twojego konta.
                  </p>
                )}
                {userError && (
                  <p className="mt-1 text-xs text-red-600">{userError}</p>
                )}
              </div>

              <div className="max-h-[65vh] space-y-2 overflow-y-auto pr-1">
                {loading && <p className="text-sm text-slate-500">Ładuję listę klientów…</p>}
                {error && (
                  <p className="rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
                )}
                {!loading && !error && filteredClients.length === 0 && (
                  <p className="text-sm text-slate-500">Brak klientów dla podanego filtra.</p>
                )}
                {filteredClients.map((client) => {
                  const hasCoords = client.latitude !== null && client.longitude !== null;
                  const addressParts = [
                    client.street,
                    client.postal_code ? client.postal_code : "",
                    client.city,
                  ]
                    .filter(Boolean)
                    .join(", ");
                  const resolvedAddress = client.location_name || addressParts;
                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      key={client.id}
                      onClick={() => handleSelectClient(client.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleSelectClient(client.id);
                        }
                      }}
                      className={`w-full rounded-2xl border px-3 py-2 text-left text-sm transition ${
                        client.id === selectedClientId
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 bg-white text-slate-800 hover:border-blue-200"
                      }`}
                    >
                      <span className="block font-semibold">{client.name}</span>
                      <div className="text-xs text-slate-500">
                        {client.location_name && (
                          <p className="font-semibold text-slate-600">
                            Lokalizacja GPS: <span className="font-normal text-slate-700">{client.location_name}</span>
                          </p>
                        )}
                        <p className="mt-0.5">
                          Adres ewidencyjny: {addressParts || "Brak pełnego adresu"}
                        </p>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleCopyAddress(client, resolvedAddress);
                          }}
                          className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:border-blue-300 hover:text-blue-600"
                        >
                          Kopiuj adres
                        </button>
                        {copiedClientId === client.id && (
                          <span className="text-emerald-600">Skopiowano!</span>
                        )}
                      </div>
                      {!hasCoords && (
                        <span className="mt-1 inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
                          Brak koordynatów
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="glass-card p-4">
              <div className="relative h-[70vh] w-full overflow-hidden rounded-3xl border border-slate-200">
                <div className="absolute left-4 top-4 z-10 flex w-[min(480px,95%)] gap-2 rounded-2xl bg-white/90 p-3 shadow-lg backdrop-blur">
                  <input
                    type="text"
                    value={mapSearchQuery}
                    onChange={(event) => setMapSearchQuery(event.target.value)}
                    placeholder="Szukaj adresu na mapie…"
                    className="flex-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleMapSearch}
                    className="rounded-xl bg-blue-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-blue-500"
                  >
                    Szukaj
                  </button>
                </div>
                <Map
                  mapboxAccessToken={MAPBOX_TOKEN}
                  mapStyle="mapbox://styles/mapbox/streets-v12"
                  {...viewState}
                  onMove={(event: ViewStateChangeEvent) => setViewState(event.viewState)}
                  onClick={handleMapClick}
                  reuseMaps
                  style={{ width: "100%", height: "100%" }}
                >
                  <NavigationControl position="top-left" />
                  {mapClients.map((client) => {
                    if (client.latitude === null || client.longitude === null) {
                      return null;
                    }
                    const isSelected = client.id === selectedClientId;
                    return (
                      <Marker
                        key={client.id}
                        longitude={client.longitude}
                        latitude={client.latitude}
                        draggable={isSelected}
                        onDragEnd={handleMarkerDragEnd}
                        anchor="bottom"
                      >
                        <MapPin variant={isSelected ? "selected" : "default"} />
                        <span className="sr-only">{client.name}</span>
                      </Marker>
                    );
                  })}
                  {hasPendingChanges && draftPosition && (
                    <Marker
                      longitude={draftPosition.longitude}
                      latitude={draftPosition.latitude}
                      draggable
                      onDragEnd={handleMarkerDragEnd}
                      anchor="bottom"
                    >
                      <MapPin variant="draft" />
                      <span className="sr-only">Tymczasowa pozycja</span>
                    </Marker>
                  )}
                </Map>
                {mapClients.length === 0 && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/70 text-sm font-medium text-slate-500">
                    Brak pinezek – uzupełnij koordynaty, aby zobaczyć klientów na mapie.
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!hasPendingChanges || isSaving}
                  className="inline-flex items-center rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition enabled:hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                  {isSaving ? "Zapisuję…" : "Zapisz nowe położenie"}
                </button>
                <button
                  type="button"
                  onClick={handleResetDraft}
                  disabled={!selectedClient}
                  className="inline-flex items-center rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition enabled:hover:border-blue-300 enabled:hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cofnij zmiany
                </button>
                {statusMessage && (
                  <p className="text-sm text-slate-600">{statusMessage}</p>
                )}
              </div>

              {!selectedClient && (
                <p className="mt-4 text-sm text-slate-500">
                  Wybierz klienta po lewej, aby aktywować edycję pinezki.
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

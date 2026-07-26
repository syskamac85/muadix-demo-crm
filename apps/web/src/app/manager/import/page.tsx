"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuthStore } from "@/store/auth-store";
import { authorizedFetch } from "@/lib/auth-fetch";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";
const WS_BASE_URL =
  process.env.NEXT_PUBLIC_WS_URL?.replace(/\/$/, "") ??
  API_BASE_URL.replace(/^http/, (match) => (match === "https" ? "wss" : "ws"));

type NewClientForm = {
  name: string;
  nip: string;
  city: string;
  postal_code: string;
  street: string;
  classification: string;
  phone: string;
  email: string;
  contact_days_label: string;
};

type ClientStatus = "active" | "deleted";

type ClientDirectoryEntry = {
  id: number;
  name: string;
  nip: string;
  city: string;
  postal_code: string;
  street: string;
  classification: string;
  phone: string;
  email: string;
  contact_days_label: string;
  salesman: { id: number; username: string; first_name: string | null; last_name: string | null } | null;
  status: ClientStatus;
  deleted_at: string | null;
};

const mapClientStatus = (value: string | null | undefined): ClientStatus =>
  value?.toLowerCase() === "deleted" ? "deleted" : "active";

type ClientEditForm = {
  name: string;
  nip: string;
  city: string;
  postal_code: string;
  street: string;
  classification: string;
  phone: string;
  email: string;
  contact_days_label: string;
  salesman: string;
};

type CurrentUser = {
  id: number;
  username: string;
  role: string;
  tenant?: { id: number; name: string } | null;
};

type SelectOption = {
  value: string;
  label: string;
};

type CityOption = SelectOption & {
  postalCodes: string[];
};

const CITY_OPTIONS: CityOption[] = [
  { value: "Warszawa", label: "Warszawa", postalCodes: ["00-001", "01-401", "02-326", "03-981"] },
  { value: "Kraków", label: "Kraków", postalCodes: ["30-001", "30-081", "31-154", "31-510"] },
  { value: "Gdańsk", label: "Gdańsk", postalCodes: ["80-001", "80-172", "80-278", "80-809"] },
  { value: "Wrocław", label: "Wrocław", postalCodes: ["50-001", "50-079", "51-317", "53-333"] },
  { value: "Poznań", label: "Poznań", postalCodes: ["60-001", "60-101", "60-781", "61-160"] },
  { value: "Łódź", label: "Łódź", postalCodes: ["90-001", "90-212", "90-608", "92-213"] },
  { value: "Szczecin", label: "Szczecin", postalCodes: ["70-001", "70-777", "71-235", "71-899"] },
  { value: "Lublin", label: "Lublin", postalCodes: ["20-001", "20-206", "20-468", "20-950"] },
  { value: "Katowice", label: "Katowice", postalCodes: ["40-001", "40-085", "40-278", "40-827"] },
];

const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .toLowerCase();

const resolveCityValue = (value: string) => {
  if (!value) return "";
  const normalized = normalizeText(value);
  const matched = CITY_OPTIONS.find((option) => normalizeText(option.value) === normalized);
  return matched?.value ?? value;
};

const getPostalSuggestions = (cityValue: string) => {
  if (!cityValue) {
    return [];
  }
  const normalized = normalizeText(cityValue);
  const matched = CITY_OPTIONS.find((option) => normalizeText(option.value) === normalized);
  return matched?.postalCodes ?? [];
};

const ensureCityOptionList = (cityValue: string): CityOption[] => {
  if (!cityValue) {
    return CITY_OPTIONS;
  }
  const normalized = normalizeText(cityValue);
  const exists = CITY_OPTIONS.some((option) => normalizeText(option.value) === normalized);
  if (exists) {
    return CITY_OPTIONS;
  }
  return [...CITY_OPTIONS, { value: cityValue, label: cityValue, postalCodes: [] }];
};

const DEFAULT_TENANT_ID = 4;

const createEmptyClient = (): NewClientForm => ({
  name: "",
  nip: "",
  city: "",
  postal_code: "",
  street: "",
  classification: "",
  phone: "",
  email: "",
  contact_days_label: "",
});

type SalesRepOption = {
  id: number;
  username: string;
  first_name?: string;
  last_name?: string;
};

type ImportRecord = {
  id: string;
  order: number;
  name: string;
  nip: string;
  action: string;
  geocoded: boolean;
  message?: string;
};

type ImportJob = {
  id: string;
  status: "pending" | "running" | "success" | "error" | "cancelled";
  total_rows: number;
  processed_rows: number;
  inserted_count: number;
  updated_count: number;
  geocoded_count: number;
  failed_geocode_count: number;
  progress: number;
  error_message?: string;
  cancel_requested: boolean;
  records: ImportRecord[];
};

export default function ImportPage() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);
  const [file, setFile] = useState<File | null>(null);
  const [tenantId, setTenantId] = useState<string>(String(DEFAULT_TENANT_ID));
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [wsWarning, setWsWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobData, setJobData] = useState<ImportJob | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [isRealtime, setIsRealtime] = useState(false);
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [newClient, setNewClient] = useState<NewClientForm>(createEmptyClient);
  const [classificationCatalog, setClassificationCatalog] = useState<SelectOption[]>([]);
  const [salesmen, setSalesmen] = useState<SalesRepOption[]>([]);
  const [selectedSalesman, setSelectedSalesman] = useState<string>("");
  const [clientDirectory, setClientDirectory] = useState<ClientDirectoryEntry[]>([]);
  const [clientDirectoryLoading, setClientDirectoryLoading] = useState(false);
  const [clientDirectoryError, setClientDirectoryError] = useState<string | null>(null);
  const [isCreatingClient, setIsCreatingClient] = useState(false);
  const [clientMessage, setClientMessage] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [regonStatus, setRegonStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [regonMessage, setRegonMessage] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [userError, setUserError] = useState<string | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [clientEditForm, setClientEditForm] = useState<ClientEditForm>({
    name: "",
    nip: "",
    city: "",
    postal_code: "",
    street: "",
    classification: "",
    phone: "",
    email: "",
    contact_days_label: "",
    salesman: "",
  });
  const [clientEditStatus, setClientEditStatus] = useState<string | null>(null);
  const [clientEditError, setClientEditError] = useState<string | null>(null);
  const [isUpdatingClient, setIsUpdatingClient] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [isRestoringClient, setIsRestoringClient] = useState(false);
  const cityOptions = useMemo(() => ensureCityOptionList(newClient.city), [newClient.city]);
  const classificationOptions = useMemo(() => classificationCatalog, [classificationCatalog]);
  const postalSuggestions = useMemo(() => getPostalSuggestions(newClient.city), [newClient.city]);
  const filteredClients = useMemo(() => {
    const term = clientSearch.trim().toLowerCase();
    if (!term) {
      return clientDirectory;
    }
    return clientDirectory.filter((client) => {
      const haystack = [
        client.name,
        client.city,
        client.nip,
        client.street,
        client.email,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [clientDirectory, clientSearch]);

  const canManageClients = currentUser?.role === "admin" || currentUser?.role === "manager";
  const isSalesRepUser = currentUser?.role === "rep";

  const loadClientDirectory = useCallback(
    async (options: { signal?: AbortSignal } = {}) => {
      if (!token) {
        return;
      }
      const { signal } = options;
      setClientDirectoryLoading(true);
      setClientDirectoryError(null);
      try {
        const response = await authorizedFetch(`/api/clients/?limit=500&include_deleted=1`, {
          signal,
        });
        if (!response.ok) {
          throw new Error("Nie udało się pobrać listy klientów.");
        }
        const payload = await response.json().catch(() => null);
        const items: any[] = Array.isArray(payload) ? payload : payload?.results ?? [];
        const uniqueLabels = Array.from(
          new Set(
            items
              .map((client) => (client?.classification ?? "").trim())
              .filter((label: string) => label.length > 0),
          ),
        ).sort((a, b) => a.localeCompare(b, "pl"));
        if (signal?.aborted) {
          return;
        }
        setClassificationCatalog(uniqueLabels.map((label) => ({ value: label, label })));
        setClientDirectory(
          items.map((client) => ({
            id: client.id,
            name: client.name,
            nip: client.nip ?? "",
            city: client.city ?? "",
            postal_code: client.postal_code ?? "",
            street: client.street ?? "",
            classification: client.classification ?? "",
            phone: client.phone ?? "",
            email: client.email ?? "",
            contact_days_label: client.contact_days_label ?? "",
            salesman: client.salesman ?? null,
            status: mapClientStatus(client.status?.toLowerCase()),
            deleted_at: client.deleted_at ?? null,
          })),
        );
      } catch (loadError) {
        if (signal?.aborted) {
          return;
        }
        console.error("Nie udało się pobrać listy klientów", loadError);
        setClientDirectoryError(
          loadError instanceof Error
            ? loadError.message
            : "Nie udało się pobrać listy klientów.",
        );
      } finally {
        if (!signal?.aborted) {
          setClientDirectoryLoading(false);
        }
      }
    },
    [token],
  );

  useEffect(() => {
    if (!hydrated || !token) {
      return;
    }
    const controller = new AbortController();
    loadClientDirectory({ signal: controller.signal }).catch(() => undefined);
    return () => controller.abort();
  }, [hydrated, token, loadClientDirectory]);

  useEffect(() => {
    if (!currentUser || currentUser.role !== "rep") {
      return;
    }
    setSelectedSalesman(String(currentUser.id));
  }, [currentUser]);

  useEffect(() => {
    if (!hydrated || !token) {
      return;
    }
    setUserLoading(true);
    setUserError(null);
    const controller = new AbortController();
    authorizedFetch(`/api/accounts/users/me/`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.detail ?? "Nie udało się pobrać danych użytkownika.");
        }
        return response.json();
      })
      .then((payload) => {
        setCurrentUser(payload);
        if (payload?.tenant?.id) {
          setTenantId(String(payload.tenant.id));
        } else {
          setTenantId(String(DEFAULT_TENANT_ID));
        }
      })
      .catch((error) => {
        setUserError(error instanceof Error ? error.message : "Błąd pobierania danych użytkownika.");
      })
      .finally(() => setUserLoading(false));

    return () => controller.abort();
  }, [hydrated, token]);

  useEffect(() => {
    if (!hydrated || !token) {
      return;
    }
    const controller = new AbortController();
    authorizedFetch(`/api/accounts/sales-reps/`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          return;
        }
        const payload = await response.json().catch(() => null);
        const items: SalesRepOption[] = Array.isArray(payload)
          ? payload
          : payload?.results ?? [];
        setSalesmen(items);
      })
      .catch(() => null);
    return () => controller.abort();
  }, [hydrated, token]);

  const formatSalesRepName = (rep: SalesRepOption) => {
    const names = `${rep.first_name ?? ""} ${rep.last_name ?? ""}`.trim();
    return names.length > 0 ? names : rep.username;
  };

  const handleSelectClientForEdit = (clientId: string) => {
    setSelectedClientId(clientId);
    setClientEditStatus(null);
    setClientEditError(null);
    setIsRestoringClient(false);
    const client = clientDirectory.find((entry) => String(entry.id) === clientId);
    if (client) {
      setClientEditForm({
        name: client.name,
        nip: client.nip,
        city: client.city,
        postal_code: client.postal_code,
        street: client.street,
        classification: client.classification,
        phone: client.phone,
        email: client.email,
        contact_days_label: client.contact_days_label,
        salesman: client.salesman ? String(client.salesman.id) : "",
      });
    }
  };

  const selectedClient = useMemo(() => {
    return clientDirectory.find((entry) => String(entry.id) === selectedClientId) ?? null;
  }, [clientDirectory, selectedClientId]);

  const handleRestoreClient = async () => {
    if (!token || !selectedClientId) {
      setClientEditError("Wybierz klienta do przywrócenia.");
      return;
    }
    if (!clientEditForm.salesman) {
      setClientEditError("Wybierz handlowca przed przywróceniem klienta.");
      return;
    }
    setIsRestoringClient(true);
    setClientEditError(null);
    setClientEditStatus(null);
    try {
      const response = await authorizedFetch(`/api/clients/${selectedClientId}/restore/`, {
        method: "POST",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? "Nie udało się przywrócić klienta.");
      }
      const restored = await response.json();
      const normalizedStatus = mapClientStatus(restored.status);
      setClientDirectory((prev) =>
        prev.map((client) =>
          client.id === restored.id
            ? {
                ...client,
                status: normalizedStatus,
                deleted_at: restored.deleted_at ?? null,
              }
            : client,
        ),
      );
      setClientEditStatus("Klient został przywrócony i ponownie jest aktywny.");
      await loadClientDirectory();
    } catch (restoreError) {
      console.error("Restoring client failed", restoreError);
      setClientEditError(
        restoreError instanceof Error ? restoreError.message : "Nie udało się przywrócić klienta.",
      );
    } finally {
      setIsRestoringClient(false);
    }
  };

  const handleUpdateClient = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !selectedClientId) {
      setClientEditError("Wybierz klienta do edycji.");
      return;
    }
    setIsUpdatingClient(true);
    setClientEditError(null);
    setClientEditStatus(null);
    const payload = {
      name: clientEditForm.name.trim(),
      nip: clientEditForm.nip.trim(),
      city: clientEditForm.city.trim(),
      postal_code: clientEditForm.postal_code.trim(),
      street: clientEditForm.street.trim(),
      classification: clientEditForm.classification.trim(),
      phone: clientEditForm.phone.trim(),
      email: clientEditForm.email.trim(),
      contact_days_label: clientEditForm.contact_days_label.trim(),
      salesman_id: clientEditForm.salesman ? Number(clientEditForm.salesman) : null,
    };
    try {
      const response = await authorizedFetch(`/api/clients/${selectedClientId}/`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Nie udało się zaktualizować klienta.");
      }
      const updated = await response.json();
      const fallbackStatus = clientDirectory.find((c) => c.id === updated.id)?.status;
      const normalizedStatus = mapClientStatus(updated.status ?? fallbackStatus);
      setClientDirectory((prev) =>
        prev.map((client) =>
          client.id === updated.id
            ? {
                ...client,
                name: updated.name ?? client.name,
                nip: updated.nip ?? client.nip,
                city: updated.city ?? client.city,
                postal_code: updated.postal_code ?? client.postal_code,
                street: updated.street ?? client.street,
                classification: updated.classification ?? client.classification,
                phone: updated.phone ?? client.phone,
                email: updated.email ?? client.email,
                contact_days_label: updated.contact_days_label ?? client.contact_days_label,
                salesman: updated.salesman ?? client.salesman,
                status: normalizedStatus,
                deleted_at: updated.deleted_at ?? client.deleted_at,
              }
            : client,
        ),
      );
      await loadClientDirectory();
      setClientEditStatus("Dane klienta zapisane.");
    } catch (err) {
      console.error("Aktualizacja klienta nie powiodła się", err);
      setClientEditError(err instanceof Error ? err.message : "Nieznany błąd edycji");
    } finally {
      setIsUpdatingClient(false);
    }
  };

  const mergeJobData = (payload: Partial<ImportJob> & { records?: ImportRecord[] }) => {
    setJobData((prev) => {
      const next: ImportJob = {
        id: payload.id ?? prev?.id ?? "",
        status: payload.status ?? prev?.status ?? "pending",
        total_rows: payload.total_rows ?? prev?.total_rows ?? 0,
        processed_rows: payload.processed_rows ?? prev?.processed_rows ?? 0,
        inserted_count: payload.inserted_count ?? prev?.inserted_count ?? 0,
        updated_count: payload.updated_count ?? prev?.updated_count ?? 0,
        geocoded_count: payload.geocoded_count ?? prev?.geocoded_count ?? 0,
        failed_geocode_count: payload.failed_geocode_count ?? prev?.failed_geocode_count ?? 0,
        progress: payload.progress ?? prev?.progress ?? 0,
        error_message: payload.error_message ?? prev?.error_message,
        cancel_requested: payload.cancel_requested ?? prev?.cancel_requested ?? false,
        records: payload.records ?? prev?.records ?? [],
      };

      return next;
    });
  };

  const handleRegonLookup = async () => {
    const cleanNip = newClient.nip.replace(/[^0-9]/g, "");
    if (!token) {
      setRegonStatus("error");
      setRegonMessage("Zaloguj się, aby pobrać dane z REGON.");
      return;
    }
    if (cleanNip.length !== 10) {
      setRegonStatus("error");
      setRegonMessage("Podaj poprawny NIP (10 cyfr).");
      return;
    }

    setRegonStatus("loading");
    setRegonMessage("Pobieram dane z REGON…");
    try {
      const response = await authorizedFetch(`/api/clients/lookup-by-nip/?nip=${cleanNip}`);
      const body = await response
        .json()
        .catch(() => ({ detail: "Nie udało się odczytać odpowiedzi z REGON." }));

      if (!response.ok) {
        const detail = typeof body?.detail === "string" ? body.detail : "Nie znaleziono danych w REGON.";
        setRegonStatus("error");
        setRegonMessage(detail);
        return;
      }

      setNewClient((prev) => ({
        ...prev,
        name: body?.name ?? prev.name ?? "",
        city: resolveCityValue(body?.city || prev.city || ""),
        postal_code: body?.postal_code ?? prev.postal_code ?? "",
        street: body?.street ?? prev.street ?? "",
      }));
      setRegonStatus("success");
      setRegonMessage("Dane pobrane z REGON.");
    } catch (error) {
      console.error("REGON lookup failed", error);
      setRegonStatus("error");
      setRegonMessage("Nie udało się połączyć z REGON. Spróbuj ponownie.");
    }
  };

  const handleCreateClient = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      setClientError("Zaloguj się, aby dodać klienta.");
      return;
    }
    const missingFields: string[] = [];
    if (!newClient.name.trim()) missingFields.push("Nazwa klienta");
    if (!newClient.nip.trim()) missingFields.push("NIP");
    if (!newClient.city.trim()) missingFields.push("Miasto");
    if (!newClient.postal_code.trim()) missingFields.push("Kod pocztowy");
    if (!newClient.street.trim()) missingFields.push("Ulica i nr");
    if (!newClient.classification.trim()) missingFields.push("Klasyfikacja");
    if (!newClient.contact_days_label.trim()) missingFields.push("Dni kontakt");
    if (!isSalesRepUser && !selectedSalesman) missingFields.push("Handlowiec");
    if (missingFields.length > 0) {
      setClientError(`Uzupełnij wymagane pola: ${missingFields.join(", ")}.`);
      return;
    }
    setIsCreatingClient(true);
    setClientError(null);
    setClientMessage(null);
    try {
      const resolvedTenantId = currentUser?.tenant?.id ?? (tenantId ? Number(tenantId) : undefined);
      const resolvedSalesmanId = isSalesRepUser
        ? currentUser?.id
        : selectedSalesman
          ? Number(selectedSalesman)
          : undefined;
      const payload = {
        ...newClient,
        tenant: resolvedTenantId,
        salesman_id: resolvedSalesmanId ?? null,
      };
      const response = await authorizedFetch(`/api/clients/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const firstError =
          body?.detail ||
          (typeof body === "object" && body !== null
            ? Object.values(body)
                .flat()
                .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))[0]
            : null);
        throw new Error(firstError || "Nie udało się dodać klienta.");
      }
      setClientMessage("Klient dodany.");
      setNewClient(createEmptyClient());
      setSelectedSalesman("");
    } catch (err) {
      setClientError(err instanceof Error ? err.message : "Nieznany błąd dodawania.");
    } finally {
      setIsCreatingClient(false);
    }
  };

  const handleDownloadClientsExcel = async () => {
    if (!token) return;
    try {
      const response = await authorizedFetch(`/api/clients/export-excel/`);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? "Nie udało się pobrać pliku.");
      }
      const blob = await response.blob();
      const fileURL = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = fileURL;
      link.download = `baza_klientow_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => window.URL.revokeObjectURL(fileURL), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd pobierania pliku.");
    }
  };
  const handleCancel = async () => {
    if (!jobId || !token) {
      return;
    }
    setIsCancelling(true);
    setStatusMessage("Zatrzymuję import…");
    try {
      const response = await authorizedFetch(`/api/import-jobs/${jobId}/cancel/`, {
        method: "POST",
      });
      if (!response.ok && response.status !== 202) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Nie udało się zatrzymać importu.");
      }
      const payload = (await response.json()) as ImportJob;
      mergeJobData(payload);
      setStatusMessage("Import oznaczony do zatrzymania.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nieznany błąd zatrzymania.");
    } finally {
      setIsCancelling(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) {
      setError("Wybierz plik Excel przed wysłaniem.");
      return;
    }
    setIsSubmitting(true);
    setStatusMessage("Rozpoczynam import…");
    setError(null);
    setWsWarning(null);
    setProgress(5);
    setJobId(null);
    setJobData(null);
    setIsPolling(false);
    setLastUpdateAt(null);
    setIsModalOpen(true);
    setIsRealtime(false);

    const formData = new FormData();
    formData.append("file", file);
    const resolvedTenantId = currentUser?.tenant?.id ?? (tenantId ? Number(tenantId) : undefined);
    if (resolvedTenantId) {
      formData.append("tenant_id", String(resolvedTenantId));
    }

    try {
      const response = await authorizedFetch(`/api/import-jobs/`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Nie udało się zaimportować danych.");
      }

      const payload = (await response.json()) as ImportJob;
      setJobData(payload);
      setJobId(payload.id);
      setProgress(payload.progress ?? 0);
      setIsCancelling(false);
      setStatusMessage("Zadanie importu zostało utworzone. Oczekuję na start pracy.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Nieznany błąd importu.";
      setError(message);
      setStatusMessage("Import zakończony błędem.");
      setProgress(0);
      setIsModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (!token) {
      setError("Zaloguj się, aby przeprowadzić import.");
      setTenantId(String(DEFAULT_TENANT_ID));
      router.replace("/auth/login");
    }
  }, [token, hydrated, router]);

  useEffect(() => {
    if (!hydrated || !jobId || !token || isRealtime) {
      if (!jobId) {
        setIsPolling(false);
      }
      return;
    }
    let intervalId: NodeJS.Timeout | null = null;
    let cancelled = false;
    setIsPolling(true);
    setStatusMessage((prev) => prev ?? "Oczekuję na start zadania…");

    const fetchStatus = async () => {
      try {
        const response = await authorizedFetch(`/api/import-jobs/${jobId}/`);
        if (!response.ok) {
          throw new Error("Nie można pobrać statusu importu.");
        }
        const payload = (await response.json()) as ImportJob;
        if (cancelled) return;

        setJobData(payload);
        setProgress(payload.progress ?? 0);
        setLastUpdateAt(Date.now());

        if (payload.status === "success" || payload.status === "error") {
          setIsPolling(false);
          if (intervalId) {
            clearInterval(intervalId);
          }
          setJobId(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Błąd odczytu statusu importu.",
          );
          setIsPolling(false);
        }
      }
    };

    fetchStatus();
    intervalId = setInterval(fetchStatus, 2000);

    return () => {
      cancelled = true;
      if (intervalId) {
        clearInterval(intervalId);
      }
      setIsPolling(false);
    };
  }, [jobId, token, isRealtime, hydrated]);

  useEffect(() => {
    if (!hydrated || !jobId || !token) {
      if (socketRef.current) {
        socketRef.current.close();
      }
      setIsRealtime(false);
      if (!jobId) {
        setWsWarning(null);
      }
      return;
    }

    const wsUrl = `${WS_BASE_URL}/ws/import/${jobId}/?token=${token}`;
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      setIsRealtime(true);
      setIsPolling(false);
      setWsWarning(null);
      setError(null);
      setStatusMessage((prev) => prev ?? "Połączono z kanałem live logu…");
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!data?.type) return;
        if (data.type === "job.snapshot") {
          mergeJobData({ ...data.payload, records: data.payload.records ?? [] });
          setProgress(data.payload.progress ?? 0);
        } else if (data.type === "job.update") {
          mergeJobData(data.payload);
          setProgress(data.payload.progress ?? 0);
          setLastUpdateAt(Date.now());
          if (["success", "error"].includes(data.payload.status)) {
            setTimeout(() => {
              setIsRealtime(false);
              setJobId(null);
            }, 0);
          }
        } else if (data.type === "job.log") {
          setJobData((prev) => {
            if (!prev) return prev;
            const updatedRecords = [...(prev.records ?? []), data.payload].slice(-20);
            return { ...prev, records: updatedRecords };
          });
        }
      } catch (err) {
        console.error("Błąd parsowania wiadomości WebSocket", err);
      }
    };

    socket.onerror = () => {
      setIsRealtime(false);
      setWsWarning("Połączenie WebSocket niedostępne – przełączono na polling.");
      setStatusMessage((prev) => prev ?? "Brak kanału live, korzystam z pollingu.");
      setIsPolling(true);
    };

    socket.onclose = () => {
      socketRef.current = null;
      setIsRealtime(false);
    };

    return () => {
      socket.close();
    };
  }, [jobId, token, hydrated]);

  useEffect(() => {
    if (!jobId) {
      setWsWarning(null);
    }
  }, [jobId]);

  const computedProgress = jobData ? jobData.progress : progress;
  const computedStatusMessage = useMemo(() => {
    if (!jobData) {
      return statusMessage;
    }
    switch (jobData.status) {
      case "pending":
        return "Zadanie oczekuje na przetwarzanie…";
      case "running":
        if (jobData.cancel_requested) {
          return "Trwa zatrzymywanie importu…";
        }
        return `Przetwarzanie rekordów (${jobData.processed_rows}/${jobData.total_rows || "?"})`;
      case "cancelled":
        return "Import został zatrzymany.";
      case "success":
        return "Import zakończony powodzeniem.";
      case "error":
        return `Błąd importu: ${jobData.error_message || "sprawdź log"}`;
      default:
        return statusMessage;
    }
  }, [jobData, statusMessage]);

  const hasActiveJob = Boolean(jobId || jobData || isSubmitting || isPolling || isRealtime);
  const shouldShowAwaitingResponse = Boolean(
    isModalOpen && jobId && !jobData && (isSubmitting || isPolling || isRealtime),
  );

  const lastRecords = jobData?.records ?? [];

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="glass-card w-full max-w-md space-y-4 p-8 text-center">
          <p className="text-sm font-semibold text-slate-900">
            Dostęp tylko dla zalogowanych menedżerów.
          </p>
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
      <div className="mx-auto max-w-3xl space-y-6">
        <nav className="flex flex-wrap justify-end gap-3">
          <Link
            href="/manager/map"
            className="inline-flex items-center rounded-2xl border border-blue-200 bg-white px-3 py-1.5 text-sm font-medium text-blue-700 shadow-sm transition hover:border-blue-400 hover:text-blue-900"
          >
            Edytuj koordynaty →
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-blue-500 hover:text-blue-600"
          >
            ← Wróć do dashboardu
          </Link>
        </nav>
        <header className="glass-card p-6">
          <p className="text-xs uppercase tracking-[0.35em] text-blue-500">
            Panel menedżera
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">
            Import bazy klientów z Excela
          </h1>
        </header>

        <section className="glass-card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-800">Plik Excel</label>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  setFile(selected ?? null);
                }}
                className="block w-full rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:border-blue-300"
                required
              />
              <p className="text-xs text-slate-500">
                Wspierane kolumny: Nazwa kontrahenta, NIP, Miasto, Kod, Ulica, nr lokalu,
                Nazwa klasyfikacji, Typ klienta, Dni_kontakt itp.
              </p>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex w-full items-center justify-center rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {isSubmitting ? "Importuję..." : "Wyślij do importu"}
            </button>
            {canManageClients && (
              <button
                type="button"
                onClick={handleDownloadClientsExcel}
                className="inline-flex w-full items-center justify-center rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500"
              >
                Pobierz bazę klientów do Excela
              </button>
            )}
          </form>

          {(isSubmitting || jobData) && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Postęp importu</span>
                <span>{computedProgress.toFixed(0)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all"
                  style={{ width: `${computedProgress}%` }}
                />
              </div>
            </div>
          )}

          {hasActiveJob && (
            <div className="mt-4 space-y-2 rounded-2xl bg-slate-900/5 px-4 py-3 text-sm text-slate-700">
              <p>{computedStatusMessage ?? "Oczekuję na informacje z serwera…"}</p>
              {jobData && (
                <p className="text-xs text-slate-600">
                  Przetworzono {jobData.processed_rows} z {jobData.total_rows || "?"} rekordów.
                </p>
              )}
              {wsWarning && (
                <p className="text-xs text-amber-600">{wsWarning}</p>
              )}
              {isRealtime && (
                <p className="text-xs text-slate-500">
                  Połączenie WebSocket aktywne{lastUpdateAt ? `, ostatnia aktualizacja ${new Date(lastUpdateAt).toLocaleTimeString()}` : ""}.
                </p>
              )}
              {!isRealtime && isPolling && (
                <p className="text-xs text-slate-500">
                  Aktualizuję co 2 sekundy{lastUpdateAt ? `, ostatnia odpowiedź ${new Date(lastUpdateAt).toLocaleTimeString()}` : ""}.
                </p>
              )}
            </div>
          )}

          {error && !isModalOpen && (
            <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {jobData && !isModalOpen && (
            <div className="mt-4 flex items-center justify-between rounded-2xl border border-slate-100 bg-white px-4 py-3 text-sm text-slate-700">
              <span>Ostatni import: {jobData.status.toUpperCase()}</span>
              <button
                onClick={() => setIsModalOpen(true)}
                className="rounded-full bg-blue-600 px-4 py-1 text-xs font-semibold text-white hover:bg-blue-500"
              >
                Pokaż szczegóły
              </button>
            </div>
          )}

          {isModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-8">
              <div className="glass-card relative max-h-[85vh] w-full max-w-4xl overflow-hidden">
                <div className="flex flex-col gap-2 border-b border-slate-100/80 px-6 pb-4 pt-6">
                  <p className="text-sm font-semibold uppercase tracking-[0.35em] text-blue-500">
                    Import klientów
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-xl font-semibold text-slate-900">Status procesu</h2>
                      <p className="text-sm text-slate-500">
                        {computedStatusMessage ?? "Ładuję dane zadania..."}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {jobData &&
                        ["pending", "running"].includes(jobData.status) &&
                        !jobData.cancel_requested && (
                          <button
                            onClick={handleCancel}
                            disabled={isCancelling}
                            className="rounded-full bg-red-100 px-4 py-2 text-xs font-semibold text-red-600 hover:bg-red-200 disabled:opacity-60"
                          >
                            {isCancelling ? "Zatrzymuję…" : "Zatrzymaj import"}
                          </button>
                        )}
                      <button
                        onClick={() => {
                          setIsModalOpen(false);
                          setProgress(0);
                        }}
                        className="rounded-full bg-slate-900/10 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-900/15"
                      >
                        Zamknij
                      </button>
                    </div>
                  </div>
                </div>

                <div className="px-6 py-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Postęp importu</span>
                      <span>{computedProgress.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all"
                        style={{ width: `${computedProgress}%` }}
                      />
                    </div>
                  </div>

                  {error && (
                    <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">
                      {error}
                    </div>
                  )}

                  {jobData ? (
                    <>
                      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-2xl border border-slate-100 bg-white/80 p-4">
                          <p className="text-xs uppercase tracking-wide text-slate-500">Nowe</p>
                          <p className="text-2xl font-semibold text-slate-900">
                            {jobData.inserted_count}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-white/80 p-4">
                          <p className="text-xs uppercase tracking-wide text-slate-500">Update</p>
                          <p className="text-2xl font-semibold text-slate-900">
                            {jobData.updated_count}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-white/80 p-4">
                          <p className="text-xs uppercase tracking-wide text-slate-500">
                            Zgeokodowane
                          </p>
                          <p className="text-2xl font-semibold text-slate-900">
                            {jobData.geocoded_count}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-white/80 p-4">
                          <p className="text-xs uppercase tracking-wide text-slate-500">
                            Błędy geolokacji
                          </p>
                          <p className="text-2xl font-semibold text-slate-900">
                            {jobData.failed_geocode_count}
                          </p>
                        </div>
                      </div>

                      <div className="mt-6 space-y-2">
                        <p className="text-sm font-semibold text-slate-900">
                          Szczegółowy log (ostatnie 20 pozycji):
                        </p>
                        <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-100">
                          <table className="min-w-full divide-y divide-slate-100 text-xs">
                            <thead className="bg-slate-50 text-slate-500">
                              <tr>
                                <th className="px-3 py-2 text-left font-medium">Klient</th>
                                <th className="px-3 py-2 text-left font-medium">NIP</th>
                                <th className="px-3 py-2 text-left font-medium">Akcja</th>
                                <th className="px-3 py-2 text-left font-medium">Geolokacja</th>
                                <th className="px-3 py-2 text-left font-medium">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white text-slate-600">
                              {lastRecords.map((record) => (
                                <tr key={record.id}>
                                  <td className="px-3 py-2 font-semibold text-slate-900">
                                    {record.name}
                                  </td>
                                  <td className="px-3 py-2">{record.nip}</td>
                                  <td className="px-3 py-2 capitalize">{record.action}</td>
                                  <td className="px-3 py-2">
                                    {record.geocoded ? (
                                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">
                                        OK
                                      </span>
                                    ) : (
                                      <span className="rounded-full bg-orange-100 px-2 py-0.5 text-orange-700">
                                        brak
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2">{record.message ?? "-"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  ) : shouldShowAwaitingResponse ? (
                    <div className="mt-6 rounded-2xl border border-slate-100 bg-white/70 p-6 text-center text-sm text-slate-500">
                      Oczekuję na pierwszą odpowiedź z serwera…
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="glass-card p-6">
          <div className="flex flex-col gap-2 border-b border-slate-100 pb-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-blue-500">Dodaj klienta</p>
              <h2 className="text-lg font-semibold text-slate-900">Szybkie dodanie klienta</h2>
            </div>
          </div>
          <form onSubmit={handleCreateClient} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-800">
              Nazwa klienta <span className="text-red-500">*</span>
              <input
                type="text"
                value={newClient.name}
                onChange={(event) =>
                  setNewClient((prev) => ({ ...prev, name: event.target.value }))
                }
                className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm text-slate-900 focus:outline-none ${!newClient.name.trim() ? "border-red-300 focus:border-red-400" : "border-slate-200 focus:border-blue-400"}`}
              />
            </label>
            <label className="text-sm font-medium text-slate-800">
              NIP <span className="text-red-500">*</span>
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  value={newClient.nip}
                  onChange={(event) =>
                    setNewClient((prev) => ({
                      ...prev,
                      nip: event.target.value,
                    }))
                  }
                  placeholder="np. 1234567890"
                  className={`w-full rounded-2xl border bg-white px-4 py-2 text-sm text-slate-900 focus:outline-none ${!newClient.nip.trim() ? "border-red-300 focus:border-red-400" : "border-slate-200 focus:border-blue-400"}`}
                />
                <button
                  type="button"
                  onClick={handleRegonLookup}
                  className="shrink-0 rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
                >
                  Pobierz dane z GUS
                </button>
              </div>
              {regonMessage && (
                <p
                  className={`mt-1 text-xs ${
                    regonStatus === "success"
                      ? "text-emerald-600"
                      : regonStatus === "error"
                        ? "text-red-600"
                        : "text-slate-500"
                  }`}
                >
                  {regonMessage}
                </p>
              )}
            </label>
            <label className="text-sm font-medium text-slate-800">
              Miasto <span className="text-red-500">*</span>
              <input
                list="quick-add-city-options"
                value={newClient.city}
                onChange={(event) =>
                  setNewClient((prev) => ({ ...prev, city: resolveCityValue(event.target.value) }))
                }
                className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm text-slate-900 focus:outline-none ${!newClient.city.trim() ? "border-red-300 focus:border-red-400" : "border-slate-200 focus:border-blue-400"}`}
                placeholder="Wybierz lub wpisz miasto"
              />
              <datalist id="quick-add-city-options">
                {cityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </datalist>
            </label>
            <label className="text-sm font-medium text-slate-800">
              Kod pocztowy <span className="text-red-500">*</span>
              <input
                type="text"
                value={newClient.postal_code}
                onChange={(event) =>
                  setNewClient((prev) => ({ ...prev, postal_code: event.target.value }))
                }
                className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm text-slate-900 focus:outline-none ${!newClient.postal_code.trim() ? "border-red-300 focus:border-red-400" : "border-slate-200 focus:border-blue-400"}`}
              />
              {postalSuggestions.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span className="text-[11px] uppercase tracking-wide text-slate-400">Sugerowane:</span>
                  {postalSuggestions.map((code) => (
                    <button
                      type="button"
                      key={code}
                      onClick={() =>
                        setNewClient((prev) => ({ ...prev, postal_code: code }))
                      }
                      className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-600 transition hover:border-blue-300 hover:text-blue-700"
                    >
                      {code}
                    </button>
                  ))}
                </div>
              )}
            </label>
            <label className="text-sm font-medium text-slate-800">
              Ulica i nr <span className="text-red-500">*</span>
              <input
                type="text"
                value={newClient.street}
                onChange={(event) =>
                  setNewClient((prev) => ({ ...prev, street: event.target.value }))
                }
                className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm text-slate-900 focus:outline-none ${!newClient.street.trim() ? "border-red-300 focus:border-red-400" : "border-slate-200 focus:border-blue-400"}`}
              />
            </label>
            <label className="text-sm font-medium text-slate-800">
              Klasyfikacja <span className="text-red-500">*</span>
              <select
                value={newClient.classification}
                onChange={(event) =>
                  setNewClient((prev) => ({ ...prev, classification: event.target.value }))
                }
                className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm text-slate-900 focus:outline-none ${!newClient.classification.trim() ? "border-red-300 focus:border-red-400" : "border-slate-200 focus:border-blue-400"}`}
              >
                <option value="">Wybierz klasyfikację…</option>
                {classificationOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-800">
              Dni kontakt <span className="text-red-500">*</span>
              <input
                type="text"
                value={newClient.contact_days_label}
                onChange={(event) =>
                  setNewClient((prev) => ({ ...prev, contact_days_label: event.target.value }))
                }
                className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm text-slate-900 focus:outline-none ${!newClient.contact_days_label.trim() ? "border-red-300 focus:border-red-400" : "border-slate-200 focus:border-blue-400"}`}
              />
            </label>
            <label className="text-sm font-medium text-slate-800">
              Handlowiec <span className="text-red-500">*</span>
              <select
                value={isSalesRepUser ? String(currentUser?.id ?? "") : selectedSalesman}
                onChange={(event) => setSelectedSalesman(event.target.value)}
                disabled={isSalesRepUser}
                className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm text-slate-900 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 ${!isSalesRepUser && !selectedSalesman ? "border-red-300 focus:border-red-400" : "border-slate-200 focus:border-blue-400"}`}
              >
                {isSalesRepUser ? (
                  <option value={currentUser?.id ?? ""}>{currentUser?.username ?? "Twoje konto"}</option>
                ) : (
                  <>
                    <option value="">Wybierz handlowca…</option>
                    {salesmen.map((rep) => (
                      <option key={rep.id} value={rep.id}>
                        {formatSalesRepName(rep)}
                      </option>
                    ))}
                  </>
                )}
              </select>
              {isSalesRepUser && (
                <p className="mt-1 text-xs text-slate-500">Klient zostanie przypisany do Twojego konta.</p>
              )}
            </label>
            <label className="text-sm font-medium text-slate-800">
              Telefon
              <input
                type="tel"
                value={newClient.phone}
                onChange={(event) =>
                  setNewClient((prev) => ({ ...prev, phone: event.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none"
                placeholder="np. +48 501 000 000"
              />
            </label>
            <label className="text-sm font-medium text-slate-800">
              E-mail
              <input
                type="email"
                value={newClient.email}
                onChange={(event) =>
                  setNewClient((prev) => ({ ...prev, email: event.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none"
                placeholder="np. biuro@firma.pl"
              />
            </label>
            <div className="sm:col-span-2 flex flex-col gap-3">
              <button
                type="submit"
                disabled={isCreatingClient}
                className="inline-flex w-full items-center justify-center rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
              >
                {isCreatingClient ? "Dodaję klienta…" : "Dodaj klienta"}
              </button>
              {clientMessage && (
                <p className="rounded-2xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{clientMessage}</p>
              )}
              {clientError && (
                <p className="rounded-2xl bg-red-50 px-3 py-2 text-xs text-red-600">{clientError}</p>
              )}
            </div>
          </form>
        </section>

        {canManageClients ? (
          <section className="glass-card p-6">
            <div className="flex flex-col gap-2 border-b border-slate-100 pb-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-emerald-500">Edycja</p>
                <h2 className="text-lg font-semibold text-slate-900">Zarządzanie istniejącymi klientami</h2>
                <p className="text-sm text-slate-500">
                  Aktualizuj dane podstawowe i przypisuj handlowców. Uprawnienia: tylko administrator i menedżer.
                </p>
              </div>
              {clientDirectoryError && (
                <p className="rounded-2xl bg-red-50 px-3 py-2 text-xs text-red-600">
                  {clientDirectoryError}
                </p>
              )}
            </div>
            <form onSubmit={handleUpdateClient} className="mt-4 space-y-4">
              <label className="text-sm font-medium text-slate-800">
                Filtruj klientów
                <input
                  type="text"
                  value={clientSearch}
                  onChange={(event) => setClientSearch(event.target.value)}
                  placeholder="np. nazwa, miasto, NIP…"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none"
                />
              </label>
              <label className="text-sm font-medium text-slate-800">
                Wybierz klienta
                <select
                  value={selectedClientId}
                  onChange={(event) => handleSelectClientForEdit(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none"
                >
                  <option value="">— wybierz klienta —</option>
                  {filteredClients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                      {client.city ? ` • ${client.city}` : ""}
                      {client.status === "deleted" ? " • (usunięty)" : client.status === "active" ? " • (aktywny)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {clientDirectoryLoading && (
                <p className="text-xs text-slate-500">Ładuję listę klientów…</p>
              )}
              {clientSearch.trim().length > 0 && filteredClients.length === 0 && (
                <p className="text-xs text-amber-600">Brak wyników dla „{clientSearch.trim()}”.</p>
              )}
              {selectedClientId && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-medium text-slate-800">
                    Nazwa
                    <input
                      type="text"
                      value={clientEditForm.name}
                      onChange={(event) =>
                        setClientEditForm((prev) => ({ ...prev, name: event.target.value }))
                      }
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none"
                      required
                    />
                  </label>
                  <label className="text-sm font-medium text-slate-800">
                    NIP
                    <input
                      type="text"
                      value={clientEditForm.nip}
                      onChange={(event) =>
                        setClientEditForm((prev) => ({ ...prev, nip: event.target.value }))
                      }
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none"
                    />
                  </label>
                  <label className="text-sm font-medium text-slate-800">
                    Miasto
                    <input
                      type="text"
                      value={clientEditForm.city}
                      onChange={(event) =>
                        setClientEditForm((prev) => ({ ...prev, city: event.target.value }))
                      }
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none"
                    />
                  </label>
                  <label className="text-sm font-medium text-slate-800">
                    Kod pocztowy
                    <input
                      type="text"
                      value={clientEditForm.postal_code}
                      onChange={(event) =>
                        setClientEditForm((prev) => ({ ...prev, postal_code: event.target.value }))
                      }
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none"
                    />
                  </label>
                  <label className="text-sm font-medium text-slate-800">
                    Ulica i nr
                    <input
                      type="text"
                      value={clientEditForm.street}
                      onChange={(event) =>
                        setClientEditForm((prev) => ({ ...prev, street: event.target.value }))
                      }
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none"
                    />
                  </label>
                  <label className="text-sm font-medium text-slate-800">
                    Klasyfikacja
                    <input
                      type="text"
                      value={clientEditForm.classification}
                      onChange={(event) =>
                        setClientEditForm((prev) => ({ ...prev, classification: event.target.value }))
                      }
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none"
                    />
                  </label>
                  <label className="text-sm font-medium text-slate-800">
                    Dni_kontakt
                    <input
                      type="text"
                      value={clientEditForm.contact_days_label}
                      onChange={(event) =>
                        setClientEditForm((prev) => ({ ...prev, contact_days_label: event.target.value }))
                      }
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none"
                    />
                  </label>
                  <label className="text-sm font-medium text-slate-800">
                    Telefon
                    <input
                      type="text"
                      value={clientEditForm.phone}
                      onChange={(event) =>
                        setClientEditForm((prev) => ({ ...prev, phone: event.target.value }))
                      }
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none"
                    />
                  </label>
                  <label className="text-sm font-medium text-slate-800">
                    E-mail
                    <input
                      type="email"
                      value={clientEditForm.email}
                      onChange={(event) =>
                        setClientEditForm((prev) => ({ ...prev, email: event.target.value }))
                      }
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none"
                    />
                  </label>
                  <label className="text-sm font-medium text-slate-800 sm:col-span-2">
                    Status klienta
                    <div className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600">
                      {selectedClient?.status === "deleted" ? "Usunięty" : "Aktywny"}
                    </div>
                  </label>
                  <label className="text-sm font-medium text-slate-800">
                    Obecny handlowiec
                    <div className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      {selectedClient?.salesman
                        ? `${selectedClient.salesman.first_name ?? ""} ${selectedClient.salesman.last_name ?? ""}`.trim() ||
                          selectedClient.salesman.username
                        : "Brak"}
                    </div>
                  </label>
                  <label className="text-sm font-medium text-slate-800">
                    Nowy handlowiec
                    <select
                      value={clientEditForm.salesman}
                      onChange={(event) =>
                        setClientEditForm((prev) => ({ ...prev, salesman: event.target.value }))
                      }
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none"
                    >
                      <option value="">Brak (bieżący użytkownik)</option>
                      {salesmen.map((rep) => (
                        <option key={rep.id} value={rep.id}>
                          {formatSalesRepName(rep)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              <div className="flex flex-col gap-3">
                {selectedClient?.status === "deleted" && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    Klient jest oznaczony jako usunięty. Przywróć go, aby móc zapisać zmiany i udostępnić go zespołowi.
                  </div>
                )}
                {selectedClient?.status === "deleted" ? (
                  <button
                    type="button"
                    onClick={handleRestoreClient}
                    disabled={isRestoringClient}
                    className="inline-flex w-full items-center justify-center rounded-2xl border border-emerald-300 bg-white px-4 py-3 text-sm font-semibold text-emerald-600 transition hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isRestoringClient ? "Przywracam klienta…" : "Przywróć klienta"}
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!selectedClientId || isUpdatingClient}
                    className="inline-flex w-full items-center justify-center rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
                  >
                    {isUpdatingClient ? "Zapisuję zmiany…" : "Zapisz klienta"}
                  </button>
                )}
                {clientEditStatus && (
                  <p className="rounded-2xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{clientEditStatus}</p>
                )}
                {clientEditError && (
                  <p className="rounded-2xl bg-red-50 px-3 py-2 text-xs text-red-600">{clientEditError}</p>
                )}
              </div>
            </form>
          </section>
        ) : (
          <section className="glass-card p-6">
            <p className="text-sm text-slate-600">
              Edycja klientów dostępna jest jedynie dla administratorów i menedżerów.
              {userLoading && " Ładuję dane użytkownika…"}
              {userError && ` (${userError})`}
            </p>
          </section>
        )}
      </div>
    </main>
  );
}

"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { authorizedFetch } from "@/lib/auth-fetch";
import { useAuthStore } from "@/store/auth-store";

type TenantOption = {
  id: number;
  name: string;
  contact_cycle_start_date: string | null;
};

type SalesRep = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  tenant: TenantOption | null;
  contact_cycle_start_date: string | null;
};

type Manager = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  role: string;
  tenant: TenantOption | null;
  contact_cycle_start_date: string | null;
};

type BackupJob = {
  id: number;
  tenant: number;
  created_by: number;
  created_by_name: string;
  status: "pending" | "running" | "success" | "error";
  error_message: string;
  file: string | null;
  file_url: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

type CurrentUser = {
  id: number;
  username: string;
  role: string;
  tenant?: TenantOption | null;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

const purgeTargets = ["clients", "visits", "calls", "routes"] as const;
type PurgeTarget = (typeof purgeTargets)[number];

const purgeEndpointMap: Record<PurgeTarget, string> = {
  clients: `${API_BASE_URL}/api/clients/purge/`,
  visits: `${API_BASE_URL}/api/visits/purge/`,
  calls: `${API_BASE_URL}/api/call-records/purge/`,
  routes: `${API_BASE_URL}/api/routes/purge/`,
};

const purgeConfirmations: Record<PurgeTarget, string> = {
  clients: "Ta operacja usunie wszystkich klientów powiązanych z wybranym tenantem. Kontynuować?",
  visits: "Ta operacja usunie wszystkie wizyty zapisane dla wybranego tenanta. Czy na pewno chcesz kontynuować?",
  calls: "Ta operacja usunie całą historię kontaktów (połączenia / call-records). Czy chcesz kontynuować?",
  routes: "Ta operacja usunie wszystkie plany tras i powiązane przystanki. Czy na pewno kontynuować?",
};

const purgeCopy: Record<
  PurgeTarget,
  { title: string; description: string; actionLabel: string }
> = {
  clients: {
    title: "Usuwanie bazy danych klientów",
    description: "Przygotuj dane do eksportu lub kopii zapasowej zanim usuniesz całą bazę klientów.",
    actionLabel: "Usuń bazę klientów",
  },
  visits: {
    title: "Usuwanie wizyt",
    description: "Usuwa wszystkie wizyty (historyczne i planowane). Operacja nieodwracalna.",
    actionLabel: "Usuń wszystkie wizyty",
  },
  calls: {
    title: "Usuwanie historii kontaktów",
    description: "Czyści wszystkie call-records i przypomnienia kontaktowe.",
    actionLabel: "Usuń historię kontaktów",
  },
  routes: {
    title: "Usuwanie planów tras",
    description: "Kasuje wszystkie plany tras i powiązane przystanki.",
    actionLabel: "Usuń plany tras",
  },
};

const SALES_REPS_ENDPOINT = `${API_BASE_URL}/api/accounts/sales-reps-admin/`;
const MANAGERS_ENDPOINT = `${API_BASE_URL}/api/accounts/managers/`;
const ME_ENDPOINT = `${API_BASE_URL}/api/accounts/users/me/`;
const TENANTS_ENDPOINT = `${API_BASE_URL}/api/accounts/tenants/`;
const BACKUPS_ENDPOINT = `${API_BASE_URL}/api/backups/`;

const DEFAULT_TENANT_ID = 1;
const DEFAULT_TENANT_NAME = "Demo";
const DEFAULT_TENANT: TenantOption = {
  id: DEFAULT_TENANT_ID,
  name: DEFAULT_TENANT_NAME,
  contact_cycle_start_date: null,
};

export default function AdminPage() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);
  const clearAuth = useAuthStore((state) => state.clear);

  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [tenants, setTenants] = useState<TenantOption[]>([DEFAULT_TENANT]);
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [selectedRepId, setSelectedRepId] = useState<number | null>(null);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [selectedManagerId, setSelectedManagerId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createStatus, setCreateStatus] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<string | null>(null);
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);
  const [managerEditStatus, setManagerEditStatus] = useState<string | null>(null);
  const [managerPasswordStatus, setManagerPasswordStatus] = useState<string | null>(null);
  const [managersLoading, setManagersLoading] = useState(false);
  const [managerError, setManagerError] = useState<string | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<number>(DEFAULT_TENANT_ID);
  const [globalCycleDraft, setGlobalCycleDraft] = useState("");
  const [savingGlobalCycle, setSavingGlobalCycle] = useState(false);
  const [globalCycleStatus, setGlobalCycleStatus] = useState<string | null>(null);
  const [purgeState, setPurgeState] = useState<Record<PurgeTarget, { loading: boolean; status: string | null }>>(() =>
    purgeTargets.reduce(
      (acc, target) => {
        acc[target] = { loading: false, status: null };
        return acc;
      },
      {} as Record<PurgeTarget, { loading: boolean; status: string | null }>,
    ),
  );

  const [createForm, setCreateForm] = useState({
    username: "",
    email: "",
    first_name: "",
    last_name: "",
    password: "",
    tenant_id: "",
  });

  const [editForm, setEditForm] = useState({
    username: "",
    email: "",
    first_name: "",
    last_name: "",
    is_active: true,
    tenant_id: "",
    contact_cycle_start_date: "",
  });

  const [passwordForm, setPasswordForm] = useState({
    password: "",
    confirmPassword: "",
  });

  const [managerEditForm, setManagerEditForm] = useState({
    username: "",
    email: "",
    first_name: "",
    last_name: "",
    is_active: true,
    tenant_id: "",
    contact_cycle_start_date: "",
  });

  const [managerPasswordForm, setManagerPasswordForm] = useState({
    password: "",
    confirmPassword: "",
  });
  const [latestBackup, setLatestBackup] = useState<BackupJob | null>(null);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);

  const isAdmin = currentUser?.role === "admin";
  const hasAdminAccess = currentUser?.role === "admin" || currentUser?.role === "manager";
  const selectedRep = useMemo(() => reps.find((rep) => rep.id === selectedRepId) ?? null, [reps, selectedRepId]);
  const selectedManager = useMemo(
    () => managers.find((manager) => manager.id === selectedManagerId) ?? null,
    [managers, selectedManagerId],
  );
  const canManageSelectedManager = useMemo(() => {
    if (!selectedManager) {
      return false;
    }
    if (isAdmin) {
      return true;
    }
    if (currentUser?.role === "manager") {
      return selectedManager.id === currentUser.id;
    }
    return false;
  }, [currentUser, isAdmin, selectedManager]);
  const tenantIdForOperations = useMemo(() => {
    if (isAdmin) {
      return selectedTenantId;
    }
    return currentUser?.tenant?.id ?? selectedTenantId ?? DEFAULT_TENANT_ID;
  }, [currentUser, isAdmin, selectedTenantId]);

  const canTriggerBackup = hasAdminAccess;

  const handleDownloadBackup = async (jobId: number, createdAt: string) => {
    if (!token) return;
    setBackupError(null);
    try {
      const response = await authorizedFetch(`${BACKUPS_ENDPOINT}${jobId}/download/`);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? "Nie udało się pobrać pliku backupu.");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const ts = createdAt.slice(0, 19).replace(/[-T:]/g, "").replace(/(\d{8})(\d{6})/, "$1-$2");
      link.download = `backup-${ts}.dump`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : "Błąd pobierania backupu.");
    }
  };

  const handleCreateBackup = async () => {
    if (!token || !canTriggerBackup) {
      return;
    }
    setBackupStatus("Uruchamiam backup…");
    setBackupError(null);
    try {
      const response = await authorizedFetch(BACKUPS_ENDPOINT, {
        method: "POST",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? "Nie udało się zainicjować backupu.");
      }
      setBackupStatus("Backup został zainicjowany. Odśwież listę za chwilę.");
      fetchBackups().catch(() => undefined);
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : "Błąd przy uruchamianiu backupu.");
      setBackupStatus(null);
    }
  };
  const selectedTenant = useMemo(() => {
    const validTenants = tenants.filter((tenant): tenant is TenantOption => Boolean(tenant?.id));
    if (selectedTenantId) {
      return validTenants.find((tenant) => tenant.id === selectedTenantId) ?? null;
    }
    return validTenants.length ? validTenants[0] : null;
  }, [selectedTenantId, tenants]);

  const fetchReps = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await authorizedFetch(SALES_REPS_ENDPOINT);
      if (!response.ok) {
        throw new Error("Nie udało się pobrać listy handlowców.");
      }
      const data = await response.json();
      setReps(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nieznany błąd podczas pobierania handlowców.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const fetchManagers = useCallback(async () => {
    if (!token) {
      return;
    }
    setManagersLoading(true);
    setManagerError(null);
    try {
      const response = await authorizedFetch(MANAGERS_ENDPOINT);
      if (!response.ok) {
        throw new Error("Nie udało się pobrać listy menedżerów.");
      }
      const data = await response.json();
      setManagers(data);
    } catch (err) {
      setManagerError(err instanceof Error ? err.message : "Nieznany błąd podczas pobierania menedżerów.");
    } finally {
      setManagersLoading(false);
    }
  }, [token]);

  const fetchBackups = useCallback(async () => {
    if (!token) {
      return;
    }
    setIsLoadingBackups(true);
    setBackupError(null);
    try {
      const response = await authorizedFetch(BACKUPS_ENDPOINT);
      if (!response.ok) {
        throw new Error("Nie udało się pobrać listy backupów.");
      }
      const data = await response.json();
      const list = Array.isArray(data) ? data : data.results ?? [];
      setLatestBackup(list.length ? list[0] : null);
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : "Błąd pobierania backupów.");
      setLatestBackup(null);
    } finally {
      setIsLoadingBackups(false);
    }
  }, [token]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (!token) {
      router.replace("/auth/login");
    }
  }, [hydrated, token, router]);

  useEffect(() => {
    if (!hydrated || !token) {
      return;
    }

    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [userResponse, repsResponse, managersResponse, tenantsResponse] = await Promise.all([
          authorizedFetch(ME_ENDPOINT),
          authorizedFetch(SALES_REPS_ENDPOINT),
          authorizedFetch(MANAGERS_ENDPOINT),
          isAdmin ? authorizedFetch(TENANTS_ENDPOINT) : Promise.resolve(null),
        ]);

        if (!userResponse.ok) {
          throw new Error("Nie udało się pobrać danych użytkownika.");
        }
        if (!repsResponse.ok) {
          throw new Error("Nie udało się pobrać listy handlowców.");
        }
        if (!managersResponse.ok) {
          throw new Error("Nie udało się pobrać listy menedżerów.");
        }

        const userJson = await userResponse.json();
        const repsJson = await repsResponse.json();
        const managersJson = await managersResponse.json();
        let tenantsJson: { results?: TenantOption[] } | TenantOption[] | null = null;
        if (tenantsResponse) {
          tenantsJson = await tenantsResponse.json().catch(() => ({ results: [] }));
        }

        setCurrentUser(userJson);
        setReps(repsJson);
        setManagers(managersJson);
        let tenantList: TenantOption[] = Array.isArray(tenantsJson)
          ? tenantsJson
          : tenantsJson?.results ?? [];
        tenantList = tenantList.filter((tenant): tenant is TenantOption => Boolean(tenant?.id));
        if (!tenantList.length) {
          if (userJson?.tenant) {
            tenantList = [userJson.tenant];
          } else {
            tenantList = [DEFAULT_TENANT];
          }
        }
        setTenants(tenantList.length ? tenantList : [DEFAULT_TENANT]);

        if (selectedRepId) {
          const stillExists = repsJson.find((rep: SalesRep) => rep.id === selectedRepId);
          if (!stillExists) {
            setSelectedRepId(null);
          }
        }
        if (selectedManagerId) {
          const stillExists = managersJson.find((manager: Manager) => manager.id === selectedManagerId);
          if (!stillExists) {
            setSelectedManagerId(null);
          }
        }

        const effectiveTenantId = userJson?.tenant?.id ?? tenantList[0]?.id ?? DEFAULT_TENANT_ID;
        setSelectedTenantId(effectiveTenantId);
        setCreateForm((prev) => ({ ...prev, tenant_id: String(effectiveTenantId) }));
        setEditForm((prev) => ({ ...prev, tenant_id: String(effectiveTenantId) }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Nieznany błąd podczas ładowania danych.");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [hydrated, isAdmin, selectedManagerId, selectedRepId, token]);

  useEffect(() => {
    if (hydrated && token) {
      fetchBackups().catch(() => undefined);
    }
  }, [hydrated, token, fetchBackups]);

  const handleLogout = () => {
    clearAuth();
    router.replace("/auth/login");
  };

  const resetEditForm = useCallback(
    (rep: SalesRep | null) => {
      const fallbackTenantId = tenantIdForOperations ? String(tenantIdForOperations) : "";
      if (!rep) {
        setEditForm({
          username: "",
          email: "",
          first_name: "",
          last_name: "",
          is_active: true,
          tenant_id: fallbackTenantId,
          contact_cycle_start_date: "",
        });
        setPasswordForm({ password: "", confirmPassword: "" });
        return;
      }

      setEditForm({
        username: rep.username ?? "",
        email: rep.email ?? "",
        first_name: rep.first_name ?? "",
        last_name: rep.last_name ?? "",
        is_active: rep.is_active,
        tenant_id: rep.tenant?.id ? String(rep.tenant.id) : fallbackTenantId || String(DEFAULT_TENANT_ID),
        contact_cycle_start_date: rep.contact_cycle_start_date ?? "",
      });
      setPasswordForm({ password: "", confirmPassword: "" });
    },
    [tenantIdForOperations],
  );

  useEffect(() => {
    resetEditForm(selectedRep);
  }, [selectedRep, resetEditForm]);

  const resetManagerForm = useCallback((manager: Manager | null) => {
    if (!manager) {
      setManagerEditForm({
        username: "",
        email: "",
        first_name: "",
        last_name: "",
        is_active: true,
        tenant_id: "",
        contact_cycle_start_date: "",
      });
      setManagerPasswordForm({ password: "", confirmPassword: "" });
      return;
    }

    setManagerEditForm({
      username: manager.username ?? "",
      email: manager.email ?? "",
      first_name: manager.first_name ?? "",
      last_name: manager.last_name ?? "",
      is_active: manager.is_active,
      tenant_id: manager.tenant?.id ? String(manager.tenant.id) : String(DEFAULT_TENANT_ID),
      contact_cycle_start_date: manager.contact_cycle_start_date ?? "",
    });
    setManagerPasswordForm({ password: "", confirmPassword: "" });
  }, []);

  useEffect(() => {
    resetManagerForm(selectedManager);
  }, [resetManagerForm, selectedManager]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateStatus(null);

    if (!token) {
      setCreateStatus("Brak tokenu uwierzytelniającego.");
      return;
    }

    try {
      const payload: Record<string, string> = {
        username: createForm.username,
        email: createForm.email,
        first_name: createForm.first_name,
        last_name: createForm.last_name,
        password: createForm.password,
        tenant_id: String(tenantIdForOperations ?? DEFAULT_TENANT_ID),
      };

      const response = await authorizedFetch(SALES_REPS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const message = errorBody ? JSON.stringify(errorBody) : "Nie udało się dodać handlowca.";
        throw new Error(message);
      }

      setCreateStatus("Handlowiec dodany.");
      setCreateForm({
        username: "",
        email: "",
        first_name: "",
        last_name: "",
        password: "",
        tenant_id: String(tenantIdForOperations ?? DEFAULT_TENANT_ID),
      });
      fetchReps();
    } catch (err) {
      setCreateStatus(err instanceof Error ? err.message : "Nieznany błąd podczas dodawania handlowca.");
    }
  };

  const handleManagerUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedManager) {
      setManagerEditStatus("Wybierz menedżera.");
      return;
    }
    if (!canManageSelectedManager) {
      setManagerEditStatus("Nie masz uprawnień do edycji tego menedżera.");
      return;
    }

    setManagerEditStatus(null);

    try {
      const payload: Record<string, string | boolean | null> = {
        username: managerEditForm.username,
        email: managerEditForm.email,
        first_name: managerEditForm.first_name,
        last_name: managerEditForm.last_name,
        is_active: managerEditForm.is_active,
      };

      if (managerEditForm.tenant_id) {
        payload.tenant_id = managerEditForm.tenant_id;
      }
      payload.contact_cycle_start_date = managerEditForm.contact_cycle_start_date || null;

      const response = await authorizedFetch(`${MANAGERS_ENDPOINT}${selectedManager.id}/`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const message = errorBody ? JSON.stringify(errorBody) : "Nie udało się zaktualizować danych menedżera.";
        throw new Error(message);
      }

      setManagerEditStatus("Dane menedżera zaktualizowane.");
      fetchManagers();
    } catch (err) {
      setManagerEditStatus(
        err instanceof Error ? err.message : "Nieznany błąd podczas zapisu zmian menedżera.",
      );
    }
  };

  const handleManagerPasswordChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedManager) {
      setManagerPasswordStatus("Wybierz menedżera.");
      return;
    }
    if (!canManageSelectedManager) {
      setManagerPasswordStatus("Nie masz uprawnień do zmiany hasła tego menedżera.");
      return;
    }
    if (!managerPasswordForm.password) {
      setManagerPasswordStatus("Hasło jest wymagane.");
      return;
    }
    if (managerPasswordForm.password !== managerPasswordForm.confirmPassword) {
      setManagerPasswordStatus("Hasła nie są zgodne.");
      return;
    }

    try {
      const response = await authorizedFetch(`${MANAGERS_ENDPOINT}${selectedManager.id}/set_password/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password: managerPasswordForm.password }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const message = errorBody ? JSON.stringify(errorBody) : "Nie udało się zmienić hasła menedżera.";
        throw new Error(message);
      }

      setManagerPasswordStatus("Hasło menedżera zaktualizowane.");
      setManagerPasswordForm({ password: "", confirmPassword: "" });
    } catch (err) {
      setManagerPasswordStatus(
        err instanceof Error ? err.message : "Nieznany błąd podczas zmiany hasła menedżera.",
      );
    }
  };

  const handleUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRep) {
      setEditStatus("Wybierz handlowca do edycji.");
      return;
    }

    setEditStatus(null);

    try {
      const payload: Record<string, string | boolean | null> = {
        username: editForm.username,
        email: editForm.email,
        first_name: editForm.first_name,
        last_name: editForm.last_name,
        is_active: editForm.is_active,
      };

      const resolvedTenantId =
        editForm.tenant_id ||
        (tenantIdForOperations ? String(tenantIdForOperations) : null) ||
        (selectedRep.tenant?.id ? String(selectedRep.tenant.id) : String(DEFAULT_TENANT_ID));
      payload.tenant_id = resolvedTenantId;
      payload.contact_cycle_start_date = editForm.contact_cycle_start_date || null;

      const response = await authorizedFetch(`${SALES_REPS_ENDPOINT}${selectedRep.id}/`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const message = errorBody ? JSON.stringify(errorBody) : "Nie udało się zaktualizować danych.";
        throw new Error(message);
      }

      setEditStatus("Dane handlowca zaktualizowane.");
      fetchReps();
    } catch (err) {
      setEditStatus(err instanceof Error ? err.message : "Nieznany błąd podczas zapisu zmian.");
    }
  };

  const handlePasswordChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRep) {
      setPasswordStatus("Wybierz handlowca.");
      return;
    }

    if (!passwordForm.password) {
      setPasswordStatus("Hasło jest wymagane.");
      return;
    }
    if (passwordForm.password !== passwordForm.confirmPassword) {
      setPasswordStatus("Hasła nie są zgodne.");
      return;
    }

    try {
      const response = await authorizedFetch(`${SALES_REPS_ENDPOINT}${selectedRep.id}/set_password/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password: passwordForm.password }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const message = errorBody ? JSON.stringify(errorBody) : "Nie udało się zmienić hasła.";
        throw new Error(message);
      }

      setPasswordStatus("Hasło zaktualizowane.");
      setPasswordForm({ password: "", confirmPassword: "" });
    } catch (err) {
      setPasswordStatus(err instanceof Error ? err.message : "Nieznany błąd podczas zmiany hasła.");
    }
  };

  useEffect(() => {
    setGlobalCycleDraft(selectedTenant?.contact_cycle_start_date ?? "");
  }, [selectedTenant]);

  const shouldRedirectToDashboard = hydrated && currentUser && !hasAdminAccess;

  useEffect(() => {
    if (shouldRedirectToDashboard) {
      router.replace("/dashboard");
    }
  }, [router, shouldRedirectToDashboard]);

  const handleGlobalCycleSave = useCallback(async () => {
    if (!token) {
      setGlobalCycleStatus("Brak uprawnień.");
      return;
    }
    setSavingGlobalCycle(true);
    setGlobalCycleStatus(null);
    try {
      const payload = { start_date: globalCycleDraft || null, tenant_id: selectedTenantId };
      const response = await authorizedFetch(`/api/clients/contact-cycle-start/`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.detail ?? "Nie udało się zapisać dnia zerowego.");
      }
      const updated = await response.json();
      const targetTenantId = updated?.tenant_id ?? selectedTenantId;
      const newDate = updated?.start_date ?? null;
      setTenants((prev) =>
        prev.map((tenant) =>
          tenant.id === targetTenantId
            ? { ...tenant, contact_cycle_start_date: newDate }
            : tenant,
        ),
      );
      setGlobalCycleDraft(newDate ?? "");
      setGlobalCycleStatus("Dzień zerowy zapisany.");
    } catch (err) {
      setGlobalCycleStatus(err instanceof Error ? err.message : "Nie udało się zapisać dnia zerowego.");
    } finally {
      setSavingGlobalCycle(false);
    }
  }, [globalCycleDraft, selectedTenantId, setTenants, token]);

  const updatePurgeState = useCallback((target: PurgeTarget, patch: Partial<{ loading: boolean; status: string | null }>) => {
    setPurgeState((prev) => ({
      ...prev,
      [target]: {
        ...prev[target],
        ...patch,
      },
    }));
  }, []);

  const handlePurge = useCallback(
    async (target: PurgeTarget) => {
      if (!token) {
        updatePurgeState(target, { status: "Brak uprawnień do wykonania operacji." });
        return;
      }
      const confirmationMessage = purgeConfirmations[target];
      const confirmed = window.confirm(confirmationMessage);
      if (!confirmed) {
        return;
      }
      updatePurgeState(target, { loading: true, status: null });
      try {
        const url = new URL(purgeEndpointMap[target]);
        const tenantFilter = tenantIdForOperations ?? DEFAULT_TENANT_ID;
        if (tenantFilter) {
          url.searchParams.set("tenant", String(tenantFilter));
        }
        const response = await authorizedFetch(url.toString(), {
          method: "DELETE",
        });
        if (!response.ok) {
          const errorBody = await response.json().catch(() => null);
          throw new Error(errorBody?.detail ?? "Nie udało się wykonać operacji.");
        }
        const body = await response.json().catch(() => ({}));
        const deleted = typeof body?.deleted === "number" ? body.deleted : null;
        let statusMessage = "Operacja zakończona.";
        if (deleted !== null) {
          statusMessage = deleted === 0 ? "Operacja zakończona. Brak rekordów do usunięcia." : `Operacja zakończona. Usunięto ${deleted} rekordów.`;
        }
        updatePurgeState(target, {
          status: statusMessage,
        });
      } catch (error) {
        updatePurgeState(target, {
          status: error instanceof Error ? error.message : "Wystąpił nieznany błąd podczas usuwania.",
        });
      } finally {
        updatePurgeState(target, { loading: false });
      }
    },
    [tenantIdForOperations, token, updatePurgeState],
  );

  if (!hydrated) {
    return null;
  }

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="glass-card w-full max-w-md space-y-4 p-8 text-center">
          <p className="text-sm font-semibold text-slate-900">
            Dostęp do panelu administracyjnego wymaga zalogowania.
          </p>
        </div>
      </main>
    );
  }

  if (shouldRedirectToDashboard) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="glass-card w-full max-w-md space-y-4 p-8 text-center">
          <p className="text-sm font-semibold text-slate-900">
            Ten panel jest dostępny wyłącznie dla administratorów i menedżerów.
          </p>
          <p className="text-xs text-slate-500">Przekierowuję na główny dashboard…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-6xl space-y-6">
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

        <section className="glass-card p-6">
          <p className="text-xs uppercase tracking-[0.35em] text-emerald-500">Administracja</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-900">Handlowcy i dostęp</h1>
          <p className="text-sm text-slate-600">
            Dodawaj nowych handlowców, aktualizuj ich dane i resetuj hasła bezpośrednio z tego panelu.
          </p>
        </section>

        <section className="glass-card space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Globalny dzień zerowy</h2>
              <p className="text-sm text-slate-500">Ustaw datę startową cyklu kontaktów dla wybranego tenanta.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedTenantId}
              onChange={(e) => setSelectedTenantId(Number(e.target.value))}
              className="rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-600 transition focus:border-blue-500 focus:outline-none"
            >
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={globalCycleDraft}
              onChange={(e) => setGlobalCycleDraft(e.target.value)}
              className="rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-600 transition focus:border-blue-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={!selectedTenantId || !globalCycleDraft || savingGlobalCycle}
              onClick={handleGlobalCycleSave}
              className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {savingGlobalCycle ? "Zapisywanie…" : "Zapisz datę"}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Aktualna data: {selectedTenant?.contact_cycle_start_date ?? "nie ustawiono"}
          </p>
          {globalCycleStatus && <p className="text-sm text-slate-600">{globalCycleStatus}</p>}
        </section>

        <section className="glass-card space-y-4 p-6">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Backup bazy danych</p>
              <h2 className="text-lg font-semibold text-slate-900">Eksport Postgres</h2>
              <p className="text-sm text-slate-600">
                Tworzy plik dump (pg_dump) tylko dla bazy danych. Gotowy plik możesz pobrać na dysk lokalny.
              </p>
            </div>
            <button
              type="button"
              disabled={!canTriggerBackup}
              onClick={handleCreateBackup}
              className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Uruchom backup
            </button>
          </header>
          {backupStatus && <p className="text-sm text-emerald-600">{backupStatus}</p>}
          {backupError && <p className="text-sm text-red-600">{backupError}</p>}
          <div className="rounded-2xl border border-slate-200 bg-white/70 p-5 text-sm text-slate-600">
            {isLoadingBackups ? (
              <p>Ładuję backup…</p>
            ) : latestBackup ? (
              <div className="space-y-2">
                <p>
                  <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Utworzony</span>
                  <br />
                  {new Date(latestBackup.created_at).toLocaleString("pl-PL")}
                </p>
                <p>
                  <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Status</span>
                  <br />
                  {latestBackup.status === "success" && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">Zakończony</span>
                  )}
                  {latestBackup.status === "running" && (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">W trakcie</span>
                  )}
                  {latestBackup.status === "pending" && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">W kolejce</span>
                  )}
                  {latestBackup.status === "error" && (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700">Błąd</span>
                  )}
                  {latestBackup.error_message && latestBackup.status === "error" && (
                    <p className="text-xs text-red-600">{latestBackup.error_message}</p>
                  )}
                </p>
                <div>
                  <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Plik</span>
                  <br />
                  {latestBackup.file ? latestBackup.file.split("/").slice(-1) : "-"}
                </div>
                <div>
                  {latestBackup.status === "success" ? (
                    <button
                      type="button"
                      onClick={() => handleDownloadBackup(latestBackup.id, latestBackup.created_at)}
                      className="inline-flex items-center rounded-2xl border border-blue-200 px-3 py-1 text-xs font-semibold text-blue-700 transition hover:border-blue-400"
                    >
                      Pobierz
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">Brak pliku do pobrania</span>
                  )}
                </div>
              </div>
            ) : (
              <p>Brak wykonanego backupu.</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => fetchBackups().catch(() => undefined)}
            className="rounded-2xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-blue-400"
          >
            Odśwież status backupu
          </button>
        </section>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="glass-card space-y-4 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Lista handlowców</h2>
                <p className="text-sm text-slate-500">
                  Kliknij na handlowca, aby edytować dane lub zmienić hasło.
                </p>
              </div>
              <button
                type="button"
                onClick={fetchReps}
                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-emerald-400 hover:text-emerald-600"
              >
                Odśwież
              </button>
            </div>

            {loading ? (
              <p className="text-sm text-slate-500">Ładuję dane…</p>
            ) : reps.length === 0 ? (
              <p className="text-sm text-slate-500">Brak handlowców do wyświetlenia.</p>
            ) : (
              <div className="space-y-3">
                {reps.map((rep) => {
                  const isSelected = rep.id === selectedRepId;
                  return (
                    <button
                      key={rep.id}
                      type="button"
                      onClick={() => setSelectedRepId(rep.id)}
                      className={`w-full rounded-2xl border px-4 py-3 text-left shadow-sm transition ${
                        isSelected
                          ? "border-emerald-400 bg-emerald-50"
                          : "border-slate-200 bg-white hover:border-emerald-200"
                      }`}
                    >
                      <div className="flex items-center justify-between text-sm">
                        <div>
                          <p className="font-semibold text-slate-900">{rep.username}</p>
                          <p className="text-slate-500">
                            {rep.first_name || rep.last_name
                              ? `${rep.first_name ?? ""} ${rep.last_name ?? ""}`.trim()
                              : "Brak imienia i nazwiska"}
                          </p>
                          {rep.email && (
                            <p className="text-xs text-slate-500">{rep.email}</p>
                          )}
                        </div>
                        <div className="text-right text-xs">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold ${
                              rep.is_active
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-slate-200 text-slate-600"
                            }`}
                          >
                            {rep.is_active ? "Aktywny" : "Zablokowany"}
                          </span>
                          {rep.tenant && (
                            <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-slate-400">
                              {rep.tenant.name}
                            </p>
                          )}
                          {rep.contact_cycle_start_date && (
                            <p className="text-[11px] text-slate-500">
                              Dzień zerowy: {rep.contact_cycle_start_date}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-5 text-sm text-rose-800">
              <p className="text-xs uppercase tracking-[0.3em] text-rose-400">Operacje krytyczne</p>
              <div className="mt-3 space-y-4">
                {purgeTargets.map((target) => {
                  const config = purgeCopy[target];
                  const state = purgeState[target];
                  return (
                    <div key={target} className="rounded-2xl border border-rose-100 bg-white/40 px-4 py-4">
                      <p className="font-semibold text-rose-900">{config.title}</p>
                      <p className="mt-1 text-rose-700">{config.description}</p>
                      <button
                        type="button"
                        onClick={() => handlePurge(target)}
                        disabled={state.loading}
                        className="mt-3 inline-flex w-full items-center justify-center rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {state.loading ? "Usuwanie…" : config.actionLabel}
                      </button>
                      {state.status && <p className="mt-2 text-sm text-rose-800">{state.status}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="space-y-6">
            <div className="glass-card space-y-4 p-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Dodaj handlowca</h2>
                <p className="text-sm text-slate-500">Hasło wymagane przy tworzeniu użytkownika.</p>
              </div>
              <form className="space-y-3" onSubmit={handleCreate}>
                <div>
                  <label className="text-xs uppercase tracking-[0.3em] text-slate-500">Nazwa użytkownika</label>
                  <input
                    type="text"
                    required
                    value={createForm.username}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, username: event.target.value }))}
                    className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-xs uppercase tracking-[0.3em] text-slate-500">Imię</label>
                    <input
                      type="text"
                      value={createForm.first_name}
                      onChange={(event) => setCreateForm((prev) => ({ ...prev, first_name: event.target.value }))}
                      className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-[0.3em] text-slate-500">Nazwisko</label>
                    <input
                      type="text"
                      value={createForm.last_name}
                      onChange={(event) => setCreateForm((prev) => ({ ...prev, last_name: event.target.value }))}
                      className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-[0.3em] text-slate-500">Email</label>
                  <input
                    type="email"
                    value={createForm.email}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, email: event.target.value }))}
                    className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                {isAdmin && (
                  <div>
                    <label className="text-xs uppercase tracking-[0.3em] text-slate-500">Tenant</label>
                    <select
                      value={createForm.tenant_id}
                      onChange={(event) => setCreateForm((prev) => ({ ...prev, tenant_id: event.target.value }))}
                      className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="">– wybierz tenant –</option>
                      {tenants.map((tenant) => (
                        <option key={tenant.id} value={tenant.id}>
                          {tenant.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="text-xs uppercase tracking-[0.3em] text-slate-500">Hasło</label>
                  <input
                    type="password"
                    required
                    value={createForm.password}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, password: event.target.value }))}
                    className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
                >
                  Dodaj handlowca
                </button>
                {createStatus && <p className="text-center text-sm text-slate-600">{createStatus}</p>}
              </form>
            </div>

            <div className="glass-card space-y-4 p-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Edytuj dane</h2>
                <p className="text-sm text-slate-500">
                  Wybierz handlowca z listy, aby uzupełnić formularz.
                </p>
              </div>
              <form className="space-y-3" onSubmit={handleUpdate}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-xs uppercase tracking-[0.3em] text-slate-500">Nazwa użytkownika</label>
                    <input
                      type="text"
                      value={editForm.username}
                      onChange={(event) => setEditForm((prev) => ({ ...prev, username: event.target.value }))}
                      className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-[0.3em] text-slate-500">Email</label>
                    <input
                      type="email"
                      value={editForm.email}
                      onChange={(event) => setEditForm((prev) => ({ ...prev, email: event.target.value }))}
                      className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-xs uppercase tracking-[0.3em] text-slate-500">Imię</label>
                    <input
                      type="text"
                      value={editForm.first_name}
                      onChange={(event) => setEditForm((prev) => ({ ...prev, first_name: event.target.value }))}
                      className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-[0.3em] text-slate-500">Nazwisko</label>
                    <input
                      type="text"
                      value={editForm.last_name}
                      onChange={(event) => setEditForm((prev) => ({ ...prev, last_name: event.target.value }))}
                      className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
                {isAdmin && (
                  <div>
                    <label className="text-xs uppercase tracking-[0.3em] text-slate-500">Tenant</label>
                    <select
                      value={editForm.tenant_id}
                      onChange={(event) => setEditForm((prev) => ({ ...prev, tenant_id: event.target.value }))}
                      className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="">– bez zmian –</option>
                      {tenants.map((tenant) => (
                        <option key={tenant.id} value={tenant.id}>
                          {tenant.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="text-xs uppercase tracking-[0.3em] text-slate-500">Indywidualny dzień zerowy</label>
                  <div className="mt-1 flex gap-2">
                    <input
                      type="date"
                      value={editForm.contact_cycle_start_date}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, contact_cycle_start_date: event.target.value }))
                      }
                      className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                    />
                    {editForm.contact_cycle_start_date && (
                      <button
                        type="button"
                        onClick={() => setEditForm((prev) => ({ ...prev, contact_cycle_start_date: "" }))}
                        className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-rose-200 hover:text-rose-500"
                      >
                        Wyczyść
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="rep-active"
                    type="checkbox"
                    checked={editForm.is_active}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, is_active: event.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <label htmlFor="rep-active" className="text-sm text-slate-600">
                    Konto aktywne
                  </label>
                </div>
                <button
                  type="submit"
                  className="w-full rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Zapisz zmiany
                </button>
                {editStatus && <p className="text-center text-sm text-slate-600">{editStatus}</p>}
              </form>
            </div>

            <div className="glass-card space-y-4 p-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Reset hasła</h2>
                <p className="text-sm text-slate-500">Nowe hasło zostanie nadane natychmiast.</p>
              </div>
              <form className="space-y-3" onSubmit={handlePasswordChange}>
                <div>
                  <label className="text-xs uppercase tracking-[0.3em] text-slate-500">Nowe hasło</label>
                  <input
                    type="password"
                    value={passwordForm.password}
                    onChange={(event) => setPasswordForm((prev) => ({ ...prev, password: event.target.value }))}
                    className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-[0.3em] text-slate-500">Powtórz hasło</label>
                  <input
                    type="password"
                    value={passwordForm.confirmPassword}
                    onChange={(event) =>
                      setPasswordForm((prev) => ({ ...prev, confirmPassword: event.target.value }))
                    }
                    className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-400"
                >
                  Zmień hasło
                </button>
                {passwordStatus && <p className="text-center text-sm text-slate-600">{passwordStatus}</p>}
              </form>
            </div>
          </section>
        </div>

        {hasAdminAccess && (
          <section className="glass-card space-y-6 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Panel menedżerów</h2>
                <p className="text-sm text-slate-500">
                  {isAdmin
                    ? "Zarządzaj administratorami i menedżerami (edycja danych i reset haseł)."
                    : "Zaktualizuj swoje dane i hasło."}
                </p>
              </div>
              <button
                type="button"
                onClick={fetchManagers}
                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-emerald-400 hover:text-emerald-600"
              >
                Odśwież listę
              </button>
            </div>

            {managerError && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {managerError}
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">Lista menedżerów</h3>
                    <p className="text-sm text-slate-500">Tylko użytkownicy z rolą admin/manager.</p>
                  </div>
                </div>

                {managersLoading ? (
                  <p className="text-sm text-slate-500">Ładuję menedżerów…</p>
                ) : managers.length === 0 ? (
                  <p className="text-sm text-slate-500">Brak zdefiniowanych menedżerów.</p>
                ) : (
                  <div className="space-y-3">
                    {managers.map((manager) => {
                      const isSelected = manager.id === selectedManagerId;
                      return (
                        <button
                          key={manager.id}
                          type="button"
                          onClick={() => setSelectedManagerId(manager.id)}
                          className={`w-full rounded-2xl border px-4 py-3 text-left shadow-sm transition ${
                            isSelected
                              ? "border-slate-800 bg-slate-900/90 text-white"
                              : "border-slate-200 bg-white hover:border-slate-300"
                          }`}
                        >
                          <div className="flex items-center justify-between text-sm">
                            <div>
                              <p className={`font-semibold ${isSelected ? "text-white" : "text-slate-900"}`}>
                                {manager.username}
                              </p>
                              <p className={isSelected ? "text-white/80" : "text-slate-500"}>
                                {manager.first_name || manager.last_name
                                  ? `${manager.first_name ?? ""} ${manager.last_name ?? ""}`.trim()
                                  : "Brak imienia i nazwiska"}
                              </p>
                              {manager.email && (
                                <p className={isSelected ? "text-white/70" : "text-xs text-slate-500"}>{manager.email}</p>
                              )}
                            </div>
                            <div className="text-right text-xs">
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold ${
                                  manager.is_active
                                    ? isSelected
                                      ? "bg-white/20 text-white"
                                      : "bg-emerald-100 text-emerald-700"
                                    : isSelected
                                      ? "bg-white/10 text-white"
                                      : "bg-slate-200 text-slate-600"
                                }`}
                              >
                                {manager.is_active ? "Aktywny" : "Zablokowany"}
                              </span>
                              <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-slate-400">
                                {manager.role}
                              </p>
                              {manager.tenant && (
                                <p className="text-[11px] text-slate-500">
                                  {manager.tenant.name}
                                </p>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">Edytuj menedżera</h3>
                    <p className="text-sm text-slate-500">Wybierz menedżera z listy po lewej.</p>
                  </div>
                  <form className="mt-4 space-y-3" onSubmit={handleManagerUpdate}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-xs uppercase tracking-[0.3em] text-slate-500">Nazwa użytkownika</label>
                        <input
                          type="text"
                          value={managerEditForm.username}
                          onChange={(event) =>
                            setManagerEditForm((prev) => ({ ...prev, username: event.target.value }))
                          }
                          className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                          required
                        />
                      </div>
                      <div>
                        <label className="text-xs uppercase tracking-[0.3em] text-slate-500">Email</label>
                        <input
                          type="email"
                          value={managerEditForm.email}
                          onChange={(event) =>
                            setManagerEditForm((prev) => ({ ...prev, email: event.target.value }))
                          }
                          className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-xs uppercase tracking-[0.3em] text-slate-500">Imię</label>
                        <input
                          type="text"
                          value={managerEditForm.first_name}
                          onChange={(event) =>
                            setManagerEditForm((prev) => ({ ...prev, first_name: event.target.value }))
                          }
                          className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-xs uppercase tracking-[0.3em] text-slate-500">Nazwisko</label>
                        <input
                          type="text"
                          value={managerEditForm.last_name}
                          onChange={(event) =>
                            setManagerEditForm((prev) => ({ ...prev, last_name: event.target.value }))
                          }
                          className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-[0.3em] text-slate-500">Tenant</label>
                      <select
                        value={managerEditForm.tenant_id}
                        onChange={(event) =>
                          setManagerEditForm((prev) => ({ ...prev, tenant_id: event.target.value }))
                        }
                        disabled={!isAdmin}
                        className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50"
                      >
                        <option value="">– wybierz –</option>
                        {tenants.map((tenant) => (
                          <option key={tenant.id} value={tenant.id}>
                            {tenant.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-[0.3em] text-slate-500">Indywidualny dzień zerowy</label>
                      <div className="mt-1 flex gap-2">
                        <input
                          type="date"
                          value={managerEditForm.contact_cycle_start_date}
                          onChange={(event) =>
                            setManagerEditForm((prev) => ({ ...prev, contact_cycle_start_date: event.target.value }))
                          }
                          className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                        />
                        {managerEditForm.contact_cycle_start_date && (
                          <button
                            type="button"
                            onClick={() =>
                              setManagerEditForm((prev) => ({ ...prev, contact_cycle_start_date: "" }))
                            }
                            className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-rose-200 hover:text-rose-500"
                          >
                            Wyczyść
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        id="manager-active"
                        type="checkbox"
                        checked={managerEditForm.is_active}
                        onChange={(event) =>
                          setManagerEditForm((prev) => ({ ...prev, is_active: event.target.checked }))
                        }
                        className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                      />
                      <label htmlFor="manager-active" className="text-sm text-slate-600">
                        Konto aktywne
                      </label>
                    </div>
                    <button
                      type="submit"
                      className="w-full rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                      disabled={!canManageSelectedManager}
                    >
                      Zapisz zmiany menedżera
                    </button>
                    {managerEditStatus && (
                      <p className="text-center text-sm text-slate-600">{managerEditStatus}</p>
                    )}
                  </form>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">Reset hasła menedżera</h3>
                    <p className="text-sm text-slate-500">Dostępne tylko dla administratorów.</p>
                  </div>
                  <form className="mt-4 space-y-3" onSubmit={handleManagerPasswordChange}>
                    <div>
                      <label className="text-xs uppercase tracking-[0.3em] text-slate-500">Nowe hasło</label>
                      <input
                        type="password"
                        value={managerPasswordForm.password}
                        onChange={(event) =>
                          setManagerPasswordForm((prev) => ({ ...prev, password: event.target.value }))
                        }
                        className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-[0.3em] text-slate-500">Powtórz hasło</label>
                      <input
                        type="password"
                        value={managerPasswordForm.confirmPassword}
                        onChange={(event) =>
                          setManagerPasswordForm((prev) => ({ ...prev, confirmPassword: event.target.value }))
                        }
                        className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
                      disabled={!canManageSelectedManager}
                    >
                      Zmień hasło
                    </button>
                    {managerPasswordStatus && (
                      <p className="text-center text-sm text-slate-600">{managerPasswordStatus}</p>
                    )}
                  </form>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

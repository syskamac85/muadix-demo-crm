      "use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { authorizedFetch } from "@/lib/auth-fetch";
import { useAuthStore } from "@/store/auth-store";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";
const TENANT_CURRENT_ENDPOINT = `${API_BASE_URL}/api/accounts/tenants/current/`;

const parseContactDaysLabel = (label: string | null | undefined): number | null => {
  if (!label) {
    return null;
  }
  const stripped = label.trim();
  if (!stripped) {
    return null;
  }
  const normalized = stripped.replace(/,/g, ".").split(/\s+/)[0];
  const parsed = Number(normalized);
  if (!Number.isNaN(parsed) && parsed > 0) {
    return Math.round(parsed);
  }
  const digitsOnly = stripped.replace(/[^0-9]/g, "");
  if (digitsOnly) {
    const fallback = Number(digitsOnly);
    if (!Number.isNaN(fallback) && fallback > 0) {
      return fallback;
    }
  }
  return null;
};

const toDateOnlyString = (date: Date) => {
  const tzOffset = date.getTimezoneOffset();
  return new Date(date.getTime() - tzOffset * 60000).toISOString().slice(0, 10);
};

const formatDateDisplay = (value: string | null | undefined) => {
  if (!value) {
    return "";
  }
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

type ClientOption = {
  id: number;
  name: string;
  nip: string;
  street: string;
  city: string;
  postal_code: string;
  classification: string;
  contact_reminder_days: number;
  contact_days_label: string;
  salesman_id: number | null;
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

type ContactRecord = {
  id: number;
  client: { id: number; name?: string } | number | null;
  handler: { id?: number; username: string } | string | null;
  contact_date: string;
  contact_time?: string | null;
  next_contact_at: string | null;
  outcome: string;
  current_comment: string;
  cycle_days?: number | null;
};

type ContactPlanEntry = {
  client_id: number;
  name: string;
  nip: string;
  phone: string;
  email: string;
  city: string;
  salesman_name: string | null;
  cycle_days: number;
  contact_days_label: string;
  contact_cycle_start_date: string | null;
  last_contact_date: string | null;
  recorded_next_contact: string | null;
  due_date: string;
  raw_due_date: string;
  previous_due_date: string | null;
  is_due_on_selected: boolean;
  completed_on_selected: boolean;
};

type ContactPlanResponse = {
  selected_date: string;
  due_on_selected: ContactPlanEntry[];
  entries: ContactPlanEntry[];
  counts: {
    due_on_selected: number;
    total_schedulable: number;
  };
  global_cycle_start_date: string | null;
  next_available_date?: string | null;
};

type CompletionDraft = {
  contactDate: string;
  nextContactAt: string;
  outcome: string;
  currentComment: string;
  approvalReason: string;
};

const daysSince = (isoDate: string | null | undefined): number | null => {
  if (!isoDate) {
    return null;
  }
  const target = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(target.getTime())) {
    return null;
  }
  const today = new Date();
  const diffMs = today.getTime() - target.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
};

type CallHistoryResponse = {
  count: number;
  limit: number;
  offset: number;
  results: ContactRecord[];
};

type SummaryCardProps = {
  label: string;
  value: string | number;
  description: string;
  tone?: "neutral" | "primary" | "warning" | "positive";
};

const summaryToneClasses: Record<NonNullable<SummaryCardProps["tone"]>, string> = {
  neutral: "border-slate-200 bg-white text-slate-900",
  primary: "border-blue-200 bg-blue-50 text-blue-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  positive: "border-emerald-200 bg-emerald-50 text-emerald-900",
};

const SummaryCard = ({ label, value, description, tone = "neutral" }: SummaryCardProps) => {
  const classes = summaryToneClasses[tone] ?? summaryToneClasses.neutral;
  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-sm ${classes}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-current/60">{label}</p>
      <p className="mt-1 text-3xl font-bold leading-tight">{value}</p>
      <p className="mt-1 text-xs text-current/70">{description}</p>
    </div>
  );
};

export default function ContactsPage() {
  const HISTORY_PAGE_SIZE = 5;
  const todayDateString = useMemo(() => toDateOnlyString(new Date()), []);
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);
  const clearAuth = useAuthStore((state) => state.clear);

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [salesmen, setSalesmen] = useState<SalesRepOption[]>([]);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState({
    client: "",
    outcome: "",
    currentComment: "",
    nextContactDays: "7",
    salesman: "",
  });
  const [planDate, setPlanDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [planData, setPlanData] = useState<ContactPlanResponse | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [completedExportFormat, setCompletedExportFormat] = useState<'xlsx' | 'pdf'>('xlsx');
  const [planExportFormat, setPlanExportFormat] = useState<'xlsx' | 'pdf'>('xlsx');
  const [reportDateFrom, setReportDateFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [reportDateTo, setReportDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [reportFormat, setReportFormat] = useState<'pdf' | 'xlsx'>('xlsx');
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [statsHistoryFrom, setStatsHistoryFrom] = useState(() => {
    const today = new Date();
    const from = new Date(today);
    from.setDate(today.getDate() - 6);
    return from.toISOString().slice(0, 10);
  });
  const [statsHistoryTo, setStatsHistoryTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [statsHistoryFormat, setStatsHistoryFormat] = useState<'pdf' | 'xlsx'>('xlsx');
  const [statsHistoryLoading, setStatsHistoryLoading] = useState(false);
  const [statsHistoryError, setStatsHistoryError] = useState<string | null>(null);
  const [statsDate, setStatsDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsData, setStatsData] = useState<{ by_salesman: { salesman: string; scheduled: number; completed: number }[]; total_scheduled: number; total_completed: number } | null>(null);
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [completionDrafts, setCompletionDrafts] = useState<Record<number, CompletionDraft>>({});
  const [completingClientId, setCompletingClientId] = useState<number | null>(null);
  const [planActionFeedback, setPlanActionFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [planReloadFlag, setPlanReloadFlag] = useState(0);
  const [globalCycleStart, setGlobalCycleStart] = useState<string | null>(null);
  const [expandedEntryId, setExpandedEntryId] = useState<number | null>(null);
  const [completedEntries, setCompletedEntries] = useState<Record<number, string>>({});
  const [completedDateFilter, setCompletedDateFilter] = useState(() => new Date().toISOString().slice(0, 10));
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyClient, setHistoryClient] = useState<{ id: number; name: string } | null>(null);
  const [historyRecords, setHistoryRecords] = useState<ContactRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyPagination, setHistoryPagination] = useState({ limit: HISTORY_PAGE_SIZE, offset: 0, count: 0 });
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [userError, setUserError] = useState<string | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const [showMissedOnly, setShowMissedOnly] = useState(false);
  const [planVisibleCount, setPlanVisibleCount] = useState(50);
  const [pendingDeletionClients, setPendingDeletionClients] = useState<Set<number>>(() => new Set());
  const [deleteModal, setDeleteModal] = useState<{ clientId: number; name: string } | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteFeedback, setDeleteFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const isSalesRep = currentUser?.role === "rep";

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
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        setUserError(err instanceof Error ? err.message : "Nieznany błąd pobierania użytkownika.");
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
    if (!hydrated || !token) {
      return;
    }
    if (isSalesRep && !currentUser) {
      return;
    }
    setLoading(true);
    setError(null);

    Promise.all([
      fetch(`${API_BASE_URL}/api/clients/?limit=500`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`${API_BASE_URL}/api/accounts/sales-reps/`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`${API_BASE_URL}/api/call-records/?ordering=-contact_date`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(TENANT_CURRENT_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ])
      .then(async ([clientsRes, repsRes, contactsRes, tenantRes]) => {
        if (!clientsRes.ok) {
          throw new Error("Nie udało się pobrać listy klientów.");
        }
        if (!repsRes.ok) {
          throw new Error("Nie udało się pobrać listy handlowców.");
        }
        if (!contactsRes.ok) {
          throw new Error("Nie udało się pobrać rejestru kontaktów.");
        }
        if (!tenantRes.ok) {
          throw new Error("Nie udało się pobrać ustawień dnia zerowego.");
        }

        const clientsPayload = await clientsRes.json();
        const repsPayload = await repsRes.json();
        const contactsPayload = await contactsRes.json();
        const tenantPayload = await tenantRes.json();

        const normalizedClients: ClientOption[] = (Array.isArray(clientsPayload)
          ? clientsPayload
          : clientsPayload.results ?? []
        ).map((client: any) => {
          const salesmanId =
            typeof client.salesman === "number"
              ? client.salesman
              : typeof client.salesman?.id === "number"
                ? client.salesman.id
                : null;
          return {
            id: client.id,
            name: client.name,
            nip: client.nip ?? "",
            street: client.street ?? "",
            city: client.city ?? "",
            postal_code: client.postal_code ?? "",
            classification: client.classification ?? "",
            contact_reminder_days: Number(client.contact_reminder_days ?? 0) || 0,
            contact_days_label: client.contact_days_label ?? "",
            salesman_id: salesmanId,
          };
        });
        const filteredClients = isSalesRep && currentUser
          ? normalizedClients.filter((client) => client.salesman_id === currentUser.id)
          : normalizedClients;
        setClients(filteredClients);
        setClientsLoaded(true);

        const reps: SalesRepOption[] = (Array.isArray(repsPayload)
          ? repsPayload
          : repsPayload.results ?? []) as SalesRepOption[];
        const filteredReps = isSalesRep && currentUser ? reps.filter((rep) => rep.id === currentUser.id) : reps;
        setSalesmen(filteredReps);
        if (!form.salesman && (isSalesRep ? currentUser : filteredReps[0])) {
          const defaultSalesmanId = isSalesRep && currentUser ? currentUser.id : filteredReps[0]?.id;
          if (defaultSalesmanId) {
            setForm((prev) => ({ ...prev, salesman: String(defaultSalesmanId) }));
          }
        }

        const contactsItemsRaw: ContactRecord[] = Array.isArray(contactsPayload)
          ? contactsPayload
          : contactsPayload.results ?? [];
        const contactsItems: ContactRecord[] = contactsItemsRaw
          .map((record: any) => {
            // Handle handler - can be string (StringRelatedField) or object
            const handlerValue = record.handler;
            let handlerId: number | null = null;
            let handlerUsername: string | null = null;
            
            if (typeof handlerValue === "string") {
              // StringRelatedField returns just the username string
              handlerUsername = handlerValue;
              // Try to find ID from salesmen list
              const matchingRep = reps.find((r) => r.username === handlerValue);
              handlerId = matchingRep?.id ?? null;
            } else if (typeof handlerValue === "number") {
              handlerId = handlerValue;
              const matchingRep = reps.find((r) => r.id === handlerValue);
              handlerUsername = matchingRep?.username ?? "Handlowiec";
            } else if (handlerValue && typeof handlerValue === "object") {
              handlerId = handlerValue.id ?? null;
              handlerUsername = handlerValue.username ?? null;
            }
            
            return {
              ...record,
              handler: handlerUsername
                ? { id: handlerId ?? undefined, username: handlerUsername }
                : null,
            };
          })
          .filter((record) => {
            if (!isSalesRep || !currentUser) {
              return true;
            }
            const handlerId =
              typeof record.handler === "number"
                ? record.handler
                : typeof record.handler?.id === "number"
                  ? record.handler.id
                  : null;
            return handlerId === currentUser.id;
          });
        setContacts(contactsItems);
        setGlobalCycleStart(tenantPayload?.contact_cycle_start_date ?? null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Nieznany błąd podczas ładowania danych.");
      })
      .finally(() => setLoading(false));
  }, [token, hydrated, isSalesRep, currentUser?.id, form.salesman]);

  useEffect(() => {
    if (!hydrated || !token) {
      return;
    }
    if (isSalesRep && (!currentUser || !clientsLoaded)) {
      return;
    }
    const controller = new AbortController();
    setPlanLoading(true);
    setPlanError(null);
    const url = new URL(`${API_BASE_URL}/api/clients/contact-plan/`);
    url.searchParams.set("date", planDate);
    fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.detail ?? "Nie udało się pobrać planu kontaktów.");
        }
        return response.json();
      })
      .then((payload: ContactPlanResponse) => {
        if (!isSalesRep || !currentUser) {
          setPlanData(payload);
          return;
        }
        const allowedClientIds = new Set(clients.map((client) => client.id));
        const filteredEntries = payload.entries.filter((entry) => allowedClientIds.has(entry.client_id));
        const filteredDue = payload.due_on_selected.filter((entry) => allowedClientIds.has(entry.client_id));
        setPlanData({
          ...payload,
          entries: filteredEntries,
          due_on_selected: filteredDue,
          counts: {
            ...payload.counts,
            due_on_selected: filteredDue.length,
            total_schedulable: filteredEntries.length,
          },
        });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setPlanError(err instanceof Error ? err.message : "Błąd pobierania planu.");
      })
      .finally(() => setPlanLoading(false));
    return () => controller.abort();
  }, [hydrated, token, planDate, planReloadFlag, isSalesRep, currentUser?.id, clientsLoaded]);

  useEffect(() => {
    if (!planData) {
      setGlobalCycleStart(null);
      setCompletionDrafts({});
      setExpandedEntryId(null);
      return;
    }
    const nextCompletionDrafts: Record<number, CompletionDraft> = {};
    setGlobalCycleStart(planData.global_cycle_start_date);
    planData.entries.forEach((entry) => {
      nextCompletionDrafts[entry.client_id] = {
            approvalReason: "",
        contactDate: todayDateString,
        nextContactAt: "",
        outcome: "",
        currentComment: "",
      };
    });
    setCompletionDrafts(nextCompletionDrafts);
    setCompletedEntries((prev) => {
      const next: Record<number, string> = {};
      planData.entries.forEach((entry) => {
        if (entry.completed_on_selected) {
          next[entry.client_id] = entry.due_date;
          return;
        }
        if (prev[entry.client_id] && prev[entry.client_id] === entry.due_date) {
          next[entry.client_id] = entry.due_date;
        }
      });
      return next;
    });
    setExpandedEntryId(null);
  }, [planData, todayDateString]);

  useEffect(() => {
    if (!planActionFeedback) {
      return;
    }
    const timeout = window.setTimeout(() => setPlanActionFeedback(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [planActionFeedback]);

  const planEntryMap = useMemo(() => {
    const map = new Map<number, ContactPlanEntry>();
    planData?.entries.forEach((entry) => map.set(entry.client_id, entry));
    return map;
  }, [planData]);

  useEffect(() => {
    if (!deleteFeedback) {
      return;
    }
    const timeout = window.setTimeout(() => setDeleteFeedback(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [deleteFeedback]);

  const openDeleteModal = (entry: ContactPlanEntry) => {
    setDeleteModal({ clientId: entry.client_id, name: entry.name });
    setDeleteReason("");
  };

  const closeDeleteModal = () => {
    if (deleteLoading) {
      return;
    }
    setDeleteModal(null);
    setDeleteReason("");
  };

  const handleClientDeletionRequest = async () => {
    if (!deleteModal || !token) {
      return;
    }
    setDeleteLoading(true);
    setDeleteFeedback(null);
    try {
      const response = await authorizedFetch(`/api/clients/${deleteModal.clientId}/request-deletion/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: deleteReason.trim() || undefined }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const detail = payload?.detail || "Nie udało się wysłać wniosku o usunięcie.";
        throw new Error(detail);
      }
      setPendingDeletionClients((prev) => new Set(prev).add(deleteModal.clientId));
      setDeleteFeedback({ type: "success", text: "Wniosek o usunięcie został wysłany do akceptacji." });
      closeDeleteModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nie udało się wysłać wniosku.";
      setDeleteFeedback({ type: "error", text: message });
    } finally {
      setDeleteLoading(false);
    }
  };

  const selectedPlanClientId = useMemo(() => {
    if (!form.client) {
      return null;
    }
    const parsed = Number(form.client);
    return Number.isFinite(parsed) ? parsed : null;
  }, [form.client]);

  const planEntriesOrdered = useMemo(() => {
    if (!planData) {
      return [] as ContactPlanEntry[];
    }
    // Show only contacts scheduled for the selected date
    const entriesToShow = planData.due_on_selected || [];
    if (!selectedPlanClientId) {
      return entriesToShow;
    }
    const prioritized: ContactPlanEntry[] = [];
    const others: ContactPlanEntry[] = [];
    entriesToShow.forEach((entry) => {
      if (entry.client_id === selectedPlanClientId) {
        prioritized.push(entry);
      } else {
        others.push(entry);
      }
    });
    return [...prioritized, ...others];
  }, [planData, selectedPlanClientId]);

  const suggestNextContactDate = useCallback(
    (entry: ContactPlanEntry): string | null => {
      const cycleDays = Number(entry.cycle_days);
      if (!Number.isFinite(cycleDays) || cycleDays <= 0) {
        return null;
      }
      // Always calculate from the day contact is executed (today)
      const baseDate = new Date(`${todayDateString}T00:00:00`);
      if (Number.isNaN(baseDate.getTime())) {
        return null;
      }
      const nextDate = new Date(baseDate.getTime() + cycleDays * 24 * 60 * 60 * 1000);
      return toDateOnlyString(nextDate);
    },
    [todayDateString],
  );

  const toggleEntryExpansion = (entry: ContactPlanEntry) => {
    setExpandedEntryId((prev) => {
      const isOpening = prev !== entry.client_id;
      if (isOpening) {
        setCompletionDrafts((prevDrafts) => {
          const currentDraft = prevDrafts[entry.client_id];
          if (!currentDraft || currentDraft.nextContactAt) {
            return prevDrafts;
          }
          const suggestion = suggestNextContactDate(entry);
          if (!suggestion) {
            return prevDrafts;
          }
          return {
            ...prevDrafts,
            [entry.client_id]: {
              ...currentDraft,
              nextContactAt: suggestion,
            },
          };
        });
      }
      return isOpening ? entry.client_id : null;
    });
  };

  const handleCompletedExport = async () => {
    if (!token) {
      return;
    }
    try {
      const url = new URL(`${API_BASE_URL}/api/call-records-completed-export/`);
      url.searchParams.set("date", completedDateFilter || new Date().toISOString().slice(0, 10));
      url.searchParams.set("format", completedExportFormat);
      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? "Nie udało się pobrać pliku.");
      }
      const blob = await response.blob();
      const fileURL = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = fileURL;
      link.download = `wykonane_kontakty_${completedDateFilter || "dzis"}.${completedExportFormat}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => window.URL.revokeObjectURL(fileURL), 1000);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Błąd eksportu wykonanych kontaktów.");
    }
  };

  const handleCompletionDraftChange = (
    clientId: number,
    field: keyof CompletionDraft,
    value: string,
  ) => {
    setCompletionDrafts((prev) => {
      const current =
        prev[clientId] ?? {
          contactDate: todayDateString,
          nextContactAt: "",
          outcome: "",
          currentComment: "",
        };
      return {
        ...prev,
        [clientId]: {
          ...current,
          [field]: value,
        },
      };
    });
  };

  const handleMarkCompleted = async (clientId: number) => {
    if (!token) {
      return;
    }
    const draft =
      completionDrafts[clientId] ?? {
        contactDate: todayDateString,
        nextContactAt: "",
        outcome: "",
        currentComment: "",
      };
    const contactDate = draft.contactDate || todayDateString;
    if (draft.nextContactAt) {
      const nextDate = new Date(`${draft.nextContactAt}T00:00:00`);
      const todayDate = new Date(`${todayDateString}T00:00:00`);
      if (!(nextDate > todayDate)) {
        setPlanActionFeedback({
          type: "error",
          text: "Następny termin musi być późniejszy niż dzisiaj.",
        });
        return;
      }
    }
    setCompletingClientId(clientId);
    setPlanActionFeedback(null);
    try {
      const payload: Record<string, unknown> = {
        contact_date: contactDate,
        outcome: draft.outcome,
        current_comment: draft.currentComment,
      };
      if (draft.nextContactAt) {
        payload.next_contact_at = draft.nextContactAt;
      }
      if (draft.approvalReason?.trim()) {
        payload.approval_reason = draft.approvalReason.trim();
      }
      const response = await fetch(`${API_BASE_URL}/api/clients/${clientId}/contact-plan/complete/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? "Nie udało się oznaczyć kontaktu.");
      }
      const created = await response.json();
      setContacts((prev) => [created, ...prev]);
      const approvalMsg = created.approval_required
        ? " Następny termin przekracza 2× cykl klienta – wniosek wysłany do akceptacji managera."
        : "";
      setPlanActionFeedback({ type: "success", text: `Kontakt oznaczony jako wykonany.${approvalMsg}` });
      setPlanReloadFlag((prev) => prev + 1);
      setCompletionDrafts((prev) => ({
        ...prev,
        [clientId]: {
          contactDate,
          nextContactAt: "",
          outcome: "",
          currentComment: "",
          approvalReason: "",
        },
      }));
      const currentDueDate = planEntryMap.get(clientId)?.due_date ?? draft.contactDate;
      setCompletedEntries((prev) => ({
        ...prev,
        [clientId]: currentDueDate,
      }));
      setExpandedEntryId((prev) => (prev === clientId ? null : prev));
      fetchStats();
    } catch (err) {
      setPlanActionFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Błąd podczas oznaczania kontaktu.",
      });
    } finally {
      setCompletingClientId(null);
    }
  };

  const clientNameMap = useMemo(() => {
    const map = new Map<number, string>();
    clients.forEach((client) => map.set(client.id, client.name));
    return map;
  }, [clients]);

  const resolveClientName = (record: ContactRecord) => {
    const clientRef = record.client;
    if (clientRef === null || clientRef === undefined) {
      return "Klient";
    }
    if (typeof clientRef === "number") {
      return clientNameMap.get(clientRef) ?? "Klient";
    }
    if (clientRef.name) {
      return clientRef.name;
    }
    if (clientRef.id && clientNameMap.has(clientRef.id)) {
      return clientNameMap.get(clientRef.id) ?? "Klient";
    }
    return "Klient";
  };

  const resolveHandlerName = (record: ContactRecord) => {
    const handler = record.handler;
    if (typeof handler === "string") {
      return handler;
    }
    return handler?.username ?? "Handlowiec";
  };

  const fetchClientHistory = useCallback(
    async (clientId: number, nextOffset = 0) => {
      if (!token) {
        return;
      }
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const url = new URL(`${API_BASE_URL}/api/clients/${clientId}/call-history/`);
        url.searchParams.set("limit", String(HISTORY_PAGE_SIZE));
        url.searchParams.set("offset", String(nextOffset));
        const response = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.detail ?? "Nie udało się pobrać historii kontaktów.");
        }
        const payload: CallHistoryResponse = await response.json();
        setHistoryRecords(payload.results);
        setHistoryPagination({
          limit: payload.limit,
          offset: payload.offset,
          count: payload.count,
        });
      } catch (err) {
        setHistoryError(err instanceof Error ? err.message : "Błąd pobierania historii kontaktów.");
      } finally {
        setHistoryLoading(false);
      }
    },
    [token],
  );

  const openHistoryModal = (clientId: number, clientName: string) => {
    setHistoryClient({ id: clientId, name: clientName });
    setHistoryRecords([]);
    setHistoryPagination({ limit: HISTORY_PAGE_SIZE, offset: 0, count: 0 });
    setHistoryModalOpen(true);
    fetchClientHistory(clientId, 0);
  };

  const closeHistoryModal = () => {
    setHistoryModalOpen(false);
    setHistoryClient(null);
    setHistoryRecords([]);
    setHistoryPagination({ limit: HISTORY_PAGE_SIZE, offset: 0, count: 0 });
    setHistoryError(null);
  };

  const handleHistoryPageChange = (direction: "next" | "prev") => {
    if (!historyClient) {
      return;
    }
    const { limit, offset, count } = historyPagination;
    if (direction === "prev" && offset === 0) {
      return;
    }
    if (direction === "next" && offset + limit >= count) {
      return;
    }
    const nextOffset = direction === "next" ? offset + limit : Math.max(0, offset - limit);
    fetchClientHistory(historyClient.id, nextOffset);
  };

  const completedOnSelectedDate = useMemo(() => {
    const target = completedDateFilter;
    if (!target) {
      return [] as ContactRecord[];
    }
    return contacts
      .filter((record) => record.contact_date?.slice(0, 10) === target)
      .sort((a, b) => new Date(b.contact_date).getTime() - new Date(a.contact_date).getTime());
  }, [contacts, completedDateFilter]);

  const filteredClients = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return clients;
    }
    return clients.filter((client) =>
      [client.name, client.city, client.street, client.nip].filter(Boolean).some((value) =>
        value?.toLowerCase().includes(query),
      ),
    );
  }, [searchQuery, clients]);

  const missedEntries = useMemo(() => {
    if (!planData?.entries?.length) {
      return [] as ContactPlanEntry[];
    }
    // Get all entries that are not completed, from all dates
    const entries = planData.entries.filter((entry) => {
      return !entry.completed_on_selected;
    });
    return entries
      .map((entry) => {
        const daysWithoutContact = entry.last_contact_date ? daysSince(entry.last_contact_date) : null;
        return {
          entry,
          gapDays: daysWithoutContact ?? Number.POSITIVE_INFINITY,
        };
      })
      .sort((a, b) => b.gapDays - a.gapDays)
      .map((item) => item.entry);
  }, [planData]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      return;
    }
    if (!form.client && filteredClients.length === 1) {
      const onlyClient = filteredClients[0];
      setForm((prev) => ({ ...prev, client: String(onlyClient.id) }));
    }
  }, [filteredClients, form.client, searchQuery]);

  const selectedClient = useMemo(() => {
    return clients.find((client) => String(client.id) === form.client) ?? null;
  }, [clients, form.client]);

  const derivedReminderDays = useMemo(() => {
    if (!selectedClient) {
      return null;
    }

    if (selectedClient.contact_reminder_days && selectedClient.contact_reminder_days > 0) {
      return selectedClient.contact_reminder_days;
    }

    const parsedLabel = parseContactDaysLabel(selectedClient.contact_days_label);
    if (parsedLabel && parsedLabel > 0) {
      return parsedLabel;
    }

    const planEntry = planEntryMap.get(selectedClient.id);
    if (planEntry) {
      const cycleDays = Number(planEntry.cycle_days);
      if (Number.isFinite(cycleDays) && cycleDays > 0) {
        return cycleDays;
      }
    }

    return null;
  }, [selectedClient, planEntryMap]);

  useEffect(() => {
    if (derivedReminderDays === null) {
      return;
    }
    setForm((prev) => {
      const nextValue = String(derivedReminderDays);
      if (prev.nextContactDays === nextValue) {
        return prev;
      }
      return {
        ...prev,
        nextContactDays: nextValue,
      };
    });
  }, [derivedReminderDays]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      return;
    }
    if (!form.client) {
      setStatusMessage("Wybierz klienta.");
      return;
    }
    const clientId = Number(form.client);
    setIsSubmitting(true);
    setStatusMessage(null);
    try {
      const baseDate = new Date(`${todayDateString}T00:00:00`);
      if (Number.isNaN(baseDate.getTime())) {
        throw new Error("Niepoprawna data kontaktu.");
      }
      const reminderDays = Number(form.nextContactDays) || 0;
      const nextContactDate =
        reminderDays > 0
          ? new Date(baseDate.getTime() + reminderDays * 24 * 60 * 60 * 1000)
          : null;

      const payload = {
        client: Number(form.client),
        contact_date: todayDateString,
        next_contact_at: nextContactDate ? toDateOnlyString(nextContactDate) : null,
        current_comment: form.currentComment,
        salesman: form.salesman || undefined,
      };

      const response = await fetch(`${API_BASE_URL}/api/call-records/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? "Nie udało się zapisać kontaktu.");
      }

      const savedData = await response.json().catch(() => null);
      const approvalNote = savedData?.approval_required
        ? " Następny termin przekracza 2× cykl klienta – wniosek wysłany do akceptacji managera."
        : "";
      setStatusMessage(`Kontakt zapisany.${approvalNote}`);
      setForm((prev) => ({
        ...prev,
        currentComment: "",
      }));

      const refreshed = await fetch(`${API_BASE_URL}/api/call-records/?ordering=-contact_date`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (refreshed.ok) {
        const payload = await refreshed.json();
        setContacts(Array.isArray(payload) ? payload : payload.results ?? []);
      }
      const dueDate = Number.isFinite(clientId) ? planEntryMap.get(clientId)?.due_date : null;
      if (dueDate) {
        setCompletedEntries((prev) => ({
          ...prev,
          [clientId]: dueDate,
        }));
      }
      setPlanReloadFlag((prev) => prev + 1);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Błąd podczas zapisu kontaktu.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = () => {
    clearAuth();
    router.replace("/auth/login");
  };

  const formatRepName = (rep: SalesRepOption) => {
    if (rep.first_name || rep.last_name) {
      return `${rep.first_name ?? ""} ${rep.last_name ?? ""}`.trim();
    }
    return rep.username;
  };

  const handleReportDownload = async () => {
    if (!token) return;
    setReportLoading(true);
    setReportError(null);
    try {
      const url = new URL(`${API_BASE_URL}/api/clients/contact-report/`);
      url.searchParams.set("date_from", reportDateFrom);
      url.searchParams.set("date_to", reportDateTo);
      url.searchParams.set("format", reportFormat);
      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? "Nie udało się pobrać raportu.");
      }
      const blob = await response.blob();
      const fileURL = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = fileURL;
      link.download = `raport_kontaktow_${reportDateFrom}_${reportDateTo}.${reportFormat}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => window.URL.revokeObjectURL(fileURL), 1000);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Błąd pobierania raportu.");
    } finally {
      setReportLoading(false);
    }
  };

  const fetchStats = useCallback(async () => {
    if (!token) return;
    setStatsLoading(true);
    setStatsError(null);
    try {
      const url = new URL(`${API_BASE_URL}/api/clients/contact-stats/`);
      url.searchParams.set("date", statsDate);
      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? "Nie udało się pobrać statystyk.");
      }
      const data = await response.json();
      setStatsData({
        by_salesman: data.by_salesman || [],
        total_scheduled: data.total_scheduled || 0,
        total_completed: data.total_completed || 0,
      });
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : "Błąd statystyk.");
    } finally {
      setStatsLoading(false);
    }
  }, [token, statsDate]);

  useEffect(() => {
    // Sync stats date with plan date
    setStatsDate(planDate);
  }, [planDate]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleStatsHistoryExport = async () => {
    if (!token) {
      return;
    }
    setStatsHistoryLoading(true);
    setStatsHistoryError(null);
    try {
      const url = new URL(`${API_BASE_URL}/api/clients/contact-stats/history/`);
      url.searchParams.set("date_from", statsHistoryFrom);
      url.searchParams.set("date_to", statsHistoryTo);
      url.searchParams.set("format", statsHistoryFormat);
      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? "Nie udało się wygenerować raportu statystyk.");
      }
      const blob = await response.blob();
      const fileURL = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = fileURL;
      link.download = `statystyki_kontaktow_${statsHistoryFrom}_${statsHistoryTo}.${statsHistoryFormat}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => window.URL.revokeObjectURL(fileURL), 1000);
    } catch (error) {
      setStatsHistoryError(error instanceof Error ? error.message : "Błąd pobierania raportu statystyk.");
    } finally {
      setStatsHistoryLoading(false);
    }
  };

  const handlePlanExport = async () => {
    if (!token) return;
    try {
      const url = new URL(`${API_BASE_URL}/api/clients/contact-plan/`);
      url.searchParams.set("date", planDate);
      url.searchParams.set("export", planExportFormat);
      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? "Nie udało się pobrać pliku.");
      }
      const blob = await response.blob();
      const fileURL = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = fileURL;
      link.download = `plan_kontaktow_${planDate}.${planExportFormat}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => window.URL.revokeObjectURL(fileURL), 1000);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Błąd eksportu planu.");
    }
  };

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

        <header className="glass-card p-6">
          <p className="text-xs uppercase tracking-[0.35em] text-blue-500">Kontakty</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Rejestr kontaktów</h1>
          <p className="text-sm text-slate-600">
            Zapisuj rozmowy telefoniczne, planuj przypomnienia i śledź historię kontaktów.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <section className="glass-card space-y-4 p-4">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">Raport PDF/xlsx</h3>
              <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
                <div>
                  <label className="text-xs uppercase tracking-[0.35em] text-slate-500">Data od</label>
                  <input
                    type="date"
                    value={reportDateFrom}
                    onChange={(e) => setReportDateFrom(e.target.value)}
                    className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-[0.35em] text-slate-500">Data do</label>
                  <input
                    type="date"
                    value={reportDateTo}
                    onChange={(e) => setReportDateTo(e.target.value)}
                    className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-[0.35em] text-slate-500">Format</label>
                  <select
                    value={reportFormat}
                    onChange={(e) => setReportFormat(e.target.value as 'pdf' | 'xlsx')}
                    className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="pdf">PDF</option>
                    <option value="xlsx">XLSX</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleReportDownload}
                  disabled={reportLoading}
                  className="w-full rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                  {reportLoading ? "Pobieram…" : "Pobierz raport"}
                </button>
                {reportError && <p className="text-xs text-red-600">{reportError}</p>}
              </div>
            </div>
            <form className="space-y-3" onSubmit={handleSubmit}>
              <div className="rounded-2xl border border-slate-200 p-4">
                <label className="text-xs uppercase tracking-[0.35em] text-slate-500">Wyszukaj klienta</label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="np. Annopol lub Warszawa"
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
                {searchQuery.trim() && (
                  <div className="mt-3 max-h-48 space-y-1 overflow-y-auto rounded-2xl border border-slate-100 bg-slate-50/80 p-2 text-sm shadow-inner">
                    {filteredClients.length ? (
                      filteredClients.slice(0, 8).map((client) => (
                        <button
                          key={client.id}
                          type="button"
                          onClick={() => {
                            setForm((prev) => ({ ...prev, client: String(client.id) }));
                            setSearchQuery(client.name);
                          }}
                          className="flex w-full flex-col rounded-xl px-3 py-2 text-left transition hover:bg-white"
                        >
                          <span className="font-semibold text-slate-900">{client.name}</span>
                          <span className="text-xs text-slate-500">{client.city || "Brak miasta"}</span>
                        </button>
                      ))
                    ) : (
                      <p className="px-2 py-1 text-xs text-slate-500">Brak klientów dla podanego wyszukiwania.</p>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  Data kontaktu
                </label>
                <div className="mt-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-sm font-semibold text-slate-900">
                    {formatDateDisplay(todayDateString)}
                  </p>
                  <p className="text-xs text-slate-500">Ustalona automatycznie na dzisiaj.</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs uppercase tracking-[0.3em] text-slate-500">
                    Przypomnienie (dni)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={form.nextContactDays}
                    onChange={(event) => {
                      const value = event.target.value;
                      setForm((prev) => ({ ...prev, nextContactDays: value }));
                      const parsed = Number(value);
                      const clientId = Number(form.client);
                      if (!token || !form.client || !Number.isFinite(parsed) || parsed < 0) {
                        return;
                      }
                      fetch(`${API_BASE_URL}/api/clients/${clientId}/`, {
                        method: "PATCH",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({ contact_reminder_days: parsed, contact_days_label: String(parsed) }),
                      })
                        .then((response) => {
                          if (!response.ok) {
                            throw new Error("Nie udało się zaktualizować cyklu kontaktu.");
                          }
                          setClients((prev) =>
                            prev.map((client) =>
                              client.id === clientId
                                ? { ...client, contact_reminder_days: parsed, contact_days_label: String(parsed) }
                                : client,
                            ),
                          );
                        })
                        .catch((err) => {
                          setStatusMessage(err instanceof Error ? err.message : "Błąd zapisu cyklu.");
                        });
                    }}
                    className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-[0.3em] text-slate-500">
                    Notatka
                  </label>
                  <textarea
                    value={form.currentComment}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, currentComment: event.target.value }))
                    }
                    rows={10}
                    placeholder="Dodaj notatkę z rozmowy"
                    className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  Handlowiec
                </label>
                <div className="mt-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  {(() => {
                    if (!selectedClient || !selectedClient.salesman_id) {
                      return "Bieżący użytkownik";
                    }
                    const rep = salesmen.find((s) => s.id === selectedClient.salesman_id);
                    return rep ? formatRepName(rep) : "Bieżący użytkownik";
                  })()}
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {isSubmitting ? "Zapisuję…" : "Zapisz kontakt"}
              </button>
              {statusMessage && (
                <p className="text-center text-sm text-slate-600">{statusMessage}</p>
              )}
            </form>
          </section>

          <section className="space-y-6">
            {statsData && (
              <div className="glass-card space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Statystyki na dzień</h3>
                    <p className="text-xs text-slate-500">Suma zaplanowanych i wykonanych kontaktów na {planDate}.</p>
                  </div>
                </div>
                {statsLoading && <p className="text-sm text-slate-500">Ładuję statystyki…</p>}
                {statsError && !statsLoading && <p className="text-sm text-red-600">{statsError}</p>}
                {!statsLoading && !statsError && statsData && (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-xs text-slate-600">
                      <div className="grid gap-3 md:grid-cols-4">
                        <label className="space-y-1">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">Historia od</span>
                          <input
                            type="date"
                            value={statsHistoryFrom}
                            onChange={(event) => setStatsHistoryFrom(event.target.value)}
                            className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">Historia do</span>
                          <input
                            type="date"
                            value={statsHistoryTo}
                            onChange={(event) => setStatsHistoryTo(event.target.value)}
                            className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">Format</span>
                          <select
                            value={statsHistoryFormat}
                            onChange={(event) => setStatsHistoryFormat(event.target.value as 'pdf' | 'xlsx')}
                            className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 focus:border-blue-500 focus:outline-none"
                          >
                            <option value="xlsx">XLSX</option>
                            <option value="pdf">PDF</option>
                          </select>
                        </label>
                        <div className="flex flex-col justify-end">
                          <button
                            type="button"
                            onClick={handleStatsHistoryExport}
                            disabled={statsHistoryLoading}
                            className="w-full rounded-2xl border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-600 transition hover:border-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {statsHistoryLoading ? "Generuję…" : "Pobierz historię"}
                          </button>
                          {statsHistoryError && (
                            <span className="mt-1 text-[11px] text-red-600">{statsHistoryError}</span>
                          )}
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500">
                        Raport zawiera dzienne zestawienie: liczba zaplanowanych i wykonanych połączeń.
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <SummaryCard label="Zaplanowane" value={statsData.total_scheduled} description="kontakty do wykonania" tone="primary" />
                      <SummaryCard label="Wykonane" value={statsData.total_completed} description="kontakty zrealizowane" tone="positive" />
                    </div>
                    {!isSalesRep && (
                      <div className="rounded-2xl border border-slate-200 p-4">
                        <h4 className="text-sm font-semibold text-slate-900 mb-3">Szczegóły wg handlowców</h4>
                        <div className="space-y-2">
                          {statsData.by_salesman.map((item) => (
                            <div key={item.salesman} className="flex justify-between items-center py-2 border-b border-slate-100 last:border-0">
                              <span className="text-sm text-slate-700">{item.salesman}</span>
                              <div className="flex gap-4 text-sm">
                                <span className="text-blue-600 font-medium">{item.scheduled} zapl.</span>
                                <span className="text-emerald-600 font-medium">{item.completed} wykon.</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {planActionFeedback && (
              <div
                className={`rounded-2xl border px-3 py-2 text-sm ${
                  planActionFeedback.type === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-rose-200 bg-rose-50 text-rose-700"
                }`}
              >
                {planActionFeedback.text}
              </div>
            )}
            <div className="glass-card space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Harmonogram kontaktów</h2>
                  <p className="text-xs text-slate-500">
                    Lista cyklicznych kontaktów z przesunięciem na dni robocze.
                    {" "}
                    {globalCycleStart ? `Dzień zerowy: ${globalCycleStart}` : "Dzień zerowy nieustawiony."}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={planDate}
                    onChange={(event) => { setPlanDate(event.target.value); setPlanVisibleCount(50); }}
                    className="rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                  <select
                    value={planExportFormat}
                    onChange={(event) => setPlanExportFormat(event.target.value as 'xlsx' | 'pdf')}
                    className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="xlsx">XLSX</option>
                    <option value="pdf">PDF</option>
                  </select>
                  <button
                    type="button"
                    onClick={handlePlanExport}
                    className="rounded-2xl border border-blue-100 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:border-blue-300"
                  >
                    Eksportuj
                  </button>
                </div>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                  <input
                    type="checkbox"
                    checked={showMissedOnly}
                    onChange={(event) => { setShowMissedOnly(event.target.checked); setPlanVisibleCount(50); }}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  Pokaż tylko klientów bez potwierdzonego kontaktu (sortuj od najdłuższej przerwy)
                </label>
              </div>
              {planLoading && <p className="text-sm text-slate-500">Ładuję harmonogram…</p>}
              {planError && !planLoading && (
                <p className="text-sm text-red-600">{planError}</p>
              )}
              {!planLoading && !planError && planData && planData.entries.length === 0 && (
                <p className="text-sm text-slate-500">Brak klientów z ustawionym cyklem kontaktu.</p>
              )}
              {planData && planData.entries.length > 0 && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-100 bg-white p-3 text-xs text-slate-600">
                    {showMissedOnly ? (
                      <p>
                        Lista wszystkich klientów z niewykonanymi kontaktami (wszystkie daty). Posortowano malejąco po dniach od ostatniego kontaktu.
                      </p>
                    ) : (
                      <p>
                        Plan na <span className="font-semibold text-slate-900">{planData.selected_date}</span>:{" "}
                        {planData.counts.due_on_selected} kontaktów do wykonania.
                      </p>
                    )}
                  </div>
                  <div className="space-y-3">
                    {(showMissedOnly ? missedEntries : planEntriesOrdered).length > 0 ? (
                      (showMissedOnly ? missedEntries : planEntriesOrdered).slice(0, planVisibleCount).map((entry) => {
                      const completedForDueDate = completedEntries[entry.client_id];
                      const isCompleted = completedForDueDate === entry.due_date;
                      const isExpanded = expandedEntryId === entry.client_id;
                      const showDetails = !isCompleted || isExpanded;
                      const baseTone = isCompleted
                        ? "border-emerald-300 bg-emerald-50"
                        : entry.is_due_on_selected
                          ? "border-blue-300 bg-blue-50"
                          : "border-slate-200 bg-white";
                      return (
                        <div
                          key={`${entry.client_id}-${entry.due_date}`}
                          className={`rounded-2xl border px-3 py-3 text-sm shadow-sm transition ${baseTone}`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="font-semibold text-slate-900">{entry.name}</p>
                              <p className="text-xs text-slate-500">
                                {entry.nip || "brak NIP"} • {entry.city || "brak miasta"}
                              </p>
                              <p className="text-xs text-slate-500">
                                Telefon: {entry.phone || "brak danych"}
                              </p>
                              <p className="text-xs text-slate-500">
                                E-mail: {entry.email || "brak danych"}
                              </p>
                            </div>
                            <div className="text-right text-xs text-slate-500">
                              <p>
                                Kolejny kontakt: <span className="font-semibold text-slate-900">{entry.due_date}</span>
                              </p>
                              {entry.previous_due_date && <p>Poprzedni termin: {entry.previous_due_date}</p>}
                            </div>
                          </div>
                          {showDetails ? (
                            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                              <span>
                                Cykl: {entry.cycle_days} dni
                              </span>
                              {entry.salesman_name && <span>Handlowiec: {entry.salesman_name}</span>}
                              {entry.last_contact_date && <span>Ostatni kontakt: {entry.last_contact_date}</span>}
                              {isCompleted && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">
                                  <span className="text-[0.6rem] font-semibold uppercase tracking-[0.2em]">Wykonano</span>
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="mt-2 flex items-center gap-2 text-xs text-emerald-700">
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">
                                <span className="text-[0.6rem] font-semibold uppercase tracking-[0.2em]">Wykonano</span>
                              </span>
                              <span>Zapis kontaktu dostępny do edycji.</span>
                            </div>
                          )}
                          <div className="mt-3">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => toggleEntryExpansion(entry)}
                                className="rounded-2xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400"
                              >
                                {isExpanded
                                  ? "Zwiń"
                                  : isCompleted
                                    ? "Edytuj kontakt"
                                    : "Oznacz wykonanie"}
                              </button>
                              <button
                                type="button"
                                onClick={() => openHistoryModal(entry.client_id, entry.name)}
                                className="rounded-2xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400"
                              >
                                Wyświetl historię
                              </button>
                              <button
                                type="button"
                                onClick={() => openDeleteModal(entry)}
                                disabled={pendingDeletionClients.has(entry.client_id)}
                                className="rounded-2xl border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:border-rose-300 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {pendingDeletionClients.has(entry.client_id) ? "Wniosek wysłany" : "Usuń klienta"}
                              </button>
                            </div>
                            {!isExpanded && (
                              <p className="mt-1 text-xs text-slate-500">
                                {isCompleted
                                  ? "Kontakt oznaczony. Kliknij, by edytować notatkę."
                                  : "Kliknij, aby uzupełnić szczegóły wykonania."}
                              </p>
                            )}
                            {isExpanded && (
                              <div className="mt-3 rounded-2xl border border-slate-100 bg-white p-3">
                                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                                  {isCompleted ? "Edytuj kontakt" : "Oznacz wykonanie"}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  Rejestruj kontakt i zaplanuj kolejny termin.
                                </p>
                                <div className="mt-3 grid gap-2 text-xs">
                                  <div className="rounded-2xl border border-slate-200 px-3 py-2">
                                    <span className="text-[0.65rem] uppercase tracking-[0.2em] text-slate-400">
                                      Data kontaktu
                                    </span>
                                    <p className="text-sm font-semibold text-slate-900">
                                      {formatDateDisplay(
                                        completionDrafts[entry.client_id]?.contactDate ?? todayDateString,
                                      )}
                                    </p>
                                    <p className="text-xs text-slate-500">Ustalona automatycznie na dzisiaj.</p>
                                  </div>
                                  <label className="flex flex-col gap-1">
                                    <span className="text-[0.65rem] uppercase tracking-[0.2em] text-slate-400">Następny termin</span>
                                    <input
                                      type="date"
                                      value={completionDrafts[entry.client_id]?.nextContactAt ?? ""}
                                      onChange={(event) =>
                                        handleCompletionDraftChange(entry.client_id, "nextContactAt", event.target.value)
                                      }
                                      className="rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                                    />
                                  </label>
                                  {(() => {
                                    const nextVal = completionDrafts[entry.client_id]?.nextContactAt;
                                    const contactVal = completionDrafts[entry.client_id]?.contactDate ?? todayDateString;
                                    const cycleDays = Number(entry.cycle_days);
                                    if (!nextVal || !Number.isFinite(cycleDays) || cycleDays <= 0) return null;
                                    const proposed = Math.round((new Date(`${nextVal}T00:00:00`).getTime() - new Date(`${contactVal}T00:00:00`).getTime()) / 86400000);
                                    if (proposed <= 2 * cycleDays) return null;
                                    return (
                                      <label className="flex flex-col gap-1">
                                        <span className="text-[0.65rem] uppercase tracking-[0.2em] text-orange-500">
                                          Uzasadnienie przedłużonego terminu
                                        </span>
                                        <textarea
                                          placeholder="Podaj powód ustawienia terminu powyżej 2× cyklu klienta…"
                                          value={completionDrafts[entry.client_id]?.approvalReason ?? ""}
                                          onChange={(event) =>
                                            handleCompletionDraftChange(entry.client_id, "approvalReason", event.target.value)
                                          }
                                          className="min-h-[60px] rounded-2xl border border-orange-200 bg-orange-50/60 px-3 py-2 text-sm text-slate-900 focus:border-orange-400 focus:outline-none"
                                        />
                                      </label>
                                    );
                                  })()}
                                  <textarea
                                    placeholder="Notatka"
                                    value={completionDrafts[entry.client_id]?.currentComment ?? ""}
                                    onChange={(event) =>
                                      handleCompletionDraftChange(entry.client_id, "currentComment", event.target.value)
                                    }
                                    className="min-h-[70px] rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleMarkCompleted(entry.client_id)}
                                  disabled={completingClientId === entry.client_id || isCompleted}
                                  className="mt-3 w-full rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
                                >
                                  {isCompleted
                                    ? "Kontakt oznaczony"
                                    : completingClientId === entry.client_id
                                      ? "Zapisywanie…"
                                      : "Kontakt wykonany"}
                                </button>
                                {isCompleted && (
                                  <button
                                    type="button"
                                    onClick={() => toggleEntryExpansion(entry)}
                                    className="mt-2 w-full rounded-2xl border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:border-emerald-300"
                                  >
                                    Edytuj kontakt
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }) ) : (
                      <p className="text-sm text-slate-500">
                        {showMissedOnly 
                          ? "Brak klientów z niewykonanymi kontaktami." 
                          : "Brak kontaktów zaplanowanych na wybraną datę."}
                      </p>
                    )}
                    {(() => {
                      const activeList = showMissedOnly ? missedEntries : planEntriesOrdered;
                      const total = activeList.length;
                      if (total <= 50) return null;
                      return (
                        <div className="flex flex-wrap items-center gap-3 pt-2">
                          <p className="text-xs text-slate-500">
                            Wyświetlono {Math.min(planVisibleCount, total)} z {total} pozycji.
                          </p>
                          {planVisibleCount < total && (
                            <button
                              type="button"
                              onClick={() => setPlanVisibleCount((prev) => Math.min(prev + 50, total))}
                              className="rounded-xl border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-blue-400 hover:text-blue-600"
                            >
                              Pokaż kolejne {Math.min(50, total - planVisibleCount)}
                            </button>
                          )}
                          {planVisibleCount < total && (
                            <button
                              type="button"
                              onClick={() => setPlanVisibleCount(total)}
                              className="rounded-xl border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-blue-400 hover:text-blue-600"
                            >
                              Pokaż wszystkie ({total})
                            </button>
                          )}
                          {planVisibleCount >= total && total > 50 && (
                            <button
                              type="button"
                              onClick={() => setPlanVisibleCount(50)}
                              className="rounded-xl border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-500 transition hover:border-slate-400"
                            >
                              Zwiń do 50
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>

            <div className="glass-card space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Wykonane kontakty</h2>
                  <p className="text-xs text-slate-500">Lista zapisów wykonanych w wybranym dniu.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={completedDateFilter}
                    onChange={(event) => setCompletedDateFilter(event.target.value)}
                    className="rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                  <div className="flex items-center gap-2">
                    <select
                      value={completedExportFormat}
                      onChange={(event) => setCompletedExportFormat(event.target.value as 'xlsx' | 'pdf')}
                      className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="xlsx">XLSX</option>
                      <option value="pdf">PDF</option>
                    </select>
                    <button
                      type="button"
                      onClick={handleCompletedExport}
                      className="rounded-2xl border border-blue-100 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:border-blue-300"
                    >
                      Eksportuj
                    </button>
                  </div>
                </div>
              </div>
              {loading && <p className="text-sm text-slate-500">Ładuję historię…</p>}
              {!loading && completedOnSelectedDate.length === 0 && (
                <p className="text-sm text-slate-500">Brak wykonanych kontaktów w tym dniu.</p>
              )}
              {!loading && completedOnSelectedDate.length > 0 && (
                <ul className="space-y-2 text-sm text-slate-600">
                  {completedOnSelectedDate.map((record) => {
                    const cycleDays = record.cycle_days ?? null;
                    const contactDate = record.contact_date ? new Date(record.contact_date) : null;
                    const nextContactDate = record.next_contact_at ? new Date(record.next_contact_at) : null;
                    const daysToNext = contactDate && nextContactDate
                      ? Math.round((nextContactDate.getTime() - contactDate.getTime()) / (1000 * 60 * 60 * 24))
                      : null;
                    const isOverdue = cycleDays && daysToNext !== null && daysToNext > cycleDays;
                    const isEarly = cycleDays && daysToNext !== null && daysToNext < cycleDays;
                    return (
                      <li key={record.id} className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold text-slate-900">{resolveClientName(record)}</p>
                          <div className="text-right text-xs text-slate-500">
                            <p className="font-semibold text-slate-900">
                              {new Date(record.contact_date).toLocaleDateString("pl-PL", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                              })}
                            </p>
                            <p>
                              {record.contact_time
                                ? record.contact_time.slice(0, 5)
                                : new Date(record.contact_date).toLocaleTimeString("pl-PL", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                            </p>
                          </div>
                        </div>
                        <p className="text-xs text-slate-500">
                          {resolveHandlerName(record)}
                          {record.outcome ? ` • ${record.outcome}` : ""}
                        </p>
                        {record.current_comment && (
                          <p className="mt-1 text-xs text-slate-500">{record.current_comment}</p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                          {cycleDays !== null && (
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                              Cykl: {cycleDays} dni
                            </span>
                          )}
                          {daysToNext !== null && (
                            <span
                              className={`rounded-full px-2 py-1 font-medium ${
                                isOverdue
                                  ? "bg-red-100 text-red-700"
                                  : isEarly
                                    ? "bg-green-100 text-green-700"
                                    : "bg-blue-100 text-blue-700"
                              }`}
                            >
                              Następny kontakt: {daysToNext} dni
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>

      {historyModalOpen && historyClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 px-4 py-8">
          <div className="w-full max-w-3xl rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Historia kontaktów</p>
                <h3 className="text-xl font-semibold text-slate-900">{historyClient.name}</h3>
              </div>
              <button
                type="button"
                onClick={closeHistoryModal}
                className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:border-slate-400 hover:text-slate-700"
              >
                Zamknij
              </button>
            </div>
            <div className="max-h-[65vh] space-y-4 overflow-y-auto px-6 py-4">
              {historyLoading && <p className="text-sm text-slate-500">Ładuję historię…</p>}
              {historyError && <p className="text-sm text-red-600">{historyError}</p>}
              {!historyLoading && !historyError && historyRecords.length === 0 && (
                <p className="text-sm text-slate-500">Brak zapisanych kontaktów dla tego klienta.</p>
              )}
              {!historyLoading && historyRecords.length > 0 && (
                <ul className="space-y-3 text-sm text-slate-700">
                  {historyRecords.map((record) => (
                    <li key={record.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Data kontaktu</p>
                          <p className="text-base font-semibold text-slate-900">
                            {new Date(record.contact_date).toLocaleDateString("pl-PL", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                            {record.contact_time && (
                              <span className="text-sm text-slate-500 ml-2">
                                {record.contact_time.slice(0, 5)}
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="text-right text-xs text-slate-500">
                          <p className="font-semibold text-slate-900">{resolveHandlerName(record)}</p>
                          {record.next_contact_at && <p>Następny kontakt: {record.next_contact_at}</p>}
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        {record.outcome ? `Wynik: ${record.outcome}` : "Brak opisu wyniku"}
                      </p>
                      {record.current_comment && (
                        <p className="mt-1 text-sm text-slate-600">{record.current_comment}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4 text-sm text-slate-600">
              <span>
                Strona {Math.floor(historyPagination.offset / historyPagination.limit) + 1} z {Math.max(1, Math.ceil(Math.max(1, historyPagination.count) / historyPagination.limit))}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleHistoryPageChange("prev")}
                  disabled={historyPagination.offset === 0 || historyLoading}
                  className="rounded-2xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Poprzednie
                </button>
                <button
                  type="button"
                  onClick={() => handleHistoryPageChange("next")}
                  disabled={historyPagination.offset + historyPagination.limit >= historyPagination.count || historyLoading}
                  className="rounded-2xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Następne
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 px-4 py-8">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-rose-400">Potwierdź usunięcie</p>
                <h3 className="text-xl font-semibold text-slate-900">{deleteModal.name}</h3>
              </div>
              <button
                type="button"
                onClick={closeDeleteModal}
                className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:border-slate-400 hover:text-slate-700"
                disabled={deleteLoading}
              >
                Zamknij
              </button>
            </div>
            <div className="space-y-4 px-6 py-5 text-sm text-slate-600">
              <p>
                Czy na pewno chcesz wysłać wniosek o usunięcie klienta <strong>{deleteModal.name}</strong>? Po akceptacji przez
                zarządzającego klient zostanie ukryty w aplikacji, ale informacje pozostaną zapisane w systemie.
              </p>
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Powód (opcjonalnie)</span>
                <textarea
                  value={deleteReason}
                  onChange={(event) => setDeleteReason(event.target.value)}
                  rows={4}
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-rose-400 focus:outline-none"
                  placeholder="Dodaj uzasadnienie dla menedżera"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={deleteLoading}
                className="rounded-2xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Anuluj
              </button>
              <button
                type="button"
                onClick={handleClientDeletionRequest}
                disabled={deleteLoading}
                className="rounded-2xl bg-rose-600 px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {deleteLoading ? "Wysyłam…" : "Wyślij wniosek"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

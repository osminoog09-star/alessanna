import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { format, parseISO } from "date-fns";
import { supabase } from "../lib/supabase";
import { useBookingsRealtime } from "../hooks/useSalonRealtime";
import type { ClientRow } from "../types/database";

type VisitRow = {
  id: string;
  created_at: string | null;
  status: string;
  client_name: string;
  appointment_services: Array<{
    id: string;
    start_time: string;
    end_time: string;
    staff: { name: string } | null;
    service_listings: { name: string } | null;
  }> | null;
};

function digitsOnly(phone: string | null | undefined): string {
  return String(phone ?? "").replace(/\D/g, "");
}

export function ClientsPage() {
  const { t } = useTranslation();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingVisits, setLoadingVisits] = useState(false);
  const [listErr, setListErr] = useState<string | null>(null);

  const loadClients = useCallback(async () => {
    setLoading(true);
    setListErr(null);
    const { data, error } = await supabase.from("clients").select("*").order("created_at", { ascending: false });
    if (error) setListErr(error.message);
    else if (data) setClients(data as ClientRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  useBookingsRealtime(loadClients);

  async function loadVisits(clientId: string, clientPhone: string | null) {
    setLoadingVisits(true);
    const digits = digitsOnly(clientPhone);
    let q = supabase
      .from("appointments")
      .select(
        `
        id, created_at, status, client_name,
        appointment_services (
          id, start_time, end_time,
          staff ( name ),
          service_listings ( name )
        )
      `
      )
      .order("created_at", { ascending: false });
    if (digits.length >= 5) {
      q = q.or(`client_id.eq.${clientId},client_phone.eq.${digits}`);
    } else {
      q = q.eq("client_id", clientId);
    }
    const { data, error } = await q;
    if (!error && data) {
      const seen = new Set<string>();
      const unique = (data as VisitRow[]).filter((row) => {
        if (seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
      });
      setVisits(unique);
    } else setVisits([]);
    setLoadingVisits(false);
  }

  function toggle(client: ClientRow) {
    if (expanded === client.id) {
      setExpanded(null);
      setVisits([]);
      return;
    }
    setExpanded(client.id);
    void loadVisits(client.id, client.phone);
  }

  if (loading) return <p className="text-zinc-500">{t("common.loading")}</p>;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-white">{t("clients.title")}</h1>
        <p className="text-sm text-zinc-500">{t("clients.subtitle")}</p>
      </header>

      {listErr && (
        <p className="rounded border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">{listErr}</p>
      )}

      <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
        {clients.length === 0 && <li className="px-4 py-6 text-sm text-zinc-500">{t("clients.empty")}</li>}
        {clients.map((c) => (
          <li key={c.id} className="bg-zinc-950/50">
            <button
              type="button"
              onClick={() => toggle(c)}
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-zinc-900/80"
            >
              <span className="font-medium text-white">{c.name}</span>
              <span className="font-mono text-xs text-zinc-500">{c.phone ?? "—"}</span>
            </button>
            {expanded === c.id && (
              <div className="border-t border-zinc-800 bg-black/40 px-4 py-3">
                {loadingVisits ? (
                  <p className="text-sm text-zinc-500">{t("common.loading")}</p>
                ) : visits.length === 0 ? (
                  <p className="text-sm text-zinc-500">{t("clients.noVisits")}</p>
                ) : (
                  <ul className="space-y-3 text-sm">
                    {visits.map((v) => (
                      <li key={v.id} className="rounded-lg border border-zinc-800 p-3">
                        <p className="text-xs text-zinc-500">
                          {v.created_at
                            ? format(parseISO(v.created_at), "d MMM yyyy HH:mm")
                            : "—"}{" "}
                          · {v.status}
                        </p>
                        <ul className="mt-2 space-y-1 text-zinc-300">
                          {(v.appointment_services ?? []).map((line) => (
                            <li key={line.id}>
                              {line.service_listings?.name ?? "—"} · {line.staff?.name ?? "—"} ·{" "}
                              {format(parseISO(line.start_time), "HH:mm")}–
                              {format(parseISO(line.end_time), "HH:mm")}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { hasStaffRole } from "../lib/roles";

/**
 * /admin/invites — управление одноразовыми ссылками для приглашения новых
 * сотрудников.
 *
 * Что админ может:
 *   1. Создать новую ссылку (роль / имя / срок жизни / число использований).
 *   2. Видеть существующие ссылки + копировать URL + revoke.
 *   3. Видеть pending-заявки кандидатов.
 *      Для каждой заявки: подсказки «похожих» сотрудников; кнопки
 *      «Создать нового», «Привязать к…», «Отклонить».
 *
 * Видимость: только админ (доступ к RPC проверяется на бэке через
 * _staff_assert_admin; UI подстраховывается).
 */

type InviteRow = {
  id: string;
  created_at: string;
  created_by_admin_id: string | null;
  created_by_admin_name: string | null;
  intended_role: string | null;
  intended_name: string | null;
  note: string | null;
  expires_at: string;
  max_uses: number;
  uses_count: number;
  revoked_at: string | null;
  is_active: boolean;
  pending_submissions: number;
};

type SubmissionRow = {
  id: string;
  invite_id: string;
  submitted_name: string;
  submitted_phone: string;
  device_kind: "personal" | "salon";
  user_agent: string | null;
  ip_address: string | null;
  status: "pending" | "approved_new" | "approved_attached" | "rejected";
  reject_reason: string | null;
  linked_staff_id: string | null;
  linked_staff_name: string | null;
  decided_by_admin_id: string | null;
  decided_by_admin_name: string | null;
  decided_at: string | null;
  created_at: string;
  invite_intended_role: string | null;
  invite_intended_name: string | null;
};

type SuggestRow = {
  id: string;
  name: string;
  phone: string | null;
  role: string | null;
  roles: string[] | null;
  is_active: boolean;
  score: number;
};

function buildInviteUrl(token: string): string {
  if (typeof window === "undefined") return `/invite/${token}`;
  return `${window.location.origin}/invite/${token}`;
}

function formatDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return s;
  }
}

function deviceKindLabel(k: string): string {
  return k === "salon" ? "Устройство салона" : "Личное устройство";
}

function statusBadge(status: SubmissionRow["status"]): { label: string; className: string } {
  switch (status) {
    case "pending":
      return {
        label: "Ожидает решения",
        className: "border-amber-700/60 bg-amber-950/30 text-amber-200",
      };
    case "approved_new":
      return {
        label: "Создан новый сотрудник",
        className: "border-emerald-700/60 bg-emerald-950/30 text-emerald-200",
      };
    case "approved_attached":
      return {
        label: "Привязан к существующему",
        className: "border-sky-700/60 bg-sky-950/30 text-sky-200",
      };
    case "rejected":
      return {
        label: "Отклонено",
        className: "border-rose-700/60 bg-rose-950/30 text-rose-200",
      };
  }
}

export function AdminInvitesPage() {
  const { staffMember } = useAuth();
  const isAdmin = hasStaffRole(staffMember, "admin");
  const actorId = staffMember?.id;

  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Только что созданная ссылка (показываем токен один раз). */
  const [justCreated, setJustCreated] = useState<{ token: string; url: string } | null>(null);
  /** Подсказки матчинга по submission_id. */
  const [suggestions, setSuggestions] = useState<Record<string, SuggestRow[]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  // form state
  const [formRole, setFormRole] = useState<"" | "worker" | "manager" | "admin">("");
  const [formName, setFormName] = useState("");
  const [formNote, setFormNote] = useState("");
  const [formHours, setFormHours] = useState(168);
  const [formMaxUses, setFormMaxUses] = useState(1);

  const reload = useCallback(async () => {
    if (!isAdmin || !actorId) return;
    setLoading(true);
    setError(null);
    const [inv, sub] = await Promise.all([
      supabase.rpc("staff_invite_list", { actor_id: actorId }),
      supabase.rpc("staff_invite_submissions_list", { actor_id: actorId }),
    ]);
    setLoading(false);
    if (inv.error) {
      setError(inv.error.message);
      return;
    }
    if (sub.error) {
      setError(sub.error.message);
      return;
    }
    setInvites((inv.data ?? []) as InviteRow[]);
    setSubmissions((sub.data ?? []) as SubmissionRow[]);
  }, [isAdmin, actorId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // подгружаем подсказки на pending-заявки лениво
  useEffect(() => {
    if (!isAdmin || !actorId) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, SuggestRow[]> = {};
      for (const s of submissions) {
        if (s.status !== "pending" || suggestions[s.id]) continue;
        const { data, error } = await supabase.rpc("staff_invite_suggest_matches", {
          submission_id_input: s.id,
          actor_id: actorId,
        });
        if (cancelled) return;
        if (!error) next[s.id] = (data ?? []) as SuggestRow[];
      }
      if (!cancelled && Object.keys(next).length) {
        setSuggestions((prev) => ({ ...prev, ...next }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissions, isAdmin, actorId]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorId) return;
    setError(null);
    const { data, error } = await supabase.rpc("staff_invite_create", {
      actor_id: actorId,
      intended_role_input: formRole || null,
      intended_name_input: formName.trim() || null,
      note_input: formNote.trim() || null,
      expires_in_hours: Math.max(1, Math.min(720, Math.floor(Number(formHours) || 168))),
      max_uses_input: Math.max(1, Math.min(50, Math.floor(Number(formMaxUses) || 1))),
    });
    if (error) {
      setError(error.message);
      return;
    }
    const payload = (data ?? {}) as Record<string, unknown>;
    if (payload.status !== "ok" || typeof payload.token !== "string") {
      setError("Не удалось создать приглашение.");
      return;
    }
    const url = buildInviteUrl(payload.token);
    setJustCreated({ token: payload.token, url });
    setFormName("");
    setFormNote("");
    void reload();
  };

  const onRevoke = async (id: string) => {
    if (!actorId) return;
    if (!confirm("Отозвать ссылку? Уже сделанные заявки сохранятся.")) return;
    setBusyId(id);
    const { error } = await supabase.rpc("staff_invite_revoke", {
      invite_id_input: id,
      actor_id: actorId,
    });
    setBusyId(null);
    if (error) {
      setError(error.message);
      return;
    }
    void reload();
  };

  const onApprove = async (
    s: SubmissionRow,
    action: "create_new" | "attach",
    targetStaffId?: string,
  ) => {
    if (!actorId) return;
    if (action === "attach" && !targetStaffId) return;
    setBusyId(s.id);
    const { data, error } = await supabase.rpc("staff_invite_approve_submission", {
      submission_id_input: s.id,
      actor_id: actorId,
      action_input: action,
      target_staff_id_input: targetStaffId ?? null,
    });
    setBusyId(null);
    if (error) {
      setError(error.message);
      return;
    }
    const payload = (data ?? {}) as Record<string, unknown>;
    if (payload.status !== "ok") {
      setError(`Не удалось одобрить (${String(payload.status)}).`);
      return;
    }
    void reload();
  };

  const onReject = async (s: SubmissionRow) => {
    if (!actorId) return;
    const reason = prompt("Причина отказа (необязательно):") ?? "";
    setBusyId(s.id);
    const { error } = await supabase.rpc("staff_invite_reject_submission", {
      submission_id_input: s.id,
      actor_id: actorId,
      reason_input: reason || null,
    });
    setBusyId(null);
    if (error) {
      setError(error.message);
      return;
    }
    void reload();
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* swallow */
    }
  };

  const pending = useMemo(() => submissions.filter((s) => s.status === "pending"), [submissions]);
  const decided = useMemo(() => submissions.filter((s) => s.status !== "pending"), [submissions]);

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-rose-800/60 bg-rose-950/20 p-6 text-rose-200">
        Доступ только для администратора.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-zinc-100">Приглашения сотрудников</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Создавайте одноразовые ссылки для регистрации мастеров/менеджеров без
          ручной выдачи паролей. После того, как кандидат заполнит форму и вы
          одобрите заявку, его устройство автоматически становится доверенным.
        </p>
      </header>

      {error ? (
        <div className="rounded-xl border border-rose-800/60 bg-rose-950/30 p-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {/* Forma sozdaniya */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Создать ссылку
        </h2>
        <form onSubmit={onCreate} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm text-zinc-300">
            Ожидаемая роль
            <select
              value={formRole}
              onChange={(e) => setFormRole(e.target.value as typeof formRole)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-sky-600"
            >
              <option value="">— не указано —</option>
              <option value="worker">Мастер</option>
              <option value="manager">Менеджер</option>
              <option value="admin">Админ</option>
            </select>
          </label>
          <label className="block text-sm text-zinc-300">
            Имя кандидата (необязательно)
            <input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-sky-600"
              placeholder="Имя Фамилия"
            />
          </label>
          <label className="block text-sm text-zinc-300 sm:col-span-2">
            Заметка (видна кандидату)
            <input
              value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-sky-600"
              placeholder='напр. "Регистрируемся на ресепшен в субботу"'
            />
          </label>
          <label className="block text-sm text-zinc-300">
            Срок действия (часов)
            <input
              type="number"
              min={1}
              max={720}
              value={formHours}
              onChange={(e) => setFormHours(Number(e.target.value) || 1)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-sky-600"
            />
          </label>
          <label className="block text-sm text-zinc-300">
            Сколько раз можно использовать
            <input
              type="number"
              min={1}
              max={50}
              value={formMaxUses}
              onChange={(e) => setFormMaxUses(Number(e.target.value) || 1)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-sky-600"
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
            >
              Создать ссылку
            </button>
          </div>
        </form>

        {justCreated ? (
          <div className="mt-4 rounded-xl border border-emerald-800/60 bg-emerald-950/20 p-3 text-sm text-emerald-100">
            <div className="font-medium">Ссылка создана. Скопируйте и отправьте кандидату:</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-black/40 px-2 py-1 text-xs text-emerald-100">
                {justCreated.url}
              </code>
              <button
                type="button"
                onClick={() => void copy(justCreated.url)}
                className="rounded border border-emerald-700/60 px-2 py-1 text-xs hover:bg-emerald-900/40"
              >
                Скопировать
              </button>
              <button
                type="button"
                onClick={() => setJustCreated(null)}
                className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                Скрыть
              </button>
            </div>
            <p className="mt-2 text-xs text-emerald-200/80">
              Токен показывается только один раз — после закрытия его уже не
              получится восстановить, останется только отозвать ссылку.
            </p>
          </div>
        ) : null}
      </section>

      {/* Pending zayavki */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Заявки на регистрацию ({pending.length} в ожидании)
        </h2>
        {loading && submissions.length === 0 ? (
          <div className="mt-3 text-sm text-zinc-500">Загружаем…</div>
        ) : pending.length === 0 ? (
          <div className="mt-3 text-sm text-zinc-500">
            Нет новых заявок. Когда кандидат заполнит форму по ссылке — она
            появится здесь.
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {pending.map((s) => {
              const sug = suggestions[s.id] ?? [];
              return (
                <li
                  key={s.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-base font-semibold text-zinc-100">
                        {s.submitted_name}
                      </div>
                      <div className="mt-0.5 text-sm text-zinc-300">{s.submitted_phone}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                        <span
                          className={`rounded-full border px-2 py-0.5 ${
                            s.device_kind === "salon"
                              ? "border-amber-700/60 bg-amber-950/30 text-amber-200"
                              : "border-sky-700/60 bg-sky-950/30 text-sky-200"
                          }`}
                        >
                          {deviceKindLabel(s.device_kind)}
                        </span>
                        {s.invite_intended_role ? (
                          <span className="rounded-full border border-zinc-700 bg-zinc-900/40 px-2 py-0.5">
                            Ожидаемая роль: {s.invite_intended_role}
                          </span>
                        ) : null}
                        {s.ip_address ? <span>IP {s.ip_address}</span> : null}
                        <span>{formatDateTime(s.created_at)}</span>
                      </div>
                      {s.user_agent ? (
                        <div className="mt-1 truncate text-[11px] text-zinc-500" title={s.user_agent}>
                          {s.user_agent}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busyId === s.id}
                        onClick={() => void onApprove(s, "create_new")}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        Создать нового
                      </button>
                      <button
                        type="button"
                        disabled={busyId === s.id}
                        onClick={() => void onReject(s)}
                        className="rounded-lg border border-rose-700/60 bg-rose-950/40 px-3 py-1.5 text-xs font-medium text-rose-100 hover:bg-rose-900/60 disabled:opacity-50"
                      >
                        Отклонить
                      </button>
                    </div>
                  </div>

                  {sug.length > 0 ? (
                    <div className="mt-3 rounded-lg border border-sky-900/60 bg-sky-950/20 p-3">
                      <div className="text-xs font-semibold text-sky-200">
                        Возможно, это уже есть в базе:
                      </div>
                      <ul className="mt-2 space-y-1.5">
                        {sug.map((m) => (
                          <li
                            key={m.id}
                            className="flex flex-wrap items-center justify-between gap-2 text-sm"
                          >
                            <div className="min-w-0">
                              <span className="font-medium text-zinc-100">{m.name}</span>
                              {m.phone ? (
                                <span className="ml-2 text-zinc-400">{m.phone}</span>
                              ) : null}
                              {!m.is_active ? (
                                <span className="ml-2 rounded-full border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400">
                                  неактивен
                                </span>
                              ) : null}
                              <span className="ml-2 text-[11px] text-zinc-500">
                                совпадение: {m.score}
                              </span>
                            </div>
                            <button
                              type="button"
                              disabled={busyId === s.id}
                              onClick={() => void onApprove(s, "attach", m.id)}
                              className="rounded-lg border border-sky-700/60 bg-sky-900/40 px-3 py-1 text-xs font-medium text-sky-100 hover:bg-sky-900/70 disabled:opacity-50"
                            >
                              Привязать
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Aktivnye ssylki */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Существующие ссылки
        </h2>
        {invites.length === 0 ? (
          <div className="mt-3 text-sm text-zinc-500">Пока ни одной ссылки.</div>
        ) : (
          <ul className="mt-3 space-y-2">
            {invites.map((i) => (
              <li
                key={i.id}
                className={`rounded-xl border p-3 text-sm ${
                  i.is_active
                    ? "border-zinc-800 bg-zinc-900/40"
                    : "border-zinc-800/60 bg-zinc-900/20 text-zinc-500"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-zinc-100">
                      {i.intended_name || i.intended_role || "Без подсказки"}{" "}
                      <span className="text-xs text-zinc-500">
                        · до {formatDateTime(i.expires_at)} · {i.uses_count}/{i.max_uses}{" "}
                        использовано
                      </span>
                    </div>
                    {i.note ? (
                      <div className="mt-0.5 text-xs text-zinc-400">{i.note}</div>
                    ) : null}
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      Создано {formatDateTime(i.created_at)}
                      {i.created_by_admin_name ? ` · ${i.created_by_admin_name}` : ""}
                      {i.pending_submissions > 0
                        ? ` · ⏳ ${i.pending_submissions} в ожидании`
                        : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {i.is_active ? (
                      <span className="rounded-full border border-emerald-700/60 bg-emerald-950/30 px-2 py-0.5 text-[10px] text-emerald-200">
                        активна
                      </span>
                    ) : i.revoked_at ? (
                      <span className="rounded-full border border-rose-700/60 bg-rose-950/30 px-2 py-0.5 text-[10px] text-rose-200">
                        отозвана
                      </span>
                    ) : (
                      <span className="rounded-full border border-zinc-700 bg-zinc-900/40 px-2 py-0.5 text-[10px] text-zinc-400">
                        не активна
                      </span>
                    )}
                    {i.is_active ? (
                      <button
                        type="button"
                        disabled={busyId === i.id}
                        onClick={() => void onRevoke(i.id)}
                        className="rounded-lg border border-rose-700/60 bg-rose-950/40 px-2 py-1 text-xs text-rose-100 hover:bg-rose-900/70 disabled:opacity-50"
                      >
                        Отозвать
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Istoriya reshennykh */}
      {decided.length > 0 ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
            История заявок
          </h2>
          <ul className="mt-3 space-y-2">
            {decided.map((s) => {
              const b = statusBadge(s.status);
              return (
                <li
                  key={s.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-medium text-zinc-100">{s.submitted_name}</span>
                      <span className="ml-2 text-zinc-400">{s.submitted_phone}</span>
                      {s.linked_staff_name ? (
                        <span className="ml-2 text-xs text-emerald-200">
                          → {s.linked_staff_name}
                        </span>
                      ) : null}
                    </div>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] ${b.className}`}
                    >
                      {b.label}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">
                    {formatDateTime(s.decided_at ?? s.created_at)}
                    {s.decided_by_admin_name ? ` · ${s.decided_by_admin_name}` : ""}
                    {s.reject_reason ? ` · «${s.reject_reason}»` : ""}
                    {s.ip_address ? ` · IP ${s.ip_address}` : ""}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

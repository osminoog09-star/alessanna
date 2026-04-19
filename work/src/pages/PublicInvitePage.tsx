import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

/**
 * /invite/:token — публичная страница для регистрации мастера/админа по
 * приглашению.
 *
 * Поток:
 *   1. lookup → проверяем, что ссылка валидна.
 *   2. форма: имя, телефон, выбор «моё устройство» / «устройство салона».
 *   3. submit → сохраняем submission_id + device_token (полусырой, ещё не
 *      доверенный) в localStorage. Показываем «ждём подтверждения админа».
 *   4. polling каждые 4с → как только админ approved, ставим в localStorage
 *      то же самое, что AuthContext, и редиректим на «/». AuthContext поднимет
 *      сессию из localStorage.
 *
 * Те же ключи, что в AuthContext.tsx — намеренно без импорта, чтобы не
 * провоцировать циклические импорты и не превращать AuthContext в
 * publicly-mutable API. Ключи сверяются с AuthContext.tsx (см. комменты
 * рядом).
 */
const STORAGE_KEY = "alessanna_crm_staff";
const DEVICE_TOKEN_KEY = "alessanna_crm_device_token";
const PENDING_KEY = "alessanna_crm_invite_pending";

type LookupOk = {
  status: "ok";
  invite_id: string;
  intended_role?: string | null;
  intended_name?: string | null;
  note?: string | null;
  expires_at: string;
};
type LookupBad = { status: "invalid" | "revoked" | "expired" | "exhausted" };
type Lookup = LookupOk | LookupBad;

type PendingState = {
  submission_id: string;
  device_token: string;
  token: string;
};

function readPending(token: string): PendingState | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as PendingState;
    if (!v || v.token !== token) return null;
    return v;
  } catch {
    return null;
  }
}
function writePending(p: PendingState | null) {
  try {
    if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* swallow */
  }
}

function summarizeUserAgent(): string {
  if (typeof navigator === "undefined") return "";
  return String(navigator.userAgent || "").slice(0, 240);
}

function badStatusMessage(s: LookupBad["status"]): string {
  switch (s) {
    case "expired":
      return "Срок действия ссылки истёк. Попросите админа создать новую.";
    case "revoked":
      return "Ссылка отозвана. Попросите админа создать новую.";
    case "exhausted":
      return "Лимит регистраций по этой ссылке исчерпан.";
    default:
      return "Ссылка недействительна. Проверьте, что вы открыли её полностью.";
  }
}

export function PublicInvitePage() {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [deviceKind, setDeviceKind] = useState<"personal" | "salon">("personal");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingState | null>(() => readPending(token));
  const [pollState, setPollState] = useState<
    | { kind: "waiting" }
    | { kind: "rejected"; reason?: string | null }
    | { kind: "expired" }
    | null
  >(null);
  const pollTimer = useRef<number | null>(null);

  // ── lookup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.rpc("staff_invite_lookup", {
        token_input: token,
      });
      if (!alive) return;
      if (error) {
        setLookup({ status: "invalid" });
        return;
      }
      const l = (data ?? { status: "invalid" }) as Lookup;
      setLookup(l);
      if (l.status === "ok") {
        if (!name && l.intended_name) setName(l.intended_name);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ── polling статуса заявки ───────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollTimer.current != null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const checkStatus = useCallback(
    async (p: PendingState) => {
      const { data, error } = await supabase.rpc("staff_invite_submission_status", {
        submission_id_input: p.submission_id,
        device_token_input: p.device_token,
      });
      if (error) return;
      const payload = (data ?? {}) as Record<string, unknown>;
      const status = String(payload.status ?? "");
      if (status === "approved") {
        const staff = payload.staff as Record<string, unknown> | undefined;
        if (!staff || typeof staff !== "object") return;
        try {
          localStorage.setItem(DEVICE_TOKEN_KEY, p.device_token);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(staff));
        } catch {
          /* ignore */
        }
        writePending(null);
        stopPolling();
        // hard reload, чтобы AuthProvider пересчитал staffMember из storage
        window.location.replace("/");
      } else if (status === "rejected") {
        setPollState({ kind: "rejected", reason: (payload.reason as string) ?? null });
        stopPolling();
        writePending(null);
      } else if (status === "not_found") {
        setPollState({ kind: "expired" });
        stopPolling();
        writePending(null);
      } else {
        setPollState({ kind: "waiting" });
      }
    },
    [stopPolling],
  );

  useEffect(() => {
    if (!pending) return;
    setPollState({ kind: "waiting" });
    void checkStatus(pending);
    pollTimer.current = window.setInterval(() => {
      void checkStatus(pending);
    }, 4000);
    return () => stopPolling();
  }, [pending, checkStatus, stopPolling]);

  // ── submit формы ────────────────────────────────────────────────────────
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !phone.trim()) {
      setError("Заполните имя и телефон.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("staff_invite_submit", {
        token_input: token,
        name_input: name.trim(),
        phone_input: phone.trim(),
        device_kind_input: deviceKind,
        user_agent_input: summarizeUserAgent(),
      });
      if (error) {
        setError(error.message);
        return;
      }
      const payload = (data ?? {}) as Record<string, unknown>;
      const status = String(payload.status ?? "");
      if (status !== "ok") {
        setError(`Не удалось отправить заявку (${status}).`);
        return;
      }
      const sid = String(payload.submission_id ?? "");
      const dtok = String(payload.device_token ?? "");
      if (!sid || !dtok) {
        setError("Сервер не вернул идентификаторы заявки.");
        return;
      }
      const p: PendingState = { submission_id: sid, device_token: dtok, token };
      writePending(p);
      setPending(p);
    } finally {
      setSubmitting(false);
    }
  };

  const cancelPending = () => {
    writePending(null);
    setPending(null);
    setPollState(null);
  };

  const lookupOk = useMemo(
    () => (lookup && lookup.status === "ok" ? (lookup as LookupOk) : null),
    [lookup],
  );

  // ── рендер ───────────────────────────────────────────────────────────────
  if (!lookup) {
    return (
      <Shell>
        <div className="text-zinc-400">Проверяем ссылку…</div>
      </Shell>
    );
  }

  if (lookup.status !== "ok") {
    return (
      <Shell>
        <div className="rounded-2xl border border-rose-800/60 bg-rose-950/20 p-6 text-rose-200">
          <h1 className="mb-2 text-lg font-semibold">Ссылка недоступна</h1>
          <p className="text-sm text-rose-200/80">{badStatusMessage(lookup.status)}</p>
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="mt-4 rounded-lg border border-rose-700/60 bg-rose-900/40 px-3 py-1.5 text-xs font-medium text-rose-100 hover:bg-rose-900/70"
          >
            Перейти ко входу
          </button>
        </div>
      </Shell>
    );
  }

  if (pending) {
    const isRejected = pollState?.kind === "rejected";
    const isExpired = pollState?.kind === "expired";
    return (
      <Shell>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
          <h1 className="text-lg font-semibold text-zinc-100">
            {isRejected
              ? "Заявка отклонена"
              : isExpired
                ? "Заявка устарела"
                : "Заявка отправлена"}
          </h1>
          {isRejected ? (
            <>
              <p className="mt-2 text-sm text-rose-300">
                Админ не подтвердил вашу регистрацию.
              </p>
              {pollState.reason ? (
                <p className="mt-1 text-xs text-rose-300/80">Причина: {pollState.reason}</p>
              ) : null}
            </>
          ) : isExpired ? (
            <p className="mt-2 text-sm text-amber-300">
              Заявка пропала. Попробуйте отправить ещё раз — возможно, истёк
              срок действия ссылки.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm text-zinc-300">
                Ждём, пока админ подтвердит вашу регистрацию. Эту вкладку можно
                оставить открытой — мы автоматически зайдём в систему, как
                только заявку одобрят.
              </p>
              <p className="mt-3 text-xs text-zinc-500">
                Это устройство будет автоматически добавлено в доверенные —
                больше не понадобится вводить PIN.
              </p>
              <div className="mt-4 flex items-center gap-2 text-xs text-zinc-500">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                Ожидание подтверждения…
              </div>
            </>
          )}
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={cancelPending}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
            >
              Заполнить заново
            </button>
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
            >
              Войти по PIN
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <form
        onSubmit={onSubmit}
        className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6"
      >
        <h1 className="text-lg font-semibold text-zinc-100">
          Регистрация по приглашению
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Заполните короткую форму. После подтверждения админом вы автоматически
          войдёте в CRM, а это устройство станет доверенным.
        </p>
        {lookupOk?.intended_role || lookupOk?.note ? (
          <div className="mt-4 rounded-lg border border-sky-800/60 bg-sky-950/20 p-3 text-xs text-sky-200">
            {lookupOk?.intended_role ? (
              <div>
                Ожидаемая роль: <b>{lookupOk.intended_role}</b>
              </div>
            ) : null}
            {lookupOk?.note ? <div className="mt-1">{lookupOk.note}</div> : null}
          </div>
        ) : null}

        <label className="mt-5 block text-sm text-zinc-300">
          Имя
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-sky-600"
            autoComplete="name"
            placeholder="Имя Фамилия"
          />
        </label>
        <label className="mt-3 block text-sm text-zinc-300">
          Телефон
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-sky-600"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+372…"
          />
        </label>

        <fieldset className="mt-4">
          <legend className="mb-2 text-sm text-zinc-300">Это устройство —</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <DeviceChoice
              checked={deviceKind === "personal"}
              onChange={() => setDeviceKind("personal")}
              title="Моё личное"
              hint="Только моё. Останется доверенным только для меня."
              dotClass="bg-sky-400"
            />
            <DeviceChoice
              checked={deviceKind === "salon"}
              onChange={() => setDeviceKind("salon")}
              title="Устройство салона"
              hint="Общий планшет/ноутбук в салоне. Сможет логиниться любой активный сотрудник."
              dotClass="bg-amber-400"
            />
          </div>
        </fieldset>

        {error ? (
          <div className="mt-4 rounded-lg border border-rose-800/60 bg-rose-950/30 p-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="mt-5 inline-flex items-center justify-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {submitting ? "Отправляем…" : "Отправить заявку"}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-black px-4 py-10 text-zinc-100">
      <div className="mx-auto max-w-md">
        <div className="mb-6 text-center text-xs uppercase tracking-widest text-zinc-500">
          ALESSANNA · CRM
        </div>
        {children}
      </div>
    </div>
  );
}

function DeviceChoice(props: {
  checked: boolean;
  onChange: () => void;
  title: string;
  hint: string;
  dotClass: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${
        props.checked
          ? "border-sky-700/60 bg-sky-950/30"
          : "border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900"
      }`}
    >
      <input
        type="radio"
        className="mt-1 h-4 w-4 accent-sky-500"
        checked={props.checked}
        onChange={props.onChange}
      />
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-zinc-100">
          <span className={`inline-block h-2 w-2 rounded-full ${props.dotClass}`} />
          <span className="font-medium">{props.title}</span>
        </div>
        <p className="mt-1 text-xs text-zinc-400">{props.hint}</p>
      </div>
    </label>
  );
}

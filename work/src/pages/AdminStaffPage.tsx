import { FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { ToggleSwitch } from "../components/ToggleSwitch";
import { useEmployeesDirectoryRealtime, useStaffAssignmentsCatalogRealtime } from "../hooks/useSalonRealtime";
import { normalizeRoles, sanitizeRolesForSave } from "../lib/roles";
import type { StaffServiceRow, StaffTableRow } from "../types/database";
import type { Role } from "../types/database";

type UiRole = Role;
type CatalogSkillService = {
  id: string;
  name: string;
  is_active: boolean;
  /** Для группировки в блоке навыков мастера */
  category_name: string;
  /** true = id взят из `service_listings` (UUID), false = legacy `services` (bigint). */
  from_listings: boolean;
};

type StaffCatalogResult = {
  services: CatalogSkillService[];
  listingsEmpty: boolean;
};

async function loadStaffPageCatalog(): Promise<StaffCatalogResult> {
  const uncategorized = "Без категории";
  /* После миграции 012 `staff_services.service_id` → UUID `service_listings.id`.
   * Раньше сюда первым шёл legacy `services` (bigint id): переключатели не совпадали с БД и insert ломался по FK. */
  /* fallback-цепочки по `select(...)` дают разные shape-ы; для TS поэтому
   * в let-binding всегда кастуем последующие awaits в `typeof sl`, иначе
   * supabase-js v2 ругается на PostgrestSingleResponse<разный набор полей>.
   * Узкий runtime-тип всё равно затем нормализуется ниже через `as Array<...>`. */
  let sl = await supabase
    .from("service_listings")
    .select("id,name,is_active,category_id,service_categories(name)")
    .order("name", { ascending: true });
  if (sl.error) {
    sl = (await supabase
      .from("service_listings")
      .select("id,name,is_active,category_id")
      .order("name", { ascending: true })) as typeof sl;
  }
  if (sl.error) {
    sl = (await supabase
      .from("service_listings")
      .select("id,name,is_active")
      .order("name", { ascending: true })) as typeof sl;
  }
  if (sl.error) {
    sl = (await supabase
      .from("service_listings")
      .select("id,name")
      .order("name", { ascending: true })) as typeof sl;
  }
  if (!sl.error && sl.data && sl.data.length > 0) {
    const services = (
      sl.data as Array<{
        id: string;
        name?: string;
        is_active?: boolean;
        service_categories?: { name?: string | null } | null;
      }>
    )
      .map((s) => ({
        id: String(s.id),
        name: String(s.name || "").trim(),
        is_active: s.is_active !== false,
        category_name: String(s.service_categories?.name || "").trim() || uncategorized,
        from_listings: true,
      }))
      .filter((x) => x.name);
    return { services, listingsEmpty: false };
  }

  let sLegacy = await supabase
    .from("services")
    .select("id,name_et,active,category")
    .order("sort_order", { ascending: true });
  if (sLegacy.error) {
    sLegacy = (await supabase
      .from("services")
      .select("id,name_et,active")
      .order("sort_order", { ascending: true })) as typeof sLegacy;
  }
  if (!sLegacy.error && sLegacy.data && sLegacy.data.length > 0) {
    const services = (
      sLegacy.data as Array<{ id: unknown; name_et?: string; active?: boolean; category?: string | null }>
    )
      .map((s) => ({
        id: String(s.id),
        name: String(s.name_et || "").trim(),
        is_active: s.active !== false,
        category_name: String(s.category || "").trim() || uncategorized,
        from_listings: false,
      }))
      .filter((x) => x.name);
    return { services, listingsEmpty: true };
  }
  let sModern = await supabase
    .from("services")
    .select("id,name,active,is_active,category")
    .order("name", { ascending: true });
  if (sModern.error) {
    sModern = (await supabase
      .from("services")
      .select("id,name,active,is_active")
      .order("name", { ascending: true })) as typeof sModern;
  }
  if (sModern.data && sModern.data.length > 0) {
    const services = (
      sModern.data as Array<{
        id: unknown;
        name?: string;
        active?: boolean;
        is_active?: boolean;
        category?: string | null;
      }>
    )
      .map((s) => ({
        id: String(s.id),
        name: String(s.name || "").trim(),
        is_active: s.is_active !== false && s.active !== false,
        category_name: String(s.category || "").trim() || uncategorized,
        from_listings: false,
      }))
      .filter((x) => x.name);
    return { services, listingsEmpty: true };
  }
  return { services: [], listingsEmpty: true };
}

function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}

function normServiceName(n: string): string {
  return String(n || "").trim().toLowerCase();
}

function normId(id: string | number | null | undefined): string {
  return String(id ?? "")
    .trim()
    .toLowerCase();
}

function isMissingStaffMarketingColumnError(err: { message?: string } | null | undefined): boolean {
  const m = String(err?.message || "").toLowerCase();
  return (
    m.includes("show_on_marketing_site") ||
    (m.includes("column") && (m.includes("does not exist") || m.includes("could not find"))) ||
    m.includes("schema cache")
  );
}

/** Базовая проверка e-mail — синхронизирована с CHECK-constraint миграции 025. */
function isPlausibleEmail(raw: string): boolean {
  const v = String(raw || "").trim();
  if (!v) return true;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}

/**
 * Инлайновое поле «календарь сотрудника»: сохраняется по blur/Enter.
 * Пишем сразу в `staff.calendar_email`; миграция 025 добавляет колонку и
 * CHECK-валидатор. Ошибка валидации показывается через `onError`.
 */
function StaffCalendarEmailField(props: {
  row: StaffTableRow;
  onSaved: () => void;
  onError: (msg: string | null) => void;
}) {
  const initial = (props.row as StaffTableRow & { calendar_email?: string | null }).calendar_email ?? "";
  const [value, setValue] = useState<string>(initial ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(initial ?? "");
  }, [initial]);

  async function commit() {
    const trimmed = value.trim();
    if (trimmed === (initial ?? "").trim()) return;
    if (!isPlausibleEmail(trimmed)) {
      props.onError("Проверьте формат e-mail или очистите поле.");
      return;
    }
    props.onError(null);
    setSaving(true);
    const { error } = await supabase
      .from("staff")
      .update({ calendar_email: trimmed === "" ? null : trimmed })
      .eq("id", props.row.id);
    setSaving(false);
    if (error) {
      props.onError(error.message);
      return;
    }
    props.onSaved();
  }

  return (
    <input
      type="email"
      autoComplete="email"
      spellCheck={false}
      disabled={saving}
      placeholder="master@gmail.com"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      className="w-full rounded border border-zinc-700 bg-black px-2 py-1 text-xs text-zinc-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:opacity-60"
    />
  );
}

/**
 * Общий Google-календарь салона: храним в `salon_settings` под ключом
 * `salon_calendar_email`. Этот адрес — целевой календарь, куда будущая
 * интеграция будет записывать все брони салона.
 */
function SalonCalendarSettingsCard(props: { onError: (msg: string | null) => void }) {
  const [value, setValue] = useState<string>("");
  const [initial, setInitial] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("salon_settings")
      .select("value")
      .eq("key", "salon_calendar_email")
      .maybeSingle();
    if (error) {
      props.onError(error.message);
      setLoading(false);
      return;
    }
    const v = (data?.value ?? "") as string;
    setInitial(v);
    setValue(v);
    setLoading(false);
  }, [props]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    const trimmed = value.trim();
    if (!isPlausibleEmail(trimmed)) {
      props.onError("Проверьте формат e-mail или очистите поле.");
      return;
    }
    props.onError(null);
    setSaving(true);
    const { error } = await supabase
      .from("salon_settings")
      .upsert({ key: "salon_calendar_email", value: trimmed === "" ? null : trimmed }, { onConflict: "key" });
    setSaving(false);
    if (error) {
      props.onError(error.message);
      return;
    }
    setInitial(trimmed);
  }

  const dirty = value.trim() !== initial.trim();

  return (
    <section className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <header className="mb-1 flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Общий Google-календарь салона
        </p>
        <span className="text-[10px] text-zinc-600">salon_settings.salon_calendar_email</span>
      </header>
      <p className="mb-2 text-[11px] leading-snug text-zinc-500">
        Рабочая почта салона — в этот календарь попадут все записи (сейчас только хранится,
        реальная синхронизация с Google Calendar будет подключена отдельным шагом).
      </p>
      <div className="flex gap-2">
        <input
          type="email"
          autoComplete="email"
          spellCheck={false}
          disabled={loading || saving}
          placeholder="salon@gmail.com"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="flex-1 rounded border border-zinc-700 bg-black px-2 py-1 text-sm text-zinc-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={loading || saving || !dirty}
          className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-40"
        >
          Сохранить
        </button>
      </div>
    </section>
  );
}

export function AdminStaffPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<StaffTableRow[]>([]);
  const [services, setServices] = useState<CatalogSkillService[]>([]);
  const [links, setLinks] = useState<StaffServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [noPhone, setNoPhone] = useState(false);
  const [newRoles, setNewRoles] = useState<UiRole[]>(["worker"]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  /** Компактный список: детали (роли, услуги) только в раскрытой строке. */
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});
  /** id строки в каталоге CRM → UUID service_listings (FK staff_services.service_id). */
  const [catalogIdToListingId, setCatalogIdToListingId] = useState<Record<string, string>>({});
  /** Раскрытые категории услуг в строке мастера: ключ `staffId::название категории`. */
  const [skillCategoryExpanded, setSkillCategoryExpanded] = useState<Record<string, boolean>>({});
  /** false = колонка есть; true = в БД нет staff.show_on_marketing_site (нужна миграция 020). */
  const [staffMarketingColumnMissing, setStaffMarketingColumnMissing] = useState(false);
  /** true = таблица service_listings пуста, каталог тянется из legacy `services` — FK staff_services ломается. */
  const [serviceListingsEmpty, setServiceListingsEmpty] = useState(false);
  /** Категории для drag-and-drop (глобальный порядок из service_categories.sort_order). */
  const [categoriesMeta, setCategoriesMeta] = useState<
    { id: string; name: string; sort_order: number }[]
  >([]);
  /** Название категории, которую сейчас тащим (для drag-&-drop). */
  const [draggedCatName, setDraggedCatName] = useState<string | null>(null);
  /** Контекст drag для секций «Активные / Неактивные услуги мастера».
   *  Тут несём id мастера, направление (откуда тащим) и весь набор услуг
   *  категории — чтобы при drop в противоположную секцию выполнить
   *  toggleCategoryForStaff (полный аналог кнопок «добавить все» / «убрать»).
   *  Без этого пользователь тащит карточку из «Неактивные» в «Активные»,
   *  и единственное, что происходит — глобальный reorder сортировки категорий,
   *  а услуги мастеру не добавляются. */
  const [skillDrag, setSkillDrag] = useState<{
    staffId: string;
    catName: string;
    from: "assigned" | "inactive";
    services: CatalogSkillService[];
  } | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const [st, lk] = await Promise.all([
      supabase.from("staff").select("*").order("created_at", { ascending: false }),
      supabase.from("staff_services").select("*"),
    ]);
    if (st.error) {
      setErr(st.error.message);
      setLoading(false);
      return;
    }
    /* lk.error раньше игнорировался: при сбое загрузки `staff_services`
     * UI оставался с пустыми/устаревшими привязками, и пользователь не
     * понимал почему «навыки» исчезли. Теперь явно показываем ошибку и
     * выходим, чтобы не отрисовывать неконсистентное состояние. */
    if (lk.error) {
      setErr(lk.error.message);
      setLoading(false);
      return;
    }
    const colProbe = await supabase.from("staff").select("id, show_on_marketing_site").limit(1);
    setStaffMarketingColumnMissing(!!colProbe.error && isMissingStaffMarketingColumnError(colProbe.error));

    setRows((st.data ?? []) as StaffTableRow[]);

    const catalogResult = await loadStaffPageCatalog();
    const catalog = catalogResult.services;
    setServiceListingsEmpty(catalogResult.listingsEmpty);
    const listMeta = await supabase.from("service_listings").select("id,name");
    const map: Record<string, string> = {};
    if (!listMeta.error && listMeta.data?.length) {
      const listingIdSet = new Set(
        (listMeta.data as Array<{ id: string }>).map((r) => normId(String(r.id))),
      );
      const byNormName = new Map<string, string>();
      for (const row of listMeta.data as Array<{ id: string; name: string | null }>) {
        const k = normServiceName(String(row.name || ""));
        if (k) byNormName.set(k, String(row.id));
      }
      for (const s of catalog) {
        const cid = String(s.id);
        const cidNorm = normId(cid);
        if (listingIdSet.has(cidNorm)) map[cid] = cidNorm;
        else {
          const lid = byNormName.get(normServiceName(s.name));
          if (lid) map[cid] = String(lid);
        }
      }
    }
    setCatalogIdToListingId(map);
    setServices(catalog);

    const cats = await supabase
      .from("service_categories")
      .select("id,name,sort_order")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (!cats.error && cats.data) {
      setCategoriesMeta(
        (cats.data as Array<{ id: string; name: string | null; sort_order: number | null }>).map(
          (c) => ({
            id: String(c.id),
            name: String(c.name ?? "").trim(),
            sort_order: Number(c.sort_order ?? 0),
          }),
        ),
      );
    }

    if (lk.data) setLinks(lk.data as StaffServiceRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEmployeesDirectoryRealtime(load);
  useStaffAssignmentsCatalogRealtime(load);

  const activeServices = useMemo(() => services.filter((s) => s.is_active), [services]);

  /**
   * Глобальный порядок категорий по `service_categories.sort_order`.
   * Категория «Без категории» — виртуальная (в БД её нет), поэтому всегда в конце.
   */
  const categoryOrderIndex = useMemo(() => {
    const idx: Record<string, number> = {};
    categoriesMeta
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ru"))
      .forEach((c, i) => {
        idx[c.name] = i;
      });
    return idx;
  }, [categoriesMeta]);

  function compareCategories(a: string, b: string): number {
    if (a === "Без категории" && b !== "Без категории") return 1;
    if (b === "Без категории" && a !== "Без категории") return -1;
    const ai = categoryOrderIndex[a];
    const bi = categoryOrderIndex[b];
    if (ai != null && bi != null) return ai - bi;
    if (ai != null) return -1;
    if (bi != null) return 1;
    return a.localeCompare(b, "ru");
  }

  const activeServicesByCategory = useMemo(() => {
    const m = new Map<string, CatalogSkillService[]>();
    for (const s of activeServices) {
      const c = String(s.category_name || "").trim() || "Без категории";
      if (!m.has(c)) m.set(c, []);
      m.get(c)!.push(s);
    }
    return [...m.entries()]
      .sort(([a], [b]) => compareCategories(a, b))
      .map(([name, svcs]) => ({
        name,
        services: [...svcs].sort((x, y) => x.name.localeCompare(y.name, "ru")),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeServices, categoryOrderIndex]);

  function pickPrimaryRole(roles: UiRole[]): UiRole {
    if (roles.includes("admin")) return "admin";
    if (roles.includes("manager")) return "manager";
    return "worker";
  }

  function rowRoles(row: StaffTableRow): UiRole[] {
    const normalized = normalizeRoles((row as StaffTableRow & { roles?: unknown }).roles ?? row.role);
    return normalized as UiRole[];
  }

  function roleLabelsSummary(r: StaffTableRow): string {
    const pr = String(r.role || "").toLowerCase();
    if (pr === "owner") return "Owner";
    const cur = rowRoles(r);
    const bits: string[] = [];
    if (cur.includes("admin")) bits.push(t("role.admin"));
    if (cur.includes("manager")) bits.push(t("role.manager"));
    if (cur.includes("worker")) bits.push(t("role.worker"));
    return bits.length ? bits.join(" · ") : "—";
  }

  function toggleRowExpanded(id: string) {
    setExpandedById((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleRoleToken(current: UiRole[], roleToken: UiRole, on: boolean): UiRole[] {
    const next = on ? [...new Set([...current, roleToken])] : current.filter((r) => r !== roleToken);
    return (next.length ? next : ["worker"]) as UiRole[];
  }

  async function updateStaffRoles(
    id: string,
    currentDbRoles: UiRole[],
    nextUiRoles: UiRole[],
    row?: StaffTableRow,
  ) {
    const nextRoles = sanitizeRolesForSave(nextUiRoles, true, currentDbRoles) as UiRole[];
    const primaryRole = pickPrimaryRole(nextRoles);
    setErr(null);

    const isActiveNow = row ? row.is_active : true;
    const nextShow = computeShowOnSite(isActiveNow, nextRoles, primaryRole);
    const payload: Record<string, unknown> = { role: primaryRole, roles: nextRoles };
    if (!staffMarketingColumnMissing) payload.show_on_marketing_site = nextShow;

    const { error } = await supabase.from("staff").update(payload).eq("id", id);
    if (error && isMissingStaffMarketingColumnError(error)) {
      setStaffMarketingColumnMissing(true);
      const retry = await supabase
        .from("staff")
        .update({ role: primaryRole, roles: nextRoles })
        .eq("id", id);
      if (retry.error) {
        setErr(retry.error.message);
        return;
      }
      void load();
      return;
    }
    if (error) {
      setErr(error.message);
      return;
    }
    void load();
  }

  function startEdit(r: StaffTableRow) {
    setEditingId(r.id);
    setEditName(r.name);
    setEditPhone(r.phone ?? "");
    setExpandedById((prev) => ({ ...prev, [r.id]: true }));
  }

  async function saveEdit() {
    if (!editingId) return;
    setErr(null);
    const { error } = await supabase
      .from("staff")
      .update({
        name: editName.trim(),
        phone: digitsOnly(editPhone) || null,
      })
      .eq("id", editingId);
    if (error) {
      setErr(error.message);
      return;
    }
    setEditingId(null);
    void load();
  }

  /** admin/owner никогда не светится на публичном сайте. Для остальных — показ совпадает с is_active. */
  function computeShowOnSite(isActive: boolean, roles: UiRole[], primaryRole?: string): boolean {
    if (!isActive) return false;
    const pr = String(primaryRole || "").toLowerCase();
    if (pr === "admin" || pr === "owner") return false;
    if (roles.some((r) => r === "admin")) return false;
    return true;
  }

  /** Один тумблер: «Активен» для CRM + публичный сайт. Для admin/owner публичный показ принудительно выключен. */
  async function updateStaffActive(r: StaffTableRow, is_active: boolean) {
    setErr(null);
    const roles = rowRoles(r);
    const show = computeShowOnSite(is_active, roles, r.role);

    const payload: Record<string, unknown> = { is_active };
    if (!staffMarketingColumnMissing) payload.show_on_marketing_site = show;

    const { error } = await supabase.from("staff").update(payload).eq("id", r.id);
    if (error && isMissingStaffMarketingColumnError(error)) {
      setStaffMarketingColumnMissing(true);
      const retry = await supabase.from("staff").update({ is_active }).eq("id", r.id);
      if (retry.error) {
        setErr(retry.error.message);
        return;
      }
      void load();
      return;
    }
    if (error) {
      setErr(error.message);
      return;
    }
    void load();
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const cleanPhone = noPhone ? "" : digitsOnly(phone);
    const n = name.trim();
    if (!n) {
      setErr("Укажите имя мастера.");
      return;
    }
    const normalizedNewRoles = sanitizeRolesForSave(newRoles, true, newRoles) as UiRole[];
    const primaryRole = pickPrimaryRole(normalizedNewRoles);
    const payload: Record<string, unknown> = {
      phone: cleanPhone || null,
      name: n,
      role: primaryRole,
      roles: normalizedNewRoles,
      is_active: true,
    };
    if (!staffMarketingColumnMissing) {
      payload.show_on_marketing_site = computeShowOnSite(true, normalizedNewRoles, primaryRole);
    }
    const { error } = await supabase.from("staff").insert(payload);
    if (error) {
      const raw = String(error.message || "");
      if (/null value.*column .?phone/i.test(raw)) {
        setErr(
          "В базе у колонки staff.phone стоит NOT NULL — примените миграцию 021, чтобы разрешить мастеров без телефона.",
        );
      } else if (/duplicate key|unique/i.test(raw) && cleanPhone) {
        setErr(`Мастер с телефоном ${cleanPhone} уже существует.`);
      } else {
        setErr(raw);
      }
      return;
    }
    setPhone("");
    setName("");
    setNoPhone(false);
    setNewRoles(["worker"]);
    void load();
  }

  async function remove(row: StaffTableRow) {
    setErr(null);
    if (!window.confirm(t("adminStaff.deleteConfirm", { name: row.name, defaultValue: `Удалить ${row.name} без восстановления?` }))) return;
    const { error } = await supabase.from("staff").delete().eq("id", row.id);
    if (error) {
      setErr(error.message);
      return;
    }
    void load();
  }

  async function resolveStaffLinkListingId(catalogServiceId: string, serviceName: string): Promise<string | null> {
    const cid = String(catalogServiceId || "").trim();
    const nm = String(serviceName || "").trim();
    let mapped = catalogIdToListingId[cid];
    if (!mapped) {
      for (const [k, v] of Object.entries(catalogIdToListingId)) {
        if (normId(k) === normId(cid)) {
          mapped = v;
          break;
        }
      }
    }
    if (mapped) return String(mapped);
    const probe = await supabase.from("service_listings").select("id").eq("id", cid).maybeSingle();
    if (!probe.error && probe.data?.id) return String(probe.data.id);
    if (nm) {
      const byName = await supabase.from("service_listings").select("id").eq("name", nm).maybeSingle();
      if (!byName.error && byName.data?.id) return String(byName.data.id);
      const byTrim = await supabase.from("service_listings").select("id").eq("name", nm.trim()).maybeSingle();
      if (!byTrim.error && byTrim.data?.id) return String(byTrim.data.id);
      const byIlike = await supabase.from("service_listings").select("id,name").ilike("name", nm);
      if (!byIlike.error && byIlike.data?.length === 1 && byIlike.data[0].id) return String(byIlike.data[0].id);
      const all = await supabase.from("service_listings").select("id,name");
      if (!all.error && all.data?.length) {
        const want = normServiceName(nm);
        for (const row of all.data as Array<{ id: string; name: string | null }>) {
          if (normServiceName(String(row.name || "")) === want) return String(row.id);
        }
      }
    }
    return null;
  }

  /** Если staff_services всё ещё ссылается на legacy `services`, нужен числовой id. */
  async function resolveLegacyServiceIdForStaffLink(rawCatalogId: string, serviceName: string): Promise<string | null> {
    const cid = String(rawCatalogId || "").trim();
    const nm = String(serviceName || "").trim();
    if (/^\d+$/.test(cid)) {
      const p = await supabase.from("services").select("id").eq("id", cid).maybeSingle();
      if (!p.error && p.data && (p.data as { id?: unknown }).id != null) return String((p.data as { id: unknown }).id);
    }
    if (nm) {
      const r1 = await supabase.from("services").select("id").eq("name_et", nm).limit(1).maybeSingle();
      if (!r1.error && r1.data && (r1.data as { id?: unknown }).id != null) return String((r1.data as { id: unknown }).id);
      const r2 = await supabase.from("services").select("id").eq("name", nm).limit(1).maybeSingle();
      if (!r2.error && r2.data && (r2.data as { id?: unknown }).id != null) return String((r2.data as { id: unknown }).id);
    }
    return null;
  }

  function isStaffServicesServiceFkError(msg: unknown): boolean {
    const m = String(msg || "").toLowerCase();
    return (
      m.includes("staff_services_service_id_fkey") ||
      (m.includes("foreign key") && m.includes("staff_services") && m.includes("service_id"))
    );
  }

  async function toggleService(staffId: string, serviceId: string, on: boolean) {
    setErr(null);
    const catalogSvc = activeServices.find((s) => String(s.id) === String(serviceId));
    const name = catalogSvc?.name || "";
    const rawId = String(serviceId);
    const explicitForStaff = links.filter((l) => String(l.staff_id) === String(staffId));

    /* Нет строк staff_services у мастера = по смыслу все услуги доступны; первый «выкл» ограничивает список */
    if (!on && explicitForStaff.length === 0) {
      const others = activeServices.filter((s) => String(s.id) !== String(serviceId));
      if (others.length === 0) {
        setErr(
          "Нельзя отключить единственную активную услугу: пустой список привязок в БД означает «все услуги». Добавьте в каталог ещё одну активную услугу или отключите мастера.",
        );
        return;
      }
      const { error: delErr } = await supabase.from("staff_services").delete().eq("staff_id", staffId);
      if (delErr) {
        setErr(delErr.message);
        return;
      }
      const failed: string[] = [];
      let inserted = 0;
      for (const s of others) {
        const r = await insertStaffServiceRow(staffId, s);
        if (r.ok) inserted++;
        else failed.push(s.name);
      }
      if (inserted === 0) {
        setErr(
          `Не удалось сохранить ни одной привязки (${failed.length ? `проблемные услуги: ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}` : "FK staff_services"}). Проверьте страницу «Услуги» — должны быть строки в service_listings.`,
        );
        void load();
        return;
      }
      if (failed.length) {
        setErr(
          `Часть услуг не удалось привязать (${failed.length}): ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}. Остальные сохранены — проверьте каталог и повторите.`,
        );
      }
      void load();
      return;
    }

    const listingId = await resolveStaffLinkListingId(rawId, name);
    const legacySvcId = await resolveLegacyServiceIdForStaffLink(rawId, name);
    /* FK staff_services «гуляет» между UUID (после 012) и legacy bigint — пробуем все варианты. */
    const candidateIds = [...new Set([listingId, legacySvcId, rawId].filter((x): x is string => Boolean(x)))];

    if (candidateIds.length === 0) {
      setErr(
        `Не удалось определить id услуги «${name || rawId}» для staff_services. Проверьте запись на странице «Услуги».`,
      );
      return;
    }

    if (on) {
      let lastFkMsg: string | null = null;
      for (const sid of candidateIds) {
        let { error } = await supabase
          .from("staff_services")
          .insert({ staff_id: staffId, service_id: sid, show_on_site: true });
        if (error && String(error.message || "").toLowerCase().includes("show_on_site")) {
          error = (await supabase.from("staff_services").insert({ staff_id: staffId, service_id: sid })).error ?? null;
        }
        if (!error) {
          void load();
          return;
        }
        const em = String(error.message || "").toLowerCase();
        if (em.includes("duplicate key") || em.includes("unique constraint")) {
          void load();
          return;
        }
        if (isStaffServicesServiceFkError(error.message) || em.includes("invalid input syntax") || em.includes("uuid")) {
          lastFkMsg = error.message;
          continue;
        }
        setErr(error.message);
        return;
      }
      setErr(
        `Не удалось сохранить привязку «${name || rawId}» — все кандидаты id упёрлись в FK/UUID. ` +
          (serviceListingsEmpty
            ? "Миграция 012 не применена: таблица service_listings пустая."
            : "В service_listings нет записи с таким UUID — синхронизируйте каталог на странице «Услуги».") +
          (lastFkMsg ? ` (БД: ${lastFkMsg})` : ""),
      );
      return;
    }

    let deleted = false;
    for (const sid of candidateIds) {
      const { error, data } = await supabase
        .from("staff_services")
        .delete()
        .eq("staff_id", staffId)
        .eq("service_id", sid)
        .select("staff_id");
      if (!error && data && data.length > 0) {
        deleted = true;
        break;
      }
    }
    if (!deleted) {
      /* fallback: может попасться запись, id которой в linking‑таблице не совпал ни с одним из наших id */
      const linkRow = links.find(
        (l) =>
          normId(l.staff_id) === normId(staffId) &&
          (normId(l.service_id) === normId(rawId) ||
            (listingId && normId(l.service_id) === normId(listingId)) ||
            (legacySvcId && normId(l.service_id) === normId(legacySvcId))),
      );
      if (linkRow) {
        await supabase.from("staff_services").delete().eq("staff_id", staffId).eq("service_id", linkRow.service_id);
      }
    }
    void load();
  }

  async function toggleShowOnSiteForLink(staffId: string, serviceId: string, show: boolean) {
    setErr(null);
    const catalogSvc = activeServices.find(
      (s) =>
        normId(s.id) === normId(serviceId) ||
        normId(catalogIdToListingId[String(s.id)] ?? s.id) === normId(serviceId),
    );
    const name = catalogSvc?.name || "";
    const rawId = String(serviceId);
    const listingId = await resolveStaffLinkListingId(rawId, name);
    const legacySvcId = await resolveLegacyServiceIdForStaffLink(rawId, name);
    const candidateIds = [...new Set([listingId, legacySvcId, rawId].filter((x): x is string => Boolean(x)))];

    if (candidateIds.length === 0) {
      setErr(
        `Не удалось сопоставить «${name || rawId}» с service_listings — обновите каталог на странице «Услуги».`,
      );
      return;
    }

    for (const sid of candidateIds) {
      const { error, data } = await supabase
        .from("staff_services")
        .update({ show_on_site: show })
        .eq("staff_id", staffId)
        .eq("service_id", sid)
        .select("staff_id");
      if (error && String(error.message || "").toLowerCase().includes("show_on_site")) {
        setErr(
          "Нужна миграция БД: staff_services.show_on_site (файл supabase/migrations/019_staff_services_show_on_site.sql).",
        );
        return;
      }
      if (error) {
        setErr(error.message);
        return;
      }
      if (data && data.length > 0) {
        void load();
        return;
      }
    }
    setErr("Не найдена привязка staff_services для этой услуги (проверьте id в каталоге).");
  }

  function hasLink(staffId: string, serviceId: string) {
    const explicit = links.filter((l) => String(l.staff_id) === String(staffId));
    if (explicit.length === 0) return true;
    let listingId = catalogIdToListingId[String(serviceId)];
    if (!listingId) {
      for (const [k, v] of Object.entries(catalogIdToListingId)) {
        if (normId(k) === normId(serviceId)) {
          listingId = v;
          break;
        }
      }
    }
    listingId ??= String(serviceId);
    return explicit.some(
      (l) =>
        normId(l.staff_id) === normId(staffId) &&
        (normId(l.service_id) === normId(serviceId) || normId(l.service_id) === normId(listingId)),
    );
  }

  /* Для UI админки: true только если строка реально существует в staff_services.
   * Отличается от `hasLink()`: там 0 привязок = «все услуги неявно» (для паблика),
   * а при назначении услуг мастеру нам нужно чётко видеть, что ещё не включено. */
  function hasExplicitLink(staffId: string, serviceId: string) {
    const explicit = links.filter((l) => String(l.staff_id) === String(staffId));
    if (explicit.length === 0) return false;
    let listingId = catalogIdToListingId[String(serviceId)];
    if (!listingId) {
      for (const [k, v] of Object.entries(catalogIdToListingId)) {
        if (normId(k) === normId(serviceId)) {
          listingId = v;
          break;
        }
      }
    }
    listingId ??= String(serviceId);
    return explicit.some(
      (l) =>
        normId(l.staff_id) === normId(staffId) &&
        (normId(l.service_id) === normId(serviceId) || normId(l.service_id) === normId(listingId)),
    );
  }

  function skillCatPanelKey(staffId: string, catName: string) {
    return `${staffId}::${catName}`;
  }

  function toggleSkillCategoryPanel(staffId: string, catName: string) {
    const k = skillCatPanelKey(staffId, catName);
    setSkillCategoryExpanded((prev) => ({ ...prev, [k]: !prev[k] }));
  }

  async function deleteStaffServiceRow(staffId: string, s: CatalogSkillService): Promise<boolean> {
    const rawId = String(s.id);
    const listingId = await resolveStaffLinkListingId(rawId, s.name);
    const legacySvcId = await resolveLegacyServiceIdForStaffLink(rawId, s.name);
    const candidateIds = [...new Set([listingId, legacySvcId, rawId].filter((x): x is string => Boolean(x)))];
    for (const svcId of candidateIds) {
      const { error } = await supabase.from("staff_services").delete().eq("staff_id", staffId).eq("service_id", svcId);
      if (!error) return true;
    }
    return false;
  }

  async function insertStaffServiceRow(
    staffId: string,
    s: CatalogSkillService,
  ): Promise<{ ok: boolean; error?: string }> {
    const rawId = String(s.id);
    const listingId = await resolveStaffLinkListingId(rawId, s.name);
    const legacySvcId = await resolveLegacyServiceIdForStaffLink(rawId, s.name);
    /* FK схемы гуляет: 012 мигрирует на UUID service_listings, а старые базы держат bigint services.
     * Пробуем по очереди, на первой удачной — выходим. */
    const candidateIds = [...new Set([listingId, legacySvcId, rawId].filter((x): x is string => Boolean(x)))];
    if (!candidateIds.length) return { ok: false, error: `«${s.name}»: не удалось определить id для staff_services` };
    let lastFkMsg: string | null = null;
    for (const sid of candidateIds) {
      let { error } = await supabase
        .from("staff_services")
        .insert({ staff_id: staffId, service_id: sid, show_on_site: true });
      if (error && String(error.message || "").toLowerCase().includes("show_on_site")) {
        error = (await supabase.from("staff_services").insert({ staff_id: staffId, service_id: sid })).error ?? null;
      }
      if (!error) return { ok: true };
      const em = String(error.message || "").toLowerCase();
      if (em.includes("duplicate key") || em.includes("unique constraint")) return { ok: true };
      if (isStaffServicesServiceFkError(error.message) || em.includes("invalid input syntax") || em.includes("uuid")) {
        lastFkMsg = error.message;
        continue;
      }
      return { ok: false, error: error.message };
    }
    return { ok: false, error: lastFkMsg || "FK staff_services" };
  }

  async function toggleCategoryForStaff(staffId: string, catSvcs: CatalogSkillService[], turnOn: boolean) {
    setErr(null);
    if (!catSvcs.length) return;
    const catIdSet = new Set(catSvcs.map((s) => String(s.id)));
    const explicitForStaff = links.filter((l) => String(l.staff_id) === String(staffId));

    if (!turnOn) {
      if (explicitForStaff.length === 0) {
        const others = activeServices.filter((s) => !catIdSet.has(String(s.id)));
        if (others.length === 0) {
          setErr(
            "Нельзя отключить всю категорию: в каталоге нет услуг вне неё. Добавьте услуги в другой категории или снимайте отметки по одной услуге.",
          );
          return;
        }
        const { error: delErr } = await supabase.from("staff_services").delete().eq("staff_id", staffId);
        if (delErr) {
          setErr(delErr.message);
          return;
        }
        const failed: string[] = [];
        let inserted = 0;
        for (const s of others) {
          const r = await insertStaffServiceRow(staffId, s);
          if (r.ok) inserted++;
          else failed.push(s.name);
        }
        if (inserted === 0) {
          setErr(
            `Не удалось сохранить ни одной привязки (${failed.length ? `проблемные: ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}` : "FK staff_services"}). Проверьте каталог на странице «Услуги».`,
          );
          void load();
          return;
        }
        if (failed.length) {
          setErr(
            `Часть услуг не удалось привязать (${failed.length}): ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}. Остальные сохранены.`,
          );
        }
        void load();
        return;
      }
      for (const s of catSvcs) {
        await deleteStaffServiceRow(staffId, s);
      }
      void load();
      return;
    }

    /* Нет ни одной строки в staff_services = мастер в режиме «все услуги по умолчанию».
     * Когда админ впервые явно включает категорию, переводим его в режим «явный список»,
     * добавляя переданные услуги. Остальные услуги перестают считаться доступными. */
    const failed: string[] = [];
    for (const s of catSvcs) {
      if (explicitForStaff.length > 0 && hasLink(staffId, s.id)) continue;
      const r = await insertStaffServiceRow(staffId, s);
      if (!r.ok) failed.push(s.name);
    }
    if (failed.length) {
      setErr(
        `Не удалось привязать ${failed.length} услуг${failed.length === 1 ? "у" : ""}: ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}. ` +
          (serviceListingsEmpty
            ? "Сначала примените миграцию 012 (service_listings)."
            : "Проверьте запись в service_listings на странице «Услуги»."),
      );
    }
    void load();
  }

  function assignedServicesForStaff(staffId: string) {
    return links
      .filter((l) => String(l.staff_id) === String(staffId))
      .map((l) => {
        const sid = l.service_id != null ? String(l.service_id) : "";
        const svc = services.find(
          (s) =>
            normId(s.id) === normId(sid) ||
            normId(catalogIdToListingId[String(s.id)] ?? s.id) === normId(sid),
        );
        const catName = String(svc?.category_name || "").trim() || "Без категории";
        return {
          serviceId: sid,
          name: svc?.name?.trim() || (sid ? `Услуга ${sid}` : "Неизвестная услуга"),
          categoryName: catName,
          show_on_site: l.show_on_site !== false,
        };
      })
      .filter((x) => x.serviceId);
  }

  function groupAssignedByCategory(
    assigned: ReturnType<typeof assignedServicesForStaff>,
  ): { name: string; items: typeof assigned }[] {
    const m = new Map<string, typeof assigned>();
    for (const a of assigned) {
      const key = a.categoryName || "Без категории";
      if (!m.has(key)) m.set(key, [] as typeof assigned);
      m.get(key)!.push(a);
    }
    return [...m.entries()]
      .sort(([a], [b]) => compareCategories(a, b))
      .map(([name, items]) => ({
        name,
        items: [...items].sort((x, y) => x.name.localeCompare(y.name, "ru")),
      }));
  }

  function assignedCatPanelKey(staffId: string, catName: string) {
    return `assigned::${staffId}::${catName}`;
  }
  function toggleAssignedCategoryPanel(staffId: string, catName: string) {
    const k = assignedCatPanelKey(staffId, catName);
    setSkillCategoryExpanded((prev) => ({ ...prev, [k]: !prev[k] }));
  }

  /**
   * Перекладывает категорию `src` на место `target` (вставка «перед»). Пишет новый
   * `sort_order` во все перечисленные в `service_categories` строки. «Без категории»
   * в таблице не хранится, поэтому её перетащить нельзя — она всегда в конце.
   */
  async function reorderCategory(src: string, target: string) {
    if (!src || !target || src === target) return;
    if (src === "Без категории" || target === "Без категории") return;

    const list = [...categoriesMeta].sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ru"),
    );
    const srcIdx = list.findIndex((c) => c.name === src);
    if (srcIdx < 0) return;
    const [moved] = list.splice(srcIdx, 1);
    const newTgtIdx = list.findIndex((c) => c.name === target);
    if (newTgtIdx < 0) {
      list.push(moved);
    } else {
      list.splice(newTgtIdx, 0, moved);
    }

    const updates = list.map((c, i) => ({ ...c, sort_order: (i + 1) * 10 }));
    setCategoriesMeta(updates);

    setErr(null);
    for (const u of updates) {
      const { error } = await supabase
        .from("service_categories")
        .update({ sort_order: u.sort_order })
        .eq("id", u.id);
      if (error) {
        setErr(`Не удалось сохранить порядок категорий: ${error.message}`);
        break;
      }
    }
    void load();
  }

  /* ───────── Drag-and-drop для блоков «Активные / Неактивные услуги мастера» ─────────
   * Семантика:
   *   • Drag внутри той же секции у того же мастера → reorderCategory (как было).
   *   • Drag из «Неактивные» в «Активные»          → toggleCategoryForStaff(..., true)
   *     (равно нажатию кнопки «добавить все»).
   *   • Drag из «Активные» в «Неактивные»          → toggleCategoryForStaff(..., false)
   *     (равно нажатию «убрать категорию»). Удобно, если мастер больше не делает услугу.
   * Защита:
   *   • «Без категории» по-прежнему не таскаем (она и в reorder заблокирована).
   *   • Drag между разными мастерами игнорируется (нет UX-смысла).               */
  function onSkillCardDragStart(
    e: React.DragEvent,
    ctx: {
      staffId: string;
      catName: string;
      from: "assigned" | "inactive";
      services: CatalogSkillService[];
    },
  ) {
    if (ctx.catName === "Без категории") {
      e.preventDefault();
      return;
    }
    setSkillDrag(ctx);
    setDraggedCatName(ctx.catName);
    try {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", ctx.catName);
    } catch {
      /* Safari иногда бросает на dataTransfer.setData с не-text типами */
    }
  }

  function onSkillCardDragOver(e: React.DragEvent) {
    if (!skillDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  /** Drop на секцию (assigned/inactive) или конкретную карточку.
   * targetCatName === null → drop в «пустоту» секции, тогда reorder невозможен,
   * но cross-section move сработает. */
  function onSkillCardDrop(
    e: React.DragEvent,
    target: { staffId: string; section: "assigned" | "inactive"; catName: string | null },
  ) {
    e.preventDefault();
    e.stopPropagation();
    const src = skillDrag;
    setSkillDrag(null);
    setDraggedCatName(null);
    if (!src) return;
    if (src.staffId !== target.staffId) return; // нельзя перетащить услуги одного мастера к другому

    if (src.from !== target.section) {
      void toggleCategoryForStaff(src.staffId, src.services, target.section === "assigned");
      return;
    }
    if (!target.catName || target.catName === src.catName) return;
    void reorderCategory(src.catName, target.catName);
  }

  function onSkillCardDragEnd() {
    setSkillDrag(null);
    setDraggedCatName(null);
  }

  if (loading) return <p className="text-zinc-500">{t("common.loading")}</p>;

  const isAdminRow = (r: StaffTableRow): boolean => {
    const pr = String(r.role || "").toLowerCase();
    if (pr === "admin" || pr === "owner") return true;
    return rowRoles(r).some((x) => x === "admin");
  };
  const salonRows = rows.filter((r) => !isAdminRow(r));
  const adminRows = rows.filter(isAdminRow);

  return (
    <div className="max-w-5xl space-y-6 text-zinc-200">
      <header>
        <h1 className="text-xl font-semibold text-white">{t("nav.adminStaff")}</h1>
        <p className="mt-1 text-sm text-zinc-500">{t("adminStaff.subtitle")}</p>
        <SalonCalendarSettingsCard onError={setErr} />
      </header>

      {staffMarketingColumnMissing && (
        <p className="rounded border border-amber-800/50 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
          В проекте БД нет колонки <code className="rounded bg-black/40 px-1">staff.show_on_marketing_site</code> — поэтому
          переключатели «Сайт / запись» не могут сохраниться. Откройте Supabase → SQL Editor и выполните файл{" "}
          <code className="rounded bg-black/40 px-1">supabase/migrations/020_staff_show_on_marketing_site.sql</code>
          (или <code className="rounded bg-black/40 px-1">supabase db push</code>), затем обновите эту страницу.
        </p>
      )}

      {serviceListingsEmpty && (
        <p className="rounded border border-amber-800/50 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
          Таблица <code className="rounded bg-black/40 px-1">service_listings</code> пустая — CRM показывает услуги из
          старой таблицы <code className="rounded bg-black/40 px-1">services</code> с числовыми id, а{" "}
          <code className="rounded bg-black/40 px-1">staff_services.service_id</code> ждёт UUID. Поэтому переключатели
          услуг падают с ошибкой внешнего ключа. Запустите миграцию{" "}
          <code className="rounded bg-black/40 px-1">supabase/migrations/012_service_listings_fk.sql</code> или добавьте
          услуги в новой схеме на странице «Услуги», затем обновите эту страницу.
        </p>
      )}

      {err && (
        <p className="rounded border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">{err}</p>
      )}

      <form
        onSubmit={onAdd}
        className="rounded-lg border border-zinc-800 bg-gradient-to-b from-zinc-950 to-black/60 p-4 shadow-inner shadow-black/40 sm:p-5"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-wide text-zinc-100">Добавить мастера</h2>
          <span className="text-[11px] text-zinc-500">
            роль можно изменить позже в строке мастера
          </span>
        </div>

        <div className="grid gap-x-3 gap-y-1 sm:grid-cols-[minmax(13rem,1.1fr)_minmax(12rem,1fr)_auto_auto] sm:items-end">
          <div className="flex min-w-0 items-baseline justify-between gap-2">
            <label
              htmlFor="staff-new-phone"
              className="text-[11px] font-medium uppercase tracking-wide text-zinc-500"
            >
              {t("login.phone")}
            </label>
            <button
              type="button"
              onClick={() => setNoPhone((v) => !v)}
              aria-pressed={noPhone}
              className={
                "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide transition select-none " +
                (noPhone
                  ? "border-amber-500/50 bg-amber-500/15 text-amber-200"
                  : "border-zinc-700 bg-zinc-900/50 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200")
              }
              title="Добавить мастера без номера телефона"
            >
              <span
                aria-hidden="true"
                className={
                  "flex h-3 w-3 items-center justify-center rounded-full border text-[9px] leading-none " +
                  (noPhone ? "border-amber-300 bg-amber-300 text-black" : "border-zinc-500")
                }
              >
                {noPhone ? "✓" : ""}
              </span>
              без номера
            </button>
          </div>
          <label
            htmlFor="staff-new-name"
            className="text-[11px] font-medium uppercase tracking-wide text-zinc-500"
          >
            {t("adminStaff.name")}
          </label>
          <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            {t("role.label")}
          </span>
          <span aria-hidden="true" />

          <input
            id="staff-new-phone"
            value={noPhone ? "" : phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={noPhone}
            className="h-9 w-full rounded-md border border-zinc-700 bg-black/80 px-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-sky-600/60 focus:ring-1 focus:ring-sky-600/40 disabled:cursor-not-allowed disabled:border-dashed disabled:border-zinc-700 disabled:bg-zinc-950/50 disabled:text-zinc-500 disabled:opacity-80"
            placeholder={noPhone ? "не требуется для входа" : "введите номер"}
            inputMode="tel"
            autoComplete="off"
          />
          <input
            id="staff-new-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 w-full rounded-md border border-zinc-700 bg-black/80 px-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-sky-600/60 focus:ring-1 focus:ring-sky-600/40"
            placeholder="имя мастера"
          />
          <div className="flex h-9 items-center gap-1">
            {(["admin", "manager", "worker"] as UiRole[]).map((r) => {
              const on = newRoles.includes(r);
              const lbl =
                r === "admin" ? t("role.admin") : r === "manager" ? t("role.manager") : t("role.worker");
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() =>
                    setNewRoles((prev) => toggleRoleToken(prev, r, !prev.includes(r)))
                  }
                  aria-pressed={on}
                  className={
                    "h-8 rounded-full border px-3 text-xs transition select-none " +
                    (on
                      ? "border-sky-500/60 bg-sky-600/20 text-sky-100 shadow-sm shadow-sky-900/40"
                      : "border-zinc-700 bg-zinc-900/40 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200")
                  }
                >
                  {lbl}
                </button>
              );
            })}
          </div>
          <button
            type="submit"
            className="inline-flex h-9 items-center justify-center rounded-md bg-sky-600 px-4 text-sm font-semibold text-white shadow-sm shadow-sky-950/40 transition hover:bg-sky-500 active:bg-sky-700"
          >
            {t("common.add")}
          </button>
        </div>
      </form>

      <div className="overflow-x-auto border border-zinc-800">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              <th className="border-b border-zinc-800 px-3 py-2">{t("login.phone")}</th>
              <th className="border-b border-zinc-800 px-3 py-2">{t("adminStaff.name")}</th>
              <th className="border-b border-zinc-800 px-3 py-2">{t("adminStaff.roleBrief")}</th>
              <th className="border-b border-zinc-800 px-3 py-2">{t("adminStaff.active")}</th>
              <th className="min-w-[10rem] border-b border-zinc-800 px-3 py-2">{t("adminStaff.services")}</th>
              <th className="border-b border-zinc-800 px-3 py-2">actions</th>
            </tr>
          </thead>
          <tbody>
            {salonRows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-xs text-zinc-500"
                >
                  Пока нет мастеров и менеджеров. Добавьте первого через форму выше.
                </td>
              </tr>
            )}
            {salonRows.map((r) => {
              const assigned = assignedServicesForStaff(r.id);
              const expanded = !!expandedById[r.id];
              return (
                <Fragment key={r.id}>
                  <tr className="border-b border-zinc-800/80 align-middle">
                    <td className="px-3 py-2 font-mono text-zinc-300">
                      {editingId === r.id ? (
                        <input
                          value={editPhone}
                          onChange={(e) => setEditPhone(e.target.value)}
                          className="w-full rounded border border-zinc-600 bg-black px-1 py-0.5 text-xs"
                        />
                      ) : (
                        r.phone ?? "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editingId === r.id ? (
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full rounded border border-zinc-600 bg-black px-1 py-0.5 text-xs"
                        />
                      ) : (
                        r.name
                      )}
                    </td>
                    <td className="max-w-[14rem] px-3 py-2 text-xs text-zinc-400">{roleLabelsSummary(r)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-0.5 text-xs">
                        <div className="flex items-center gap-2">
                          <ToggleSwitch
                            checked={r.is_active}
                            onCheckedChange={(v) => void updateStaffActive(r, v)}
                            aria-label={`${r.name}: активен в CRM и на сайте`}
                          />
                          <span className="text-zinc-500">
                            {r.is_active ? t("adminStaff.yes") : t("adminStaff.no")}
                          </span>
                        </div>
                        {(() => {
                          const pr = String(r.role || "").toLowerCase();
                          const isAdmin =
                            pr === "admin" || pr === "owner" || rowRoles(r).some((x) => x === "admin");
                          if (isAdmin) {
                            return (
                              <span className="text-[10px] leading-snug text-zinc-600">
                                админ — скрыт на сайте
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs text-zinc-500">
                          {assigned.length === 0
                            ? t("adminStaff.assignedNone")
                            : t("adminStaff.assignedCount", { count: assigned.length })}
                        </span>
                        <button
                          type="button"
                          className="w-fit rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-left text-xs text-zinc-200 hover:border-zinc-500 hover:text-white"
                          onClick={() => toggleRowExpanded(r.id)}
                        >
                          {expanded ? t("adminStaff.collapseRow") : t("adminStaff.expandRow")}
                        </button>
                      </div>
                    </td>
                    <td className="space-x-2 px-3 py-2 whitespace-nowrap">
                      {editingId === r.id ? (
                        <>
                          <button type="button" className="text-sky-400 underline" onClick={() => void saveEdit()}>
                            {t("common.save")}
                          </button>
                          <button type="button" className="text-zinc-500 underline" onClick={() => setEditingId(null)}>
                            {t("common.cancel")}
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="text-sky-400 underline" onClick={() => startEdit(r)}>
                            {t("adminStaff.edit")}
                          </button>
                          <button type="button" className="text-red-400 underline" onClick={() => void remove(r)}>
                            delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="border-b border-zinc-800/80 bg-zinc-950/50 align-top">
                      <td colSpan={6} className="px-3 py-3">
                        <div className="flex flex-col gap-4 text-sm">
                          <div>
                            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                              {t("role.label")}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {(["admin", "manager", "worker"] as UiRole[]).map((roleToken) => {
                                const current = rowRoles(r);
                                return (
                                  <label key={roleToken} className="inline-flex items-center gap-1 text-xs text-zinc-300">
                                    <input
                                      type="checkbox"
                                      checked={current.includes(roleToken)}
                                      onChange={(e) =>
                                        void updateStaffRoles(
                                          r.id,
                                          current,
                                          toggleRoleToken(current, roleToken, e.target.checked),
                                          r,
                                        )
                                      }
                                    />
                                    {roleToken === "admin"
                                      ? t("role.admin")
                                      : roleToken === "manager"
                                        ? t("role.manager")
                                        : t("role.worker")}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                          <div className="flex flex-col gap-1 rounded border border-zinc-800/80 p-2">
                            <span className="text-[11px] font-medium uppercase text-zinc-500">
                              Календарь сотрудника
                            </span>
                            <StaffCalendarEmailField row={r} onSaved={() => void load()} onError={setErr} />
                            <span className="text-[10px] leading-snug text-zinc-600">
                              Персональный e-mail для Google/Apple/Outlook календаря. На него будут
                              приходить приглашения и ICS-файлы записей, когда подключим интеграцию.
                            </span>
                          </div>
                          <div className="flex flex-col gap-1 rounded border border-zinc-800/80 p-2">
                            <span className="text-[11px] font-medium uppercase text-zinc-500">
                              {t("adminStaff.active")}
                            </span>
                            <div className="flex items-center gap-2 text-xs">
                              <ToggleSwitch
                                checked={r.is_active}
                                onCheckedChange={(v) => void updateStaffActive(r, v)}
                                aria-label={`${r.name}: активен в CRM и на сайте`}
                              />
                              <span className="text-zinc-400">
                                {r.is_active ? "Активен" : "Неактивен"}
                              </span>
                            </div>
                            {(() => {
                              const pr = String(r.role || "").toLowerCase();
                              const isAdmin =
                                pr === "admin" || pr === "owner" || rowRoles(r).some((x) => x === "admin");
                              return (
                                <span className="text-[10px] leading-snug text-zinc-600">
                                  Один переключатель: включает мастера и в CRM, и в публичной записи, и в блоке
                                  «Мастера» на сайте.
                                  {isAdmin
                                    ? " Для ролей admin/owner публичный показ принудительно выключен."
                                    : ""}
                                </span>
                              );
                            })()}
                          </div>
                          <div className="space-y-4">
                            {/* ───────── Активные услуги мастера ───────── */}
                            <section
                              className={
                                "rounded border bg-emerald-950/10 px-2 py-2 transition-colors " +
                                (skillDrag &&
                                skillDrag.staffId === r.id &&
                                skillDrag.from === "inactive"
                                  ? "border-emerald-500/70 bg-emerald-900/20 ring-1 ring-emerald-400/40"
                                  : "border-emerald-900/40")
                              }
                              onDragOver={onSkillCardDragOver}
                              onDrop={(e) =>
                                onSkillCardDrop(e, {
                                  staffId: r.id,
                                  section: "assigned",
                                  catName: null,
                                })
                              }
                            >
                              <header className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-300/90">
                                  Активные услуги
                                  <span className="ml-1 text-[10px] font-normal normal-case tracking-normal text-emerald-400/50">
                                    — что делает мастер ({assigned.length})
                                  </span>
                                </p>
                                <span className="text-[10px] text-zinc-500">
                                  тащите карточку: вверх/вниз — порядок, в «Неактивные» — убрать категорию
                                </span>
                              </header>
                              {assigned.length === 0 ? (
                                <p className="mt-1 text-xs text-zinc-500">
                                  Нет активных услуг. Включите тумблеры в блоке «Неактивные услуги» ниже.
                                </p>
                              ) : (
                                <div className="mt-1 space-y-1.5">
                                  {groupAssignedByCategory(assigned).map(({ name: catName, items }, catIdx) => {
                                    const expanded = !!skillCategoryExpanded[assignedCatPanelKey(r.id, catName)];
                                    const assignedCatPanelId = `staff-${r.id}-assigned-catpanel-${catIdx}`;
                                    const siteCount = items.filter((x) => x.show_on_site).length;
                                    const draggable = catName !== "Без категории";
                                    const isDragged = draggedCatName === catName;
                                    const isDropTarget = draggable && draggedCatName && draggedCatName !== catName;
                                    /* Полный набор услуг этой категории из каталога —
                                     * нужен для cross-section move (toggleCategoryForStaff). */
                                    const fullCatSvcs =
                                      activeServicesByCategory.find((c) => c.name === catName)?.services || [];
                                    return (
                                      <div
                                        key={catName}
                                        /* Вся карточка категории — drag source и drop target.
                                         * Интерактивные элементы внутри (кнопки/тогглы) не запускают drag,
                                         * потому что их нативный pointer capture срабатывает раньше. */
                                        draggable={draggable}
                                        onDragStart={(e) =>
                                          onSkillCardDragStart(e, {
                                            staffId: r.id,
                                            catName,
                                            from: "assigned",
                                            services: fullCatSvcs,
                                          })
                                        }
                                        onDragEnd={onSkillCardDragEnd}
                                        onDragOver={draggable ? onSkillCardDragOver : undefined}
                                        onDrop={
                                          draggable
                                            ? (e) =>
                                                onSkillCardDrop(e, {
                                                  staffId: r.id,
                                                  section: "assigned",
                                                  catName,
                                                })
                                            : undefined
                                        }
                                        className={
                                          "group relative rounded-md border bg-black/25 transition-all duration-150 " +
                                          (draggable
                                            ? "cursor-grab active:cursor-grabbing hover:border-emerald-800/80 hover:bg-emerald-950/20 "
                                            : "") +
                                          (isDragged
                                            ? "border-sky-500/80 bg-sky-950/20 opacity-60 shadow-lg shadow-sky-500/20 ring-1 ring-sky-500/40"
                                            : isDropTarget
                                              ? "border-dashed border-sky-700/70"
                                              : "border-zinc-800/60")
                                        }
                                      >
                                        <div className="flex w-full items-center gap-2 px-2 py-2 text-left">
                                          <span
                                            className={
                                              "shrink-0 select-none font-mono text-[11px] leading-none transition-colors " +
                                              (draggable
                                                ? "text-zinc-600 group-hover:text-emerald-400"
                                                : "text-zinc-700 opacity-40")
                                            }
                                            title={
                                              draggable
                                                ? "Потяните карточку в любом месте, чтобы изменить порядок"
                                                : "«Без категории» не перемещается"
                                            }
                                            aria-hidden="true"
                                          >
                                            ⋮⋮
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => toggleAssignedCategoryPanel(r.id, catName)}
                                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                            aria-expanded={expanded}
                                            aria-controls={assignedCatPanelId}
                                            draggable={false}
                                          >
                                            <span className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 transition group-hover:border-zinc-600">
                                              {expanded ? "▼" : "▶"}
                                            </span>
                                            <span className="min-w-0 flex-1 text-xs font-medium text-zinc-200">
                                              {catName}
                                            </span>
                                            <span className="shrink-0 text-[10px] text-zinc-500">
                                              {siteCount}/{items.length} на сайте
                                            </span>
                                          </button>
                                        </div>
                                        {expanded && (
                                          <ul
                                            id={assignedCatPanelId}
                                            className="space-y-1.5 border-t border-zinc-800/50 px-2 py-2 text-xs text-zinc-200"
                                          >
                                            {items.map((a) => (
                                              <li
                                                key={a.serviceId}
                                                className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-zinc-800/60 pb-1 last:border-0 last:pb-0"
                                              >
                                                <span className="min-w-0 flex-1 font-medium text-zinc-100">
                                                  {a.name}
                                                </span>
                                                <span
                                                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                                                    a.show_on_site
                                                      ? "border border-emerald-800/60 text-emerald-300"
                                                      : "border border-amber-800/60 text-amber-200"
                                                  }`}
                                                >
                                                  {a.show_on_site ? "на сайте" : "только CRM"}
                                                </span>
                                                <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-zinc-400">
                                                  <ToggleSwitch
                                                    size="sm"
                                                    checked={a.show_on_site}
                                                    onCheckedChange={(v) =>
                                                      void toggleShowOnSiteForLink(r.id, a.serviceId, v)
                                                    }
                                                    aria-label={`${a.name}: на сайте`}
                                                  />
                                                  <span>сайт</span>
                                                </div>
                                                <button
                                                  type="button"
                                                  onClick={() => void toggleService(r.id, a.serviceId, false)}
                                                  className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-500 transition hover:border-red-800/60 hover:text-red-300"
                                                  title="Убрать услугу у мастера"
                                                >
                                                  убрать
                                                </button>
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </section>

                            {/* ───────── Неактивные услуги ───────── */}
                            {(() => {
                              const inactiveByCat = activeServicesByCategory
                                .map(({ name: catName, services: catSvcs }) => ({
                                  name: catName,
                                  services: catSvcs.filter((s) => !hasExplicitLink(r.id, s.id)),
                                  total: catSvcs.length,
                                }))
                                .filter((c) => c.services.length > 0);
                              const totalInactive = inactiveByCat.reduce(
                                (sum, c) => sum + c.services.length,
                                0,
                              );
                              return (
                                <section
                                  className={
                                    "rounded border bg-black/20 px-2 py-2 transition-colors " +
                                    (skillDrag &&
                                    skillDrag.staffId === r.id &&
                                    skillDrag.from === "assigned"
                                      ? "border-amber-500/70 bg-amber-950/15 ring-1 ring-amber-400/30"
                                      : "border-zinc-800/80")
                                  }
                                  onDragOver={onSkillCardDragOver}
                                  onDrop={(e) =>
                                    onSkillCardDrop(e, {
                                      staffId: r.id,
                                      section: "inactive",
                                      catName: null,
                                    })
                                  }
                                >
                                  <header className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                                    <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                                      Неактивные услуги
                                      <span className="ml-1 text-[10px] font-normal normal-case tracking-normal text-zinc-500">
                                        — включите, чтобы добавить мастеру ({totalInactive})
                                      </span>
                                    </p>
                                    <span className="text-[10px] text-zinc-500">
                                      тащите в «Активные», чтобы добавить категорию мастеру
                                    </span>
                                  </header>
                                  {activeServices.length === 0 ? (
                                    <p className="text-xs text-zinc-500">
                                      Каталог услуг пуст — добавьте услуги на странице «Услуги».
                                    </p>
                                  ) : inactiveByCat.length === 0 ? (
                                    <p className="text-xs text-zinc-500">
                                      Мастер уже закреплён за всеми услугами салона.
                                    </p>
                                  ) : (
                                    <div className="max-h-[min(28rem,70vh)] space-y-1.5 overflow-y-auto">
                                      {inactiveByCat.map(({ name: catName, services: catSvcs }, catIdx) => {
                                        const expanded =
                                          !!skillCategoryExpanded[skillCatPanelKey(r.id, catName)];
                                        const catPanelId = `staff-${r.id}-catpanel-${catIdx}`;
                                        const draggable = catName !== "Без категории";
                                        const isDragged = draggedCatName === catName;
                                        const isDropTarget =
                                          draggable && draggedCatName && draggedCatName !== catName;
                                        /* В «Неактивные» уже передаётся отфильтрованный catSvcs
                                         * (только то, что НЕ привязано к мастеру). Для добавления
                                         * категории целиком этого достаточно — всё что и так привязано,
                                         * trigger в toggleCategoryForStaff пропустит. */
                                        return (
                                          <div
                                            key={catName}
                                            draggable={draggable}
                                            onDragStart={(e) =>
                                              onSkillCardDragStart(e, {
                                                staffId: r.id,
                                                catName,
                                                from: "inactive",
                                                services: catSvcs,
                                              })
                                            }
                                            onDragEnd={onSkillCardDragEnd}
                                            onDragOver={draggable ? onSkillCardDragOver : undefined}
                                            onDrop={
                                              draggable
                                                ? (e) =>
                                                    onSkillCardDrop(e, {
                                                      staffId: r.id,
                                                      section: "inactive",
                                                      catName,
                                                    })
                                                : undefined
                                            }
                                            className={
                                              "group relative rounded-md border bg-black/25 transition-all duration-150 " +
                                              (draggable
                                                ? "cursor-grab active:cursor-grabbing hover:border-sky-800/80 hover:bg-sky-950/15 "
                                                : "") +
                                              (isDragged
                                                ? "border-sky-500/80 bg-sky-950/20 opacity-60 shadow-lg shadow-sky-500/20 ring-1 ring-sky-500/40"
                                                : isDropTarget
                                                  ? "border-dashed border-sky-700/70"
                                                  : "border-zinc-800/60")
                                            }
                                          >
                                            <div className="flex flex-wrap items-center gap-2 px-2 py-2">
                                              <span
                                                className={
                                                  "shrink-0 select-none font-mono text-[11px] leading-none transition-colors " +
                                                  (draggable
                                                    ? "text-zinc-600 group-hover:text-sky-400"
                                                    : "text-zinc-700 opacity-40")
                                                }
                                                title={
                                                  draggable
                                                    ? "Потяните карточку в любом месте, чтобы изменить порядок"
                                                    : "«Без категории» не перемещается"
                                                }
                                                aria-hidden="true"
                                              >
                                                ⋮⋮
                                              </span>
                                              <button
                                                type="button"
                                                onClick={() => toggleSkillCategoryPanel(r.id, catName)}
                                                className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 transition hover:border-zinc-500 hover:bg-zinc-800"
                                                aria-expanded={expanded}
                                                aria-controls={catPanelId}
                                                title={
                                                  expanded ? "Свернуть список услуг" : "Показать услуги категории"
                                                }
                                                draggable={false}
                                              >
                                                {expanded ? "▼" : "▶"}
                                              </button>
                                              <span className="min-w-0 flex-1 text-xs font-medium text-zinc-200">
                                                {catName}
                                              </span>
                                              <span className="shrink-0 rounded-full bg-zinc-900/80 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                                                {catSvcs.length} не включено
                                              </span>
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  void toggleCategoryForStaff(r.id, catSvcs, true)
                                                }
                                                className="shrink-0 rounded border border-emerald-800/60 bg-emerald-900/20 px-2 py-0.5 text-[10px] font-medium text-emerald-200 transition hover:border-emerald-600/80 hover:bg-emerald-800/30"
                                                title="Добавить все услуги категории мастеру"
                                                draggable={false}
                                              >
                                                добавить все
                                              </button>
                                            </div>
                                            {expanded && (
                                              <div
                                                id={catPanelId}
                                                className="flex flex-wrap gap-x-3 gap-y-1 border-t border-zinc-800/50 px-2 py-2"
                                              >
                                                {catSvcs.map((s) => (
                                                  <div
                                                    key={s.id}
                                                    className="flex max-w-[11rem] items-center gap-1.5 text-xs text-zinc-400"
                                                  >
                                                    <ToggleSwitch
                                                      size="sm"
                                                      checked={false}
                                                      onCheckedChange={(v) =>
                                                        void toggleService(r.id, s.id, v)
                                                      }
                                                      aria-label={`${r.name}: ${s.name}`}
                                                    />
                                                    <span className="min-w-0 truncate" title={s.name}>
                                                      {s.name}
                                                    </span>
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </section>
                              );
                            })()}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <section
        aria-label="Техническая команда, поддержка сайта"
        className="mt-10 rounded-lg border border-amber-900/30 bg-gradient-to-br from-amber-950/20 via-zinc-950 to-black/60 p-4 shadow-inner shadow-black/40 sm:p-5"
      >
        <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-semibold tracking-wide text-amber-100/90">
              Техническая команда
            </h2>
            <span className="text-[11px] tracking-wide text-amber-200/50">
              · поддержка сайта и CRM
            </span>
          </div>
          <span className="text-[11px] text-zinc-500">
            не участвует в расписании салона
          </span>
        </header>

        {adminRows.length === 0 ? (
          <p className="text-xs text-zinc-500">
            Пока нет администраторов. Добавьте сотрудника с ролью «Админ» через форму выше — он
            появится здесь, а не в таблице салона.
          </p>
        ) : (
          <ul className="divide-y divide-amber-900/20">
            {adminRows.map((r) => {
              const isOwner = String(r.role || "").toLowerCase() === "owner";
              const isEditing = editingId === r.id;
              const initial = (r.name || "?").trim().slice(0, 1).toUpperCase();
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 text-sm"
                >
                  <div className="flex min-w-[9rem] flex-1 items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-amber-800/40 bg-amber-900/25 text-[12px] font-semibold text-amber-200/85"
                    >
                      {initial}
                    </span>
                    <div className="min-w-0 leading-tight">
                      {isEditing ? (
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full rounded border border-zinc-600 bg-black px-1 py-0.5 text-xs text-zinc-100"
                          aria-label="Имя"
                        />
                      ) : (
                        <span className="block truncate font-medium text-zinc-100">
                          {r.name}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-800/40 bg-amber-900/20 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide text-amber-200/80">
                        {isOwner ? "Owner" : "Админ"}
                      </span>
                    </div>
                  </div>

                  <div className="min-w-[7rem] text-xs">
                    <span className="block text-[10px] uppercase tracking-wide text-zinc-600">
                      {t("login.phone")}
                    </span>
                    {isEditing ? (
                      <input
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        className="mt-0.5 w-full rounded border border-zinc-600 bg-black px-1 py-0.5 font-mono text-xs text-zinc-100"
                        aria-label="Телефон"
                      />
                    ) : (
                      <span className="mt-0.5 block font-mono text-zinc-400">
                        {r.phone ?? "—"}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <ToggleSwitch
                      checked={r.is_active}
                      onCheckedChange={(v) => void updateStaffActive(r, v)}
                      aria-label={`${r.name}: активен в CRM`}
                    />
                    <span className="text-zinc-500">
                      {r.is_active ? "активен" : "выключен"}
                    </span>
                  </div>

                  <div className="ml-auto flex items-center gap-3 text-xs">
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          className="text-sky-400 underline"
                          onClick={() => void saveEdit()}
                        >
                          {t("common.save")}
                        </button>
                        <button
                          type="button"
                          className="text-zinc-500 underline"
                          onClick={() => setEditingId(null)}
                        >
                          {t("common.cancel")}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="text-sky-400 underline"
                          onClick={() => startEdit(r)}
                        >
                          {t("adminStaff.edit")}
                        </button>
                        <button
                          type="button"
                          className="text-red-400 underline disabled:cursor-not-allowed disabled:opacity-40"
                          onClick={() => void remove(r)}
                          disabled={isOwner}
                          title={isOwner ? "Owner удалять нельзя" : undefined}
                        >
                          delete
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-3 border-t border-amber-900/20 pt-2 text-[10px] leading-snug text-zinc-500">
          Администраторы всегда скрыты на публичном сайте и в онлайн-записи. Этот блок — техперсонал,
          обслуживающий CRM и сайт салона. Чтобы добавить нового админа, используйте форму выше и
          выберите роль «Админ» — сотрудник появится именно здесь.
        </p>
      </section>
    </div>
  );
}

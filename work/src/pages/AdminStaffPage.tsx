import { FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";

/** Row shape for Supabase `public.staff`. */
export type StaffRow = {
  id: number;
  phone: string | null;
  name: string;
  role: string;
  is_active: boolean;
  created_at?: string;
};

type UiRole = "admin" | "manager" | "staff";

function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function AdminStaffPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UiRole>("staff");

  const load = useCallback(async () => {
    setErr(null);
    const { data, error } = await supabase
      .from("staff")
      .select("*")
      .order("created_at", { ascending: false });
    console.log("STAFF LIST:", data);
    if (error) {
      setErr(error.message);
      setLoading(false);
      return;
    }
    setRows((data ?? []) as StaffRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const cleanPhone = digitsOnly(phone);
    const n = name.trim();
    if (!cleanPhone || !n) {
      setErr("Phone and name are required.");
      return;
    }
    const { error } = await supabase.from("staff").insert({
      phone: cleanPhone,
      name: n,
      role,
      is_active: true,
    });
    if (error) {
      setErr(error.message);
      return;
    }
    setPhone("");
    setName("");
    setRole("staff");
    void load();
  }

  async function toggleActive(row: StaffRow) {
    setErr(null);
    const { error } = await supabase.from("staff").update({ is_active: !row.is_active }).eq("id", row.id);
    if (error) {
      setErr(error.message);
      return;
    }
    void load();
  }

  async function remove(row: StaffRow) {
    setErr(null);
    if (!window.confirm(`Delete ${row.name} permanently?`)) return;
    const { error } = await supabase.from("staff").delete().eq("id", row.id);
    if (error) {
      setErr(error.message);
      return;
    }
    void load();
  }

  if (loading) return <p className="text-zinc-500">Loading…</p>;

  return (
    <div className="max-w-4xl space-y-6 text-zinc-200">
      <header>
        <h1 className="text-xl font-semibold text-white">Admin · Staff</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Manage people in the <code className="text-zinc-400">staff</code> table.
        </p>
      </header>

      {err && <p className="rounded border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">{err}</p>}

      <form onSubmit={onAdd} className="flex flex-wrap items-end gap-3 border border-zinc-800 bg-zinc-950 p-4">
        <div>
          <label className="block text-xs text-zinc-500">Phone (digits)</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1 rounded border border-zinc-700 bg-black px-2 py-1 text-sm"
            placeholder="37255686845"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 rounded border border-zinc-700 bg-black px-2 py-1 text-sm"
            placeholder="Full name"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as UiRole)}
            className="mt-1 rounded border border-zinc-700 bg-black px-2 py-1 text-sm"
          >
            <option value="admin">{t("role.admin")}</option>
            <option value="manager">{t("role.manager")}</option>
            <option value="staff">{t("role.staff")}</option>
          </select>
        </div>
        <button type="submit" className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500">
          Add
        </button>
      </form>

      <div className="overflow-x-auto border border-zinc-800">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              <th className="border-b border-zinc-800 px-3 py-2">phone</th>
              <th className="border-b border-zinc-800 px-3 py-2">name</th>
              <th className="border-b border-zinc-800 px-3 py-2">role</th>
              <th className="border-b border-zinc-800 px-3 py-2">is_active</th>
              <th className="border-b border-zinc-800 px-3 py-2">actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-zinc-800/80">
                <td className="px-3 py-2 font-mono text-zinc-300">{r.phone ?? "—"}</td>
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2">{r.role ?? "—"}</td>
                <td className="px-3 py-2">{r.is_active ? "true" : "false"}</td>
                <td className="space-x-2 px-3 py-2">
                  <button
                    type="button"
                    className="text-sky-400 underline"
                    onClick={() => void toggleActive(r)}
                  >
                    {r.is_active ? "deactivate" : "activate"}
                  </button>
                  <button type="button" className="text-red-400 underline" onClick={() => void remove(r)}>
                    delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { SiteBlockRow, SiteBlockType, SitePageRow } from "../types/database";

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .replace(/-+/g, "-");
}

function defaultContent(type: SiteBlockType): Record<string, unknown> {
  if (type === "button") {
    return { label: "Услуги", action: "scroll", target: "services" };
  }
  if (type === "text") {
    return { text: "Добро пожаловать" };
  }
  return { title: "Section", text: "" };
}

export function SiteBuilderPage() {
  const [pages, setPages] = useState<SitePageRow[]>([]);
  const [blocks, setBlocks] = useState<SiteBlockRow[]>([]);
  const [pageId, setPageId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [newPageName, setNewPageName] = useState("");
  const [newPageSlug, setNewPageSlug] = useState("");
  const [newBlockType, setNewBlockType] = useState<SiteBlockType>("text");

  const loadPages = useCallback(async () => {
    const { data, error } = await supabase.from("site_pages").select("*").order("created_at", { ascending: true });
    if (error) {
      setErr(error.message);
      return;
    }
    const rows = (data ?? []) as SitePageRow[];
    setPages(rows);
    setPageId((cur) => (cur && rows.some((p) => p.id === cur) ? cur : rows[0]?.id ?? ""));
  }, []);

  const loadBlocks = useCallback(async (pid: string) => {
    if (!pid) {
      setBlocks([]);
      return;
    }
    const { data, error } = await supabase
      .from("site_blocks")
      .select("*")
      .eq("page_id", pid)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) {
      setErr(error.message);
      return;
    }
    setBlocks((data ?? []) as SiteBlockRow[]);
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await loadPages();
      setLoading(false);
    })();
  }, [loadPages]);

  useEffect(() => {
    void loadBlocks(pageId);
  }, [pageId, loadBlocks]);

  const currentPage = useMemo(() => pages.find((p) => p.id === pageId) ?? null, [pages, pageId]);

  async function createPage(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const name = newPageName.trim();
    const slug = slugify(newPageSlug.trim() || name);
    if (!name || !slug) return;
    const { error } = await supabase.from("site_pages").insert({ name, slug });
    if (error) {
      setErr(error.message);
      return;
    }
    setNewPageName("");
    setNewPageSlug("");
    await loadPages();
  }

  async function addBlock() {
    if (!pageId) return;
    setErr(null);
    const nextPos = blocks.length ? Math.max(...blocks.map((b) => b.position)) + 1 : 0;
    const { error } = await supabase.from("site_blocks").insert({
      page_id: pageId,
      type: newBlockType,
      content: defaultContent(newBlockType),
      position: nextPos,
    });
    if (error) {
      setErr(error.message);
      return;
    }
    await loadBlocks(pageId);
  }

  async function saveBlock(id: string, patch: Partial<SiteBlockRow>) {
    setErr(null);
    const { error } = await supabase.from("site_blocks").update(patch).eq("id", id);
    if (error) {
      setErr(error.message);
      return;
    }
    await loadBlocks(pageId);
  }

  async function removeBlock(id: string) {
    setErr(null);
    const { error } = await supabase.from("site_blocks").delete().eq("id", id);
    if (error) {
      setErr(error.message);
      return;
    }
    await loadBlocks(pageId);
  }

  async function moveBlock(id: string, dir: -1 | 1) {
    const idx = blocks.findIndex((b) => b.id === id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= blocks.length) return;
    const a = blocks[idx];
    const b = blocks[j];
    const { error } = await supabase
      .from("site_blocks")
      .upsert([
        { id: a.id, position: b.position },
        { id: b.id, position: a.position },
      ])
      .select("id");
    if (error) {
      setErr(error.message);
      return;
    }
    await loadBlocks(pageId);
  }

  if (loading) return <p className="text-zinc-500">Loading…</p>;

  return (
    <div className="max-w-5xl space-y-6 text-zinc-200">
      <header>
        <h1 className="text-xl font-semibold text-white">Site Builder (MVP)</h1>
        <p className="mt-1 text-sm text-zinc-500">Create pages and blocks for public site rendering.</p>
      </header>

      {err && <p className="rounded border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">{err}</p>}

      <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
        <h2 className="text-sm font-semibold text-zinc-300">Pages</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <select
            value={pageId}
            onChange={(e) => setPageId(e.target.value)}
            className="rounded border border-zinc-700 bg-black px-2 py-1 text-sm"
          >
            <option value="">Select page</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.slug})
              </option>
            ))}
          </select>
        </div>
        <form onSubmit={createPage} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-zinc-400">
            Name
            <input
              value={newPageName}
              onChange={(e) => setNewPageName(e.target.value)}
              className="mt-1 block rounded border border-zinc-700 bg-black px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-zinc-400">
            Slug
            <input
              value={newPageSlug}
              onChange={(e) => setNewPageSlug(e.target.value)}
              className="mt-1 block rounded border border-zinc-700 bg-black px-2 py-1 text-sm"
              placeholder="home"
            />
          </label>
          <button type="submit" className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500">
            Create page
          </button>
        </form>
      </section>

      {currentPage && (
        <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-zinc-400">
              Blocks for <span className="text-zinc-200">{currentPage.slug}</span>
            </p>
            <select
              value={newBlockType}
              onChange={(e) => setNewBlockType(e.target.value as SiteBlockType)}
              className="rounded border border-zinc-700 bg-black px-2 py-1 text-sm"
            >
              <option value="text">text</option>
              <option value="button">button</option>
              <option value="section">section</option>
            </select>
            <button type="button" onClick={() => void addBlock()} className="rounded bg-sky-600 px-3 py-1 text-sm text-white">
              Add block
            </button>
          </div>

          <ul className="space-y-3">
            {blocks.map((b, i) => {
              const content = (b.content ?? {}) as Record<string, unknown>;
              return (
                <li key={b.id} className="rounded border border-zinc-800 bg-black/40 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span>{b.type}</span>
                    <span>pos: {b.position}</span>
                    <button type="button" onClick={() => void moveBlock(b.id, -1)} disabled={i === 0} className="underline disabled:opacity-40">
                      up
                    </button>
                    <button
                      type="button"
                      onClick={() => void moveBlock(b.id, 1)}
                      disabled={i === blocks.length - 1}
                      className="underline disabled:opacity-40"
                    >
                      down
                    </button>
                    <button type="button" onClick={() => void removeBlock(b.id)} className="text-red-400 underline">
                      delete
                    </button>
                  </div>

                  {b.type === "text" && (
                    <input
                      defaultValue={String(content.text ?? "")}
                      onBlur={(e) => void saveBlock(b.id, { content: { ...content, text: e.target.value } })}
                      className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                    />
                  )}

                  {b.type === "button" && (
                    <div className="grid gap-2 sm:grid-cols-3">
                      <input
                        defaultValue={String(content.label ?? "")}
                        onBlur={(e) => void saveBlock(b.id, { content: { ...content, label: e.target.value } })}
                        placeholder="label"
                        className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                      />
                      <input
                        defaultValue={String(content.action ?? "scroll")}
                        onBlur={(e) => void saveBlock(b.id, { content: { ...content, action: e.target.value } })}
                        placeholder="action"
                        className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                      />
                      <input
                        defaultValue={String(content.target ?? "services")}
                        onBlur={(e) => void saveBlock(b.id, { content: { ...content, target: e.target.value } })}
                        placeholder="target"
                        className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                      />
                    </div>
                  )}

                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-zinc-500">Edit JSON</summary>
                    <textarea
                      defaultValue={JSON.stringify(content, null, 2)}
                      onBlur={(e) => {
                        try {
                          const parsed = JSON.parse(e.target.value) as Record<string, unknown>;
                          void saveBlock(b.id, { content: parsed });
                        } catch {
                          setErr("Invalid JSON content");
                        }
                      }}
                      className="mt-2 h-32 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-xs"
                    />
                  </details>
                </li>
              );
            })}
            {blocks.length === 0 && <li className="text-sm text-zinc-500">No blocks yet.</li>}
          </ul>
        </section>
      )}
    </div>
  );
}


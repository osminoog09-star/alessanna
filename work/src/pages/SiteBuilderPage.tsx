import { FormEvent, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
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
  if (type === "image") {
    return { src: "", alt: "", width: "100%" };
  }
  if (type === "spacer") {
    return { height: 32 };
  }
  return { title: "Section", text: "Описание" };
}

function defaultBlockStyles(type: SiteBlockType): Record<string, unknown> {
  if (type === "text") return { fontSize: 18, fontWeight: 400, color: "#e4e4e7", align: "left", padding: 0 };
  if (type === "button") return { align: "left", padding: 0 };
  if (type === "section") return { background: "#0a0a0a", padding: 16, borderRadius: 12 };
  if (type === "image") return { align: "left", padding: 0, borderRadius: 10 };
  return { height: 32 };
}

function defaultPageStyles(): Record<string, unknown> {
  return {
    headingFont: "Playfair Display",
    bodyFont: "Inter",
    maxWidth: 960,
  };
}

function toNum(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function PreviewBlock({ b, pageStyles }: { b: SiteBlockRow; pageStyles: Record<string, unknown> }) {
  const content = (b.content ?? {}) as Record<string, unknown>;
  const styles = (b.styles ?? {}) as Record<string, unknown>;
  const bodyFont = String(pageStyles.bodyFont ?? "Inter");
  const headingFont = String(pageStyles.headingFont ?? "Playfair Display");
  const commonStyle: CSSProperties = {
    padding: toNum(styles.padding, 0),
    textAlign: String(styles.align ?? "left") as CSSProperties["textAlign"],
    color: String(styles.color ?? "#e4e4e7"),
  };

  if (b.type === "text") {
    return (
      <p
        style={{
          ...commonStyle,
          fontFamily: bodyFont,
          fontSize: toNum(styles.fontSize, 18),
          fontWeight: toNum(styles.fontWeight, 400),
          margin: 0,
        }}
      >
        {String(content.text ?? "")}
      </p>
    );
  }

  if (b.type === "button") {
    return (
      <div style={commonStyle}>
        <button type="button" className="rounded border border-zinc-600 px-3 py-1.5 text-sm">
          {String(content.label ?? "Button")}
        </button>
      </div>
    );
  }

  if (b.type === "image") {
    const src = String(content.src ?? "").trim();
    const alt = String(content.alt ?? "");
    if (!src) return <div className="rounded border border-dashed border-zinc-700 p-3 text-xs text-zinc-500">Image URL is empty</div>;
    return (
      <div style={commonStyle}>
        <img
          src={src}
          alt={alt}
          style={{
            width: String(content.width ?? "100%"),
            borderRadius: toNum(styles.borderRadius, 10),
            maxWidth: "100%",
          }}
        />
      </div>
    );
  }

  if (b.type === "spacer") {
    return <div style={{ height: toNum(content.height, 32) }} />;
  }

  return (
    <div
      style={{
        background: String(styles.background ?? "#0a0a0a"),
        borderRadius: toNum(styles.borderRadius, 12),
        padding: toNum(styles.padding, 16),
      }}
      className="border border-zinc-800"
    >
      <h3 style={{ fontFamily: headingFont, marginTop: 0 }}>{String(content.title ?? "")}</h3>
      <p style={{ fontFamily: bodyFont, marginBottom: 0 }}>{String(content.text ?? "")}</p>
    </div>
  );
}

export function SiteBuilderPage() {
  const [pages, setPages] = useState<SitePageRow[]>([]);
  const [blocks, setBlocks] = useState<SiteBlockRow[]>([]);
  const [pageId, setPageId] = useState<string>("");
  const [selectedBlockId, setSelectedBlockId] = useState<string>("");
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [newPageName, setNewPageName] = useState("");
  const [newPageSlug, setNewPageSlug] = useState("");
  const [newBlockType, setNewBlockType] = useState<SiteBlockType>("text");

  const loadPages = useCallback(async () => {
    const { data, error } = await supabase
      .from("site_pages")
      .select("*")
      .in("status", ["draft", "published"])
      .order("created_at", { ascending: true });
    if (error) {
      setErr(error.message);
      return;
    }
    const raw = (data ?? []) as SitePageRow[];
    const bySlug = new Map<string, SitePageRow>();
    for (const row of raw) {
      const cur = bySlug.get(row.slug);
      if (!cur) {
        bySlug.set(row.slug, row);
        continue;
      }
      const rowDraft = row.status === "draft";
      const curDraft = cur.status === "draft";
      if (rowDraft && !curDraft) bySlug.set(row.slug, row);
    }
    const rows = Array.from(bySlug.values()).sort((a, b) => a.slug.localeCompare(b.slug));
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

  const selectedBlock = useMemo(
    () => blocks.find((b) => b.id === selectedBlockId) ?? blocks[0] ?? null,
    [blocks, selectedBlockId]
  );

  const pageStyles = (currentPage?.styles ?? defaultPageStyles()) as Record<string, unknown>;

  async function createPage(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const name = newPageName.trim();
    const slug = slugify(newPageSlug.trim() || name);
    if (!name || !slug) return;
    const { error } = await supabase.from("site_pages").insert({
      name,
      slug,
      status: "draft",
      styles: defaultPageStyles(),
    });
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
      styles: defaultBlockStyles(newBlockType),
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
    const { error } = await supabase
      .from("site_blocks")
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
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

  async function savePageStyles(nextStyles: Record<string, unknown>) {
    if (!currentPage) return;
    setErr(null);
    const { error } = await supabase
      .from("site_pages")
      .update({
        styles: nextStyles,
        updated_at: new Date().toISOString(),
      })
      .eq("id", currentPage.id);
    if (error) {
      setErr(error.message);
      return;
    }
    await loadPages();
  }

  async function publishPage() {
    if (!currentPage) return;
    setErr(null);
    const { data: existingPublished } = await supabase
      .from("site_pages")
      .select("id")
      .eq("slug", currentPage.slug)
      .eq("status", "published")
      .maybeSingle();

    let publishedId = existingPublished?.id as string | undefined;
    const pagePayload = {
      name: currentPage.name,
      slug: currentPage.slug,
      status: "published",
      styles: currentPage.styles ?? defaultPageStyles(),
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (!publishedId) {
      const { data: inserted, error: insertErr } = await supabase.from("site_pages").insert(pagePayload).select("id").single();
      if (insertErr) {
        setErr(insertErr.message);
        return;
      }
      publishedId = inserted.id;
    } else {
      const { error: updateErr } = await supabase.from("site_pages").update(pagePayload).eq("id", publishedId);
      if (updateErr) {
        setErr(updateErr.message);
        return;
      }
      const { error: delErr } = await supabase.from("site_blocks").delete().eq("page_id", publishedId);
      if (delErr) {
        setErr(delErr.message);
        return;
      }
    }

    const inserts = blocks.map((b) => ({
      page_id: publishedId,
      type: b.type,
      content: b.content,
      styles: b.styles ?? {},
      position: b.position,
    }));
    if (inserts.length) {
      const { error: blocksErr } = await supabase.from("site_blocks").insert(inserts);
      if (blocksErr) {
        setErr(blocksErr.message);
        return;
      }
    }
    setErr(null);
  }

  if (loading) return <p className="text-zinc-500">Loading…</p>;

  return (
    <div className="max-w-7xl space-y-6 text-zinc-200">
      <header>
        <h1 className="text-xl font-semibold text-white">Site Builder</h1>
        <p className="mt-1 text-sm text-zinc-500">Draft editor with preview + publish to main site.</p>
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
        <section className="grid gap-4 xl:grid-cols-[320px,1fr,340px]">
          <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-zinc-400">
                Draft: <span className="text-zinc-200">{currentPage.slug}</span>
              </p>
              <button type="button" onClick={() => void publishPage()} className="rounded bg-emerald-600 px-2 py-1 text-xs text-white">
                Publish
              </button>
            </div>

            <div className="rounded border border-zinc-800 bg-black/40 p-2">
              <p className="mb-2 text-xs text-zinc-500">Page fonts</p>
              <label className="mb-2 block text-xs text-zinc-400">
                Heading font
                <select
                  value={String(pageStyles.headingFont ?? "Playfair Display")}
                  onChange={(e) => void savePageStyles({ ...pageStyles, headingFont: e.target.value })}
                  className="mt-1 w-full rounded border border-zinc-700 bg-black px-2 py-1 text-xs"
                >
                  <option>Playfair Display</option>
                  <option>Cormorant Garamond</option>
                  <option>Inter</option>
                </select>
              </label>
              <label className="block text-xs text-zinc-400">
                Body font
                <select
                  value={String(pageStyles.bodyFont ?? "Inter")}
                  onChange={(e) => void savePageStyles({ ...pageStyles, bodyFont: e.target.value })}
                  className="mt-1 w-full rounded border border-zinc-700 bg-black px-2 py-1 text-xs"
                >
                  <option>Inter</option>
                  <option>Playfair Display</option>
                  <option>Cormorant Garamond</option>
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={newBlockType}
                onChange={(e) => setNewBlockType(e.target.value as SiteBlockType)}
                className="rounded border border-zinc-700 bg-black px-2 py-1 text-sm"
              >
                <option value="text">text</option>
                <option value="button">button</option>
                <option value="section">section</option>
                <option value="image">image</option>
                <option value="spacer">spacer</option>
              </select>
              <button type="button" onClick={() => void addBlock()} className="rounded bg-sky-600 px-3 py-1 text-sm text-white">
                Add block
              </button>
            </div>

            <ul className="space-y-2">
              {blocks.map((b, i) => (
                <li key={b.id} className={`rounded border p-2 ${selectedBlock?.id === b.id ? "border-sky-500" : "border-zinc-800"}`}>
                  <button type="button" className="w-full text-left text-xs text-zinc-300" onClick={() => setSelectedBlockId(b.id)}>
                    {i + 1}. {b.type}
                  </button>
                  <div className="mt-1 flex gap-2 text-xs">
                    <button type="button" onClick={() => void moveBlock(b.id, -1)} disabled={i === 0} className="underline disabled:opacity-40">
                      up
                    </button>
                    <button type="button" onClick={() => void moveBlock(b.id, 1)} disabled={i === blocks.length - 1} className="underline disabled:opacity-40">
                      down
                    </button>
                    <button type="button" onClick={() => void removeBlock(b.id)} className="text-red-400 underline">
                      delete
                    </button>
                  </div>
                </li>
              ))}
              {blocks.length === 0 && <li className="text-sm text-zinc-500">No blocks yet.</li>}
            </ul>
          </div>

          <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-200">Preview</h3>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setViewport("desktop")}
                  className={`rounded px-2 py-1 ${viewport === "desktop" ? "bg-sky-600 text-white" : "bg-zinc-800 text-zinc-300"}`}
                >
                  desktop
                </button>
                <button
                  type="button"
                  onClick={() => setViewport("mobile")}
                  className={`rounded px-2 py-1 ${viewport === "mobile" ? "bg-sky-600 text-white" : "bg-zinc-800 text-zinc-300"}`}
                >
                  mobile
                </button>
              </div>
            </div>
            <div
              className="mx-auto rounded border border-zinc-800 bg-black p-4"
              style={{ width: viewport === "mobile" ? 390 : "100%", maxWidth: Number(pageStyles.maxWidth ?? 960) }}
            >
              <div className="space-y-4">
                {blocks.map((b) => (
                  <PreviewBlock key={b.id} b={b} pageStyles={pageStyles} />
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
            <h3 className="text-sm font-semibold text-zinc-200">Inspector</h3>
            {!selectedBlock && <p className="text-sm text-zinc-500">Select block</p>}
            {selectedBlock && (
              <>
                <p className="text-xs text-zinc-500">Type: {selectedBlock.type}</p>
                <details open>
                  <summary className="cursor-pointer text-xs text-zinc-400">Content</summary>
                  <textarea
                    value={JSON.stringify(selectedBlock.content ?? {}, null, 2)}
                    onChange={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value) as Record<string, unknown>;
                        void saveBlock(selectedBlock.id, { content: parsed });
                      } catch {
                        // ignore partial JSON while typing
                      }
                    }}
                    className="mt-2 h-40 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-xs"
                  />
                </details>
                <details open>
                  <summary className="cursor-pointer text-xs text-zinc-400">Styles</summary>
                  <textarea
                    value={JSON.stringify(selectedBlock.styles ?? {}, null, 2)}
                    onChange={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value) as Record<string, unknown>;
                        void saveBlock(selectedBlock.id, { styles: parsed });
                      } catch {
                        // ignore partial JSON while typing
                      }
                    }}
                    className="mt-2 h-40 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-xs"
                  />
                </details>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}


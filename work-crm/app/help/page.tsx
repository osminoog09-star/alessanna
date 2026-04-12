"use client";

import { useEffect, useState } from "react";
import { CrmShell } from "@/components/CrmShell";
import { RequireAuth } from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";

type FaqItem = { title: string; body: string };

export default function HelpPage() {
  const [items, setItems] = useState<FaqItem[]>([]);

  useEffect(() => {
    void (async () => {
      const r = await apiFetch("/api/crm/faq");
      if (!r.ok) return;
      const j = (await r.json()) as { items?: FaqItem[] };
      setItems(j.items || []);
    })();
  }, []);

  return (
    <RequireAuth>
      <CrmShell title="Help">
        <div className="faq">
          {items.map((item, i) => (
            <details key={i}>
              <summary>{item.title}</summary>
              <p className="muted">{item.body}</p>
            </details>
          ))}
        </div>
      </CrmShell>
    </RequireAuth>
  );
}

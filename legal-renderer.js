/* ============================================================================
 *  legal-renderer.js
 *  ----------------------------------------------------------------------------
 *  Тянет активную версию документа из БД (RPC public.legal_get_active) и
 *  рендерит её как мини-Markdown в #legal-article.
 *
 *  ПОЧЕМУ свой парсер.
 *  Тексты политик короткие, конструкций мало (h1/h2, **bold**, *italic*,
 *  ссылки [], списки `* `). Ставить marked.js или markdown-it ради этого —
 *  лишний бандл и transitive deps. Свой парсер ~80 строк, escape XSS
 *  делаем сами через textContent в нужных местах.
 *
 *  Ничего из переданного content_md не вставляется как html без обработки.
 *  Каждый узел собирается через document.createElement / textContent —
 *  поэтому если завтра в legal_documents кто-то напишет `<script>` — это
 *  отрисуется как литералы, а не выполнится.
 *
 *  ЯЗЫК.
 *  Берём из <html lang>, нормализуем в 'ru' / 'et'. Если в БД нет нужного
 *  языка — fallback на 'ru'.
 * ============================================================================
 */
(function () {
  "use strict";

  function getLang() {
    var html = document.documentElement.getAttribute("lang") || "ru";
    return html.toLowerCase().indexOf("et") === 0 ? "et" : "ru";
  }

  function endpoint() {
    var cfg = window.SUPABASE_CONFIG || {};
    var url = String(cfg.url || "").replace(/\/+$/, "");
    var key = String(cfg.anonKey || "");
    if (!url || !key) return null;
    return { url: url + "/rest/v1/rpc/", key: key };
  }

  function rpc(name, payload) {
    var ep = endpoint();
    if (!ep) return Promise.reject(new Error("supabase-not-configured"));
    return fetch(ep.url + name, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "apikey": ep.key,
        "authorization": "Bearer " + ep.key,
      },
      body: JSON.stringify(payload || {}),
    }).then(function (r) {
      if (!r.ok) throw new Error("rpc-" + r.status);
      return r.json();
    });
  }

  /* ---------- mini-markdown ---------- */

  /**
   * Превращает строку в массив text-нодов и <a>-нодов.
   * Поддерживает [text](href), **bold** и *italic*.
   * Ничего не доверяет: href должен начинаться с '/' или 'http(s)://' или 'mailto:'.
   */
  function parseInline(line, container) {
    var rest = line;
    var safeHref = /^(\/[^\s)]*|https?:\/\/[^\s)]+|mailto:[^\s)]+|#[^\s)]*)$/;
    while (rest.length) {
      var linkM = /\[([^\]]+)\]\(([^)]+)\)/.exec(rest);
      var boldM = /\*\*([^*]+)\*\*/.exec(rest);
      var italicM = /(^|[^*])\*([^*]+)\*(?!\*)/.exec(rest);

      var first = null;
      if (linkM) first = { kind: "link", m: linkM, idx: linkM.index };
      if (boldM && (first === null || boldM.index < first.idx)) first = { kind: "bold", m: boldM, idx: boldM.index };
      if (italicM && (first === null || (italicM.index + italicM[1].length) < first.idx)) {
        first = { kind: "italic", m: italicM, idx: italicM.index + italicM[1].length };
      }

      if (!first) {
        container.appendChild(document.createTextNode(rest));
        return;
      }
      if (first.idx > 0) {
        container.appendChild(document.createTextNode(rest.slice(0, first.idx)));
      }
      if (first.kind === "link") {
        var a = document.createElement("a");
        var href = first.m[2];
        a.textContent = first.m[1];
        a.setAttribute("href", safeHref.test(href) ? href : "#");
        container.appendChild(a);
        rest = rest.slice(first.idx + first.m[0].length);
      } else if (first.kind === "bold") {
        var s = document.createElement("strong");
        s.textContent = first.m[1];
        container.appendChild(s);
        rest = rest.slice(first.idx + first.m[0].length);
      } else if (first.kind === "italic") {
        var em = document.createElement("em");
        em.textContent = first.m[2];
        container.appendChild(em);
        rest = rest.slice(first.idx + first.m[0].length);
      }
    }
  }

  function renderMarkdown(md, target) {
    target.innerHTML = "";
    var lines = String(md || "").split(/\r?\n/);
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (/^#\s+/.test(line)) {
        var h1 = document.createElement("h1");
        parseInline(line.replace(/^#\s+/, ""), h1);
        target.appendChild(h1);
        i++;
        continue;
      }
      if (/^##\s+/.test(line)) {
        var h2 = document.createElement("h2");
        parseInline(line.replace(/^##\s+/, ""), h2);
        target.appendChild(h2);
        i++;
        continue;
      }
      if (/^###\s+/.test(line)) {
        var h3 = document.createElement("h3");
        parseInline(line.replace(/^###\s+/, ""), h3);
        target.appendChild(h3);
        i++;
        continue;
      }
      if (/^\*\s+/.test(line)) {
        var ul = document.createElement("ul");
        while (i < lines.length && /^\*\s+/.test(lines[i])) {
          var li = document.createElement("li");
          parseInline(lines[i].replace(/^\*\s+/, ""), li);
          ul.appendChild(li);
          i++;
        }
        target.appendChild(ul);
        continue;
      }
      if (line.trim() === "") {
        i++;
        continue;
      }
      var p = document.createElement("p");
      parseInline(line, p);
      target.appendChild(p);
      i++;
    }
  }

  function init() {
    var article = document.getElementById("legal-article");
    var meta = document.getElementById("legal-meta");
    if (!article) return;
    var kind = article.getAttribute("data-kind") || "privacy";
    var lang = (article.getAttribute("data-lang") || getLang()).toLowerCase();

    rpc("legal_get_active", { p_kind: kind, p_lang: lang })
      .then(function (doc) {
        if (!doc) {
          /* fallback на ru, если нужного языка нет */
          if (lang !== "ru") {
            return rpc("legal_get_active", { p_kind: kind, p_lang: "ru" });
          }
          return null;
        }
        return doc;
      })
      .then(function (doc) {
        if (!doc) {
          article.innerHTML = "";
          var err = document.createElement("p");
          err.className = "legal-error";
          err.textContent = "Документ временно недоступен. Свяжитесь с нами: alessanna.ilusalong@gmail.com";
          article.appendChild(err);
          return;
        }
        renderMarkdown(doc.body_md, article);
        if (meta) {
          var ver = doc.version ? "Версия " + doc.version : "";
          var pub = doc.published_at
            ? " · опубликовано " + new Date(doc.published_at).toLocaleDateString()
            : "";
          meta.textContent = ver + pub;
        }
        document.title = (doc.title || "Документ") + " | AlesSanna Ilusalong";
      })
      .catch(function (e) {
        article.innerHTML = "";
        var err = document.createElement("p");
        err.className = "legal-error";
        err.textContent = "Не удалось загрузить документ: " + (e && e.message ? e.message : "ошибка сети");
        article.appendChild(err);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/**
 * Public landing: loads /locales/{lang}.json (same keys as CRM) and applies [data-i18n] strings.
 * Lang is taken from the first URL segment when it is ru | et | fi | en (see server /{lang} routes).
 */
(function () {
  "use strict";

  function byPath(obj, path) {
    return path.split(".").reduce(function (acc, key) {
      return acc && acc[key] !== undefined && acc[key] !== null ? acc[key] : null;
    }, obj);
  }

  function langFromPath() {
    var seg = (location.pathname.split("/").filter(Boolean)[0] || "").toLowerCase();
    if (["ru", "et", "fi", "en"].indexOf(seg) >= 0) return seg;
    return null;
  }

  function applyBundle(bundle) {
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (!key) return;
      var v = byPath(bundle, key);
      if (typeof v !== "string") return;
      if (el.hasAttribute("data-i18n-html")) el.innerHTML = v;
      else el.textContent = v;
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-placeholder");
      if (!key || !("placeholder" in el)) return;
      var v = byPath(bundle, key);
      if (typeof v === "string") el.setAttribute("placeholder", v);
    });
    document.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
      var spec = el.getAttribute("data-i18n-attr");
      if (!spec || spec.indexOf(":") < 0) return;
      var c = spec.indexOf(":");
      var attr = spec.slice(0, c);
      var key = spec.slice(c + 1);
      var v = byPath(bundle, key);
      if (typeof v === "string") el.setAttribute(attr, v);
    });
  }

  function load() {
    var lang = langFromPath();
    if (!lang) return;
    var base = "";
    fetch(base + "/locales/" + lang + ".json")
      .then(function (r) {
        if (!r.ok) throw new Error("locales");
        return r.json();
      })
      .then(function (bundle) {
        applyBundle(bundle);
        window.ALESSANNA_PUBLIC_LOCALE = lang;
        window.ALESSANNA_PUBLIC_I18N = bundle;
      })
      .catch(function () {});
  }

  window.ALESSANNA_APPLY_PUBLIC_I18N = applyBundle;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();

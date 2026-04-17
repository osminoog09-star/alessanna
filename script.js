/**
 * ============================================================================
 * AlesSanna Ilusalong — логика страницы (index.html + ru.html)
 * ============================================================================
 * Весь код обёрнут в IIFE (function () { ... })(); чтобы не засорять глобальную область.
 *
 * Что делает этот файл (порядок выполнения сверху вниз):
 *   1) Год в #year — текущий год автоматически.
 *   2) Прокрутка: шапка #header получает .is-scrolled; панель .mobile-book-bar — .is-visible
 *      и ссылка внутри становится доступной с клавиатуры (tabIndex 0 / -1).
 *   3) Бургер: .nav-toggle переключает .nav.is-open и body.nav-open (блокировка скролла).
 *   4) Вкладки услуг: .tab-btn с aria-controls показывает соответствующий .tab-panel (hidden).
 *   5) .reveal: IntersectionObserver добавляет .is-visible при появлении в зоне видимости
 *      (у .hero-inner.hero-animate каскад только у дочерних блоков — см. styles.css).
 *   5b) Прайс #teenused: клик по строке добавляет/убирает услугу в [data-selected-services-list],
 *      синхронизирует select[name=service] и скрытое services_detail; #meistrid — мастера,
 *      которые закрывают все выбранные категории (пересечение по направлениям).
 *   6) Бронирование: если на странице есть все нужные элементы — календарь, форма, обработчики.
 *
 * Как отключить календарь: удалите секцию #broneeri или уберите data-calendar-grid — скрипт
 * тихо пропустит блок (условие if внизу файла).
 * ============================================================================
 */
(function () {
  "use strict";

  /* --- Общие элементы шапки, футера, мобильной полосы (могут отсутствовать — тогда null) --- */
  var header = document.getElementById("header");
  var nav = document.querySelector(".nav");
  var navToggle = document.querySelector(".nav-toggle");
  var navBackdrop = document.getElementById("nav-backdrop");
  var yearEl = document.getElementById("year");
  var mobileBar = document.querySelector(".mobile-book-bar");
  var mobileBookLink = mobileBar ? mobileBar.querySelector("a") : null;
  var reduceMotionMq = window.matchMedia("(prefers-reduced-motion: reduce)");

  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  /** Отступ снизу для закреплённой корзины «Ваш выбор» + учёт моб. полосы «Запись» */
  function updateSelectionDockOffset() {
    if (!document.body.classList.contains("selection-dock-active")) {
      document.documentElement.style.removeProperty("--selection-dock-bottom");
      return;
    }
    var isMobile = window.matchMedia("(max-width: 900px)").matches;
    var barOn = mobileBar && mobileBar.classList.contains("is-visible");
    var bottom = isMobile && barOn ? "5.5rem" : isMobile ? "1rem" : "1.35rem";
    document.documentElement.style.setProperty("--selection-dock-bottom", bottom);
  }

  /** Прокрутка: подложка шапки + появление нижней кнопки «Запись» на телефоне */
  function onScroll() {
    var y = window.scrollY;
    if (header) {
      header.classList.toggle("is-scrolled", y > 40);
    }
    if (mobileBar) {
      var showBar = y > 320;
      mobileBar.classList.toggle("is-visible", showBar);
      if (mobileBookLink) {
        mobileBookLink.tabIndex = showBar ? 0 : -1;
      }
    }
    updateSelectionDockOffset();
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", function () {
    onScroll();
  });
  onScroll();

  /** Открытое меню: body.nav-open + подложка #nav-backdrop (см. styles.css) */
  function setNavOpen(open) {
    document.body.classList.toggle("nav-open", open);
    if (navBackdrop) {
      if (open) navBackdrop.removeAttribute("hidden");
      else navBackdrop.setAttribute("hidden", "");
    }
  }

  function closeNav() {
    if (!nav || !navToggle) return;
    nav.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
    setNavOpen(false);
  }

  if (navToggle && nav) {
    navToggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
      setNavOpen(open);
    });

    if (navBackdrop) {
      navBackdrop.addEventListener("click", closeNav);
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("is-open")) closeNav();
    });

    document.querySelectorAll(".nav-list a, .nav-drawer-cta, .header-actions .nav-cta").forEach(function (link) {
      link.addEventListener("click", function () {
        closeNav();
      });
    });
  }

  /* Anchor links: land on section titles with a fixed-header offset. */
  function scrollToSectionTitle(sectionId, hash) {
    var kicker = document.querySelector("#" + sectionId + " .section-kicker");
    var title = document.querySelector("#" + sectionId + " .section-title");
    var target = kicker || title || document.getElementById(sectionId);
    if (!target) return false;
    var headerHeight = header ? header.getBoundingClientRect().height : 0;
    var offset = headerHeight + 40;
    var top = target.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, top), behavior: reduceMotionMq.matches ? "auto" : "smooth" });
    if (hash && window.history && window.history.pushState) {
      window.history.pushState(null, "", hash);
    }
    return true;
  }

  document.querySelectorAll(
    'a[href="#broneeri"], a[href="#teenused"], a[href="#meistrid"], a[href="#galerii"], a[href="#meist"], a[href="#kinkekaardid"], a[href="#tagasiside"], a[href="#kontakt"]'
  ).forEach(function (link) {
    link.addEventListener("click", function (e) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      var hash = link.getAttribute("href");
      var sectionId = hash ? hash.slice(1) : "";
      if (!sectionId) return;
      e.preventDefault();
      closeNav();
      scrollToSectionTitle(sectionId, hash);
    });
  });

  /* Tabs: delegation so Supabase-injected .tab-btn in #teenused work after load. */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("#teenused .tab-btn");
    if (!btn || e.button !== 0) return;
    var targetId = btn.getAttribute("aria-controls");
    if (!targetId) return;
    var teenused = document.getElementById("teenused");
    if (teenused) teenused.classList.remove("price-list-open");

    var mount = btn.closest("#teenused-supabase-mount");
    var scope = mount || teenused;
    if (!scope) return;
    scope.querySelectorAll(".tab-btn").forEach(function (b) {
      b.classList.remove("is-active");
      b.setAttribute("aria-selected", "false");
    });
    btn.classList.add("is-active");
    btn.setAttribute("aria-selected", "true");

    scope.querySelectorAll(".tab-panel").forEach(function (panel) {
      var show = panel.id === targetId;
      panel.hidden = !show;
      panel.classList.toggle("is-active", show);
    });
  });

  document.querySelectorAll("[data-price-list-toggle]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var teenused = document.getElementById("teenused");
      if (!teenused) return;
      teenused.classList.add("price-list-open");

      teenused.querySelectorAll(".tab-btn").forEach(function (tab) {
        tab.classList.remove("is-active");
        tab.setAttribute("aria-selected", "false");
      });

      teenused.querySelectorAll(".tab-panel").forEach(function (panel) {
        panel.hidden = false;
        panel.classList.add("is-active");
      });

      var firstPriceBlock = teenused.querySelector(".price-panel-title");
      if (firstPriceBlock) {
        requestAnimationFrame(function () {
          firstPriceBlock.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    });
  });

  document.querySelectorAll("[data-services-tabs-toggle]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var teenused = document.getElementById("teenused");
      if (!teenused) return;
      var firstTab = teenused.querySelector(".tab-btn");
      if (firstTab) firstTab.click();
    });
  });

  /* Появление секций при скролле; после показа элемент снимается с observe (экономия) */
  var revealEls = document.querySelectorAll(".reveal");
  if (revealEls.length && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    revealEls.forEach(function (el) {
      io.observe(el);
    });
  } else {
    revealEls.forEach(function (el) {
      el.classList.add("is-visible");
    });
  }

  /* Динамический прайс (site-services.mjs): элементы с .reveal не попадают в observer выше */
  window.addEventListener("teenused-supabase-ready", function () {
    var mount = document.getElementById("teenused-supabase-mount");
    if (!mount) return;
    mount.querySelectorAll(".reveal").forEach(function (el) {
      el.classList.add("is-visible");
    });
  });

  /* =============================================================================
   * Teenused + meistrid → nimekiri ja vorm (klõps praisil / nimel)
   * ============================================================================= */
  (function initServiceAndMasterPicks() {
    var teenused = document.getElementById("teenused");
    var summary = document.querySelector("[data-selection-summary]");
    var listEl = document.querySelector("[data-selected-services-list]");
    var emptyEl = document.querySelector("[data-selected-services-empty]");
    var masterDisplay = document.querySelector("[data-selected-master-display]");
    var detailField = document.querySelector("[data-field-services-detail]");
    var bookingForm = document.getElementById("booking-form");
    if (!teenused || !summary || !listEl || !emptyEl || !bookingForm) return;

    var serviceSelect = bookingForm.querySelector('select[name="service"]');
    if (!serviceSelect) return;

    var masterSelect = bookingForm.querySelector("[data-master-select]");
    var teamRoot = document.getElementById("meistrid");

    var selLang = (document.documentElement.getAttribute("lang") || "et").toLowerCase().slice(0, 2);
    var selRu = selLang === "ru";
    var selEn = selLang === "en";
    var selFi = selLang === "fi";
    var UI = {
      remove: selRu
        ? "Убрать из списка"
        : selEn
          ? "Remove from list"
          : selFi
            ? "Poista listasta"
            : "Eemalda nimekirjast",
      masterNone: "—",
    };

    var PANEL_TO_SERVICE = {
      "panel-cuts": "hair-cut",
      "panel-color": "hair-color",
      "panel-perm": "perm",
      "panel-styling": "styling",
      "panel-brows": "brows-lashes",
      "panel-manicure": "manicure",
      "panel-pedicure": "pedicure",
    };

    var MASTERS_PICK = [
      { id: "galina", name: "Galina" },
      { id: "irina", name: "Irina" },
      { id: "viktoria", name: "Viktoria" },
      { id: "anne", name: "Anne" },
      { id: "alesja", name: "Alesja" },
      { id: "aljona", name: "Aljona" },
    ];

    var ANY_MASTER_ID = "any";

    /** Meistrid teenusekategooriate järgi (sama loogika mis #meistrid plokis) */
    var CATEGORY_TO_MASTER_IDS = {
      "hair-cut": ["galina", "irina", "viktoria", "anne"],
      "hair-color": ["galina", "irina", "viktoria", "anne"],
      perm: ["galina", "irina", "viktoria", "anne"],
      styling: ["galina", "irina", "viktoria", "anne"],
      manicure: ["alesja", "aljona"],
      pedicure: ["alesja", "aljona"],
      "brows-lashes": ["aljona", "alesja"],
      lashes: ["alesja"],
    };

    function masterFilterForCategoryKey(catKey) {
      var fixed = String(catKey || "");
      if (Object.prototype.hasOwnProperty.call(CATEGORY_TO_MASTER_IDS, fixed)) return fixed;
      var namePart = fixed.indexOf("n:") === 0 ? fixed.slice(2).toLowerCase() : fixed.toLowerCase();
      if (namePart === "other" || namePart === "__none__") return "hair-cut";
      if (/pedik|педик|jalg/.test(namePart)) return "pedicure";
      if (/manik|маник|küün|kyun|nail|nogt|geel/.test(namePart)) return "manicure";
      if (/kulm|rips|brow|lash|ресниц|бров/.test(namePart)) return "brows-lashes";
      return "hair-cut";
    }

    function serviceCategoryFromPanel(panel) {
      if (!panel) return "";
      var d = panel.getAttribute("data-pick-category");
      if (d) return d;
      return PANEL_TO_SERVICE[panel.id] || "";
    }

    var mastersWrap = summary.querySelector("[data-summary-masters-wrap]");
    var chipsEl = summary.querySelector("[data-summary-master-chips]");
    var dockToggle = summary.querySelector("[data-selection-dock-toggle]");
    var dockCollapseKey = "alessanna-selection-dock-collapsed";

    function isLashesPickLabel(label) {
      var s = String(label || "").toLowerCase();
      return s.indexOf("ресниц") !== -1 || s.indexOf("ripsme") !== -1 || s.indexOf("lash") !== -1;
    }

    function readDockCollapsedPref() {
      try {
        return window.localStorage.getItem(dockCollapseKey) === "1";
      } catch (err) {
        return false;
      }
    }

    function persistDockCollapsed(collapsed) {
      try {
        window.localStorage.setItem(dockCollapseKey, collapsed ? "1" : "0");
      } catch (err) {}
    }

    function setDockCollapsed(collapsed) {
      if (!picked.length) {
        summary.classList.remove("selection-summary--dock-collapsed");
        document.body.classList.remove("selection-dock-panel-collapsed");
        if (dockToggle) dockToggle.setAttribute("aria-expanded", "true");
        return;
      }
      summary.classList.toggle("selection-summary--dock-collapsed", collapsed);
      document.body.classList.toggle("selection-dock-panel-collapsed", collapsed);
      if (dockToggle) dockToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      persistDockCollapsed(collapsed);
      if (typeof updateSelectionDockOffset === "function") updateSelectionDockOffset();
    }

    function updateCartCountBadge() {
      var n = picked.length;
      document.querySelectorAll("[data-cart-count]").forEach(function (el) {
        el.textContent = String(n);
        el.hidden = n === 0;
      });
    }

    var nameToId = {};
    for (var mi = 0; mi < MASTERS_PICK.length; mi++) {
      nameToId[MASTERS_PICK[mi].name.toLowerCase()] = MASTERS_PICK[mi].id;
    }

    var picked = [];

    function updateTeamSectionVisibility() {
      if (!teamRoot) return;
      var hasPickedServices = picked.length > 0;
      teamRoot.hidden = !hasPickedServices;
      if (hasPickedServices) {
        teamRoot.querySelectorAll(".reveal").forEach(function (el) {
          el.classList.add("is-visible");
        });
      } else if (masterSelect && masterSelect.value) {
        applyMaster("");
      }
    }

    function currentTeamGroupKey() {
      if (!picked.length) return "";
      var slug = (serviceSelect && serviceSelect.value) || "";
      if (slug === "manicure" || slug === "pedicure") return "nails";
      if (slug === "brows-lashes") return "brows";
      return "hair";
    }

    function syncTeamGroupsVisibility() {
      if (!teamRoot) return;
      var groups = teamRoot.querySelectorAll(".team-group[data-team-group]");
      if (!groups.length) return;
      var key = currentTeamGroupKey();
      for (var i = 0; i < groups.length; i++) {
        var g = groups[i];
        var gk = g.getAttribute("data-team-group") || "";
        g.hidden = !!key && gk !== key;
      }
    }

    function pickKey(panelId, label) {
      return panelId + "|" + label.trim();
    }

    function masterNameById(id) {
      if (id === "any") {
        if (selRu) return "Не важно";
        if (selEn) return "No preference";
        if (selFi) return "Ei väliä";
        return "Pole oluline";
      }
      for (var i = 0; i < MASTERS_PICK.length; i++) {
        if (MASTERS_PICK[i].id === id) return MASTERS_PICK[i].name;
      }
      return UI.masterNone;
    }

    function setMasterDisplayText(text) {
      if (masterDisplay) masterDisplay.textContent = text || UI.masterNone;
    }

    /** Мастера, которые закрывают все выбранные категории услуг (пересечение, не объединение). */
    function mastersForPickedCategories() {
      if (!picked.length) return [];
      var categories = [];
      var seen = {};
      for (var i = 0; i < picked.length; i++) {
        var cat = picked[i].masterFilter || picked[i].category;
        if (seen[cat]) continue;
        seen[cat] = true;
        categories.push(cat);
      }
      var first = CATEGORY_TO_MASTER_IDS[categories[0]];
      if (!first || !first.length) return [];
      var out = first.slice();
      for (var c = 1; c < categories.length; c++) {
        var ids = CATEGORY_TO_MASTER_IDS[categories[c]];
        if (!ids || !ids.length) return [];
        out = out.filter(function (id) {
          return ids.indexOf(id) !== -1;
        });
        if (!out.length) return [];
      }
      out.sort(function (a, b) {
        return masterNameById(a).localeCompare(masterNameById(b), undefined, { sensitivity: "base" });
      });
      return out;
    }

    function validateMasterForPicks() {
      if (!masterSelect || !picked.length) return;
      var allowed = mastersForPickedCategories();
      var v = masterSelect.value;
      if (!v || v === ANY_MASTER_ID) return;
      if (!allowed.length || allowed.indexOf(v) === -1) applyMaster("");
    }

    function syncMasterSelectEligibility() {
      if (!masterSelect) return;
      if (!picked.length) {
        for (var i = 0; i < masterSelect.options.length; i++) {
          masterSelect.options[i].disabled = false;
        }
        return;
      }
      var allowed = mastersForPickedCategories();
      for (var k = 0; k < masterSelect.options.length; k++) {
        var opt = masterSelect.options[k];
        var val = opt.value;
        if (!val || val === ANY_MASTER_ID) {
          opt.disabled = false;
          continue;
        }
        opt.disabled = !allowed.length || allowed.indexOf(val) === -1;
      }
    }

    function syncTeamMasterEligibility() {
      if (!teamRoot) return;
      var lis = teamRoot.querySelectorAll(".team-names li");
      if (!lis.length) return;
      if (!picked.length) {
        for (var i = 0; i < lis.length; i++) {
          lis[i].classList.remove("is-master-ineligible");
          lis[i].removeAttribute("aria-disabled");
          if (lis[i].getAttribute("role") === "button") lis[i].tabIndex = 0;
        }
        return;
      }
      var allowed = mastersForPickedCategories();
      for (var j = 0; j < lis.length; j++) {
        var li = lis[j];
        var tid = nameToId[li.textContent.trim().toLowerCase()];
        var bad = !tid || !allowed.length || allowed.indexOf(tid) === -1;
        li.classList.toggle("is-master-ineligible", bad);
        if (bad) {
          li.setAttribute("aria-disabled", "true");
          li.tabIndex = -1;
        } else {
          li.removeAttribute("aria-disabled");
          if (li.getAttribute("role") === "button") li.tabIndex = 0;
        }
      }
    }

    function updateDock() {
      var has = picked.length > 0;
      summary.classList.toggle("selection-summary--dock", has);
      document.body.classList.toggle("selection-dock-active", has);
      updateCartCountBadge();
      if (!has) {
        summary.classList.remove("selection-summary--dock-collapsed");
        document.body.classList.remove("selection-dock-panel-collapsed");
        if (dockToggle) dockToggle.setAttribute("aria-expanded", "true");
        summary.removeAttribute("data-dock-inited");
      } else if (!summary.hasAttribute("data-dock-inited")) {
        summary.setAttribute("data-dock-inited", "");
        setDockCollapsed(readDockCollapsedPref());
        return;
      }
      if (typeof updateSelectionDockOffset === "function") updateSelectionDockOffset();
    }

    if (dockToggle) {
      dockToggle.addEventListener("click", function () {
        if (!picked.length) return;
        var collapsed = summary.classList.toggle("selection-summary--dock-collapsed");
        document.body.classList.toggle("selection-dock-panel-collapsed", collapsed);
        dockToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
        persistDockCollapsed(collapsed);
        if (typeof updateSelectionDockOffset === "function") updateSelectionDockOffset();
      });
    }

    function renderMasterChips() {
      if (!mastersWrap || !chipsEl) return;
      if (!picked.length) {
        mastersWrap.hidden = true;
        chipsEl.innerHTML = "";
        return;
      }
      var ids = mastersForPickedCategories();
      if (!ids.length) {
        mastersWrap.hidden = true;
        chipsEl.innerHTML = "";
        return;
      }
      mastersWrap.hidden = false;
      chipsEl.innerHTML = "";
      var current = masterSelect ? masterSelect.value : "";
      for (var c = 0; c < ids.length; c++) {
        (function (mid) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "master-suggest-chip";
          btn.setAttribute("role", "radio");
          btn.setAttribute("aria-checked", current === mid ? "true" : "false");
          btn.setAttribute("data-master-id", mid);
          btn.textContent = masterNameById(mid);
          btn.addEventListener("click", function () {
            if (masterSelect && masterSelect.value === mid) applyMaster("");
            else applyMaster(mid);
          });
          chipsEl.appendChild(btn);
        })(ids[c]);
      }
    }

    function syncFormCategory() {
      if (!picked.length) return;
      var nextCategory = picked[picked.length - 1].category;
      if (serviceSelect.value === nextCategory) return;
      serviceSelect.value = nextCategory;
      serviceSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function scrollToMastersBlock() {
      requestAnimationFrame(function () {
        scrollToSectionTitle("meistrid");
      });
    }

    function syncHiddenField() {
      if (!detailField) return;
      detailField.value = picked
        .map(function (p) {
          return p.label + " (" + p.price + ")";
        })
        .join("; ");
    }

    function syncMenuRowsPickedClass() {
      var keys = {};
      for (var i = 0; i < picked.length; i++) keys[picked[i].key] = true;
      var rows = teenused.querySelectorAll(".menu-list li.menu-pick-row");
      for (var r = 0; r < rows.length; r++) {
        var li = rows[r];
        var k = li.getAttribute("data-pick-key");
        var on = !!(k && keys[k]);
        li.classList.toggle("is-picked", on);
        li.setAttribute("aria-pressed", on ? "true" : "false");
      }
    }

    function renderList() {
      listEl.innerHTML = "";
      if (!picked.length) {
        listEl.hidden = true;
        emptyEl.hidden = false;
      } else {
        listEl.hidden = false;
        emptyEl.hidden = true;
        for (var j = 0; j < picked.length; j++) {
          (function (item) {
            var li = document.createElement("li");
            li.className = "pick-chip";
            var text = document.createElement("span");
            text.className = "pick-chip-text";
            text.textContent = item.label + " — " + item.price;
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "pick-chip-remove";
            btn.setAttribute("aria-label", UI.remove + ": " + item.label);
            btn.appendChild(document.createTextNode("\u00d7"));
            btn.addEventListener("click", function (e) {
              e.preventDefault();
              e.stopPropagation();
              removeByKey(item.key);
            });
            li.appendChild(text);
            li.appendChild(btn);
            listEl.appendChild(li);
          })(picked[j]);
        }
      }
      syncHiddenField();
      syncMenuRowsPickedClass();
      updateTeamSectionVisibility();
      updateDock();
      syncTeamGroupsVisibility();
      syncTeamMasterEligibility();
      syncMasterSelectEligibility();
      renderMasterChips();
      validateMasterForPicks();
    }

    function removeByKey(key) {
      picked = picked.filter(function (p) {
        return p.key !== key;
      });
      if (picked.length) syncFormCategory();
      renderList();
    }

    function togglePick(li) {
      var panel = li.closest(".tab-panel");
      if (!panel || !panel.id) return;
      var category = serviceCategoryFromPanel(panel);
      if (!category) return;
      var nameSpan = li.querySelector("span:not(.price)");
      var priceEl = li.querySelector(".price");
      if (!nameSpan || !priceEl) return;
      var label = nameSpan.textContent.trim();
      var price = priceEl.textContent.trim();
      var key = pickKey(panel.id, label);
      var idx = -1;
      for (var i = 0; i < picked.length; i++) {
        if (picked[i].key === key) {
          idx = i;
          break;
        }
      }
      if (idx >= 0) {
        picked.splice(idx, 1);
      } else {
        var masterFilter = masterFilterForCategoryKey(category);
        if (masterFilter === "brows-lashes" && isLashesPickLabel(label)) masterFilter = "lashes";
        picked.push({ key: key, label: label, price: price, category: category, masterFilter: masterFilter });
      }
      syncFormCategory();
      renderList();
      if (picked.length) scrollToMastersBlock();
    }

    function wireMenuPickRows() {
      teenused.querySelectorAll(".menu-list li").forEach(function (li) {
        if (li.classList.contains("menu-subhead") || li.classList.contains("menu-section-title")) return;
        var nameSpan = li.querySelector("span:not(.price)");
        var priceEl = li.querySelector(".price");
        if (!nameSpan || !priceEl) return;
        var panel = li.closest(".tab-panel");
        if (!panel) return;
        if (!serviceCategoryFromPanel(panel)) return;
        if (li.getAttribute("data-pick-wired") === "1") return;
        li.classList.add("menu-pick-row");
        li.setAttribute("role", "button");
        li.tabIndex = 0;
        li.setAttribute("data-pick-key", pickKey(panel.id, nameSpan.textContent.trim()));
        li.setAttribute("data-pick-wired", "1");
        li.addEventListener("click", function () {
          togglePick(li);
        });
        li.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            togglePick(li);
          }
        });
      });
    }

    wireMenuPickRows();
    window.addEventListener("teenused-supabase-ready", function () {
      wireMenuPickRows();
      syncMenuRowsPickedClass();
    });

    function highlightTeam(masterId) {
      var lis = document.querySelectorAll("#meistrid .team-names li");
      for (var t = 0; t < lis.length; t++) {
        var li = lis[t];
        var txt = li.textContent.trim().toLowerCase();
        var id = nameToId[txt];
        li.classList.toggle("is-master-picked", !!(masterId && id === masterId));
      }
    }

    function applyMaster(id) {
      if (!masterSelect) return;
      masterSelect.value = id || "";
      setMasterDisplayText(id ? masterNameById(id) : UI.masterNone);
      highlightTeam(id || "");
      masterSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }

    if (teamRoot) {
      var teamLis = teamRoot.querySelectorAll(".team-names li");
      for (var tl = 0; tl < teamLis.length; tl++) {
        (function (li) {
          var id = nameToId[li.textContent.trim().toLowerCase()];
          if (!id) return;
          li.setAttribute("role", "button");
          li.tabIndex = 0;
          li.setAttribute("aria-pressed", "false");
          li.addEventListener("click", function () {
            if (li.classList.contains("is-master-ineligible")) return;
            if (masterSelect && masterSelect.value === id) applyMaster("");
            else applyMaster(id);
          });
          li.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (li.classList.contains("is-master-ineligible")) return;
              li.click();
            }
          });
        })(teamLis[tl]);
      }
    }

    if (masterSelect) {
      masterSelect.addEventListener("change", function () {
        var v = masterSelect.value;
        highlightTeam(v);
        setMasterDisplayText(v ? masterNameById(v) : UI.masterNone);
        renderMasterChips();
        var lis2 = document.querySelectorAll("#meistrid .team-names li");
        for (var u = 0; u < lis2.length; u++) {
          var li2 = lis2[u];
          var tid = nameToId[li2.textContent.trim().toLowerCase()];
          li2.setAttribute("aria-pressed", v && tid === v ? "true" : "false");
        }
      });
    }

    renderList();
  })();

  /* =============================================================================
   * Календарь бронирования (демонстрация, без сервера)
   * =============================================================================
   * Логика: пока в select[data-master-select] пусто — все дни «закрыты» (как на макете).
   * После выбора мастера дни получают случайный, но стабильный набор слотов (hash от даты+мастер).
   * Воскресенье всегда без слотов. Смена месяца сбрасывает выбранную дату.
   *
   * Замена на реальный API: вместо dayAvailability() подставить fetch и заполнение слотов
   * с сервера; renderCalendar() оставить как отрисовку по полученным данным.
   * Отправка формы сейчас открывает mailto: — замените обработчик submit на POST.
   * ============================================================================= */
  var bookingSection = document.getElementById("broneeri");
  var gridEl = document.querySelector("[data-calendar-grid]");
  var titleEl = document.querySelector("[data-calendar-title]");
  var prevBtn = document.querySelector("[data-calendar-prev]");
  var nextBtn = document.querySelector("[data-calendar-next]");
  var masterSelect = document.querySelector("[data-master-select]");
  var dateInput = document.querySelector("[data-booking-date]");
  var timeSelect = document.querySelector("[data-booking-time]");
  var notePrimary = document.querySelector("[data-calendar-note-primary]");
  var noteSecondary = document.querySelector("[data-calendar-note-secondary]");
  var bookingForm = document.getElementById("booking-form");
  var serviceSelectEl = bookingForm ? bookingForm.querySelector('[name="service"]') : null;

  /* Если чего-то не хватает в DOM — весь блок календаря не инициализируется */
  if (bookingSection && gridEl && titleEl && prevBtn && nextBtn && masterSelect && dateInput && timeSelect && bookingForm && serviceSelectEl) {
    /* Язык: <html lang> с /ru /et /fi /en + подписи календаря и mailto */
    var pageLang = (document.documentElement.getAttribute("lang") || "et").toLowerCase().slice(0, 2);
    if (pageLang !== "ru" && pageLang !== "et" && pageLang !== "fi" && pageLang !== "en") pageLang = "et";
    var isRu = pageLang === "ru";
    var isEn = pageLang === "en";
    var isFi = pageLang === "fi";

    var MONTHS_ET = [
      "jaanuar", "veebruar", "märts", "aprill", "mai", "juuni",
      "juuli", "august", "september", "oktoober", "november", "detsember"
    ];
    var MONTHS_RU = [
      "января", "февраля", "марта", "апреля", "мая", "июня",
      "июля", "августа", "сентября", "октября", "ноября", "декабря"
    ];
    var MONTHS_TITLE_RU = [
      "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
      "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
    ];
    var MONTHS_TITLE_EN = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    var MONTHS_TITLE_FI = [
      "Tammikuu", "Helmikuu", "Maaliskuu", "Huhtikuu", "Toukokuu", "Kesäkuu",
      "Heinäkuu", "Elokuu", "Syyskuu", "Lokakuu", "Marraskuu", "Joulukuu"
    ];

    var MSGS = isRu
      ? {
          noTime: "Нет свободного времени",
          noTimeShort: "Нет времени",
          pickMaster: "Выберите мастера, чтобы увидеть свободные даты",
          pickDay: "Выберите день в календаре",
          pickTimeFirst: "Сначала выберите день",
          pickTime: "Выберите время",
          many: "Много окон",
          busy: "Почти занято",
          best: "Лучший день",
          slotsAvailable: "Доступно:",
        }
      : isEn
        ? {
            noTime: "No available times",
            noTimeShort: "None",
            pickMaster: "Choose a stylist to see available days",
            pickDay: "Pick a day in the calendar",
            pickTimeFirst: "Pick a day first",
            pickTime: "Pick a time",
            many: "Many openings",
            busy: "Almost full",
            best: "Recommended day",
            slotsAvailable: "Available:",
          }
        : isFi
          ? {
              noTime: "Ei vapaita aikoja",
              noTimeShort: "Ei aikoja",
              pickMaster: "Valitse stylisti nähdäksesi vapaat päivät",
              pickDay: "Valitse päivä kalenterista",
              pickTimeFirst: "Valitse ensin päivä",
              pickTime: "Valitse aika",
              many: "Paljon vapaita",
              busy: "Lähes täynnä",
              best: "Suositeltu päivä",
              slotsAvailable: "Vapaana:",
            }
          : {
              noTime: "Pole vaba aega",
              noTimeShort: "Pole aega",
              pickMaster: "Vali meister, et näha vabu päevi",
              pickDay: "Vali kalendrist sobiv päev",
              pickTimeFirst: "Vali kõigepealt päev",
              pickTime: "Vali kellaaeg",
              many: "Palju vabu aegu",
              busy: "Peaaegu täis",
              best: "Soovituspäev",
              slotsAvailable: "Saadaval:",
            };

    /* Список мастеров: id — для hash в dayAvailability; name — текст в option */
    var MASTERS = [
      { id: "galina", name: "Galina" },
      { id: "irina", name: "Irina" },
      { id: "viktoria", name: "Viktoria" },
      { id: "anne", name: "Anne" },
      { id: "alesja", name: "Alesja" },
      { id: "aljona", name: "Aljona" },
    ];

    var DEMO_SERVICE_MASTERS = {
      "hair-cut": ["galina", "irina", "viktoria", "anne"],
      "hair-color": ["galina", "irina", "viktoria", "anne"],
      perm: ["galina", "irina", "viktoria", "anne"],
      styling: ["galina", "irina", "viktoria", "anne"],
      "brows-lashes": ["aljona", "alesja"],
      manicure: ["alesja", "aljona"],
      pedicure: ["alesja", "aljona"],
    };

    var ANY_MASTER_ID = "any";

    var SLOT_POOL = ["10:00", "11:30", "13:00", "14:30", "16:00", "17:30"];

    var apiBooking = false;
    var serviceIdBySlug = {};
    var monthDays = null;
    var monthCacheKey = "";
    var suppressNextMasterScroll = false;

    var now = new Date();
    var viewY = now.getFullYear();
    var viewM = now.getMonth();
    var minY = now.getFullYear();
    var minM = now.getMonth();
    var maxD = new Date(now.getFullYear(), now.getMonth() + 7, 0);
    var maxY = maxD.getFullYear();
    var maxM = maxD.getMonth();
    var selectedKey = "";
    var selectedSlots = [];

    function pad2(n) {
      return (n < 10 ? "0" : "") + n;
    }

    /** Ключ даты YYYY-MM-DD для сравнения и хранения выбора */
    function dateKey(y, m, d) {
      return y + "-" + pad2(m + 1) + "-" + pad2(d);
    }

    /** Простой строковый hash для псевдослучайности по (мастер + дата) */
    function hashSeed(str) {
      var h = 0;
      for (var i = 0; i < str.length; i++) {
        h = ((h << 5) - h + str.charCodeAt(i)) | 0;
      }
      return Math.abs(h);
    }

    function anyMasterLabel() {
      if (isRu) return "Не важно";
      if (isEn) return "No preference";
      if (isFi) return "Ei väliä";
      return "Pole oluline";
    }

    function selectedMasterForAvailability() {
      return masterSelect.value || ANY_MASTER_ID;
    }

    function smoothScrollTo(el, block) {
      if (!el) return;
      requestAnimationFrame(function () {
        el.scrollIntoView({ behavior: "smooth", block: block || "start" });
      });
    }

    /**
     * Возвращает { tier, slots } для ячейки календаря.
     * tier: locked | off | none | soft | busy | featured — соответствует классам .is-* в CSS.
     */
    function dayAvailability(masterId, y, m, d) {
      if (!masterId) masterId = ANY_MASTER_ID;
      var dt = new Date(y, m, d);
      if (dt.getDay() === 0) {
        return { tier: "off", slots: [] };
      }
      if (apiBooking && monthDays) {
        var keyApi = dateKey(y, m, d);
        var entry = monthDays[keyApi];
        var slApi = entry && entry.slots ? entry.slots : [];
        if (!slApi.length) {
          return { tier: "none", slots: [] };
        }
        var n = slApi.length;
        var tierApi = n >= 4 ? "soft" : n >= 2 ? "busy" : "featured";
        return { tier: tierApi, slots: slApi.slice() };
      }
      if (apiBooking) {
        return { tier: "none", slots: [] };
      }
      if (masterId === ANY_MASTER_ID) {
        var combined = [];
        var demoMasters = demoMastersForCurrentService();
        for (var dm = 0; dm < demoMasters.length; dm++) {
          var demoInfo = dayAvailability(demoMasters[dm].id, y, m, d);
          combined = combined.concat(demoInfo.slots);
        }
        combined.sort();
        var unique = [];
        for (var us = 0; us < combined.length; us++) {
          if (unique.indexOf(combined[us]) === -1) unique.push(combined[us]);
        }
        if (!unique.length) return { tier: "none", slots: [] };
        return { tier: unique.length >= 4 ? "soft" : unique.length >= 2 ? "busy" : "featured", slots: unique };
      }
      var serviceSlug = serviceSelectEl.value || "service";
      var seed = hashSeed(masterId + "|" + serviceSlug + "|" + dateKey(y, m, d));
      var r = seed % 10;
      if (r < 2) {
        return { tier: "none", slots: [] };
      }
      var tier = r < 5 ? "soft" : r < 8 ? "busy" : "featured";
      var count = tier === "soft" ? 4 : tier === "busy" ? 2 : 5;
      var slots = [];
      var pool = SLOT_POOL.slice();
      for (var i = 0; i < count && pool.length; i++) {
        var idx = (seed + i * 7) % pool.length;
        slots.push(pool.splice(idx, 1)[0]);
      }
      slots.sort();
      return { tier: tier, slots: slots };
    }

    function formatLongDate(y, m, d) {
      if (isRu) {
        return d + " " + MONTHS_RU[m] + " " + y;
      }
      if (isEn) {
        return MONTHS_TITLE_EN[m] + " " + d + ", " + y;
      }
      if (isFi) {
        return d + ". " + MONTHS_TITLE_FI[m] + " " + y;
      }
      return d + ". " + MONTHS_ET[m] + " " + y;
    }

    function monthTitle(y, m) {
      if (isRu) {
        return MONTHS_TITLE_RU[m] + " " + y;
      }
      if (isEn) {
        return MONTHS_TITLE_EN[m] + " " + y;
      }
      if (isFi) {
        return MONTHS_TITLE_FI[m] + " " + y;
      }
      return MONTHS_ET[m].charAt(0).toUpperCase() + MONTHS_ET[m].slice(1) + " " + y;
    }

    /** Не даём уйти в прошлые месяцы или слишком далеко вперёд (7 мес. от текущей даты) */
    function updateNavButtons() {
      prevBtn.disabled = viewY < minY || (viewY === minY && viewM <= minM);
      nextBtn.disabled = viewY > maxY || (viewY === maxY && viewM >= maxM);
    }

    /** Две строки под календарём: подсказки в зависимости от мастера / даты */
    function setNotes() {
      if (!selectedKey) {
        if (notePrimary) notePrimary.textContent = MSGS.pickDay;
        if (noteSecondary) noteSecondary.textContent = "";
        return;
      }
      var parts = selectedKey.split("-").map(Number);
      var y = parts[0];
      var mo = parts[1] - 1;
      var da = parts[2];
      var label = formatLongDate(y, mo, da);
      if (notePrimary) {
        notePrimary.textContent =
          label + (selectedSlots.length ? " · " + MSGS.slotsAvailable + " " + selectedSlots.join(", ") : "");
      }
      if (noteSecondary) {
        noteSecondary.textContent = selectedSlots.length ? MSGS.pickTime : MSGS.noTime;
      }
    }

    /** Пересобирает select времени после выбора дня */
    function fillTimeOptions() {
      timeSelect.innerHTML = "";
      var opt0 = document.createElement("option");
      opt0.value = "";
      opt0.textContent = selectedKey ? MSGS.pickTime : MSGS.pickTimeFirst;
      timeSelect.appendChild(opt0);
      selectedSlots.forEach(function (t) {
        var o = document.createElement("option");
        o.value = t;
        o.textContent = t;
        timeSelect.appendChild(o);
      });
    }

    /** Сброс даты/времени: смена мастера или месяца */
    function clearSelection() {
      selectedKey = "";
      selectedSlots = [];
      dateInput.value = "";
      dateInput.placeholder = MSGS.pickDay;
      fillTimeOptions();
      setNotes();
    }

    /** Клик по доступному дню: сохраняем слоты и перерисовываем сетку (.is-selected) */
    function selectDay(y, m, d, slots) {
      selectedKey = dateKey(y, m, d);
      selectedSlots = slots;
      dateInput.value = formatLongDate(y, m, d);
      fillTimeOptions();
      setNotes();
      renderCalendar();
    }

    /** Короткий текст внутри ячейки (статус дня) */
    function cellLabel(tier, slots) {
      if (tier === "locked") return MSGS.noTimeShort;
      if (tier === "off" || tier === "none" || !slots.length) return MSGS.noTimeShort;
      if (tier === "soft") return MSGS.many;
      if (tier === "busy") return MSGS.busy;
      return MSGS.best;
    }

    function invalidateMonthCache() {
      monthCacheKey = "";
      monthDays = null;
    }

    function ensureMonthThenRender() {
      if (!apiBooking || !serviceSelectEl.value) {
        monthDays = null;
        renderCalendarBody();
        return;
      }
      var sid = serviceIdBySlug[serviceSelectEl.value];
      if (!sid) {
        monthDays = null;
        renderCalendarBody();
        return;
      }
      var mid = selectedMasterForAvailability();
      var cacheK = mid + "|" + sid + "|" + viewY + "|" + viewM;
      if (monthCacheKey === cacheK && monthDays) {
        renderCalendarBody();
        return;
      }
      monthCacheKey = cacheK;
      fetch(
        "/api/public/calendar-month?employeeId=" +
          encodeURIComponent(mid) +
          "&serviceId=" +
          encodeURIComponent(sid) +
          "&y=" +
          viewY +
          "&m=" +
          viewM
      )
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          monthDays = data.days || {};
          renderCalendarBody();
        })
        .catch(function () {
          monthDays = {};
          renderCalendarBody();
        });
    }

    function renderCalendar() {
      if (apiBooking) {
        ensureMonthThenRender();
      } else {
        renderCalendarBody();
      }
    }

    /**
     * Строит сетку: пустые ячейки до 1-го числа (понедельник = первый столбец),
     * затем кнопки по дням месяца. Замыкание (function (d) { ... })(day) фиксирует номер дня
     * для обработчика клика — иначе в цикле «var day» дал бы всем последнее значение.
     */
    function renderCalendarBody() {
      titleEl.textContent = monthTitle(viewY, viewM);
      updateNavButtons();
      gridEl.innerHTML = "";

      var first = new Date(viewY, viewM, 1);
      /* JS: вс=0; нужен первый столбец = пн → (getDay()+6)%7 */
      var startPad = (first.getDay() + 6) % 7;
      var daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
      var masterVal = selectedMasterForAvailability();
      var i;
      var cell;

      for (i = 0; i < startPad; i++) {
        cell = document.createElement("div");
        cell.className = "calendar-day is-outside";
        cell.setAttribute("aria-hidden", "true");
        gridEl.appendChild(cell);
      }

      for (var day = 1; day <= daysInMonth; day++) {
        (function (d) {
          var info = dayAvailability(masterVal, viewY, viewM, d);
          var key = dateKey(viewY, viewM, d);
          cell = document.createElement("button");
          cell.type = "button";
          cell.className = "calendar-day";
          cell.setAttribute("aria-label", formatLongDate(viewY, viewM, d));

          if (info.tier === "locked") {
            cell.classList.add("is-unavailable");
            cell.disabled = true;
          } else if (info.tier === "off" || info.tier === "none" || !info.slots.length) {
            cell.classList.add("is-unavailable");
            cell.disabled = true;
          } else {
            cell.classList.add("is-" + info.tier);
            cell.disabled = false;
            var slotsCopy = info.slots.slice();
            cell.addEventListener("click", function () {
              selectDay(viewY, viewM, d, slotsCopy);
            });
          }

          if (key === selectedKey && !cell.disabled) {
            cell.classList.add("is-selected");
          }

          var num = document.createElement("span");
          num.className = "calendar-date";
          num.textContent = String(d);
          cell.appendChild(num);

          var meta = document.createElement("span");
          meta.className = "calendar-meta";
          meta.textContent = cellLabel(info.tier, info.slots);
          cell.appendChild(meta);

          gridEl.appendChild(cell);
        })(day);
      }

      setNotes();
    }

    function setMasterOptions(list) {
      if (!Array.isArray(list)) list = [];
      var prev = masterSelect.value;
      while (masterSelect.children.length > 1) {
        masterSelect.removeChild(masterSelect.lastChild);
      }
      if (list.length) {
        var anyOpt = document.createElement("option");
        anyOpt.value = ANY_MASTER_ID;
        anyOpt.textContent = anyMasterLabel();
        masterSelect.appendChild(anyOpt);
      }
      list.forEach(function (m) {
        var opt = document.createElement("option");
        opt.value = String(m.id);
        opt.textContent = m.name;
        masterSelect.appendChild(opt);
      });
      var stillValid = false;
      for (var k = 1; k < masterSelect.options.length; k++) {
        if (masterSelect.options[k].value === prev) {
          stillValid = true;
          break;
        }
      }
      masterSelect.value = stillValid ? prev : "";
      if (masterSelect.value !== prev) {
        suppressNextMasterScroll = true;
        masterSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    function demoMastersForCurrentService() {
      var ids = DEMO_SERVICE_MASTERS[serviceSelectEl.value];
      if (!ids || !ids.length) return MASTERS.slice();
      return MASTERS.filter(function (m) {
        return ids.indexOf(m.id) !== -1;
      });
    }

    function refillDemoMastersForCurrentService() {
      setMasterOptions(demoMastersForCurrentService());
    }

    function setupDemoMasters() {
      refillDemoMastersForCurrentService();
    }

    /** Rebuild master dropdown from API for the selected service (employee_services filter). */
    function refillMastersForCurrentService() {
      var slug = serviceSelectEl.value;
      var svcId = serviceIdBySlug[slug];
      var url = "/api/public/employees";
      if (svcId) url += "?serviceId=" + encodeURIComponent(String(svcId));
      return fetch(url)
        .then(function (r) {
          return r.json();
        })
        .then(function (emps) {
          setMasterOptions(emps);
        });
    }

    function startBookingWidget() {
      fetch("/api/health")
        .then(function (r) {
          return r.ok;
        })
        .then(function (ok) {
          if (!ok) throw new Error("no-api");
          return fetch("/api/public/services").then(function (r) {
            return r.json();
          });
        })
        .then(function (services) {
          serviceIdBySlug = {};
          for (var si = 0; si < services.length; si++) {
            if (services[si].slug) serviceIdBySlug[services[si].slug] = services[si].id;
          }
          return refillMastersForCurrentService();
        })
        .then(function () {
          apiBooking = true;
          renderCalendar();
        })
        .catch(function () {
          apiBooking = false;
          invalidateMonthCache();
          setupDemoMasters();
          renderCalendar();
        });
    }

    startBookingWidget();

    prevBtn.addEventListener("click", function () {
      if (prevBtn.disabled) return;
      viewM--;
      if (viewM < 0) {
        viewM = 11;
        viewY--;
      }
      invalidateMonthCache();
      clearSelection();
      renderCalendar();
    });

    nextBtn.addEventListener("click", function () {
      if (nextBtn.disabled) return;
      viewM++;
      if (viewM > 11) {
        viewM = 0;
        viewY++;
      }
      invalidateMonthCache();
      clearSelection();
      renderCalendar();
    });

    masterSelect.addEventListener("change", function () {
      invalidateMonthCache();
      clearSelection();
      renderCalendar();
      if (suppressNextMasterScroll) {
        suppressNextMasterScroll = false;
        return;
      }
      if (masterSelect.value) {
        smoothScrollTo(bookingSection.querySelector(".booking-shell") || bookingSection, "start");
      }
    });

    serviceSelectEl.addEventListener("change", function (e) {
      var masterField = masterSelect.closest("label") || masterSelect;
      var shouldScrollToMasterField = !!(e && e.isTrusted);
      if (apiBooking) {
        refillMastersForCurrentService().then(function () {
          invalidateMonthCache();
          clearSelection();
          renderCalendar();
          if (shouldScrollToMasterField) smoothScrollTo(masterField, "center");
        });
      } else {
        refillDemoMastersForCurrentService();
        invalidateMonthCache();
        clearSelection();
        renderCalendar();
        if (shouldScrollToMasterField) smoothScrollTo(masterField, "center");
      }
    });

    /* Сервер: POST /api/public/bookings; иначе mailto (статический сайт) */
    bookingForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!selectedKey) {
        dateInput.focus();
        return;
      }
      if (!timeSelect.value) {
        timeSelect.focus();
        return;
      }
      if (apiBooking) {
        var slug = serviceSelectEl.value;
        var svcId = serviceIdBySlug[slug];
        if (!svcId) {
          serviceSelectEl.focus();
          return;
        }
        var nameEl = bookingForm.querySelector('[name="name"]');
        var phoneEl = bookingForm.querySelector('[name="phone"]');
        var detailEl = bookingForm.querySelector("[data-field-services-detail]");
        fetch("/api/public/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId:
              masterSelect.value === ANY_MASTER_ID || !masterSelect.value ? ANY_MASTER_ID : Number(masterSelect.value),
            serviceId: svcId,
            date: selectedKey,
            time: timeSelect.value,
            clientName: nameEl ? nameEl.value.trim() : "",
            clientPhone: phoneEl ? phoneEl.value.trim() : "",
            notes: detailEl ? detailEl.value.trim() : "",
          }),
        })
          .then(function (r) {
            return r.json().then(function (j) {
              return { ok: r.ok, status: r.status, j: j };
            });
          })
          .then(function (x) {
            if (x.ok) {
              var okMsg = isRu
                ? "Запись подтверждена. Ждём вас в салоне."
                : isEn
                  ? "Booking confirmed. See you at the salon."
                  : isFi
                    ? "Varaus vahvistettu. Nähdään salongilla."
                    : "Broneering kinnitatud. Täname!";
              window.alert(okMsg);
              bookingForm.reset();
              invalidateMonthCache();
              clearSelection();
              renderCalendar();
            } else {
              var err =
                (x.j && x.j.error) ||
                (isRu
                  ? "Не удалось забронировать. Выберите другое время."
                  : isEn
                    ? "Booking failed. Please pick another time."
                    : isFi
                      ? "Varaus epäonnistui. Valitse toinen aika."
                      : "Broneering ebaõnnestus.");
              window.alert(err);
            }
          })
          .catch(function () {
            window.alert(
              isRu
                ? "Сеть или сервер недоступны."
                : isEn
                  ? "Network or server unavailable."
                  : isFi
                    ? "Verkko tai palvelin ei tavoitettavissa."
                    : "Võrgu viga."
            );
          });
        return;
      }
      var fd = new FormData(bookingForm);
      var lines = [];
      fd.forEach(function (val, key) {
        if (key === "master" && (val === ANY_MASTER_ID || !val)) val = anyMasterLabel();
        lines.push(key + ": " + val);
      });
      var subject = isRu
        ? encodeURIComponent("Запись AlesSanna")
        : isEn
          ? encodeURIComponent("Booking AlesSanna")
          : isFi
            ? encodeURIComponent("Varaus AlesSanna")
            : encodeURIComponent("Broneering AlesSanna");
      var body = encodeURIComponent(lines.join("\n"));
      window.location.href = "mailto:alessanna.ilusalong@gmail.com?subject=" + subject + "&body=" + body;
    });
  }
})();

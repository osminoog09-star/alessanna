/**
 * ============================================================================
 * AlesSanna Ilusalong — логика публичного лендинга (index.html, lang из <html>)
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
 *   5a) #review-form: mailto на рабочий ящик с темой «модерация» (как у бронирования без API).
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
    'a[href="#broneeri"], a[href="#teenused"], a[href="#meistrid"], a[href="#meist"], a[href="#kinkekaardid"], a[href="#tagasiside"], a[href="#kontakt"]'
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

  /* Tabs delegation для прайса (#teenused). Внутри формы записи каталог
   * теперь — два связанных <select>, не tabs+menu-list, поэтому здесь
   * #form-services-mount не упоминается. */
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

    applyTeamFilterForActiveTab();
  });

  /**
   * «Мастера» под секцией услуг должны показывать только карточку для выбранной категории
   * услуг (на что смотрит клиент сверху — те мастера и появляются снизу).
   * Fallback: если для категории нет мастеров с show_on_site, показываем все карточки.
   */
  function normalizeCategoryKey(value) {
    var s = String(value || "").trim();
    if (s.indexOf("n:") === 0) s = s.slice(2);
    try {
      return s.toLocaleLowerCase("ru");
    } catch (err) {
      return s.toLowerCase();
    }
  }

  function applyTeamFilterForActiveTab() {
    var teamRoot = document.querySelector("#meistrid .team-groups");
    if (!teamRoot) return;
    var groupsEls = teamRoot.querySelectorAll(".team-group");
    if (!groupsEls.length) return;

    var teenusedRoot = document.getElementById("teenused");
    var priceOpen = !!(teenusedRoot && teenusedRoot.classList.contains("price-list-open"));

    var activeBtn = document.querySelector("#teenused .tab-btn.is-active");
    var targetPanel = null;
    if (activeBtn) {
      var targetId = activeBtn.getAttribute("aria-controls");
      if (targetId) targetPanel = document.getElementById(targetId);
    }
    var wantedKey = normalizeCategoryKey(
      targetPanel ? targetPanel.getAttribute("data-pick-category") : "",
    );

    if (priceOpen || !wantedKey) {
      groupsEls.forEach(function (el) {
        el.hidden = false;
      });
      return;
    }

    var matched = 0;
    groupsEls.forEach(function (el) {
      var key = String(el.getAttribute("data-category-name") || "").trim();
      var on = key === wantedKey;
      el.hidden = !on;
      if (on) matched++;
    });

    if (matched === 0) {
      groupsEls.forEach(function (el) {
        el.hidden = false;
      });
    }
  }

  window.addEventListener("teenused-supabase-ready", applyTeamFilterForActiveTab);
  window.addEventListener("site-team-rendered", applyTeamFilterForActiveTab);

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

      applyTeamFilterForActiveTab();

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

    var ANY_MASTER_ID = "any";

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

    function rebuildNameToId() {
      nameToId = {};
      if (!teamRoot) return;
      var domLis = teamRoot.querySelectorAll(".team-names li[data-master-id]");
      for (var di = 0; di < domLis.length; di++) {
        var dli = domLis[di];
        var did = dli.getAttribute("data-master-id");
        if (!did) continue;
        nameToId[dli.textContent.trim().toLowerCase()] = did;
      }
    }

    rebuildNameToId();

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

    /**
     * Ключ позиции в корзине = категория + метка услуги.
     * Раньше был panel.id, но после того как тот же каталог стал рисоваться
     * и в #form-services-mount (id-шники там префиксованы "f-"), один и тот
     * же сервис давал бы разные pickKey в прайсе и в форме — корзина рвалась.
     * Нормализуем ключ от data-pick-category панели → один источник истины.
     */
    function pickKey(panelOrId, label) {
      var cat = "";
      if (panelOrId && typeof panelOrId === "object" && panelOrId.getAttribute) {
        cat = String(panelOrId.getAttribute("data-pick-category") || panelOrId.id || "");
      } else {
        cat = String(panelOrId || "");
        /* Сжимаем "f-panel-cat-3" и "panel-cat-3" в одно "panel-cat-3". */
        if (cat.indexOf("f-") === 0) cat = cat.slice(2);
      }
      return cat + "|" + String(label || "").trim();
    }

    function masterNameById(id) {
      if (id === "any") {
        if (selRu) return "Не важно";
        if (selEn) return "No preference";
        if (selFi) return "Ei väliä";
        return "Pole oluline";
      }
      var st = globalThis.__SALON_PUBLIC_STAFF__;
      if (st && id) {
        for (var si = 0; si < st.length; si++) {
          if (String(st[si].id) === String(id)) return st[si].name;
        }
      }
      if (teamRoot && id) {
        var cand = teamRoot.querySelector('li[data-master-id="' + escapeCssAttrKey(id) + '"]');
        if (cand) return cand.textContent.trim();
      }
      return UI.masterNone;
    }

    function setMasterDisplayText(text) {
      if (masterDisplay) masterDisplay.textContent = text || UI.masterNone;
    }

    function slugKeyForTeam(s) {
      return String(s || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .replace(/-+/g, "-");
    }

    function teamCategoryKeyFromPickCategory(catRaw) {
      var s = String(catRaw || "").trim();
      if (!s || s === "other") return null;
      if (s.indexOf("n:") === 0) return slugKeyForTeam(s.slice(2));
      return slugKeyForTeam(s);
    }

    function escapeCssAttrKey(val) {
      var v = String(val || "");
      if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(v);
      return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }

    function allStaffIdsFromTeamDom(teamRootEl) {
      var lis = teamRootEl.querySelectorAll(".team-names li[data-master-id]");
      var ids = [];
      var seen = {};
      for (var ai = 0; ai < lis.length; ai++) {
        var aid = lis[ai].getAttribute("data-master-id");
        if (!aid || seen[aid]) continue;
        seen[aid] = true;
        ids.push(aid);
      }
      return ids;
    }

    function staffIdsInTeamGroup(teamRootEl, categoryKey) {
      if (!categoryKey) return [];
      var sel = '.team-group[data-category-key="' + escapeCssAttrKey(categoryKey) + '"] li[data-master-id]';
      var groupLis = teamRootEl.querySelectorAll(sel);
      var out = [];
      var seenG = {};
      for (var gj = 0; gj < groupLis.length; gj++) {
        var gid = groupLis[gj].getAttribute("data-master-id");
        if (!gid || seenG[gid]) continue;
        seenG[gid] = true;
        out.push(gid);
      }
      return out;
    }

    /**
     * Мастера конкретной услуги по данным из DOM.
     * site-services.mjs кладёт list мастеров в data-service-masters на каждую
     * строку .menu-list li (через запятую). Возвращаем:
     *   - null    — нет data-атрибута / строку не нашли → откат на категорию
     *               (так бывает только при старом / неполном рендере прайса)
     *   - []      — атрибут есть, но пуст: услуга в БД явно не привязана ни
     *               к одному мастеру → НИКТО её не делает (никаких fallback'ов).
     *   - [ids]   — явный список: показываем только этих
     */
    function serviceMastersFromDom(pick) {
      if (!pick || !pick.key) return null;
      var li = teenused
        ? teenused.querySelector('.menu-list li[data-pick-key="' + escapeCssAttrKey(pick.key) + '"]')
        : null;
      if (!li || !li.hasAttribute("data-service-masters")) return null;
      var raw = String(li.getAttribute("data-service-masters") || "").trim();
      if (!raw) return [];
      return raw
        .split(",")
        .map(function (s) {
          return String(s || "").trim();
        })
        .filter(Boolean);
    }

    function staffIdsForPick(teamRootEl, pick) {
      var all = allStaffIdsFromTeamDom(teamRootEl);
      if (!all.length) return [];

      /* 1) Точный список мастеров под конкретную услугу (data-service-masters). */
      var bySvc = serviceMastersFromDom(pick);
      if (Array.isArray(bySvc)) {
        if (bySvc.length === 0) {
          /* Атрибут есть и пуст → CRM явно говорит «никто не делает». */
          return [];
        }
        var allowed = {};
        for (var a = 0; a < all.length; a++) allowed[all[a]] = true;
        var filtered = [];
        var seenSvc = {};
        for (var b = 0; b < bySvc.length; b++) {
          var mid = bySvc[b];
          if (!allowed[mid] || seenSvc[mid]) continue;
          seenSvc[mid] = true;
          filtered.push(mid);
        }
        return filtered;
      }

      /* 2) Fallback — только если атрибута data-service-masters в DOM
       *    вообще нет (старый рендер прайса). Тогда фильтруем по категории. */
      var ck = teamCategoryKeyFromPickCategory(pick.category);
      if (ck === null) return all.slice();
      var scoped = staffIdsInTeamGroup(teamRootEl, ck);
      if (!scoped.length) return all.slice();
      return scoped;
    }

    /** Только мастера из CRM (#meistrid li[data-master-id]); без статического списка. */
    function mastersForPickedCategories() {
      if (!picked.length) return [];
      if (!teamRoot || !teamRoot.querySelector(".team-names li[data-master-id]")) return [];
      var firstIds = staffIdsForPick(teamRoot, picked[0]);
      var outDom = firstIds.slice();
      for (var p = 1; p < picked.length; p++) {
        var nextIds = staffIdsForPick(teamRoot, picked[p]);
        outDom = outDom.filter(function (sid) {
          return nextIds.indexOf(sid) !== -1;
        });
        if (!outDom.length) return [];
      }
      outDom.sort(function (a, b) {
        return masterNameById(a).localeCompare(masterNameById(b), undefined, { sensitivity: "base" });
      });
      return outDom;
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
        var tid = li.getAttribute("data-master-id") || nameToId[li.textContent.trim().toLowerCase()];
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
      /* В hidden-поле кладём все позиции цепочки, чтобы submit-handler мог взять готовый
       * текст (mailto или payload для backend). Формат:
       *   «Стрижка (30 €, 30 мин, мастер: Alesja); Маникюр (25 €, 45 мин, мастер: Не важно)».
       */
      detailField.value = picked
        .map(function (p) {
          var parts = [p.price];
          if (Number(p.duration) > 0) parts.push(formatDuration(p.duration));
          var mid = p.selectedMaster;
          var masterLabel = "";
          if (mid === ANY_MASTER_ID) masterLabel = anyMasterLabelForChip();
          else if (mid) masterLabel = masterNameById(mid);
          if (masterLabel) parts.push("мастер: " + masterLabel);
          return p.label + " (" + parts.join(", ") + ")";
        })
        .join("; ");
    }

    function parseTimeHm(str) {
      var m = String(str || "").trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      var h = Number(m[1]);
      var min = Number(m[2]);
      if (!(h >= 0 && h < 24 && min >= 0 && min < 60)) return null;
      return h * 60 + min;
    }

    function formatTimeHm(totalMin) {
      var h = Math.floor(totalMin / 60) % 24;
      var m = totalMin % 60;
      var hh = String(h).padStart(2, "0");
      var mm = String(m).padStart(2, "0");
      return hh + ":" + mm;
    }

    /** Рисуем цепочку «время → услуга · мастер» в форме записи.
     * Источник: picked[] + значение selectedMaster у каждой позиции
     *         + стартовое время из select[data-booking-time]. */
    function updateBookingChainPreview() {
      var wrap = bookingForm.querySelector("[data-chain-preview]");
      var listEl = bookingForm.querySelector("[data-chain-preview-list]");
      var totalEl = bookingForm.querySelector("[data-chain-preview-total]");
      var hintEl = bookingForm.querySelector("[data-chain-preview-hint]");
      if (!wrap || !listEl || !totalEl) return;
      if (!picked.length) {
        wrap.hidden = true;
        listEl.innerHTML = "";
        totalEl.textContent = "";
        if (hintEl) {
          hintEl.hidden = true;
          hintEl.textContent = "";
        }
        return;
      }
      wrap.hidden = false;
      var timeSel = bookingForm.querySelector("[data-booking-time]");
      var startMin = timeSel ? parseTimeHm(timeSel.value) : null;
      listEl.innerHTML = "";
      var cursor = Number.isFinite(startMin) ? startMin : null;
      var hasDur = picked.some(function (p) {
        return (Number(p.duration) || 0) > 0;
      });
      var missingMaster = false;
      for (var i = 0; i < picked.length; i++) {
        var p = picked[i];
        var li = document.createElement("li");
        li.className = "booking-chain-item";

        var timePart = document.createElement("span");
        timePart.className = "booking-chain-time";
        if (cursor != null) {
          timePart.textContent = formatTimeHm(cursor);
        } else {
          timePart.textContent = "—";
        }
        li.appendChild(timePart);

        var main = document.createElement("span");
        main.className = "booking-chain-main";
        main.textContent = p.label;
        li.appendChild(main);

        if (Number(p.duration) > 0) {
          var dur = document.createElement("span");
          dur.className = "booking-chain-duration";
          dur.textContent = formatDuration(p.duration);
          li.appendChild(dur);
        }

        var master = document.createElement("span");
        master.className = "booking-chain-master";
        if (p.selectedMaster === ANY_MASTER_ID) {
          master.textContent = anyMasterLabelForChip();
        } else if (p.selectedMaster) {
          master.textContent = masterNameById(p.selectedMaster);
        } else {
          master.textContent = "мастер не выбран";
          master.classList.add("booking-chain-master--empty");
          missingMaster = true;
        }
        li.appendChild(master);

        listEl.appendChild(li);

        if (cursor != null) {
          var d = Number(p.duration) || 0;
          var b = i < picked.length - 1 ? Number(p.buffer) || 0 : 0;
          cursor = cursor + d + b;
        }
      }

      if (hasDur) {
        var totalMin = computePlanTotalMinutes();
        var tail = startMin != null ? " · ориентировочно до " + formatTimeHm(startMin + totalMin) : "";
        totalEl.textContent = "Суммарно ~" + formatDuration(totalMin) + tail;
      } else {
        totalEl.textContent = "";
      }

      if (hintEl) {
        if (missingMaster) {
          hintEl.hidden = false;
          hintEl.textContent =
            "Выберите мастера для каждой услуги в блоке «Ваш выбор» (или «Не важно» — тогда распределим мы).";
        } else if (startMin == null) {
          hintEl.hidden = false;
          hintEl.textContent = "Выберите день и время — и мы покажем точное расписание визита.";
        } else {
          hintEl.hidden = true;
          hintEl.textContent = "";
        }
      }
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

    function formatDuration(min) {
      var m = Math.max(0, Math.round(Number(min) || 0));
      if (!m) return "";
      if (m < 60) return m + " мин";
      var h = Math.floor(m / 60);
      var r = m % 60;
      return r ? h + " ч " + r + " мин" : h + " ч";
    }

    function mastersForSpecificPick(pick) {
      /* Если у услуги нет ни одной явной привязки в CRM (staff_services), мы
       * НЕ возвращаем «всех публичных» — раньше это был молчаливый fallback,
       * из-за которого клиент видел всех мастеров под услугой, которую
       * никто реально не делает. Теперь:
       *   pick.masters есть → пересечение с публичными мастерами;
       *   pick.masters пусто → пустой список (master select останется
       *                         только с «Не важно» / без вариантов, и
       *                         клиент сразу видит «никто не делает»).
       */
      var pub = globalThis.__SALON_PUBLIC_STAFF__;
      if (!Array.isArray(pub) || !pub.length) return [];
      if (pick && pick.masters && pick.masters.length) {
        var allow = {};
        for (var i = 0; i < pick.masters.length; i++) allow[String(pick.masters[i])] = true;
        return pub.filter(function (s) {
          return allow[String(s.id)];
        });
      }
      return [];
    }

    function applyPickMaster(pickKeyStr, staffIdOrAny) {
      var changed = false;
      for (var i = 0; i < picked.length; i++) {
        if (picked[i].key === pickKeyStr) {
          if (picked[i].selectedMaster !== staffIdOrAny) {
            picked[i].selectedMaster = staffIdOrAny;
            changed = true;
          }
          break;
        }
      }
      if (changed) {
        renderList();
        updateBookingChainPreview();
      }
    }

    /* Определяет «лучшего» мастера для услуги, учитывая глобальный выбор формы.
     *  1) если в форме уже выбран конкретный мастер и он в списке валидных
     *     для этой услуги — берём его;
     *  2) иначе если у услуги ровно один валидный мастер — берём его (90%
     *     случаев салонов с узкой специализацией);
     *  3) иначе оставляем как есть (или возвращаем "" для нового pick).
     * Возвращает строку: id мастера, "any" или "". */
    function resolveDefaultMasterFor(pick, currentValue) {
      var allowed = mastersForSpecificPick(pick);
      var allowedIds = {};
      for (var ai = 0; ai < allowed.length; ai++) {
        allowedIds[String(allowed[ai].id)] = true;
      }
      /* Глобальный мастер из формы. */
      var formMaster = masterSelect ? String(masterSelect.value || "") : "";
      if (formMaster && formMaster !== ANY_MASTER_ID && allowedIds[formMaster]) {
        return formMaster;
      }
      /* Текущее значение pick (например, при propagate уже стояло "any"). */
      if (currentValue === ANY_MASTER_ID) return ANY_MASTER_ID;
      if (currentValue && allowedIds[String(currentValue)]) return String(currentValue);
      /* Ровно один кандидат — выбираем автоматически. */
      if (allowed.length === 1) return String(allowed[0].id);
      return "";
    }

    /* Распространить глобальный выбор мастера на строки cart. Дёргается из
     * change-обработчика masterSelect (то есть и из #meistrid, и из шапочных
     * master-suggest-chip, и из самой формы). Не перетирает явное "any". */
    function propagateGlobalMasterToPicks() {
      if (!picked.length) return false;
      var formMaster = masterSelect ? String(masterSelect.value || "") : "";
      var changed = false;
      for (var i = 0; i < picked.length; i++) {
        var p = picked[i];
        if (p.selectedMaster === ANY_MASTER_ID) continue;
        var next = resolveDefaultMasterFor(p, formMaster || p.selectedMaster);
        if (next && next !== p.selectedMaster) {
          p.selectedMaster = next;
          changed = true;
        }
      }
      return changed;
    }

    function anyMasterLabelForChip() {
      if (selRu) return "Не важно";
      if (selEn) return "No preference";
      if (selFi) return "Ei väliä";
      return "Pole oluline";
    }

    function renderPickMasterChips(host, pick) {
      host.innerHTML = "";
      host.className = "pick-chip-masters";
      host.setAttribute("role", "radiogroup");
      host.setAttribute("aria-label", "Мастер для услуги " + pick.label);
      var masters = mastersForSpecificPick(pick);
      if (!masters.length) {
        var empty = document.createElement("span");
        empty.className = "pick-chip-masters-empty";
        empty.textContent = "Мастера пока не загружены";
        host.appendChild(empty);
        return;
      }
      /* «Не важно» — всегда первый чип, даёт салону распределить мастера. */
      var anyBtn = document.createElement("button");
      anyBtn.type = "button";
      anyBtn.className = "pick-master-chip pick-master-chip--any";
      anyBtn.setAttribute("data-staff-id", ANY_MASTER_ID);
      anyBtn.setAttribute("aria-checked", pick.selectedMaster === ANY_MASTER_ID ? "true" : "false");
      anyBtn.textContent = anyMasterLabelForChip();
      anyBtn.addEventListener("click", function () {
        applyPickMaster(pick.key, pick.selectedMaster === ANY_MASTER_ID ? "" : ANY_MASTER_ID);
      });
      host.appendChild(anyBtn);

      for (var i = 0; i < masters.length; i++) {
        (function (m) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "pick-master-chip";
          btn.setAttribute("data-staff-id", String(m.id));
          btn.setAttribute("aria-checked", pick.selectedMaster === String(m.id) ? "true" : "false");
          btn.textContent = m.name;
          btn.addEventListener("click", function () {
            applyPickMaster(pick.key, pick.selectedMaster === String(m.id) ? "" : String(m.id));
          });
          host.appendChild(btn);
        })(masters[i]);
      }
    }

    function computePlanTotalMinutes() {
      var total = 0;
      for (var i = 0; i < picked.length; i++) {
        var d = Number(picked[i].duration) || 0;
        var b = i < picked.length - 1 ? Number(picked[i].buffer) || 0 : 0;
        total += d + b;
      }
      return total;
    }

    function renderPlanSummary() {
      var host = summary.querySelector("[data-plan-summary]");
      if (!host) return;
      if (!picked.length) {
        host.hidden = true;
        host.textContent = "";
        return;
      }
      var total = computePlanTotalMinutes();
      var hasDurations = picked.some(function (p) {
        return (Number(p.duration) || 0) > 0;
      });
      if (!hasDurations) {
        host.hidden = true;
        host.textContent = "";
        return;
      }
      host.hidden = false;
      host.textContent = "Общая длительность: ~" + formatDuration(total);
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
            li.setAttribute("data-pick-key", item.key);

            var head = document.createElement("div");
            head.className = "pick-chip-head";

            var text = document.createElement("span");
            text.className = "pick-chip-text";
            text.textContent = item.label + " — " + item.price;
            head.appendChild(text);

            if (Number(item.duration) > 0) {
              var durBadge = document.createElement("span");
              durBadge.className = "pick-chip-duration";
              durBadge.textContent = formatDuration(item.duration);
              head.appendChild(durBadge);
            }

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
            head.appendChild(btn);

            li.appendChild(head);

            var mastersHost = document.createElement("div");
            renderPickMasterChips(mastersHost, item);
            li.appendChild(mastersHost);

            listEl.appendChild(li);
          })(picked[j]);
        }
      }
      renderPlanSummary();
      syncHiddenField();
      syncMenuRowsPickedClass();
      updateTeamSectionVisibility();
      updateDock();
      syncTeamGroupsVisibility();
      syncTeamMasterEligibility();
      /* После изменения корзины мастера пере-фильтруем по реальным
       * staff_services из CRM (через filterMastersByFormCategory):
       * не оставляем «лишних» сотрудников disabled, а полностью убираем
       * их из dropdown — иначе клиент видит, например, всех 6 мастеров
       * для категории «Маникюр», хотя у тебя в CRM маникюр делает только один.
       * refillDemoMastersForCurrentService — это локальный пересчёт без сети. */
      refillDemoMastersForCurrentService();
      syncMasterSelectEligibility();
      renderMasterChips();
      validateMasterForPicks();
      updateBookingChainPreview();
    }

    function removeByKey(key) {
      picked = picked.filter(function (p) {
        return p.key !== key;
      });
      if (picked.length) syncFormCategory();
      renderList();
    }

    function readPickFromLi(li, panel, label, price) {
      var category = serviceCategoryFromPanel(panel);
      var key = pickKey(panel, label);
      var svcId = String(li.getAttribute("data-service-id") || "").trim();
      var dur = Number(li.getAttribute("data-service-duration"));
      var buf = Number(li.getAttribute("data-service-buffer"));
      var mastersRaw = String(li.getAttribute("data-service-masters") || "").trim();
      var masters = mastersRaw
        ? mastersRaw
            .split(",")
            .map(function (s) {
              return String(s || "").trim();
            })
            .filter(Boolean)
        : [];
      var pick = {
        key: key,
        label: label,
        price: price,
        category: category,
        serviceId: svcId,
        duration: Number.isFinite(dur) && dur > 0 ? dur : 0,
        buffer: Number.isFinite(buf) && buf > 0 ? buf : 0,
        masters: masters,
        /* Выбранный мастер для конкретной услуги.
         *   ""  = ещё не выбран,
         *   "any" = «Не важно» (салон распределит),
         *   "<uuid>" = конкретный мастер. */
        selectedMaster: "",
      };
      /* Сразу подставляем «лучшего» мастера: глобальный выбор формы или
       * единственного валидного — иначе клиенту приходится отдельно кликать
       * чип внутри карточки, и план дня висит «мастер не выбран» при том,
       * что выбор очевиден. */
      pick.selectedMaster = resolveDefaultMasterFor(pick, "");
      return pick;
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
      var key = pickKey(panel, label);
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
        picked.push(readPickFromLi(li, panel, label, price));
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
        li.setAttribute("data-pick-key", pickKey(panel, nameSpan.textContent.trim()));
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

    /**
     * Связка двух dropdown'ов в форме записи:
     *   select[data-form-category]      — выбор категории
     *   select[data-form-service-item]  — выбор конкретной услуги (опции
     *       заранее залиты site-services.mjs со всеми услугами + data-category-id;
     *       при смене категории мы скрываем чужие option'ы, при выборе услуги
     *       добавляем её в общую корзину picked[]).
     */
    var serviceItemSelect = bookingForm.querySelector('select[data-form-service-item]');

    function relayoutServiceItemSelect(catId) {
      if (!serviceItemSelect) return;
      var opts = serviceItemSelect.querySelectorAll("option");
      var matched = 0;
      var firstMatchValue = "";
      for (var i = 0; i < opts.length; i++) {
        var opt = opts[i];
        if (!opt.value) {
          /* placeholder — управляем им сами */
          opt.hidden = true;
          continue;
        }
        var oc = String(opt.getAttribute("data-category-id") || "");
        var on = !!catId && oc === catId;
        opt.hidden = !on;
        opt.disabled = !on;
        if (on) {
          matched++;
          if (!firstMatchValue) firstMatchValue = opt.value;
        }
      }
      /* Перерисовываем placeholder (всегда первый, всегда видимый,
       * disabled, чтобы не выбирался). */
      var existingPh = serviceItemSelect.querySelector('option[data-form-placeholder="1"]');
      if (existingPh) existingPh.remove();
      var ph = document.createElement("option");
      ph.value = "";
      ph.disabled = true;
      ph.selected = true;
      ph.setAttribute("data-form-placeholder", "1");
      ph.textContent = !catId
        ? "Сначала выберите категорию"
        : matched === 0
          ? "В категории нет услуг"
          : "Выберите услугу";
      serviceItemSelect.insertBefore(ph, serviceItemSelect.firstChild);
      serviceItemSelect.disabled = !catId || matched === 0;
      serviceItemSelect.value = "";
    }

    function addPickFromServiceOption(opt) {
      if (!opt || !opt.value) return;
      var catSel = serviceSelect;
      var catOpt = catSel ? catSel.options[catSel.selectedIndex] : null;
      var category = catOpt ? String(catOpt.value || "") : "";
      var label = String(opt.getAttribute("data-service-name") || opt.textContent || "").trim();
      /* Цена в pick хранится как строка («18 €») — берём то, что мы
       * клали в data-service-price из site-services.mjs (fmtPrice). */
      var price = String(opt.getAttribute("data-service-price") || "—");
      var dur = Number(opt.getAttribute("data-service-duration"));
      var buf = Number(opt.getAttribute("data-service-buffer"));
      var mastersRaw = String(opt.getAttribute("data-service-masters") || "").trim();
      var masters = mastersRaw
        ? mastersRaw.split(",").map(function (s) { return String(s || "").trim(); }).filter(Boolean)
        : [];
      var svcId = String(opt.getAttribute("data-service-id") || opt.value || "").trim();
      /* pickKey должен совпадать с тем, что генерируется в прайсе.
       * pickKey() умеет работать со строкой category id или с DOM-панелью —
       * передаём category id (это data-pick-category в прайсе). */
      var key = pickKey(category, label);
      for (var i = 0; i < picked.length; i++) {
        if (picked[i].key === key) {
          /* Уже в корзине — оставляем как есть, просто сбросим select. */
          if (serviceItemSelect) serviceItemSelect.value = "";
          return;
        }
      }
      var pick = {
        key: key,
        label: label,
        price: price,
        category: category,
        serviceId: svcId,
        duration: Number.isFinite(dur) && dur > 0 ? dur : 0,
        buffer: Number.isFinite(buf) && buf > 0 ? buf : 0,
        masters: masters,
        selectedMaster: "",
      };
      pick.selectedMaster = resolveDefaultMasterFor(pick, "");
      picked.push(pick);
      syncFormCategory();
      renderList();
      /* После добавления услуги сбрасываем service-select обратно к
       * placeholder, чтобы пользователь мог сразу добавить ещё одну
       * услугу из этой же или другой категории. */
      if (serviceItemSelect) serviceItemSelect.value = "";
    }

    if (serviceSelect) {
      serviceSelect.addEventListener("change", function () {
        var catId = String(serviceSelect.value || "");
        relayoutServiceItemSelect(catId);
      });
    }
    if (serviceItemSelect) {
      serviceItemSelect.addEventListener("change", function () {
        var v = String(serviceItemSelect.value || "");
        if (!v) return;
        var opt = serviceItemSelect.options[serviceItemSelect.selectedIndex];
        addPickFromServiceOption(opt);
      });
    }

    window.addEventListener("teenused-supabase-ready", function () {
      wireMenuPickRows();
      syncMenuRowsPickedClass();
      /* Каталог в форме перерисовывается site-services.mjs'ом отдельно
       * (renderFormSelects), но layout service-select зависит от текущей
       * категории — пересчитаем под актуальные опции. */
      relayoutServiceItemSelect(serviceSelect ? String(serviceSelect.value || "") : "");
      /* После ре-рендера каталога (в т.ч. при realtime-изменениях staff_services)
       * обновляем и «Мастера по выбранным услугам» в корзине — иначе там
       * останутся мастера по старой карте. */
      renderMasterChips();
      validateMasterForPicks();
      syncTeamMasterEligibility();
      syncMasterSelectEligibility();
    });

    window.addEventListener("site-team-ready", function () {
      rebuildNameToId();
      wireTeamMasterClicks();
      renderList();
    });

    function highlightTeam(masterId) {
      var lis = document.querySelectorAll("#meistrid .team-names li");
      for (var t = 0; t < lis.length; t++) {
        var li = lis[t];
        var id = li.getAttribute("data-master-id") || nameToId[li.textContent.trim().toLowerCase()];
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

    /**
     * Перед applyMaster синхронизируем категорию формы с категорией кликнутой
     * группы. Иначе master-select заполнен мастерами текущей формальной
     * категории, кликнутый id отсутствует в опциях и `value` остаётся пустым —
     * визуально клик «не сработал». См. issue: «выбираю мастера, ничего не
     * происходит». Категория группы хранится в `team-group[data-category-name]`
     * (lowercase RU), а форма содержит option с тем же `data-category-name`.
     */
    function syncFormCategoryToMasterGroup(li) {
      var group = li.closest && li.closest(".team-group");
      if (!group) return false;
      var catName = String(group.getAttribute("data-category-name") || "").trim().toLowerCase();
      if (!catName) return false;
      var sel = document.querySelector('#booking-form select[name="service"]');
      if (!sel) return false;
      var match = null;
      for (var oi = 0; oi < sel.options.length; oi++) {
        var optName = String(sel.options[oi].getAttribute("data-category-name") || "")
          .trim()
          .toLowerCase();
        if (optName && optName === catName) {
          match = sel.options[oi];
          break;
        }
      }
      if (!match || sel.value === match.value) return false;
      sel.value = match.value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    function wireTeamMasterClicks() {
      if (!teamRoot) return;
      var teamLis = teamRoot.querySelectorAll(".team-names li");
      for (var tl = 0; tl < teamLis.length; tl++) {
        (function (li) {
          var id = li.getAttribute("data-master-id") || nameToId[li.textContent.trim().toLowerCase()];
          if (!id) return;
          li.setAttribute("role", "button");
          li.tabIndex = 0;
          li.setAttribute("aria-pressed", "false");
          li.addEventListener("click", function () {
            if (li.classList.contains("is-master-ineligible")) return;
            /* Сначала переключаем категорию формы — если поменялась,
             * master-select перезаполнится; затем ждём, пока в нём
             * появится наш id (в api-режиме перезаполнение асинхронное
             * через fetch /api/public/employees), и только тогда
             * ставим мастера. */
            var changed = syncFormCategoryToMasterGroup(li);
            var attempts = 0;
            var tryApply = function () {
              if (!masterSelect) return;
              var found = false;
              for (var k = 0; k < masterSelect.options.length; k++) {
                if (masterSelect.options[k].value === id) {
                  found = true;
                  break;
                }
              }
              if (found) {
                if (masterSelect.value === id) applyMaster("");
                else applyMaster(id);
                return;
              }
              if (attempts++ < 20) setTimeout(tryApply, 50);
            };
            if (changed) setTimeout(tryApply, 0);
            else tryApply();
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

    wireTeamMasterClicks();

    if (masterSelect) {
      masterSelect.addEventListener("change", function () {
        var v = masterSelect.value;
        highlightTeam(v);
        setMasterDisplayText(v ? masterNameById(v) : UI.masterNone);
        renderMasterChips();
        var lis2 = document.querySelectorAll("#meistrid .team-names li");
        for (var u = 0; u < lis2.length; u++) {
          var li2 = lis2[u];
          var tid = li2.getAttribute("data-master-id") || nameToId[li2.textContent.trim().toLowerCase()];
          li2.setAttribute("aria-pressed", v && tid === v ? "true" : "false");
        }
        /* Главный фикс синхронизации: после смены глобального мастера
         * (через форму, #meistrid или master-suggest-chip) подтягиваем выбор
         * в строки cart. Иначе план дня и RPC submit видят пустой
         * selectedMaster, хотя визуально мастер «выбран».
         * renderList сам в конце дёргает updateBookingChainPreview, поэтому
         * отдельный вызов не нужен. */
        if (propagateGlobalMasterToPicks()) {
          renderList();
        }
      });
    }

    /* Когда пользователь меняет «Свободное время» — пересчитываем цепочку услуг в форме.
     * Сама опция «Выберите время» = пустой value, тогда таймлайн показывает «—». */
    var chainTimeSelect = bookingForm.querySelector("[data-booking-time]");
    if (chainTimeSelect) {
      chainTimeSelect.addEventListener("change", function () {
        updateBookingChainPreview();
      });
    }
    var chainDateInput = bookingForm.querySelector("[data-booking-date]");
    if (chainDateInput) {
      chainDateInput.addEventListener("change", function () {
        updateBookingChainPreview();
      });
    }

    /* Публичный API, читается из второго IIFE (submit-handler календаря).
     * Даём копию picked[], чтобы submit-handler не зависел от внутренней
     * структуры этого блока и не мог сломать её мутацией. */
    globalThis.__SITE_BOOKING_CHAIN__ = {
      getItems: function () {
        return picked.map(function (p) {
          return {
            key: p.key,
            label: p.label,
            serviceId: p.serviceId,
            duration: Number(p.duration) || 0,
            buffer: Number(p.buffer) || 0,
            selectedMaster: p.selectedMaster || "",
          };
        });
      },
      count: function () {
        return picked.length;
      },
      clear: function () {
        picked = [];
        syncFormCategory();
        renderList();
      },
    };

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
        var demoMasters = publicStaffAsMasterOptions() || [];
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

    function publicStaffAsMasterOptions() {
      var st = globalThis.__SALON_PUBLIC_STAFF__;
      if (!st || !st.length) return null;
      return st.map(function (s) {
        return { id: String(s.id), name: s.name };
      });
    }

    function cssEscapeAttrValue(val) {
      var v = String(val || "");
      if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(v);
      return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }

    /** Категория (RU, lowercase) для выбранной опции в select[name="service"].
     * Если option без data-category-name — возвращает пустую строку = «не фильтровать». */
    function currentFormCategoryName() {
      if (!serviceSelectEl) return "";
      var opt = serviceSelectEl.options[serviceSelectEl.selectedIndex];
      if (!opt) return "";
      return String(opt.getAttribute("data-category-name") || "").trim().toLowerCase();
    }

    /** Источник истины — связки CRM (`staff_services` через site-team.mjs DOM
     *  и `data-service-masters` на каждом li услуги).
     *  Возвращаем СТРОГО только тех мастеров, кому в CRM проставлен доступ:
     *    1) если есть picked — пересечение по конкретным услугам;
     *    2) иначе — по выбранной категории формы (#meistrid .team-group);
     *    3) если категория формы не выбрана — все публичные.
     *  Никаких «молчаливых fallback на всех» больше нет: если в CRM не
     *  отметили ни одного мастера, dropdown остаётся пустым (только «Не важно»),
     *  иначе клиент думает, что человек делает услугу, которую он не делает.
     */
    function filterMastersByFormCategory(masters) {
      if (!Array.isArray(masters)) return [];

      /* 1) Если что-то уже выбрано в корзине — берём пересечение по
       *    data-service-masters (точная связка staff_services из CRM). */
      if (typeof picked !== "undefined" && picked && picked.length) {
        var allowedByPicks = mastersForPickedCategories();
        if (!allowedByPicks || !allowedByPicks.length) return [];
        var allowSet = {};
        for (var p = 0; p < allowedByPicks.length; p++) allowSet[String(allowedByPicks[p])] = true;
        return masters.filter(function (m) {
          return allowSet[String(m.id)];
        });
      }

      /* 2) Корзина пуста — фильтруем по категории формы записи. */
      var catName = currentFormCategoryName();
      if (!catName) return masters; // категория не выбрана — список не сужаем
      var teamRoot = document.querySelector("#meistrid .team-groups");
      if (!teamRoot) return masters; // ещё не отрендерилось — не наказываем юзера
      var sel =
        '.team-group[data-category-name="' +
        cssEscapeAttrValue(catName) +
        '"] li[data-master-id]';
      var lis = teamRoot.querySelectorAll(sel);
      if (!lis.length) return []; // в CRM никому не дан доступ → пусто
      var allowed = {};
      for (var i = 0; i < lis.length; i++) {
        var mid = lis[i].getAttribute("data-master-id");
        if (mid) allowed[String(mid)] = true;
      }
      return masters.filter(function (m) {
        return allowed[String(m.id)];
      });
    }

    function refillDemoMastersForCurrentService() {
      var pub = publicStaffAsMasterOptions() || [];
      setMasterOptions(filterMastersByFormCategory(pub));
    }

    function setupDemoMasters() {
      var pub = publicStaffAsMasterOptions() || [];
      setMasterOptions(filterMastersByFormCategory(pub));
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
      // На статическом хостинге (alessannailu.com на GitHub Pages) /api/health
      // никогда не существует, поэтому раньше каждая загрузка страницы давала
      // лишний 404 в DevTools Network. Пробуем сервер только если есть явный
      // флаг или мы на dev-машине.
      var host = (typeof location !== "undefined" && location.hostname) || "";
      var hasLocalApi =
        globalThis.SALON_HAS_LOCAL_API === true ||
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "0.0.0.0";
      var pingApi = hasLocalApi
        ? fetch("/api/health").then(function (r) {
            return r.ok;
          })
        : Promise.resolve(false);

      pingApi
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

    window.addEventListener("site-team-ready", function () {
      var pub = publicStaffAsMasterOptions();
      if (!pub) return;
      setMasterOptions(filterMastersByFormCategory(pub));
      invalidateMonthCache();
      clearSelection();
      renderCalendar();
    });

    /* .team-group[data-category-name] появляется чуть позже, чем сам staff-список.
     * После перерисовки команды прогоняем фильтр заново — иначе до первого клика
     * по select остаются все мастера. */
    window.addEventListener("site-team-rendered", function () {
      if (!apiBooking) refillDemoMastersForCurrentService();
    });

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

    function getSalonSupabaseCfg() {
      var sc = globalThis.SUPABASE_CONFIG || {};
      var url = String(sc.url || globalThis.SALON_SUPABASE_URL || "").trim().replace(/\/+$/, "");
      var key = String(sc.anonKey || globalThis.SALON_SUPABASE_ANON_KEY || "").trim();
      return { url: url, key: key };
    }

    /** Собираем строку "YYYY-MM-DDTHH:MM:00" → Date (в локальной TZ пользователя),
     *  потом toISOString(). Postgres timestamptz корректно воспримет Zulu-формат. */
    function buildChainStartIso(dateKey, timeHm) {
      var dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
      var tm = /^(\d{1,2}):(\d{2})$/.exec(String(timeHm || ""));
      if (!dm || !tm) return null;
      var d = new Date(
        Number(dm[1]),
        Number(dm[2]) - 1,
        Number(dm[3]),
        Number(tm[1]),
        Number(tm[2]),
        0,
        0
      );
      if (Number.isNaN(d.getTime())) return null;
      return d.toISOString();
    }

    function chainBookingPayload(items, startIso, nameVal, phoneVal, noteVal) {
      return {
        p_client_name: nameVal || "",
        p_client_phone: phoneVal || "",
        p_client_note: noteVal || "",
        p_start_at: startIso,
        p_items: items.map(function (it) {
          return {
            service_id: it.serviceId,
            staff_id: it.selectedMaster || "any",
          };
        }),
      };
    }

    function chainHumanErrorMessage(code, fallback) {
      var map = isRu
        ? {
            staff_busy: "Мастер занят в это время. Выберите другое время или другого мастера.",
            no_free_master: "Нет свободного мастера в это время. Выберите другое время.",
            staff_not_service: "Этот мастер не делает выбранную услугу.",
            staff_unavailable: "Мастер недоступен. Выберите другого.",
            service_inactive: "Услуга сейчас недоступна.",
            service_not_found: "Услуга не найдена.",
            service_no_duration: "Для услуги не задана длительность — обратитесь в салон.",
            missing_name: "Укажите имя.",
            missing_start: "Выберите день и время.",
            empty_items: "Выберите хотя бы одну услугу в прайсе.",
            too_many_items: "Слишком много услуг за один визит.",
          }
        : {
            staff_busy: "Master is busy at that time.",
            no_free_master: "No free master at that time.",
            staff_not_service: "This master does not do this service.",
            staff_unavailable: "Master is unavailable.",
            service_inactive: "Service is not bookable right now.",
            service_not_found: "Service not found.",
            service_no_duration: "Service duration is missing.",
            missing_name: "Please enter your name.",
            missing_start: "Pick a day and time.",
            empty_items: "Pick at least one service from the price list.",
            too_many_items: "Too many services for one visit.",
          };
      return (code && map[code]) || fallback;
    }

    /** Если корзина пуста, но в форме выбрана категория + мастер — подбираем
     *  представительную услугу из прайса этой категории.
     *  Источник истины — те же `li[data-service-id]`, которые рендерит site-services.mjs.
     *  Предпочитаем услугу, которую выбранный мастер реально делает (data-service-masters),
     *  иначе берём первую в категории. Если прайс не успел загрузиться — возвращаем null. */
    function resolveFallbackItemFromForm() {
      if (!serviceSelectEl) return null;
      var opt = serviceSelectEl.options[serviceSelectEl.selectedIndex];
      if (!opt) return null;
      var catName = String(opt.getAttribute("data-category-name") || "").trim().toLowerCase();
      var catLabel = String(opt.textContent || "").trim().toLowerCase();
      if (!catName && !catLabel) return null;

      /* Ищем нужную панель прайса: сверяем и data-pick-category (uuid-id), и заголовок таба
       * (tabs-bar .tab-btn — аналогичный текст категории). */
      var panels = document.querySelectorAll(".tab-panel[data-pick-category]");
      var chosenLis = [];
      for (var p = 0; p < panels.length; p++) {
        var labelBtn = document.querySelector(
          '.tab-btn[aria-controls="' + cssEscapeAttrValue(panels[p].id) + '"]'
        );
        var panelLabel = labelBtn ? String(labelBtn.textContent || "").trim().toLowerCase() : "";
        if (catName && panelLabel === catName) {
          chosenLis = Array.from(panels[p].querySelectorAll("li[data-service-id]"));
          break;
        }
        if (catLabel && panelLabel === catLabel) {
          chosenLis = Array.from(panels[p].querySelectorAll("li[data-service-id]"));
          break;
        }
      }
      if (!chosenLis.length) return null;

      var wantMaster = masterSelect && masterSelect.value && masterSelect.value !== ANY_MASTER_ID
        ? String(masterSelect.value)
        : "";

      var pickedLi = null;
      if (wantMaster) {
        for (var li = 0; li < chosenLis.length; li++) {
          var raw = String(chosenLis[li].getAttribute("data-service-masters") || "").trim();
          if (!raw) {
            pickedLi = chosenLis[li];
            break;
          }
          var ids = raw.split(/\s*,\s*/).filter(Boolean);
          if (ids.indexOf(wantMaster) !== -1) {
            pickedLi = chosenLis[li];
            break;
          }
        }
      }
      if (!pickedLi) pickedLi = chosenLis[0];

      var serviceId = String(pickedLi.getAttribute("data-service-id") || "");
      if (!serviceId) return null;
      return {
        serviceId: serviceId,
        selectedMaster: wantMaster,
      };
    }

    /** Цепочка услуг (picked[] в dock) + Supabase RPC. Возвращает Promise, который резолвится
     *  в { handled: true, ok: true/false }. Если конфиг Supabase недоступен и запасной
     *  путь тоже провалился — резолвится в { handled: false } и caller идёт в mailto. */
    function trySubmitViaBookChain(nameVal, phoneVal, noteVal) {
      var chainApi = globalThis.__SITE_BOOKING_CHAIN__;
      var items = chainApi && typeof chainApi.getItems === "function" ? chainApi.getItems() : [];

      /* Fallback: корзина пуста → пробуем подобрать услугу из формы. */
      if (!items.length) {
        var fb = resolveFallbackItemFromForm();
        if (fb && fb.serviceId) items = [fb];
      }

      if (!items.length) {
        /* Прайс ещё не загружен, или пользователь не выбрал категорию: мягкий блок, без mailto. */
        window.alert(
          isRu
            ? "Выберите услугу в прайсе выше, чтобы мы знали цену и длительность."
            : isEn
              ? "Please pick a service from the price list so we know price and duration."
              : isFi
                ? "Valitse palvelu hinnastosta, jotta tiedämme hinnan ja keston."
                : "Palun valige teenus hinnakirjast (hind ja kestus)."
        );
        return Promise.resolve({ handled: true, ok: false });
      }

      for (var i = 0; i < items.length; i++) {
        if (!items[i].serviceId) return Promise.resolve({ handled: false });
      }

      var cfg = getSalonSupabaseCfg();
      if (!cfg.url || !cfg.key) return Promise.resolve({ handled: false });

      var startIso = buildChainStartIso(selectedKey, timeSelect.value);
      if (!startIso) return Promise.resolve({ handled: false });

      var payload = chainBookingPayload(items, startIso, nameVal, phoneVal, noteVal);

      return fetch(cfg.url + "/rest/v1/rpc/public_book_chain", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: cfg.key,
          Authorization: "Bearer " + cfg.key,
        },
        body: JSON.stringify(payload),
      })
        .then(function (r) {
          return r.json().then(
            function (j) {
              return { status: r.status, json: j };
            },
            function () {
              return { status: r.status, json: null };
            }
          );
        })
        .then(function (res) {
          var j = res.json || {};
          if (j && j.ok === true) {
            var okMsg = isRu
              ? "Запись подтверждена. Ждём вас в салоне."
              : isEn
                ? "Booking confirmed. See you at the salon."
                : isFi
                  ? "Varaus vahvistettu. Nähdään salongilla."
                  : "Broneering kinnitatud. Täname!";
            window.alert(okMsg);
            bookingForm.reset();
            if (chainApi && chainApi.clear) chainApi.clear();
            invalidateMonthCache();
            clearSelection();
            renderCalendar();
            return { handled: true, ok: true };
          }
          /* Supabase вернула ошибку схемы (RLS/FK/функция не найдена) — отмечаем как «не
           * обработано», чтобы сработал fallback mailto и заявка всё равно дошла. */
          if (!j || typeof j.ok === "undefined") return { handled: false };
          var fb = isRu
            ? "Не удалось забронировать. Выберите другое время или напишите нам."
            : "Booking failed. Please pick another time or contact us.";
          window.alert(chainHumanErrorMessage(j.error, (j.message || fb)));
          return { handled: true, ok: false };
        })
        .catch(function () {
          return { handled: false };
        });
    }

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

      var nameVal = (bookingForm.querySelector('[name="name"]') || { value: "" }).value.trim();
      var phoneVal = (bookingForm.querySelector('[name="phone"]') || { value: "" }).value.trim();
      var noteVal = (bookingForm.querySelector("[data-field-services-detail]") || { value: "" }).value.trim();
      if (!nameVal) {
        var nameFieldEl = bookingForm.querySelector('[name="name"]');
        if (nameFieldEl) nameFieldEl.focus();
        return;
      }

      /* Супабейс RPC для мульти-сервис записи из корзины. Fallback на apiBooking/mailto,
       * если RPC недоступна или picked[] пуст. */
      trySubmitViaBookChain(nameVal, phoneVal, noteVal).then(function (res) {
        if (res && res.handled) return;
        continueLegacySubmit();
      });

      function continueLegacySubmit() {
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
      } /* end continueLegacySubmit */
    });
  }

  /* Tagasiside / отзыв: mailto salongi töömeilile modereerimiseks (sama aadress mis broneeringul) */
  var reviewForm = document.getElementById("review-form");
  if (reviewForm) {
    var langRev = (document.documentElement.getAttribute("lang") || "et").toLowerCase().slice(0, 2);
    if (langRev !== "ru" && langRev !== "et" && langRev !== "fi" && langRev !== "en") langRev = "et";
    var revMsg =
      langRev === "ru"
        ? {
            subject: "AlesSanna: отзыв (на модерацию)",
            name: "Имя",
            email: "Эл. почта",
            rating: "Оценка (звёзды)",
            message: "Текст отзыва",
            alertName: "Укажите имя.",
            alertMsg: "Напишите отзыв хотя бы в несколько слов.",
            alertEmail: "Проверьте формат e-mail или оставьте поле пустым.",
          }
        : langRev === "en"
          ? {
              subject: "AlesSanna: review (moderation)",
              name: "Name",
              email: "Email",
              rating: "Rating (stars)",
              message: "Your feedback",
              alertName: "Please enter your name.",
              alertMsg: "Please write a few words of feedback.",
              alertEmail: "Check the email format or leave the field empty.",
            }
          : langRev === "fi"
            ? {
                subject: "AlesSanna: palaute (moderaatio)",
                name: "Nimi",
                email: "Sähköposti",
                rating: "Arvio (tähdet)",
                message: "Palautteesi",
                alertName: "Kirjoita nimi.",
                alertMsg: "Kirjoita palaute vähintään muutamalla sanalla.",
                alertEmail: "Tarkista sähköpostin muoto tai jätä kenttä tyhjäksi.",
              }
            : {
                subject: "AlesSanna: tagasiside (modereerimiseks)",
                name: "Nimi",
                email: "E-post",
                rating: "Hinnang (tärnid)",
                message: "Tagasiside tekst",
                alertName: "Palun sisestage nimi.",
                alertMsg: "Palun kirjutage tagasiside vähemalt mõne sõnaga.",
                alertEmail: "Kontrollige e-posti vormingut või jätke väli tühjaks.",
              };

    reviewForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var nameEl = reviewForm.querySelector('[name="review_name"]');
      var emailEl = reviewForm.querySelector('[name="review_email"]');
      var ratingEl = reviewForm.querySelector('[name="review_rating"]');
      var msgEl = reviewForm.querySelector('[name="review_message"]');
      var name = nameEl ? nameEl.value.trim() : "";
      var email = emailEl ? emailEl.value.trim() : "";
      var rating = ratingEl && ratingEl.value ? ratingEl.value : "";
      var msg = msgEl ? msgEl.value.trim() : "";
      if (!name) {
        window.alert(revMsg.alertName);
        if (nameEl) nameEl.focus();
        return;
      }
      if (msg.length < 8) {
        window.alert(revMsg.alertMsg);
        if (msgEl) msgEl.focus();
        return;
      }
      if (email && email.indexOf("@") < 1) {
        window.alert(revMsg.alertEmail);
        if (emailEl) emailEl.focus();
        return;
      }
      var lines = [
        revMsg.name + ": " + name,
        revMsg.email + ": " + (email || "—"),
        revMsg.rating + ": " + rating + "/5",
        "",
        revMsg.message + ":",
        msg,
      ];
      var subject = encodeURIComponent(revMsg.subject);
      var body = encodeURIComponent(lines.join("\n"));
      window.location.href = "mailto:alessanna.ilusalong@gmail.com?subject=" + subject + "&body=" + body;
    });
  }
})();

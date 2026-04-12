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
 *      синхронизирует select[name=service] и скрытое services_detail; #meistrid — выбор мастера.
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

  /* Вкладки: переключение только внутри своей <section> (ET + RU + динамический Supabase-mount) */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".tab-btn");
    if (!btn) return;
    var targetId = btn.getAttribute("aria-controls");
    if (!targetId) return;
    var section = btn.closest("section");
    if (!section) return;

    section.querySelectorAll(".tab-btn").forEach(function (b) {
      b.classList.remove("is-active");
      b.setAttribute("aria-selected", "false");
    });
    btn.classList.add("is-active");
    btn.setAttribute("aria-selected", "true");

    section.querySelectorAll(".tab-panel").forEach(function (panel) {
      var show = panel.id === targetId;
      panel.hidden = !show;
      panel.classList.toggle("is-active", show);
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

    /** Meistrid teenusekategooriate järgi (sama loogika mis #meistrid plokis) */
    var CATEGORY_TO_MASTER_IDS = {
      "hair-cut": ["galina", "irina", "viktoria", "anne"],
      "hair-color": ["galina", "irina", "viktoria", "anne"],
      perm: ["galina", "irina", "viktoria", "anne"],
      styling: ["galina", "irina", "viktoria", "anne"],
      manicure: ["alesja", "aljona", "viktoria"],
      pedicure: ["alesja", "aljona", "viktoria"],
      "brows-lashes": ["irina", "anne", "alesja"],
    };

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
    for (var mi = 0; mi < MASTERS_PICK.length; mi++) {
      nameToId[MASTERS_PICK[mi].name.toLowerCase()] = MASTERS_PICK[mi].id;
    }

    var picked = [];

    function pickKey(panelId, label) {
      return panelId + "|" + label.trim();
    }

    function masterNameById(id) {
      for (var i = 0; i < MASTERS_PICK.length; i++) {
        if (MASTERS_PICK[i].id === id) return MASTERS_PICK[i].name;
      }
      return UI.masterNone;
    }

    function setMasterDisplayText(text) {
      if (masterDisplay) masterDisplay.textContent = text || UI.masterNone;
    }

    function mastersForPickedCategories() {
      var set = {};
      for (var i = 0; i < picked.length; i++) {
        var ids = CATEGORY_TO_MASTER_IDS[picked[i].category];
        if (ids && ids.length) {
          for (var j = 0; j < ids.length; j++) set[ids[j]] = true;
        } else {
          for (var k = 0; k < MASTERS_PICK.length; k++) set[MASTERS_PICK[k].id] = true;
        }
      }
      var out = [];
      for (var id in set) {
        if (Object.prototype.hasOwnProperty.call(set, id)) out.push(id);
      }
      out.sort(function (a, b) {
        return masterNameById(a).localeCompare(masterNameById(b), undefined, { sensitivity: "base" });
      });
      return out;
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
      serviceSelect.value = picked[picked.length - 1].category;
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
      updateDock();
      renderMasterChips();
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
      var category = panel.getAttribute("data-pick-category") || PANEL_TO_SERVICE[panel.id];
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
        picked.push({ key: key, label: label, price: price, category: category });
      }
      syncFormCategory();
      renderList();
    }

    function decoratePickRows() {
      teenused.querySelectorAll(".menu-list li").forEach(function (li) {
        if (li.classList.contains("menu-subhead") || li.classList.contains("menu-section-title")) return;
        var nameSpan = li.querySelector("span:not(.price)");
        var priceEl = li.querySelector(".price");
        if (!nameSpan || !priceEl) return;
        var panel = li.closest(".tab-panel");
        if (!panel) return;
        var cat = panel.getAttribute("data-pick-category") || PANEL_TO_SERVICE[panel.id];
        if (!cat) return;
        li.classList.add("menu-pick-row");
        li.setAttribute("role", "button");
        li.tabIndex = 0;
        li.setAttribute("data-pick-key", pickKey(panel.id, nameSpan.textContent.trim()));
      });
    }

    decoratePickRows();

    if (!teenused._teenusedPickDelegation) {
      teenused._teenusedPickDelegation = true;
      teenused.addEventListener("click", function (e) {
        var li = e.target.closest(".menu-list li.menu-pick-row");
        if (!li || !teenused.contains(li)) return;
        togglePick(li);
      });
      teenused.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        var li = e.target.closest(".menu-list li.menu-pick-row");
        if (!li || !teenused.contains(li)) return;
        e.preventDefault();
        togglePick(li);
      });
    }

    window.addEventListener("teenused-supabase-ready", function () {
      decoratePickRows();
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

    var teamRoot = document.getElementById("meistrid");
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
            if (masterSelect && masterSelect.value === id) applyMaster("");
            else applyMaster(id);
          });
          li.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
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

    var SLOT_POOL = ["10:00", "11:30", "13:00", "14:30", "16:00", "17:30"];

    var apiBooking = false;
    var serviceIdBySlug = {};
    var monthDays = null;
    var monthCacheKey = "";

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

    /**
     * Возвращает { tier, slots } для ячейки календаря.
     * tier: locked | off | none | soft | busy | featured — соответствует классам .is-* в CSS.
     */
    function dayAvailability(masterId, y, m, d) {
      if (!masterId) {
        return { tier: "locked", slots: [] };
      }
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
      var seed = hashSeed(masterId + "|" + dateKey(y, m, d));
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
      var masterVal = masterSelect.value;
      if (!masterVal) {
        if (notePrimary) notePrimary.textContent = MSGS.noTime;
        if (noteSecondary) noteSecondary.textContent = MSGS.pickMaster;
        return;
      }
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
      if (!apiBooking || !masterSelect.value || !serviceSelectEl.value) {
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
      var mid = masterSelect.value;
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
      var masterVal = masterSelect.value;
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

          if (!masterVal || info.tier === "locked") {
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

    function setupDemoMasters() {
      MASTERS.forEach(function (m) {
        var opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.name;
        masterSelect.appendChild(opt);
      });
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
          var prev = masterSelect.value;
          while (masterSelect.children.length > 1) {
            masterSelect.removeChild(masterSelect.lastChild);
          }
          for (var ej = 0; ej < emps.length; ej++) {
            var o = document.createElement("option");
            o.value = String(emps[ej].id);
            o.textContent = emps[ej].name;
            masterSelect.appendChild(o);
          }
          var stillValid = false;
          for (var k = 1; k < masterSelect.options.length; k++) {
            if (masterSelect.options[k].value === prev) {
              stillValid = true;
              break;
            }
          }
          masterSelect.value = stillValid ? prev : emps.length ? String(emps[0].id) : "";
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
    });

    serviceSelectEl.addEventListener("change", function () {
      if (apiBooking) {
        refillMastersForCurrentService().then(function () {
          invalidateMonthCache();
          clearSelection();
          renderCalendar();
        });
      } else {
        invalidateMonthCache();
        clearSelection();
        renderCalendar();
      }
    });

    /* Сервер: POST /api/public/bookings; иначе mailto (статический сайт) */
    bookingForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!masterSelect.value) {
        masterSelect.focus();
        return;
      }
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
            employeeId: Number(masterSelect.value),
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

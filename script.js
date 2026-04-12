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
 *   5) .reveal: IntersectionObserver добавляет .is-visible при появлении в зоне видимости.
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
  var navLinks = document.querySelectorAll(".nav-list a, .nav-panel-wrap .nav-cta");
  var yearEl = document.getElementById("year");
  var mobileBar = document.querySelector(".mobile-book-bar");
  var mobileBookLink = mobileBar ? mobileBar.querySelector("a") : null;

  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  /** Прокрутка: подложка шапки + появление нижней кнопки «Запись» на телефоне */
  function onScroll() {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 40);
    if (mobileBar) {
      var showBar = window.scrollY > 320;
      mobileBar.classList.toggle("is-visible", showBar);
      if (mobileBookLink) {
        mobileBookLink.tabIndex = showBar ? 0 : -1;
      }
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /** Открытое мобильное меню: body.nav-open отключает прокрутку (см. styles.css) */
  function setNavOpen(open) {
    document.body.classList.toggle("nav-open", open);
  }

  if (navToggle && nav) {
    navToggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
      setNavOpen(open);
    });

    navLinks.forEach(function (link) {
      link.addEventListener("click", function () {
        nav.classList.remove("is-open");
        navToggle.setAttribute("aria-expanded", "false");
        setNavOpen(false);
      });
    });
  }

  /* Вкладки: aria-controls у кнопки = id панели; неактивные панели с атрибутом hidden */
  document.querySelectorAll(".tab-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var targetId = btn.getAttribute("aria-controls");
      if (!targetId) return;

      document.querySelectorAll(".tab-btn").forEach(function (b) {
        b.classList.remove("is-active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("is-active");
      btn.setAttribute("aria-selected", "true");

      document.querySelectorAll(".tab-panel").forEach(function (panel) {
        var show = panel.id === targetId;
        panel.hidden = !show;
        panel.classList.toggle("is-active", show);
      });
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

  /* Если чего-то не хватает в DOM — весь блок календаря не инициализируется */
  if (bookingSection && gridEl && titleEl && prevBtn && nextBtn && masterSelect && dateInput && timeSelect && bookingForm) {
    /* Язык страницы: ru.html → русские подписи в календаре и тема письма */
    var htmlLang = (document.documentElement.getAttribute("lang") || "et").toLowerCase().slice(0, 2);
    var isRu = htmlLang === "ru";

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
      return d + ". " + MONTHS_ET[m] + " " + y;
    }

    function monthTitle(y, m) {
      if (isRu) {
        return MONTHS_TITLE_RU[m] + " " + y;
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

    /**
     * Строит сетку: пустые ячейки до 1-го числа (понедельник = первый столбец),
     * затем кнопки по дням месяца. Замыкание (function (d) { ... })(day) фиксирует номер дня
     * для обработчика клика — иначе в цикле «var day» дал бы всем последнее значение.
     */
    function renderCalendar() {
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

    /* Первая option «Выберите мастера» уже в HTML; сюда дописываем имена */
    MASTERS.forEach(function (m) {
      var opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.name;
      masterSelect.appendChild(opt);
    });

    prevBtn.addEventListener("click", function () {
      if (prevBtn.disabled) return;
      viewM--;
      if (viewM < 0) {
        viewM = 11;
        viewY--;
      }
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
      clearSelection();
      renderCalendar();
    });

    masterSelect.addEventListener("change", function () {
      clearSelection();
      renderCalendar();
    });

    /* Проверка полей вручную (novalidate на форме); затем mailto с телом из FormData */
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
      var fd = new FormData(bookingForm);
      var lines = [];
      fd.forEach(function (val, key) {
        lines.push(key + ": " + val);
      });
      var subject = isRu ? encodeURIComponent("Запись AlesSanna") : encodeURIComponent("Broneering AlesSanna");
      var body = encodeURIComponent(lines.join("\n"));
      window.location.href = "mailto:alessanna.ilusalong@gmail.com?subject=" + subject + "&body=" + body;
    });

    renderCalendar();
  }
})();

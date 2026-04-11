const header = document.querySelector(".site-header");
const navToggle = document.querySelector(".nav-toggle");
const nav = document.querySelector(".site-nav");
const revealItems = document.querySelectorAll(".reveal");
const bookingForm = document.querySelector(".booking-form");
const calendarGrid = document.querySelector("[data-calendar-grid]");
const calendarTitle = document.querySelector("[data-calendar-title]");
const selectedDayLabel = document.querySelector("[data-selected-day]");
const selectedInfoLabel = document.querySelector("[data-selected-info]");
const bookingDateInput = document.querySelector("[data-booking-date]");
const bookingTimeSelect = document.querySelector("[data-booking-time]");
const bookingServiceSelect = document.querySelector("[data-service-select]");
const bookingMasterSelect = document.querySelector("[data-master-select]");
const calendarPrev = document.querySelector("[data-calendar-prev]");
const calendarNext = document.querySelector("[data-calendar-next]");
const servicesToggle = document.querySelector("[data-services-toggle]");
const servicesPanel = document.querySelector("[data-services-panel]");
const priceToggle = document.querySelector("[data-price-toggle]");
const pricePanel = document.querySelector("[data-price-panel]");
const locale = document.documentElement.lang.toLowerCase().startsWith("et") ? "et" : "ru";

const translations = {
  ru: {
    monthNamesTitle: [
      "Январь",
      "Февраль",
      "Март",
      "Апрель",
      "Май",
      "Июнь",
      "Июль",
      "Август",
      "Сентябрь",
      "Октябрь",
      "Ноябрь",
      "Декабрь",
    ],
    monthNamesDate: [
      "января",
      "февраля",
      "марта",
      "апреля",
      "мая",
      "июня",
      "июля",
      "августа",
      "сентября",
      "октября",
      "ноября",
      "декабря",
    ],
    buttonLabels: {
      soft: "Свободно",
      busy: "Почти занято",
      featured: "Лучшая дата",
      unavailable: "Нет времени",
    },
    noteLabels: {
      1: "1 окно",
      2: "2 окна",
      3: "3 окна",
      4: "4 окна",
      5: "5 окон",
      6: "6 окон",
      7: "7 окон",
    },
    selectedPrefix: "Доступно",
    timePlaceholder: "Выберите время",
    masterPlaceholder: "Выберите мастера",
    selectMasterInfo: "Выберите мастера, чтобы увидеть свободные даты",
    noSlots: "Нет свободного времени",
    noMasterSlots: "У выбранного мастера нет свободных окон в этом месяце",
    submitSuccess: "Заявка отправлена",
  },
  et: {
    monthNamesTitle: [
      "Jaanuar",
      "Veebruar",
      "Märts",
      "Aprill",
      "Mai",
      "Juuni",
      "Juuli",
      "August",
      "September",
      "Oktoober",
      "November",
      "Detsember",
    ],
    monthNamesDate: [
      "jaanuar",
      "veebruar",
      "märts",
      "aprill",
      "mai",
      "juuni",
      "juuli",
      "august",
      "september",
      "oktoober",
      "november",
      "detsember",
    ],
    buttonLabels: {
      soft: "Vabu aegu",
      busy: "Peaaegu täis",
      featured: "Soovitatud aeg",
      unavailable: "Aegu pole",
    },
    noteLabels: {
      1: "1 aeg",
      2: "2 aega",
      3: "3 aega",
      4: "4 aega",
      5: "5 aega",
      6: "6 aega",
      7: "7 aega",
    },
    selectedPrefix: "Saadaval",
    timePlaceholder: "Vali aeg",
    masterPlaceholder: "Vali meister",
    selectMasterInfo: "Vali meister, et näha vabu kuupäevi",
    noSlots: "Vabu aegu pole",
    noMasterSlots: "Valitud meistril ei ole selles kuus vabu aegu",
    submitSuccess: "Päring saadetud",
  },
};

const t = translations[locale];

if (navToggle && header && nav) {
  navToggle.addEventListener("click", () => {
    const isOpen = header.classList.toggle("menu-open");
    document.body.classList.toggle("menu-open", isOpen);
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      header.classList.remove("menu-open");
      document.body.classList.remove("menu-open");
      navToggle.setAttribute("aria-expanded", "false");
    });
  });
}

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.16,
    }
  );

  revealItems.forEach((item) => observer.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}

if (servicesToggle && servicesPanel && priceToggle && pricePanel) {
  const syncPanelHeight = (panel) => {
    panel.style.setProperty("--services-height", `${panel.scrollHeight}px`);
  };

  const refreshOpenPanel = (panel) => {
    syncPanelHeight(panel);
    window.requestAnimationFrame(() => syncPanelHeight(panel));
    window.setTimeout(() => syncPanelHeight(panel), 180);
    window.setTimeout(() => syncPanelHeight(panel), 720);
  };

  const updatePanelState = (panel, toggle, isOpen) => {
    syncPanelHeight(panel);
    panel.classList.toggle("is-open", isOpen);
    toggle.classList.toggle("is-open", isOpen);
    toggle.setAttribute("aria-expanded", String(isOpen));
    panel.setAttribute("aria-hidden", String(!isOpen));

    if (isOpen) {
      refreshOpenPanel(panel);
    }
  };

  const scrollToHashTarget = (hashValue) => {
    if (!hashValue) {
      return;
    }

    const target = document.querySelector(hashValue);

    if (target) {
      window.setTimeout(() => {
        target.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 180);
    }
  };

  const openServicesPanel = (hashValue = "#services") => {
    if (!servicesPanel.classList.contains("is-open")) {
      updatePanelState(servicesPanel, servicesToggle, true);
    } else {
      refreshOpenPanel(servicesPanel);
    }

    if (hashValue) {
      scrollToHashTarget(hashValue);
    }
  };

  const openPricePanel = (hashValue = "#services-price-panel") => {
    if (!pricePanel.classList.contains("is-open")) {
      updatePanelState(pricePanel, priceToggle, true);
    } else {
      refreshOpenPanel(pricePanel);
    }

    if (hashValue) {
      scrollToHashTarget(hashValue);
    }
  };

  const toggleServices = () => {
    const shouldOpen = !servicesPanel.classList.contains("is-open");
    updatePanelState(servicesPanel, servicesToggle, shouldOpen);

    if (shouldOpen) {
      scrollToHashTarget("#services");
    }
  };

  const togglePrice = () => {
    const shouldOpen = !pricePanel.classList.contains("is-open");
    updatePanelState(pricePanel, priceToggle, shouldOpen);

    if (shouldOpen) {
      scrollToHashTarget("#services-price-panel");
    }
  };

  servicesToggle.addEventListener("click", toggleServices);
  priceToggle.addEventListener("click", togglePrice);

  document.querySelectorAll('a[href="#services"], a[href^="#price-"]').forEach((link) => {
    link.addEventListener("click", () => {
      const targetHash = link.getAttribute("href");

      if (targetHash === "#services") {
        openServicesPanel(targetHash);
      }

      if (targetHash.startsWith("#price-")) {
        openPricePanel(targetHash);
      }
    });
  });

  window.addEventListener("resize", () => {
    if (servicesPanel.classList.contains("is-open")) {
      refreshOpenPanel(servicesPanel);
    }

    if (pricePanel.classList.contains("is-open")) {
      refreshOpenPanel(pricePanel);
    }
  });

  window.addEventListener("load", () => {
    if (servicesPanel.classList.contains("is-open")) {
      refreshOpenPanel(servicesPanel);
    }

    if (pricePanel.classList.contains("is-open")) {
      refreshOpenPanel(pricePanel);
    }
  });

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (servicesPanel.classList.contains("is-open")) {
        refreshOpenPanel(servicesPanel);
      }

      if (pricePanel.classList.contains("is-open")) {
        refreshOpenPanel(pricePanel);
      }
    });
  }

  window.addEventListener("hashchange", () => {
    if (window.location.hash === "#services") {
      openServicesPanel(window.location.hash);
    }

    if (window.location.hash === "#services-price-panel" || window.location.hash.startsWith("#price-")) {
      openPricePanel(window.location.hash);
    }
  });

  if (window.location.hash === "#services") {
    updatePanelState(servicesPanel, servicesToggle, true);
    scrollToHashTarget(window.location.hash);
  }

  if (window.location.hash === "#services-price-panel" || window.location.hash.startsWith("#price-")) {
    updatePanelState(pricePanel, priceToggle, true);
    scrollToHashTarget(window.location.hash);
  }
}

if (calendarGrid && calendarTitle) {
  const currentDate = new Date();
  const selectedDate = {
    year: currentDate.getFullYear(),
    month: currentDate.getMonth(),
    day: null,
  };
  const minVisibleYear = currentDate.getFullYear();
  const minVisibleMonth = currentDate.getMonth();
  let visibleYear = currentDate.getFullYear();
  let visibleMonth = currentDate.getMonth();
  let selectedButton = null;

  const specialistGroups = {
    nails: {
      label: "küünetehnikud",
      masters: ["Aljona", "Alesja"],
    },
    hair: {
      label: "juuksurid",
      masters: ["Galina", "Irina", "Viktoria", "Anne"],
    },
  };

  const nailServiceValues = new Set(["brows-lashes", "manicure", "pedicure"]);

  const masterProfiles = {
    Aljona: { seed: 1, slots: ["09:30", "11:30", "14:00", "16:30"] },
    Alesja: { seed: 3, slots: ["10:00", "12:30", "15:00", "17:30"] },
    Galina: { seed: 2, slots: ["09:00", "11:00", "13:30", "16:00"] },
    Irina: { seed: 4, slots: ["10:00", "12:00", "14:30", "17:00"] },
    Viktoria: { seed: 6, slots: ["09:30", "12:00", "15:00", "18:00"] },
    Anne: { seed: 8, slots: ["10:30", "13:00", "16:00", "18:30"] },
  };

  const formatDate = (dayNumber, monthNumber = visibleMonth, yearNumber = visibleYear) =>
    locale === "et"
      ? `${dayNumber}. ${t.monthNamesDate[monthNumber]} ${yearNumber}`
      : `${dayNumber} ${t.monthNamesDate[monthNumber]} ${yearNumber}`;

  const getServiceGroupKey = () => (nailServiceValues.has(bookingServiceSelect?.value) ? "nails" : "hair");

  const getSelectedMaster = () => bookingMasterSelect?.value || "";

  const createDayData = (state, slots, buttonLabel = t.buttonLabels[state]) => ({
    state,
    buttonLabel,
    noteLabel: slots.length ? t.noteLabels[slots.length] || `${slots.length}` : t.noSlots,
    slots,
  });

  const resetSelectedDate = () => {
    selectedDate.year = visibleYear;
    selectedDate.month = visibleMonth;
    selectedDate.day = null;
  };

  const populateMasterSelect = () => {
    if (!bookingMasterSelect) {
      return;
    }

    const group = specialistGroups[getServiceGroupKey()];
    bookingMasterSelect.innerHTML = "";

    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = t.masterPlaceholder;
    placeholderOption.disabled = true;
    placeholderOption.selected = true;
    bookingMasterSelect.append(placeholderOption);

    const groupElement = document.createElement("optgroup");
    groupElement.label = group.label;

    group.masters.forEach((masterName) => {
      const option = document.createElement("option");
      option.value = masterName;
      option.textContent = masterName;
      groupElement.append(option);
    });

    bookingMasterSelect.append(groupElement);
  };

  const getMasterSlots = (masterName, dayNumber, monthNumber = visibleMonth, yearNumber = visibleYear) => {
    const profile = masterProfiles[masterName];

    if (!profile) {
      return [];
    }

    const weekday = new Date(yearNumber, monthNumber, dayNumber).getDay();

    if (weekday === 0) {
      return [];
    }

    const marker = (dayNumber + monthNumber + weekday + profile.seed) % 9;

    if (marker === 0 || marker === 5) {
      return [];
    }

    const slotCount =
      marker % 4 === 0 ? 1 : marker % 3 === 0 ? 2 : Math.min(profile.slots.length, 3 + ((dayNumber + profile.seed) % 2));

    return profile.slots.slice(0, slotCount);
  };

  const getDayData = (dayNumber, monthNumber = visibleMonth, yearNumber = visibleYear) => {
    const masterName = getSelectedMaster();

    if (!masterName) {
      return createDayData("unavailable", [], t.buttonLabels.unavailable);
    }

    const slots = getMasterSlots(masterName, dayNumber, monthNumber, yearNumber);

    if (!slots.length) {
      return createDayData("unavailable", [], t.buttonLabels.unavailable);
    }

    const state = slots.length >= 4 ? "soft" : slots.length === 1 ? "busy" : "featured";
    return createDayData(state, slots);
  };

  const updateTimeOptions = (dayData) => {
    if (!bookingTimeSelect) {
      return;
    }

    bookingTimeSelect.innerHTML = "";

    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = dayData?.slots?.length ? t.timePlaceholder : getSelectedMaster() ? t.noSlots : t.masterPlaceholder;
    placeholderOption.disabled = true;
    placeholderOption.selected = true;
    bookingTimeSelect.append(placeholderOption);

    if (!dayData?.slots?.length) {
      return;
    }

    dayData.slots.forEach((slot) => {
      const option = document.createElement("option");
      option.value = slot;
      option.textContent = slot;
      bookingTimeSelect.append(option);
    });
  };

  const clearSelection = (message = t.selectMasterInfo) => {
    if (selectedButton) {
      selectedButton.classList.remove("is-selected");
    }

    selectedButton = null;
    selectedDate.day = null;

    if (selectedDayLabel) {
      selectedDayLabel.textContent = t.noSlots;
    }

    if (selectedInfoLabel) {
      selectedInfoLabel.textContent = message;
    }

    if (bookingDateInput) {
      bookingDateInput.value = "";
    }

    updateTimeOptions(null);
  };

  const updateSelection = (button, dayNumber, monthNumber = visibleMonth, yearNumber = visibleYear) => {
    const dayData = getDayData(dayNumber, monthNumber, yearNumber);

    if (!dayData.slots.length) {
      return;
    }

    if (selectedButton) {
      selectedButton.classList.remove("is-selected");
    }

    selectedButton = button;
    selectedButton.classList.add("is-selected");
    selectedDate.year = yearNumber;
    selectedDate.month = monthNumber;
    selectedDate.day = dayNumber;

    const formattedDate = formatDate(dayNumber, monthNumber, yearNumber);
    const slotsText = dayData.slots.join(", ");

    if (selectedDayLabel) {
      selectedDayLabel.textContent = formattedDate;
    }

    if (selectedInfoLabel) {
      selectedInfoLabel.textContent = `${t.selectedPrefix} ${dayData.noteLabel}: ${slotsText}`;
    }

    if (bookingDateInput) {
      bookingDateInput.value = formattedDate;
    }

    updateTimeOptions(dayData);
  };

  const renderCalendar = () => {
    const firstDay = new Date(visibleYear, visibleMonth, 1);
    const lastDay = new Date(visibleYear, visibleMonth + 1, 0);
    const isCurrentMonth = visibleYear === minVisibleYear && visibleMonth === minVisibleMonth;
    const startOffset = (firstDay.getDay() + 6) % 7;
    const totalCells = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7;

    selectedButton = null;
    calendarGrid.innerHTML = "";
    calendarTitle.textContent = `${t.monthNamesTitle[visibleMonth]} ${visibleYear}`;

    if (calendarPrev) {
      calendarPrev.disabled = isCurrentMonth;
      calendarPrev.setAttribute("aria-disabled", String(isCurrentMonth));
    }

    for (let cellIndex = 0; cellIndex < totalCells; cellIndex += 1) {
      const dayNumber = cellIndex - startOffset + 1;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "calendar-day";

      if (dayNumber < 1 || dayNumber > lastDay.getDate()) {
        button.classList.add("is-outside");
        button.tabIndex = -1;
        calendarGrid.append(button);
        continue;
      }

      const dayData = getDayData(dayNumber, visibleMonth, visibleYear);
      const slotsText = dayData.slots.length ? dayData.slots.join(", ") : t.noSlots;

      button.dataset.day = String(dayNumber);
      button.classList.add(`is-${dayData.state}`);
      button.disabled = !dayData.slots.length;
      button.setAttribute("aria-disabled", String(!dayData.slots.length));
      button.innerHTML = `
        <span class="calendar-date">${dayNumber}</span>
        <span class="calendar-meta">${dayData.buttonLabel}</span>
        <span class="calendar-slots">${slotsText}</span>
      `;

      button.addEventListener("click", () => updateSelection(button, dayNumber, visibleMonth, visibleYear));
      calendarGrid.append(button);

      const shouldSelectSavedDay =
        dayData.slots.length &&
        selectedDate.day === dayNumber &&
        selectedDate.month === visibleMonth &&
        selectedDate.year === visibleYear;

      if (shouldSelectSavedDay) {
        updateSelection(button, dayNumber, visibleMonth, visibleYear);
      }
    }

    if (!selectedButton) {
      const currentDayButton = isCurrentMonth
        ? calendarGrid.querySelector(`.calendar-day[data-day="${currentDate.getDate()}"]:not(:disabled)`)
        : null;
      const firstAvailableButton = currentDayButton || calendarGrid.querySelector(".calendar-day:not(.is-outside):not(:disabled)");
      const firstAvailableDay = firstAvailableButton?.querySelector(".calendar-date")?.textContent;

      if (firstAvailableButton && firstAvailableDay) {
        updateSelection(firstAvailableButton, Number(firstAvailableDay), visibleMonth, visibleYear);
      } else {
        clearSelection(getSelectedMaster() ? t.noMasterSlots : t.selectMasterInfo);
      }
    }
  };

  const moveCalendarMonth = (offset) => {
    const nextVisibleMonth = new Date(visibleYear, visibleMonth + offset, 1);
    const minVisibleDate = new Date(minVisibleYear, minVisibleMonth, 1);

    if (nextVisibleMonth < minVisibleDate) {
      return;
    }

    visibleYear = nextVisibleMonth.getFullYear();
    visibleMonth = nextVisibleMonth.getMonth();
    resetSelectedDate();
    renderCalendar();
  };

  bookingServiceSelect?.addEventListener("change", () => {
    populateMasterSelect();
    resetSelectedDate();
    renderCalendar();
  });

  bookingMasterSelect?.addEventListener("change", () => {
    resetSelectedDate();
    renderCalendar();
  });

  calendarPrev?.addEventListener("click", () => moveCalendarMonth(-1));
  calendarNext?.addEventListener("click", () => moveCalendarMonth(1));

  populateMasterSelect();
  renderCalendar();
}

if (bookingForm) {
  bookingForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const button = bookingForm.querySelector("button");

    if (button) {
      const initialText = button.textContent;
      button.textContent = t.submitSuccess;
      button.setAttribute("disabled", "true");

      window.setTimeout(() => {
        button.textContent = initialText;
        button.removeAttribute("disabled");
        bookingForm.reset();
      }, 2200);
    }
  });
}

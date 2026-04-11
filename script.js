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

  const formatDate = (dayNumber, monthNumber = visibleMonth, yearNumber = visibleYear) =>
    locale === "et"
      ? `${dayNumber}. ${t.monthNamesDate[monthNumber]} ${yearNumber}`
      : `${dayNumber} ${t.monthNamesDate[monthNumber]} ${yearNumber}`;

  const createDayData = (state, slots, buttonLabel = t.buttonLabels[state]) => ({
    state,
    buttonLabel,
    noteLabel: t.noteLabels[slots.length] || `${slots.length}`,
    slots,
  });

  const availabilityMap = {
    2: createDayData("soft", ["10:00", "12:00", "15:30", "17:00", "17:30", "18:00"]),
    4: createDayData("busy", ["14:00", "18:00"]),
    7: createDayData("featured", ["11:00", "13:00", "17:00"]),
    9: createDayData("soft", ["09:30", "12:30", "16:30", "17:30", "18:00"]),
    12: createDayData("featured", ["11:00", "13:30", "16:00", "18:30"]),
    15: createDayData("busy", ["17:00"]),
    18: createDayData("soft", ["10:00", "11:30", "15:00", "16:30", "17:30", "18:00", "18:30"]),
    21: createDayData("featured", ["10:30", "14:00", "17:30"]),
    24: createDayData("busy", ["12:00", "16:00"]),
    27: createDayData("soft", ["09:00", "13:00", "15:00", "17:00", "18:00"]),
    30: createDayData("featured", ["10:00", "12:30", "15:00"]),
  };

  const defaultSlots = {
    soft: ["10:00", "14:00", "17:00", "18:00"],
    busy: ["12:00", "18:00"],
    featured: ["10:30", "13:00", "16:30"],
  };

  const getDayData = (dayNumber, monthNumber = visibleMonth, yearNumber = visibleYear) => {
    const customDayData =
      monthNumber === currentDate.getMonth() && yearNumber === currentDate.getFullYear()
        ? availabilityMap[dayNumber]
        : null;

    if (customDayData) {
      return customDayData;
    }

    const state = (dayNumber + monthNumber) % 6 === 0 ? "busy" : (dayNumber + monthNumber) % 4 === 0 ? "featured" : "soft";
    return createDayData(state, defaultSlots[state]);
  };

  const updateTimeOptions = (dayData) => {
    if (!bookingTimeSelect) {
      return;
    }

    bookingTimeSelect.innerHTML = "";

    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = t.timePlaceholder;
    placeholderOption.disabled = true;
    placeholderOption.selected = true;
    bookingTimeSelect.append(placeholderOption);

    dayData.slots.forEach((slot) => {
      const option = document.createElement("option");
      option.value = slot;
      option.textContent = slot;
      bookingTimeSelect.append(option);
    });
  };

  const updateSelection = (button, dayNumber, monthNumber = visibleMonth, yearNumber = visibleYear) => {
    if (selectedButton) {
      selectedButton.classList.remove("is-selected");
    }

    const dayData = getDayData(dayNumber, monthNumber, yearNumber);

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
      const slotsText = dayData.slots.join(", ");

      button.dataset.day = String(dayNumber);
      button.classList.add(`is-${dayData.state}`);
      button.innerHTML = `
        <span class="calendar-date">${dayNumber}</span>
        <span class="calendar-meta">${dayData.buttonLabel}</span>
        <span class="calendar-slots">${slotsText}</span>
      `;

      button.addEventListener("click", () => updateSelection(button, dayNumber, visibleMonth, visibleYear));
      calendarGrid.append(button);

      const shouldSelectSavedDay =
        selectedDate.day === dayNumber &&
        selectedDate.month === visibleMonth &&
        selectedDate.year === visibleYear;

      if (shouldSelectSavedDay || (!selectedDate.day && dayNumber === currentDate.getDate())) {
        updateSelection(button, dayNumber, visibleMonth, visibleYear);
      }
    }

    if (!selectedButton) {
      const currentDayButton = isCurrentMonth
        ? calendarGrid.querySelector(`.calendar-day[data-day="${currentDate.getDate()}"]`)
        : null;
      const firstAvailableButton = currentDayButton || calendarGrid.querySelector(".calendar-day:not(.is-outside)");
      const firstAvailableDay = firstAvailableButton?.querySelector(".calendar-date")?.textContent;

      if (firstAvailableButton && firstAvailableDay) {
        updateSelection(firstAvailableButton, Number(firstAvailableDay), visibleMonth, visibleYear);
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
    renderCalendar();
  };

  calendarPrev?.addEventListener("click", () => moveCalendarMonth(-1));
  calendarNext?.addEventListener("click", () => moveCalendarMonth(1));

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

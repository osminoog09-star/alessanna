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
  const updatePanelState = (panel, toggle, isOpen) => {
    panel.style.setProperty("--services-height", `${panel.scrollHeight}px`);
    panel.classList.toggle("is-open", isOpen);
    toggle.classList.toggle("is-open", isOpen);
    toggle.setAttribute("aria-expanded", String(isOpen));
    panel.setAttribute("aria-hidden", String(!isOpen));
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
      servicesPanel.style.setProperty("--services-height", `${servicesPanel.scrollHeight}px`);
    }

    if (hashValue) {
      scrollToHashTarget(hashValue);
    }
  };

  const openPricePanel = (hashValue = "#services-price-panel") => {
    if (!pricePanel.classList.contains("is-open")) {
      updatePanelState(pricePanel, priceToggle, true);
    } else {
      pricePanel.style.setProperty("--services-height", `${pricePanel.scrollHeight}px`);
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
      servicesPanel.style.setProperty("--services-height", `${servicesPanel.scrollHeight}px`);
    }

    if (pricePanel.classList.contains("is-open")) {
      pricePanel.style.setProperty("--services-height", `${pricePanel.scrollHeight}px`);
    }
  });

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
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const totalCells = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7;

  const formatDate = (dayNumber) =>
    locale === "et"
      ? `${dayNumber}. ${t.monthNamesDate[month]}`
      : `${dayNumber} ${t.monthNamesDate[month]}`;

  const createDayData = (state, slotsCount, slots, buttonLabel = t.buttonLabels[state]) => ({
    state,
    buttonLabel,
    noteLabel: t.noteLabels[slotsCount],
    slots,
  });

  const availabilityMap = {
    2: createDayData("soft", 6, "10:00, 12:00, 15:30"),
    4: createDayData("busy", 2, "14:00, 18:00"),
    7: createDayData("featured", 3, "11:00, 13:00, 17:00"),
    9: createDayData("soft", 5, "09:30, 12:30, 16:30"),
    12: createDayData("featured", 4, "11:00, 13:30, 16:00, 18:30"),
    15: createDayData("busy", 1, "19:00"),
    18: createDayData("soft", 7, "10:00, 11:30, 15:00"),
    21: createDayData("featured", 3, "10:30, 14:00, 17:30"),
    24: createDayData("busy", 2, "12:00, 16:00"),
    27: createDayData("soft", 5, "09:00, 13:00, 18:00"),
    30: createDayData("featured", 3, "10:00, 12:30, 15:00"),
  };

  let selectedButton = null;

  const updateSelection = (button, dayNumber) => {
    if (selectedButton) {
      selectedButton.classList.remove("is-selected");
    }

    const dayData = availabilityMap[dayNumber] || createDayData("soft", 3, "10:00, 13:00, 17:00");

    selectedButton = button;
    selectedButton.classList.add("is-selected");

    const formattedDate = formatDate(dayNumber);

    if (selectedDayLabel) {
      selectedDayLabel.textContent = formattedDate;
    }

    if (selectedInfoLabel) {
      selectedInfoLabel.textContent = `${t.selectedPrefix} ${dayData.noteLabel}: ${dayData.slots}`;
    }

    if (bookingDateInput) {
      bookingDateInput.value = formattedDate;
    }
  };

  calendarGrid.innerHTML = "";
  calendarTitle.textContent = `${t.monthNamesTitle[month]} ${year}`;

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

    const dayData =
      availabilityMap[dayNumber] ||
      createDayData(
        dayNumber % 5 === 0 ? "busy" : "soft",
        dayNumber % 5 === 0 ? 2 : 4,
        dayNumber % 5 === 0 ? "12:00, 18:00" : "10:00, 14:00, 17:00"
      );

    button.classList.add(`is-${dayData.state}`);
    button.innerHTML = `
      <span class="calendar-date">${dayNumber}</span>
      <span class="calendar-meta">${dayData.buttonLabel}</span>
      <span class="calendar-slots">${dayData.slots}</span>
    `;

    button.addEventListener("click", () => updateSelection(button, dayNumber));
    calendarGrid.append(button);

    if (dayNumber === 12) {
      updateSelection(button, dayNumber);
    }
  }
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

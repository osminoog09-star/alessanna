/**
 * work.html — phone login (client-only) + role-based CRM demo.
 */
(function () {
  "use strict";

  var SESSION_KEY = "alessanna_work_session";
  var USERS_KEY = "alessanna_work_user_directory";
  var EMPLOYEES_KEY = "alessanna_work_employees";
  var SERVICES_KEY = "alessanna_work_services";
  var BOOKINGS_KEY = "alessanna_work_bookings";

  /** Default directory — edit here or use admin UI to add users */
  var SEED_USERS = [
    { name: "Admin", phone: "55686845", role: "admin" },
    { name: "Manager", phone: "12345678", role: "manager" },
  ];

  var SEED_EMPLOYEES = [
    { name: "Galina", role: "Color specialist" },
    { name: "Irina", role: "Stylist" },
    { name: "Viktoria", role: "Nail tech" },
    { name: "Anne", role: "Manager" },
  ];

  var SEED_SERVICES = [
    { name: "Lõikus", price: "35 €" },
    { name: "Värvimine", price: "85 €" },
    { name: "Maniküür", price: "35 €" },
    { name: "Pediküür", price: "45 €" },
  ];

  var mock = {
    stats: { bookingsToday: 0, revenueTodayCents: 0, upcoming: 0 },
    bookings: [],
    nextBookingId: 1,
    employees: [],
    services: [],
  };

  var defaultBookings = [
    { id: 1, client: "Mari T.", service: "Lõikus", dateStr: "2026-04-12", timeStr: "10:00", staff: "Galina" },
    { id: 2, client: "Liis K.", service: "Värvimine", dateStr: "2026-04-12", timeStr: "11:30", staff: "Irina" },
    { id: 3, client: "Kadri P.", service: "Maniküür", dateStr: "2026-04-12", timeStr: "14:00", staff: "Galina" },
    { id: 4, client: "Annika S.", service: "Pediküür", dateStr: "2026-04-12", timeStr: "15:30", staff: "Viktoria" },
  ];

  var calendarView = { y: 0, m: 0 };
  var selectedDateStr = null;

  function $(sel) {
    return document.querySelector(sel);
  }

  function normalizePhone(p) {
    return String(p || "").replace(/\D/g, "");
  }

  function loadJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback.slice();
      var o = JSON.parse(raw);
      return Array.isArray(o) && o.length ? o : fallback.slice();
    } catch (e) {
      return fallback.slice();
    }
  }

  function saveJson(key, arr) {
    localStorage.setItem(key, JSON.stringify(arr));
  }

  function loadUsers() {
    return loadJson(USERS_KEY, SEED_USERS);
  }

  function saveUsers(arr) {
    saveJson(USERS_KEY, arr);
  }

  function loadEmployees() {
    return loadJson(EMPLOYEES_KEY, SEED_EMPLOYEES);
  }

  function saveEmployees(arr) {
    saveJson(EMPLOYEES_KEY, arr);
  }

  function loadServices() {
    return loadJson(SERVICES_KEY, SEED_SERVICES);
  }

  function saveServices(arr) {
    saveJson(SERVICES_KEY, arr);
  }

  function getSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function setSession(user) {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        name: user.name,
        phone: user.phone,
        role: user.role,
        staffName: user.staffName || null,
      })
    );
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function findUserByPhone(digits) {
    var list = loadUsers();
    var i;
    for (i = 0; i < list.length; i++) {
      if (normalizePhone(list[i].phone) === digits) return list[i];
    }
    return null;
  }

  function currentUser() {
    return getSession();
  }

  function isAdmin() {
    var u = currentUser();
    return u && u.role === "admin";
  }

  function isManager() {
    var u = currentUser();
    return u && u.role === "manager";
  }

  function isEmployee() {
    var u = currentUser();
    return u && u.role === "employee";
  }

  function canManageDirectory() {
    return isAdmin();
  }

  function canEditOrgData() {
    return isAdmin() || isManager();
  }

  function bookingsVisible() {
    var u = currentUser();
    if (!u) return [];
    if (u.role === "employee" && u.staffName) {
      return mock.bookings.filter(function (b) {
        return b.staff === u.staffName;
      });
    }
    return mock.bookings.slice();
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function todayISODate() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function isoDate(y, monthIndex, day) {
    return y + "-" + pad2(monthIndex + 1) + "-" + pad2(day);
  }

  function parsePriceToCents(priceStr) {
    var m = String(priceStr).match(/\d+/);
    if (!m) return 0;
    return Number(m[0]) * 100;
  }

  function weekdayMon0(date) {
    var w = date.getDay();
    return w === 0 ? 6 : w - 1;
  }

  function formatEur(cents) {
    return (cents / 100).toFixed(2).replace(".", ",") + " €";
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function loadBookingsFromStorage() {
    var raw = sessionStorage.getItem(BOOKINGS_KEY);
    if (!raw) {
      mock.bookings = defaultBookings.slice();
      mock.nextBookingId = 5;
      return;
    }
    try {
      var o = JSON.parse(raw);
      if (o.list && Array.isArray(o.list) && o.list.length) {
        mock.bookings = o.list.map(function (b) {
          if (!b.staff) b.staff = "Galina";
          return b;
        });
        mock.nextBookingId = Number(o.nextId) || mock.bookings.length + 1;
      } else {
        mock.bookings = defaultBookings.slice();
        mock.nextBookingId = 5;
      }
    } catch (e) {
      mock.bookings = defaultBookings.slice();
      mock.nextBookingId = 5;
    }
  }

  function saveBookingsToStorage() {
    sessionStorage.setItem(
      BOOKINGS_KEY,
      JSON.stringify({ list: mock.bookings, nextId: mock.nextBookingId })
    );
  }

  function recomputeStats() {
    var list = bookingsVisible();
    var today = todayISODate();
    var todayList = list.filter(function (b) {
      return b.dateStr === today;
    });
    mock.stats.bookingsToday = todayList.length;
    var cents = 0;
    todayList.forEach(function (b) {
      var svc = mock.services.find(function (s) {
        return s.name === b.service;
      });
      if (svc) cents += parsePriceToCents(svc.price);
    });
    mock.stats.revenueTodayCents = cents;
    mock.stats.upcoming = list.filter(function (b) {
      return b.dateStr >= today;
    }).length;
  }

  function sortBookingsList() {
    return bookingsVisible().sort(function (a, b) {
      if (a.dateStr !== b.dateStr) return a.dateStr.localeCompare(b.dateStr);
      return a.timeStr.localeCompare(b.timeStr);
    });
  }

  function bookingsForDay(dateStr) {
    return bookingsVisible()
      .filter(function (b) {
        return b.dateStr === dateStr;
      })
      .sort(function (a, b) {
        return a.timeStr.localeCompare(b.timeStr);
      });
  }

  function countBookingsOnDay(dateStr) {
    return bookingsVisible().filter(function (b) {
      return b.dateStr === dateStr;
    }).length;
  }

  function refreshMockTables() {
    mock.employees = loadEmployees();
    mock.services = loadServices();
  }

  function updateSessionUi() {
    var u = currentUser();
    var side = $("#sidebar-session");
    var n = $("#dash-user-name");
    var r = $("#dash-user-role");
    var adminPanel = $("#panel-admin-users");
    var displayName = (u && u.name) || "—";
    if (n) n.textContent = displayName;
    if (r) r.textContent = u && u.role ? u.role : "—";
    if (side) {
      if (u) {
        side.innerHTML =
          "<strong>" +
          escapeHtml(displayName) +
          "</strong><br /><span>" +
          escapeHtml(u.role || "") +
          "</span>";
      } else {
        side.textContent = "";
      }
    }
    if (adminPanel) adminPanel.hidden = !canManageDirectory();

    var navEmp = $("#nav-employees");
    var navSvc = $("#nav-services");
    if (navEmp) navEmp.hidden = !!isEmployee();
    if (navSvc) navSvc.hidden = !!isEmployee();

    var thStaff = $("#th-booking-staff");
    if (thStaff) thStaff.style.display = isEmployee() ? "none" : "";

    var hintE = $("#employees-hint");
    var hintS = $("#services-hint");
    if (hintE) {
      hintE.textContent = canEditOrgData()
        ? "Click a cell to edit. Changes save automatically."
        : "You can view the team list.";
    }
    if (hintS) {
      hintS.textContent = canEditOrgData()
        ? "Edit prices inline (managers and admins)."
        : "Read-only price list.";
    }
  }

  function showLogin() {
    clearSession();
    sessionStorage.removeItem(BOOKINGS_KEY);

    var login = $("#view-login");
    var app = $("#view-app");
    if (login) login.hidden = false;
    if (app) app.hidden = true;

    var dlg = $("#dlg-booking");
    if (dlg && dlg.open) dlg.close();

    var err = $("#login-error");
    var phoneIn = $("#login-phone");
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
    if (phoneIn) phoneIn.value = "";
  }

  function showApp() {
    refreshMockTables();
    loadBookingsFromStorage();
    recomputeStats();

    var login = $("#view-login");
    var app = $("#view-app");
    if (login) login.hidden = true;
    if (app) app.hidden = false;

    var now = new Date();
    calendarView.y = now.getFullYear();
    calendarView.m = now.getMonth();
    selectedDateStr = todayISODate();

    updateSessionUi();
    renderAdminUsers();
    renderDashboard();
    renderBookings();
    renderEmployees();
    renderServices();
    renderCalendar();
    renderSelectedDay();
    fillServiceSelect();
    fillStaffSelect();
    navigate("dashboard");
  }

  function renderAdminUsers() {
    var tbody = $("#admin-users-body");
    if (!tbody || !canManageDirectory()) return;
    var list = loadUsers();
    tbody.innerHTML = list
      .map(function (u, idx) {
        var sn = u.staffName ? escapeHtml(u.staffName) : "—";
        return (
          "<tr data-index=\"" +
          idx +
          "\"><td>" +
          escapeHtml(u.name) +
          "</td><td>" +
          escapeHtml(u.phone) +
          "</td><td>" +
          escapeHtml(u.role) +
          "</td><td>" +
          sn +
          "</td><td><button type=\"button\" class=\"work-btn-mini work-btn-danger\" data-del=\"" +
          idx +
          "\">Remove</button></td></tr>"
        );
      })
      .join("");

    tbody.querySelectorAll("button[data-del]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var ix = Number(btn.getAttribute("data-del"));
        var arr = loadUsers();
        var victim = arr[ix];
        if (!victim) return;
        var admins = arr.filter(function (x) { return x.role === "admin"; });
        if (victim.role === "admin" && admins.length <= 1) return;
        arr.splice(ix, 1);
        saveUsers(arr);
        var me = currentUser();
        if (me && normalizePhone(me.phone) === normalizePhone(victim.phone)) {
          clearSession();
          showLogin();
          return;
        }
        renderAdminUsers();
      });
    });
  }

  function renderDashboard() {
    recomputeStats();
    var s = mock.stats;
    var elBook = $("#dash-bookings");
    var elRev = $("#dash-revenue");
    var elUp = $("#dash-upcoming");
    if (elBook) elBook.textContent = String(s.bookingsToday);
    if (elRev) elRev.textContent = formatEur(s.revenueTodayCents);
    if (elUp) elUp.textContent = String(s.upcoming);
    updateSessionUi();
  }

  function renderBookings() {
    var tbody = $("#bookings-body");
    if (!tbody) return;
    var showStaff = !isEmployee();
    tbody.innerHTML = sortBookingsList()
      .map(function (b) {
        var timeDisp = b.dateStr + " " + b.timeStr;
        var staffCell = showStaff ? "<td>" + escapeHtml(b.staff || "—") + "</td>" : "";
        return (
          "<tr><td>" +
          escapeHtml(timeDisp) +
          "</td><td>" +
          escapeHtml(b.client) +
          "</td><td>" +
          escapeHtml(b.service) +
          "</td>" +
          (showStaff ? staffCell : "") +
          "</tr>"
        );
      })
      .join("");
  }

  function renderEmployees() {
    var tbody = $("#employees-body");
    if (!tbody) return;
    var editable = canEditOrgData();
    tbody.innerHTML = mock.employees
      .map(function (e, i) {
        if (editable) {
          return (
            "<tr data-emp-i=\"" +
            i +
            "\"><td><input class=\"work-cell-input\" data-f=\"name\" value=\"" +
            escapeHtml(e.name) +
            "\" /></td><td><input class=\"work-cell-input\" data-f=\"role\" value=\"" +
            escapeHtml(e.role) +
            "\" /></td></tr>"
          );
        }
        return "<tr><td>" + escapeHtml(e.name) + "</td><td>" + escapeHtml(e.role) + "</td></tr>";
      })
      .join("");

    if (editable) {
      tbody.querySelectorAll(".work-cell-input").forEach(function (inp) {
        inp.addEventListener("change", function () {
          var tr = inp.closest("tr");
          var i = Number(tr.getAttribute("data-emp-i"));
          var arr = loadEmployees();
          if (!arr[i]) return;
          var f = inp.getAttribute("data-f");
          arr[i][f] = inp.value.trim() || arr[i][f];
          saveEmployees(arr);
          refreshMockTables();
        });
      });
    }
  }

  function renderServices() {
    var tbody = $("#services-body");
    if (!tbody) return;
    var editable = canEditOrgData();
    tbody.innerHTML = mock.services
      .map(function (s, i) {
        if (editable) {
          return (
            "<tr data-svc-i=\"" +
            i +
            "\"><td>" +
            escapeHtml(s.name) +
            "</td><td><input class=\"work-cell-input work-cell-price\" data-f=\"price\" value=\"" +
            escapeHtml(s.price) +
            "\" /></td></tr>"
          );
        }
        return "<tr><td>" + escapeHtml(s.name) + "</td><td>" + escapeHtml(s.price) + "</td></tr>";
      })
      .join("");

    if (editable) {
      tbody.querySelectorAll(".work-cell-input").forEach(function (inp) {
        inp.addEventListener("change", function () {
          var tr = inp.closest("tr");
          var i = Number(tr.getAttribute("data-svc-i"));
          var arr = loadServices();
          if (!arr[i]) return;
          arr[i].price = inp.value.trim() || arr[i].price;
          saveServices(arr);
          refreshMockTables();
          recomputeStats();
          renderDashboard();
        });
      });
    }
  }

  function renderCalendar() {
    var grid = $("#cal-grid");
    var label = $("#cal-month-label");
    if (!grid || !label) return;
    var y = calendarView.y;
    var m = calendarView.m;
    var first = new Date(y, m, 1);
    var dim = new Date(y, m + 1, 0).getDate();
    var pad = weekdayMon0(first);
    label.textContent = first.toLocaleString("en-GB", { month: "long", year: "numeric" });

    var cells = [];
    var i;
    for (i = 0; i < pad; i++) cells.push({ kind: "blank" });
    for (i = 1; i <= dim; i++) {
      cells.push({ kind: "day", dateStr: isoDate(y, m, i), day: i });
    }
    while (cells.length % 7 !== 0) cells.push({ kind: "blank" });
    while (cells.length < 42) cells.push({ kind: "blank" });

    var today = todayISODate();
    grid.innerHTML = cells
      .map(function (c) {
        if (c.kind === "blank") {
          return '<div class="work-cal-day work-cal-day--muted" aria-hidden="true"></div>';
        }
        var has = countBookingsOnDay(c.dateStr) > 0;
        var isToday = c.dateStr === today;
        var isSel = selectedDateStr && c.dateStr === selectedDateStr;
        var cls = "work-cal-day";
        if (isToday) cls += " work-cal-day--today";
        if (isSel) cls += " work-cal-day--selected";
        if (has) cls += " work-cal-day--has";
        return (
          '<button type="button" class="' +
          cls +
          '" data-date="' +
          escapeHtml(c.dateStr) +
          '">' +
          c.day +
          "</button>"
        );
      })
      .join("");

    grid.querySelectorAll(".work-cal-day[data-date]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        selectedDateStr = btn.getAttribute("data-date");
        renderCalendar();
        renderSelectedDay();
      });
    });
  }

  function renderSelectedDay() {
    var title = $("#cal-selected-label");
    var list = $("#cal-day-bookings");
    if (!title || !list) return;
    if (!selectedDateStr) {
      title.textContent = "Select a day";
      list.innerHTML = "";
      return;
    }
    title.textContent = selectedDateStr;
    var items = bookingsForDay(selectedDateStr);
    if (!items.length) {
      list.innerHTML = '<li class="work-muted">No bookings</li>';
      return;
    }
    list.innerHTML = items
      .map(function (b) {
        return (
          "<li><strong>" +
          escapeHtml(b.timeStr) +
          "</strong> · " +
          escapeHtml(b.client) +
          " — " +
          escapeHtml(b.service) +
          (isEmployee() ? "" : " · " + escapeHtml(b.staff || "")) +
          "</li>"
        );
      })
      .join("");
  }

  function fillServiceSelect() {
    var sel = $("#bk-service");
    if (!sel) return;
    sel.innerHTML = mock.services
      .map(function (s) {
        return '<option value="' + escapeHtml(s.name) + '">' + escapeHtml(s.name) + "</option>";
      })
      .join("");
  }

  function staffNamesForSelect() {
    return mock.employees.map(function (e) {
      return e.name;
    });
  }

  function fillStaffSelect() {
    var sel = $("#bk-staff");
    var row = $("#bk-staff-row");
    if (!sel || !row) return;
    var u = currentUser();
    if (u && u.role === "employee") {
      row.hidden = true;
      sel.innerHTML = "";
      return;
    }
    row.hidden = false;
    var names = staffNamesForSelect();
    sel.innerHTML = names
      .map(function (n) {
        return '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + "</option>";
      })
      .join("");
  }

  function openBookingDialog() {
    var u = currentUser();
    if (isEmployee() && !u.staffName) {
      return;
    }

    var dlg = $("#dlg-booking");
    var err = $("#bk-form-error");
    var dIn = $("#bk-date");
    var tIn = $("#bk-time");
    var cIn = $("#bk-client");
    if (!dlg || !dIn || !tIn || !cIn) return;
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
    dIn.value = selectedDateStr || todayISODate();
    tIn.value = "10:00";
    cIn.value = "";
    fillServiceSelect();
    fillStaffSelect();
    var staffSel = $("#bk-staff");
    if (u && u.role === "employee" && u.staffName && staffSel) {
      staffSel.value = u.staffName;
    }
    if (typeof dlg.showModal === "function") dlg.showModal();
  }

  function closeBookingDialog() {
    var dlg = $("#dlg-booking");
    if (dlg && dlg.open) dlg.close();
  }

  function bookingStaffValue() {
    var u = currentUser();
    if (u && u.role === "employee") return u.staffName || "Staff";
    var sel = $("#bk-staff");
    return (sel && sel.value) || staffNamesForSelect()[0] || "Staff";
  }

  function onBookingSubmit(e) {
    e.preventDefault();
    var err = $("#bk-form-error");
    var dIn = $("#bk-date");
    var tIn = $("#bk-time");
    var cIn = $("#bk-client");
    var sIn = $("#bk-service");
    if (!dIn || !tIn || !cIn || !sIn) return;
    var dateStr = dIn.value;
    var timeStr = (tIn.value || "").slice(0, 5);
    var client = (cIn.value || "").trim();
    var service = sIn.value;
    var staff = bookingStaffValue();
    if (!dateStr || !timeStr || !client || !service) {
      if (err) {
        err.hidden = false;
        err.textContent = "Fill all fields.";
      }
      return;
    }
    var clash = mock.bookings.some(function (b) {
      return b.dateStr === dateStr && b.timeStr === timeStr;
    });
    if (clash) {
      if (err) {
        err.hidden = false;
        err.textContent = "That slot is already taken.";
      }
      return;
    }
    mock.bookings.push({
      id: mock.nextBookingId++,
      client: client,
      service: service,
      dateStr: dateStr,
      timeStr: timeStr,
      staff: staff,
    });
    saveBookingsToStorage();
    selectedDateStr = dateStr;
    renderDashboard();
    renderBookings();
    renderCalendar();
    renderSelectedDay();
    closeBookingDialog();
  }

  function syncSelectionToVisibleMonth() {
    if (!selectedDateStr) {
      selectedDateStr = isoDate(calendarView.y, calendarView.m, 1);
      return;
    }
    var p = selectedDateStr.split("-");
    var sy = Number(p[0]);
    var sm = Number(p[1]) - 1;
    if (sy !== calendarView.y || sm !== calendarView.m) {
      selectedDateStr = isoDate(calendarView.y, calendarView.m, 1);
    }
  }

  function navigate(id) {
    if (isEmployee() && (id === "employees" || id === "services")) {
      id = "dashboard";
    }
    document.querySelectorAll(".work-panel-page").forEach(function (p) {
      p.classList.toggle("is-visible", p.getAttribute("data-panel") === id);
    });
    document.querySelectorAll(".work-nav-btn").forEach(function (btn) {
      if (btn.hidden) return;
      btn.classList.toggle("is-active", btn.getAttribute("data-nav") === id);
    });
    var titles = {
      dashboard: "Dashboard",
      bookings: "Bookings",
      employees: "Employees",
      services: "Services",
    };
    var h = $("#main-title");
    if (h) h.textContent = titles[id] || "";
    if (id === "bookings") {
      renderCalendar();
      renderSelectedDay();
      renderBookings();
    }
  }

  function onLoginSubmit(e) {
    e.preventDefault();
    var phoneIn = $("#login-phone");
    var err = $("#login-error");
    var digits = normalizePhone(phoneIn && phoneIn.value);
    if (!digits) {
      if (err) {
        err.hidden = false;
        err.textContent = "Enter a phone number.";
      }
      return;
    }
    var user = findUserByPhone(digits);
    if (!user) {
      if (err) {
        err.hidden = false;
        err.textContent = "Access denied";
      }
      return;
    }
    if (err) err.hidden = true;
    if (user.role === "employee" && !user.staffName) {
      user.staffName = user.name;
    }
    setSession(user);
    showApp();
  }

  function onAddUser(e) {
    e.preventDefault();
    if (!canManageDirectory()) return;
    var form = e.target;
    var name = (form.name.value || "").trim();
    var phone = normalizePhone(form.phone.value);
    var role = form.role.value;
    var staffName = (form.staffName.value || "").trim();
    if (!name || !phone) return;
    if (role === "employee" && !staffName) staffName = name;
    var arr = loadUsers();
    if (arr.some(function (u) { return normalizePhone(u.phone) === phone; })) {
      window.alert("That phone is already registered.");
      return;
    }
    arr.push({
      name: name,
      phone: phone,
      role: role,
      staffName: role === "employee" ? staffName : null,
    });
    saveUsers(arr);
    form.reset();
    renderAdminUsers();
  }

  function tryRestoreSession() {
    var s = getSession();
    if (!s || !s.phone) return false;
    var user = findUserByPhone(normalizePhone(s.phone));
    if (!user) {
      clearSession();
      return false;
    }
    setSession(user);
    showApp();
    return true;
  }

  function onLogout() {
    showLogin();
  }

  function init() {
    var formLogin = $("#form-login");
    if (formLogin) formLogin.addEventListener("submit", onLoginSubmit);

    var formAdd = $("#form-add-user");
    if (formAdd) formAdd.addEventListener("submit", onAddUser);

    document.querySelectorAll(".work-nav-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        navigate(btn.getAttribute("data-nav"));
      });
    });

    var logoutBtn = $("#btn-logout");
    if (logoutBtn) logoutBtn.addEventListener("click", onLogout);

    var calPrev = $("#cal-prev");
    var calNext = $("#cal-next");
    var calToday = $("#cal-today");
    if (calPrev)
      calPrev.addEventListener("click", function () {
        calendarView.m--;
        if (calendarView.m < 0) {
          calendarView.m = 11;
          calendarView.y--;
        }
        syncSelectionToVisibleMonth();
        renderCalendar();
        renderSelectedDay();
      });
    if (calNext)
      calNext.addEventListener("click", function () {
        calendarView.m++;
        if (calendarView.m > 11) {
          calendarView.m = 0;
          calendarView.y++;
        }
        syncSelectionToVisibleMonth();
        renderCalendar();
        renderSelectedDay();
      });
    if (calToday)
      calToday.addEventListener("click", function () {
        var n = new Date();
        calendarView.y = n.getFullYear();
        calendarView.m = n.getMonth();
        selectedDateStr = todayISODate();
        renderCalendar();
        renderSelectedDay();
      });

    var calAdd = $("#cal-add-booking");
    var bookNew = $("#bookings-new");
    var formBk = $("#form-booking");
    var bkCan = $("#bk-cancel");
    if (calAdd) calAdd.addEventListener("click", openBookingDialog);
    if (bookNew) bookNew.addEventListener("click", openBookingDialog);
    if (formBk) formBk.addEventListener("submit", onBookingSubmit);
    if (bkCan) bkCan.addEventListener("click", closeBookingDialog);

    if (tryRestoreSession()) return;
    showLogin();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

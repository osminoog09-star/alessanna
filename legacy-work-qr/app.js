(function () {
  "use strict";

  var user = null;
  var qrPollTimer = null;
  var currentQrToken = null;

  function api(path, opts) {
    opts = opts || {};
    opts.credentials = "include";
    opts.headers = opts.headers || {};
    if (opts.body && typeof opts.body === "object" && !(opts.body instanceof FormData)) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(path, opts).then(function (r) {
      return r.text().then(function (t) {
        var j = {};
        try {
          j = t ? JSON.parse(t) : {};
        } catch (ignore) {}
        return { ok: r.ok, status: r.status, data: j };
      });
    });
  }

  function $(sel) {
    return document.querySelector(sel);
  }

  function stopQrPoll() {
    if (qrPollTimer) {
      clearInterval(qrPollTimer);
      qrPollTimer = null;
    }
  }

  function showLogin() {
    stopQrPoll();
    user = null;
    $("#view-login").hidden = false;
    $("#view-app").hidden = true;
    startQrSession();
  }

  function showApp(u) {
    user = u;
    $("#view-login").hidden = true;
    $("#view-app").hidden = false;
    $("#user-email").textContent = u.email;
    $("#user-role").textContent = u.role;
    var isEmp = u.role === "employee";
    document.querySelectorAll(".nav-manager").forEach(function (el) {
      el.style.display = isEmp ? "none" : "";
    });
    document.querySelectorAll("#btn-new-booking").forEach(function (b) {
      b.style.display = "";
    });
    navigate("dash");
    refreshAll();
  }

  function startQrSession() {
    stopQrPoll();
    var host = $("#qr-canvas-host");
    if (!host) return;
    host.innerHTML = "";
    var loading = document.createElement("p");
    loading.className = "muted qr-loading";
    loading.textContent = "Genereerin QR-koodi…";
    host.appendChild(loading);
    api("/api/auth/qr-session", { method: "POST" }).then(function (x) {
      host.innerHTML = "";
      if (!x.ok || !x.data || !x.data.token) {
        var er = document.createElement("p");
        er.className = "error";
        er.textContent = "QR-sessiooni ei saanud luua. Värskendage lehte.";
        host.appendChild(er);
        return;
      }
      currentQrToken = x.data.token;
      var originBase = (x.data.scanBase && String(x.data.scanBase).replace(/\/$/, "")) || window.location.origin;
      var scanUrl = originBase + "/work/m/?token=" + encodeURIComponent(currentQrToken);
      if (typeof QRCode !== "undefined") {
        var canvas = document.createElement("canvas");
        canvas.className = "qr-canvas";
        host.appendChild(canvas);
        QRCode.toCanvas(
          canvas,
          scanUrl,
          { width: 220, margin: 2, color: { dark: "#e8d5a8", light: "#141414" } },
          function (err) {
            if (err && host) {
              var pre = document.createElement("pre");
              pre.className = "qr-fallback";
              pre.textContent = scanUrl;
              host.appendChild(pre);
            }
          }
        );
      } else {
        var pre = document.createElement("pre");
        pre.className = "qr-fallback";
        pre.textContent = scanUrl;
        host.appendChild(pre);
      }
      qrPollTimer = setInterval(function () {
        if (!currentQrToken) return;
        fetch("/api/auth/qr/status?token=" + encodeURIComponent(currentQrToken), { credentials: "include" })
          .then(function (r) {
            return r.text().then(function (t) {
              var j = {};
              try {
                j = t ? JSON.parse(t) : {};
              } catch (e2) {
                j = {};
              }
              return j;
            });
          })
          .then(function (data) {
            if (data.success && data.user) {
              stopQrPoll();
              showApp(data.user);
            } else if (data.error === "expired") {
              stopQrPoll();
              startQrSession();
            }
          })
          .catch(function () {});
      }, 2000);
    });
  }

  function navigate(name) {
    document.querySelectorAll(".page").forEach(function (p) {
      p.classList.remove("is-visible");
    });
    document.querySelectorAll(".nav-btn").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-view") === name);
    });
    var titles = {
      dash: "Ülevaade",
      book: "Broneeringud",
      svc: "Teenused",
      emp: "Töötajad",
      hours: "Lahtiolek",
      help: "Abi / KKK",
    };
    $("#page-title").textContent = titles[name] || "";
    var page = $("#page-" + name);
    if (page) page.classList.add("is-visible");
    if (name === "book") loadBookings();
    if (name === "svc") loadServices();
    if (name === "emp") loadEmployees();
    if (name === "hours") loadHours();
    if (name === "help") loadFaq($("#faq-list"));
    if (name === "dash") loadDashboard();
  }

  function refreshAll() {
    loadDashboard();
    loadBookings();
    loadServices();
    loadEmployees();
    loadHours();
    loadFaq($("#faq-list"));
    loadFaq($("#faq-drawer-list"));
    fillModalSelects();
  }

  function loadDashboard() {
    if (!user || user.role === "employee") {
      $("#stat-cards").innerHTML = "";
      $("#dash-hint").textContent =
        user && user.role === "employee"
          ? "Teie broneeringud on vahekaardil Broneeringud."
          : "";
      return;
    }
    api("/api/crm/stats").then(function (x) {
      if (!x.ok) return;
      var s = x.data;
      $("#stat-cards").innerHTML =
        '<div class="stat-card"><span class="muted">Täna</span><strong>' +
        s.bookingsToday +
        "</strong></div>" +
        '<div class="stat-card"><span class="muted">Tulevikus</span><strong>' +
        s.upcoming +
        "</strong></div>" +
        '<div class="stat-card"><span class="muted">Töötajad</span><strong>' +
        s.employees +
        "</strong></div>" +
        '<div class="stat-card"><span class="muted">Teenused</span><strong>' +
        s.services +
        "</strong></div>";
      $("#dash-hint").textContent = "CRM: broneeringud, teenused ja töötajad ühest kohast.";
    });
  }

  function loadBookings() {
    api("/api/crm/bookings").then(function (x) {
      if (!x.ok) return;
      var tbody = $("#bookings-body");
      tbody.innerHTML = "";
      x.data.forEach(function (b) {
        var tr = document.createElement("tr");
        tr.innerHTML =
          "<td>" +
          escapeHtml(b.start_at) +
          "</td><td>" +
          escapeHtml(b.client_name) +
          "</td><td>" +
          escapeHtml(b.service_name) +
          "</td><td>" +
          escapeHtml(b.employee_name) +
          "</td><td>" +
          escapeHtml(b.source) +
          "</td><td></td>";
        var td = tr.lastChild;
        if (b.status !== "cancelled") {
          var cancel = document.createElement("button");
          cancel.type = "button";
          cancel.className = "linklike";
          cancel.textContent = "Tühista";
          cancel.addEventListener("click", function () {
            if (!confirm("Tühistada broneering?")) return;
            api("/api/crm/bookings/" + b.id, {
              method: "PATCH",
              body: { status: "cancelled" },
            }).then(function () {
              loadBookings();
            });
          });
          td.appendChild(cancel);
        } else {
          td.textContent = "—";
        }
        tbody.appendChild(tr);
      });
    });
  }

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function loadServices() {
    api("/api/crm/services").then(function (x) {
      if (!x.ok) return;
      var tbody = $("#services-body");
      tbody.innerHTML = "";
      x.data.forEach(function (s) {
        var tr = document.createElement("tr");
        tr.innerHTML =
          "<td>" +
          escapeHtml(s.name_et) +
          "</td><td>" +
          escapeHtml(s.slug || "") +
          "</td><td>" +
          s.duration_min +
          "</td><td>" +
          s.buffer_after_min +
          "</td><td>" +
          s.price_cents +
          "</td><td>" +
          (s.active ? "" : "peidetud") +
          "</td>";
        tbody.appendChild(tr);
      });
    });
  }

  function loadEmployees() {
    api("/api/crm/employees").then(function (x) {
      if (!x.ok) return;
      var tbody = $("#employees-body");
      tbody.innerHTML = "";
      x.data.forEach(function (e) {
        var tr = document.createElement("tr");
        tr.innerHTML =
          "<td>" +
          e.id +
          "</td><td>" +
          escapeHtml(e.name) +
          "</td><td>" +
          escapeHtml(e.phone || "") +
          "</td><td>" +
          (e.active ? "jah" : "ei") +
          "</td>";
        tbody.appendChild(tr);
      });
    });
  }

  function loadHours() {
    api("/api/crm/salon-hours").then(function (x) {
      if (!x.ok) return;
      $("#hours-json").textContent = JSON.stringify(x.data, null, 2);
    });
  }

  function loadFaq(container) {
    if (!container) return;
    api("/api/crm/faq").then(function (x) {
      if (!x.ok) return;
      container.innerHTML = "";
      (x.data.items || []).forEach(function (item) {
        var d = document.createElement("details");
        d.innerHTML = "<summary>" + escapeHtml(item.title) + "</summary><p>" + escapeHtml(item.body) + "</p>";
        container.appendChild(d);
      });
    });
  }

  function fillModalSelects() {
    var empSel = $("#modal-employee");
    var svcSel = $("#modal-service");
    if (!empSel || !svcSel) return Promise.resolve();
    return Promise.all([api("/api/crm/employees"), api("/api/crm/services")]).then(function (pair) {
      var eRes = pair[0];
      var sRes = pair[1];
      empSel.innerHTML = "";
      if (eRes.ok) {
        eRes.data.forEach(function (e) {
          if (e.active === 0) return;
          var o = document.createElement("option");
          o.value = e.id;
          o.textContent = e.name;
          if (user && user.role === "employee" && Number(user.employeeId) === Number(e.id)) o.selected = true;
          empSel.appendChild(o);
        });
      }
      svcSel.innerHTML = "";
      if (sRes.ok) {
        sRes.data.forEach(function (s) {
          if (s.active === 0) return;
          var o = document.createElement("option");
          o.value = s.id;
          o.textContent = s.name_et;
          svcSel.appendChild(o);
        });
      }
    });
  }

  $("#btn-logout").addEventListener("click", function () {
    api("/api/auth/logout", { method: "POST" }).then(showLogin);
  });

  document.querySelectorAll(".nav-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      navigate(btn.getAttribute("data-view"));
    });
  });

  $("#help-toggle").addEventListener("click", function () {
    loadFaq($("#faq-drawer-list"));
    $("#drawer-help").hidden = false;
  });

  document.querySelectorAll("[data-close-drawer]").forEach(function (el) {
    el.addEventListener("click", function () {
      $("#drawer-help").hidden = true;
    });
  });

  $("#btn-new-booking").addEventListener("click", function () {
    var dlg = $("#dlg-booking");
    $("#form-booking-modal").reset();
    $("#form-booking-modal [name=booking_id]").value = "";
    fillModalSelects().then(function () {
      dlg.showModal();
    });
  });

  $("#modal-booking-cancel").addEventListener("click", function () {
    $("#dlg-booking").close();
  });

  $("#form-booking-modal").addEventListener("submit", function (e) {
    e.preventDefault();
    var fd = new FormData(e.target);
    var body = {
      employeeId: Number(fd.get("employeeId")),
      serviceId: Number(fd.get("serviceId")),
      date: fd.get("date"),
      time: fd.get("time"),
      clientName: fd.get("clientName"),
      clientPhone: fd.get("clientPhone") || "",
      notes: fd.get("notes") || "",
    };
    api("/api/crm/bookings", { method: "POST", body: body }).then(function (x) {
      if (x.ok) {
        $("#dlg-booking").close();
        loadBookings();
      } else {
        alert((x.data && x.data.error) || "Viga");
      }
    });
  });

  $("#form-service").addEventListener("submit", function (e) {
    e.preventDefault();
    if (user.role === "employee") return;
    var fd = new FormData(e.target);
    api("/api/crm/services", {
      method: "POST",
      body: {
        slug: fd.get("slug"),
        name_et: fd.get("name_et"),
        duration_min: Number(fd.get("duration_min")),
        buffer_after_min: Number(fd.get("buffer_after_min")),
        price_cents: Number(fd.get("price_cents")),
      },
    }).then(function (x) {
      if (x.ok) {
        e.target.reset();
        loadServices();
      } else alert("Viga");
    });
  });

  $("#form-employee").addEventListener("submit", function (e) {
    e.preventDefault();
    if (user.role === "employee") return;
    var fd = new FormData(e.target);
    api("/api/crm/employees", {
      method: "POST",
      body: {
        name: fd.get("name"),
        slug: fd.get("slug"),
        phone: fd.get("phone"),
        email: fd.get("email"),
      },
    }).then(function (x) {
      if (x.ok) {
        e.target.reset();
        loadEmployees();
        fillModalSelects();
      } else alert("Viga");
    });
  });

  api("/api/auth/me")
    .then(function (x) {
      if (x.ok && x.data && x.data.user) showApp(x.data.user);
      else showLogin();
    })
    .catch(showLogin);
})();

(function () {
  "use strict";

  var root = document.getElementById("root");
  var params = new URLSearchParams(window.location.search);
  var token = params.get("token");

  function show(msg, isErr) {
    root.innerHTML = "<p class=\"" + (isErr ? "err" : "muted") + "\">" + msg + "</p>";
  }

  if (!token) {
    show("Puudub sessiooni token. Avage link uuesti töölaua QR-koodist.", true);
    return;
  }

  show("Laadin…", false);

  fetch("/api/auth/qr/candidates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: token }),
  })
    .then(function (r) {
      return r.json().then(function (j) {
        return { ok: r.ok, j: j };
      });
    })
    .then(function (x) {
      if (!x.ok) {
        show((x.j && x.j.error) || "Sessioon on aegunud või vigane. Uuendage QR töölaual.", true);
        return;
      }
      var users = x.j.users || [];
      if (!users.length) {
        show("Kasutajaid ei leitud.", true);
        return;
      }
      root.innerHTML = "<div class=\"list\" id=\"user-list\"></div>";
      var list = document.getElementById("user-list");
      users.forEach(function (u) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pick";
        btn.innerHTML =
          "<span>" +
          escapeHtml(u.label) +
          "</span><span class=\"role\">" +
          escapeHtml(u.role) +
          "</span>";
        btn.addEventListener("click", function () {
          btn.disabled = true;
          fetch("/api/auth/qr/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: token, userId: u.id }),
          })
            .then(function (r) {
              return r.json().then(function (j) {
                return { ok: r.ok, j: j };
              });
            })
            .then(function (y) {
              if (y.ok) {
                root.innerHTML =
                  "<p class=\"done\">✓ Kinnitatud. Võite telefoni panna kõrvale — töölaud logib sisse.</p>";
              } else {
                btn.disabled = false;
                show((y.j && y.j.error) || "Kinnitamine ebaõnnestus.", true);
              }
            })
            .catch(function () {
              btn.disabled = false;
              show("Võrgu viga.", true);
            });
        });
        list.appendChild(btn);
      });
    })
    .catch(function () {
      show("Võrgu viga.", true);
    });

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();

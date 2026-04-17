(function () {
  if (window.__spooniLoaded) return;
  window.__spooniLoaded = true;

  var CONFIG = {
    panelId: "spooni-panel",
    toggleId: "spooni-toggle-button",
    checkboxClass: "sp-row-checkbox",
    injectedFlag: "data-spooni-injected"
  };

var lastViewKey = "";
var viewWatcherStarted = false;
var selectedDimensions = new Set();
var manuallyUncheckedRows = new Set();
var isApplyingDimensionSelection = false;


  function normalizeText(text) {
    return (text || "").replace(/\s+/g, " ").replace(/\u00A0/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

/* ✅ Debounced auto-calc */
var autoCalcTimer = null;

function scheduleAutoCalculate() {
  if (autoCalcTimer) {
    clearTimeout(autoCalcTimer);
  }
  
autoCalcTimer = setTimeout(function () {
  if (activeTab === "veneer") {
    calculateSelected();              // existing calculator
  } else {
    calculateRemainingQuantity();     // NEW quantity calculator
  }
}, 200); // 200ms debounce
}


  function parseNumber(text) {
    if (!text) return 0;
    var cleaned = String(text).replace(/\s/g, "").replace(",", ".");
    var num = parseFloat(cleaned);
    return isFinite(num) ? num : 0;
  }
function watchViewChange() {
  if (viewWatcherStarted) return;
  viewWatcherStarted = true;

  setInterval(function () {
    var current = getCurrentViewKey();
    if (!current) return;

    if (current !== lastViewKey) {
      lastViewKey = current;
      onViewChanged();
    }
  }, 700);
}
function onViewChanged() {
  // 1️⃣ Clean up previous state
  removeCheckboxes();
  selectedDimensions.clear();

  setResults("Select rows to calculate.");
  setStatus("View changed. Reloading dimensions...");

  // 2️⃣ Re-scan table & rebuild dimension dropdown (async-safe)
  waitForRowsAndRenderDropdown();

  // 3️⃣ ✅ AUTO-SELECT CORRECT CALCULATOR TAB (B)
  //    Needs a small delay so headers are present
  setTimeout(autoSelectCalculatorTab, 400);

  // 4️⃣ Reset dropdown selection state
  setTimeout(function () {
    var select = document.getElementById("sp-dimension-select");
    if (select) {
      select.value = "";
    }
  }, 0);
}

function waitForRowsAndRenderDropdown() {
  var attempts = 0;
  var maxAttempts = 20;

  var timer = setInterval(function () {
    attempts++;

    var rows = getCandidateRows();
    if (rows.length > 0) {
      clearInterval(timer);
      renderDimensionDropdown();
      setStatus("Dimensions loaded (" + rows.length + " rows)");
      return;
    }

    if (attempts >= maxAttempts) {
      clearInterval(timer);
      setStatus("No rows found for this view.");
    }
  }, 400);
}
function pageHasThickness() {
  var headers = document.querySelectorAll("th");

  for (var i = 0; i < headers.length; i++) {
    var text = normalizeText(headers[i].innerText).toUpperCase();

    // ✅ Real table columns you showed
    if (
      text === "PAKSUS" ||
      text === "KIHT" ||
      text.includes("PAKSUS") ||
      text.includes("KIHT")
    ) {
      return true;
    }
  }

  return false;
}
function autoSelectCalculatorTab() {
  if (pageHasThickness()) {
    // ✅ Thickness present → ATM + Käsi
    switchTab("veneer");
  } else {
    // ✅ No thickness → Spoonitöötlus
    switchTab("quantity");
  }
}
function extractLineType(row) {
  var text = normalizeText(row.innerText).toUpperCase();

  if (text.includes("JÄTKAMIS")) return "jatkamine";
  if (text.includes("VAHESPOON")) return "vahespoon";
  if (text.includes("PINNASPOON")) return "pinnaspoon";

  return "unknown";
}
function getPageLineType() {
  var text = normalizeText(document.body ? document.body.innerText : "").toUpperCase();

  if (text.includes("JÄTKAMISLIIN")) return "jatkamine";
  if (text.includes("JÄTKAMIS")) return "jatkamine";
  if (text.includes("VAHESPOON")) return "vahespoon";
  if (text.includes("PINNASPOON")) return "pinnaspoon";

  return "unknown";
}

function waitForTableAndRenderDropdown() {
  var attempts = 0;
  var maxAttempts = 20;

  var interval = setInterval(function () {
    attempts++;

    var rows = getCandidateRows();
    if (rows.length > 0) {
      renderDimensionDropdown();
      clearInterval(interval);
      return;
    }

    if (attempts >= maxAttempts) {
      clearInterval(interval);
    }
  }, 500);
}
  function extractSize(text) {
    var t = normalizeText(text);
    var m = t.match(/\b(\d{3,4})x(\d{3,4})\b/i);
    return m ? (m[1] + "x" + m[2]) : "UNKNOWN";
  }
function getRowKey(row) {
  return normalizeText(row.innerText);
}
  function getAllDimensionsOnPage() {
  var rows = getCandidateRows();
  var sizes = {};

  rows.forEach(function (row) {
    var text = normalizeText(row.innerText);
    var size = extractSize(text);
    if (size && size !== "UNKNOWN") {
      sizes[size] = true;
    }
  });

  return Object.keys(sizes).sort();
}
var activeTab = "veneer";

function switchTab(tab) {
  activeTab = tab;

  document.getElementById("sp-tab-veneer").classList.toggle("active", tab === "veneer");
  document.getElementById("sp-tab-qty").classList.toggle("active", tab === "quantity");

  setResults("Select rows to calculate.");
  setStatus(tab === "veneer" ? "Veneer calculator" : "Remaining quantity calculator");
}
function selectRowsByDimension(targetSize) {
  // ✅ ensure checkboxes exist
  if (!document.querySelector("." + CONFIG.checkboxClass)) {
    addCheckboxes();
  }

  var rows = getCandidateRows();
  var selected = 0;

  rows.forEach(function (row) {
    var size = extractSize(row.innerText);
    var cb = row.querySelector("." + CONFIG.checkboxClass);

    if (!cb) return;

    if (size === targetSize) {
      cb.checked = true;
      row.classList.add("sp-highlight-row");
      selected++;
    } else {
      cb.checked = false;
      row.classList.remove("sp-highlight-row");
    }
  });

  setStatus("Selected " + selected + " rows for " + targetSize);
  scheduleAutoCalculate();
}

function renderDimensionDropdown() {
  var body = document.querySelector("#" + CONFIG.panelId + " .sp-body");
  if (!body) return;

  var existing = document.getElementById("sp-dimension-wrap");
  if (existing) existing.remove();

  var wrap = document.createElement("div");
  wrap.id = "sp-dimension-wrap";
  wrap.style.marginBottom = "6px";

  // Label
  var label = document.createElement("div");
  label.textContent = "Vali mõõt :";
  label.style.fontWeight = "600";
  label.style.fontSize = "15px";
  label.style.marginBottom = "3px";
  wrap.appendChild(label);

  var dims = getAllDimensionsOnPage();

  if (!dims.length) {
    var empty = document.createElement("div");
    empty.textContent = "No dimensions found yet.";
    empty.style.fontSize = "12px";
    empty.style.color = "#9ca3af";
    wrap.appendChild(empty);
    body.prepend(wrap);
    return;
  }

  // ✅ Toggle button (replaces <select>)
  var toggle = document.createElement("div");
  toggle.id = "sp-dimension-toggle";
  toggle.textContent =
    selectedDimensions.size === 0
      ? "-- Vali mõõt --"
      : Array.from(selectedDimensions).join(", ");
  wrap.appendChild(toggle);

  // ✅ Dropdown menu
  var menu = document.createElement("div");
  menu.id = "sp-dimension-menu";
  menu.style.display = "none";
  wrap.appendChild(menu);

  // ✅ Build checkbox items
  dims.forEach(function (size) {
    var item = document.createElement("label");
    item.className = "sp-dimension-item";

    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selectedDimensions.has(size);

    cb.addEventListener("change", function () {
      if (cb.checked) {
        selectedDimensions.add(size);
      } else {
        selectedDimensions.delete(size);
      }

      applyDimensionSelection();
      renderDimensionDropdown(); // refresh text + checkboxes
    });

    var text = document.createElement("span");
    text.textContent = size;

    item.appendChild(cb);
    item.appendChild(text);
    menu.appendChild(item);
  });

  // ✅ Open / close logic
  toggle.addEventListener("click", function (e) {
    e.stopPropagation();
    menu.style.display = menu.style.display === "none" ? "block" : "none";
  });

  // ✅ Close when clicking outside (bind only once)
  if (!window.__spooniOutsideClickBound) {
    window.__spooniOutsideClickBound = true;
    document.addEventListener("click", function (e) {
      var currentWrap = document.getElementById("sp-dimension-wrap");
      var currentMenu = document.getElementById("sp-dimension-menu");
      if (!currentWrap || !currentMenu) return;
      if (!currentWrap.contains(e.target)) {
        currentMenu.style.display = "none";
      }
    });
  }

  body.prepend(wrap);
}
function applyDimensionSelection() {
  if (!document.querySelector("." + CONFIG.checkboxClass)) {
    addCheckboxes();
  }

  var rows = getCandidateRows();
  var checkedCount = 0;

  isApplyingDimensionSelection = true;

  rows.forEach(function (row) {
    var size = extractSize(row.innerText);
    var cb = row.querySelector("." + CONFIG.checkboxClass);
    var rowKey = getRowKey(row);

    if (!cb) return;

    if (selectedDimensions.has(size)) {
      if (manuallyUncheckedRows.has(rowKey)) {
        cb.checked = false;
        row.classList.remove("sp-highlight-row");
      } else {
        cb.checked = true;
        row.classList.add("sp-highlight-row");
        checkedCount++;
      }
    } else {
      cb.checked = false;
      row.classList.remove("sp-highlight-row");
      manuallyUncheckedRows.delete(rowKey);
    }
  });

  isApplyingDimensionSelection = false;

  setStatus(
    selectedDimensions.size
      ? "Selected dimensions: " + Array.from(selectedDimensions).join(", ")
      : "No dimensions selected"
  );

  scheduleAutoCalculate();
}


  function isVisible(el) {
    if (!el) return false;
    var style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function setStatus(text) {
    var el = document.getElementById("sp-status");
    if (el) el.textContent = text;
  }
function calculateVajaAndPacks(size, qty, lineType) {
  var parts = size.split("x");
  if (parts.length !== 2) {
    return { vaja: 0, packs: 0 };
  }

  var first = parseFloat(parts[0]);   // левое число
  var second = parseFloat(parts[1]);  // правое число

  // По умолчанию: width x length
  var width = first;
  var length = second;

  // Для jätkamisliin наоборот: слева длина, справа ширина
  if (lineType === "jatkamine") {
    length = first;
    width = second;
  }

  if (!width || !length) {
    return { vaja: 0, packs: 0 };
  }

  // vaja spooni = remaining qty / width * length
  var vaja = (qty / width) * length;

  // pakkides = (vaja / 500) + a%
  var packsBase = vaja / 500;
  var percent = 0;

  if (lineType === "pinnaspoon") {
    percent = 15;
  } else if (lineType === "vahespoon") {
    percent = 20;
  } else if (lineType === "jatkamine") {
    percent = 6;
  }

  // ЯВНО: прибавляем процент к base
  var packs = packsBase + (packsBase * percent / 100);

  return {
    vaja: vaja,
    packs: packs
  };
}

function observeTableChanges() {
  var refreshTimer = null;
  var panelSelector = "#" + CONFIG.panelId;

  var observer = new MutationObserver(function (mutations) {
    var hasExternalChange = mutations.some(function (m) {
      var target = m.target;
      if (!target) return false;
      if (target.nodeType === 1 && target.closest) {
        return !target.closest(panelSelector);
      }
      return !(target.parentElement && target.parentElement.closest && target.parentElement.closest(panelSelector));
    });

    if (!hasExternalChange) return;

    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      renderDimensionDropdown();

      if (selectedDimensions.size > 0 || document.querySelector("." + CONFIG.checkboxClass)) {
        addCheckboxes();
        applyDimensionSelection();
      }
    }, 120);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}


  function setResults(content) {
    var el = document.getElementById("sp-results");
    if (el) el.innerHTML = content;
  }

  function createUI() {
    if (document.getElementById(CONFIG.panelId)) return;

    var panel = document.createElement("div");
    panel.id = CONFIG.panelId;

    panel.innerHTML =
      '<div class="sp-header" style="display:flex;align-items:center;justify-content:space-between;">' +
  '<div class="sp-tabs" style="display:flex;gap:6px;">' +
    '<button id="sp-tab-veneer" class="sp-tab active">ATM + KÄSILADUMINE</button>' +
    '<button id="sp-tab-qty" class="sp-tab">SPOON</button>' +
  '</div>' +
  '<button id="sp-min-btn" class="sp-secondary" style="width:28px;height:28px;padding:0;line-height:1;font-size:18px;display:flex;align-items:center;justify-content:center;">–</button>' +
'</div>' +
      '<div class="sp-body">' +
        '<div class="sp-buttons">' +
          '<button id="sp-checkboxes-btn">Checkboxes</button>' +
          '<button id="sp-calc-btn">Calculate</button>' +
          '<button id="sp-copy-btn" class="sp-secondary">Copy</button>' +
          '<button id="sp-clear-btn" class="sp-secondary">Clear</button>' +
        '</div>' +
        '<div id="sp-results" class="sp-results">Select rows and press Calculate.</div>' +
	'<div id="sp-status" class="sp-status">Ready.</div>' +
      '</div>';

    document.body.appendChild(panel);
renderDimensionDropdown();

document.getElementById("sp-tab-veneer").onclick = function () {
  switchTab("veneer");
};

document.getElementById("sp-tab-qty").onclick = function () {
  switchTab("quantity");
};


    var toggle = document.createElement("button");
    toggle.id = CONFIG.toggleId;
    toggle.textContent = "SK";
    document.body.appendChild(toggle);

    document.getElementById("sp-checkboxes-btn").addEventListener("click", toggleCheckboxes);
    document.getElementById("sp-calc-btn").onclick = function () {
  if (activeTab === "veneer") {
    calculateSelected();
  } else {
    calculateRemainingQuantity();
  }
};
    document.getElementById("sp-copy-btn").addEventListener("click", copyResults);
    document.getElementById("sp-clear-btn").addEventListener("click", clearAll);
    document.getElementById("sp-min-btn").addEventListener("click", minimizePanel);

    toggle.addEventListener("click", restorePanel);
    initDrag(toggle);

// Try to render dimensions early (React-safe retry)
//setTimeout(renderDimensionDropdown, 500);
//setTimeout(renderDimensionDropdown, 1500);
//setTimeout(renderDimensionDropdown, 3000);

waitForTableAndRenderDropdown();
observeTableChanges();

lastViewKey = getCurrentViewKey();
watchViewChange();
setTimeout(autoSelectCalculatorTab, 0);
// ✅ Start minimized by default
minimizePanel();





  }

  function initDrag(toggle) {
    var dragging = false;
    var moved = false;
    var offsetX = 0;
    var offsetY = 0;

    var savedLeft = localStorage.getItem("spooni_toggle_left");
    var savedTop = localStorage.getItem("spooni_toggle_top");

    if (savedLeft && savedTop) {
      toggle.style.left = savedLeft;
      toggle.style.top = savedTop;
      toggle.style.right = "auto";
    }

    toggle.addEventListener("mousedown", function (e) {
      dragging = true;
      moved = false;
      offsetX = e.clientX - toggle.getBoundingClientRect().left;
      offsetY = e.clientY - toggle.getBoundingClientRect().top;
      e.preventDefault();
    });

    document.addEventListener("mousemove", function (e) {
      if (!dragging) return;
      moved = true;
      toggle.style.left = (e.clientX - offsetX) + "px";
      toggle.style.top = (e.clientY - offsetY) + "px";
      toggle.style.right = "auto";
    });

    document.addEventListener("mouseup", function () {
      if (!dragging) return;
      dragging = false;
      localStorage.setItem("spooni_toggle_left", toggle.style.left || "");
      localStorage.setItem("spooni_toggle_top", toggle.style.top || "");
      setTimeout(function () { moved = false; }, 0);
    });

    toggle.addEventListener("click", function (e) {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }
function getCurrentViewKey() {
  var el = document.querySelector(
    'body > section > div.main-content > div > div:nth-child(2) > div.chips > div:nth-child(2)'
  );

  return el ? normalizeText(el.innerText) : "";
}
  function minimizePanel() {
    var panel = document.getElementById(CONFIG.panelId);
    var toggle = document.getElementById(CONFIG.toggleId);
    if (!panel || !toggle) return;
    panel.style.display = "none";
    toggle.classList.add("sp-toggle-visible");
  }
function findAllesolevKogusIndex() {
  var headers = document.querySelectorAll("th");
  for (var i = 0; i < headers.length; i++) {
    var text = normalizeText(headers[i].innerText).toUpperCase();
    if (text.includes("ALLESOLEV") && text.includes("KOGUS")) {
      return i;
    }
  }
  return -1;
}
function extractAllesolevKogus(row, index) {
  var cells = row.querySelectorAll("td");
  if (!cells[index]) return 0;

  // remove spaces and non-breaking spaces before parsing
  var raw = normalizeText(cells[index].innerText)
    .replace(/\s/g, "");

  var val = parseInt(raw, 10);
  return Number.isFinite(val) ? val : 0;
}
function calculateRemainingQuantity() {
  var rows = getCheckedRows();
  if (!rows.length) {
    setResults("Select rows to calculate remaining quantity.");
    return;
  }

  var qtyIndex = findAllesolevKogusIndex();
  if (qtyIndex === -1) {
    setResults("Column 'Allesolev kogus' not found.");
    return;
  }

  function detectQuality(row) {
    var t = normalizeText(row.innerText).toUpperCase();

    if (t.indexOf("BCK2SCARF") !== -1) return "BCK2SCARF";
    if (t.indexOf("BCK3SCARF") !== -1) return "BCK3SCARF";

    if (t.indexOf("BBFC") !== -1) return "BBFC";
    if (t.indexOf("EWGFC") !== -1 || t.indexOf("WGFC") !== -1) return "EWGFC";

    return "";
  }

  var result = {};
  var fallbackType = getPageLineType();

  rows.forEach(function (row) {
    var size = extractSize(row.innerText);
    var qty = extractAllesolevKogus(row, qtyIndex);
    var type = extractLineType(row);
    var quality = detectQuality(row);

    if (type === "unknown" && fallbackType !== "unknown") {
      type = fallbackType;
    }

    if (!result[size]) {
      result[size] = {
        qty: 0,
        type: type,
        k2: 0,
        k3: 0,
        bb: 0,
        ewg: 0
      };
    }

    var bucket = result[size];

    if (bucket.type === "unknown" && type !== "unknown") {
      bucket.type = type;
    }

    // общий qty оставляем для возможной отладки/других линий
    bucket.qty += qty;

    if (bucket.type === "jatkamine") {
      // K2 = BCK2SCARF, K3 = BCK3SCARF
      if (quality === "BCK2SCARF") bucket.k2 += qty;
      if (quality === "BCK3SCARF") bucket.k3 += qty;
    } else if (bucket.type === "pinnaspoon") {
      // BB = BBFC, EWG = EWGFC
      if (quality === "BBFC") bucket.bb += qty;
      if (quality === "EWGFC") bucket.ewg += qty;
    }
  });

  var out = "";
  var totalPacks = 0;

  Object.keys(result).forEach(function (size) {
    var bucket = result[size];

    // qtyForFormula = то, что реально должно идти в формулу
    var qtyForFormula = bucket.qty;

    if (bucket.type === "jatkamine") {
      qtyForFormula = bucket.k2 + bucket.k3;
    } else if (bucket.type === "pinnaspoon") {
      qtyForFormula = bucket.bb + bucket.ewg;
    }

    var extra = calculateVajaAndPacks(size, qtyForFormula, bucket.type);
    totalPacks += extra.packs;

    out +=
      '<div class="sp-remaining-card">' +
        '<div class="sp-remaining-size">' + escapeHtml(size) + '</div>';

    if (bucket.type === "jatkamine") {
  out +=
    '<div class="sp-remaining-row sp-remaining-title sp-hide-badge">' +
      '<span>Allesolev kogus</span>' +
    '</div>' +
    '<div class="sp-remaining-row sp-subrow">' +
      '<span> K2</span>' +
      '<strong class="sp-blue-badge">' + bucket.k2 + '</strong>' +
    '</div>' +
    '<div class="sp-remaining-row sp-subrow sp-subrow-dark sp-subrow-divider">' +
      '<span> K3</span>' +
      '<strong class="sp-blue-badge">' + bucket.k3 + '</strong>' +
    '</div>';

} else if (bucket.type === "pinnaspoon") {
  out +=
    '<div class="sp-remaining-row sp-remaining-title sp-hide-badge">' +
      '<span>Allesolev kogus</span>' +
    '</div>' +
    '<div class="sp-remaining-row sp-subrow">' +
      '<span> BB</span>' +
      '<strong class="sp-blue-badge">' + bucket.bb + '</strong>' +
    '</div>' +
    '<div class="sp-remaining-row sp-subrow sp-subrow-dark sp-subrow-divider">' +
      '<span> EWG</span>' +
      '<strong class="sp-blue-badge">' + bucket.ewg + '</strong>' +
    '</div>';

} else {
  out +=
    '<div class="sp-remaining-row sp-remaining-title">' +
      '<span>Allesolev kogus</span>' +
      '<strong class="sp-blue-badge">' + bucket.qty + '</strong>' +
    '</div>';
}

    out +=
        '<div class="sp-remaining-row">' +
          '<span>Vaja spooni</span>' +
          '<strong>' + Math.round(extra.vaja) + '</strong>' +
        '</div>' +
        '<div class="sp-remaining-row">' +
          '<span>Pakkides</span>' +
          '<strong>' + extra.packs.toFixed(2) + '</strong>' +
        '</div>' +
      '</div>';
  });

  out +=
    '<div class="sp-remaining-line">' +
      '<span>Kokku vaja pakke (+ praagi %)</span>' +
      '<strong>' + totalPacks.toFixed(2) + '</strong>' +
    '</div>';

  setResults(out);
  setStatus("Done. Orders: " + rows.length);
}
  function restorePanel() {
    var panel = document.getElementById(CONFIG.panelId);
    var toggle = document.getElementById(CONFIG.toggleId);
    if (!panel || !toggle) return;
    panel.style.display = "block";
    toggle.classList.remove("sp-toggle-visible");
  }

  function getCandidateRows() {
    var rows = Array.prototype.slice.call(document.querySelectorAll("tr"));

    return rows.filter(function (row) {
      if (!isVisible(row)) return false;
      if (row.closest("#" + CONFIG.panelId)) return false;

      var text = normalizeText(row.innerText);
      if (!text) return false;

      var upper = text.toUpperCase();
      if (
        upper.indexOf("KIHT") !== -1 ||
        upper.indexOf("PAK") !== -1 ||
        upper.indexOf("LIIMIMISE") !== -1 ||
        upper.indexOf("PEALISPINNA") !== -1 ||
        upper.indexOf("STRUKTUUR") !== -1
      ) {
        return false;
      }

      if (!/\b\d{3,4}x\d{3,4}\b/i.test(text)) return false;

      return true;
    });
  }

  function addCheckboxes() {
  var rows = getCandidateRows();
  var count = 0;

  rows.forEach(function (row) {
    var hasExistingCheckbox = !!row.querySelector("." + CONFIG.checkboxClass);
    if (row.getAttribute(CONFIG.injectedFlag) === "1" && hasExistingCheckbox) return;

    // если флаг остался после ререндера, а checkbox исчез — переинжектим
    row.setAttribute(CONFIG.injectedFlag, "1");

    var checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = CONFIG.checkboxClass;

    checkbox.addEventListener("click", function (e) {
      e.stopPropagation();
    });

    checkbox.addEventListener("change", function () {
  var rowKey = getRowKey(row);
  var size = extractSize(row.innerText);

  if (checkbox.checked) {
    row.classList.add("sp-highlight-row");
    manuallyUncheckedRows.delete(rowKey);
  } else {
    row.classList.remove("sp-highlight-row");

    if (!isApplyingDimensionSelection && selectedDimensions.has(size)) {
      manuallyUncheckedRows.add(rowKey);
    }
  }

  scheduleAutoCalculate();
});

    var wrap = document.createElement("span");
    wrap.className = "sp-checkbox-wrap";
    wrap.appendChild(checkbox);

    var firstCell = row.children[0];
    if (!firstCell) return;

    /* Mark cell so CSS can target it safely */
    firstCell.setAttribute("data-spooni-cell", "1");

    /* Prevent double injection */
    if (firstCell.querySelector(".sp-checkbox-wrap")) return;

    /* Attach checkbox wrapper */
    firstCell.appendChild(wrap);

    count++;
  });

  setStatus("Checkboxes added: " + count);
}

  function removeCheckboxes(keepResults) {
    var checkboxes = document.querySelectorAll("." + CONFIG.checkboxClass);
    checkboxes.forEach(function (cb) {
      var row = cb.closest("[" + CONFIG.injectedFlag + '="1"]');
      if (row) {
        row.classList.remove("sp-highlight-row");
        row.removeAttribute(CONFIG.injectedFlag);
      }
      var wrap = cb.closest(".sp-checkbox-wrap");
      if (wrap) wrap.remove();
      else cb.remove();
    });

    if (!keepResults) setStatus("Checkboxes removed.");
  }

  function toggleCheckboxes() {
    var existing = document.querySelectorAll("." + CONFIG.checkboxClass);
    if (existing.length > 0) {
      removeCheckboxes(true);
      setStatus("Checkboxes removed.");
    } else {
      addCheckboxes();
    }
  }

  function getCheckedRows() {
    return Array.prototype.slice.call(document.querySelectorAll("." + CONFIG.checkboxClass + ":checked"))
      .map(function (cb) {
        return cb.closest("[" + CONFIG.injectedFlag + '="1"]');
      })
      .filter(Boolean);
  }

  function getCells(row) {
    return Array.prototype.slice.call(row.querySelectorAll("td, th"));
  }

  function extractThickness(row) {
    var cells = getCells(row);

    if (cells[1]) {
      var second = normalizeText(cells[1].innerText);
      if (/^\d+(?:[.,]\d+)?$/.test(second)) {
        var v2 = parseNumber(second);
        if (v2 > 0 && v2 < 100) return v2;
      }
    }

    for (var i = 0; i < cells.length; i++) {
      var txt = normalizeText(cells[i].innerText);
      if (/^\d+(?:[.,]\d+)?$/.test(txt)) {
        var val = parseNumber(txt);
        if (val > 0 && val < 100) return val;
      }
    }

    var rowText = normalizeText(row.innerText);
    var mm = rowText.match(/\b(\d+(?:[.,]\d+)?)\s*mm\b/i);
    if (mm) return parseNumber(mm[1]);

    return 0;
  }

  function extractQty(row) {
  var cells = getCells(row);
  var allesolevIndex = findAllesolevKogusIndex();

  // Prefer "Allesolev kogus" column explicitly.
  if (allesolevIndex !== -1 && cells[allesolevIndex]) {
    var allesolevText = normalizeText(cells[allesolevIndex].innerText);
    if (/^\d+(?:[.,]\d+)?$/.test(allesolevText)) {
      var allesolevQty = parseNumber(allesolevText);
      if (allesolevQty >= 1 && allesolevQty <= 100000) return allesolevQty;
    }
  }

  // Backward-compatible fallback for pages where header detection fails.
  if (cells.length > 5) {
    var t = normalizeText(cells[5].innerText);
    if (/^\d+(?:[.,]\d+)?$/.test(t)) {
      var q5 = parseNumber(t);
      if (q5 >= 1 && q5 <= 100000) return q5;
    }
  }

  for (var i = cells.length - 1; i >= 0; i--) {
    var txt = normalizeText(cells[i].innerText);
    if (/^\d+(?:[.,]\d+)?$/.test(txt)) {
      var val = parseNumber(txt);
      if (val >= 1 && val <= 100000) return val;
    }
  }

  return 0;
}

  function extractFaceText(row) {
    var text = normalizeText(row.innerText).toUpperCase();
    var m = text.match(/\b(EWGFC|WGFC|BBFC)\/(EWGFC|WGFC|BBFC)\b/);
    return m ? m[0] : "";
  }

  function findStructureCellText(row) {
    var cells = getCells(row);

    for (var i = 0; i < cells.length; i++) {
      var txt = normalizeText(cells[i].innerText).toUpperCase();

      if (
        txt.indexOf("MM") !== -1 &&
        (txt.indexOf("I") !== -1 || txt.indexOf("E") !== -1 || txt.indexOf("-") !== -1)
      ) {
        return txt;
      }
    }

    return "";
  }

  function extractStructureText(row) {
    var txt = findStructureCellText(row);
    if (!txt) return "";

    var m = txt.match(/\b\d+(?:[.,]\d+)?\s*MM\b\s*(.*)$/i);
    var tail = m ? m[1] : txt;

    var structure = tail.replace(/[^IE\-]/g, "");
    return structure || "";
  }

  function hasSpecialStructure(structureText) {
    if (!structureText) return false;
    return structureText.indexOf("I") !== -1 && (
      structureText.indexOf("-") !== -1 || structureText.indexOf("E") !== -1
    );
  }
function extractVeneerQualityFromRow(row) {
  var text = normalizeText(row.innerText).toUpperCase();

  // Jätkamisliin markers
  if (text.indexOf("BCK2SCARF") !== -1) return "BCK2SCARF";
  if (text.indexOf("BCK3SCARF") !== -1) return "BCK3SCARF";

  // Pinnaspoon markers
  if (text.indexOf("BBFC") !== -1) return "BBFC";
  if (text.indexOf("EWGFC") !== -1 || text.indexOf("WGFC") !== -1) return "EWGFC";

  return "";
}
  function countSpecialStructure(structureText) {
    var chars = String(structureText).replace(/[^IE\-]/g, "");

    var iCount = (chars.match(/I/g) || []).length;
    var eCount = (chars.match(/E/g) || []).length;
    var dashCount = (chars.match(/\-/g) || []).length;

    var pinnaspoon = iCount >= 2 ? 2 : iCount;
    var vahespoon = iCount > 2 ? (iCount - 2) : 0;

    return {
      pinnaspoon: pinnaspoon,
      vahespoon: vahespoon,
      jatkuspoon: eCount + dashCount,
      k2: eCount,
      k3: dashCount
    };
  }

  function countStandardStructure(thickness) {
    var jatkuspoon = Math.round(thickness / 3);
    var vahespoon = jatkuspoon - 1;
    if (vahespoon < 0) vahespoon = 0;

    return {
      pinnaspoon: 2,
      vahespoon: vahespoon,
      jatkuspoon: jatkuspoon,
      k2: 0,
      k3: jatkuspoon
    };
  }

  function getFaceCounts(faceText, pinnaspoonCount) {
    var face = (faceText || "").toUpperCase();
    var bb = 0;
    var ewg = 0;

    if (!face) {
      ewg = pinnaspoonCount;
      return { ewg: ewg, bb: bb };
    }

    if (face.indexOf("BBFC/BBFC") !== -1) {
      bb = pinnaspoonCount;
      return { ewg: 0, bb: bb };
    }

    if (
      face.indexOf("BBFC/WGFC") !== -1 ||
      face.indexOf("WGFC/BBFC") !== -1 ||
      face.indexOf("BBFC/EWGFC") !== -1 ||
      face.indexOf("EWGFC/BBFC") !== -1
    ) {
      if (pinnaspoonCount >= 2) {
        bb = 1;
        ewg = pinnaspoonCount - 1;
      } else {
        bb = 1;
      }
      return { ewg: ewg, bb: bb };
    }

    ewg = pinnaspoonCount;
    return { ewg: ewg, bb: bb };
  }

  function calculateRow(row) {
    var rowText = normalizeText(row.innerText);
    var size = extractSize(rowText);
    var thickness = extractThickness(row);
    var qty = extractQty(row);
    var structureText = extractStructureText(row);
    var faceText = extractFaceText(row);

    if (!thickness) throw new Error("thickness not found");
    if (!qty) throw new Error("qty not found");

    var counts;
    if (hasSpecialStructure(structureText)) {
      counts = countSpecialStructure(structureText);
    } else {
      counts = countStandardStructure(thickness);
    }

    var faceCounts = getFaceCounts(faceText, counts.pinnaspoon);

    var parts = size.split("x");
    var width = parseFloat(parts[0]) / 1000;
    var length = parseFloat(parts[1]) / 1000;
    var m3 = 0;
    if (parts.length === 2 && isFinite(width) && isFinite(length)) {
      m3 = width * length * (thickness / 1000) * qty;
    }

    return {
      size: size,
      qty: qty,
      pinnaspoon_ewg: faceCounts.ewg * qty,
      pinnaspoon_bb: faceCounts.bb * qty,
      jatkuspoon_k2: counts.k2 * qty,
      jatkuspoon_k3: counts.k3 * qty,
      vahespoon: counts.vahespoon * qty,
      m3: m3
    };
  }

  function ensureBucket(result, size) {
    if (!result[size]) {
      result[size] = {
        orders: 0,
        qty: 0,
        pinnaspoon_ewg: 0,
        pinnaspoon_bb: 0,
        jatkuspoon_k2: 0,
        jatkuspoon_k3: 0,
        vahespoon: 0,
        m3: 0
      };
    }
  }


function formatResultBlock(title, data, isTotal) {
  var safeTitle = escapeHtml(title);
  // ✅ TOTAL block: only Orders, Qty, m³
  if (isTotal) {
    return `
      <div class="sp-result-block total">
        <div class="sp-result-title">${safeTitle}</div>

        <div class="sp-result-row">
          <span>Orders</span>
          <strong>${data.orders}</strong>
        </div>

        <div class="sp-result-row">
          <span>Qty</span>
          <strong>${data.qty}</strong>
        </div>

        <div class="sp-result-row total-line">
          <span>m³</span>
          <strong>${data.m3.toFixed(3)}</strong>
        </div>
      </div>
    `;
  }

  // ✅ Normal dimension block: full details
  return `
    <div class="sp-result-block">
      <div class="sp-result-title">${safeTitle}</div>

      <div class="sp-result-row"><span>Orders</span><strong>${data.orders}</strong></div>
      <div class="sp-result-row"><span>Qty</span><strong>${data.qty}</strong></div>

      <div class="sp-result-row"><span>Pinnaspoon EWG</span><strong>${data.pinnaspoon_ewg}</strong></div>
      <div class="sp-result-row"><span>Pinnaspoon BB</span><strong>${data.pinnaspoon_bb}</strong></div>

      <div class="sp-result-row"><span>Jätkuspoon K2</span><strong>${data.jatkuspoon_k2}</strong></div>
      <div class="sp-result-row"><span>Jätkuspoon K3</span><strong>${data.jatkuspoon_k3}</strong></div>

      <div class="sp-result-row"><span>Vahespoon</span><strong>${data.vahespoon}</strong></div>

      <div class="sp-result-row total-line">
        <span>m³</span>
        <strong>${data.m3.toFixed(3)}</strong>
      </div>
    </div>
  `;
}



// ===== MAIN CALCULATION =====
function calculateSelected() {
  var rows = getCheckedRows();
  if (!rows.length) {
    setResults("<div class='sp-empty'>Select rows to see calculation.</div>");
    setStatus("Waiting for selection...");
    return;
  }

  var result = {};
  var errors = [];

  rows.forEach(function (row, index) {
    try {
      var r = calculateRow(row);
      ensureBucket(result, r.size);

      result[r.size].orders += 1;
      result[r.size].qty += r.qty;
      result[r.size].pinnaspoon_ewg += r.pinnaspoon_ewg;
      result[r.size].pinnaspoon_bb += r.pinnaspoon_bb;
      result[r.size].jatkuspoon_k2 += r.jatkuspoon_k2;
      result[r.size].jatkuspoon_k3 += r.jatkuspoon_k3;
      result[r.size].vahespoon += r.vahespoon;
      result[r.size].m3 += r.m3;
    } catch (e) {
      errors.push(
        escapeHtml(
          (index + 1) +
          ". " +
          normalizeText(row.innerText).slice(0, 80) +
          " – " +
          e.message
        )
      );
    }
  });

  // ===== BUILD HTML OUTPUT =====
  var html = "";
  var total = {
    orders: 0,
    qty: 0,
    pinnaspoon_ewg: 0,
    pinnaspoon_bb: 0,
    jatkuspoon_k2: 0,
    jatkuspoon_k3: 0,
    vahespoon: 0,
    m3: 0
  };

  Object.keys(result).forEach(function (size) {
    var r = result[size];

    html += formatResultBlock(size.replace("x", "×"), r, false);

    total.orders += r.orders;
    total.qty += r.qty;
    total.pinnaspoon_ewg += r.pinnaspoon_ewg;
    total.pinnaspoon_bb += r.pinnaspoon_bb;
    total.jatkuspoon_k2 += r.jatkuspoon_k2;
    total.jatkuspoon_k3 += r.jatkuspoon_k3;
    total.vahespoon += r.vahespoon;
    total.m3 += r.m3;
  });

  html += formatResultBlock("TOTAL", total, true);

  if (errors.length) {
    html += `
      <div class="sp-result-errors">
        <strong>Errors (${errors.length})</strong><br>
        ${errors.join("<br>")}
      </div>`;
  }

  setResults(html);
  setStatus("Done. Orders: " + rows.length + ", errors: " + errors.length);
}


  function clearAll() {
  var checkboxes = document.querySelectorAll("." + CONFIG.checkboxClass);
  checkboxes.forEach(function (cb) { cb.checked = false; });

  var rows = document.querySelectorAll("[" + CONFIG.injectedFlag + '="1"]');
  rows.forEach(function (row) { row.classList.remove("sp-highlight-row"); });

  selectedDimensions.clear();
  manuallyUncheckedRows.clear();
  renderDimensionDropdown();

  setResults("Select rows and press Calculate.");
  setStatus("Cleared.");
}

  function copyResults() {
    var text = document.getElementById("sp-results").innerText;
    navigator.clipboard.writeText(text).then(function () {
      setStatus("Copied.");
    }).catch(function () {
      setStatus("Copy failed.");
    });
  }

  createUI();
})();
/* VSO Order app - UI, local storage, signatures and PDF export */
(function () {
  "use strict";
  var V = window.VSO;
  var STORE = "vso.orders.v1";
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- storage ---------- */
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch (e) { return []; }
  }
  function saveAll(list) {
    try { localStorage.setItem(STORE, JSON.stringify(list)); return true; }
    catch (e) { toast("Could not save - phone storage is full."); return false; }
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  var orders = load();
  var current = null; /* {id, updated, data} */

  /* ---------- form schema ---------- */
  var T = function (key, label, o) { return Object.assign({ key: key, label: label, type: "text" }, o || {}); };
  var SECTIONS = [
    { title: "1. Order & outlet", open: true, fields: [
      T("orderno", "Order No. (e.g. B888934)"), T("date", "Date", { type: "date" }),
      T("outlet_code", "Outlet Code"), T("outlet_address", "Outlet Address", { type: "textarea" }),
      T("sa_name", "SA's Name"), T("sa_staff", "SA's Staff No.")] },
    { title: "2. Customer", open: true, fields: [
      T("name", "Name", { ph: "Wan Jasni" }), T("cust_id", "Customer's ID"), T("ic", "IC / Biz Reg / Passport No"),
      T("address", "Address", { type: "textarea" }), T("postcode", "Post Code", { mode: "numeric" }),
      T("email", "Email", { type: "email" }), T("tel_mobile", "Tel (Mobile)", { type: "tel", ph: "012-345 6789" }),
      T("tel_home", "Tel (Home)", { type: "tel", ph: "03-1234 5678" }), T("tel_office", "Tel (Office)", { type: "tel", ph: "03-8765 4321" })] },
    { title: "3. Vehicle", fields: [
      T("model_code", "Model Code"), T("model_desc", "Model Description"),
      T("colour_code", "Colour Code"), T("colour_desc", "Colour Description"),
      T("reg_type", "Registration Type", { type: "select", options: ["", "PI", "PC", "CC"] }),
      T("pay_type", "Payment Type", { type: "select", options: ["", "CASH", "HP"] }),
      T("hp_company", "Hire Purchase / Leasing Company"), T("delivery", "Estimated Delivery Date", { type: "date" })] },
    { title: "4. Price & accessories", custom: "pricing" },
    { title: "5. Fees & insurance", custom: "fees" },
    { title: "6. Trade-in vehicle", fields: [
      T("ti_model", "Model Description"), T("ti_reg", "Registration No"),
      T("ti_year_reg", "Year of Registration", { mode: "numeric" }), T("ti_year_mfg", "Year of Manufacture", { mode: "numeric" }),
      T("ti_appraisal", "Appraisal Number"),
      T("tender_yn", "Tender Registration", { type: "select", options: ["", "Yes", "No"] }), T("tender_no", "Tender Registration No."),
      T("tax_yn", "Tax Exemption", { type: "select", options: ["", "Yes", "No"] })] },
    { title: "7. Totals & payment", custom: "totals" },
    { title: "8. Booking, remarks & signatures", custom: "signoff" }
  ];

  /* ---------- builders ---------- */
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") e.textContent = attrs[k];
      else if (k === "html") e.innerHTML = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (k) { if (k) e.appendChild(k); });
    return e;
  }
  function field(f) {
    var input;
    if (f.type === "select") {
      input = el("select", { "data-k": f.key });
      f.options.forEach(function (o) { input.appendChild(el("option", { value: o, text: o || "- select -" })); });
    } else if (f.type === "textarea") {
      input = el("textarea", { "data-k": f.key, rows: "3" });
      if (f.ph) input.setAttribute("placeholder", f.ph);
    } else {
      input = el("input", { "data-k": f.key, type: f.type });
      if (f.ph) input.setAttribute("placeholder", f.ph);
      if (f.mode) input.setAttribute("inputmode", f.mode);
    }
    if (f.type !== "select" && V.isCapsKey(f.key)) input.setAttribute("autocapitalize", "characters");
    return el("label", { class: "f" }, [el("span", { html: "" }, [document.createTextNode(f.label), star(f.key)]), input]);
  }
  /* red * after the label of a required field */
  var REQ = {};
  V.REQUIRED.forEach(function (r) { REQ[r[0]] = 1; });
  function star(key) {
    if (!REQ[key]) return null;
    return el("b", { class: "req", text: " *", title: "Required" });
  }
  function moneyRow(key, label, code, o) {
    o = o || {};
    var left = o.freeLabel
      ? el("input", { class: "lblin", "data-k": key + "_label", autocapitalize: "characters", placeholder: o.placeholder || "Other item (type name)" })
      : el("div", { class: "lbl" }, [code ? el("span", { class: "code", text: code }) : null, document.createTextNode(label), star(key)]);
    var inp = el("input", { "data-k": key, type: "text", inputmode: o.text ? "text" : "decimal", placeholder: o.ph || "0.00" });
    if (o.pct) inp.setAttribute("placeholder", "%");
    else inp.setAttribute("data-amt", "1"); /* price field: shown as 89,000.00 */
    if (o.text) { inp.setAttribute("placeholder", "Amount or text"); inp.setAttribute("autocapitalize", "characters"); inp.style.textAlign = "left"; }
    return el("div", { class: "money" }, [left, inp]);
  }
  function calcLine(id, label, big) {
    var lab = el("span", { text: label });
    if (id === "c_totSales" || id === "c_dueCust") lab.appendChild(el("b", { class: "req", text: " *", title: "Required" }));
    return el("div", { class: "calc" + (big ? " big" : "") }, [lab, el("span", { id: id, text: "-" })]);
  }
  function sub(text) { return el("div", { class: "sub", text: text }); }
  function hint(text) { return el("div", { class: "hint", text: text }); }

  function customBody(kind) {
    var b = [];
    if (kind === "pricing") {
      b.push(moneyRow("selling", "SELLING PRICE", "", { ph: "CAR ORIGINAL PRICE" }), moneyRow("pearl", "Pearl White", "", { text: true }), moneyRow("metallic", "Metallic Paint", "", { text: true }));
      b.push(hint("Pearl White / Metallic Paint: type an amount (added to the total) or words, e.g. \"Yes\" or \"Included\" (printed as typed, not added)."));
      b.push(sub("Accessories"));
      V.ACC.forEach(function (a) { b.push(moneyRow(V.accKey(a[0]), a[1], a[0])); });
      b.push(moneyRow("acc_x1", "", "", { freeLabel: true }), moneyRow("acc_x2", "", "", { freeLabel: true }));
      b.push(calcLine("c_totAcc", "Total Accessories"));
      b.push(sub("Sales contracting"));
      b.push(moneyRow("sales_20", "Sign Writing / Partition", "20"));
      b.push(moneyRow("sales_x1", "", "", { freeLabel: true }), moneyRow("sales_x2", "", "", { freeLabel: true }));
      b.push(calcLine("c_totSc", "Total Sales Contracting"));
    } else if (kind === "fees") {
      b.push(moneyRow("reg_fee", "Registration / Ownership Endorsement Fee"), moneyRow("road_tax", "Road Tax / Haulage Permit Fee"),
        moneyRow("puspakom", "Puspakom Inspection Fee"), moneyRow("freight", "Freight / Marine / Insurance / Handling"),
        moneyRow("ins_amt", "Insurance - Amount Insured", "", { ph: "Amount yg Di Insurans Kan" }), moneyRow("ins_prem", "Insurance Premium"),
        moneyRow("ncd", "Less NCD (%)", "", { pct: true }));
      b.push(calcLine("c_netIns", "Net Insurance Premium"));
      b.push(hint("Net Insurance Premium = Insurance Premium x (1 - NCD%)."));
    } else if (kind === "totals") {
      b.push(calcLine("c_totSales", "TOTAL SALES PRICE"));
      b.push(moneyRow("discount", "Less Total Discount"));
      b.push(calcLine("c_invBefore", "Invoice value before trade-in"));
      b.push(moneyRow("tradein", "Less Trade-in"));
      b.push(calcLine("c_totInv", "TOTAL INVOICE VALUE"));
      b.push(moneyRow("hp_settle", "Add HP Settlement of Trade-in"), moneyRow("booking", "Less Booking Fee(s) Paid"));
      b.push(calcLine("c_totDue", "Total Amount Due"));
      b.push(moneyRow("loan", "Loan Amount Due"));
      b.push(calcLine("c_dueCust", "AMOUNT DUE FROM / (TO) CUSTOMER", true));
      b.push(hint("Enter discount, trade-in, booking fee and loan as positive numbers - they are deducted automatically."));
      b.push(sub("Hire purchase terms"));
      b.push(el("div", { class: "row2" }, [
        field(T("hp_rate", "Interest (% p.a.)", { mode: "decimal" })), field(T("hp_months", "Tenure (months)", { mode: "numeric" }))]));
    } else if (kind === "signoff") {
      b.push(field(T("draft_no", "Booking paid vide Cash / Cheque / Credit card Sales Draft No.")));
      b.push(field(T("receipt", "Receipt No.")));
      b.push(field(T("remarks", "Remarks", { type: "textarea", ph: "Loan Amount?\nTenure?" })));
      b.push(sub("Authorised executive"));
      b.push(field(T("sig_name", "Name")), field(T("sig_desig", "Designation")));
      b.push(sigPad("sig_customer", "Customer signature"), sigPad("sig_exec", "Authorised executive signature"));
      b.push(hint("Signatures are optional - you can also sign on the printed copy."));
    }
    return b;
  }

  function buildForm() {
    var form = $("form");
    form.innerHTML = "";
    SECTIONS.forEach(function (s) {
      var body = el("div", { class: "sec-body" }, s.custom ? customBody(s.custom) : s.fields.map(field));
      var d = el("details", { class: "sec" }, [el("summary", { text: s.title }), body]);
      if (s.open) d.open = true;
      form.appendChild(d);
    });
    form.addEventListener("input", onInput);
    form.addEventListener("change", onInput);
    /* price fields: plain number while typing, 89,000.00 once you leave the field (words are left alone) */
    form.addEventListener("focusin", function (e) {
      var t = e.target;
      if (t.getAttribute && t.getAttribute("data-amt") && V.isNumText(t.value)) t.value = t.value.replace(/,/g, "");
    });
    /* phone numbers: tidy into Malaysian format when you leave the field (012-345 6789, 03-1234 5678) */
    form.addEventListener("focusout", function (e) {
      var t = e.target, k = t.getAttribute && t.getAttribute("data-k");
      if ((k !== "tel_home" && k !== "tel_mobile" && k !== "tel_office") || !current) return;
      var f = V.formatTel(t.value);
      if (f === t.value) return;
      t.value = f;
      current.data[k] = f;
      scheduleSave();
    });
    form.addEventListener("focusout", function (e) {
      var t = e.target;
      if (!t.getAttribute || !t.getAttribute("data-amt") || !current) return;
      var f = fmtPrice(t.value);
      if (f === null || f === t.value) return;
      t.value = f;
      current.data[t.getAttribute("data-k")] = f;
      refreshCalc();
      scheduleSave();
    });
  }
  /* "89000" -> "89,000.00", "1234.5" -> "1,234.50"; null when blank or not a number */
  function fmtPrice(v) {
    if (!V.isNumText(v)) return null;
    var n = V.num(v);
    return (n < 0 ? "-" : "") + V.money(n);
  }

  /* ---------- signature pads ---------- */
  var pads = {};
  function sigPad(key, label) {
    var canvas = el("canvas", { "data-sig": key });
    var clear = el("button", { type: "button", class: "small", text: "Clear" });
    var wrap = el("div", { class: "sig" }, [el("div", { class: "f" }, [el("span", { text: label })]), canvas,
      el("div", { class: "sigbar" }, [el("span", { text: "Sign with finger" }), clear])]);
    var ctx, drawing = false, dirty = false;
    function setup() {
      var r = canvas.getBoundingClientRect();
      if (!r.width) return false;
      var ratio = Math.max(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(r.width * ratio); canvas.height = Math.round(r.height * ratio);
      ctx = canvas.getContext("2d");
      ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0a2a8a";
      var img = current && current.data[key];
      if (img) { var im = new Image(); im.onload = function () { ctx.drawImage(im, 0, 0, r.width, r.height); }; im.src = img; }
      return true;
    }
    function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    canvas.addEventListener("pointerdown", function (e) {
      if (!ctx && !setup()) return;
      drawing = true; canvas.setPointerCapture(e.pointerId);
      var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.1, p.y + 0.1); ctx.stroke();
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!drawing) return; var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); dirty = true;
    });
    function end() {
      if (!drawing) return; drawing = false;
      if (current) { current.data[key] = canvas.toDataURL("image/png"); scheduleSave(); }
    }
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    clear.addEventListener("click", function () {
      if (!ctx) setup();
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (current) { delete current.data[key]; scheduleSave(); }
    });
    pads[key] = { reset: function () { ctx = null; var c2 = canvas.getContext("2d"); c2.setTransform(1, 0, 0, 1, 0, 0); c2.clearRect(0, 0, canvas.width, canvas.height); },
      setup: setup };
    return wrap;
  }

  /* ---------- binding ---------- */
  function fillForm(data) {
    document.querySelectorAll("#form [data-k]").forEach(function (inp) {
      var v = data[inp.getAttribute("data-k")];
      inp.value = v === undefined || v === null ? "" : v;
      if (inp.getAttribute("data-amt")) { var f = fmtPrice(inp.value); if (f !== null) inp.value = f; }
      if (/^tel_(home|mobile|office)$/.test(inp.getAttribute("data-k"))) inp.value = V.formatTel(inp.value);
    });
    Object.keys(pads).forEach(function (k) { pads[k].reset(); });
    setTimeout(function () {
      document.querySelectorAll("details.sec[open] canvas").forEach(function (c) { pads[c.getAttribute("data-sig")].setup(); });
    }, 50);
    refreshCalc();
  }
  document.addEventListener("toggle", function (e) {
    if (e.target.matches && e.target.matches("details.sec") && e.target.open) {
      e.target.querySelectorAll("canvas[data-sig]").forEach(function (c) { pads[c.getAttribute("data-sig")].setup(); });
    }
  }, true);

  function onInput(e) {
    var k = e.target.getAttribute && e.target.getAttribute("data-k");
    if (!k || !current) return;
    var t = e.target;
    /* typed text becomes CAPITAL letters, except email, dates, dropdowns and signatures */
    if (V.isCapsKey(k) && (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && /^(text|tel)$/.test(t.type)))) {
      var up = t.value.toUpperCase();
      if (up !== t.value) {
        var s = t.selectionStart, en = t.selectionEnd;
        t.value = up;
        try { t.setSelectionRange(s, en); } catch (err) { /* not selectable */ }
      }
    }
    current.data[k] = t.value;
    if (k === "address") autoPostcode();
    if (t.classList.contains("invalid") && String(t.value).trim() !== "") t.classList.remove("invalid");
    refreshCalc();
    scheduleSave();
  }
  /* A 5-digit number typed in the customer address fills Post Code. Only the value the app filled itself
     is replaced or cleared, so a post code the user typed by hand is never overwritten. */
  function setValue(key, val) {
    current.data[key] = val;
    var n = fieldEl(key);
    if (n) { n.value = val; if (val) n.classList.remove("invalid"); }
  }
  function autoPostcode() {
    var d = current.data, pc = V.postcodeFromAddress(d.address);
    var cur = d.postcode || "", auto = d.pc_auto || "";
    if (pc) {
      if (cur === "" || cur === auto) { setValue("postcode", pc); d.pc_auto = pc; }
    } else if (auto && cur === auto) {
      setValue("postcode", ""); d.pc_auto = "";
    }
  }
  function rm(n) { return (n < 0 ? "(RM " + V.money(n) + ")" : "RM " + V.money(n)); }
  function refreshCalc() {
    if (!current) return;
    var c = V.compute(current.data);
    ["totAcc", "totSc", "netIns", "totSales", "invBefore", "totInv", "totDue", "dueCust"].forEach(function (k) {
      var n = $("c_" + k); if (n) n.textContent = rm(c[k]);
    });
    $("dueVal").textContent = rm(c.dueCust);
  }

  var saveTimer = null;
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveCurrent, 300); }
  function saveCurrent() {
    if (!current) return;
    current.updated = Date.now();
    var i = orders.findIndex(function (o) { return o.id === current.id; });
    if (i < 0) orders.unshift(current); else orders[i] = current;
    saveAll(orders);
  }

  /* ---------- views ---------- */
  function showList() {
    saveCurrent();
    current = null;
    $("listView").hidden = false; $("editView").hidden = true; $("editBar").hidden = true;
    $("backBtn").hidden = true; $("menuBtn").hidden = true; $("title").textContent = "VSO Orders";
    renderList();
    window.scrollTo(0, 0);
  }
  function renderList() {
    orders.sort(function (a, b) { return b.updated - a.updated; });
    var box = $("orderList"); box.innerHTML = "";
    $("emptyMsg").hidden = orders.length > 0;
    orders.forEach(function (o) {
      var d = o.data, c = V.compute(d);
      var info = el("div", { class: "info" }, [
        el("div", { class: "name", text: d.name || "(no name yet)" }),
        el("div", { class: "meta", text: [d.orderno, d.model_desc, V.fmtDate(d.date)].filter(Boolean).join(" | ") || "Draft" }),
        el("div", { class: "amt", text: "Due: " + rm(c.dueCust) })]);
      var dup = el("button", { class: "small", text: "Copy" });
      var del = el("button", { class: "small danger", text: "Delete" });
      var card = el("div", { class: "order" }, [info, el("div", { class: "acts" }, [dup, del])]);
      info.addEventListener("click", function () { openOrder(o.id); });
      dup.addEventListener("click", function () {
        var copy = { id: uid(), updated: Date.now(), data: JSON.parse(JSON.stringify(o.data)) };
        delete copy.data.sig_customer; delete copy.data.sig_exec; copy.data.orderno = ""; copy.data.date = V.today();
        orders.unshift(copy); saveAll(orders); renderList(); toast("Copied - signatures and order no. cleared");
      });
      del.addEventListener("click", function () {
        if (!confirm("Delete the order for " + (d.name || "this customer") + "? This cannot be undone.")) return;
        orders = orders.filter(function (x) { return x.id !== o.id; }); saveAll(orders); renderList();
      });
      box.appendChild(card);
    });
  }
  function openOrder(id) {
    var o = orders.find(function (x) { return x.id === id; });
    if (!o) return;
    current = o;
    $("listView").hidden = true; $("editView").hidden = false; $("editBar").hidden = false;
    $("backBtn").hidden = false; $("title").textContent = "Retail Customer Order";
    fillForm(o.data);
    window.scrollTo(0, 0);
    location.hash = "#edit";
  }
  function newOrder() {
    var o = { id: uid(), updated: Date.now(), data: V.emptyOrder() };
    var last = orders[0] && orders[0].data;
    if (last) ["outlet_code", "sa_name", "sa_staff", "sig_name", "sig_desig"].forEach(function (k) {
      if (last[k]) o.data[k] = last[k];
    });
    orders.unshift(o); saveAll(orders);
    openOrder(o.id);
  }

  /* ---------- PDF ---------- */
  function makePdf() {
    var doc = V.buildPdf(window.jspdf.jsPDF, current.data);
    var name = V.fileName(current.data);
    var blob = doc.output("blob");
    return { blob: blob, name: name };
  }
  /* ---------- required fields ---------- */
  function fieldEl(key) { return document.querySelector('#form [data-k="' + key + '"]'); }
  function markInvalid(missing) {
    document.querySelectorAll("#form .invalid").forEach(function (n) { n.classList.remove("invalid"); });
    missing.forEach(function (m) { var n = fieldEl(m.key); if (n) n.classList.add("invalid"); });
  }
  function jumpTo(key) {
    var n = fieldEl(key); if (!n) return;
    var sec = n.closest("details"); if (sec) sec.open = true;
    closeSheet();
    setTimeout(function () { n.scrollIntoView({ block: "center", behavior: "smooth" }); n.focus({ preventScroll: true }); }, 80);
  }
  function showMissing(missing) {
    $("sheetTitle").textContent = "Please fill in (" + missing.length + ")";
    var body = $("sheetBody"); body.innerHTML = "";
    body.appendChild(el("div", { class: "fname", text: "These required fields are marked * in red. Tap one to go to it." }));
    var list = el("div", { class: "missing" });
    missing.forEach(function (m) {
      var b = el("button", { type: "button", class: "miss", text: m.label + " - " + m.msg });
      b.addEventListener("click", function () { jumpTo(m.key); });
      list.appendChild(b);
    });
    body.appendChild(list);
    $("sheet").hidden = false;
    var first = fieldEl(missing[0].key);
    if (first) { var sec = first.closest("details"); if (sec) sec.open = true; }
  }
  function openSheet() {
    saveCurrent();
    var missing = V.validate(current.data);
    markInvalid(missing);
    if (missing.length) { showMissing(missing); return; }
    var p;
    try { p = makePdf(); } catch (e) { toast("Could not create PDF: " + e.message); return; }
    var url = URL.createObjectURL(p.blob);
    $("sheetTitle").textContent = "Export PDF (A4)";
    var body = $("sheetBody"); body.innerHTML = "";
    body.appendChild(el("div", { class: "fname", text: p.name + "  (" + Math.round(p.blob.size / 1024) + " KB, A4 1 page)" }));
    var dl = el("a", { class: "primary act", href: url, download: p.name, text: "Download PDF" });
    body.appendChild(dl);
    var file = null;
    try { file = new File([p.blob], p.name, { type: "application/pdf" }); } catch (e) { /* old browser */ }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      var sh = el("button", { class: "primary act sec2", type: "button", text: "Share (WhatsApp, Email, Drive...)" });
      sh.addEventListener("click", function () {
        navigator.share({ files: [file], title: p.name }).catch(function (e) { if (e.name !== "AbortError") toast("Share failed: " + e.message); });
      });
      body.appendChild(sh);
    }
    var op = el("a", { class: "primary act sec2", href: url, target: "_blank", rel: "noopener", text: "Open / Print" });
    body.appendChild(op);
    $("sheet").hidden = false;
    $("sheet").dataset.url = url;
  }
  function closeSheet() {
    $("sheet").hidden = true;
    var u = $("sheet").dataset.url;
    if (u) setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
  }

  var toastTimer;
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /* ---------- wire up ---------- */
  buildForm();
  $("newBtn").addEventListener("click", newOrder);
  $("backBtn").addEventListener("click", function () { if (location.hash === "#edit") history.back(); else showList(); });
  $("pdfBtn").addEventListener("click", openSheet);
  $("sheetClose").addEventListener("click", closeSheet);
  $("sheet").addEventListener("click", function (e) { if (e.target.id === "sheet") closeSheet(); });
  window.addEventListener("hashchange", function () { if (location.hash !== "#edit" && current) showList(); });
  window.addEventListener("pagehide", saveCurrent);
  document.addEventListener("visibilitychange", function () { if (document.hidden) saveCurrent(); });
  if (location.hash === "#edit") history.replaceState(null, "", location.pathname);
  showList();

  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol) && !window.__VSO_STANDALONE) {
    navigator.serviceWorker.register("sw.js").catch(function () { /* offline cache unavailable */ });
  }
  window.__vso = { orders: function () { return orders; }, makePdf: function () { return makePdf(); } };
})();

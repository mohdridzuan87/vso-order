/* VSO core: field definitions, calculations and A4 PDF drawing.
   Shared by the Android web app (browser) and the Node test script. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VSO = factory();
})(this, function () {
  "use strict";

  var COMPANY = "PANGLIMA CITY MOTOR SDN. BHD.";
  var CO_NO = "Co. No: 200401022811 (661316-P)";

  var ACC = [
    ["51", "Roof mounted Monitor & DVD-AVN"], ["52", "Roof mounted Monitor with DVD Combo"],
    ["53", "DVD-AVN with Reverse Camera"], ["57", "Sport Bar"], ["58", "Bedliner"],
    ["80", "Aerokit Pkg / TRD Sportivo Pkg"], ["83", "DVD-AVX with Reverse Camera"],
    ["88", "Premium Security Film"], ["89", "Essential Solar Film"], ["98", "Aerokit with DRL"],
    ["K3", "Digital Video Recorder"], ["K6", "USB Port"], ["P1/P3", "Panoramic View Monitor"],
    ["P2/P5", "DVD-AVN Pkg and PVM"]
  ];
  function accKey(code) { return "acc_" + code.replace("/", "_"); }

  var NOTES = [
    "1. Cash payment can only be made at the showroom premises for which a machine printed official receipt will be issued immediately.",
    "2. All cheques to be made payable to PANGLIMA CITY MOTOR SDN. BHD. and crossed \"A/C Payee Only - Not Negotiable\".",
    "3. If you do not receive an official receipt for any payment made to the company within 7 days, please notify Outlet Manager immediately.",
    "4. Interest charge on overdue amount is at the rate of 1.5% per month."
  ];
  var T_AGREE = "AGREEMENT: I/We, the undersigned, hereby agree to purchase from you the above mentioned vehicle and extras at the prices shown above subject to the terms and conditions printed overleaf which I/We have read, understood and agreed to be bound. I/We have paid a booking fee of:";
  var T_TRADE = "If vehicle is being traded in, I/We hereby confirm that to the best of my/our knowledge the particulars given above and all details given in the Used Vehicle Appraisal Record are true and accurate.";
  var T_PRICE = "I/We hereby confirm that the price of the above mentioned vehicle is subject to change in accordance with Clause 6 overleaf and therefore the governing price will be that prevailing at the time of delivery of the vehicle. In reference to the PDP Act, please refer to Clause 1 overleaf.";
  var T_VALID = "THIS ORDER IS NOT VALID UNLESS SIGNED BY AN AUTHORISED EXECUTIVE OF THE COMPANY.";

  function num(v) {
    if (v === null || v === undefined || v === "") return 0;
    var s = String(v).replace(/,/g, "").replace(/^\s*RM\s*/i, "").trim();
    if (s === "") return 0;
    var n = Number(s); /* strict: words like "Yes" or "2 tone" count as 0 */
    return isFinite(n) ? n : 0;
  }
  function isNumText(v) {
    if (v === null || v === undefined) return false;
    var s = String(v).replace(/,/g, "").replace(/^\s*RM\s*/i, "").trim();
    return s !== "" && isFinite(Number(s));
  }
  /* a number is shown as an amount; words are printed exactly as typed */
  function amtOrText(v) {
    if (v === null || v === undefined || String(v).trim() === "") return "";
    return isNumText(v) ? fmtAmt(v) : String(v).trim();
  }
  function round2(n) { return Math.round(n * 100) / 100; }

  function compute(d) {
    var totAcc = 0;
    ACC.forEach(function (a) { totAcc += num(d[accKey(a[0])]); });
    totAcc += num(d.acc_x1) + num(d.acc_x2);
    var totSc = num(d.sales_20) + num(d.sales_x1) + num(d.sales_x2);
    var netIns = num(d.ins_prem) * (1 - num(d.ncd) / 100);
    var totSales = num(d.selling) + num(d.pearl) + num(d.metallic) + totAcc + totSc +
      num(d.reg_fee) + num(d.road_tax) + num(d.puspakom) + num(d.freight) + netIns;
    var invBefore = totSales - num(d.discount);
    var totInv = invBefore - num(d.tradein);
    var totDue = totInv + num(d.hp_settle) - num(d.booking);
    var dueCust = totDue - num(d.loan);
    return {
      totAcc: round2(totAcc), totSc: round2(totSc), netIns: round2(netIns), totSales: round2(totSales),
      invBefore: round2(invBefore), totInv: round2(totInv), totDue: round2(totDue), dueCust: round2(dueCust)
    };
  }

  function money(n) {
    return Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  /* blank when zero or empty, like the Excel form */
  function fmtAmt(v, kind) {
    var n = num(v);
    if (v === "" || v === undefined || v === null || n === 0) return "";
    if (kind === "deduct") return "(" + money(n) + ")";
    return (n < 0 ? "(" : "") + money(n) + (n < 0 ? ")" : "");
  }
  function fmtDate(s) {
    if (!s) return "";
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    return m ? m[3] + "/" + m[2] + "/" + m[1] : String(s);
  }
  function today() {
    var t = new Date();
    return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
  }
  function emptyOrder() { return { date: today() }; }

  function fileName(d) {
    var parts = ["VSO", d.orderno || "", d.name || "", fmtDate(d.date).replace(/\//g, "-")];
    return parts.filter(Boolean).join("_").replace(/[^A-Za-z0-9_\-]+/g, "-").replace(/-+/g, "-").slice(0, 80) + ".pdf";
  }

  /* ---------------- PDF ---------------- */
  var PW = 595.28, PH = 841.89, M = 12;
  var LX = M, LW = 291, RX = 316, RW = PW - M - 316;
  var RED = [200, 16, 46];

  function draw(doc, d, RH) {
    var c = compute(d);
    var FS = Math.min(8.2, RH * 0.74);
    var y;

    function font(size, bold, color) {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      var col = color || [0, 0, 0];
      doc.setTextColor(col[0], col[1], col[2]);
    }
    function rect(x, yy, w, h, fill) {
      doc.setDrawColor(90, 90, 90); doc.setLineWidth(0.45);
      if (fill) { doc.setFillColor(fill[0], fill[1], fill[2]); doc.rect(x, yy, w, h, "FD"); }
      else doc.rect(x, yy, w, h, "S");
    }
    /* write text inside a box; shrinks to fit; single line is vertically centred */
    function txt(str, x, yy, w, h, o) {
      o = o || {};
      str = str === undefined || str === null ? "" : String(str);
      if (!str) return;
      var size = o.size || FS, pad = o.pad === undefined ? 2 : o.pad, lines;
      for (;;) {
        font(size, o.bold, o.color);
        lines = o.wrap === false ? [str] : doc.splitTextToSize(str, w - 2 * pad);
        var lh = size * 1.15;
        if ((lines.length * lh <= h + 0.5 && (o.wrap !== false || doc.getTextWidth(str) <= w - 2 * pad)) || size <= 4.5) break;
        size -= 0.25;
      }
      var lhh = size * 1.15;
      var ax = o.align === "right" ? x + w - pad : o.align === "center" ? x + w / 2 : x + pad;
      var by = lines.length === 1 && !o.top ? yy + h / 2 + size * 0.35 : yy + pad / 2 + size * 0.95;
      lines.forEach(function (ln, i) {
        doc.text(ln, ax, by + i * lhh, { align: o.align === "right" ? "right" : o.align === "center" ? "center" : "left" });
      });
    }
    function para(str, x, yy, w, size, bold) {
      font(size, bold);
      var lines = doc.splitTextToSize(str, w);
      lines.forEach(function (ln, i) { doc.text(ln, x, yy + size * 0.95 + i * size * 1.2); });
      return lines.length * size * 1.2;
    }
    function field(x, yy, lw, vw, h, label, value, o) {
      o = o || {};
      txt(label, x, yy, lw, Math.min(h, RH), { bold: true });
      rect(x + lw, yy, vw, h);
      txt(value, x + lw, yy, vw, h, { align: o.align });
    }

    /* header */
    font(23, true, RED); doc.text("TOYOTA", LX, 33);
    font(10.5, true); doc.text(COMPANY, LX, 47);
    font(6.8, true); doc.text(CO_NO, LX, 56);
    font(11, true); doc.text("RETAIL CUSTOMER ORDER", PW - M, 27, { align: "right" });
    font(9, true); doc.text("No.", PW - M - 118, 43, { align: "right" });
    rect(PW - M - 112, 34, 112, 13);
    txt(d.orderno, PW - M - 112, 34, 112, 13, { bold: true, size: 9 });

    /* customer + vehicle block */
    y = 64;
    var CL = 112, CV = LW - CL, RL = 112, RV = RW - RL;
    var left = [["Name:", d.name, 1], ["Customer's ID:", d.cust_id, 1], ["Address:", d.address, 3],
      ["Post Code:", d.postcode, 1], ["IC / Biz Reg / Passport No:", d.ic, 1], ["Email:", d.email, 1],
      ["Tel (Home):", d.tel_home, 1], ["Tel (Mobile):", d.tel_mobile, 1], ["Tel (Office):", d.tel_office, 1],
      ["SA's Name:", d.sa_name, 1], ["SA's Staff No.:", d.sa_staff, 1]];
    var right = [["Outlet Code:", d.outlet_code, 1], ["Date:", fmtDate(d.date), 1], ["Outlet Address:", d.outlet_address, 3],
      ["Model Code:", d.model_code, 1], ["Model Description:", d.model_desc, 1], ["Colour Code:", d.colour_code, 1],
      ["Colour Description:", d.colour_desc, 1], ["HP / Leasing Company:", d.hp_company, 1],
      ["Registration Type (PI / PC / CC):", d.reg_type, 1, "center"], ["Payment Type (CASH / HP):", d.pay_type, 1, "center"]];
    var yl = y;
    left.forEach(function (f) { field(LX, yl, CL, CV, f[2] * RH, f[0], f[1]); yl += f[2] * RH; });
    var yr = y;
    right.forEach(function (f) { field(RX, yr, RL, RV, f[2] * RH, f[0], f[1], { align: f[3] }); yr += f[2] * RH; });
    y = Math.max(yl, yr) + 0.6 * RH;

    /* pricing (left) */
    var AW = 98, DW = LW - AW;
    var py = y;
    rect(LX, py, DW, RH, RED); rect(LX + DW, py, AW, RH, RED);
    txt("DESCRIPTION", LX, py, DW, RH, { bold: true, color: [255, 255, 255] });
    txt("RM", LX + DW, py, AW, RH, { bold: true, color: [255, 255, 255], align: "center" });
    py += RH;
    function mrow(label, val, o) {
      o = o || {};
      rect(LX, py, DW, RH, o.fill); rect(LX + DW, py, AW, RH, o.fill);
      txt(label, LX, py, DW, RH, { bold: o.bold });
      txt(val, LX + DW, py, AW, RH, { align: "right", bold: o.bold, color: o.color });
      py += RH;
    }
    function band(label) {
      rect(LX, py, LW, RH, [217, 217, 217]);
      txt(label, LX, py, LW, RH, { bold: true });
      py += RH;
    }
    var GREY = [242, 242, 242];
    mrow("SELLING PRICE", fmtAmt(d.selling), { bold: true });
    mrow("PEARL WHITE", amtOrText(d.pearl));
    mrow("METALLIC PAINT", amtOrText(d.metallic));
    band("ACCESSORIES");
    ACC.forEach(function (a) { mrow(a[0] + "   " + a[1], fmtAmt(d[accKey(a[0])])); });
    mrow(d.acc_x1_label || "", fmtAmt(d.acc_x1));
    mrow(d.acc_x2_label || "", fmtAmt(d.acc_x2));
    mrow("TOTAL ACCESSORIES :", fmtAmt(c.totAcc), { bold: true, fill: GREY });
    band("SALES CONTRACTING");
    mrow("20   Sign Writing / Partition", fmtAmt(d.sales_20));
    mrow(d.sales_x1_label || "", fmtAmt(d.sales_x1));
    mrow(d.sales_x2_label || "", fmtAmt(d.sales_x2));
    mrow("Total Sales Contracting", fmtAmt(c.totSc), { bold: true, fill: GREY });
    band("FEES & INSURANCE");
    mrow("Registration / Ownership Endorsement Fee", fmtAmt(d.reg_fee));
    mrow("Road Tax / Haulage Permit Fee", fmtAmt(d.road_tax));
    mrow("Puspakom Inspection Fee", fmtAmt(d.puspakom));
    mrow("Freight / Marine / Insurance / Handling", fmtAmt(d.freight));
    mrow("Insurance - Amount Insured", fmtAmt(d.ins_amt));
    mrow("Insurance Premium", fmtAmt(d.ins_prem));
    mrow("Less NCD (%)", num(d.ncd) ? num(d.ncd).toFixed(1) + "%" : "");
    mrow("Net Insurance Premium", fmtAmt(c.netIns), { bold: true, fill: GREY });
    mrow("TOTAL SALES PRICE", fmtAmt(c.totSales), { bold: true, fill: GREY });
    mrow("Less Total Discount", fmtAmt(d.discount, "deduct"));
    mrow("INVOICE VALUE BEFORE TRADE-IN", fmtAmt(c.invBefore), { bold: true, fill: GREY });
    mrow("Less Trade-in", fmtAmt(d.tradein, "deduct"));
    mrow("TOTAL INVOICE VALUE", fmtAmt(c.totInv), { bold: true, fill: GREY });
    mrow("Add HP Settlement of Trade-in", fmtAmt(d.hp_settle));
    mrow("Less Booking Fee(s) Paid", fmtAmt(d.booking, "deduct"));
    mrow("Total Amount Due", fmtAmt(c.totDue), { bold: true, fill: GREY });
    mrow("Loan Amount Due", fmtAmt(d.loan, "deduct"));
    mrow("AMOUNT DUE FROM / (TO) CUSTOMER", fmtAmt(c.dueCust), { bold: true, fill: GREY, color: RED });
    var pricingEnd = py;

    /* right panel */
    var ry = y, TL = 112, TV = RW - TL;
    rect(RX, ry, RW, RH, RED);
    txt("TRADE-IN VEHICLE PARTICULARS", RX, ry, RW, RH, { bold: true, color: [255, 255, 255] });
    ry += RH;
    [["Model Description", d.ti_model], ["Registration No", d.ti_reg], ["Year of Registration", d.ti_year_reg],
      ["Year of Manufacture", d.ti_year_mfg], ["Appraisal Number", d.ti_appraisal]].forEach(function (f) {
      field(RX, ry, TL, TV, RH, f[0], f[1]); ry += RH;
    });
    txt("Tender Reg. (Yes/No, No.)", RX, ry, TL, RH, { bold: true });
    rect(RX + TL, ry, 50, RH); txt(d.tender_yn, RX + TL, ry, 50, RH, { align: "center" });
    rect(RX + TL + 50, ry, TV - 50, RH); txt(d.tender_no, RX + TL + 50, ry, TV - 50, RH);
    ry += RH;
    txt("Tax Exemption", RX, ry, TL, RH, { bold: true });
    rect(RX + TL, ry, 50, RH); txt(d.tax_yn, RX + TL, ry, 50, RH, { align: "center" });
    ry += 2 * RH;
    field(RX, ry, TL, TV, RH, "Estimated Delivery Date:", fmtDate(d.delivery));
    ry += 1.6 * RH;
    rect(RX, ry, RW, RH, [217, 217, 217]);
    txt("Remarks:", RX, ry, RW, RH, { bold: true });
    ry += RH;
    var notesTop = pricingEnd - 12 * RH;
    var remH = Math.max(4 * RH, notesTop - RH - ry);
    rect(RX, ry, RW, remH);
    txt(d.remarks, RX, ry, RW, remH, { pad: 4, top: true, size: 17 }); /* 17 pt (Wan); shrinks only if text is too long */
    rect(RX, notesTop, RW, pricingEnd - notesTop);
    var ny = notesTop + 2;
    ny += para("Please Note:", RX + 3, ny, RW - 6, FS * 0.92, true);
    NOTES.forEach(function (n) { ny += para(n, RX + 3, ny, RW - 6, FS * 0.88, false) + 1; });

    /* bottom */
    y = pricingEnd + 0.7 * RH;
    txt("Hire Purchase Terms:", LX, y, 112, RH, { bold: true });
    rect(LX + 112, y, 80, RH); txt(num(d.hp_rate) ? num(d.hp_rate).toFixed(2) + "% p.a." : "", LX + 112, y, 80, RH, { align: "center" });
    rect(LX + 192, y, 80, RH); txt(num(d.hp_months) ? Math.round(num(d.hp_months)) + " months" : "", LX + 192, y, 80, RH, { align: "center" });
    y += 1.5 * RH;
    var FW = PW - 2 * M;
    y += para(T_AGREE, LX, y, FW, FS * 0.95, false) + 0.3 * RH;
    var BH = 1.3 * RH;
    txt("Booking fee paid (RM):", LX, y, 112, BH, { bold: true });
    rect(LX + 112, y, 110, BH); txt(fmtAmt(d.booking), LX + 112, y, 110, BH, { align: "right" });
    txt("vide Cash / Cheque / Credit card Sales Draft No.:", RX, y, TL, BH, { bold: true });
    rect(RX + TL, y, TV, BH); txt(d.draft_no, RX + TL, y, TV, BH);
    y += BH;
    field(LX, y, 112, 179, RH, "Receipt No.:", d.receipt);
    y += 1.5 * RH;
    y += para(T_TRADE, LX, y, FW, FS * 0.95, false) + 0.4 * RH;
    y += para(T_PRICE, LX, y, FW, FS * 0.95, true);
    y += para(T_VALID, LX, y, FW, FS * 0.95, true) + 0.5 * RH;

    /* signatures */
    font(FS * 0.95, true); doc.text("For and on behalf of " + COMPANY, RX, y + FS);
    var sy = y + 1.2 * RH, SH = 3.4 * RH;
    function sig(img, x, w) {
      if (img) {
        try {
          var pr = doc.getImageProperties(img);
          var bw = w * 0.8, bh = SH - 2;
          var s = Math.min(bw / pr.width, bh / pr.height);
          var iw = pr.width * s, ih = pr.height * s;
          doc.addImage(img, "PNG", x + (w - iw) / 2, sy + (bh - ih), iw, ih);
        } catch (e) { /* ignore bad image */ }
      }
    }
    sig(d.sig_customer, LX, LW);
    sig(d.sig_exec, RX, RW);
    var ly = sy + SH;
    doc.setDrawColor(0); doc.setLineWidth(0.6);
    doc.line(LX, ly, LX + LW, ly); doc.line(RX, ly, RX + RW, ly);
    font(FS * 0.9, false);
    doc.text("Customer (signature)", LX + LW / 2, ly + FS, { align: "center" });
    doc.text("Authorised Executive (signature)", RX + RW / 2, ly + FS, { align: "center" });
    y = ly + 1.3 * RH;
    field(RX, y, 70, RW - 70, RH, "Name:", d.sig_name); y += RH;
    field(RX, y, 70, RW - 70, RH, "Designation:", d.sig_desig); y += RH;
    return y;
  }

  /* Fields typed as capital letters. Not capitalised: email, dates and signature images. */
  var NO_CAPS = { email: 1, date: 1, delivery: 1, sig_customer: 1, sig_exec: 1 };
  function isCapsKey(k) { return !NO_CAPS[k]; }
  function capsCopy(d) {
    var o = {};
    Object.keys(d || {}).forEach(function (k) {
      var v = d[k];
      o[k] = typeof v === "string" && isCapsKey(k) ? v.toUpperCase() : v;
    });
    return o;
  }

  /* Fit everything on one A4 page: end-y is linear in row height, so solve for it. */
  function buildPdf(jsPDF, d0) {
    var d = capsCopy(d0); /* PDF text is always CAPITALS (except email), even for older saved orders */
    var limit = PH - M;
    function endAt(rh) { return draw(new jsPDF({ unit: "pt", format: "a4" }), d, rh); }
    /* secant iterations, then step down until it fits */
    var a = 8, b = 11, ea = endAt(a), eb = endAt(b);
    for (var i = 0; i < 4 && Math.abs(eb - limit) > 0.3; i++) {
      var nx = b + (limit - eb) * (b - a) / (eb - ea);
      a = b; ea = eb; b = nx; eb = endAt(b);
    }
    var RH = Math.max(7, Math.min(13, b));
    while (endAt(RH) > limit && RH > 7) RH -= 0.02;
    var doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
    doc.setProperties({ title: "Toyota Retail Customer Order " + (d.orderno || ""), creator: "VSO App" });
    var end = draw(doc, d, RH);
    /* small light-grey watermark in the bottom-right corner (inside the page margin) */
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(185, 185, 185);
    doc.text("Wan Jasni", PW - 5, PH - 4, { align: "right" });
    doc.setTextColor(0, 0, 0);
    doc.__vsoLayout = { rowHeight: RH, endY: end, limit: limit };
    return doc;
  }

  return {
    ACC: ACC, accKey: accKey, NOTES: NOTES, COMPANY: COMPANY, num: num, compute: compute, fmtAmt: fmtAmt,
    isNumText: isNumText, amtOrText: amtOrText, isCapsKey: isCapsKey, capsCopy: capsCopy,
    fmtDate: fmtDate, today: today, emptyOrder: emptyOrder, fileName: fileName, buildPdf: buildPdf, money: money
  };
});

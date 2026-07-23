/* ===== util.js — 共用工具 ===== */
"use strict";

const U = {
  uid(prefix) {
    return (prefix || "id") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },

  /* ---- 日期(本地 Asia/Taipei,以瀏覽器本地時間為準) ---- */
  today() { return U.fmtDate(new Date()); },
  fmtDate(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  },
  parseDate(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); },
  addDays(dateStr, n) { const d = U.parseDate(dateStr); d.setDate(d.getDate() + n); return U.fmtDate(d); },
  diffDays(a, b) { return Math.round((U.parseDate(b) - U.parseDate(a)) / 86400000); },
  weekday(dateStr) { return U.parseDate(dateStr).getDay(); }, // 0=日
  weekdayName(dateStr) { return "日一二三四五六"[U.weekday(dateStr)]; },
  isWeekend(dateStr) { const w = U.weekday(dateStr); return w === 0 || w === 6; },
  monthOf(dateStr) { return dateStr.slice(0, 7); },
  thisMonth() { return U.today().slice(0, 7); },
  monthStart() { return U.thisMonth() + "-01"; },   // 本月一號
  monthDays(ym) { // 回傳該月所有日期字串
    const [y, m] = ym.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    const out = [];
    for (let d = 1; d <= last; d++) out.push(`${ym}-${String(d).padStart(2, "0")}`);
    return out;
  },
  mdLabel(dateStr) { return dateStr.slice(5).replace("-", "/"); },

  /* ---- 金額:一律以「分」整數儲存 ---- */
  toCents(v) { const n = parseFloat(v); return isNaN(n) ? 0 : Math.round(n * 100); },
  /* 進貨單一列的金額。廠商貨款單是「每列各自四捨五入到整數元」再加總,
     系統跟著同一規則,合計才會跟單子一致
     (例:26.15×250=6537.5 → 6538;直接累加小數的話七列下來會差個幾元)。 */
  lineAmt(qty, unitPriceCents) {
    return Math.round((qty || 0) * (unitPriceCents || 0) / 100) * 100;
  },
  fmt$(cents, showDec) {
    if (cents == null || isNaN(cents)) return "—";
    const v = cents / 100;
    const opts = showDec ? { minimumFractionDigits: 1, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 };
    return "NT$" + v.toLocaleString("zh-TW", opts);
  },
  fmtNum(n, dec) {
    if (n == null || isNaN(n)) return "—";
    return n.toLocaleString("zh-TW", { maximumFractionDigits: dec == null ? 1 : dec });
  },
  pct(v, dec) { return v == null || isNaN(v) ? "—" : (v * 100).toFixed(dec == null ? 1 : dec) + "%"; },

  esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  },

  /* ---- CSV 解析(支援引號、逗號) ---- */
  parseCSV(text) {
    const rows = []; let row = [], cur = "", q = false;
    text = text.replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else {
        if (c === '"') q = true;
        else if (c === ",") { row.push(cur); cur = ""; }
        else if (c === "\n" || c === "\r") {
          if (c === "\r" && text[i + 1] === "\n") i++;
          row.push(cur); cur = "";
          if (row.length > 1 || row[0] !== "") rows.push(row);
          row = [];
        } else cur += c;
      }
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows;
  },

  downloadFile(filename, content, mime) {
    const blob = new Blob(["﻿" + content], { type: (mime || "text/plain") + ";charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },

  sum(arr, fn) { return arr.reduce((s, x) => s + (fn ? fn(x) : x), 0); },
  groupBy(arr, fn) {
    const m = {};
    for (const x of arr) { const k = fn(x); (m[k] = m[k] || []).push(x); }
    return m;
  },
  sortBy(arr, fn, desc) {
    return [...arr].sort((a, b) => { const va = fn(a), vb = fn(b); return (va < vb ? -1 : va > vb ? 1 : 0) * (desc ? -1 : 1); });
  }
};

/* ===== SVG 圖表(免外部函式庫) ===== */
const Chart = {
  palette: ["#c62f2f", "#1f5fa8", "#1e7d43", "#b26a00", "#6b4fa0", "#0e7a8a"],

  /* 折線圖 series:[{name,color,data:[{x(label),y}]}] */
  line(opts) {
    const w = opts.width || 640, h = opts.height || 240;
    const pad = { l: 52, r: 14, t: 14, b: 30 };
    const series = (opts.series || []).filter(s => s.data.length);
    if (!series.length) return `<div class="empty">尚無資料</div>`;
    const labels = series[0].data.map(d => d.x);
    let ys = [];
    series.forEach(s => s.data.forEach(d => { if (d.y != null) ys.push(d.y); }));
    if (opts.refLines) opts.refLines.forEach(r => ys.push(r.y));
    if (!ys.length) return `<div class="empty">尚無資料</div>`;
    let ymin = Math.min(...ys), ymax = Math.max(...ys);
    if (ymin === ymax) { ymin -= 1; ymax += 1; }
    const span = ymax - ymin; ymin -= span * 0.08; ymax += span * 0.08;
    if (opts.zeroBase && ymin > 0) ymin = 0;
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const X = i => pad.l + (labels.length === 1 ? iw / 2 : i / (labels.length - 1) * iw);
    const Y = v => pad.t + ih - (v - ymin) / (ymax - ymin) * ih;
    const yfmt = opts.yFmt || (v => U.fmtNum(v));
    let g = "";
    // y 格線
    for (let i = 0; i <= 4; i++) {
      const v = ymin + (ymax - ymin) * i / 4, y = Y(v);
      g += `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" stroke="#e3e8ef"/>`;
      g += `<text x="${pad.l - 6}" y="${y + 4}" text-anchor="end" font-size="10.5" fill="#5b6b7d">${U.esc(yfmt(v))}</text>`;
    }
    // x 標籤(最多 10 個)
    const step = Math.max(1, Math.ceil(labels.length / 10));
    labels.forEach((lb, i) => {
      if (i % step !== 0 && i !== labels.length - 1) return;
      g += `<text x="${X(i)}" y="${h - 8}" text-anchor="middle" font-size="10.5" fill="#5b6b7d">${U.esc(lb)}</text>`;
    });
    // 參考線
    (opts.refLines || []).forEach(r => {
      const y = Y(r.y);
      g += `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" stroke="${r.color || "#b26a00"}" stroke-dasharray="5 4" stroke-width="1.5"/>`;
      g += `<text x="${w - pad.r - 4}" y="${y - 5}" text-anchor="end" font-size="10.5" fill="${r.color || "#b26a00"}" font-weight="700">${U.esc(r.label || "")}</text>`;
    });
    // 線
    series.forEach((s, si) => {
      const color = s.color || Chart.palette[si % Chart.palette.length];
      let path = "", started = false;
      s.data.forEach((d, i) => {
        if (d.y == null) { started = false; return; }
        path += (started ? "L" : "M") + X(i).toFixed(1) + " " + Y(d.y).toFixed(1) + " ";
        started = true;
      });
      g += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>`;
      if (s.data.length <= 45) s.data.forEach((d, i) => {
        if (d.y == null) return;
        g += `<circle cx="${X(i).toFixed(1)}" cy="${Y(d.y).toFixed(1)}" r="2.6" fill="${color}"><title>${U.esc(d.x)}:${U.esc(yfmt(d.y))}</title></circle>`;
      });
    });
    const legend = series.length > 1 || opts.forceLegend
      ? `<div class="legend">${series.map((s, i) => `<span class="li"><span class="dot" style="background:${s.color || Chart.palette[i % Chart.palette.length]}"></span>${U.esc(s.name || "")}</span>`).join("")}</div>` : "";
    return `<div class="chart-box"><svg viewBox="0 0 ${w} ${h}" width="100%" style="min-width:${Math.min(w, 480)}px">${g}</svg>${legend}</div>`;
  },

  /* 長條圖 data:[{x,y,color?}] */
  bar(opts) {
    const w = opts.width || 640, h = opts.height || 240;
    const pad = { l: 56, r: 14, t: 14, b: 46 };
    const data = opts.data || [];
    if (!data.length) return `<div class="empty">尚無資料</div>`;
    let ymax = Math.max(...data.map(d => d.y), 0);
    if (ymax === 0) ymax = 1;
    ymax *= 1.1;
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const bw = Math.min(46, iw / data.length * 0.62);
    const X = i => pad.l + (i + 0.5) / data.length * iw;
    const Y = v => pad.t + ih - v / ymax * ih;
    const yfmt = opts.yFmt || (v => U.fmtNum(v));
    let g = "";
    for (let i = 0; i <= 4; i++) {
      const v = ymax * i / 4, y = Y(v);
      g += `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" stroke="#e3e8ef"/>`;
      g += `<text x="${pad.l - 6}" y="${y + 4}" text-anchor="end" font-size="10.5" fill="#5b6b7d">${U.esc(yfmt(v))}</text>`;
    }
    data.forEach((d, i) => {
      const x = X(i);
      g += `<rect x="${(x - bw / 2).toFixed(1)}" y="${Y(d.y).toFixed(1)}" width="${bw.toFixed(1)}" height="${(pad.t + ih - Y(d.y)).toFixed(1)}" rx="3" fill="${d.color || opts.color || "#1f5fa8"}"><title>${U.esc(d.x)}:${U.esc(yfmt(d.y))}</title></rect>`;
      const lbl = String(d.x);
      g += `<text x="${x}" y="${h - 26}" text-anchor="middle" font-size="10.5" fill="#5b6b7d">${U.esc(lbl.length > 6 ? lbl.slice(0, 6) : lbl)}</text>`;
      if (opts.showVal) g += `<text x="${x}" y="${Y(d.y) - 5}" text-anchor="middle" font-size="10.5" fill="#3a4a5c" font-weight="700">${U.esc(yfmt(d.y))}</text>`;
    });
    return `<div class="chart-box"><svg viewBox="0 0 ${w} ${h}" width="100%" style="min-width:${Math.min(w, 480)}px">${g}</svg></div>`;
  }
};

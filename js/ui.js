/* ===== ui.js — UI 元件(modal / toast / 表格) ===== */
"use strict";

const UI = {
  toast(msg, isErr) {
    const box = document.getElementById("toastBox");
    const el = document.createElement("div");
    el.className = "toast" + (isErr ? " err" : "");
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  },

  _onOk: null,
  modal(title, bodyHTML, opts) {
    opts = opts || {};
    UI._onOk = opts.onOk || null;
    UI._onCancel = opts.onCancel || null;   // 按取消/✕/Esc 時呼叫(用於「中途去建檔,取消要回到原視窗」)
    const mask = document.getElementById("modalMask");
    const box = document.getElementById("modalBox");
    box.style.maxWidth = (opts.width || 760) + "px";
    box.innerHTML = `
      <h2>${U.esc(title)}<button class="x" onclick="UI.closeModal()">✕</button></h2>
      <div id="modalBody">${bodyHTML}</div>
      <div class="modal-foot">
        <button class="btn" onclick="UI.closeModal()">取消</button>
        ${opts.hideOk ? "" : `<button class="btn primary" onclick="UI.okModal()">${U.esc(opts.okText || "儲存")}</button>`}
      </div>`;
    mask.classList.add("show");
  },
  okModal() {
    if (UI._onOk) { if (UI._onOk() === false) return; }
    UI._onCancel = null;   // 有按確定就不算取消
    UI.closeModal();
  },
  closeModal() {
    document.getElementById("modalMask").classList.remove("show");
    const cancel = UI._onCancel;
    UI._onOk = null;
    UI._onCancel = null;
    if (cancel) setTimeout(cancel, 0);   // 延後,避免跟正在關閉的視窗打架
  },

  confirm(msg, onYes) {
    UI.modal("確認", `<p style="font-size:14px;line-height:1.7">${U.esc(msg)}</p>`, { okText: "確定", onOk: onYes, width: 420 });
  },

  val(id) { const e = document.getElementById(id); return e ? e.value.trim() : ""; },
  num(id) { const v = parseFloat(UI.val(id)); return isNaN(v) ? 0 : v; },
  checked(id) { const e = document.getElementById(id); return e ? e.checked : false; },

  table(headers, rowsHtml, emptyMsg) {
    if (!rowsHtml || (Array.isArray(rowsHtml) && !rowsHtml.length))
      return `<div class="empty">${U.esc(emptyMsg || "尚無資料")}</div>`;
    const body = Array.isArray(rowsHtml) ? rowsHtml.join("") : rowsHtml;
    return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${
      headers.map(h => `<th${h.startsWith("#") ? ' class="num"' : ""}>${U.esc(h.replace(/^#/, ""))}</th>`).join("")
    }</tr></thead><tbody>${body}</tbody></table></div>`;
  },

  // 下拉選項
  ingOptions(selectedId, filter) {
    let list = DB.get("ingredients").filter(i => i.active !== false);
    if (filter) list = list.filter(filter);
    const groups = U.groupBy(list, i => i.category);
    let html = `<option value="">— 請選擇 —</option>`;
    for (const [cat, items] of Object.entries(groups)) {
      html += `<optgroup label="${U.esc(cat)}">` +
        items.map(i => `<option value="${i.id}" ${i.id === selectedId ? "selected" : ""}>${U.esc(i.name)}(${U.esc(i.stockUnit)})</option>`).join("") +
        `</optgroup>`;
    }
    return html;
  },
  // 該供應商供應的品項(依報價建檔+預設供應商判斷)
  supplierIngredientIds(supplierId) {
    const ids = new Set(DB.get("supplierPrices").filter(p => p.supplierId === supplierId).map(p => p.ingredientId));
    for (const i of DB.get("ingredients")) if (i.defaultSupplierId === supplierId) ids.add(i.id);
    return ids;
  },
  // 依供應商過濾的品項下拉:預設「只列該供應商品項」;includeOthers=true 時其他品項收在下面
  ingOptionsBySupplier(supplierId, selectedId, includeOthers) {
    const all = DB.get("ingredients").filter(i => i.active !== false);
    if (!supplierId) return UI.ingOptions(selectedId);
    const supIds = UI.supplierIngredientIds(supplierId);
    const mine = all.filter(i => supIds.has(i.id));
    const opt = i => `<option value="${i.id}" ${i.id === selectedId ? "selected" : ""}>${U.esc(i.name)}(${U.esc(i.stockUnit)})</option>`;
    let html = `<option value="">— 請選擇 —</option>`;
    html += mine.length ? mine.map(opt).join("")
      : `<option value="" disabled>(此供應商尚無建檔品項,請先到報價建檔新增)</option>`;
    if (includeOthers) {
      const others = all.filter(i => !supIds.has(i.id));
      if (others.length) html += `<optgroup label="── 其他品項 ──">` + others.map(opt).join("") + `</optgroup>`;
    }
    return html;
  },

  supOptions(selectedId) {
    return `<option value="">— 請選擇 —</option>` + DB.get("suppliers").map(s =>
      `<option value="${s.id}" ${s.id === selectedId ? "selected" : ""}>${U.esc(s.name)}</option>`).join("");
  },
  recipeOptions(selectedId, excludeId) {
    return `<option value="">— 請選擇 —</option>` + DB.get("recipes").filter(r => r.id !== excludeId).map(r =>
      `<option value="${r.id}" ${r.id === selectedId ? "selected" : ""}>${U.esc(r.name)}(${U.esc(r.category)})</option>`).join("");
  },

  ingName(id) { const i = DB.byId("ingredients", id); return i ? i.name : "(已刪除)"; },
  supName(id) { const s = DB.byId("suppliers", id); return s ? s.name : "(未指定)"; },
  recipeName(id) { const r = DB.byId("recipes", id); return r ? r.name : "(已刪除)"; },

  rateBadge(rate, target) {
    if (rate == null) return `<span class="t-muted">—</span>`;
    const cls = rate <= target ? "t-green" : (rate <= target + 0.05 ? "t-orange" : "t-red");
    return `<span class="${cls}">${U.pct(rate)}</span>`;
  },
  pctBadge(v) {
    if (v == null) return `<span class="t-muted">—</span>`;
    const cls = v > 0.001 ? "t-red" : v < -0.001 ? "t-green" : "t-muted";
    const arrow = v > 0.001 ? "▲" : v < -0.001 ? "▼" : "";
    return `<span class="${cls}">${arrow}${U.pct(Math.abs(v))}</span>`;
  }
};

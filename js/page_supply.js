/* ===== page_supply.js — 雜項用品(清潔用品/耗材等非食材)
   刻意跟「食材品項」分開:這類東西不進 BOM、不算食材成本率,
   用量也無法從點餐明細推算,只能用「叫了多少 − 盤點剩多少 = 用了多少」。
   金額會計入月財報的「雜項進貨」。 ===== */
"use strict";

const SUPPLY_UNITS = ["瓶", "罐", "包", "箱", "組", "支", "個", "捲", "桶", "公斤", "公升", "打"];

const PageSupply = {
  rows: [],            // 進貨登記編輯中的列
  cFrom: null, cTo: null,  // 使用量分析:期初/期末盤點

  /* ---- 品項主檔:依名稱取得,沒有就自動建立(使用者不必先建檔) ---- */
  ensureSupply(name, unit) {
    name = (name || "").trim();
    if (!name) return null;
    const found = DB.get("supplies").find(x => x.name === name);
    if (found) {
      if (unit && found.unit !== unit) DB.update("supplies", found.id, { unit });
      return found;
    }
    return DB.insert("supplies", { name, unit: unit || "", active: true, note: "" });
  },

  supplyName(id) { const s = DB.byId("supplies", id); return s ? s.name : "(已刪除)"; },
  supplyUnit(id) { const s = DB.byId("supplies", id); return s ? (s.unit || "") : ""; },

  // 某品項的參考單價:期間內平均進價,沒有就取最後一次進價
  refPrice(supplyId, from, to) {
    const all = DB.get("supplyPurchases").filter(p => p.supplyId === supplyId);
    const inRange = (from && to) ? all.filter(p => p.date > from && p.date <= to) : [];
    const pick = inRange.length ? inRange : all;
    if (!pick.length) return 0;
    const qty = U.sum(pick, p => p.qty);
    if (!qty) return 0;
    return Math.round(U.sum(pick, p => U.lineAmt(p.qty, p.unitPrice)) / qty);
  },

  /* ================= 主畫面 ================= */
  render(c) {
    const purchases = U.sortBy(DB.get("supplyPurchases"), p => p.date, true);
    const ym = U.thisMonth();
    const monthAmt = U.sum(purchases.filter(p => (p.date || "").slice(0, 7) === ym),
      p => U.lineAmt(p.qty, p.unitPrice));
    const totalAmt = U.sum(purchases, p => U.lineAmt(p.qty, p.unitPrice));

    c.innerHTML = `
    <div class="alert info">💡 清潔用品、耗材等<b>非食材</b>登記在這裡,不會混進食材品項、也不影響食材成本率。
      用量算法:<b>期初盤點 + 期間進貨 − 期末盤點 = 使用量</b>(這類東西沒有配方可推算,只能靠盤點)。金額會自動計入月財報的「雜項進貨」。</div>

    <div class="kpi-row">
      <div class="kpi"><div class="k-label">本月雜項進貨</div><div class="k-value">${U.fmt$(monthAmt)}</div><div class="k-note">${ym}</div></div>
      <div class="kpi"><div class="k-label">累計進貨</div><div class="k-value">${U.fmt$(totalAmt)}</div><div class="k-note">${purchases.length} 筆</div></div>
      <div class="kpi"><div class="k-label">品項數</div><div class="k-value">${DB.get("supplies").length}</div><div class="k-note">${DB.get("supplyCounts").length} 次盤點</div></div>
    </div>

    <div class="toolbar">
      <button class="btn primary" onclick="PageSupply.openPurchase()">＋ 登記進貨</button>
      <button class="btn" onclick="PageSupply.openCount()">📋 建立盤點</button>
    </div>

    <div class="card"><h3>🧴 進貨記錄</h3>
    ${UI.table(["日期", "品名", "#數量", "單位", "#單價", "#小計", "供應商", "備註", "操作"],
      purchases.slice(0, 200).map(p => `<tr>
        <td>${p.date}</td>
        <td><b>${U.esc(PageSupply.supplyName(p.supplyId))}</b></td>
        <td class="num">${U.fmtNum(p.qty)}</td>
        <td>${U.esc(PageSupply.supplyUnit(p.supplyId))}</td>
        <td class="num">${U.fmt$(p.unitPrice)}</td>
        <td class="num"><b>${U.fmt$(U.lineAmt(p.qty, p.unitPrice))}</b></td>
        <td class="t-muted">${p.supplierId ? U.esc(UI.supName(p.supplierId)) : "—"}</td>
        <td class="t-muted" style="font-size:12px">${U.esc(p.note || "")}</td>
        <td><button class="btn small ghost-red" onclick="PageSupply.delPurchase('${p.id}')">刪除</button></td></tr>`),
      "尚無記錄,點上方「＋ 登記進貨」開始")}
    ${purchases.length ? `<p style="text-align:right;margin-top:10px;font-weight:700">累計 ${U.fmt$(totalAmt)}</p>` : ""}
    </div>

    ${PageSupply.renderCounts()}
    ${PageSupply.renderUsage()}`;
  },

  /* ================= 進貨登記 ================= */
  openPurchase() {
    PageSupply.rows = [];
    UI.modal("登記雜項進貨", `
      <div class="form-grid">
        <div><label class="fl">日期</label><input id="sp_date" type="date" value="${U.today()}" style="width:100%"></div>
        <div><label class="fl">供應商(選填)</label><select id="sp_sup" style="width:100%"><option value="">— 不指定 —</option>${
          DB.get("suppliers").map(s => `<option value="${s.id}">${U.esc(s.name)}</option>`).join("")}</select></div>
        <div class="full"><label class="fl">備註(選填)</label><input id="sp_note" style="width:100%" placeholder="例:大買家、量販店"></div>
      </div>
      <datalist id="sp_names">${DB.get("supplies").map(s => `<option value="${U.esc(s.name)}">`).join("")}</datalist>
      <div class="toolbar" style="margin:10px 0 8px">
        <button class="btn primary small" onclick="PageSupply.addRow()">＋ 加一列</button>
        <span class="hint">品名可直接打字(打過的會自動提示);新品名會自動建檔,不用先去別的地方新增</span>
      </div>
      <div id="sp_rows"></div>`,
      {
        width: 860, okText: "✅ 儲存",
        onOk() { return PageSupply.savePurchase(); }
      });
    PageSupply.addRow();
  },

  addRow() {
    PageSupply.rows.push({ name: "", unit: "", qty: 1, unitPrice: 0 });
    PageSupply.renderRows();
  },

  renderRows() {
    const box = document.getElementById("sp_rows");
    if (!box) return;
    if (!PageSupply.rows.length) {
      box.innerHTML = `<div class="empty" style="padding:14px">尚無明細 — 點「＋ 加一列」開始</div>`;
      return;
    }
    box.innerHTML = `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>品名 *</th><th class="num">數量</th><th>單位</th><th class="num">單價(元)</th><th class="num">小計</th><th></th></tr></thead>
      <tbody>` + PageSupply.rows.map((r, i) => `<tr>
        <td><input list="sp_names" value="${U.esc(r.name)}" style="min-width:190px" placeholder="例:洗碗精"
             oninput="PageSupply.setRow(${i},'name',this.value)"></td>
        <td class="num"><input type="number" step="any" value="${r.qty}" style="width:80px"
             oninput="PageSupply.setRow(${i},'qty',this.value)"></td>
        <td><input list="sp_units" value="${U.esc(r.unit)}" style="width:80px" placeholder="瓶"
             oninput="PageSupply.setRow(${i},'unit',this.value)"></td>
        <td class="num"><input type="number" step="any" value="${r.unitPrice ? r.unitPrice / 100 : ""}" style="width:90px"
             oninput="PageSupply.setRow(${i},'unitPrice',this.value)"></td>
        <td class="num"><b id="sp_sub_${i}">${U.fmt$(U.lineAmt(r.qty, r.unitPrice))}</b></td>
        <td><button class="btn small ghost-red" onclick="PageSupply.rows.splice(${i},1);PageSupply.renderRows()">✕</button></td>
      </tr>`).join("") + `</tbody></table></div>
      <datalist id="sp_units">${SUPPLY_UNITS.map(u => `<option value="${u}">`).join("")}</datalist>
      <p class="hint" style="margin-top:6px">合計:<b id="sp_total" style="font-size:14px">${U.fmt$(PageSupply.total())}</b></p>`;
  },

  total() { return U.sum(PageSupply.rows, r => U.lineAmt(r.qty, r.unitPrice)); },

  // 只更新小計/合計文字,不重繪表格 — 重繪會把輸入框換掉導致游標跳走
  setRow(i, key, val) {
    const r = PageSupply.rows[i];
    if (key === "qty") r.qty = parseFloat(val) || 0;
    else if (key === "unitPrice") r.unitPrice = Math.round((parseFloat(val) || 0) * 100);
    else {
      r[key] = val;
      // 打到已存在的品名 → 自動帶出上次用的單位
      if (key === "name") {
        const known = DB.get("supplies").find(x => x.name === (val || "").trim());
        if (known && known.unit && !r.unit) {
          r.unit = known.unit;
          const cell = document.querySelectorAll("#sp_rows tbody tr")[i];
          if (cell) cell.querySelectorAll("input")[2].value = known.unit;
        }
      }
    }
    const sub = document.getElementById("sp_sub_" + i);
    if (sub) sub.textContent = U.fmt$(U.lineAmt(r.qty, r.unitPrice));
    const tot = document.getElementById("sp_total");
    if (tot) tot.textContent = U.fmt$(PageSupply.total());
  },

  savePurchase() {
    const date = UI.val("sp_date") || U.today();
    const supplierId = UI.val("sp_sup") || "";
    const note = UI.val("sp_note") || "";
    const valid = PageSupply.rows.filter(r => (r.name || "").trim() && r.qty > 0);
    if (!valid.length) { UI.toast("請至少填一列(品名 + 數量)", true); return false; }
    for (const r of valid) {
      const s = PageSupply.ensureSupply(r.name, r.unit);
      DB.insert("supplyPurchases", {
        date, supplyId: s.id, qty: r.qty, unitPrice: r.unitPrice, supplierId, note
      });
    }
    UI.toast(`已登記 ${valid.length} 筆,共 ${U.fmt$(PageSupply.total())}`);
    App.refresh();
  },

  delPurchase(id) {
    UI.confirm("確定刪除這筆進貨記錄?", () => {
      DB.remove("supplyPurchases", id);
      UI.toast("已刪除");
      App.refresh();
    });
  },

  /* ================= 盤點 ================= */
  renderCounts() {
    const counts = U.sortBy(DB.get("supplyCounts"), x => x.date, true);
    return `<div class="card"><h3>📋 盤點記錄 <span class="sub">盤點後才算得出使用量</span></h3>
    ${UI.table(["盤點日", "#品項數", "備註", "操作"],
      counts.map(sc => `<tr>
        <td><b>${sc.date}</b></td>
        <td class="num">${(sc.lines || []).length}</td>
        <td class="t-muted">${U.esc(sc.note || "")}</td>
        <td><button class="btn small" onclick="PageSupply.viewCount('${sc.id}')">明細</button>
            <button class="btn small ghost-red" onclick="PageSupply.delCount('${sc.id}')">刪除</button></td></tr>`),
      "尚無盤點記錄")}
    </div>`;
  },

  openCount() {
    const items = DB.get("supplies").filter(s => s.active !== false);
    if (!items.length) { UI.toast("請先登記至少一筆進貨,才有品項可盤點", true); return; }
    UI.modal("建立盤點(" + U.today() + ")", `
      <div class="form-row"><label class="fl">盤點日期</label>
        <input id="sc_date" type="date" value="${U.today()}" style="width:200px"></div>
      <p class="hint" style="margin-bottom:10px">填目前<b>實際剩餘數量</b>;留空表示這次沒盤(該品項不列入使用量計算)。</p>
      ${UI.table(["品名", "單位", "#目前剩餘"],
        items.map((s, i) => `<tr>
          <td><b>${U.esc(s.name)}</b></td>
          <td class="t-muted">${U.esc(s.unit || "")}</td>
          <td class="num"><input id="sc_q_${i}" type="number" step="any" placeholder="—" style="width:110px"></td></tr>`))}
      <div class="form-row" style="margin-top:12px"><label class="fl">備註(選填)</label>
        <input id="sc_note" style="width:100%"></div>`,
      {
        width: 640, okText: "✅ 儲存盤點",
        onOk() {
          const lines = [];
          items.forEach((s, i) => {
            const v = UI.val("sc_q_" + i);
            if (v === "") return;
            const q = parseFloat(v);
            if (isNaN(q)) return;
            lines.push({ supplyId: s.id, qty: q });
          });
          if (!lines.length) { UI.toast("尚未輸入任何數量", true); return false; }
          DB.insert("supplyCounts", { date: UI.val("sc_date") || U.today(), lines, note: UI.val("sc_note") || "" });
          UI.toast(`盤點完成:${lines.length} 個品項`);
          App.refresh();
        }
      });
  },

  viewCount(id) {
    const sc = DB.byId("supplyCounts", id);
    if (!sc) return;
    UI.modal("盤點明細 — " + sc.date,
      UI.table(["品名", "#剩餘數量", "單位"],
        (sc.lines || []).map(l => `<tr>
          <td>${U.esc(PageSupply.supplyName(l.supplyId))}</td>
          <td class="num"><b>${U.fmtNum(l.qty)}</b></td>
          <td class="t-muted">${U.esc(PageSupply.supplyUnit(l.supplyId))}</td></tr>`)),
      { hideOk: true, width: 520 });
  },

  delCount(id) {
    UI.confirm("確定刪除此盤點記錄?", () => {
      DB.remove("supplyCounts", id);
      UI.toast("已刪除");
      App.refresh();
    });
  },

  /* ================= 使用量分析 ================= */
  renderUsage() {
    const counts = U.sortBy(DB.get("supplyCounts"), x => x.date);
    if (counts.length < 2) {
      return `<div class="card"><h3>📐 使用量分析</h3>
        <div class="empty">需要至少兩次盤點才能計算<br>
        <span class="hint">算法:期初盤點 + 期間進貨 − 期末盤點 = 使用量。建議固定每月盤一次。</span></div></div>`;
    }
    if (!PageSupply.cFrom || !DB.byId("supplyCounts", PageSupply.cFrom)) PageSupply.cFrom = counts[counts.length - 2].id;
    if (!PageSupply.cTo || !DB.byId("supplyCounts", PageSupply.cTo)) PageSupply.cTo = counts[counts.length - 1].id;
    const cFrom = DB.byId("supplyCounts", PageSupply.cFrom);
    const cTo = DB.byId("supplyCounts", PageSupply.cTo);

    const sel = (which) => `<select onchange="PageSupply.${which}=this.value;App.refresh()" style="min-width:150px">${
      counts.map(x => `<option value="${x.id}" ${x.id === PageSupply[which] ? "selected" : ""}>${x.date}</option>`).join("")}</select>`;
    const head = `<div class="toolbar">期初盤點:${sel("cFrom")} → 期末盤點:${sel("cTo")}</div>`;

    if (!cFrom || !cTo || cFrom.date >= cTo.date) {
      return `<div class="card"><h3>📐 使用量分析</h3>${head}
        <div class="alert warn">期初盤點日必須早於期末盤點日</div></div>`;
    }

    const fromMap = {}, toMap = {};
    (cFrom.lines || []).forEach(l => fromMap[l.supplyId] = l.qty);
    (cTo.lines || []).forEach(l => toMap[l.supplyId] = l.qty);

    const list = [];
    for (const supplyId of Object.keys(fromMap)) {
      if (!(supplyId in toMap)) continue;   // 兩次都要有盤到才算得準
      const bought = U.sum(DB.get("supplyPurchases").filter(p =>
        p.supplyId === supplyId && p.date > cFrom.date && p.date <= cTo.date), p => p.qty);
      const used = fromMap[supplyId] + bought - toMap[supplyId];
      const price = PageSupply.refPrice(supplyId, cFrom.date, cTo.date);
      list.push({ supplyId, begin: fromMap[supplyId], bought, end: toMap[supplyId], used, cost: U.lineAmt(used, price), price });
    }
    U.sortBy(list, r => -r.cost);
    const totalCost = U.sum(list, r => r.cost);
    const days = Math.max(1, U.daysBetween ? U.daysBetween(cFrom.date, cTo.date) :
      Math.round((new Date(cTo.date) - new Date(cFrom.date)) / 86400000));

    return `<div class="card">
      <h3>📐 使用量分析 <span class="sub">期初 + 進貨 − 期末 = 使用量(僅列兩次都有盤到的品項)</span></h3>
      ${head}
      <div class="kpi-row">
        <div class="kpi"><div class="k-label">區間使用金額</div><div class="k-value">${U.fmt$(totalCost)}</div>
          <div class="k-note">${cFrom.date} → ${cTo.date}(${days} 天)</div></div>
        <div class="kpi"><div class="k-label">平均每日</div><div class="k-value">${U.fmt$(Math.round(totalCost / days))}</div>
          <div class="k-note">雜項用品消耗</div></div>
        <div class="kpi"><div class="k-label">預估每月</div><div class="k-value">${U.fmt$(Math.round(totalCost / days * 30))}</div>
          <div class="k-note">依此區間速度推估</div></div>
      </div>
      ${UI.table(["品名", "#期初", "#期間進貨", "#期末", "#使用量", "單位", "#參考單價", "#使用金額 ▼"],
        list.map(r => `<tr>
          <td><b>${U.esc(PageSupply.supplyName(r.supplyId))}</b></td>
          <td class="num">${U.fmtNum(r.begin)}</td>
          <td class="num">${U.fmtNum(r.bought)}</td>
          <td class="num">${U.fmtNum(r.end)}</td>
          <td class="num"><b class="${r.used < 0 ? "t-red" : ""}">${U.fmtNum(r.used)}</b></td>
          <td class="t-muted">${U.esc(PageSupply.supplyUnit(r.supplyId))}</td>
          <td class="num">${U.fmt$(r.price)}</td>
          <td class="num"><b>${U.fmt$(r.cost)}</b></td></tr>`),
        "兩次盤點沒有共同品項")}
      <p class="hint">使用量出現<b class="t-red">負數</b>代表期末比「期初+進貨」還多 → 可能是漏登記進貨,或盤點數字打錯,建議回頭檢查。</p>
    </div>`;
  }
};

App.register("m_supply", "主檔 — 雜項用品(清潔/耗材)", PageSupply.render);

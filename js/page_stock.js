/* ===== page_stock.js — 即時庫存 / 盤點 / 損耗 ===== */
"use strict";

const PageStock = {
  tab: "list",
  countLines: null,

  /* ---------------- 即時庫存 ---------------- */
  renderStock(c) {
    const tabs = [["list", "庫存總表"], ["expiry", "效期預警"], ["move", "異動記錄"]];
    let body = "";
    if (PageStock.tab === "list") body = PageStock.stockList();
    else if (PageStock.tab === "expiry") body = PageStock.expiryList();
    else body = PageStock.moveList();
    c.innerHTML = `
      <div class="tabs">${tabs.map(([k, lb]) =>
        `<div class="tab ${PageStock.tab === k ? "active" : ""}" onclick="PageStock.tab='${k}';App.refresh()">${lb}</div>`).join("")}</div>
      ${body}`;
  },

  stockList() {
    const groups = U.groupBy(DB.get("ingredients").filter(i => i.active !== false), i => i.storage);
    let html = "";
    let totalValue = 0;
    for (const sto of STORAGES) {
      const list = groups[sto];
      if (!list) continue;
      const rows = list.map(i => {
        const qty = Domain.stockQty(i.id);
        const val = Domain.stockValue(i.id);
        totalValue += val;
        const batches = U.sortBy(DB.get("stockBatches").filter(b => b.ingredientId === i.id), b => b.expiry || "9999");
        const nearest = batches.length && batches[0].expiry ? batches[0].expiry : null;
        return `<tr>
          <td><b>${U.esc(i.name)}</b> <span class="t-muted" style="font-size:12px">${U.esc(i.category)}</span></td>
          <td class="num ${qty < i.safetyStock ? "t-red" : ""}">${U.fmtNum(qty)} ${U.esc(i.stockUnit)}</td>
          <td class="num">${U.fmtNum(i.safetyStock)}</td>
          <td class="num">${U.fmt$(val)}</td>
          <td class="num">${batches.length}</td>
          <td>${nearest ? (nearest <= U.addDays(U.today(), DB.setting("expiryWarnDays")) ? `<span class="badge b-orange">${nearest}</span>` : nearest) : "—"}</td>
        </tr>`;
      });
      html += `<div class="card"><h3>${sto === "常溫" ? "🌡️" : sto === "冷藏" ? "❄️" : "🧊"} ${sto}儲位</h3>
        ${UI.table(["品項", "#現有量", "#安全庫存", "#庫存價值", "#批號數", "最近效期(FEFO)"], rows)}</div>`;
    }
    return `<div class="kpi-row">
      <div class="kpi"><div class="k-label">庫存總價值(依最新進價)</div><div class="k-value">${U.fmt$(totalValue)}</div></div>
      <div class="kpi ${Domain.lowStockList().length ? "warn" : "good"}"><div class="k-label">低於安全庫存品項</div><div class="k-value">${Domain.lowStockList().length}</div></div>
      <div class="kpi ${Domain.expiryWarnings().length ? "warn" : "good"}"><div class="k-label">即期批號</div><div class="k-value">${Domain.expiryWarnings().length}</div></div>
    </div>` + html;
  },

  expiryList() {
    const list = Domain.expiryWarnings();
    return `<div class="card"><h3>⏰ 效期預警(${DB.setting("expiryWarnDays")} 天內到期,依 FEFO 排序)</h3>
      ${UI.table(["品項", "批號", "#數量", "效期", "入庫日", "操作"],
        list.map(e => `<tr>
          <td><b>${U.esc(e.ing ? e.ing.name : "?")}</b></td>
          <td class="mono">${U.esc(e.batch.batchNo)}</td>
          <td class="num">${U.fmtNum(e.batch.qty)} ${U.esc(e.ing ? e.ing.stockUnit : "")}</td>
          <td>${e.expired ? `<span class="badge b-red">已過期 ${e.batch.expiry}</span>` : `<span class="badge b-orange">${e.batch.expiry}</span>`}</td>
          <td>${e.batch.receivedDate || "—"}</td>
          <td><button class="btn small ghost-red" onclick="PageWaste.quickAdd('${e.batch.ingredientId}',${e.batch.qty},'過期')">報廢</button></td>
        </tr>`), "無即期品項 👍")}
      </div>`;
  },

  moveList() {
    const list = U.sortBy(DB.get("stockMovements"), m => m.date, true).slice(0, 200);
    return `<div class="card"><h3>庫存異動記錄(最近 200 筆)</h3>
      ${UI.table(["日期", "類型", "品項", "#數量", "#成本", "來源", "備註"],
        list.map(m => {
          const ing = DB.byId("ingredients", m.ingredientId);
          const cls = { "進貨": "b-green", "領用": "b-blue", "損耗": "b-red", "盤點調整": "b-orange" }[m.type] || "b-gray";
          return `<tr><td>${m.date}</td>
          <td><span class="badge ${cls}">${m.type}</span></td>
          <td>${U.esc(UI.ingName(m.ingredientId))}</td>
          <td class="num ${m.qty < 0 ? "t-red" : "t-green"}">${m.qty > 0 ? "+" : ""}${U.fmtNum(m.qty)} ${ing ? U.esc(ing.stockUnit) : ""}</td>
          <td class="num">${U.fmt$(Math.abs(m.costCents))}</td>
          <td class="t-muted">${U.esc(m.refType || "")}</td>
          <td class="t-muted">${U.esc(m.note || "")}</td></tr>`;
        }))}
      </div>`;
  },

  /* ---------------- 盤點 ---------------- */
  cFrom: "", cTo: "",

  renderCount(c) {
    const counts = U.sortBy(DB.get("stockCounts"), x => x.date, true);
    c.innerHTML = `
    <div class="alert info">💡 建議節奏:<b>每週盤點一次</b>。盤點流程:建立盤點單(帶入帳面量)→ 輸入實盤量 → 過帳。下方「區間消耗分析」用<b>期初實盤 + 期間進貨 − 期末實盤 = 實際消耗</b>,這是最精準的食材消耗算法。</div>
    <div class="toolbar"><div class="spacer"></div>
      <button class="btn primary" onclick="PageStock.newCount()">＋ 建立盤點單</button></div>
    ${PageStock.consumptionCard(counts)}
    <div class="card">
    ${UI.table(["盤點日", "#品項數", "#盤虧金額", "#盤盈金額", "狀態", "操作"],
      counts.map(sc => {
        let loss = 0, gain = 0;
        for (const l of sc.lines) {
          const cost = Math.round((l.diff || 0) * Domain.priceAt(l.ingredientId, sc.date));
          if (cost < 0) loss += -cost; else gain += cost;
        }
        return `<tr><td>${sc.date}</td><td class="num">${sc.lines.length}</td>
        <td class="num t-red">${U.fmt$(loss)}</td><td class="num t-green">${U.fmt$(gain)}</td>
        <td><span class="badge ${sc.status === "已過帳" ? "b-green" : "b-orange"}">${sc.status}</span></td>
        <td><button class="btn small" onclick="PageStock.viewCount('${sc.id}')">明細</button></td></tr>`;
      }), "尚無盤點記錄")}
    </div>`;
  },

  /* ---- 盤點區間消耗分析:期初 + 進貨 − 期末 = 實際消耗 ---- */
  consumptionCard(countsDesc) {
    const counts = [...countsDesc].reverse(); // 升冪
    if (counts.length < 2)
      return `<div class="card"><h3>📐 區間消耗分析</h3><div class="empty">需要至少兩次盤點記錄才能計算(每週盤點一次,下週就能看到消耗量)</div></div>`;
    // 預設取最近兩次
    if (!PageStock.cFrom || !counts.find(x => x.id === PageStock.cFrom)) PageStock.cFrom = counts[counts.length - 2].id;
    if (!PageStock.cTo || !counts.find(x => x.id === PageStock.cTo)) PageStock.cTo = counts[counts.length - 1].id;
    const cFrom = DB.byId("stockCounts", PageStock.cFrom);
    const cTo = DB.byId("stockCounts", PageStock.cTo);
    const sel = which => `<select onchange="PageStock.${which}=this.value;App.refresh()">` +
      counts.map(x => `<option value="${x.id}" ${x.id === PageStock[which] ? "selected" : ""}>${x.date}</option>`).join("") + `</select>`;
    if (!cFrom || !cTo || cFrom.date >= cTo.date)
      return `<div class="card"><h3>📐 區間消耗分析</h3>
        <div class="toolbar">期初盤點:${sel("cFrom")} → 期末盤點:${sel("cTo")}</div>
        <div class="alert warn">期初盤點日必須早於期末盤點日</div></div>`;

    // 兩次都有盤到的品項才能精準計算
    const fromMap = {}, toMap = {};
    for (const l of cFrom.lines) fromMap[l.ingredientId] = l.actualQty;
    for (const l of cTo.lines) toMap[l.ingredientId] = l.actualQty;
    const rows = [];
    let totalCost = 0, totalTheo = 0;
    for (const ingId of Object.keys(fromMap)) {
      if (!(ingId in toMap)) continue;
      const ing = DB.byId("ingredients", ingId);
      if (!ing) continue;
      const purchases = U.sum(DB.get("stockMovements").filter(m =>
        m.ingredientId === ingId && m.type === "進貨" && m.date > cFrom.date && m.date <= cTo.date), m => m.qty);
      const consumed = Math.round((fromMap[ingId] + purchases - toMap[ingId]) * 100) / 100;
      const price = Domain.priceAt(ingId, cTo.date);
      const cost = Math.round(consumed * price);
      const theo = U.sum(DB.get("stockMovements").filter(m =>
        m.ingredientId === ingId && m.type === "領用" && m.date > cFrom.date && m.date <= cTo.date), m => -m.qty);
      totalCost += cost;
      totalTheo += Math.round(theo * price);
      rows.push({ ing, opening: fromMap[ingId], purchases, closing: toMap[ingId], consumed, cost, theo });
    }
    const sorted = U.sortBy(rows, r => r.cost, true);
    const rev = Domain.revenue(U.addDays(cFrom.date, 1), cTo.date);
    const days = U.diffDays(cFrom.date, cTo.date);

    return `<div class="card">
      <h3>📐 區間消耗分析 <span class="sub">期初實盤 + 期間進貨 − 期末實盤 = 實際消耗(僅列兩次都有盤點的品項)</span></h3>
      <div class="toolbar">期初盤點:${sel("cFrom")} → 期末盤點:${sel("cTo")}
        <span class="badge b-gray">${days} 天</span></div>
      <div class="kpi-row">
        <div class="kpi"><div class="k-label">區間實際消耗成本</div><div class="k-value">${U.fmt$(totalCost)}</div>
          <div class="k-note">日均 ${U.fmt$(Math.round(totalCost / days))}</div></div>
        <div class="kpi"><div class="k-label">區間營收</div><div class="k-value">${U.fmt$(rev.revenue)}</div>
          <div class="k-note">${rev.covers} 位來客</div></div>
        <div class="kpi ${rev.revenue && totalCost / rev.revenue > DB.setting("targetCostRate") ? "bad" : "good"}">
          <div class="k-label">消耗成本率(盤點法)★</div>
          <div class="k-value">${rev.revenue ? U.pct(totalCost / rev.revenue) : "—"}</div>
          <div class="k-note">此品項範圍內;目標 ≤ ${U.pct(DB.setting("targetCostRate"), 0)}</div></div>
        <div class="kpi ${totalCost - totalTheo > 0 ? "bad" : "good"}"><div class="k-label">超出理論用量</div>
          <div class="k-value">${U.fmt$(totalCost - totalTheo)}</div>
          <div class="k-note">= 損耗/浪費/未登記外流</div></div>
      </div>
      ${UI.table(["品項", "#期初", "#進貨", "#期末", "#實際消耗", "#日均", "#消耗成本 ▼"],
        sorted.map(r => `<tr>
          <td><b>${U.esc(r.ing.name)}</b></td>
          <td class="num">${U.fmtNum(r.opening)}</td>
          <td class="num t-green">+${U.fmtNum(r.purchases)}</td>
          <td class="num">${U.fmtNum(r.closing)}</td>
          <td class="num"><b>${U.fmtNum(r.consumed)} ${U.esc(r.ing.stockUnit)}</b></td>
          <td class="num">${U.fmtNum(r.consumed / days)} ${U.esc(r.ing.stockUnit)}</td>
          <td class="num">${U.fmt$(r.cost)}</td>
        </tr>`), "兩次盤點沒有共同品項")}
      <p class="hint">想讓「消耗成本率」涵蓋全部食材 → 盤點時把所有品項都盤到(留空的品項不列入計算)。</p>
    </div>`;
  },

  viewCount(id) {
    const sc = DB.byId("stockCounts", id);
    UI.modal("盤點明細:" + sc.date, UI.table(["品項", "#帳面量", "#實盤量", "#差異"],
      sc.lines.map(l => {
        const ing = DB.byId("ingredients", l.ingredientId);
        return `<tr><td>${U.esc(UI.ingName(l.ingredientId))}</td>
        <td class="num">${U.fmtNum(l.bookQty)}</td><td class="num">${U.fmtNum(l.actualQty)}</td>
        <td class="num ${l.diff < 0 ? "t-red" : l.diff > 0 ? "t-green" : ""}">${l.diff > 0 ? "+" : ""}${U.fmtNum(l.diff)} ${ing ? U.esc(ing.stockUnit) : ""}</td></tr>`;
      })), { hideOk: true });
  },

  newCount() {
    const items = DB.get("ingredients").filter(i => i.active !== false && i.category !== "包材耗材");
    PageStock.countLines = items.map(i => ({ ingredientId: i.id, bookQty: Math.round(Domain.stockQty(i.id) * 100) / 100, actualQty: null }));
    UI.modal("建立盤點單(" + U.today() + ")", `
      <p class="hint" style="margin-bottom:10px">輸入實盤量;留空表示未盤(不調整)。</p>
      ${UI.table(["品項", "#帳面量", "#實盤量"],
        PageStock.countLines.map((l, idx) => {
          const ing = DB.byId("ingredients", l.ingredientId);
          return `<tr><td>${U.esc(ing.name)} <span class="t-muted">(${U.esc(ing.stockUnit)})</span></td>
          <td class="num">${U.fmtNum(l.bookQty)}</td>
          <td class="num"><input id="cnt_${idx}" type="number" step="any" placeholder="—" style="width:100px"></td></tr>`;
        }))}`,
      {
        width: 720, okText: "過帳盤點",
        onOk() {
          const date = U.today();
          const lines = [];
          PageStock.countLines.forEach((l, idx) => {
            const v = UI.val("cnt_" + idx);
            if (v === "") return;
            const actual = parseFloat(v);
            if (isNaN(actual)) return;
            const diff = Math.round((actual - l.bookQty) * 1000) / 1000;
            lines.push({ ingredientId: l.ingredientId, bookQty: l.bookQty, actualQty: actual, diff });
            if (Math.abs(diff) > 0.0005) {
              if (diff < 0) Domain.consumeFEFO(l.ingredientId, -diff, date, "盤點調整", "盤點", "", "盤虧");
              else Domain.addStock(l.ingredientId, diff, date, null, "盤盈", "盤點調整", "盤點", "", null, "盤盈");
            }
          });
          if (!lines.length) { UI.toast("尚未輸入任何實盤量", true); return false; }
          DB.insert("stockCounts", { date, status: "已過帳", lines, note: "" });
          UI.toast(`盤點完成:${lines.length} 品項已過帳`);
          App.refresh();
        }
      });
  }
};

/* ---------------- 損耗登記 ---------------- */
const WASTE_REASONS = ["過期", "耗損", "試吃", "員工餐", "備料失敗"];

const PageWaste = {
  render(c) {
    const from = U.addDays(U.today(), -30);
    const stats = Domain.wasteStats(from, U.today());
    const logs = U.sortBy(DB.get("wasteLogs"), w => w.date, true).slice(0, 60);
    c.innerHTML = `
    <div class="toolbar"><div class="spacer"></div>
      <button class="btn primary" onclick="PageWaste.add()">＋ 登記損耗</button></div>
    <div class="kpi-row">
      <div class="kpi bad"><div class="k-label">近 30 天損耗金額</div><div class="k-value">${U.fmt$(stats.total)}</div></div>
      ${U.sortBy(Object.entries(stats.byReason), e => e[1], true).slice(0, 4).map(([k, v]) =>
        `<div class="kpi"><div class="k-label">${U.esc(k)}</div><div class="k-value" style="font-size:19px">${U.fmt$(v)}</div></div>`).join("")}
    </div>
    <div class="card"><h3>近 30 天損耗原因分布</h3>
      ${Chart.bar({
        width: 700, height: 190, showVal: true, color: "#c62f2f",
        data: U.sortBy(Object.entries(stats.byReason), e => e[1], true).map(([k, v]) => ({ x: k, y: Math.round(v / 100) })),
        yFmt: v => "NT$" + U.fmtNum(v, 0)
      })}
    </div>
    <div class="card"><h3>損耗記錄(最近 60 筆)</h3>
    ${UI.table(["日期", "品項", "#數量", "原因", "#成本", "責任區", "備註"],
      logs.map(w => {
        const ing = DB.byId("ingredients", w.ingredientId);
        return `<tr><td>${w.date}</td><td><b>${U.esc(UI.ingName(w.ingredientId))}</b></td>
        <td class="num">${U.fmtNum(w.qty)} ${ing ? U.esc(ing.stockUnit) : ""}</td>
        <td><span class="badge ${w.reason === "過期" ? "b-red" : "b-orange"}">${U.esc(w.reason)}</span></td>
        <td class="num">${U.fmt$(w.costCents || 0)}</td>
        <td>${U.esc(w.area || "")}</td><td class="t-muted">${U.esc(w.note || "")}</td></tr>`;
      }), "尚無損耗記錄")}
    </div>`;
  },

  quickAdd(ingId, qty, reason) { PageWaste.add(ingId, qty, reason); },

  add(presetIng, presetQty, presetReason) {
    UI.modal("登記損耗", `
      <div class="form-grid">
        <div class="full"><label class="fl">品項 *</label><select id="f_ing" style="width:100%">${UI.ingOptions(presetIng || "")}</select></div>
        <div><label class="fl">數量(庫存單位)*</label><input id="f_qty" type="number" step="any" value="${presetQty || ""}" style="width:100%"></div>
        <div><label class="fl">原因 *</label><select id="f_reason" style="width:100%">${WASTE_REASONS.map(x => `<option ${x === presetReason ? "selected" : ""}>${x}</option>`).join("")}</select></div>
        <div><label class="fl">日期</label><input id="f_date" type="date" value="${U.today()}" style="width:100%"></div>
        <div><label class="fl">責任區</label><select id="f_area" style="width:100%">${["廚房", "自助吧", "外場", "倉庫"].map(x => `<option>${x}</option>`).join("")}</select></div>
        <div class="full"><label class="fl">備註</label><input id="f_note" style="width:100%"></div>
      </div>`,
      {
        okText: "登記並扣庫存",
        onOk() {
          const ingId = UI.val("f_ing"), qty = UI.num("f_qty");
          if (!ingId || qty <= 0) { UI.toast("請選擇品項並輸入數量", true); return false; }
          const date = UI.val("f_date") || U.today();
          const reason = UI.val("f_reason");
          const cost = Math.round(qty * Domain.priceAt(ingId, date));
          const w = DB.insert("wasteLogs", { date, ingredientId: ingId, qty, reason, area: UI.val("f_area"), note: UI.val("f_note"), costCents: cost });
          Domain.consumeFEFO(ingId, qty, date, "損耗", "損耗單", w.id, reason);
          UI.toast("已登記損耗並扣庫存");
          App.refresh();
        }
      });
  }
};

App.register("s_stock", "庫存 — 即時庫存 / 效期", PageStock.renderStock);
App.register("s_count", "庫存 — 定期盤點", PageStock.renderCount);
App.register("s_waste", "庫存 — 損耗登記", PageWaste.render);

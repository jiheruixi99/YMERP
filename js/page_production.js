/* ===== page_production.js — 備料工單 / 輕量MRP / 理論vs實際 ===== */
"use strict";

const PageProd = {
  date: null,
  varFrom: null, varTo: null,
  bufFrom: null, bufTo: null,

  /* ---------------- 備料工單 ---------------- */
  renderMO(c) {
    const date = PageProd.date || U.today();
    PageProd.date = date;
    const fc = Domain.forecastCovers(date);
    const orders = DB.get("productionOrders").filter(p => p.date === date);
    const totalCost = U.sum(orders, o => o.costCents || (o.issued ? 0 : Math.round(Domain.recipeCost(o.recipeId) * o.plannedQty / (DB.byId("recipes", o.recipeId) || { yieldQty: 1 }).yieldQty)));

    // 物料需求(MRP):當日所有未領料工單展開
    const needs = {};
    for (const o of orders.filter(o => !o.issued)) {
      const r = DB.byId("recipes", o.recipeId);
      if (!r) continue;
      Domain.explodeRecipe(o.recipeId, o.plannedQty / r.yieldQty, needs);
    }
    const mrpRows = Object.entries(needs).map(([ingId, useQty]) => {
      const ing = DB.byId("ingredients", ingId);
      if (!ing) return "";
      const stockNeed = useQty / (ing.stockToUse || 1);
      const have = Domain.stockQty(ingId);
      const short = stockNeed > have;
      return `<tr><td>${U.esc(ing.name)}</td>
        <td class="num">${U.fmtNum(stockNeed, 2)} ${U.esc(ing.stockUnit)}</td>
        <td class="num ${short ? "t-red" : ""}">${U.fmtNum(have)} ${U.esc(ing.stockUnit)}</td>
        <td>${short ? '<span class="badge b-red">不足</span>' : '<span class="badge b-green">足夠</span>'}</td></tr>`;
    }).join("");

    const hasOrderData = DB.get("posOrderItems").some(it => it.date === date);
    const orderApplied = DB.get("stockMovements").some(m => m.refType === "點餐明細" && m.refId === date);

    c.innerHTML = `
    ${hasOrderData ? `<div class="alert ${orderApplied ? "info" : "warn"}">
      🧮 ${date} 已有<b>點餐明細</b>資料${orderApplied ? ",理論消耗已用實際點餐計算(比下面的估算準)" : "但尚未套用"} —
      <button class="btn small ${orderApplied ? "" : "primary"}" onclick="App.go('pr_orders')">前往點餐明細頁${orderApplied ? "查看" : "套用"}</button>
      ${orderApplied ? ",下面的估算備料工單僅供排班參考,不要重複計入理論成本" : ""}
    </div>` : ""}
    <div class="toolbar">
      <label class="fl" style="margin:0">日期:</label>
      <input type="date" value="${date}" onchange="PageProd.date=this.value;App.refresh()">
      <span class="badge b-blue">預測來客 ${fc.predicted} 位</span>
      <span class="t-muted" style="font-size:12.5px">(同星期均值 ${fc.base}|訂位 ${fc.reservations} 位)</span>
      <div class="spacer"></div>
      <button class="btn primary" onclick="PageProd.genPlan()">🔮 依預測產生備料工單</button>
      <button class="btn" onclick="PageProd.addMO()">＋ 手動新增工單</button>
    </div>

    <div class="card">
      <h3>📋 ${date} 備料工單 <span class="sub">合計理論成本 ${U.fmt$(totalCost)}</span></h3>
      ${UI.table(["單號", "備料項目", "#計畫產量", "#理論成本", "狀態", "操作"],
        orders.map(o => {
          const r = DB.byId("recipes", o.recipeId);
          const est = o.costCents || (r ? Math.round(Domain.recipeCost(r.id) * o.plannedQty / r.yieldQty) : 0);
          const st = { "待製": "b-gray", "製作中": "b-blue", "完成": "b-green" }[o.status] || "b-gray";
          return `<tr>
            <td class="mono">${U.esc(o.no || "")}</td>
            <td><b>${U.esc(UI.recipeName(o.recipeId))}</b> <span class="t-muted" style="font-size:12px">${r ? U.esc(r.category) : ""}</span></td>
            <td class="num">${o.plannedQty} ${r ? U.esc(r.yieldUnit) : ""}</td>
            <td class="num">${U.fmt$(est)}</td>
            <td><span class="badge ${st}">${o.status}</span>${o.issued ? ' <span class="badge b-blue">已領料</span>' : ""}</td>
            <td>
              ${!o.issued ? `<button class="btn small primary" onclick="PageProd.issue('${o.id}')">領料(扣庫存)</button>` : ""}
              ${o.status === "製作中" ? `<button class="btn small" onclick="DB.update('productionOrders','${o.id}',{status:'完成'});App.refresh()">標記完成</button>` : ""}
              ${!o.issued ? `<button class="btn small ghost-red" onclick="DB.remove('productionOrders','${o.id}');App.refresh()">刪除</button>` : ""}
            </td></tr>`;
        }), "此日期尚無備料工單,可點「依預測產生」")}
    </div>

    <div class="card">
      <h3>🧮 物料需求(MRP)— 未領料工單彙總</h3>
      ${mrpRows ? UI.table(["原物料", "#需求量", "#現有庫存", "供應"], mrpRows) : `<div class="empty">無待領料工單</div>`}
      ${mrpRows ? `<div style="margin-top:10px"><button class="btn small" onclick="App.go('p_sugg')">庫存不足?→ 查看採購建議</button></div>` : ""}
    </div>`;
  },

  genPlan() {
    const date = PageProd.date || U.today();
    const fc = Domain.forecastCovers(date);
    if (fc.predicted <= 0) { UI.toast("預測來客為 0,無法產生", true); return; }
    const created = Domain.generateProductionPlan(date, fc.predicted);
    // 更新/寫入預測記錄
    const exist = DB.get("forecasts").find(f => f.date === date);
    if (exist) DB.update("forecasts", exist.id, { predicted: fc.predicted, method: "規則式" });
    else DB.insert("forecasts", { date, predicted: fc.predicted, actual: null, method: "規則式" });
    UI.toast(created.length ? `已依預測 ${fc.predicted} 位產生 ${created.length} 張工單` : "工單已存在,未重複產生");
    App.refresh();
  },

  addMO() {
    const date = PageProd.date || U.today();
    UI.modal("手動新增備料工單", `
      <div class="form-grid">
        <div class="full"><label class="fl">配方 *</label><select id="f_rcp" style="width:100%">${UI.recipeOptions("")}</select></div>
        <div><label class="fl">計畫產量 *</label><input id="f_qty" type="number" step="any" style="width:100%"></div>
        <div><label class="fl">日期</label><input id="f_date" type="date" value="${date}" style="width:100%"></div>
      </div>`,
      {
        onOk() {
          const rcpId = UI.val("f_rcp"), qty = UI.num("f_qty");
          if (!rcpId || qty <= 0) { UI.toast("請選擇配方並輸入產量", true); return false; }
          const d = UI.val("f_date") || date;
          DB.insert("productionOrders", {
            no: "MO" + d.replace(/-/g, "") + "-" + (DB.get("productionOrders").filter(p => p.date === d).length + 1),
            date: d, recipeId: rcpId, plannedQty: qty, status: "待製", issued: false, costCents: 0
          });
          UI.toast("工單已建立"); App.refresh();
        }
      });
  },

  issue(poId) {
    UI.confirm("領料將依配方展開 BOM 並自動扣庫存(產生理論用量),確定?", () => {
      if (Domain.issueProductionOrder(poId)) { UI.toast("已領料,庫存已扣除"); App.refresh(); }
      else UI.toast("領料失敗", true);
    });
  },

  /* ---------------- 理論 vs 實際 ---------------- */
  renderVar(c) {
    const from = PageProd.varFrom || U.addDays(U.today(), -30);
    const to = PageProd.varTo || U.today();
    PageProd.varFrom = from; PageProd.varTo = to;
    const rows = Domain.theoreticalVsActual(from, to);
    const totTheo = U.sum(rows, r => r.theoCost);
    const totAct = U.sum(rows, r => r.actCost);
    const totDiff = totAct - totTheo;
    const rev = Domain.revenue(from, to);

    c.innerHTML = `
    <div class="alert info">💡 這頁只比對「有打 BOM、算得出理論用量」的品項(肉品/海鮮/湯品)。<b>理論用量</b>=備料工單領料;<b>實際消耗</b>=領料+損耗登記+盤點差異。差異金額就是「成本外流點」,依金額由大到小排列。<br>火鍋料/蔬菜/飲品/麵食等<b>自助吧品項</b>(在食材建檔勾選)算不出每份用量,已排除在此表外,改看下方「自助吧使用量」。</div>
    <div class="toolbar">
      <label class="fl" style="margin:0">期間:</label>
      <input type="date" value="${from}" onchange="PageProd.varFrom=this.value;App.refresh()">~
      <input type="date" value="${to}" onchange="PageProd.varTo=this.value;App.refresh()">
    </div>
    <div class="kpi-row">
      <div class="kpi"><div class="k-label">理論成本(工單領料)</div><div class="k-value">${U.fmt$(totTheo)}</div>
        <div class="k-note">占營收 ${rev.revenue ? U.pct(totTheo / rev.revenue) : "—"}</div></div>
      <div class="kpi"><div class="k-label">實際成本(含損耗盤差)</div><div class="k-value">${U.fmt$(totAct)}</div>
        <div class="k-note">占營收 ${rev.revenue ? U.pct(totAct / rev.revenue) : "—"}</div></div>
      <div class="kpi ${totDiff > 0 ? "bad" : "good"}"><div class="k-label">差異(外流成本)★</div><div class="k-value">${U.fmt$(totDiff)}</div>
        <div class="k-note">占理論成本 ${totTheo ? U.pct(totDiff / totTheo) : "—"}</div></div>
    </div>
    <div class="card">
      <h3>⚖️ 品項層級差異表(${from} ~ ${to})</h3>
      ${UI.table(["品項", "#理論用量", "#實際消耗", "#差異量", "#理論成本", "#差異金額 ▼", "主因"],
        rows.slice(0, 40).map(r => {
          const wasteMain = r.wasteCost > Math.abs(r.adjCost) ? "損耗登記" : (r.adjCost < 0 ? "盤點盤虧" : "—");
          return `<tr>
            <td><b>${U.esc(r.ing.name)}</b></td>
            <td class="num">${U.fmtNum(r.theoQty)} ${U.esc(r.ing.stockUnit)}</td>
            <td class="num">${U.fmtNum(r.actQty)} ${U.esc(r.ing.stockUnit)}</td>
            <td class="num ${r.diffQty > 0.01 ? "t-red" : ""}">${r.diffQty > 0 ? "+" : ""}${U.fmtNum(r.diffQty)}</td>
            <td class="num">${U.fmt$(r.theoCost)}</td>
            <td class="num ${r.diffCost > 100 ? "t-red" : r.diffCost < -100 ? "t-green" : ""}"><b>${U.fmt$(r.diffCost)}</b></td>
            <td class="t-muted">${r.diffCost > 100 ? wasteMain : "—"}</td>
          </tr>`;
        }), "期間內無用量記錄")}
    </div>
    ${PageProd.buffetUsageCard()}`;
  },

  /* ---------------- 自助吧使用量(盤點法) ---------------- */
  buffetUsageCard() {
    const buffetItems = DB.get("ingredients").filter(i => i.active !== false && i.buffet);
    if (!buffetItems.length) {
      return `<div class="card"><h3>🍲 自助吧使用量</h3>
        <div class="empty">尚未有自助吧品項。到「食材品項」編輯火鍋料/蔬菜/飲品/麵食,勾選「自助吧品項」即可歸類到這裡。</div></div>`;
    }
    const counts = U.sortBy(DB.get("stockCounts"), x => x.date); // 升冪
    if (counts.length < 2) {
      return `<div class="card"><h3>🍲 自助吧使用量 <span class="sub">盤點法:期初 + 進貨 − 期末 = 消耗</span></h3>
        <div class="empty">需要至少兩次盤點才能算(這些品項沒有配方可推算,只能靠盤點)。到「庫存 → 定期盤點」每週盤一次,下週就有數字。<br>
        <span class="hint">目前有 ${buffetItems.length} 個自助吧品項待盤點。</span></div></div>`;
    }
    if (!PageProd.bufFrom || !counts.find(x => x.id === PageProd.bufFrom)) PageProd.bufFrom = counts[counts.length - 2].id;
    if (!PageProd.bufTo || !counts.find(x => x.id === PageProd.bufTo)) PageProd.bufTo = counts[counts.length - 1].id;
    const sel = which => `<select onchange="PageProd.${which}=this.value;App.refresh()">` +
      counts.map(x => `<option value="${x.id}" ${x.id === PageProd[which] ? "selected" : ""}>${x.date}</option>`).join("") + `</select>`;
    const head = `<div class="toolbar">期初盤點:${sel("bufFrom")} → 期末盤點:${sel("bufTo")}</div>`;

    const res = Domain.intervalConsumption(PageProd.bufFrom, PageProd.bufTo, ing => ing.buffet);
    if (!res) {
      return `<div class="card"><h3>🍲 自助吧使用量</h3>${head}
        <div class="alert warn">期初盤點日必須早於期末盤點日</div></div>`;
    }
    const totalCost = U.sum(res.rows, r => r.cost);
    const rev = Domain.revenue(U.addDays(res.cFrom.date, 1), res.cTo.date);
    const countedIds = new Set(res.rows.map(r => r.ing.id));
    const missed = buffetItems.filter(i => !countedIds.has(i.id));

    return `<div class="card">
      <h3>🍲 自助吧使用量 <span class="sub">盤點法:期初實盤 + 期間進貨 − 期末實盤 = 消耗(火鍋料/蔬菜/飲品/麵食)</span></h3>
      ${head}<span class="badge b-gray" style="margin-left:6px">${res.days} 天</span>
      <div class="kpi-row" style="margin-top:12px">
        <div class="kpi"><div class="k-label">自助吧消耗成本</div><div class="k-value">${U.fmt$(totalCost)}</div>
          <div class="k-note">日均 ${U.fmt$(Math.round(totalCost / res.days))}</div></div>
        <div class="kpi"><div class="k-label">區間營收</div><div class="k-value">${U.fmt$(rev.revenue)}</div>
          <div class="k-note">${rev.covers} 位來客</div></div>
        <div class="kpi ${rev.revenue && totalCost / rev.revenue > 0.30 ? "warn" : "good"}">
          <div class="k-label">自助吧成本占營收</div>
          <div class="k-value">${rev.revenue ? U.pct(totalCost / rev.revenue) : "—"}</div>
          <div class="k-note">此範圍內品項</div></div>
      </div>
      ${UI.table(["品項", "分類", "#期初", "#進貨", "#期末", "#消耗量", "#日均", "#消耗成本 ▼"],
        res.rows.map(r => `<tr>
          <td><b>${U.esc(r.ing.name)}</b></td>
          <td><span class="badge b-gray">${U.esc(r.ing.category)}</span></td>
          <td class="num">${U.fmtNum(r.opening)}</td>
          <td class="num t-green">+${U.fmtNum(r.purchases)}</td>
          <td class="num">${U.fmtNum(r.closing)}</td>
          <td class="num ${r.consumed < 0 ? "t-red" : ""}"><b>${U.fmtNum(r.consumed)} ${U.esc(r.ing.stockUnit)}</b></td>
          <td class="num">${U.fmtNum(r.consumed / res.days)}</td>
          <td class="num">${U.fmt$(r.cost)}</td></tr>`),
        "這兩次盤點沒有共同的自助吧品項")}
      ${missed.length ? `<p class="hint">⚠️ 這 ${missed.length} 個自助吧品項這兩次沒都盤到,未列入:${missed.slice(0, 8).map(i => U.esc(i.name)).join("、")}${missed.length > 8 ? "…" : ""}。盤點時記得補上才算得準。</p>` : ""}
      <p class="hint">消耗量出現<b class="t-red">負數</b>=期末比「期初+進貨」還多 → 可能漏登記進貨或盤點打錯,建議回頭檢查。</p>
    </div>`;
  }
};

App.register("pr_mo", "生產 — 備料工單(中央備料)", PageProd.renderMO);
App.register("pr_var", "生產 — 理論 vs 實際用量 ★", PageProd.renderVar);

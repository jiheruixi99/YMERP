/* ===== domain.js — 核心商業邏輯(成本閉環) ===== */
"use strict";

const Domain = {

  /* ================== 價格 ================== */

  // 品項在指定日期(含)之前的最近一次進貨單價(分/庫存單位);無進貨記錄則用供應商報價
  // 註:同一天有多筆時取「最後登記」的那筆(升冪穩定排序後取最後一筆)
  priceAt(ingId, dateStr) {
    const hist = DB.get("priceHistory").filter(p => p.ingredientId === ingId && (!dateStr || p.date <= dateStr));
    if (hist.length) {
      const asc = U.sortBy(hist, p => p.date);
      return asc[asc.length - 1].unitPrice;
    }
    const sp = DB.get("supplierPrices").filter(p => p.ingredientId === ingId);
    if (sp.length) {
      const asc = U.sortBy(sp, p => p.effectiveDate);
      return asc[asc.length - 1].unitPrice;
    }
    return 0;
  },
  currentPrice(ingId) { return Domain.priceAt(ingId, null); },

  // 價格統計:最新價、前次價、30天變化、去年同期、異常
  priceStats(ingId) {
    const hist = U.sortBy(DB.get("priceHistory").filter(p => p.ingredientId === ingId), p => p.date);
    if (!hist.length) return null;
    const latest = hist[hist.length - 1];
    const prev = hist.length > 1 ? hist[hist.length - 2] : null;
    const d30 = U.addDays(latest.date, -30);
    const before30 = [...hist].reverse().find(p => p.date <= d30);
    const yoyDate = U.addDays(latest.date, -365);
    const yoyList = hist.filter(p => Math.abs(U.diffDays(p.date, yoyDate)) <= 20);
    const yoy = yoyList.length ? yoyList[yoyList.length - 1] : null;
    const chgPrev = prev ? (latest.unitPrice - prev.unitPrice) / prev.unitPrice : null;
    const chg30 = before30 ? (latest.unitPrice - before30.unitPrice) / before30.unitPrice : null;
    const chgYoy = yoy ? (latest.unitPrice - yoy.unitPrice) / yoy.unitPrice : null;
    const th = DB.setting("priceAlertPct");
    return {
      latest, prev, chgPrev, chg30, chgYoy, hist,
      abnormal: (chgPrev != null && Math.abs(chgPrev) >= th) || (chg30 != null && Math.abs(chg30) >= th)
    };
  },

  // 全品項價格異常清單(只列上漲/下跌超過閾值者)
  priceAlerts() {
    const out = [];
    for (const ing of DB.get("ingredients").filter(i => i.active !== false)) {
      const s = Domain.priceStats(ing.id);
      if (s && s.abnormal) out.push({ ing, stats: s });
    }
    return U.sortBy(out, o => Math.abs(o.stats.chg30 != null ? o.stats.chg30 : o.stats.chgPrev || 0), true);
  },

  // 替代品建議:同分類、近30天價格穩定(未異常)的品項
  substitutes(ingId) {
    const ing = DB.byId("ingredients", ingId);
    if (!ing) return [];
    return DB.get("ingredients")
      .filter(i => i.id !== ingId && i.category === ing.category && i.active !== false)
      .map(i => ({ ing: i, stats: Domain.priceStats(i.id) }))
      .filter(o => o.stats && !o.stats.abnormal)
      .slice(0, 4);
  },

  /* ================== 庫存 ================== */

  stockQty(ingId) {
    return U.sum(DB.get("stockBatches").filter(b => b.ingredientId === ingId), b => b.qty);
  },
  stockValue(ingId) {
    return Math.round(Domain.stockQty(ingId) * Domain.currentPrice(ingId));
  },

  // FEFO 扣庫存;qty 為正數(庫存單位)。回傳實際扣除量
  consumeFEFO(ingId, qty, date, type, refType, refId, note) {
    let remain = qty;
    const batches = U.sortBy(DB.get("stockBatches").filter(b => b.ingredientId === ingId && b.qty > 0), b => b.expiry || "9999-12-31");
    for (const b of batches) {
      if (remain <= 0.0001) break;
      const take = Math.min(b.qty, remain);
      b.qty = Math.round((b.qty - take) * 1000) / 1000;
      remain -= take;
    }
    DB.data.stockBatches = DB.get("stockBatches").filter(b => b.qty > 0.0005);
    const price = Domain.priceAt(ingId, date);
    DB.insert("stockMovements", {
      date, type, ingredientId: ingId,
      qty: -qty, costCents: -Math.round(qty * price),
      refType: refType || "", refId: refId || "", note: note || ""
    });
    return qty - Math.max(0, remain); // 不足時仍照扣(帳面可為 0),回傳實扣
  },

  addStock(ingId, qty, date, expiry, batchNo, type, refType, refId, unitPrice, note) {
    DB.insert("stockBatches", { ingredientId: ingId, qty, expiry: expiry || null, batchNo: batchNo || "", receivedDate: date, srcType: refType || "", srcId: refId || "" });
    const price = unitPrice != null ? unitPrice : Domain.priceAt(ingId, date);
    DB.insert("stockMovements", {
      date, type: type || "進貨", ingredientId: ingId,
      qty, costCents: Math.round(qty * price),
      refType: refType || "", refId: refId || "", note: note || ""
    });
  },

  // 反轉一張進貨單:移除它建立的批號、庫存異動、價格歷史(供修改/刪除進貨用)
  reverseGoodsReceipt(grId) {
    DB.data.stockBatches = DB.get("stockBatches").filter(b => !(b.srcType === "進貨" && b.srcId === grId));
    DB.data.stockMovements = DB.get("stockMovements").filter(m => !(m.type === "進貨" && m.refId === grId));
    DB.data.priceHistory = DB.get("priceHistory").filter(p => p.grId !== grId);
  },

  // 效期預警
  expiryWarnings() {
    const warnDate = U.addDays(U.today(), DB.setting("expiryWarnDays"));
    return U.sortBy(
      DB.get("stockBatches").filter(b => b.expiry && b.expiry <= warnDate && b.qty > 0),
      b => b.expiry
    ).map(b => ({ batch: b, ing: DB.byId("ingredients", b.ingredientId), expired: b.expiry < U.today() }));
  },

  // 低於安全庫存清單
  lowStockList() {
    return DB.get("ingredients")
      .filter(i => i.active !== false && i.safetyStock > 0)
      .map(i => ({ ing: i, qty: Domain.stockQty(i.id) }))
      .filter(o => o.qty < o.ing.safetyStock);
  },

  // 近 N 天日均消耗(領用+損耗,庫存單位)
  avgDailyUsage(ingId, days) {
    days = days || 14;
    const from = U.addDays(U.today(), -days);
    const mv = DB.get("stockMovements").filter(m =>
      m.ingredientId === ingId && m.date >= from && (m.type === "領用" || m.type === "損耗"));
    return U.sum(mv, m => -m.qty) / days;
  },

  /* ================== 配方成本(BOM,支援多層) ================== */

  // 配方總成本(分,整批 yieldQty 份的成本);seen 防循環
  recipeCost(recipeId, seen) {
    seen = seen || new Set();
    if (seen.has(recipeId)) return 0;
    seen.add(recipeId);
    const r = DB.byId("recipes", recipeId);
    if (!r) return 0;
    let total = 0;
    for (const ln of r.lines) {
      if (ln.kind === "ing") {
        const ing = DB.byId("ingredients", ln.refId);
        if (!ing) continue;
        const stockQty = ln.qty / (ing.stockToUse || 1); // 使用單位 → 庫存單位
        total += stockQty * Domain.currentPrice(ing.id);
      } else {
        const sub = DB.byId("recipes", ln.refId);
        if (!sub || !sub.yieldQty) continue;
        total += ln.qty * (Domain.recipeCost(sub.id, seen) / sub.yieldQty);
      }
    }
    return Math.round(total);
  },
  recipeUnitCost(recipeId) {
    const r = DB.byId("recipes", recipeId);
    if (!r || !r.yieldQty) return 0;
    return Math.round(Domain.recipeCost(recipeId) / r.yieldQty);
  },

  // 把配方展開成基礎原物料需求 {ingId: 使用單位數量},qtyBatches=生產批數比例
  explodeRecipe(recipeId, factor, acc, seen) {
    acc = acc || {};
    seen = seen || new Set();
    if (seen.has(recipeId)) return acc;
    const r = DB.byId("recipes", recipeId);
    if (!r) return acc;
    const s2 = new Set(seen); s2.add(recipeId);
    for (const ln of r.lines) {
      if (ln.kind === "ing") {
        acc[ln.refId] = (acc[ln.refId] || 0) + ln.qty * factor;
      } else {
        const sub = DB.byId("recipes", ln.refId);
        if (!sub || !sub.yieldQty) continue;
        Domain.explodeRecipe(sub.id, factor * ln.qty / sub.yieldQty, acc, s2);
      }
    }
    return acc;
  },

  /* ================== 點餐明細 → 精準理論消耗 ==================
     用戶每天可從 POS 匯出「點餐明細(分析)」CSV(逐項訂單明細,非日彙總)。
     流程:商品名稱 比對 menuMap → 配方(依單價分辨份量)→ × 數量 → 展開 BOM →
     當天 FEFO 領用,取代「人均估算」的理論消耗。 */

  // 商品名稱(+單價、點餐來源)→ 配方 id。
  // 同名品項可能份量不同(如「特級羊肩肉」雙人餐160g vs 4人餐300g,兩邊常都是0元包在套餐內,
  // 單價分不出來),此時靠「點餐來源」文字比對(menuMap.sourceMatch,如"雙人"/"4人")分辨。
  // 都分不出來時寧可回傳 null(未對應,UI 會顯示提醒),不亂猜以免默默算錯成本。
  matchMenuItem(productName, unitPrice, source) {
    const name = (productName || "").trim();
    if (!name) return null;
    let candidates = DB.get("menuMap").filter(m => m.productName === name);
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0].recipeId;
    // 1) 先用點餐來源縮小範圍
    if (source) {
      const bySource = candidates.filter(c => c.sourceMatch && source.includes(c.sourceMatch));
      if (bySource.length === 1) return bySource[0].recipeId;
      if (bySource.length > 1) candidates = bySource;
    }
    if (candidates.length === 1) return candidates[0].recipeId;
    // 2) 再用單價找最接近的(只在有候選帶了 priceMatch 時採用)
    const withPrice = candidates.filter(c => c.priceMatch != null);
    if (withPrice.length) {
      let best = withPrice[0], bestDiff = Math.abs(withPrice[0].priceMatch - (unitPrice || 0));
      for (const c of withPrice) {
        const diff = Math.abs(c.priceMatch - (unitPrice || 0));
        if (diff < bestDiff) { bestDiff = diff; best = c; }
      }
      return best.recipeId;
    }
    // 3) 仍分不出來 → 不猜,回傳未對應
    return null;
  },

  // 重新對應所有未對應成功的明細列(菜單對照表更新後呼叫)
  rematchOrderItems() {
    let matched = 0;
    for (const it of DB.get("posOrderItems")) {
      const recipeId = Domain.matchMenuItem(it.productName, it.unitPrice, it.source);
      if (recipeId !== it.matchedRecipeId) { it.matchedRecipeId = recipeId; DB.save(); }
      if (recipeId) matched++;
    }
    return matched;
  },

  // 套用/重算某天的點餐明細理論消耗:先回沖該天舊的(冪等,可重複執行),再依目前對應重新展開扣庫存
  applyOrderConsumption(date) {
    // 回沖:把該天由點餐明細扣掉的量直接加回庫存批號(不留回沖記錄,舊領用記錄整批刪除即可)
    const old = DB.get("stockMovements").filter(m => m.refType === "點餐明細" && m.refId === date);
    for (const m of old) {
      if (m.qty < 0) DB.insert("stockBatches", { ingredientId: m.ingredientId, qty: -m.qty, expiry: null, batchNo: "回沖", receivedDate: date });
    }
    DB.data.stockMovements = DB.get("stockMovements").filter(m => !(m.refType === "點餐明細" && m.refId === date));

    const items = DB.get("posOrderItems").filter(it => it.date === date && it.matchedRecipeId);
    if (!items.length) return { orders: 0, ingredients: 0 };
    const needs = {};
    for (const it of items) {
      const r = DB.byId("recipes", it.matchedRecipeId);
      if (!r || !r.yieldQty) continue;
      Domain.explodeRecipe(it.matchedRecipeId, (it.qty || 1) / r.yieldQty, needs);
    }
    let count = 0;
    for (const [ingId, useQty] of Object.entries(needs)) {
      const ing = DB.byId("ingredients", ingId);
      if (!ing) continue;
      const stockQty = Math.round(useQty / (ing.stockToUse || 1) * 1000) / 1000;
      if (stockQty <= 0) continue;
      Domain.consumeFEFO(ingId, stockQty, date, "領用", "點餐明細", date, "點餐明細精準理論消耗");
      count++;
    }
    return { orders: items.length, ingredients: count };
  },

  // 匯入 CSV 明細列(去重):唯一鍵 = 日期+發票號碼+商品名稱+單價+序位(同單同品名多列時避免互相覆蓋)
  importOrderItems(rows) {
    let added = 0, skipped = 0;
    const seenKeys = new Set(DB.get("posOrderItems").map(it => it.dedupeKey));
    let seq = 0;
    for (const r of rows) {
      seq++;
      const key = [r.date, r.invoiceNo, r.productName, r.unitPrice, r.qty, seq].join("|");
      if (seenKeys.has(key)) { skipped++; continue; }
      const recipeId = Domain.matchMenuItem(r.productName, r.unitPrice, r.source);
      DB.insert("posOrderItems", {
        date: r.date, invoiceNo: r.invoiceNo, productName: r.productName, source: r.source || "",
        qty: r.qty, unitPrice: r.unitPrice, matchedRecipeId: recipeId, dedupeKey: key
      });
      seenKeys.add(key);
      added++;
    }
    return { added, skipped };
  },

  /* ================== 備料工單 ================== */

  // 工單領料:展開 BOM → FEFO 扣庫存 → 記錄理論用量
  issueProductionOrder(poId) {
    const po = DB.byId("productionOrders", poId);
    if (!po || po.issued) return false;
    const r = DB.byId("recipes", po.recipeId);
    if (!r) return false;
    const needs = Domain.explodeRecipe(po.recipeId, po.plannedQty / r.yieldQty);
    let cost = 0;
    for (const [ingId, useQty] of Object.entries(needs)) {
      const ing = DB.byId("ingredients", ingId);
      if (!ing) continue;
      const stockQty = Math.round(useQty / (ing.stockToUse || 1) * 1000) / 1000;
      if (stockQty <= 0) continue;
      Domain.consumeFEFO(ingId, stockQty, po.date, "領用", "工單", po.id, r.name);
      cost += Math.round(stockQty * Domain.priceAt(ingId, po.date));
    }
    DB.update("productionOrders", poId, { issued: true, status: "製作中", costCents: cost });
    return true;
  },

  // 依來客預測產生備料工單(perCover>0 的配方)
  generateProductionPlan(dateStr, covers) {
    const created = [];
    for (const r of DB.get("recipes").filter(r => (r.perCover || 0) > 0 && r.category !== "半成品")) {
      const needServes = covers * r.perCover;
      const batches = Math.max(1, Math.ceil(needServes / r.yieldQty * 10) / 10);
      const plannedQty = Math.round(batches * r.yieldQty * 10) / 10;
      const exists = DB.get("productionOrders").find(p => p.date === dateStr && p.recipeId === r.id);
      if (exists) continue;
      created.push(DB.insert("productionOrders", {
        no: "MO" + dateStr.replace(/-/g, "") + "-" + (DB.get("productionOrders").filter(p => p.date === dateStr).length + 1),
        date: dateStr, recipeId: r.id, plannedQty,
        status: "待製", issued: false, costCents: 0
      }));
    }
    return created;
  },

  /* ================== 來客預測 ================== */

  // 規則式 MVP:過去 N 週同星期平均 × 係數,再與現有訂位取大值
  forecastCovers(dateStr) {
    const weeks = DB.setting("forecastBaseWeeks");
    const wd = U.weekday(dateStr);
    const sales = DB.get("salesDaily").filter(s => s.date < dateStr && U.weekday(s.date) === wd);
    const recent = U.sortBy(sales, s => s.date, true).slice(0, weeks);
    let base = recent.length ? U.sum(recent, s => s.covers) / recent.length : 0;
    const resv = U.sum(DB.get("reservations").filter(rv => rv.date === dateStr && rv.status !== "取消"), rv => rv.partySize);
    const predicted = Math.round(Math.max(base, resv));
    return { predicted, base: Math.round(base), reservations: resv, samples: recent.length };
  },

  // 預測準確度(近 N 天):比對 forecasts.predicted 與 salesDaily.covers
  forecastAccuracy(days) {
    const from = U.addDays(U.today(), -(days || 30));
    const rows = [];
    for (const f of DB.get("forecasts").filter(f => f.date >= from && f.date < U.today())) {
      const s = DB.get("salesDaily").find(s => s.date === f.date);
      if (!s) continue;
      rows.push({ date: f.date, predicted: f.predicted, actual: s.covers, err: s.covers ? (f.predicted - s.covers) / s.covers : null });
    }
    return U.sortBy(rows, r => r.date);
  },

  /* ================== 採購建議 ================== */

  purchaseSuggestions() {
    const coverDays = DB.setting("coverDays");
    const out = [];
    for (const ing of DB.get("ingredients").filter(i => i.active !== false && i.category !== "包材耗材")) {
      const stock = Domain.stockQty(ing.id);
      const daily = Domain.avgDailyUsage(ing.id);
      const need = daily * coverDays + (ing.safetyStock || 0) - stock;
      if (need <= 0.001) continue;
      const purQty = Math.max(1, Math.ceil(need / (ing.purToStock || 1)));
      // 比價:各供應商最新報價
      const prices = Object.values(U.groupBy(
        DB.get("supplierPrices").filter(p => p.ingredientId === ing.id),
        p => p.supplierId
      )).map(list => U.sortBy(list, p => p.effectiveDate, true)[0]);
      const best = prices.length ? U.sortBy(prices, p => p.unitPrice)[0] : null;
      const stats = Domain.priceStats(ing.id);
      out.push({
        ing, stock, daily, need, purQty,
        best, prices,
        supplierId: best ? best.supplierId : ing.defaultSupplierId,
        abnormal: stats ? stats.abnormal : false,
        chg30: stats ? stats.chg30 : null
      });
    }
    return U.sortBy(out, o => o.need * Domain.currentPrice(o.ing.id), true);
  },

  /* ================== 成本 / 報表 ================== */

  // 期間食材成本(分):theoretical=工單領用;actual=領用+損耗+盤虧
  foodCost(from, to) {
    let theo = 0, waste = 0, countLoss = 0, countGain = 0;
    for (const m of DB.get("stockMovements")) {
      if (m.date < from || m.date > to) continue;
      if (m.type === "領用") theo += -m.costCents;
      else if (m.type === "損耗") waste += -m.costCents;
      else if (m.type === "盤點調整") {
        if (m.costCents < 0) countLoss += -m.costCents; else countGain += m.costCents;
      }
    }
    return { theo, waste, countLoss, countGain, actual: theo + waste + countLoss - countGain };
  },

  revenue(from, to) {
    const list = DB.get("salesDaily").filter(s => s.date >= from && s.date <= to);
    return { revenue: U.sum(list, s => s.revenue), covers: U.sum(list, s => s.covers), days: list.length };
  },

  // 每日成本率序列
  costRateSeries(from, to) {
    const out = [];
    let d = from;
    while (d <= to) {
      const rev = DB.get("salesDaily").find(s => s.date === d);
      const fc = Domain.foodCost(d, d);
      out.push({
        date: d,
        revenue: rev ? rev.revenue : 0,
        covers: rev ? rev.covers : 0,
        cost: fc.actual, theo: fc.theo,
        rate: rev && rev.revenue > 0 ? fc.actual / rev.revenue : null
      });
      d = U.addDays(d, 1);
    }
    return out;
  },

  // 理論 vs 實際用量差異(期間,依品項)
  theoreticalVsActual(from, to) {
    const map = {};
    for (const m of DB.get("stockMovements")) {
      if (m.date < from || m.date > to) continue;
      const e = map[m.ingredientId] = map[m.ingredientId] || { theoQty: 0, theoCost: 0, wasteQty: 0, wasteCost: 0, adjQty: 0, adjCost: 0 };
      if (m.type === "領用") { e.theoQty += -m.qty; e.theoCost += -m.costCents; }
      else if (m.type === "損耗") { e.wasteQty += -m.qty; e.wasteCost += -m.costCents; }
      else if (m.type === "盤點調整") { e.adjQty += m.qty; e.adjCost += m.costCents; }
    }
    const rows = [];
    for (const [ingId, e] of Object.entries(map)) {
      const ing = DB.byId("ingredients", ingId);
      if (!ing) continue;
      const actQty = e.theoQty + e.wasteQty - e.adjQty;
      const actCost = e.theoCost + e.wasteCost - e.adjCost;
      const diffCost = actCost - e.theoCost;
      if (Math.abs(e.theoCost) < 1 && Math.abs(diffCost) < 1) continue;
      rows.push({ ing, ...e, actQty, actCost, diffQty: actQty - e.theoQty, diffCost });
    }
    return U.sortBy(rows, r => r.diffCost, true);
  },

  /* ================== 月財報(現金基礎損益) ==================
     總獲利 = 營收 − 進貨(物料+雜項) − 人力(時薪×時數+獎金−勞健保)
              − 營業費用(水電/租金/瓦斯/雜費…) − 手續費(依費率) − 稅金 */
  laborCost(l) {
    return Math.round((l.hourlyRate || 0) * (l.hours || 0)) + (l.bonus || 0) - (l.insurance || 0);
  },

  monthlyPnl(ym) {
    const days = U.monthDays(ym);
    const from = days[0], to = days[days.length - 1];
    // 營收(依支付方式;舊資料 payMobile 視為 LINE Pay)
    const sales = DB.get("salesDaily").filter(s => s.date >= from && s.date <= to);
    const revenue = U.sum(sales, s => s.revenue);
    const pay = {
      cash: U.sum(sales, s => s.payCash || 0),
      card: U.sum(sales, s => s.payCard || 0),
      line: U.sum(sales, s => s.payLine != null ? s.payLine : (s.payMobile || 0)),
      jko: U.sum(sales, s => s.payJko || 0)
    };
    // 進貨支出:物料(食材) vs 雜項(包材耗材)
    let purchasesFood = 0, purchasesMisc = 0;
    for (const m of DB.get("stockMovements")) {
      if (m.type !== "進貨" || m.date < from || m.date > to) continue;
      const ing = DB.byId("ingredients", m.ingredientId);
      if (ing && ing.category === "包材耗材") purchasesMisc += m.costCents;
      else purchasesFood += m.costCents;
    }
    // 人力成本(PT 登記;無登記則用設定的備援估計)
    const laborLogs = DB.get("laborLogs").filter(l => l.date >= from && l.date <= to);
    let labor = U.sum(laborLogs, Domain.laborCost);
    let laborEst = false;
    if (!laborLogs.length && DB.setting("monthlyLabor")) { labor = DB.setting("monthlyLabor"); laborEst = true; }
    // 營業費用(支出登記;無登記則用備援估計)
    const exps = DB.get("expenses").filter(x => x.date >= from && x.date <= to);
    const expByCat = {};
    for (const x of exps) expByCat[x.category] = (expByCat[x.category] || 0) + x.amount;
    let expEst = false;
    if (!exps.length) {
      if (DB.setting("monthlyRent")) expByCat["租金"] = DB.setting("monthlyRent");
      if (DB.setting("monthlyUtility")) expByCat["水電"] = DB.setting("monthlyUtility");
      if (DB.setting("monthlyOther")) expByCat["雜費"] = DB.setting("monthlyOther");
      expEst = !!Object.keys(expByCat).length;
    }
    const tax = expByCat["稅金"] || 0;
    const expensesTotal = U.sum(Object.values(expByCat)) - tax;
    // 手續費(依費率自動計算)
    const fees = {
      card: Math.round(pay.card * (DB.setting("feeCardPct") || 0)),
      line: Math.round(pay.line * (DB.setting("feeLinePct") || 0)),
      jko: Math.round(pay.jko * (DB.setting("feeJkoPct") || 0))
    };
    const feeTotal = fees.card + fees.line + fees.jko;
    const totalCost = purchasesFood + purchasesMisc + labor + expensesTotal + feeTotal + tax;
    const profit = revenue - totalCost;
    return {
      ym, from, to, revenue, pay, covers: U.sum(sales, s => s.covers), salesDays: sales.length,
      purchasesFood, purchasesMisc, labor, laborEst, laborCount: laborLogs.length,
      expByCat, expensesTotal, expEst, tax, fees, feeTotal,
      totalCost, profit, margin: revenue ? profit / revenue : null
    };
  },

  // 損耗統計(期間)
  wasteStats(from, to) {
    const logs = DB.get("wasteLogs").filter(w => w.date >= from && w.date <= to);
    const byReason = {};
    const byIng = {};
    for (const w of logs) {
      const cost = w.costCents || Math.round(w.qty * Domain.priceAt(w.ingredientId, w.date));
      byReason[w.reason] = (byReason[w.reason] || 0) + cost;
      byIng[w.ingredientId] = (byIng[w.ingredientId] || 0) + cost;
    }
    const total = U.sum(Object.values(byReason));
    return { logs, byReason, byIng, total };
  }
};

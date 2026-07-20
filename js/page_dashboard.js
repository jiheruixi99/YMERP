/* ===== page_dashboard.js — 儀表板(北極星:食材成本率) ===== */
"use strict";

const PageDash = {
  render(c) {
    const today = U.today();
    const ym = U.thisMonth();
    const monthDays = U.monthDays(ym).filter(d => d <= today);
    const mFrom = monthDays[0], mTo = monthDays[monthDays.length - 1];
    const target = DB.setting("targetCostRate");

    // 本月數據
    const rev = Domain.revenue(mFrom, mTo);
    const fc = Domain.foodCost(mFrom, mTo);
    const rate = rev.revenue > 0 ? fc.actual / rev.revenue : null;

    // 今日
    const todaySales = DB.get("salesDaily").find(s => s.date === today);
    const todayCost = Domain.foodCost(today, today);
    const yFc = Domain.forecastCovers(today);

    // 30 天成本率趨勢
    const series = Domain.costRateSeries(U.addDays(today, -30), U.addDays(today, -1))
      .filter(d => d.revenue > 0);

    // 警示
    const alerts = Domain.priceAlerts();
    const expiry = Domain.expiryWarnings();
    const lowStock = Domain.lowStockList();
    const waste = Domain.wasteStats(mFrom, mTo);

    const kpiCls = rate == null ? "" : rate <= target ? "good" : rate <= target + 0.05 ? "warn" : "bad";

    c.innerHTML = `
    <div class="kpi-row">
      <div class="kpi ${kpiCls}">
        <div class="k-label">本月食材成本率(實際)★</div>
        <div class="k-value">${rate == null ? "—" : U.pct(rate)}</div>
        <div class="k-note">目標 ≤ ${U.pct(target, 0)}|理論 ${rev.revenue > 0 ? U.pct(fc.theo / rev.revenue) : "—"}</div>
      </div>
      <div class="kpi">
        <div class="k-label">本月營收 / 來客</div>
        <div class="k-value">${U.fmt$(rev.revenue)}</div>
        <div class="k-note">${U.fmtNum(rev.covers, 0)} 位|客單 ${rev.covers ? U.fmt$(Math.round(rev.revenue / rev.covers)) : "—"}</div>
      </div>
      <div class="kpi">
        <div class="k-label">本月食材成本(實際)</div>
        <div class="k-value">${U.fmt$(fc.actual)}</div>
        <div class="k-note">損耗 ${U.fmt$(fc.waste)}+盤虧 ${U.fmt$(fc.countLoss)}</div>
      </div>
      <div class="kpi ${alerts.length ? "bad" : "good"}">
        <div class="k-label">價格異常品項</div>
        <div class="k-value">${alerts.length}</div>
        <div class="k-note">漲跌幅超過 ±${U.pct(DB.setting("priceAlertPct"), 0)}</div>
      </div>
      <div class="kpi ${expiry.length ? "warn" : "good"}">
        <div class="k-label">效期預警批號</div>
        <div class="k-value">${expiry.length}</div>
        <div class="k-note">${DB.setting("expiryWarnDays")} 天內到期(含已過期)</div>
      </div>
    </div>

    <div class="card">
      <h3>📉 食材成本率趨勢(近 30 天)<span class="sub">實際成本 ÷ 當日營收,虛線為目標值</span></h3>
      ${Chart.line({
        width: 900, height: 250,
        series: [{ name: "實際成本率", color: "#c62f2f", data: series.map(d => ({ x: U.mdLabel(d.date), y: d.rate == null ? null : +(d.rate * 100).toFixed(1) })) },
                 { name: "理論成本率", color: "#1f5fa8", data: series.map(d => ({ x: U.mdLabel(d.date), y: d.revenue ? +(d.theo / d.revenue * 100).toFixed(1) : null })) }],
        refLines: [{ y: target * 100, label: "目標 " + U.pct(target, 0), color: "#b26a00" }],
        yFmt: v => v.toFixed(0) + "%"
      })}
    </div>

    <div class="grid2" style="margin-bottom:16px">
      <div class="card">
        <h3>💰 今日速報(${today} 週${U.weekdayName(today)})</h3>
        ${UI.table(["項目", "#數值"], [
          ["今日營收", todaySales ? U.fmt$(todaySales.revenue) : `<span class="t-muted">尚未匯入</span>`],
          ["今日來客(預測 " + yFc.predicted + " 位)", todaySales ? U.fmtNum(todaySales.covers, 0) + " 位" : `<span class="t-muted">—</span>`],
          ["今日食材成本(理論,依領用)", U.fmt$(todayCost.theo)],
          ["今日損耗", `<span class="${todayCost.waste > 0 ? "t-red" : ""}">${U.fmt$(todayCost.waste)}</span>`],
          ["今日粗估毛利", todaySales ? `<b>${U.fmt$(todaySales.revenue - todayCost.actual)}</b>` : `<span class="t-muted">—</span>`],
          ["今日訂位", U.fmtNum(U.sum(DB.get("reservations").filter(r => r.date === today && r.status !== "取消"), r => r.partySize), 0) + " 位"]
        ].map(r => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td></tr>`))}
      </div>
      <div class="card">
        <h3>🚨 價格異常警示 <span class="sub">點品項可看趨勢</span></h3>
        ${UI.table(["品項", "#最新價", "#30天漲跌"], alerts.slice(0, 8).map(a => `
          <tr style="cursor:pointer" onclick="PagePurchase.gotoTrend('${a.ing.id}')">
            <td>${U.esc(a.ing.name)} ${a.ing.seasonal ? '<span class="badge b-blue">季節</span>' : ""}</td>
            <td class="num">${U.fmt$(a.stats.latest.unitPrice, 1)}/${U.esc(a.ing.stockUnit)}</td>
            <td class="num">${UI.pctBadge(a.stats.chg30 != null ? a.stats.chg30 : a.stats.chgPrev)}</td>
          </tr>`), "目前無價格異常")}
      </div>
    </div>

    <div class="grid2">
      <div class="card">
        <h3>⏰ 效期預警</h3>
        ${UI.table(["品項", "批號", "#數量", "效期"], expiry.slice(0, 8).map(e => `
          <tr><td>${U.esc(e.ing ? e.ing.name : "?")}</td><td>${U.esc(e.batch.batchNo)}</td>
          <td class="num">${U.fmtNum(e.batch.qty)} ${U.esc(e.ing ? e.ing.stockUnit : "")}</td>
          <td>${e.expired ? `<span class="badge b-red">已過期 ${e.batch.expiry}</span>` : `<span class="badge b-orange">${e.batch.expiry}</span>`}</td></tr>`),
        "無即期品項")}
      </div>
      <div class="card">
        <h3>📦 低於安全庫存</h3>
        ${UI.table(["品項", "#現有", "#安全庫存"], lowStock.slice(0, 8).map(o => `
          <tr><td>${U.esc(o.ing.name)}</td>
          <td class="num t-red">${U.fmtNum(o.qty)} ${U.esc(o.ing.stockUnit)}</td>
          <td class="num">${U.fmtNum(o.ing.safetyStock)} ${U.esc(o.ing.stockUnit)}</td></tr>`),
        "庫存皆高於安全水位")}
        <div style="margin-top:10px"><button class="btn small" onclick="App.go('p_sugg')">→ 查看採購建議</button></div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3>🗑️ 本月損耗來源 <span class="sub">合計 ${U.fmt$(waste.total)}</span></h3>
      ${Chart.bar({
        width: 700, height: 200, showVal: true, color: "#b26a00",
        data: U.sortBy(Object.entries(waste.byReason), e => e[1], true).map(([k, v]) => ({ x: k, y: Math.round(v / 100) })),
        yFmt: v => "NT$" + U.fmtNum(v, 0)
      })}
    </div>`;
  }
};
App.register("dash", "儀表板 — 食材成本控制", PageDash.render);

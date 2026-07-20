/* ===== page_reports.js — 食材成本率 / 損耗報表 / 成本結構 ===== */
"use strict";

const PageReports = {
  month: null,
  wFrom: null, wTo: null,

  /* ---------------- 食材成本率(北極星) ---------------- */
  renderCost(c) {
    const ym = PageReports.month || U.thisMonth();
    PageReports.month = ym;
    const days = U.monthDays(ym).filter(d => d <= U.today());
    const target = DB.setting("targetCostRate");
    const series = days.length ? Domain.costRateSeries(days[0], days[days.length - 1]) : [];
    const withRev = series.filter(d => d.revenue > 0);

    const totRev = U.sum(withRev, d => d.revenue);
    const totCost = U.sum(withRev, d => d.cost);
    const totTheo = U.sum(withRev, d => d.theo);
    const mRate = totRev ? totCost / totRev : null;

    // 月份選單(近 6 個月)
    const months = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      months.push(U.fmtDate(d).slice(0, 7));
    }

    c.innerHTML = `
    <div class="toolbar">
      <label class="fl" style="margin:0">月份:</label>
      <select onchange="PageReports.month=this.value;App.refresh()">${months.map(m => `<option ${m === ym ? "selected" : ""}>${m}</option>`).join("")}</select>
    </div>
    <div class="kpi-row">
      <div class="kpi ${mRate == null ? "" : mRate <= target ? "good" : mRate <= target + 0.05 ? "warn" : "bad"}">
        <div class="k-label">${ym} 食材成本率 ★</div><div class="k-value">${mRate == null ? "—" : U.pct(mRate)}</div>
        <div class="k-note">目標 ≤ ${U.pct(target, 0)}</div></div>
      <div class="kpi"><div class="k-label">月營收</div><div class="k-value">${U.fmt$(totRev)}</div></div>
      <div class="kpi"><div class="k-label">食材成本(實際)</div><div class="k-value">${U.fmt$(totCost)}</div>
        <div class="k-note">理論 ${U.fmt$(totTheo)}</div></div>
      <div class="kpi ${totCost - totTheo > 0 ? "bad" : "good"}"><div class="k-label">理論 vs 實際差異</div>
        <div class="k-value">${U.fmt$(totCost - totTheo)}</div>
        <div class="k-note">${totTheo ? U.pct((totCost - totTheo) / totTheo) : "—"} 超用</div></div>
      <div class="kpi"><div class="k-label">粗估毛利(僅扣食材)</div><div class="k-value">${U.fmt$(totRev - totCost)}</div>
        <div class="k-note">毛利率 ${totRev ? U.pct((totRev - totCost) / totRev) : "—"}</div></div>
    </div>
    <div class="card">
      <h3>📉 每日食材成本率(${ym})</h3>
      ${Chart.line({
        width: 900, height: 250,
        series: [
          { name: "實際成本率", color: "#c62f2f", data: withRev.map(d => ({ x: U.mdLabel(d.date), y: d.rate == null ? null : +(d.rate * 100).toFixed(1) })) },
          { name: "理論成本率", color: "#1f5fa8", data: withRev.map(d => ({ x: U.mdLabel(d.date), y: d.revenue ? +(d.theo / d.revenue * 100).toFixed(1) : null })) }
        ],
        refLines: [{ y: target * 100, label: "目標 " + U.pct(target, 0), color: "#b26a00" }],
        yFmt: v => v.toFixed(0) + "%"
      })}
    </div>
    <div class="card">
      <h3>💰 每日損益速報</h3>
      ${UI.table(["日期", "星期", "#營收", "#來客", "#食材成本(實際)", "#成本率", "#粗估毛利"],
        U.sortBy(withRev, d => d.date, true).map(d => `<tr>
          <td>${d.date}</td>
          <td>${U.isWeekend(d.date) ? `<span class="badge b-red">週${U.weekdayName(d.date)}</span>` : "週" + U.weekdayName(d.date)}</td>
          <td class="num">${U.fmt$(d.revenue)}</td>
          <td class="num">${d.covers}</td>
          <td class="num">${U.fmt$(d.cost)}</td>
          <td class="num">${UI.rateBadge(d.rate, target)}</td>
          <td class="num"><b>${U.fmt$(d.revenue - d.cost)}</b></td>
        </tr>`), "本月尚無營收資料")}
    </div>`;
  },

  /* ---------------- 損耗報表 ---------------- */
  renderWaste(c) {
    const from = PageReports.wFrom || U.addDays(U.today(), -30);
    const to = PageReports.wTo || U.today();
    PageReports.wFrom = from; PageReports.wTo = to;
    const stats = Domain.wasteStats(from, to);
    const rev = Domain.revenue(from, to);
    const fc = Domain.foodCost(from, to);

    const topIngs = U.sortBy(Object.entries(stats.byIng), e => e[1], true).slice(0, 10);
    // 每週趨勢
    const weekMap = {};
    for (const w of stats.logs) {
      const wk = U.addDays(w.date, -U.weekday(w.date)); // 週日起算
      weekMap[wk] = (weekMap[wk] || 0) + (w.costCents || 0);
    }

    c.innerHTML = `
    <div class="toolbar">
      <label class="fl" style="margin:0">期間:</label>
      <input type="date" value="${from}" onchange="PageReports.wFrom=this.value;App.refresh()">~
      <input type="date" value="${to}" onchange="PageReports.wTo=this.value;App.refresh()">
    </div>
    <div class="kpi-row">
      <div class="kpi bad"><div class="k-label">期間損耗金額</div><div class="k-value">${U.fmt$(stats.total)}</div></div>
      <div class="kpi"><div class="k-label">損耗占營收</div><div class="k-value">${rev.revenue ? U.pct(stats.total / rev.revenue) : "—"}</div></div>
      <div class="kpi"><div class="k-label">損耗占食材成本</div><div class="k-value">${fc.actual ? U.pct(stats.total / fc.actual) : "—"}</div></div>
      <div class="kpi"><div class="k-label">登記筆數</div><div class="k-value">${stats.logs.length}</div></div>
    </div>
    <div class="grid2" style="margin-bottom:16px">
      <div class="card"><h3>依原因</h3>
        ${Chart.bar({
          width: 460, height: 210, showVal: true, color: "#c62f2f",
          data: U.sortBy(Object.entries(stats.byReason), e => e[1], true).map(([k, v]) => ({ x: k, y: Math.round(v / 100) })),
          yFmt: v => "NT$" + U.fmtNum(v, 0)
        })}
      </div>
      <div class="card"><h3>每週趨勢</h3>
        ${Chart.bar({
          width: 460, height: 210, color: "#b26a00",
          data: U.sortBy(Object.entries(weekMap), e => e[0]).map(([k, v]) => ({ x: U.mdLabel(k), y: Math.round(v / 100) })),
          yFmt: v => "NT$" + U.fmtNum(v, 0)
        })}
      </div>
    </div>
    <div class="card"><h3>損耗 TOP 10 品項(成本外流點)</h3>
      ${UI.table(["排名", "品項", "#損耗金額", "#占總損耗"],
        topIngs.map(([ingId, v], i) => `<tr>
          <td class="center">${i + 1}</td>
          <td><b>${U.esc(UI.ingName(ingId))}</b></td>
          <td class="num t-red">${U.fmt$(v)}</td>
          <td class="num">${U.pct(v / stats.total)}</td>
        </tr>`), "期間內無損耗記錄")}
    </div>`;
  },

  /* ---------------- 成本結構(Prime Cost) ---------------- */
  renderStruct(c) {
    const ym = PageReports.month || U.thisMonth();
    const days = U.monthDays(ym).filter(d => d <= U.today());
    const rev = days.length ? Domain.revenue(days[0], days[days.length - 1]) : { revenue: 0 };
    const fc = days.length ? Domain.foodCost(days[0], days[days.length - 1]) : { actual: 0 };
    const p = Domain.monthlyPnl(ym);
    const labor = p.labor;
    const rent = p.expByCat["租金"] || 0;
    const util = (p.expByCat["水電"] || 0) + (p.expByCat["瓦斯"] || 0);
    const other = p.expensesTotal - rent - util + p.feeTotal + p.tax;
    const totalCost = fc.actual + labor + rent + util + other;
    const prime = fc.actual + labor;

    const rows = [
      ["食材成本(消耗)", fc.actual, "#c62f2f"], ["人事成本" + (p.laborEst ? "(估)" : ""), labor, "#1f5fa8"],
      ["租金" + (p.expEst ? "(估)" : ""), rent, "#6b4fa0"], ["水電瓦斯" + (p.expEst ? "(估)" : ""), util, "#0e7a8a"],
      ["雜項+手續費+稅金", other, "#b26a00"]
    ];

    c.innerHTML = `
    <div class="alert info">💡 人事來自「人力成本」登記、費用來自「支出登記」(無登記月份用設定頁估計值,標「估」)。食材用「消耗」計算(領用+損耗+盤差);要看現金基礎的完整損益 → 「月財報(獲利)」頁。Prime Cost = 食材 + 人事,餐飲業健康值一般 ≤ 60~65%。</div>
    <div class="kpi-row">
      <div class="kpi"><div class="k-label">${ym} 營收</div><div class="k-value">${U.fmt$(rev.revenue)}</div></div>
      <div class="kpi ${rev.revenue && prime / rev.revenue <= 0.65 ? "good" : "bad"}"><div class="k-label">Prime Cost 占比 ★</div>
        <div class="k-value">${rev.revenue ? U.pct(prime / rev.revenue) : "—"}</div>
        <div class="k-note">食材+人事 ${U.fmt$(prime)}</div></div>
      <div class="kpi"><div class="k-label">總成本</div><div class="k-value">${U.fmt$(totalCost)}</div></div>
      <div class="kpi ${rev.revenue - totalCost >= 0 ? "good" : "bad"}"><div class="k-label">估計營業利益</div>
        <div class="k-value">${U.fmt$(rev.revenue - totalCost)}</div>
        <div class="k-note">利益率 ${rev.revenue ? U.pct((rev.revenue - totalCost) / rev.revenue) : "—"}</div></div>
    </div>
    <div class="card">
      <h3>🏛️ 成本結構(占營收比)</h3>
      ${Chart.bar({
        width: 760, height: 240, showVal: true,
        data: rows.map(([name, v, color]) => ({ x: name, y: rev.revenue ? +((v / rev.revenue) * 100).toFixed(1) : 0, color })),
        yFmt: v => v.toFixed(0) + "%"
      })}
      ${UI.table(["成本項目", "#金額", "#占營收"],
        rows.map(([name, v]) => `<tr><td>${name}</td><td class="num">${U.fmt$(v)}</td>
        <td class="num">${rev.revenue ? U.pct(v / rev.revenue) : "—"}</td></tr>`).concat([
          `<tr style="background:#f4f6f9"><td><b>合計</b></td><td class="num"><b>${U.fmt$(totalCost)}</b></td>
          <td class="num"><b>${rev.revenue ? U.pct(totalCost / rev.revenue) : "—"}</b></td></tr>`
        ]))}
      <p class="hint">要調整人事/租金等固定成本,請到「設定/備份」頁。</p>
    </div>`;
  }
};

App.register("rp_cost", "報表 — 食材成本率(北極星)★", PageReports.renderCost);
App.register("rp_waste", "報表 — 損耗率分析", PageReports.renderWaste);
App.register("rp_struct", "報表 — 成本結構 / Prime Cost", PageReports.renderStruct);

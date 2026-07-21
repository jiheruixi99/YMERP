/* ===== app.js — 路由 / 導覽 / 角色 ===== */
"use strict";

const App = {
  route: "dash",
  role: localStorage.getItem("hotpot_erp_role") || "老闆",

  ROLES: {
    "老闆": null, // null = 全部
    "店長": ["dash", "m_sup", "m_ing", "m_supply", "m_rcp", "m_plan", "p_po", "p_quote", "p_trend", "p_sugg", "s_stock", "s_count", "s_waste", "pr_mo", "pr_var", "pr_orders", "sd_sales", "sd_fc", "sd_resv", "fi_labor", "fi_expense", "fi_supplier", "rp_cost", "rp_waste", "rp_struct"],
    "廚房/後場": ["dash", "m_rcp", "pr_mo", "pr_var", "s_stock", "s_count", "s_waste"],
    "外場/櫃檯": ["dash", "sd_resv", "sd_sales", "sd_fc"]
  },

  NAV: [
    { group: "總覽", items: [["dash", "📊", "儀表板"]] },
    {
      group: "主檔", items: [
        ["m_ing", "🥬", "食材品項"], ["m_supply", "🧴", "雜項用品"], ["m_sup", "🚚", "供應商"],
        ["m_rcp", "📖", "配方(BOM)"], ["m_plan", "🎫", "菜單價格"]]
    },
    {
      group: "供應鏈 MM", items: [
        ["p_quote", "💲", "報價/品項建檔"], ["p_po", "🧾", "進貨登記"], ["p_trend", "📈", "價格趨勢"], ["p_sugg", "💡", "採購建議"]]
    },
    {
      group: "庫存", items: [
        ["s_stock", "📦", "即時庫存"], ["s_count", "📋", "盤點"], ["s_waste", "🗑️", "損耗登記"]]
    },
    {
      group: "生產 PP", items: [
        ["pr_mo", "🍜", "備料工單"], ["pr_orders", "🧮", "點餐明細(精準理論)"], ["pr_var", "⚖️", "理論vs實際"]]
    },
    {
      group: "銷售 SD", items: [
        ["sd_sales", "💰", "每日營收"], ["sd_fc", "🔮", "來客預測"], ["sd_resv", "📅", "訂位管理"]]
    },
    {
      group: "財報 FI", items: [
        ["fi_profit", "💹", "月財報(獲利)"], ["fi_labor", "🧑‍🍳", "人力成本"], ["fi_expense", "🧾", "支出登記"],
        ["fi_supplier", "🏢", "廠商進貨分析"],
        ["rp_cost", "🎯", "食材成本率"], ["rp_waste", "📉", "損耗報表"], ["rp_struct", "🏛️", "成本結構"]]
    },
    { group: "系統", items: [["sys_set", "⚙️", "設定/備份"]] }
  ],

  PAGES: {}, // route → {title, render}

  register(route, title, renderFn) { App.PAGES[route] = { title, render: renderFn }; },

  allowed(route) {
    const list = App.ROLES[App.role];
    return !list || list.includes(route);
  },

  renderNav() {
    const box = document.getElementById("navBox");
    let html = "";
    for (const g of App.NAV) {
      const items = g.items.filter(it => App.allowed(it[0]));
      if (!items.length) continue;
      html += `<div class="nav-group"><div class="g-title">${U.esc(g.group)}</div>`;
      for (const [route, ic, label] of items) {
        html += `<div class="nav-item ${route === App.route ? "active" : ""}" onclick="App.go('${route}')">
          <span class="ic">${ic}</span><span class="tx">${U.esc(label)}</span></div>`;
      }
      html += `</div>`;
    }
    box.innerHTML = html;
    const sel = document.getElementById("roleSel");
    sel.innerHTML = Object.keys(App.ROLES).map(r => `<option ${r === App.role ? "selected" : ""}>${r}</option>`).join("");
  },

  setRole(role) {
    App.role = role;
    localStorage.setItem("hotpot_erp_role", role);
    if (!App.allowed(App.route)) App.route = "dash";
    App.renderNav();
    App.render();
    UI.toast("已切換角色:" + role);
  },

  go(route) {
    if (!App.PAGES[route]) return;
    if (!App.allowed(route)) { UI.toast("此角色無權限", true); return; }
    App.route = route;
    App.renderNav();
    App.render();
    document.getElementById("content").scrollIntoView();
  },

  render() {
    const p = App.PAGES[App.route];
    document.getElementById("pageTitle").textContent = p ? p.title : "";
    const c = document.getElementById("content");
    try { c.innerHTML = ""; p.render(c); }
    catch (e) {
      console.error(e);
      c.innerHTML = `<div class="alert warn">頁面載入錯誤:${U.esc(e.message)}</div>`;
    }
  },

  refresh() { App.render(); },

  init() {
    DB.load();
    const t = U.today();
    document.getElementById("todayLabel").textContent = `${t}(週${U.weekdayName(t)})`;
    App.renderNav();
    App.render();
    if (typeof Sync !== "undefined") Sync.init();
  }
};

document.addEventListener("DOMContentLoaded", App.init);
document.getElementById && document.addEventListener("keydown", e => {
  if (e.key === "Escape") UI.closeModal();
});

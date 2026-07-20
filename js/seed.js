/* ===== seed.js — 火鍋店情境種子資料(供 demo 成本閉環) ===== */
"use strict";

const Seed = {
  rand(a, b) { return a + Math.random() * (b - a); },
  pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },

  run() {
    DB._suspend = true;
    try {
      Seed.suppliers();
      Seed.ingredients();
      Seed.supplierPrices();
      Seed.priceHistory();
      Seed.recipes();
      Seed.pricePlans();
      Seed.salesAndUsage();   // 營收 + 領用(理論用量) + 損耗
      Seed.purchases();       // 進貨支出(供財報)
      Seed.labor();           // PT 人力登記
      Seed.expenses();        // 水電/租金/稅金等支出
      Seed.stockCounts();
      Seed.currentStock();
      Seed.reservations();
      Seed.openPOs();
      Seed.forecasts();
    } finally {
      DB._suspend = false;
      DB.save();
    }
  },

  /* ---------- 供應商 ---------- */
  suppliers() {
    const rows = [
      ["sup_veg", "永豐蔬果行", "陳永豐", "03-4225566", "月結30天", 4.5],
      ["sup_mush", "鮮菇園農產", "林秀菊", "03-4881122", "月結30天", 4.8],
      ["sup_frozen", "大昌食品(火鍋料/豆製品)", "張大昌", "03-4667788", "月結60天", 4.2],
      ["sup_dry", "裕成南北貨", "王裕成", "03-4223344", "貨到付款", 4.6],
      ["sup_oil", "佳味油品調味", "李佳味", "03-4556677", "月結30天", 4.4],
      ["sup_meat", "喬麥肉品", "趙喬麥", "03-4771234", "月結30天", 4.7],
      ["sup_pack", "統潔餐具耗材", "劉統潔", "03-4990011", "月結30天", 4.0]
    ];
    for (const [id, name, contact, phone, payTerms, rating] of rows)
      DB.insert("suppliers", { id, name, contact, phone, payTerms, rating, note: "" });
  },

  /* ---------- 食材主檔 ----------
     欄位:id,名稱,分類,保存,採購單位,庫存單位,使用單位,採購→庫存,庫存→使用,效期天,季節性,安全庫存,基準價(元/庫存單位),預設供應商 */
  ING_DEFS: [
    ["i_beefbacon", "牛培根", "肉品", "冷凍", "公斤", "公斤", "克", 1, 1000, 30, false, 8, 400, "sup_meat"],
    ["i_porkslice", "梅花豬肉片", "肉品", "冷凍", "公斤", "公斤", "克", 1, 1000, 30, false, 8, 380, "sup_meat"],
    ["i_chickenslice", "去骨雞腿肉", "肉品", "冷藏", "公斤", "公斤", "克", 1, 1000, 5, false, 6, 220, "sup_meat"],
    ["i_cabbage", "高麗菜", "生鮮蔬菜", "冷藏", "箱", "公斤", "公克", 10, 1000, 7, true, 20, 35, "sup_veg"],
    ["i_napa", "大白菜", "生鮮蔬菜", "冷藏", "箱", "公斤", "公克", 10, 1000, 7, true, 15, 30, "sup_veg"],
    ["i_bokchoy", "青江菜", "生鮮蔬菜", "冷藏", "箱", "公斤", "公克", 5, 1000, 4, true, 6, 60, "sup_veg"],
    ["i_radish", "白蘿蔔", "生鮮蔬菜", "冷藏", "袋", "公斤", "公克", 10, 1000, 14, true, 10, 25, "sup_veg"],
    ["i_corn", "玉米", "生鮮蔬菜", "冷藏", "箱", "公斤", "公克", 10, 1000, 7, true, 10, 45, "sup_veg"],
    ["i_pumpkin", "南瓜", "生鮮蔬菜", "常溫", "箱", "公斤", "公克", 10, 1000, 21, true, 8, 40, "sup_veg"],
    ["i_sweetpotato", "地瓜", "生鮮蔬菜", "常溫", "箱", "公斤", "公克", 10, 1000, 21, false, 8, 35, "sup_veg"],
    ["i_taro", "芋頭", "生鮮蔬菜", "冷藏", "箱", "公斤", "公克", 10, 1000, 14, true, 6, 90, "sup_veg"],
    ["i_lemon", "檸檬", "生鮮蔬菜", "冷藏", "箱", "公斤", "公克", 5, 1000, 14, true, 3, 80, "sup_veg"],
    ["i_enoki", "金針菇", "菇菌", "冷藏", "箱", "公斤", "公克", 5, 1000, 7, false, 8, 80, "sup_mush"],
    ["i_shiitake", "香菇", "菇菌", "冷藏", "箱", "公斤", "公克", 3, 1000, 7, true, 5, 160, "sup_mush"],
    ["i_kingoyster", "杏鮑菇", "菇菌", "冷藏", "箱", "公斤", "公克", 5, 1000, 7, false, 8, 90, "sup_mush"],
    ["i_woodear", "黑木耳", "菇菌", "冷藏", "袋", "公斤", "公克", 3, 1000, 7, false, 3, 70, "sup_mush"],
    ["i_dryshiitake", "乾香菇", "菇菌", "常溫", "包", "公斤", "公克", 1, 1000, 180, false, 2, 600, "sup_dry"],
    ["i_tofu", "板豆腐", "豆製品", "冷藏", "箱", "公斤", "公克", 6, 1000, 4, false, 10, 40, "sup_frozen"],
    ["i_driedtofu", "豆干", "豆製品", "冷藏", "袋", "公斤", "公克", 3, 1000, 7, false, 5, 90, "sup_frozen"],
    ["i_tofuskin", "豆皮", "豆製品", "冷凍", "袋", "公斤", "公克", 3, 1000, 30, false, 4, 120, "sup_frozen"],
    ["i_hotpotballs", "火鍋餃類(素)", "火鍋料", "冷凍", "箱", "公斤", "公克", 6, 1000, 90, false, 12, 180, "sup_frozen"],
    ["i_glassnoodle", "冬粉", "火鍋料", "常溫", "箱", "包", "包", 40, 1, 180, false, 30, 15, "sup_dry"],
    ["i_noodle", "王子麵", "火鍋料", "常溫", "箱", "包", "包", 30, 1, 120, false, 30, 12, "sup_dry"],
    ["i_seaweedknot", "海帶結", "火鍋料", "冷藏", "袋", "公斤", "公克", 3, 1000, 10, false, 5, 60, "sup_frozen"],
    ["i_kombu", "昆布", "湯底料", "常溫", "包", "公斤", "公克", 1, 1000, 365, false, 3, 450, "sup_dry"],
    ["i_chilidry", "乾辣椒", "湯底料", "常溫", "包", "公斤", "公克", 1, 1000, 180, false, 1, 300, "sup_dry"],
    ["i_pepper", "花椒", "湯底料", "常溫", "包", "公斤", "公克", 1, 1000, 180, false, 1, 400, "sup_dry"],
    ["i_spicemix", "滷/湯辛香料", "湯底料", "常溫", "包", "公斤", "公克", 1, 1000, 180, false, 2, 250, "sup_dry"],
    ["i_beanpaste", "豆瓣醬", "湯底料", "常溫", "桶", "公斤", "公克", 5, 1000, 365, false, 5, 130, "sup_oil"],
    ["i_kimchi", "泡菜", "湯底料", "冷藏", "桶", "公斤", "公克", 5, 1000, 30, false, 8, 120, "sup_frozen"],
    ["i_gochujang", "韓式辣醬", "湯底料", "常溫", "桶", "公斤", "公克", 3, 1000, 365, false, 2, 160, "sup_oil"],
    ["i_sesamepaste", "芝麻醬", "醬料原料", "常溫", "桶", "公斤", "公克", 3, 1000, 180, false, 3, 220, "sup_oil"],
    ["i_soysauce", "醬油", "醬料原料", "常溫", "箱", "公升", "毫升", 12, 1000, 365, false, 12, 80, "sup_oil"],
    ["i_oil", "沙拉油", "醬料原料", "常溫", "桶", "公升", "毫升", 18, 1000, 365, false, 18, 55, "sup_oil"],
    ["i_satay", "素沙茶醬", "醬料原料", "常溫", "桶", "公斤", "公克", 3, 1000, 365, false, 3, 240, "sup_oil"],
    ["i_salt", "鹽", "醬料原料", "常溫", "包", "公斤", "公克", 24, 1000, 730, false, 10, 20, "sup_dry"],
    ["i_sugar", "糖", "醬料原料", "常溫", "包", "公斤", "公克", 20, 1000, 730, false, 15, 32, "sup_dry"],
    ["i_flour", "麵粉", "醬料原料", "常溫", "袋", "公斤", "公克", 22, 1000, 180, false, 10, 28, "sup_dry"],
    ["i_redbean", "紅豆", "飲料甜品", "常溫", "袋", "公斤", "公克", 10, 1000, 365, false, 5, 120, "sup_dry"],
    ["i_boba", "粉圓", "飲料甜品", "常溫", "袋", "公斤", "公克", 5, 1000, 180, false, 3, 65, "sup_dry"],
    ["i_wintermelon", "冬瓜茶磚", "飲料甜品", "常溫", "箱", "公斤", "公克", 10, 1000, 365, false, 5, 95, "sup_dry"],
    ["i_napkin", "餐巾紙", "包材耗材", "常溫", "箱", "包", "包", 60, 1, 9999, false, 40, 20, "sup_pack"],
    ["i_chopstick", "衛生筷", "包材耗材", "常溫", "箱", "包", "包", 50, 1, 9999, false, 30, 45, "sup_pack"]
  ],

  ingredients() {
    for (const d of Seed.ING_DEFS) {
      DB.insert("ingredients", {
        id: d[0], name: d[1], category: d[2], storage: d[3],
        purchaseUnit: d[4], stockUnit: d[5], useUnit: d[6],
        purToStock: d[7], stockToUse: d[8], shelfLifeDays: d[9],
        seasonal: d[10], safetyStock: d[11], reorderPoint: Math.round(d[11] * 1.3),
        basePrice: Math.round(d[12] * 100), defaultSupplierId: d[13], active: true
      });
    }
  },

  /* ---------- 供應商報價(含第二供應商比價) ---------- */
  supplierPrices() {
    const alt = { // 部分品項第二供應商(價差 ±8%)
      i_cabbage: "sup_mush", i_napa: "sup_mush", i_enoki: "sup_veg", i_kingoyster: "sup_veg",
      i_tofu: "sup_veg", i_kimchi: "sup_oil", i_soysauce: "sup_dry", i_oil: "sup_dry",
      i_hotpotballs: "sup_dry", i_sesamepaste: "sup_dry"
    };
    const eff = U.addDays(U.today(), -20);
    for (const ing of DB.get("ingredients")) {
      DB.insert("supplierPrices", {
        supplierId: ing.defaultSupplierId, ingredientId: ing.id,
        unitPrice: ing.basePrice, effectiveDate: eff
      });
      if (alt[ing.id]) {
        DB.insert("supplierPrices", {
          supplierId: alt[ing.id], ingredientId: ing.id,
          unitPrice: Math.round(ing.basePrice * Seed.rand(0.92, 1.10)), effectiveDate: eff
        });
      }
    }
  },

  /* ---------- 進貨價格歷史(120天,週期進貨,季節波動) ---------- */
  priceFactor(ing, dayOffset) { // dayOffset: 距今天數(負=過去)
    let f = 1;
    if (ing.seasonal) {
      // 夏季(7月)葉菜漲:以年週期正弦模擬,現在接近高點
      f *= 1 + 0.30 * Math.sin((dayOffset + 90) / 365 * 2 * Math.PI + 1.2);
    }
    return f;
  },

  priceHistory() {
    const today = U.today();
    for (const ing of DB.get("ingredients")) {
      const buyEvery = ing.category === "生鮮蔬菜" || ing.category === "菇菌" || ing.category === "豆製品" ? 3 : 10;
      for (let d = -120; d <= -1; d += buyEvery) {
        const date = U.addDays(today, d + Math.floor(Seed.rand(0, 2)));
        if (date >= today) continue;
        const price = Math.round(ing.basePrice * Seed.priceFactor(ing, d) * Seed.rand(0.96, 1.05));
        DB.insert("priceHistory", { ingredientId: ing.id, supplierId: ing.defaultSupplierId, unitPrice: price, date });
      }
      // 去年同期(供 YoY 比較,季節性品項)
      if (ing.seasonal) {
        for (let d = -380; d <= -350; d += 7) {
          const price = Math.round(ing.basePrice * Seed.priceFactor(ing, d + 365) * Seed.rand(0.96, 1.05));
          DB.insert("priceHistory", { ingredientId: ing.id, supplierId: ing.defaultSupplierId, unitPrice: price, date: U.addDays(today, d) });
        }
      }
    }
    // 製造一個明顯異常:高麗菜近期大漲 45%(颱風情境)
    const cab = DB.byId("ingredients", "i_cabbage");
    DB.insert("priceHistory", { ingredientId: "i_cabbage", supplierId: cab.defaultSupplierId, unitPrice: Math.round(cab.basePrice * 1.45), date: U.addDays(today, -2) });
    DB.insert("priceHistory", { ingredientId: "i_cabbage", supplierId: cab.defaultSupplierId, unitPrice: Math.round(cab.basePrice * 1.52), date: U.addDays(today, -1) });
  },

  /* ---------- 配方 BOM(多層) ---------- */
  recipes() {
    const R = (id, name, category, yieldQty, yieldUnit, perCover, lines, note) =>
      DB.insert("recipes", { id, name, category, yieldQty, yieldUnit, perCover: perCover || 0, lines, note: note || "" });
    const ing = (refId, qty) => ({ kind: "ing", refId, qty });
    const rcp = (refId, qty) => ({ kind: "rcp", refId, qty });

    // 肉品(以克計,每份成本)— 示範 #5
    R("r_beef200", "牛培根盤(200克)", "肉品", 1, "份", 0, [ing("i_beefbacon", 200)], "標準份;來貨大小不同重量會浮動,以進貨實際單價計");
    R("r_beef300", "牛培根盤(300克・大份)", "肉品", 1, "份", 0, [ing("i_beefbacon", 300)]);
    R("r_pork200", "梅花豬肉片(200克)", "肉品", 1, "份", 0, [ing("i_porkslice", 200)]);
    R("r_chicken200", "去骨雞腿肉(200克)", "肉品", 1, "份", 0, [ing("i_chickenslice", 200)]);
    // 菜品(斤/公斤,備註)— 示範 #6
    R("r_veg_cabbage", "炒高麗菜", "菜品", 1, "份", 0, [ing("i_cabbage", 300)], "一份約半斤(300克);斤=600克、公斤=1000克");

    R("r_stock", "昆布蔬菜高湯", "半成品", 20, "公升", 0, [
      ing("i_kombu", 300), ing("i_dryshiitake", 150), ing("i_radish", 2000),
      ing("i_cabbage", 1000), ing("i_corn", 1000)
    ], "基底高湯,20公升/批");
    R("r_soup_mala", "麻辣湯底", "湯底", 10, "鍋", 0.25, [
      rcp("r_stock", 8), ing("i_chilidry", 200), ing("i_pepper", 100),
      ing("i_beanpaste", 500), ing("i_spicemix", 200), ing("i_oil", 500)
    ]);
    R("r_soup_kombu", "昆布清湯底", "湯底", 10, "鍋", 0.35, [
      rcp("r_stock", 10), ing("i_kombu", 100), ing("i_salt", 50)
    ]);
    R("r_soup_kimchi", "泡菜湯底", "湯底", 10, "鍋", 0.20, [
      rcp("r_stock", 8), ing("i_kimchi", 2000), ing("i_gochujang", 300)
    ]);
    R("r_sauce_sesame", "麻醬", "醬料", 40, "份", 1.00, [
      ing("i_sesamepaste", 1000), ing("i_soysauce", 300), ing("i_sugar", 100)
    ]);
    R("r_sauce_satay", "素沙茶醬", "醬料", 40, "份", 0.80, [
      ing("i_satay", 1200), ing("i_soysauce", 200)
    ]);
    R("r_braised", "滷味拼盤", "自助吧", 50, "份", 1.20, [
      ing("i_driedtofu", 2000), ing("i_seaweedknot", 1500), ing("i_spicemix", 100),
      ing("i_soysauce", 500), ing("i_sugar", 150)
    ]);
    R("r_fried", "炸物(杏鮑菇/地瓜)", "自助吧", 40, "份", 1.00, [
      ing("i_kingoyster", 2000), ing("i_sweetpotato", 2000), ing("i_flour", 1000), ing("i_oil", 1000)
    ]);
    R("r_dessert", "紅豆甜湯", "自助吧", 60, "份", 1.40, [
      ing("i_redbean", 1500), ing("i_sugar", 800), ing("i_boba", 500)
    ]);
    R("r_drink", "冬瓜檸檬飲", "自助吧", 50, "杯", 2.40, [
      ing("i_wintermelon", 1000), ing("i_lemon", 300)
    ]);
    R("r_buffet", "自助吧生鮮補料", "自助吧", 10, "人份", 1.00, [
      ing("i_cabbage", 3300), ing("i_napa", 2200), ing("i_bokchoy", 1300),
      ing("i_enoki", 1100), ing("i_shiitake", 900), ing("i_kingoyster", 900),
      ing("i_woodear", 450), ing("i_tofu", 1800), ing("i_tofuskin", 650),
      ing("i_hotpotballs", 1300), ing("i_glassnoodle", 11), ing("i_noodle", 18),
      ing("i_taro", 1100), ing("i_corn", 1800), ing("i_pumpkin", 1100)
    ], "每 10 位來客的生鮮補料標準量(吃到飽人均約 1.6~1.9kg)");
  },

  pricePlans() {
    const rows = [
      ["平日成人", "平日", "成人", 46900], ["平日兒童(110cm以下)", "平日", "兒童", 21900],
      ["假日成人", "假日", "成人", 52900], ["假日兒童(110cm以下)", "假日", "兒童", 25900],
      ["敬老(65歲以上)", "全時段", "敬老", 39900]
    ];
    for (const [name, dayType, tier, price] of rows)
      DB.insert("pricePlans", { name, dayType, tier, price, active: true });
  },

  /* ---------- 90天營收 + 理論領用 + 損耗 ---------- */
  salesAndUsage() {
    const today = U.today();
    // 每人每餐標準用量(使用單位)= Σ perCover 配方展開
    const usagePerCover = {};
    for (const r of DB.get("recipes").filter(r => r.perCover > 0)) {
      const ex = Domain.explodeRecipe(r.id, r.perCover / r.yieldQty);
      for (const [ingId, q] of Object.entries(ex)) usagePerCover[ingId] = (usagePerCover[ingId] || 0) + q;
    }
    const wasteReasons = ["耗損", "耗損", "耗損", "過期", "過期", "員工餐", "員工餐", "試吃", "備料失敗"];
    const perishables = DB.get("ingredients").filter(i => ["生鮮蔬菜", "菇菌", "豆製品"].includes(i.category));

    for (let d = -90; d <= -1; d++) {
      const date = U.addDays(today, d);
      const wd = U.weekday(date);
      let base = [95, 58, 55, 60, 63, 82, 128][wd]; // 日一二三四五六
      const covers = Math.max(20, Math.round(base * Seed.rand(0.88, 1.12)));
      const spend = Math.round(43000 * Seed.rand(0.95, 1.06)); // 客單約 NT$430
      const revenue = covers * spend;
      const cash = Math.round(revenue * Seed.rand(0.25, 0.33));
      const line = Math.round(revenue * Seed.rand(0.14, 0.20));
      const jko = Math.round(revenue * Seed.rand(0.08, 0.14));
      DB.insert("salesDaily", {
        date, revenue, covers, avgSpend: spend,
        payCash: cash, payCard: revenue - cash - line - jko, payLine: line, payJko: jko,
        addons: Math.round(revenue * Seed.rand(0.02, 0.05)), source: "seed"
      });

      // 理論領用:每品項一筆(工單彙總)
      for (const [ingId, perC] of Object.entries(usagePerCover)) {
        const ingd = DB.byId("ingredients", ingId);
        if (!ingd) continue;
        const useQty = covers * perC * Seed.rand(0.95, 1.05);
        const stockQty = Math.round(useQty / (ingd.stockToUse || 1) * 1000) / 1000;
        if (stockQty <= 0) continue;
        const price = Domain.priceAt(ingId, date);
        DB.insert("stockMovements", {
          date, type: "領用", ingredientId: ingId,
          qty: -stockQty, costCents: -Math.round(stockQty * price),
          refType: "工單", refId: "", note: "每日備料"
        });
      }

      // 損耗 1~2 筆/日
      const n = Math.random() < 0.7 ? 1 : 2;
      for (let k = 0; k < n; k++) {
        const ingd = Seed.pick(perishables);
        const qty = Math.round(Seed.rand(0.3, 2.5) * 10) / 10;
        const price = Domain.priceAt(ingd.id, date);
        const cost = Math.round(qty * price);
        const reason = Seed.pick(wasteReasons);
        const w = DB.insert("wasteLogs", { date, ingredientId: ingd.id, qty, reason, area: "廚房", note: "", costCents: cost });
        DB.insert("stockMovements", {
          date, type: "損耗", ingredientId: ingd.id,
          qty: -qty, costCents: -cost, refType: "損耗單", refId: w.id, note: reason
        });
      }
    }

    // 近 3 天備料工單文件(展示用,狀態完成)
    for (let d = -3; d <= -1; d++) {
      const date = U.addDays(today, d);
      const sales = DB.get("salesDaily").find(s => s.date === date);
      let seq = 1;
      for (const r of DB.get("recipes").filter(r => r.perCover > 0)) {
        const need = sales.covers * r.perCover;
        const plannedQty = Math.round(Math.max(r.yieldQty, Math.ceil(need / r.yieldQty) * r.yieldQty) * 10) / 10;
        DB.insert("productionOrders", {
          no: "MO" + date.replace(/-/g, "") + "-" + seq++,
          date, recipeId: r.id, plannedQty, status: "完成", issued: true,
          costCents: Math.round(Domain.recipeCost(r.id) * plannedQty / r.yieldQty)
        });
      }
    }
  },

  /* ---------- 進貨支出(90天,對應每日消耗量,供財報「支出=進貨單」) ---------- */
  purchases() {
    const today = U.today();
    // 每人每餐標準用量 → 每日進貨量基準
    const usagePerCover = {};
    for (const r of DB.get("recipes").filter(r => r.perCover > 0)) {
      const ex = Domain.explodeRecipe(r.id, r.perCover / r.yieldQty);
      for (const [ingId, q] of Object.entries(ex)) usagePerCover[ingId] = (usagePerCover[ingId] || 0) + q;
    }
    const avgCovers = 76;
    for (const [ingId, perC] of Object.entries(usagePerCover)) {
      const ing = DB.byId("ingredients", ingId);
      if (!ing) continue;
      const dailyStock = avgCovers * perC / (ing.stockToUse || 1);
      const every = ["生鮮蔬菜", "菇菌", "豆製品"].includes(ing.category) ? 3 : 10;
      for (let d = -90; d <= -1; d += every) {
        const date = U.addDays(today, d);
        const qty = Math.round(dailyStock * every * Seed.rand(0.95, 1.12) * 100) / 100;
        if (qty <= 0) continue;
        const price = Domain.priceAt(ingId, date);
        DB.insert("stockMovements", {
          date, type: "進貨", ingredientId: ingId,
          qty, costCents: Math.round(qty * price),
          refType: "進貨單", refId: "", note: "每日叫貨"
        });
      }
    }
    // 包材耗材(雜項進貨,每月兩次)
    for (const ingId of ["i_napkin", "i_chopstick"]) {
      const ing = DB.byId("ingredients", ingId);
      for (let d = -85; d <= -1; d += 15) {
        const date = U.addDays(today, d);
        const qty = Math.round(ing.safetyStock * Seed.rand(0.5, 0.9));
        DB.insert("stockMovements", {
          date, type: "進貨", ingredientId: ingId,
          qty, costCents: Math.round(qty * ing.basePrice),
          refType: "進貨單", refId: "", note: "耗材補貨"
        });
      }
    }
  },

  /* ---------- PT 人力登記(90天) ---------- */
  labor() {
    const today = U.today();
    const staff = [
      { name: "小美", rate: 19500 }, { name: "阿明", rate: 20000 },
      { name: "小華", rate: 19000 }, { name: "小芳", rate: 19500 }
    ];
    for (let d = -90; d <= -1; d++) {
      const date = U.addDays(today, d);
      const n = U.isWeekend(date) ? 4 : Math.random() < 0.5 ? 2 : 3;
      for (let k = 0; k < n; k++) {
        const p = staff[k % staff.length];
        const hours = Math.round(Seed.rand(4, 8) * 2) / 2;
        DB.insert("laborLogs", {
          date, name: p.name, hourlyRate: p.rate, hours,
          bonus: Math.random() < 0.06 ? 30000 : 0,   // 偶爾 NT$300 獎金
          insurance: 0, note: ""
        });
      }
    }
    // 每月勞健保代扣(示範:每人每月一筆)
    for (let m = 0; m < 3; m++) {
      const base = new Date(); base.setMonth(base.getMonth() - m); base.setDate(25);
      const date = U.fmtDate(base);
      if (date >= today) continue;
      for (const p of staff) {
        DB.insert("laborLogs", {
          date, name: p.name, hourlyRate: 0, hours: 0, bonus: 0,
          insurance: 52200, note: "勞健保代扣"   // 示範值 NT$522
        });
      }
    }
  },

  /* ---------- 營業費用支出(3個月) ---------- */
  expenses() {
    const today = U.today();
    for (let m = 0; m < 3; m++) {
      const base = new Date(); base.setMonth(base.getMonth() - m);
      const ym = U.fmtDate(base).slice(0, 7);
      const E = (day, category, amount, note) => {
        const date = ym + "-" + String(day).padStart(2, "0");
        if (date < U.addDays(today, -92) || date >= today) return;
        DB.insert("expenses", { date, category, amount, note: note || "" });
      };
      E(1, "租金", 12000000, "店面月租");
      E(5, "水電", Math.round(Seed.rand(1800000, 2300000)), "台電+自來水");
      E(10, "瓦斯", Math.round(Seed.rand(900000, 1300000)), "營業用瓦斯");
      E(8, "雜費", Math.round(Seed.rand(150000, 400000)), "清潔/五金");
      E(20, "雜費", Math.round(Seed.rand(80000, 250000)), "");
      if (m % 2 === 1) E(15, "稅金", 4500000, "營業稅(雙月)");
      if (Math.random() < 0.5) E(18, "維修", Math.round(Seed.rand(200000, 800000)), "設備維修");
    }
  },

  /* ---------- 盤點(製造理論vs實際差異) ---------- */
  stockCounts() {
    const mk = (date, ingIds) => {
      const lines = [];
      for (const ingId of ingIds) {
        const ingd = DB.byId("ingredients", ingId);
        const book = Math.round(Seed.rand(5, 25) * 10) / 10;
        const shrink = Math.round(book * Seed.rand(0.02, 0.08) * 10) / 10; // 盤虧 2~8%
        const actual = Math.round((book - shrink) * 10) / 10;
        const price = Domain.priceAt(ingId, date);
        lines.push({ ingredientId: ingId, bookQty: book, actualQty: actual, diff: actual - book });
        DB.insert("stockMovements", {
          date, type: "盤點調整", ingredientId: ingId,
          qty: actual - book, costCents: Math.round((actual - book) * price),
          refType: "盤點", refId: "", note: "定期盤點"
        });
      }
      DB.insert("stockCounts", { date, status: "已過帳", lines, note: "定期盤點" });
    };
    const keys = ["i_cabbage", "i_napa", "i_enoki", "i_shiitake", "i_tofu", "i_hotpotballs", "i_kingoyster", "i_kimchi", "i_driedtofu", "i_bokchoy"];
    mk(U.addDays(U.today(), -35), keys);
    mk(U.addDays(U.today(), -4), keys);
  },

  /* ---------- 目前庫存批號 ---------- */
  currentStock() {
    const today = U.today();
    for (const ing of DB.get("ingredients")) {
      const qty = Math.round(ing.safetyStock * Seed.rand(1.1, 2.0) * 10) / 10;
      if (qty <= 0) continue;
      const life = Math.min(ing.shelfLifeDays, 60);
      const expiry = ing.shelfLifeDays > 999 ? null : U.addDays(today, Math.max(2, Math.round(life * Seed.rand(0.35, 0.9))));
      DB.insert("stockBatches", {
        ingredientId: ing.id, qty,
        expiry, batchNo: "B" + U.addDays(today, -2).replace(/-/g, ""), receivedDate: U.addDays(today, -2)
      });
    }
    // 兩筆即期品(效期預警 demo)
    DB.insert("stockBatches", { ingredientId: "i_tofu", qty: 3, expiry: U.addDays(today, 1), batchNo: "B即期1", receivedDate: U.addDays(today, -3) });
    DB.insert("stockBatches", { ingredientId: "i_bokchoy", qty: 2, expiry: today, batchNo: "B即期2", receivedDate: U.addDays(today, -4) });
  },

  /* ---------- 訂位 ---------- */
  reservations() {
    const names = ["陳小姐", "林先生", "張太太", "王先生", "李小姐", "吳先生", "劉小姐", "黃先生"];
    const times = ["11:30", "12:00", "12:30", "17:30", "18:00", "18:30", "19:00"];
    // 未來 7 天
    for (let d = 0; d <= 7; d++) {
      const date = U.addDays(U.today(), d);
      const n = U.isWeekend(date) ? Math.floor(Seed.rand(4, 8)) : Math.floor(Seed.rand(1, 4));
      for (let k = 0; k < n; k++) {
        DB.insert("reservations", {
          date, time: Seed.pick(times), name: Seed.pick(names), phone: "09" + Math.floor(Seed.rand(10000000, 99999999)),
          partySize: Math.floor(Seed.rand(2, 7)), status: "已預約", note: "", source: "seed"
        });
      }
    }
    // 過去 14 天(含 no-show)
    for (let d = -14; d <= -1; d++) {
      const date = U.addDays(U.today(), d);
      const n = Math.floor(Seed.rand(2, 5));
      for (let k = 0; k < n; k++) {
        DB.insert("reservations", {
          date, time: Seed.pick(times), name: Seed.pick(names), phone: "09" + Math.floor(Seed.rand(10000000, 99999999)),
          partySize: Math.floor(Seed.rand(2, 7)),
          status: Math.random() < 0.08 ? "No-show" : (Math.random() < 0.06 ? "取消" : "已到"),
          note: "", source: "seed"
        });
      }
    }
  },

  /* ---------- 近期進貨單(示範,可看明細/修改) ---------- */
  openPOs() {
    const today = U.today();
    const mk = (date, supplierId, items) => {
      const grId = U.uid("gr");
      const lines = items.map(([ingId, qty, price]) => {
        const ing = DB.byId("ingredients", ingId);
        const batchNo = "P" + date.replace(/-/g, "") + "-" + ing.name.slice(0, 2);
        Domain.addStock(ingId, qty, date, ing.shelfLifeDays < 999 ? U.addDays(date, ing.shelfLifeDays) : null, batchNo, "進貨", "進貨", grId, price);
        DB.insert("priceHistory", { ingredientId: ingId, supplierId, unitPrice: price, date, grId });
        return { ingredientId: ingId, qtyReceived: qty, unitPrice: price, batchNo, expiry: null };
      });
      DB.insert("goodsReceipts", { id: grId, date, lines, source: "manual", supplierId });
    };
    mk(U.addDays(today, -1), "sup_veg", [["i_cabbage", 30, 5250], ["i_napa", 20, 3000], ["i_bokchoy", 12, 6000]]);
    mk(U.addDays(today, -1), "sup_frozen", [["i_tofu", 18, 4000], ["i_hotpotballs", 12, 18000]]);
    mk(today, "sup_meat", [["i_beefbacon", 11.5, 40000], ["i_porkslice", 8, 30000]]);
  },

  /* ---------- 預測 ---------- */
  forecasts() {
    // 過去 30 天(檢視準確度)
    for (let d = -30; d <= -1; d++) {
      const date = U.addDays(U.today(), d);
      const s = DB.get("salesDaily").find(x => x.date === date);
      if (!s) continue;
      DB.insert("forecasts", { date, predicted: Math.round(s.covers * Seed.rand(0.88, 1.12)), actual: s.covers, method: "seed" });
    }
    // 未來 7 天(規則式)
    for (let d = 0; d <= 7; d++) {
      const date = U.addDays(U.today(), d);
      const f = Domain.forecastCovers(date);
      DB.insert("forecasts", { date, predicted: f.predicted, actual: null, method: "規則式" });
    }
  }
};

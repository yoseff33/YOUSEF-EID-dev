(() => {
  "use strict";

  const config = window.APP_CONFIG || {};
  const isConfigured = Boolean(
    config.supabaseUrl && config.supabaseAnonKey &&
    !config.supabaseUrl.includes("PUT_YOUR") && !config.supabaseAnonKey.includes("PUT_YOUR")
  );

  let client = null;
  if (isConfigured && window.supabase?.createClient) {
    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      global: { headers: { "x-client-info": `yousef-auto-parts/${config.appVersion || "2"}` } }
    });
  }

  function ensureClient() {
    if (!client) throw new Error("لم يتم إعداد اتصال Supabase بعد");
    return client;
  }

  function normalizeError(error) {
    const message = error?.message || String(error || "حدث خطأ غير معروف");
    if (/Invalid login credentials/i.test(message)) return "البريد الإلكتروني أو كلمة المرور غير صحيحة";
    if (/Email not confirmed/i.test(message)) return "البريد الإلكتروني غير مؤكد";
    if (/insufficient_stock/i.test(message)) return "الكمية المطلوبة أكبر من المخزون المتاح";
    if (/price_change_not_allowed/i.test(message)) return "موظف المبيعات لا يستطيع تغيير سعر الصنف المسجل";
    if (/direct_stock_update_not_allowed/i.test(message)) return "تعديل كمية المخزون مباشرة غير مسموح؛ استخدم شراء أو بيع أو إرجاع أو جرد";
    if (/count_reason_required/i.test(message)) return "اكتب سبب فرق الجرد لكل صنف مختلف";
    if (/inactive_user/i.test(message)) return "هذا المستخدم موقوف";
    if (/permission_denied|not_allowed|row-level security/i.test(message)) return "ليس لديك صلاحية لتنفيذ هذه العملية";
    if (/duplicate key/i.test(message)) return "البيان موجود مسبقًا، تحقق من رقم الفاتورة أو رقم القطعة أو الباركود";
    return message;
  }

  async function cached(key, fetcher, { force = false } = {}) {
    if (!navigator.onLine && !force) return LocalDB.getCache(key, []);
    try {
      const value = await fetcher();
      await LocalDB.setCache(key, value);
      return value;
    } catch (error) {
      const local = await LocalDB.getCache(key, null);
      if (local !== null) return local;
      throw error;
    }
  }

  async function queryTable(table, options = {}) {
    let query = ensureClient().from(table).select(options.select || "*");
    if (options.eq) Object.entries(options.eq).forEach(([key, value]) => { query = query.eq(key, value); });
    if (options.gte) Object.entries(options.gte).forEach(([key, value]) => { query = query.gte(key, value); });
    if (options.lte) Object.entries(options.lte).forEach(([key, value]) => { query = query.lte(key, value); });
    if (options.order) query = query.order(options.order.column, { ascending: options.order.ascending ?? false });
    if (options.limit) query = query.limit(options.limit);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function invokeRpc(name, params) {
    const { data, error } = await ensureClient().rpc(name, params);
    if (error) throw error;
    return data;
  }

  async function applyProductChanges(changes) {
    const products = await LocalDB.getCache("products", []);
    if (!Array.isArray(products) || !products.length) return;
    const map = new Map(products.map((product) => [product.id, { ...product }]));
    changes.forEach((change) => {
      const product = map.get(change.productId);
      if (!product) return;
      if (typeof change.setQuantity === "number") product.stock_quantity = Math.max(0, change.setQuantity);
      else product.stock_quantity = Math.max(0, Number(product.stock_quantity || 0) + Number(change.delta || 0));
      if (typeof change.purchasePrice === "number") product.purchase_price = Math.max(0, change.purchasePrice);
      product._localPending = true;
      map.set(product.id, product);
    });
    await LocalDB.setCache("products", [...map.values()]);
  }

  const Api = {
    isConfigured,
    client,
    normalizeError,

    async signIn(email, password) {
      const { data, error } = await ensureClient().auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },
    async signOut() {
      const { error } = await ensureClient().auth.signOut();
      if (error) throw error;
      await LocalDB.clearCache();
    },
    async session() {
      if (!client) return null;
      const { data } = await client.auth.getSession();
      return data.session;
    },
    onAuthChange(callback) {
      if (!client) return { data: { subscription: { unsubscribe() {} } } };
      return client.auth.onAuthStateChange(callback);
    },
    async currentProfile() {
      const session = await this.session();
      if (!session) return null;
      const { data, error } = await ensureClient().from("profiles").select("*").eq("id", session.user.id).single();
      if (error) throw error;
      if (!data.is_active) throw new Error("inactive_user");
      await LocalDB.setCache("currentProfile", data);
      return data;
    },

    async dashboard(from, to, force = false) {
      return cached(`dashboard:${from}:${to}`, async () => invokeRpc("get_dashboard_summary", { p_from: from, p_to: to }), { force });
    },
    async products(force = false) {
      return cached("products", () => queryTable("products", {
        select: "*", eq: { active: true }, order: { column: "name", ascending: true }
      }), { force });
    },
    async product(id) {
      const { data, error } = await ensureClient().from("products").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
    async saveProduct(payload) {
      const row = { ...payload, updated_at: new Date().toISOString() };
      const query = payload.id
        ? ensureClient().from("products").update(row).eq("id", payload.id).select().single()
        : ensureClient().from("products").insert(row).select().single();
      const { data, error } = await query;
      if (error) throw error;
      await this.products(true);
      return data;
    },
    async uploadProductImage(file, productId) {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${productId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await ensureClient().storage.from("product-images").upload(path, file, { upsert: false });
      if (error) throw error;
      return path;
    },
    publicImageUrl(path) {
      if (!path || !client) return "";
      return client.storage.from("product-images").getPublicUrl(path).data.publicUrl;
    },

    async suppliers(force = false) {
      return cached("suppliers", () => queryTable("suppliers", {
        select: "*", eq: { active: true }, order: { column: "name", ascending: true }
      }), { force });
    },
    async saveSupplier(payload) {
      const query = payload.id
        ? ensureClient().from("suppliers").update(payload).eq("id", payload.id).select().single()
        : ensureClient().from("suppliers").insert(payload).select().single();
      const { data, error } = await query;
      if (error) throw error;
      await this.suppliers(true);
      return data;
    },

    async sales({ from, to, limit = 100 } = {}, force = false) {
      const data = await cached(`sales:${from || ""}:${to || ""}:${limit}`, () => queryTable("sales", {
        select: "*, profiles!sales_created_by_fkey(full_name), sale_items(*)",
        gte: from ? { sale_date: `${from}T00:00:00` } : undefined,
        lte: to ? { sale_date: `${to}T23:59:59` } : undefined,
        order: { column: "sale_date", ascending: false }, limit
      }), { force });
      await Promise.all((data || []).map((sale) => LocalDB.setCache(`sale:${sale.id}`, sale)));
      return data;
    },
    async sale(id) {
      if (!navigator.onLine) {
        const local = await LocalDB.getCache(`sale:${id}`, null);
        if (local) return local;
      }
      try {
        const { data, error } = await ensureClient().from("sales")
          .select("*, profiles!sales_created_by_fkey(full_name), sale_items(*)")
          .eq("id", id).single();
        if (error) throw error;
        await LocalDB.setCache(`sale:${id}`, data);
        return data;
      } catch (error) {
        const local = await LocalDB.getCache(`sale:${id}`, null);
        if (local) return local;
        throw error;
      }
    },
    async completeSale(payload, allowQueue = true) {
      const params = {
        p_invoice_number: payload.invoiceNumber,
        p_sale_date: payload.saleDate,
        p_items: payload.items,
        p_notes: payload.notes || "",
        p_client_request_id: payload.clientRequestId
      };
      const result = await this.executeOrQueue("complete_sale", params, `فاتورة بيع ${payload.invoiceNumber}`, allowQueue);
      if (result.queued) {
        await applyProductChanges(payload.items.map((item) => ({ productId: item.product_id, delta: -Number(item.quantity || 0) })));
      }
      return result;
    },

    async purchases({ from, to, limit = 100 } = {}, force = false) {
      return cached(`purchases:${from || ""}:${to || ""}:${limit}`, () => queryTable("purchases", {
        select: "*, suppliers(name), profiles!purchases_created_by_fkey(full_name), purchase_items(*)",
        gte: from ? { purchase_date: `${from}T00:00:00` } : undefined,
        lte: to ? { purchase_date: `${to}T23:59:59` } : undefined,
        order: { column: "purchase_date", ascending: false }, limit
      }), { force });
    },
    async recordPurchase(payload, allowQueue = true) {
      const params = {
        p_supplier_id: payload.supplierId,
        p_invoice_number: payload.invoiceNumber,
        p_purchase_date: payload.purchaseDate,
        p_items: payload.items,
        p_notes: payload.notes || "",
        p_client_request_id: payload.clientRequestId
      };
      const result = await this.executeOrQueue("record_purchase", params, `فاتورة شراء ${payload.invoiceNumber}`, allowQueue);
      if (result.queued) {
        await applyProductChanges(payload.items.map((item) => {
          const rate = Number(item.vat_rate || 0) / 100;
          return {
            productId: item.product_id,
            delta: Number(item.quantity || 0),
            purchasePrice: Number(item.unit_cost || 0) / (1 + rate)
          };
        }));
      }
      return result;
    },

    async returns({ from, to, limit = 100 } = {}, force = false) {
      return cached(`returns:${from || ""}:${to || ""}:${limit}`, () => queryTable("sale_returns", {
        select: "*, sales(invoice_number), profiles!sale_returns_created_by_fkey(full_name), sale_return_items(*)",
        gte: from ? { return_date: `${from}T00:00:00` } : undefined,
        lte: to ? { return_date: `${to}T23:59:59` } : undefined,
        order: { column: "return_date", ascending: false }, limit
      }), { force });
    },
    async returnSale(payload, allowQueue = true) {
      const params = {
        p_sale_id: payload.saleId,
        p_reason: payload.reason,
        p_items: payload.items,
        p_client_request_id: payload.clientRequestId
      };
      const result = await this.executeOrQueue("return_sale", params, `مرتجع فاتورة ${payload.invoiceNumber || ""}`, allowQueue);
      if (result.queued) {
        await applyProductChanges(payload.items.filter((item) => item.product_id).map((item) => ({ productId: item.product_id, delta: Number(item.quantity || 0) })));
      }
      return result;
    },

    async counts(force = false) {
      return cached("inventoryCounts", () => queryTable("inventory_counts", {
        select: "*, profiles!inventory_counts_created_by_fkey(full_name), inventory_count_items(*)",
        order: { column: "count_date", ascending: false }, limit: 100
      }), { force });
    },
    async completeCount(payload, allowQueue = true) {
      const params = {
        p_count_date: payload.countDate,
        p_notes: payload.notes || "",
        p_items: payload.items,
        p_client_request_id: payload.clientRequestId
      };
      const result = await this.executeOrQueue("complete_inventory_count", params, `جرد ${payload.countDate}`, allowQueue);
      if (result.queued) {
        await applyProductChanges(payload.items.map((item) => ({ productId: item.product_id, setQuantity: Number(item.actual_quantity || 0) })));
      }
      return result;
    },

    async suggestedOrders(force = false) {
      return cached("suggestedOrders", () => queryTable("v_purchase_suggestions", {
        select: "*", order: { column: "suggested_quantity", ascending: false }
      }), { force });
    },
    async profitLoss(from, to, force = false) {
      return cached(`pl:${from}:${to}`, () => invokeRpc("get_profit_loss_report", { p_from: from, p_to: to }), { force });
    },
    async vatReport(from, to, force = false) {
      return cached(`vat:${from}:${to}`, () => invokeRpc("get_vat_report", { p_from: from, p_to: to }), { force });
    },
    async turnover(from, to, force = false) {
      return cached(`turnover:${from}:${to}`, () => invokeRpc("get_inventory_turnover", { p_from: from, p_to: to }), { force });
    },

    async profiles(force = false) {
      return cached("profiles", () => queryTable("profiles", {
        select: "*", order: { column: "created_at", ascending: false }
      }), { force });
    },
    async manageUser(action, payload) {
      const { data, error } = await ensureClient().functions.invoke("manage-users", { body: { action, ...payload } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await this.profiles(true);
      return data;
    },
    async audit(limit = 300, force = false) {
      return cached(`audit:${limit}`, () => queryTable("audit_logs", {
        select: "*, profiles(full_name)", order: { column: "created_at", ascending: false }, limit
      }), { force });
    },

    async executeOrQueue(type, params, label, allowQueue = true) {
      if (!navigator.onLine) {
        if (!allowQueue) throw new Error("لا يمكن تنفيذ هذه العملية بدون إنترنت");
        const queued = await LocalDB.enqueue(type, params, label);
        window.dispatchEvent(new CustomEvent("localqueuechange"));
        return { queued: true, queueId: queued.id, clientRequestId: params.p_client_request_id };
      }
      try {
        const data = await invokeRpc(type, params);
        window.dispatchEvent(new CustomEvent("datachanged", { detail: { type } }));
        return { queued: false, data };
      } catch (error) {
        if (allowQueue && !navigator.onLine) {
          const queued = await LocalDB.enqueue(type, params, label);
          window.dispatchEvent(new CustomEvent("localqueuechange"));
          return { queued: true, queueId: queued.id };
        }
        throw error;
      }
    },

    async syncQueue(onProgress = () => {}) {
      if (!navigator.onLine || !client) return { synced: 0, failed: 0 };
      const queue = await LocalDB.listQueue(["pending", "failed"]);
      let synced = 0;
      let failed = 0;
      for (let index = 0; index < queue.length; index += 1) {
        const item = queue[index];
        onProgress({ index, total: queue.length, item });
        await LocalDB.updateQueue(item.id, { status: "processing" });
        try {
          await invokeRpc(item.type, item.payload);
          await LocalDB.removeQueue(item.id);
          synced += 1;
        } catch (error) {
          failed += 1;
          await LocalDB.updateQueue(item.id, {
            status: "failed",
            retries: (item.retries || 0) + 1,
            lastError: normalizeError(error)
          });
        }
      }
      if (queue.length) {
        await Promise.allSettled([this.products(true), this.sales({}, true), this.purchases({}, true), this.returns({}, true), this.counts(true)]);
      }
      window.dispatchEvent(new CustomEvent("localqueuechange"));
      return { synced, failed };
    }
  };

  window.Api = Api;
})();

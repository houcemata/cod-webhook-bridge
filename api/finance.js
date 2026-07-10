// api/finance.js
// Single router for all finance operations — stays within Vercel 12-function limit.
// Action is read from ?action= query param or body.action.
// All write actions require admin role; reads require admin or operator.

import { requireRole, getServiceClient } from "./_auth.js";

export default async function handler(req, res) {
  const action = req.query.action || (req.body && req.body.action);
  if (!action) return res.status(400).json({ error: "Missing action" });

  // Route to correct handler
  try {
    switch (action) {
      // ── WALLETS ──────────────────────────────────────────────────
      case "get-wallets":         return await getWallets(req, res);
      case "update-wallet":       return await updateWallet(req, res);
      case "add-wallet":          return await addWallet(req, res);
      case "delete-wallet":       return await deleteWallet(req, res);

      // ── NOEST PAYOUTS ─────────────────────────────────────────────
      case "get-noest-summary":   return await getNoestSummary(req, res);
      case "log-noest-payout":    return await logNoestPayout(req, res);
      case "delete-noest-payout": return await deleteNoestPayout(req, res);

      // ── EMPLOYEES ─────────────────────────────────────────────────
      case "get-employees":       return await getEmployees(req, res);
      case "save-employee":       return await saveEmployee(req, res);
      case "delete-employee":     return await deleteEmployee(req, res);

      // ── RECURRING EXPENSES ────────────────────────────────────────
      case "get-recurring":       return await getRecurring(req, res);
      case "save-recurring":      return await saveRecurring(req, res);
      case "delete-recurring":    return await deleteRecurring(req, res);

      // ── CREDITORS ─────────────────────────────────────────────────
      case "get-creditors":       return await getCreditors(req, res);
      case "save-creditor":       return await saveCreditor(req, res);
      case "delete-creditor":     return await deleteCreditor(req, res);

      // ── DEBTS ─────────────────────────────────────────────────────
      case "get-debts":           return await getDebts(req, res);
      case "add-debt":            return await addDebt(req, res);
      case "delete-debt":         return await deleteDebt(req, res);
      case "pay-debt":            return await payDebt(req, res);
      case "generate-debts":      return await generateDebts(req, res);

      // ── INCOME ────────────────────────────────────────────────────
      case "get-income":          return await getIncome(req, res);
      case "add-income":          return await addIncome(req, res);
      case "delete-income":       return await deleteIncome(req, res);

      // ── BREAKDOWN ─────────────────────────────────────────────────
      case "get-breakdown":       return await getBreakdown(req, res);

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error(`[finance/${action}]`, err);
    return res.status(500).json({ error: err.message || "Finance error" });
  }
}

// ══════════════════════════════════════════════════════════════════
// WALLETS
// ══════════════════════════════════════════════════════════════════

async function getWallets(req, res) {
  const auth = await requireRole(req, ["admin", "operator"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const sb = getServiceClient();
  const { data, error } = await sb.from("wallets").select("*").order("id");
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ wallets: data || [] });
}

async function updateWallet(req, res) {
  const auth = await requireRole(req, ["admin"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const { id, name, type, balance } = req.body || {};
  if (!id) return res.status(400).json({ error: "Missing wallet id" });
  const sb = getServiceClient();
  const update = {};
  if (name !== undefined) update.name = String(name).trim();
  if (type !== undefined) update.type = String(type).trim();
  if (balance !== undefined) update.balance = Number(balance);
  const { error } = await sb.from("wallets").update(update).eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}

async function addWallet(req, res) {
  const auth = await requireRole(req, ["admin"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const { name, type, balance } = req.body || {};
  if (!name) return res.status(400).json({ error: "Wallet name required" });
  const sb = getServiceClient();
  const { data, error } = await sb.from("wallets").insert({
    name: String(name).trim(),
    type: String(type || "cash").trim(),
    balance: Number(balance || 0),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true, wallet: data });
}

async function deleteWallet(req, res) {
  const auth = await requireRole(req, ["admin"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "Missing wallet id" });
  const sb = getServiceClient();
  const { error } = await sb.from("wallets").delete().eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}

// ══════════════════════════════════════════════════════════════════
// NOEST PAYOUTS
// ══════════════════════════════════════════════════════════════════

async function getNoestSummary(req, res) {
  const auth = await requireRole(req, ["admin", "operator"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const sb = getServiceClient();

  const [
    { data: payouts },
    { data: events },
    { data: delivered },
  ] = await Promise.all([
    sb.from("noest_payouts").select("*").order("date", { ascending: false }),
    sb.from("noest_payment_events").select("*").order("detected_at", { ascending: false }),
    sb.from("orders")
      .select("order_id, tracking_number, prix_total, status, created_at")
      .eq("status", "delivered"),
  ]);

  const totalDeliveredAmount = (delivered || []).reduce((s, o) => s + Number(o.prix_total || 0), 0);
  const totalPaidOut = (payouts || []).reduce((s, p) => s + Number(p.amount || 0), 0);
  const noestOwes = Math.max(0, totalDeliveredAmount - totalPaidOut);

  // Cross-reference payment events with orders
  const eventOrderIds = new Set((events || []).map(e => e.order_id).filter(Boolean));
  const eventedAmount = (delivered || [])
    .filter(o => eventOrderIds.has(o.order_id))
    .reduce((s, o) => s + Number(o.prix_total || 0), 0);

  return res.status(200).json({
    total_delivered_amount: totalDeliveredAmount,
    total_delivered_count: (delivered || []).length,
    total_paid_out: totalPaidOut,
    noest_owes: noestOwes,
    noest_signaled_amount: eventedAmount,
    payouts: payouts || [],
    payment_events: (events || []).slice(0, 50),
  });
}

async function logNoestPayout(req, res) {
  const auth = await requireRole(req, ["admin"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const { date, amount, reference, note, wallet_id } = req.body || {};
  if (!date || !amount) return res.status(400).json({ error: "Date and amount required" });
  const sb = getServiceClient();

  // Insert payout record
  const { error: payoutError } = await sb.from("noest_payouts").insert({
    date,
    amount: Number(amount),
    reference: String(reference || "").trim() || null,
    note: String(note || "").trim() || null,
    wallet_id: wallet_id ? Number(wallet_id) : null,
  });
  if (payoutError) return res.status(500).json({ error: payoutError.message });

  // If wallet specified, add balance to it
  if (wallet_id) {
    const { data: wallet } = await sb.from("wallets").select("balance").eq("id", wallet_id).single();
    if (wallet) {
      await sb.from("wallets").update({
        balance: Number(wallet.balance) + Number(amount),
      }).eq("id", wallet_id);
      await sb.from("wallet_transactions").insert({
        wallet_id: Number(wallet_id),
        type: "deposit",
        amount: Number(amount),
        description: `Noest payout${reference ? ` — ${reference}` : ""}`,
        reference: String(reference || "").trim() || null,
      });
    }
  }

  return res.status(200).json({ ok: true });
}

async function deleteNoestPayout(req, res) {
  const auth = await requireRole(req, ["admin"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "Missing payout id" });
  const sb = getServiceClient();

  // Get the payout to reverse wallet balance if needed
  const { data: payout } = await sb.from("noest_payouts").select("*").eq("id", id).single();
  if (payout?.wallet_id) {
    const { data: wallet } = await sb.from("wallets").select("balance").eq("id", payout.wallet_id).single();
    if (wallet) {
      await sb.from("wallets").update({
        balance: Math.max(0, Number(wallet.balance) - Number(payout.amount)),
      }).eq("id", payout.wallet_id);
    }
  }

  const { error } = await sb.from("noest_payouts").delete().eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}

// ══════════════════════════════════════════════════════════════════
// EMPLOYEES
// ══════════════════════════════════════════════════════════════════

async function getEmployees(req, res) {
  const auth = await requireRole(req, ["admin", "operator"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const sb = getServiceClient();
  const { data, error } = await sb.from("employees").select("*").order("id");
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ employees: data || [] });
}

async function saveEmployee(req, res) {
  const auth = await requireRole(req, ["admin"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const { id, key, name, role, pay_type, rate, active } = req.body || {};
  if (!name || !pay_type) return res.status(400).json({ error: "Name and pay_type required" });
  const sb = getServiceClient();

  const payload = {
    key: String(key || name).toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""),
    name: String(name).trim(),
    role: String(role || "").trim(),
    pay_type: String(pay_type).trim(),
    rate: Number(rate || 0),
    active: active !== false,
  };

  if (id) {
    const { error } = await sb.from("employees").update(payload).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
  } else {
    const { error } = await sb.from("employees").insert(payload);
    if (error) return res.status(500).json({ error: error.message });
  }
  return res.status(200).json({ ok: true });
}

async function deleteEmployee(req, res) {
  const auth = await requireRole(req, ["admin"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "Missing employee id" });
  const sb = getServiceClient();
  const { error } = await sb.from("employees").delete().eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}

// ══════════════════════════════════════════════════════════════════
// RECURRING EXPENSES
// ══════════════════════════════════════════════════════════════════

async function getRecurring(req, res) {
  const auth = await requireRole(req, ["admin", "operator"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const sb = getServiceClient();
  const { data, error } = await sb.from("recurring_expenses").select("*").order("id");
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ recurring: data || [] });
}

async function saveRecurring(req, res) {
  const auth = await requireRole(req, ["admin"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const { id, name, amount, category, frequency, active } = req.body || {};
  if (!name || !amount) return res.status(400).json({ error: "Name and amount required" });
  const sb = getServiceClient();

  const payload = {
    name: String(name).trim(),
    amount: Number(amount),
    category: String(category || "other").trim(),
    frequency: String(frequency || "monthly").trim(),
    active: active !== false,
  };

  if (id) {
    const { error } = await sb.from("recurring_expenses").update(payload).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
  } else {
    const { error } = await sb.from("recurring_expenses").insert(payload);
    if (error) return res.status(500).json({ error: error.message });
  }
  return res.status(200).json({ ok: true });
}

async function deleteRecurring(req, res) {
  const auth = await requireRole(req, ["admin"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "Missing recurring id" });
  const sb = getServiceClient();
  const { error } = await sb.from("recurring_expenses").delete().eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}

// ══════════════════════════════════════════════════════════════════
// BREAKDOWN — product unit economics
// ══════════════════════════════════════════════════════════════════

async function getBreakdown(req, res) {
  const auth = await requireRole(req, ["admin", "operator"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { from, to } = req.query;
  const sb = getServiceClient();

  // Load orders in range
  let ordersQuery = sb.from("orders")
    .select("id, order_id, product, variable, prix_total, shipping_cost, status, items, created_at")
    .neq("status", "draft")
    .neq("status", "pending")
    .neq("status", "duplicated");
  if (from) ordersQuery = ordersQuery.gte("created_at", from);
  if (to)   ordersQuery = ordersQuery.lte("created_at", to);

  const [
    { data: orders },
    { data: stockItems },
    { data: productionLogs },
    { data: employees },
    { data: recurring },
  ] = await Promise.all([
    ordersQuery,
    sb.from("stock_items").select("*"),
    sb.from("production_logs").select("*"),
    sb.from("employees").select("*").eq("active", true),
    sb.from("recurring_expenses").select("*").eq("active", true),
  ]);

  const allOrders = orders || [];
  const delivered = allOrders.filter(o => o.status === "delivered");
  const returned  = allOrders.filter(o => o.status === "returned" || o.status === "not_delivered");

  // ── Revenue ──────────────────────────────────────────────────
  const totalRevenue = delivered.reduce((s, o) =>
    s + Math.max(0, Number(o.prix_total || 0) - Number(o.shipping_cost || 0)), 0);

  // ── Shipping loss (returned orders: we paid shipping both ways effectively) ──
  const shippingLoss = returned.reduce((s, o) => s + Number(o.shipping_cost || 0), 0);

  // ── COGS from production logs ─────────────────────────────────
  // Frame maker cost already in production_logs.total_pay_frame_maker
  // Material cost = stock_usage_log is separate, but we estimate from logs
  const filterLogs = productionLogs ? (from || to
    ? productionLogs.filter(l => {
        if (!l.date) return true;
        if (from && l.date < from.slice(0, 10)) return false;
        if (to   && l.date > to.slice(0, 10))   return false;
        return true;
      })
    : productionLogs) : [];

  const totalFramesMade = filterLogs.reduce((s, l) =>
    s + (l.m_frames || 0) + (l.l_frames || 0) + (l.xl_frames || 0) + (l.xxl_frames || 0), 0);
  const frameMakerPay = filterLogs.reduce((s, l) => s + Number(l.total_pay_frame_maker || 0), 0);
  const printSqm = filterLogs.reduce((s, l) => s + Number(l.print_sqm || 0), 0);

  // ── Staff costs from DB employees ────────────────────────────
  const empMap = {};
  (employees || []).forEach(e => { empMap[e.key] = e; });

  const operatorEmp   = empMap["operator"];
  const printerEmp    = empMap["printer"];
  const printGuyEmp   = empMap["print_guy"];

  const operatorPay   = operatorEmp   ? delivered.length * Number(operatorEmp.rate || 0) : 0;
  const printerPay    = printerEmp    ? printSqm * Number(printerEmp.rate || 0) : 0;

  // Count Thursdays in range for fixed_weekly
  const thursdayCount = countThursdaysInRange(from, to);
  const printGuyPay   = printGuyEmp   ? thursdayCount * Number(printGuyEmp.rate || 0) : 0;

  const totalStaffCost = frameMakerPay + operatorPay + printerPay + printGuyPay;

  // ── Recurring expenses auto-applied ──────────────────────────
  const recurringTotal = calcRecurringTotal(recurring || [], from, to);

  // ── Stock value ───────────────────────────────────────────────
  const stockValue = (stockItems || []).reduce((s, i) =>
    s + Number(i.quantity || 0) * Number(i.cost_per_unit || 0), 0);

  // ── Per-product breakdown ─────────────────────────────────────
  const productStats = {};

  allOrders.forEach(o => {
    const items = Array.isArray(o.items) && o.items.length
      ? o.items
      : [{ product: o.product, variant: o.variable, line_price: Math.max(0, Number(o.prix_total || 0) - Number(o.shipping_cost || 0)) }];

    items.forEach(it => {
      const key = it.product || "Unknown";
      if (!productStats[key]) {
        productStats[key] = {
          name: key,
          orders: 0,
          delivered: 0,
          returned: 0,
          pending: 0,
          revenue: 0,
          shipping_loss: 0,
        };
      }
      const p = productStats[key];
      p.orders++;
      if (o.status === "delivered") {
        p.delivered++;
        p.revenue += Number(it.line_price || 0);
      }
      if (o.status === "returned" || o.status === "not_delivered") {
        p.returned++;
        p.shipping_loss += Number(o.shipping_cost || 0);
      }
      if (["confirmed", "shipped", "shipping"].includes(o.status)) {
        p.pending++;
      }
    });
  });

  // Revenue-share attribution of global ad spend placeholder
  // (actual ad spend comes from frontend which already calls /api/ad-performance)
  const productRows = Object.values(productStats)
    .sort((a, b) => b.revenue - a.revenue)
    .map(p => ({
      ...p,
      delivery_rate: p.orders ? Math.round(p.delivered / p.orders * 100) : 0,
      return_rate:   p.orders ? Math.round(p.returned  / p.orders * 100) : 0,
      revenue_share: totalRevenue > 0 ? p.revenue / totalRevenue : 0,
    }));

  return res.status(200).json({
    summary: {
      revenue:         totalRevenue,
      shipping_loss:   shippingLoss,
      staff_cost:      totalStaffCost,
      recurring_cost:  recurringTotal,
      stock_value:     stockValue,
      frames_made:     totalFramesMade,
      print_sqm:       printSqm,
      delivered_count: delivered.length,
      returned_count:  returned.length,
      total_orders:    allOrders.length,
    },
    staff: {
      frame_maker: frameMakerPay,
      operator:    operatorPay,
      printer:     printerPay,
      print_guy:   printGuyPay,
    },
    products: productRows,
  });
}

// ══════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════

function countThursdaysInRange(from, to) {
  if (!from && !to) return 0;
  const start = from ? new Date(from) : new Date("2020-01-01");
  const end   = to   ? new Date(to)   : new Date();
  let count = 0;
  const d = new Date(start);
  while (d <= end) {
    if (d.getDay() === 4) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function calcRecurringTotal(recurring, from, to) {
  // Count how many occurrences of each recurring expense fall in the period
  if (!from && !to) return recurring.reduce((s, r) => s + Number(r.amount || 0), 0);

  const start = from ? new Date(from) : new Date("2020-01-01");
  const end   = to   ? new Date(to)   : new Date();
  const days  = Math.max(1, Math.round((end - start) / 86400000));

  return recurring.reduce((s, r) => {
    const amount = Number(r.amount || 0);
    if (r.frequency === "monthly") {
      const months = days / 30;
      return s + amount * months;
    }
    if (r.frequency === "weekly") {
      const weeks = days / 7;
      return s + amount * weeks;
    }
    return s + amount;
  }, 0);
}

// ══════════════════════════════════════════════════════════════════
// CREDITORS
// ══════════════════════════════════════════════════════════════════

async function getCreditors(req, res) {
  const auth = await requireRole(req, ["admin", "operator"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const sb = getServiceClient();
  const { data, error } = await sb.from("creditors").select("*").eq("active", true).order("id");
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ creditors: data || [] });
}

async function saveCreditor(req, res) {
  const auth = await requireRole(req, ["admin"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const { id, name, type, pay_type, rate, note } = req.body || {};
  if (!name) return res.status(400).json({ error: "Name required" });
  const sb = getServiceClient();
  const payload = {
    name: String(name).trim(),
    type: String(type || "other").trim(),
    pay_type: pay_type ? String(pay_type).trim() : null,
    rate: Number(rate || 0),
    note: String(note || "").trim() || null,
  };
  if (id) {
    const { error } = await sb.from("creditors").update(payload).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
  } else {
    const { error } = await sb.from("creditors").insert(payload);
    if (error) return res.status(500).json({ error: error.message });
  }
  return res.status(200).json({ ok: true });
}

async function deleteCreditor(req, res) {
  const auth = await requireRole(req, ["admin"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "Missing id" });
  const sb = getServiceClient();
  // Soft delete — keep debt history
  const { error } = await sb.from("creditors").update({ active: false }).eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}

// ══════════════════════════════════════════════════════════════════
// DEBTS
// ══════════════════════════════════════════════════════════════════

async function getDebts(req, res) {
  const auth = await requireRole(req, ["admin", "operator"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const sb = getServiceClient();
  const [{ data: debts }, { data: payments }] = await Promise.all([
    sb.from("debts").select("*").order("created_at", { ascending: false }),
    sb.from("debt_payments").select("*").order("paid_at", { ascending: false }),
  ]);
  return res.status(200).json({ debts: debts || [], payments: payments || [] });
}

async function addDebt(req, res) {
  const auth = await requireRole(req, ["admin"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const { creditor_id, creditor_name, amount, description, due_date, period_start, period_end } = req.body || {};
  if (!creditor_name || !amount) return res.status(400).json({ error: "Creditor name and amount required" });
  const sb = getServiceClient();
  const { error } = await sb.from("debts").insert({
    creditor_id: creditor_id ? Number(creditor_id) : null,
    creditor_name: String(creditor_name).trim(),
    amount: Number(amount),
    description: String(description || "").trim() || null,
    due_date: due_date || null,
    period_start: period_start || null,
    period_end: period_end || null,
    status: "outstanding",
    amount_paid: 0,
  });
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}

async function deleteDebt(req, res) {
  const auth = await requireRole(req, ["admin"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "Missing id" });
  const sb = getServiceClient();
  const { error } = await sb.from("debts").delete().eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}

async function payDebt(req, res) {
  const auth = await requireRole(req, ["admin"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const { debt_id, amount, wallet_id, note } = req.body || {};
  if (!debt_id || !amount) return res.status(400).json({ error: "debt_id and amount required" });
  const sb = getServiceClient();

  // Get current debt
  const { data: debt, error: fetchError } = await sb.from("debts").select("*").eq("id", debt_id).single();
  if (fetchError || !debt) return res.status(404).json({ error: "Debt not found" });

  const payAmount = Number(amount);
  const newPaid = Number(debt.amount_paid || 0) + payAmount;
  const newStatus = newPaid >= Number(debt.amount) ? "paid" : "partial";

  // Log payment
  const { error: payError } = await sb.from("debt_payments").insert({
    debt_id: Number(debt_id),
    amount: payAmount,
    wallet_id: wallet_id ? Number(wallet_id) : null,
    note: String(note || "").trim() || null,
  });
  if (payError) return res.status(500).json({ error: payError.message });

  // Update debt status
  const { error: updateError } = await sb.from("debts")
    .update({ amount_paid: newPaid, status: newStatus })
    .eq("id", debt_id);
  if (updateError) return res.status(500).json({ error: updateError.message });

  // Deduct from wallet
  if (wallet_id) {
    const { data: wallet } = await sb.from("wallets").select("balance").eq("id", wallet_id).single();
    if (wallet) {
      await sb.from("wallets").update({
        balance: Math.max(0, Number(wallet.balance) - payAmount),
      }).eq("id", wallet_id);
    }
  }

  return res.status(200).json({ ok: true, new_status: newStatus, total_paid: newPaid });
}

async function generateDebts(req, res) {
  const auth = await requireRole(req, ["admin"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { from, to, preview } = req.body || {};
  if (!from || !to) return res.status(400).json({ error: "from and to dates required" });

  const sb = getServiceClient();

  const [
    { data: creditors },
    { data: orders },
    { data: prodLogs },
  ] = await Promise.all([
    sb.from("creditors").select("*").eq("active", true),
    sb.from("orders").select("prix_total, shipping_cost, status, created_at")
      .eq("status", "delivered").gte("created_at", from).lte("created_at", to),
    sb.from("production_logs").select("*")
      .gte("date", from.slice(0, 10)).lte("date", to.slice(0, 10)),
  ]);

  const deliveredCount = (orders || []).length;
  const totalFrames = (prodLogs || []).reduce((s, l) =>
    s + (l.m_frames || 0) + (l.l_frames || 0) + (l.xl_frames || 0) + (l.xxl_frames || 0), 0);
  const totalSqm = (prodLogs || []).reduce((s, l) => s + Number(l.print_sqm || 0), 0);

  // Calculate what each creditor is owed
  const suggestions = (creditors || []).map(c => {
    let amount = 0;
    let description = "";
    if (c.pay_type === "per_frame") {
      amount = totalFrames * Number(c.rate || 0);
      description = `${totalFrames} frames × ${c.rate} DZD`;
    } else if (c.pay_type === "per_delivered") {
      amount = deliveredCount * Number(c.rate || 0);
      description = `${deliveredCount} delivered orders × ${c.rate} DZD`;
    } else if (c.pay_type === "per_sqm") {
      amount = totalSqm * Number(c.rate || 0);
      description = `${totalSqm.toFixed(2)} m² × ${c.rate} DZD`;
    } else {
      return null; // manual creditors skip auto-gen
    }
    if (!amount) return null;
    return {
      creditor_id: c.id,
      creditor_name: c.name,
      amount: Math.round(amount),
      description,
      period_start: from.slice(0, 10),
      period_end: to.slice(0, 10),
    };
  }).filter(Boolean);

  // If preview=true just return suggestions without inserting
  if (preview) {
    return res.status(200).json({ suggestions, delivered_count: deliveredCount, total_frames: totalFrames, total_sqm: totalSqm });
  }

  // Insert debt records
  if (suggestions.length) {
    const { error } = await sb.from("debts").insert(
      suggestions.map(s => ({ ...s, status: "outstanding", amount_paid: 0 }))
    );
    if (error) return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ ok: true, created: suggestions.length, suggestions });
}

// ══════════════════════════════════════════════════════════════════
// INCOME
// ══════════════════════════════════════════════════════════════════

async function getIncome(req, res) {
  const auth = await requireRole(req, ["admin", "operator"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const sb = getServiceClient();
  const { data, error } = await sb.from("income").select("*").order("date", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ income: data || [] });
}

async function addIncome(req, res) {
  const auth = await requireRole(req, ["admin"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const { amount, type, wallet_id, date, note } = req.body || {};
  if (!amount || !date) return res.status(400).json({ error: "Amount and date required" });
  const sb = getServiceClient();

  const { error } = await sb.from("income").insert({
    amount: Number(amount),
    type: String(type || "other").trim(),
    wallet_id: wallet_id ? Number(wallet_id) : null,
    date,
    note: String(note || "").trim() || null,
  });
  if (error) return res.status(500).json({ error: error.message });

  // Add to wallet balance
  if (wallet_id) {
    const { data: wallet } = await sb.from("wallets").select("balance").eq("id", wallet_id).single();
    if (wallet) {
      await sb.from("wallets").update({
        balance: Number(wallet.balance) + Number(amount),
      }).eq("id", wallet_id);
    }
  }

  return res.status(200).json({ ok: true });
}

async function deleteIncome(req, res) {
  const auth = await requireRole(req, ["admin"]);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "Missing id" });
  const sb = getServiceClient();

  // Reverse wallet balance
  const { data: entry } = await sb.from("income").select("*").eq("id", id).single();
  if (entry?.wallet_id) {
    const { data: wallet } = await sb.from("wallets").select("balance").eq("id", entry.wallet_id).single();
    if (wallet) {
      await sb.from("wallets").update({
        balance: Math.max(0, Number(wallet.balance) - Number(entry.amount)),
      }).eq("id", entry.wallet_id);
    }
  }

  const { error } = await sb.from("income").delete().eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}

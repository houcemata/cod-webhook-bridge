/**
 * api/track-orders.js
 * 
 * Auto-tracking system for ARCO COD CRM
 * Polls Noest Express API every 30 minutes (via pg_cron)
 * Tracks: picked up by driver, out for delivery, delivered, suspended, returned
 * Updates order statuses + logs changes to order_history
 */

import { createClient } from "@supabase/supabase-js";
import { isAuthorizedCronRequest, requireRole } from "./_auth.js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const noestApiKey = process.env.NOEST_API_KEY;
const noestGuid = process.env.NOEST_GUID;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const NOEST_BASE = "https://app.noest-dz.com/api/public";

/**
 * Map Noest event keys to ARCO order statuses.
 * We keep the map broad because Noest can return slightly different
 * keys depending on carrier, language, or API version.
 */
const EVENT_STATUS_MAP = {
  // ── In transit / out for delivery ──
  validation_collect_colis: "shipping",
  validation_reception_admin: "shipping",
  validation_reception: "shipping",
  fdr_activated: "shipping",
  sent_to_redispatch: "shipping",
  nouvel_tentative_asked_by_customer: "shipping",
  mise_a_jour: "shipping",
  return_redispatched_to_livraison: "shipping", // return put back out for delivery
  out_for_delivery: "shipping",
  picked_up_by_driver: "shipping",

  // ── Delivered ── (COD cash-collection events only happen AFTER delivery,
  // so they count as proof of delivery)
  livre: "delivered",
  livred: "delivered",
  delivered: "delivered",
  verssement_admin_cust: "delivered",
  validation_reception_cash_by_partener: "delivered",
  amount_transmitted_to_partner: "delivered",
  amount_received_by_partner: "delivered",
  echange_valide: "delivered",
  echange_valid_by_hub: "delivered",

  // ── Suspended ──
  colis_suspendu: "suspended",
  suspended: "suspended",

  // ── Returned ── (parcel coming back / received by partner)
  return_asked_by_customer: "returned",
  return_asked_by_hub: "returned",
  retour_dispatched_to_partenaires: "returned",
  return_dispatched_to_partenaire: "returned",
  return_dispatched_to_partner: "returned",
  colis_retour_transmit_to_partner: "returned",
  livraison_echoue_recu: "returned",
  return_validated_by_partener: "returned",
  return_validated_by_partner: "returned",
  return_dispatched_to_warehouse: "returned",
  return_received_by_partner: "returned",
  return_requested_by_partner: "returned",
  return_in_transit: "returned",
  return_package_transmitted_to_partner: "returned",
};

/**
 * Statuses that are terminal (don't need tracking anymore)
 */
const TERMINAL_STATUSES = [
  "delivered",
  "canceled",
  "returned",
  "suspended",
  "not_delivered",
  "duplicated",
];

export default async function handler(req, res) {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  
  console.log(`[track-orders] ${timestamp} — Starting batch tracking...`);

  try {
    if (!isAuthorizedCronRequest(req)) {
      const auth = await requireRole(req, ["operator", "admin"]);
      if (!auth.ok) {
        return res.status(auth.status).json({ error: auth.error });
      }
    }

    if (!supabaseUrl || !supabaseServiceKey || !noestApiKey || !noestGuid) {
      console.error("[track-orders] Missing required environment variables");
      return res.status(500).json({ error: "Configuration error: missing env vars" });
    }

    // Fetch all orders that need tracking (non-terminal, with tracking numbers)
    const { data: orders, error: fetchError } = await supabase
      .from("orders")
      .select("id, order_id, tracking_number, status, name, phone, product, variable, prix_total")
      .not("tracking_number", "is", null)
      .not("status", "in", `(${TERMINAL_STATUSES.map(s => `"${s}"`).join(",")})`);

    if (fetchError) {
      console.error("[track-orders] Fetch error:", fetchError);
      return res.status(500).json({ error: "Failed to fetch orders", details: fetchError.message });
    }

    const totalOrders = orders?.length || 0;
    console.log(`[track-orders] Found ${totalOrders} orders to track`);

    if (totalOrders === 0) {
      return res.status(200).json({
        message: "Tracking complete",
        timestamp,
        orders_checked: 0,
        orders_updated: 0,
        errors: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    let updated = 0;
    let errors = 0;
    const updates = [];

    // 1) Ask Noest about every parcel in a handful of batched requests.
    const trackingNumbers = [...new Set(orders.map(o => o.tracking_number).filter(Boolean))];
    const eventMap = await getNoestEventsBatch(trackingNumbers);
    console.log(`[track-orders] Got Noest data for ${eventMap.size}/${trackingNumbers.length} trackings`);

    // 2) Decide the new status for each order; collect writes (no DB call yet).
    const idsByStatus = {};       // newStatus -> [order.id]
    const historyRows = [];       // single bulk insert
    const deliveredOrders = [];   // for notifications

    for (const order of orders) {
      const latestEvent = eventMap.get(order.tracking_number);
      if (!latestEvent) continue;

      const newStatus = EVENT_STATUS_MAP[latestEvent.event_key];
      if (!newStatus || newStatus === order.status) continue;

      (idsByStatus[newStatus] = idsByStatus[newStatus] || []).push(order.id);
      historyRows.push({
        order_id: order.order_id,
        old_status: order.status,
        new_status: newStatus,
        field_name: null,
        changed_by: "auto_tracker",
        changed_at: timestamp,
      });
      updates.push({ order_id: order.order_id, from: order.status, to: newStatus, event: latestEvent.event_key });
      if (newStatus === "delivered") deliveredOrders.push(order);
    }

    // 3) Apply status changes grouped by target status — a few queries, not hundreds.
    for (const [newStatus, ids] of Object.entries(idsByStatus)) {
      const { error: updateError } = await supabase
        .from("orders")
        .update({ status: newStatus, updated_at: timestamp })
        .in("id", ids);
      if (updateError) {
        console.error(`[track-orders] bulk update failed for "${newStatus}":`, updateError);
        errors += ids.length;
      } else {
        updated += ids.length;
      }
    }

    // 4) Log all status changes to history in one insert.
    if (historyRows.length) {
      const { error: historyError } = await supabase.from("order_history").insert(historyRows);
      if (historyError) {
        console.error(`[track-orders] bulk history insert failed:`, historyError);
        errors++;
      }
    }

    // 5) Fire delivered notifications (best-effort, don't block the response).
    for (const order of deliveredOrders) {
      try {
        await sendNtfyNotification(
          "arco-delivered",
          `✅ Order Delivered`,
          `${order.order_id} — ${order.prix_total || ''} DZD`
        );
      } catch (err) {
        console.warn(`[track-orders] notify failed for ${order.order_id}:`, err.message);
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `[track-orders] ✅ Complete: checked=${totalOrders}, updated=${updated}, errors=${errors}, took=${duration}ms`
    );

    return res.status(200).json({
      message: "Tracking complete",
      timestamp,
      orders_checked: totalOrders,
      orders_updated: updated,
      errors,
      duration_ms: duration,
      updates,
    });

  } catch (err) {
    console.error("[track-orders] Fatal error:", err.message);
    return res.status(500).json({
      error: "Tracking failed",
      message: err.message,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Get the latest event from Noest for a tracking number
 * Calls /api/public/get/trackings/info and returns the most recent activity
 */
// Resolve one parcel's activity history into its most recent meaningful status.
function resolveActivityToEvent(orderData) {
  if (!orderData || !Array.isArray(orderData.activity) || orderData.activity.length === 0) {
    return null;
  }
  const activity = [...orderData.activity].sort(
    (a, b) => parseNoestDate(b?.date) - parseNoestDate(a?.date)
  );
  let newest = null;
  for (const act of activity) {
    const key = normalizeNoestEventKey(
      act.event_key || act.event || act.status || act.label || ""
    );
    if (!newest) newest = { event_key: key, event_name: act.event, date: act.date };
    if (EVENT_STATUS_MAP[key]) {
      return { event_key: key, event_name: act.event, date: act.date };
    }
  }
  return newest;
}

// Ask Noest about MANY parcels at once. get/trackings/info accepts an array,
// so we request in chunks (≈6 calls for 300 orders) instead of one call each.
// Returns Map<tracking_number, resolvedEvent>.
async function getNoestEventsBatch(trackingNumbers) {
  const out = new Map();
  const CHUNK = 50; // well under Noest's 60 req/min limit even for thousands of orders
  for (let i = 0; i < trackingNumbers.length; i += CHUNK) {
    const batch = trackingNumbers.slice(i, i + CHUNK);
    try {
      const response = await fetch(`${NOEST_BASE}/get/trackings/info`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${noestApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ user_guid: noestGuid, trackings: batch }),
      });
      if (!response.ok) {
        console.warn(`[track-orders] batch HTTP ${response.status} for ${batch.length} trackings`);
        continue;
      }
      const data = await response.json();
      for (const t of batch) {
        const ev = resolveActivityToEvent(data?.[t]);
        if (ev) out.set(t, ev);
      }
    } catch (err) {
      console.error(`[track-orders] batch error:`, err.message);
    }
  }
  return out;
}

function parseNoestDate(value) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeNoestEventKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ÃÂ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\s\-\/]+/g, "_")
    .replace(/[^\p{L}\p{N}_]+/gu, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}
async function sendNtfyNotification(topic, title, message) {
  try {
    await fetch(`https://ntfy.sh/${topic}`, {
      method: "POST",
      headers: {
        "Title": title,
        "Priority": "high",
        "Tags": "white_check_mark",
      },
      body: message,
    });
    console.log(`[ntfy] Sent to ${topic}: ${title}`);
  } catch (err) {
    console.error(`[ntfy] Failed:`, err.message);
  }
}

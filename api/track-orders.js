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

    // Track each order
    for (const order of orders) {
      try {
        const latestEvent = await getLatestNoestEvent(order.tracking_number);

        if (!latestEvent) {
          console.warn(
            `[track-orders] No event from Noest for ${order.tracking_number} (${order.order_id})`
          );
          continue;
        }

        const newStatus = EVENT_STATUS_MAP[latestEvent.event_key];

        // Only update if we care about this event
        if (!newStatus) {
          console.log(
            `[track-orders] ~ ${order.order_id}: ignoring event "${latestEvent.event_key}"`
          );
          continue;
        }

        // Only update if status actually changed
        if (newStatus !== order.status) {
          console.log(
            `[track-orders] ✓ ${order.order_id}: "${order.status}" → "${newStatus}" (event: ${latestEvent.event_key})`
          );

          // Update orders table
          const { error: updateError } = await supabase
            .from("orders")
            .update({
              status: newStatus,
              updated_at: timestamp,
            })
            .eq("id", order.id);

          if (updateError) {
            console.error(`[track-orders] Update failed for ${order.order_id}:`, updateError);
            errors++;
            continue;
          }

          // Log to order_history
          const { error: historyError } = await supabase
            .from("order_history")
            .insert({
              order_id: order.order_id,
              old_status: order.status,
              new_status: newStatus,
              field_name: null,
              changed_by: "auto_tracker",
              changed_at: timestamp,
            });

          if (historyError) {
            console.error(`[track-orders] History log failed for ${order.order_id}:`, historyError);
            errors++;
            continue;
          }

          updated++;
          updates.push({
            order_id: order.order_id,
            from: order.status,
            to: newStatus,
            event: latestEvent.event_key,
          });

          // Log special events
          if (newStatus === "delivered") {
            console.log(`[track-orders] 💰 Order ${order.order_id} delivered — Employee 3 eligible for 150 DZD`);
            await sendNtfyNotification(
              "arco-delivered",
              `✅ Order Delivered`,
              `${order.order_id} — ${order.prix_total || ''} DZD`
            );
          } else if (newStatus === "canceled") {
            console.log(`[track-orders] ⚠️ Order ${order.order_id} returned/canceled`);
          }
        }
      } catch (err) {
        console.error(`[track-orders] Error processing ${order.order_id}:`, err.message);
        errors++;
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
async function getLatestNoestEvent(trackingNumber) {
  try {
    const response = await fetch(`${NOEST_BASE}/get/trackings/info`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${noestApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_guid: noestGuid,   // REQUIRED by Noest — was missing, caused empty results
        trackings: [trackingNumber],
      }),
    });

    if (!response.ok) {
      console.warn(`[getLatestNoestEvent] HTTP ${response.status} for ${trackingNumber}`);
      return null;
    }

    const data = await response.json();
    const orderData = data[trackingNumber];

    if (!orderData || !Array.isArray(orderData.activity) || orderData.activity.length === 0) {
      console.warn(`[getLatestNoestEvent] No activity for ${trackingNumber}`);
      return null;
    }

    // Sort the full activity history newest-first.
    const activity = [...orderData.activity].sort(
      (a, b) => parseNoestDate(b?.date) - parseNoestDate(a?.date)
    );

    // Walk newest → oldest and return the most recent event that maps to a
    // status we track. This skips post-delivery noise (e.g. "Amount
    // transmitted to partner") that would otherwise hide the real
    // delivered/returned outcome sitting one line below it.
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

    // No mapped event found — return the newest raw event (handler ignores it).
    return newest;
  } catch (err) {
    console.error(`[getLatestNoestEvent] Error for ${trackingNumber}:`, err.message);
    return null;
  }
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

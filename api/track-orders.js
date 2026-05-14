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
 * Map Noest event keys to ARCO order statuses
 * Only tracks the 5 important events
 */
const EVENT_STATUS_MAP = {
  validation_reception: "shipping",      // Picked up by driver
  fdr_activated: "shipping",             // Out for delivery
  livre: "delivered",                    // Delivered
  livred: "delivered",                   // Delivered (alternate)
  colis_suspendu: "suspended",           // Suspended
  return_asked_by_customer: "canceled",  // Return requested
  return_asked_by_hub: "canceled",       // Return in transit
  retour_dispatched_to_partenaires: "canceled",  // Return dispatched
  livraison_echoue_recu: "canceled",     // Return received
};

/**
 * Statuses that are terminal (don't need tracking anymore)
 */
const TERMINAL_STATUSES = [
  "delivered",
  "canceled",
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
        trackings: [trackingNumber],
      }),
      timeout: 5000,
    });

    if (!response.ok) {
      console.warn(`[getLatestNoestEvent] HTTP ${response.status} for ${trackingNumber}`);
      return null;
    }

    const data = await response.json();
    const orderData = data[trackingNumber];

    if (!orderData || !orderData.activity || orderData.activity.length === 0) {
      console.warn(`[getLatestNoestEvent] No activity for ${trackingNumber}`);
      return null;
    }

    // Get the LATEST event (first in array = most recent)
    const latestActivity = orderData.activity[0];

    return {
      event_key: latestActivity.event_key || latestActivity.event,
      event_name: latestActivity.event,
      date: latestActivity.date,
    };
  } catch (err) {
    console.error(`[getLatestNoestEvent] Error for ${trackingNumber}:`, err.message);
    return null;
  }
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

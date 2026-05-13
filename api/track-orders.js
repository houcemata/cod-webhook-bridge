/**
 * api/track-orders.js
 * 
 * Auto-tracking system for ARCO COD CRM
 * Polls Noest Express API every 30 minutes (via pg_cron)
 * Updates order statuses + logs changes to order_history
 * 
 * Integration points:
 * - operator.html: Displays updated statuses in real-time
 * - admin.html: Finance tab counts delivered orders for employee pay calculation
 * - Employee 3 (operator girl): Gets 150 DZD per delivered order
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const noestApiKey = process.env.NOEST_API_KEY;
const noestGuid = process.env.NOEST_GUID;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const NOEST_BASE = "https://app.noest-dz.com/api/public";

/**
 * Map Noest status codes to ARCO order statuses
 * These match the statuses defined in operator.html and admin.html
 */
const STATUS_MAP = {
  pending: "pending",
  in_transit: "shipped",
  delivered: "delivered",
  failed: "attempt_1",
  rescheduled: "rescheduled",
  cancelled: "canceled",
};

/**
 * Statuses that are considered "terminal" (don't need tracking anymore)
 */
const TERMINAL_STATUSES = [
  "delivered",
  "canceled",
  "not_delivered",
  "duplicated",
];

export default async function handler(req, res) {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  
  console.log(`[track-orders] ${timestamp} — Starting batch tracking...`);

  try {
    if (!supabaseUrl || !supabaseServiceKey || !noestApiKey || !noestGuid) {
      console.error("[track-orders] Missing required environment variables");
      return res.status(500).json({ error: "Configuration error: missing env vars" });
    }

    const { data: orders, error: fetchError } = await supabase
      .from("orders")
      .select("id, order_id, tracking_number, status")
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

    for (const order of orders) {
      try {
        const noestStatus = await getNoestStatus(order.tracking_number);

        if (!noestStatus) {
          console.warn(
            `[track-orders] No status from Noest for ${order.tracking_number} (${order.order_id})`
          );
          continue;
        }

        const newStatus = STATUS_MAP[noestStatus.status] || order.status;

        if (newStatus !== order.status) {
          console.log(
            `[track-orders] ✓ ${order.order_id}: "${order.status}" → "${newStatus}"`
          );

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
          });

          if (newStatus === "delivered") {
            console.log(`[track-orders] 💰 Order ${order.order_id} delivered — Employee 3 eligible for 150 DZD`);
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

async function getNoestStatus(trackingNumber) {
  try {
    const url = `${NOEST_BASE}/shipment/status?guid=${noestGuid}&tracking=${trackingNumber}`;
    
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${noestApiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 5000,
    });

    if (!response.ok) {
      console.warn(
        `[getNoestStatus] HTTP ${response.status} for tracking ${trackingNumber}`
      );
      return null;
    }

    const data = await response.json();

    const status = data.status || data.current_status || "pending";
    const lastUpdate = data.last_update || data.updated_at || new Date().toISOString();

    return {
      status,
      last_update: lastUpdate,
    };
  } catch (err) {
    console.error(
      `[getNoestStatus] Error querying Noest for ${trackingNumber}:`,
      err.message
    );
    return null;
  }
}
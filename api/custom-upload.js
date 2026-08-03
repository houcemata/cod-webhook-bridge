import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const MAX_FILES = 12;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function normalizeText(value) {
  return String(value || "").trim();
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function safeName(value, fallback) {
  const clean = normalizeText(value)
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return clean || fallback;
}

function imageBufferFromBase64(data) {
  const raw = normalizeText(data).replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
  const buffer = Buffer.from(raw, "base64");
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return null;
  return buffer;
}

function publicUrlForKey(key) {
  const base = normalizeText(process.env.R2_PUBLIC_BASE_URL).replace(/\/+$/, "");
  return base ? `${base}/${key}` : "";
}

function r2Client() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env("R2_ACCESS_KEY_ID"),
      secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
    },
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!sameOrigin(req)) {
    return res.status(403).json({ error: "Forbidden origin" });
  }

  try {
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    if (!files.length) return res.status(400).json({ error: "No images were uploaded" });
    if (files.length > MAX_FILES) return res.status(400).json({ error: "Too many images in one order" });

    const bucket = env("R2_BUCKET");
    const group = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const client = r2Client();
    const uploaded = [];

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i] || {};
      const type = normalizeText(file.type) || "image/jpeg";
      if (!type.startsWith("image/")) {
        return res.status(400).json({ error: `Panel ${i + 1} is not an image` });
      }
      const body = imageBufferFromBase64(file.data_base64);
      if (!body) {
        return res.status(400).json({ error: `Panel ${i + 1} image is too large or invalid` });
      }

      const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
      const key = `orders/${group}/panel-${i + 1}-${safeName(file.name, "image")}.${ext}`;
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: type,
      }));

      uploaded.push({
        index: i + 1,
        key,
        url: publicUrlForKey(key),
        name: normalizeText(file.name),
        type,
        bytes: body.length,
        panel_size: normalizeText(file.panel_size),
        note: normalizeText(file.note),
      });
    }

    return res.status(200).json({ ok: true, upload_group: group, files: uploaded });
  } catch (error) {
    console.error("[custom-upload]", error);
    return res.status(500).json({ error: "Image upload failed" });
  }
}

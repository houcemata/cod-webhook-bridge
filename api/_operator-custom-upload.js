import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
function clean(value) { return String(value ?? "").trim(); }
function safeFileName(value) { return clean(value).replace(/[^\w.\-]+/g, "-").replace(/-+/g, "-").slice(0, 80) || "custom-image"; }
function imageBufferFromBase64(data) {
  const raw = clean(data).replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
  const buffer = Buffer.from(raw, "base64");
  return buffer.length && buffer.length <= MAX_IMAGE_BYTES ? buffer : null;
}
function r2Client() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${clean(process.env.R2_ACCOUNT_ID)}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: clean(process.env.R2_ACCESS_KEY_ID), secretAccessKey: clean(process.env.R2_SECRET_ACCESS_KEY) },
  });
}
export async function uploadOperatorCustomImage(file, orderKey) {
  const type = clean(file?.type) || "image/jpeg";
  if (!type.startsWith("image/")) throw new Error("The custom upload must be an image");
  const body = imageBufferFromBase64(file?.data_base64);
  if (!body) throw new Error("The custom image is too large or invalid");
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  const key = `orders/operator-${safeFileName(orderKey)}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeFileName(file?.name)}.${ext}`;
  await r2Client().send(new PutObjectCommand({ Bucket: clean(process.env.R2_BUCKET), Key: key, Body: body, ContentType: type }));
  const base = clean(process.env.R2_PUBLIC_BASE_URL).replace(/\/+$/, "");
  return { index: 1, key, url: base ? `${base}/${key}` : "", name: clean(file?.name), type, bytes: body.length, panel_size: clean(file?.panel_size), note: clean(file?.note) };
}

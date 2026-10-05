import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "../logger";

/**
 * Blob storage for screenshots, exported reports and uploaded files (§48).
 *
 * The driver is chosen from `STORAGE_DRIVER`:
 *   local  (default) → `data/uploads` on the app server
 *   s3               → S3-compatible bucket via a signed upload URL
 *
 * `local` is honest about what it is: files stay on this instance. For a
 * multi-instance deployment, configure the bucket.
 */

export type StorageDriver = "local" | "s3" | "none";

export interface StoredBlob {
  key: string;
  url: string;
  driver: StorageDriver;
  bytes: number;
  message: string;
}

export function storageStatus(): { driver: StorageDriver; configured: boolean; missing: string[]; note: string; bucket: string | null } {
  const driver = (process.env.STORAGE_DRIVER ?? "local").toLowerCase() as StorageDriver;
  const missing: string[] = [];

  if (driver === "s3") {
    for (const name of ["STORAGE_BUCKET", "STORAGE_REGION", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY"]) {
      if (!process.env[name]) missing.push(name);
    }
  }
  if (driver === "none") missing.push("STORAGE_DRIVER");

  const note =
    driver === "local"
      ? "Files are written to data/uploads on this instance. Configure an S3-compatible bucket before running more than one instance."
      : driver === "s3"
        ? missing.length
          ? `S3 is selected but incomplete: ${missing.join(", ")}.`
          : "Uploads are written to the configured S3-compatible bucket."
        : "Storage is disabled, so screenshots and uploads will not be persisted.";

  return { driver, configured: missing.length === 0, missing, note, bucket: process.env.STORAGE_BUCKET ?? null };
}

export async function saveBlob(input: {
  orgId: string;
  key: string;
  contentType: string;
  bytes: Buffer;
}): Promise<StoredBlob> {
  const status = storageStatus();

  if (status.driver === "s3" && status.configured) {
    return saveToS3(input, status);
  }

  const root = process.env.STORAGE_LOCAL_DIR ?? path.join(process.cwd(), "data", "uploads");
  const safeKey = `${input.orgId}/${input.key.replace(/[^a-zA-Z0-9._/-]/g, "_")}`;
  const target = path.join(root, safeKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, input.bytes);
  logger.debug("storage", "Blob written to local storage", { key: safeKey, bytes: input.bytes.length });

  return {
    key: safeKey,
    url: `/api/files/${encodeURIComponent(safeKey)}`,
    driver: "local",
    bytes: input.bytes.length,
    message: "Stored on this instance. Configure an S3-compatible bucket for multi-instance deployments.",
  };
}

async function saveToS3(input: { orgId: string; key: string; contentType: string; bytes: Buffer }, status: ReturnType<typeof storageStatus>): Promise<StoredBlob> {
  const endpoint = process.env.STORAGE_ENDPOINT ?? `https://${status.bucket}.s3.${process.env.STORAGE_REGION}.amazonaws.com`;
  const key = `${input.orgId}/${input.key}`;

  const response = await fetch(`${endpoint.replace(/\/$/, "")}/${key}`, {
    method: "PUT",
    headers: {
      "content-type": input.contentType,
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
      "x-amz-date": new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""),
      ...(process.env.STORAGE_PUBLIC_BASE ? {} : {}),
    },
    body: new Uint8Array(input.bytes),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    logger.error("storage", "S3 upload failed", { status: response.status, detail });
    throw new Error(
      `The bucket rejected the upload (HTTP ${response.status}). Check STORAGE_BUCKET, STORAGE_REGION and credentials, and confirm the bucket policy allows PUT from this service. Provider said: ${detail}`,
    );
  }

  const base = process.env.STORAGE_PUBLIC_BASE ?? endpoint;
  return {
    key,
    url: `${base.replace(/\/$/, "")}/${key}`,
    driver: "s3",
    bytes: input.bytes.length,
    message: "Stored in the configured bucket.",
  };
}

/** Data-URL helper used by the concept preview so no external service is needed. */
export function placeholderSvg(label: string, colors: string[] = ["#111827", "#f5f5f7"]): string {
  const [ink, paper] = [colors[0] ?? "#111827", colors[1] ?? "#f5f5f7"];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" role="img" aria-label="${escapeXml(label)}">
  <rect width="640" height="360" fill="${paper}"/>
  <rect x="0" y="0" width="640" height="56" fill="${ink}" opacity="0.08"/>
  <rect x="24" y="20" width="120" height="16" rx="4" fill="${ink}" opacity="0.35"/>
  <rect x="24" y="96" width="380" height="26" rx="6" fill="${ink}" opacity="0.85"/>
  <rect x="24" y="136" width="300" height="14" rx="4" fill="${ink}" opacity="0.45"/>
  <rect x="24" y="160" width="260" height="14" rx="4" fill="${ink}" opacity="0.35"/>
  <rect x="24" y="196" width="140" height="36" rx="8" fill="${ink}"/>
  <rect x="440" y="88" width="176" height="144" rx="12" fill="${ink}" opacity="0.12"/>
  <text x="24" y="320" font-family="system-ui, sans-serif" font-size="13" fill="${ink}" opacity="0.6">${escapeXml(label)}</text>
</svg>`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

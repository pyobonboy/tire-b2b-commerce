import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const PRESIGNED_URL_EXPIRES_IN = 600;

export const imagePresignSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z.coerce.number().int().min(1).max(MAX_IMAGE_BYTES),
});

const extensionByContentType = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export class StorageConfigurationError extends Error {
  constructor() {
    super("STORAGE_NOT_CONFIGURED");
    this.name = "StorageConfigurationError";
  }
}

interface StorageConfig {
  client: S3Client;
  bucket: string;
  publicBaseUrl: string;
}

function getStorageConfig(): StorageConfig {
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");

  if (!bucket || !accessKeyId || !secretAccessKey || !publicBaseUrl) {
    throw new StorageConfigurationError();
  }

  const endpoint = process.env.S3_ENDPOINT?.trim() || undefined;
  const region = process.env.S3_REGION?.trim() || "auto";
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === "true";

  return {
    client: new S3Client({
      region,
      endpoint,
      forcePathStyle,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
    publicBaseUrl,
  };
}

function publicObjectUrl(baseUrl: string, key: string) {
  return `${baseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

// listingSchema's `imageUrls` (seller.ts) used to accept any `z.string().url()`
// value — in zod 4.4.3 that includes `javascript:`/`data:` URIs and any
// external host, since `.url()` only checks that the string parses as *some*
// URL, not that it points anywhere in particular. A seller could point a
// listing's images at a third-party host (tracking, hotlinking, content that
// changes after admin approval) or embed a `data:` blob straight into the
// database. This restricts a listing image URL to this app's own storage
// origin instead — the same `S3_PUBLIC_BASE_URL` that `createImagePresign`
// above hands back as the `url` for a freshly-uploaded image.
//
// TRAP 1 — do not read S3_PUBLIC_BASE_URL at module scope: it's runtime
// config, absent during `next build` (see getStorageConfig above, which
// already reads it lazily for the same reason). This function reads
// `process.env` inside its own body, so it must only ever be called at
// request time (from createSellerListing/updateSellerListing in seller.ts),
// never captured into a module-level zod schema built at import time.
//
// TRAP 2 — pre-existing URLs: a listing created before this restriction
// existed (or, in principle, one an operator hand-edited) may already hold a
// URL from a different origin. Rejecting it outright on every subsequent
// edit would mean that listing can never be saved again. `existingUrls` is
// the set of URLs already persisted on *this* listing; a URL already in that
// set is grandfathered in as-is. See updateSellerListing for how that set is
// built. createSellerListing (a brand-new listing) always passes an empty
// set, so every URL on a new listing must be on our own storage origin.
export function isAllowedListingImageUrl(url: string, existingUrls: ReadonlySet<string> = new Set()): boolean {
  if (existingUrls.has(url)) return true;

  const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (!publicBaseUrl) return false; // storage not configured -> nothing counts as "our own origin"

  let base: URL;
  let target: URL;
  try {
    base = new URL(publicBaseUrl);
    target = new URL(url);
  } catch {
    // Not a parseable absolute URL at all (or S3_PUBLIC_BASE_URL itself is
    // malformed) — reject rather than guess.
    return false;
  }

  // Compare parsed origin + path prefix, not a naive startsWith(publicBaseUrl)
  // string check — a naive prefix check would let
  // "https://cdn.example.com.evil.com/x" through against a base of
  // "https://cdn.example.com". This also transparently rejects
  // javascript:/data: URIs: their `.origin` is the literal string "null",
  // which can never equal our own https(s) origin.
  if (target.origin !== base.origin) return false;
  const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  return target.pathname === base.pathname || target.pathname.startsWith(basePath);
}

export async function createImagePresign(
  userId: string,
  data: z.infer<typeof imagePresignSchema>,
) {
  const config = getStorageConfig();
  const extension = extensionByContentType[data.contentType];
  const key = `listing-images/${userId}/${crypto.randomUUID()}.${extension}`;

  // Presigned PUT — deliberately NOT presigned POST. Cloudflare R2 (this
  // project's documented storage backend, see README) does not implement the
  // S3 POST Object API at all: its presigned-URL docs state "POST (multipart
  // form uploads via HTML forms) is not currently supported" and list only
  // GET/HEAD/PUT/DELETE (developers.cloudflare.com/r2/api/s3/presigned-urls,
  // checked 2026-08-28). An earlier revision of this file switched to
  // createPresignedPost for its content-length-range condition; on R2 that
  // fails every upload outright, so it was reverted to this approach.
  //
  // Size enforcement instead binds ContentLength into the PUT signature (via
  // signableHeaders below): R2 then rejects any request whose Content-Length
  // doesn't exactly match the `size` the client declared to the presign
  // endpoint (which imagePresignSchema caps at MAX_IMAGE_BYTES). Browsers
  // always send an exact Content-Length for a fixed-size File/Blob body, and
  // the upload goes straight from the browser to the R2 endpoint with no
  // intermediary that could rewrite the header, so the exact-match
  // requirement is safe in this deployment. Verify once against the live
  // bucket after deploying (upload one listing image as a seller/admin and
  // confirm it renders from the returned `url`).
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: data.contentType,
    ContentLength: data.size,
  });
  const uploadUrl = await getSignedUrl(config.client, command, {
    expiresIn: PRESIGNED_URL_EXPIRES_IN,
    signableHeaders: new Set(["content-length"]),
  });

  return {
    key,
    uploadUrl,
    url: publicObjectUrl(config.publicBaseUrl, key),
    contentType: data.contentType,
    contentLength: data.size,
    expiresIn: PRESIGNED_URL_EXPIRES_IN,
  };
}

import 'server-only';

/**
 * Patient file uploads.
 *
 * Until now the form accepted a photo, showed a green tick, and threw the file
 * away on submit — the worst possible failure, because the patient believes
 * they sent their exemption letter and the pharmacy never knows one was
 * offered.
 *
 * The endpoint that uses this is necessarily public: a patient completing a
 * health questionnaire has no account. So the constraints live here rather than
 * relying on the caller being trustworthy:
 *
 *   · A valid, unexpired resume token, or an authenticated member of staff.
 *     The token already scopes to exactly one submission, so an upload can only
 *     ever attach to that patient's own form.
 *   · A size ceiling, checked against the actual bytes rather than a header.
 *   · An allow-list of types, checked against the file's magic number and not
 *     its extension or its client-supplied MIME type, both of which are just
 *     strings the uploader chose.
 *   · A generated object name. Using the uploaded filename lets someone pick
 *     the path they are written to.
 *
 * The bucket is private. Nothing here ever returns a public URL; reads go
 * through a short-lived signed URL issued only to authorised staff.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const UPLOAD_BUCKET = 'patient-uploads';

/** Generous for a phone photo, mean enough to stop somebody parking a film here. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Signed read URLs live just long enough to render the page that asked. */
const SIGNED_URL_TTL_SECONDS = 300;

interface AllowedType {
  mime: string;
  extension: string;
  /** Leading bytes that identify the format regardless of what it is called. */
  magic: number[][];
}

const ALLOWED: AllowedType[] = [
  { mime: 'image/jpeg', extension: 'jpg', magic: [[0xff, 0xd8, 0xff]] },
  { mime: 'image/png', extension: 'png', magic: [[0x89, 0x50, 0x4e, 0x47]] },
  {
    mime: 'image/heic',
    extension: 'heic',
    // HEIC carries 'ftyp' at offset 4; matched below with the offset applied.
    magic: [[0x66, 0x74, 0x79, 0x70]],
  },
  { mime: 'application/pdf', extension: 'pdf', magic: [[0x25, 0x50, 0x44, 0x46]] },
];

function matches(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

/**
 * What this file actually is, from its bytes.
 *
 * A browser will happily report `image/png` for a renamed executable, so the
 * declared MIME type is treated as a hint and nothing more.
 */
export function sniffType(bytes: Uint8Array): AllowedType | null {
  for (const type of ALLOWED) {
    for (const signature of type.magic) {
      // HEIC's marker sits after a four-byte box length.
      const offset = type.mime === 'image/heic' ? 4 : 0;
      if (matches(bytes, signature, offset)) return type;
    }
  }
  return null;
}

export interface StoredFile {
  path: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
}

export interface UploadResult {
  ok: true;
  file: StoredFile;
}

export interface UploadFailure {
  ok: false;
  status: number;
  error: string;
}

export async function storeUpload(input: {
  submissionId: string;
  fieldId: string;
  file: File;
}): Promise<UploadResult | UploadFailure> {
  const { submissionId, fieldId, file } = input;

  if (file.size === 0) {
    return { ok: false, status: 400, error: 'That file is empty.' };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `That file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB. Please send a smaller photo.`,
    };
  }

  const buffer = new Uint8Array(await file.arrayBuffer());

  // Re-check the real size against the bytes we actually received rather than
  // trusting File.size, which is client-reported.
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, status: 413, error: 'That file is too large.' };
  }

  const sniffed = sniffType(buffer);
  if (!sniffed) {
    return {
      ok: false,
      status: 415,
      error: 'Please upload a photo (JPG, PNG or HEIC) or a PDF.',
    };
  }

  // Generated name, never the uploaded one — a filename is attacker-controlled
  // and would otherwise decide where the object lands.
  const objectName = `${crypto.randomUUID()}.${sniffed.extension}`;
  const path = `${submissionId}/${fieldId}/${objectName}`;

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .upload(path, buffer, { contentType: sniffed.mime, upsert: false });

  if (error) {
    console.error('storeUpload failed', error);
    return { ok: false, status: 502, error: 'We could not save that file. Please try again.' };
  }

  return {
    ok: true,
    file: {
      path,
      // Kept for display only, and never used to build a path.
      name: file.name.slice(0, 120),
      size: buffer.byteLength,
      type: sniffed.mime,
      uploadedAt: new Date().toISOString(),
    },
  };
}

/** A short-lived read URL. Only ever handed to authorised staff. */
export async function signDownload(path: string): Promise<string | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error || !data) {
    console.error('signDownload failed', error);
    return null;
  }
  return data.signedUrl;
}

/** Whether an answer value looks like a stored file rather than a raw upload. */
export function isStoredFile(value: unknown): value is StoredFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'path' in value &&
    typeof (value as StoredFile).path === 'string'
  );
}

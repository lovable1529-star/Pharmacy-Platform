/**
 * A file that made it to storage.
 *
 * Shared by the browser and the server so both agree on the shape an answer
 * takes once a file has actually been saved. The distinction matters: a raw
 * `File` in an answer means the upload has not happened yet, and submitting one
 * is how files used to be silently discarded.
 */
export interface StoredFileRef {
  path: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
}

export function isStoredFileRef(value: unknown): value is StoredFileRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StoredFileRef).path === 'string' &&
    typeof (value as StoredFileRef).name === 'string'
  );
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

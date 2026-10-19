/** Formats a byte count for display, e.g. "412 KB" or "18.4 MB". */
export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
};

/** Returns "1 file" / "3 files" (or a custom plural form). */
export const pluralize = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count.toLocaleString('en-US')} ${count === 1 ? singular : plural}`;

/** Whole-number percentage of `original` that was removed. Safe when `original` is 0. */
export const percentRemoved = (removed: number, original: number): number =>
  original > 0 ? Math.round((removed / original) * 100) : 0;

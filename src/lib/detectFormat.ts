/**
 * Best-effort detection of a timeline JSON file's format, used to label files
 * before processing. `pre2024` = Takeout `timelineObjects`; `current` = the 2024+
 * phone export (a top-level array or `semanticSegments`). `unverified` means the
 * file looks like JSON but the format marker was not within the sampled bytes.
 */
export type FileFormat = 'pre2024' | 'current' | 'unknown' | 'unverified';

/** How much of each file is sampled, so large exports are never fully parsed twice. */
export const SNIFF_BYTES = 64 * 1024;

const BYTE_ORDER_MARK = 0xfeff;

const stripBom = (text: string): string =>
  (text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text).trimStart();

const classifyParsed = (data: unknown): FileFormat => {
  if (Array.isArray(data)) return 'current';
  if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    if (obj.semanticSegments) return 'current';
    if (obj.timelineObjects) return 'pre2024';
  }
  return 'unknown';
};

/**
 * Classifies the leading text of a file. When `isComplete` is true the text is the
 * whole file, so the result is definitive; otherwise a missing marker is `unverified`.
 * The checks mirror the order used when processing (array / semanticSegments first).
 */
export const classifyHead = (head: string, isComplete: boolean): FileFormat => {
  const text = stripBom(head);

  if (isComplete) {
    try {
      return classifyParsed(JSON.parse(text));
    } catch {
      return 'unknown';
    }
  }

  if (text.startsWith('[') || /"semanticSegments"\s*:/.test(text)) return 'current';
  if (/"timelineObjects"\s*:/.test(text)) return 'pre2024';
  return 'unverified';
};

export const sniffFileFormat = async (file: File): Promise<FileFormat> => {
  try {
    const head = await file.slice(0, SNIFF_BYTES).text();
    return classifyHead(head, file.size <= SNIFF_BYTES);
  } catch {
    return 'unverified';
  }
};

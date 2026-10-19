import { describe, expect, it } from 'vitest';
import { formatFileSize, percentRemoved, pluralize } from './format';

describe('formatFileSize', () => {
  it('formats bytes, kilobytes, megabytes and gigabytes', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1023)).toBe('1023 B');
    expect(formatFileSize(412 * 1024)).toBe('412 KB');
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatFileSize(18.4 * 1024 * 1024)).toBe('18.4 MB');
    expect(formatFileSize(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB');
  });
});

describe('pluralize', () => {
  it('uses the singular only for exactly one', () => {
    expect(pluralize(1, 'file')).toBe('1 file');
    expect(pluralize(0, 'file')).toBe('0 files');
    expect(pluralize(6, 'file')).toBe('6 files');
  });

  it('formats large counts with separators and supports custom plurals', () => {
    expect(pluralize(5875, 'record')).toBe('5,875 records');
    expect(pluralize(2, 'entry', 'entries')).toBe('2 entries');
  });
});

describe('percentRemoved', () => {
  it('rounds to a whole percentage', () => {
    expect(percentRemoved(8355, 14230)).toBe(59);
    expect(percentRemoved(0, 100)).toBe(0);
    expect(percentRemoved(100, 100)).toBe(100);
  });

  it('returns 0 instead of NaN when there were no original records', () => {
    expect(percentRemoved(0, 0)).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { SNIFF_BYTES, classifyHead, sniffFileFormat } from './detectFormat';

describe('classifyHead (complete file)', () => {
  it('detects the old Takeout format', () => {
    expect(classifyHead('{"timelineObjects": []}', true)).toBe('pre2024');
  });

  it('detects the 2024+ formats (semanticSegments object and top-level array)', () => {
    expect(classifyHead('{"semanticSegments": []}', true)).toBe('current');
    expect(classifyHead('[{"startTime":"x"}]', true)).toBe('current');
  });

  it('treats other JSON and invalid JSON as unknown', () => {
    expect(classifyHead('{"title":"notes","items":[]}', true)).toBe('unknown');
    expect(classifyHead('not json', true)).toBe('unknown');
    expect(classifyHead('null', true)).toBe('unknown');
  });

  it('ignores a leading BOM and whitespace', () => {
    const bom = String.fromCharCode(0xfeff);
    expect(classifyHead(`${bom}  \n{"timelineObjects": []}`, true)).toBe('pre2024');
  });

  it('prefers semanticSegments over timelineObjects, matching processing order', () => {
    expect(classifyHead('{"semanticSegments":[],"timelineObjects":[]}', true)).toBe('current');
  });
});

describe('classifyHead (truncated sample)', () => {
  it('finds format markers in the sampled text', () => {
    expect(classifyHead('{\n  "timelineObjects" : [{"placeVisit":', false)).toBe('pre2024');
    expect(classifyHead('{"semanticSegments":[{"startTime":', false)).toBe('current');
    expect(classifyHead('[{"startTime":"2024-01-01', false)).toBe('current');
  });

  it('does not claim an error when the marker is simply not in the sample', () => {
    expect(classifyHead('{"rawSignals":[{"position":', false)).toBe('unverified');
  });
});

describe('sniffFileFormat', () => {
  it('classifies a small file definitively', async () => {
    const file = new File(['{"timelineObjects":[]}'], '2018_JANUARY.json');
    expect(await sniffFileFormat(file)).toBe('pre2024');
    expect(await sniffFileFormat(new File(['{"a":1}'], 'notes.json'))).toBe('unknown');
  });

  it('only samples the start of a large file', async () => {
    const filler = ' '.repeat(SNIFF_BYTES);
    const markerInSample = new File([`{"semanticSegments":[]${filler}}`], 'Timeline.json');
    expect(await sniffFileFormat(markerInSample)).toBe('current');

    const markerBeyondSample = new File([`{"rawSignals":[]${filler},"semanticSegments":[]}`], 'Timeline.json');
    expect(await sniffFileFormat(markerBeyondSample)).toBe('unverified');
  });
});

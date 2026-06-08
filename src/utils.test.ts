import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { convertToKML, type TimelineObject } from './utils.ts';

describe('convertToKML', () => {
  test('should generate a valid KML for a single place visit', () => {
    const data: TimelineObject[] = [
      {
        placeVisit: {
          location: {
            latitudeE7: 407127760,
            longitudeE7: -740059740,
            name: 'Statue of Liberty',
            address: 'New York, NY 10004, USA'
          },
          duration: {
            startTimestamp: '2023-01-01T10:00:00Z',
            endTimestamp: '2023-01-01T12:00:00Z'
          },
          centerLatE7: 407127760,
          centerLngE7: -740059740,
          visitConfidence: 100
        }
      }
    ];

    const kml = convertToKML(data);

    assert.ok(kml.includes('<name>Statue of Liberty</name>'));
    assert.ok(kml.includes('<coordinates>-74.005974,40.712776,0</coordinates>'));
    assert.ok(kml.includes('New York, NY 10004, USA'));
    assert.ok(kml.includes('Start: 2023-01-01T10:00:00Z'));
    assert.ok(kml.includes('End: 2023-01-01T12:00:00Z'));
    assert.ok(kml.startsWith('<?xml'));
    assert.ok(kml.endsWith('</kml>'));
  });

  test('should escape special characters in location names', () => {
    const data: TimelineObject[] = [
      {
        placeVisit: {
          location: {
            latitudeE7: 0,
            longitudeE7: 0,
            name: 'Ben & Jerry\'s <Ice Cream>',
          },
          duration: { startTimestamp: '', endTimestamp: '' },
          centerLatE7: 0,
          centerLngE7: 0,
          visitConfidence: 0
        }
      }
    ];

    const kml = convertToKML(data);
    assert.ok(kml.includes('<name>Ben &amp; Jerry&apos;s &lt;Ice Cream&gt;</name>'));
  });

  test('should use "Unknown Location" when name is missing', () => {
    const data: TimelineObject[] = [
      {
        placeVisit: {
          location: {
            latitudeE7: 0,
            longitudeE7: 0,
          },
          duration: { startTimestamp: '', endTimestamp: '' },
          centerLatE7: 0,
          centerLngE7: 0,
          visitConfidence: 0
        }
      }
    ];

    const kml = convertToKML(data);
    assert.ok(kml.includes('<name>Unknown Location</name>'));
  });

  test('should ignore activitySegment objects', () => {
    const data: TimelineObject[] = [
      {
        activitySegment: {
          startLocation: { latitudeE7: 1, longitudeE7: 1 },
          endLocation: { latitudeE7: 2, longitudeE7: 2 },
          duration: { startTimestamp: 'T1', endTimestamp: 'T2' }
        }
      }
    ];

    const kml = convertToKML(data);
    // Document should be empty except for the header/footer
    assert.ok(!kml.includes('<Placemark>'));
  });

  test('should handle multiple place visits', () => {
    const data: TimelineObject[] = [
      {
        placeVisit: {
          location: { latitudeE7: 10, longitudeE7: 20, name: 'Place 1' },
          duration: { startTimestamp: 'T1', endTimestamp: 'T2' },
          centerLatE7: 10, centerLngE7: 20, visitConfidence: 1
        }
      },
      {
        placeVisit: {
          location: { latitudeE7: 30, longitudeE7: 40, name: 'Place 2' },
          duration: { startTimestamp: 'T3', endTimestamp: 'T4' },
          centerLatE7: 30, centerLngE7: 40, visitConfidence: 1
        }
      }
    ];

    const kml = convertToKML(data);
    const placemarkCount = (kml.match(/<Placemark>/g) || []).length;
    assert.equal(placemarkCount, 2);
    assert.ok(kml.includes('Place 1'));
    assert.ok(kml.includes('Place 2'));
  });
});

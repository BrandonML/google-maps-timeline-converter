import React, { useState } from 'react';
import { Upload, Download, MapPin, Activity, FileJson, FileText, Map, Info } from 'lucide-react';

interface Location {
  latitudeE7: number;
  longitudeE7: number;
  placeId?: string;
  name?: string;
  address?: string;
  semanticType?: string;
}

interface Duration {
  startTimestamp: string;
  endTimestamp: string;
}

interface PlaceVisit {
  location: Location;
  duration: Duration;
  centerLatE7: number;
  centerLngE7: number;
  visitConfidence: number;
}

interface ActivitySegment {
  startLocation: Partial<Location>;
  endLocation: Partial<Location>;
  duration: Duration;
  distance?: number;
  activities?: { activityType: string; probability: number }[];
}

interface TimelineObject {
  placeVisit?: PlaceVisit;
  activitySegment?: ActivitySegment;
}

interface Results {
  oldFormatJson: string;
  csv: string;
  kml: string;
  visitCount: number;
  activityCount: number;
  totalCount: number;
  originalCount: number;
  cleaningStats: {
    removedActivities: number;
    removedDuplicates: number;
    totalRemoved: number;
  };
}

export default function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeActivities, setRemoveActivities] = useState(true);
  const [removeDuplicates, setRemoveDuplicates] = useState(true);

  const parseLatLng = (latLngStr?: string): { lat: number; lng: number } => {
    if (!latLngStr) return { lat: 0, lng: 0 };
    const parts = latLngStr.replace('°', '').split(', ');
    return {
      lat: parseFloat(parts[0]),
      lng: parseFloat(parts[1])
    };
  };

  const convertNewToOld = (newData: any): { timelineObjects: TimelineObject[] } => {
    const timelineObjects: TimelineObject[] = [];
    const segments = newData.semanticSegments || [];

    segments.forEach((segment: any) => {
      if (segment.visit) {
        const visit = segment.visit;
        const topCandidate = visit.topCandidate || {};
        const placeLocation = topCandidate.placeLocation || {};
        const { lat, lng } = parseLatLng(placeLocation.latLng);

        timelineObjects.push({
          placeVisit: {
            location: {
              latitudeE7: Math.round(lat * 1e7),
              longitudeE7: Math.round(lng * 1e7),
              placeId: topCandidate.placeId || '',
              name: placeLocation.name || '',
              address: placeLocation.address || '',
              semanticType: topCandidate.semanticType || 'TYPE_UNKNOWN'
            },
            duration: {
              startTimestamp: segment.startTime,
              endTimestamp: segment.endTime
            },
            centerLatE7: Math.round(lat * 1e7),
            centerLngE7: Math.round(lng * 1e7),
            visitConfidence: Math.round((visit.probability || 0) * 100)
          }
        });
      } else if (segment.activity) {
        const activity = segment.activity;
        const startCoords = parseLatLng(activity.start?.latLng);
        const endCoords = parseLatLng(activity.end?.latLng);
        const topCandidate = activity.topCandidate || {};

        const activities = topCandidate.type ? [{
          activityType: topCandidate.type,
          probability: topCandidate.probability || 0
        }] : [];

        timelineObjects.push({
          activitySegment: {
            startLocation: {
              latitudeE7: Math.round(startCoords.lat * 1e7),
              longitudeE7: Math.round(startCoords.lng * 1e7)
            },
            endLocation: {
              latitudeE7: Math.round(endCoords.lat * 1e7),
              longitudeE7: Math.round(endCoords.lng * 1e7)
            },
            duration: {
              startTimestamp: segment.startTime,
              endTimestamp: segment.endTime
            },
            distance: activity.distanceMeters || 0,
            activities: activities
          }
        });
      } else if (segment.timelinePath) {
        const path = segment.timelinePath;
        if (path.length > 0) {
          const firstPoint = parseLatLng(path[0].point);
          const lastPoint = parseLatLng(path[path.length - 1].point);

          timelineObjects.push({
            activitySegment: {
              startLocation: {
                latitudeE7: Math.round(firstPoint.lat * 1e7),
                longitudeE7: Math.round(firstPoint.lng * 1e7)
              },
              endLocation: {
                latitudeE7: Math.round(lastPoint.lat * 1e7),
                longitudeE7: Math.round(lastPoint.lng * 1e7)
              },
              duration: {
                startTimestamp: segment.startTime,
                endTimestamp: segment.endTime
              }
            }
          });
        }
      }
    });

    return { timelineObjects };
  };

  const cleanData = (timelineObjects: TimelineObject[]) => {
    let cleaned = [...timelineObjects];
    let removedActivities = 0;
    let removedDuplicates = 0;

    if (removeActivities) {
      const beforeCount = cleaned.length;
      cleaned = cleaned.filter((obj): obj is { placeVisit: PlaceVisit } => !!obj.placeVisit);
      removedActivities = beforeCount - cleaned.length;
    }

    if (removeDuplicates) {
      const seenPlaceIds = new Set();
      const seenLatLngs = new Set();
      const beforeCount = cleaned.length;

      cleaned = cleaned.filter((obj) => {
        if (!obj.placeVisit) return true;

        const loc = obj.placeVisit.location;
        const hasAddress = loc.address && loc.address.trim() !== '';

        if (hasAddress) return true;

        if (loc.placeId && loc.placeId.trim() !== '') {
          if (seenPlaceIds.has(loc.placeId)) {
            return false;
          }
          seenPlaceIds.add(loc.placeId);
        }

        const latLngKey = `${loc.latitudeE7},${loc.longitudeE7}`;
        if (seenLatLngs.has(latLngKey)) {
          return false;
        }
        seenLatLngs.add(latLngKey);

        return true;
      });

      removedDuplicates = beforeCount - cleaned.length;
    }

    return {
      cleaned,
      stats: {
        removedActivities,
        removedDuplicates,
        totalRemoved: removedActivities + removedDuplicates
      }
    };
  };

  const convertToCSV = (data: { timelineObjects: TimelineObject[] }): string => {
    const rows: (string | number)[][] = [];
    rows.push(['Type', 'Name', 'Address', 'Latitude', 'Longitude', 'Start Time', 'End Time', 'PlaceId']);

    data.timelineObjects.forEach((obj) => {
      if (obj.placeVisit) {
        const pv = obj.placeVisit;
        const loc = pv.location;
        rows.push([
          'Visit',
          loc.name || '',
          loc.address || '',
          loc.latitudeE7 / 1e7,
          loc.longitudeE7 / 1e7,
          pv.duration.startTimestamp,
          pv.duration.endTimestamp,
          loc.placeId || ''
        ]);
      } else if (obj.activitySegment) {
        const as = obj.activitySegment;
        const actType = as.activities?.[0]?.activityType || 'UNKNOWN';
        rows.push([
          'Activity',
          actType,
          '',
          (as.startLocation.latitudeE7 ?? 0) / 1e7,
          (as.startLocation.longitudeE7 ?? 0) / 1e7,
          as.duration.startTimestamp,
          as.duration.endTimestamp,
          ''
        ]);
      }
    });

    return rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  };

  const convertToKML = (data: { timelineObjects: TimelineObject[] }): string => {
    let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Timeline Data</name>
    <Style id="visit">
      <IconStyle>
        <color>ff0000ff</color>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/pushpin/red-pushpin.png</href>
        </Icon>
      </IconStyle>
    </Style>
`;

    data.timelineObjects.forEach((obj) => {
      if (obj.placeVisit) {
        const pv = obj.placeVisit;
        const loc = pv.location;
        const lat = loc.latitudeE7 / 1e7;
        const lng = loc.longitudeE7 / 1e7;
        const name = loc.name || 'Unknown Location';
        const address = loc.address || '';

        kml += `    <Placemark>
      <name>${name}</name>
      <description>${address}
Start: ${pv.duration.startTimestamp}
End: ${pv.duration.endTimestamp}</description>
      <styleUrl>#visit</styleUrl>
      <Point>
        <coordinates>${lng},${lat},0</coordinates>
      </Point>
    </Placemark>
`;
      }
    });

    kml += `  </Document>
</kml>`;
    return kml;
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files ? Array.from(e.target.files) : [];
    setFiles(prevFiles => [...prevFiles, ...uploadedFiles]);
    setError(null);
    setResults(null);
  };

  const clearFiles = () => {
    setFiles([]);
    setError(null);
    setResults(null);
  };

  const processFiles = async () => {
    if (files.length === 0) {
      setError('Please upload at least one file');
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      let combinedTimelineObjects: TimelineObject[] = [];

      for (const file of files) {
        const text = await file.text();
        const data = JSON.parse(text);

        if (data.semanticSegments) {
          const converted = convertNewToOld(data);
          combinedTimelineObjects = [...combinedTimelineObjects, ...converted.timelineObjects];
        } else if (data.timelineObjects) {
          combinedTimelineObjects = [...combinedTimelineObjects, ...data.timelineObjects];
        } else {
          throw new Error(`File ${file.name} has unrecognized format`);
        }
      }

      const { cleaned, stats } = cleanData(combinedTimelineObjects);
      const finalData = { timelineObjects: cleaned };

      const csv = convertToCSV(finalData);
      const kml = convertToKML(finalData);

      setResults({
        oldFormatJson: JSON.stringify(finalData, null, 2),
        csv,
        kml,
        visitCount: cleaned.filter(o => o.placeVisit).length,
        activityCount: cleaned.filter(o => o.activitySegment).length,
        totalCount: cleaned.length,
        originalCount: combinedTimelineObjects.length,
        cleaningStats: stats
      });
    } catch (err: any) {
      setError(`Error processing files: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-xl p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-6">
            <MapPin className="w-8 h-8 text-indigo-600" />
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Google Timeline Converter</h1>
          </div>

          <div className="mb-8 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <h2 className="font-semibold text-blue-900 mb-2">How to use:</h2>
            <ol className="list-decimal list-inside space-y-1 text-sm text-blue-800">
              <li>Export your data from <a href="https://takeout.google.com/" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-600">Google Takeout</a> (select only Location History, format JSON).</li>
              <li>Unzip the file and find your `Timeline.json` file(s) inside the `Location History` folder.</li>
              <li>Upload your `Timeline.json` file(s) below.</li>
              <li>Choose your data cleaning preferences.</li>
              <li>Click "Process Files" and download the results.</li>
            </ol>
          </div>

          <div className="mb-6">
            <label className="block mb-4 font-semibold text-gray-700">
              <Upload className="inline w-5 h-5 mr-2" />
              Upload Timeline Files
            </label>
            <input
              type="file"
              multiple
              accept=".json"
              onChange={handleFileUpload}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
            />
            {files.length > 0 && (
              <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-sm font-semibold text-gray-700">
                    {files.length} file(s) selected:
                  </p>
                  <button
                    onClick={clearFiles}
                    className="text-xs text-red-600 hover:text-red-800 font-semibold"
                  >
                    Clear All
                  </button>
                </div>
                <ul className="text-xs text-gray-600 space-y-1 max-h-32 overflow-y-auto">
                  {files.map((f, i) => (
                    <li key={i} className="truncate">• {f.name}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="font-semibold text-gray-700 mb-3">Data Cleaning Options</h3>

            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="removeActivities"
                  checked={removeActivities}
                  onChange={(e) => setRemoveActivities(e.target.checked)}
                  className="mt-1 w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <label htmlFor="removeActivities" className="text-sm font-medium text-gray-700 cursor-pointer">
                      Remove activity records
                    </label>
                    <div className="relative group">
                      <Info
                        className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help"
                      />
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-gray-800 text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        Removes all "Activity" type records (like driving, walking segments), keeping only "Visit" records which represent actual locations you stayed at. This significantly reduces record count.
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="removeDuplicates"
                  checked={removeDuplicates}
                  onChange={(e) => setRemoveDuplicates(e.target.checked)}
                  className="mt-1 w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <label htmlFor="removeDuplicates" className="text-sm font-medium text-gray-700 cursor-pointer">
                      Remove duplicates
                    </label>
                    <div className="relative group">
                      <Info
                        className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help"
                      />
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-gray-800 text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        Removes duplicate visits based on PlaceId or Lat/Long coordinates, but ONLY when the Address field is blank. Records with addresses are always preserved as they contain valuable information.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={processFiles}
            disabled={processing || files.length === 0}
            className="w-full bg-indigo-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {processing ? (
              <><svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>Processing...</>
            ) : 'Process Files'}
          </button>

          {error && (
            <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {error}
            </div>
          )}

          {results && (
            <div className="mt-8 space-y-4 animate-fade-in">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <div className="flex items-center gap-2 mb-1">
                    <FileJson className="w-5 h-5 text-blue-600" />
                    <span className="text-sm font-semibold text-blue-900">Original Records</span>
                  </div>
                  <p className="text-2xl font-bold text-blue-700">{results.originalCount}</p>
                </div>
                <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                  <div className="flex items-center gap-2 mb-1">
                    <FileJson className="w-5 h-5 text-green-600" />
                    <span className="text-sm font-semibold text-green-900">Final Records</span>
                  </div>
                  <p className="text-2xl font-bold text-green-700">{results.totalCount}</p>
                </div>
              </div>

              {results.cleaningStats.totalRemoved > 0 && (
                <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-200">
                  <h3 className="font-semibold text-indigo-900 mb-2">Cleaning Summary</h3>
                  <div className="text-sm text-indigo-800 space-y-1">
                    {results.cleaningStats.removedActivities > 0 && (
                      <p>• Removed {results.cleaningStats.removedActivities} activity records</p>
                    )}
                    {results.cleaningStats.removedDuplicates > 0 && (
                      <p>• Removed {results.cleaningStats.removedDuplicates} duplicate visits</p>
                    )}
                    <p className="font-semibold pt-1">Total removed: {results.cleaningStats.totalRemoved} records ({Math.round(results.cleaningStats.totalRemoved / results.originalCount * 100)}%)</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                  <div className="flex items-center gap-2 mb-1">
                    <MapPin className="w-5 h-5 text-green-600" />
                    <span className="text-sm font-semibold text-green-900">Visits</span>
                  </div>
                  <p className="text-2xl font-bold text-green-700">{results.visitCount}</p>
                </div>
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <div className="flex items-center gap-2 mb-1">
                    <Activity className="w-5 h-5 text-blue-600" />
                    <span className="text-sm font-semibold text-blue-900">Activities</span>
                  </div>
                  <p className="text-2xl font-bold text-blue-700">{results.activityCount}</p>
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <Download className="w-5 h-5" />
                  Download Converted Files
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <button
                    onClick={() => downloadFile(results.oldFormatJson, 'timeline_converted.json', 'application/json')}
                    className="flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 px-4 rounded-lg transition-colors"
                  >
                    <FileJson className="w-4 h-4" />
                    JSON
                  </button>
                  <button
                    onClick={() => downloadFile(results.csv, 'timeline_converted.csv', 'text/csv')}
                    className="flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 px-4 rounded-lg transition-colors"
                  >
                    <FileText className="w-4 h-4" />
                    CSV
                  </button>
                  <button
                    onClick={() => downloadFile(results.kml, 'timeline_converted.kml', 'application/vnd.google-earth.kml+xml')}
                    className="flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 px-4 rounded-lg transition-colors"
                  >
                    <Map className="w-4 h-4" />
                    KML
                  </button>
                </div>
              </div>

              {results.totalCount > 2000 && (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm">
                  <strong>Note:</strong> You have {results.totalCount} records. Google My Maps limits imports to 2,000 rows.
                  Consider enabling the data cleaning options above to reduce the record count, or manually filter your CSV by removing less important local visits.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 text-center text-sm text-gray-600">
          <p>This tool converts new Timeline.json format to the old format and merges multiple files.</p>
          <p className="mt-1">All processing happens in your browser - your data never leaves your device.</p>
        </div>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { Upload, Download, MapPin, Activity, FileJson, FileText, Map, Info, AlertCircle } from 'lucide-react';

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
  const [showInfo, setShowInfo] = useState(true);

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
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-xl shadow-lg p-8">
          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <MapPin className="w-10 h-10 text-blue-600 flex-shrink-0" />
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Google Timeline Converter</h1>
              <p className="text-base text-gray-600 mt-1">Merge, clean, and convert your location history</p>
            </div>
          </div>

          {/* What This Does Section */}
          {showInfo && (
            <div className="mb-8 p-6 bg-gray-50 rounded-lg border border-gray-200">
              <button
                onClick={() => setShowInfo(false)}
                className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-lg"
                aria-label="Close info"
              >
                ✕
              </button>

              <h2 className="font-bold text-gray-900 mb-4 text-xl flex items-center gap-2">
                <AlertCircle className="w-6 h-6" />
                What Does This App Do?
              </h2>

              <div className="space-y-4 text-base text-gray-800 leading-relaxed">
                <p>
                  <strong className="text-gray-900">The Problem:</strong> In 2024, Google changed how Timeline data is stored and exported.
                  The new format is incompatible with the old format, making it impossible to see your complete location history in one place.
                </p>

                <p>
                  <strong className="text-gray-900">The Solution:</strong> This app converts both formats and merges them into one unified file you can actually use.
                </p>

                <div className="bg-white p-4 rounded border border-gray-200 mt-4">
                  <p className="font-semibold mb-3 text-gray-900">Common Use Cases:</p>
                  <ul className="space-y-2 ml-6 list-disc text-base">
                    <li>You had multiple Google accounts (personal + work) and want to combine their location histories</li>
                    <li>You want to create a visual map of everywhere you've traveled</li>
                    <li>You need to reduce thousands of records to under 2,000 for Google My Maps import</li>
                    <li>You switched phones/accounts and want to keep a complete history</li>
                  </ul>
                </div>

                <div className="bg-white p-4 rounded border border-gray-200">
                  <p className="font-semibold mb-3 text-gray-900">What You Can Do With Your Converted Data:</p>
                  <ul className="space-y-2 ml-6 list-disc text-base">
                    <li><strong className="text-gray-900">Create a custom travel map</strong> in Google My Maps showing every place you've visited</li>
                    <li><strong className="text-gray-900">Track business travel</strong> for expense reports or tax documentation</li>
                    <li><strong className="text-gray-900">Analyze patterns</strong> in a spreadsheet (most visited cities, travel frequency, etc.)</li>
                    <li><strong className="text-gray-900">Create a visual timeline</strong> of your life's journey to share with family</li>
                    <li><strong className="text-gray-900">Keep a permanent backup</strong> of your location history in a usable format</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {!showInfo && (
            <button
              onClick={() => setShowInfo(true)}
              className="mb-8 text-base text-blue-600 hover:text-blue-800 flex items-center gap-2 font-medium"
            >
              <Info className="w-5 h-5" />
              Show information about this app
            </button>
          )}

          {/* Step-by-Step Instructions */}
          <div className="mb-12 p-6 bg-gray-50 rounded-lg border border-gray-200">
            <h2 className="font-bold text-gray-900 mb-6 text-xl">📋 Step-by-Step Instructions</h2>

            <div className="space-y-6 text-base text-gray-800 leading-relaxed">
              <div>
                <h3 className="font-semibold mb-3 text-lg text-gray-900">Step 1: Get Your OLD Timeline Data (Pre-2024)</h3>
                <ol className="list-decimal list-inside space-y-2 ml-4">
                  <li>Go to <a href="https://takeout.google.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 underline">Google Takeout</a></li>
                  <li>Click "Deselect all" then check only "Location History"</li>
                  <li>Click "Next step" → "Create export"</li>
                  <li>Download the zip file and extract it</li>
                  <li>Navigate to: <code className="bg-gray-100 px-2 py-1 rounded text-sm font-mono">Location History\Semantic Location History\YEAR\</code></li>
                  <li>You'll find files like <code className="bg-gray-100 px-2 py-1 rounded text-sm font-mono">2018_JANUARY.json</code>, <code className="bg-gray-100 px-2 py-1 rounded text-sm font-mono">2018_FEBRUARY.json</code>, etc.</li>
                </ol>
              </div>

              <div>
                <h3 className="font-semibold mb-3 text-lg text-gray-900">Step 2: Get Your NEW Timeline Data (2024+)</h3>
                <p className="mb-3 text-base"><strong className="text-red-600">⚠️ Important:</strong> This data is ONLY on your phone and can't be downloaded from Google Takeout!</p>
                <ol className="list-decimal list-inside space-y-2 ml-4">
                  <li>On your Android phone: Open <strong>Settings</strong></li>
                  <li>Go to <strong>Location</strong> → <strong>Location Services</strong> → <strong>Google Location History</strong> → <strong>Timeline</strong></li>
                  <li>Tap the menu (⋮) and select <strong>Export Timeline data</strong></li>
                  <li>This creates a file called <code className="bg-gray-100 px-2 py-1 rounded text-sm font-mono">Timeline.json</code></li>
                  <li>Transfer this file to your computer (via email, cloud storage, or USB cable)</li>
                </ol>
              </div>

              <div>
                <h3 className="font-semibold mb-3 text-lg text-gray-900">Step 3: Upload & Process</h3>
                <ol className="list-decimal list-inside space-y-2 ml-4">
                  <li>Click "Choose Files" below and select ALL your old monthly JSON files</li>
                  <li>Click "Choose Files" again and select your new <code className="bg-gray-100 px-2 py-1 rounded text-sm font-mono">Timeline.json</code></li>
                  <li>Choose your cleaning preferences (recommended: keep both checked)</li>
                  <li>Click "Process Files"</li>
                  <li>Download your merged data in CSV, KML, or JSON format</li>
                </ol>
              </div>

              <div className="bg-white p-4 rounded border border-gray-300 mt-4">
                <p className="font-semibold mb-2 text-gray-900">🔒 Privacy Note:</p>
                <p className="text-base">All processing happens in your browser. Your location data never leaves your device or gets uploaded anywhere.</p>
              </div>
            </div>
          </div>

          {/* File Upload Section */}
          <div className="mb-8">
            <h2 className="font-bold text-gray-900 mb-4 text-xl flex items-center gap-2">
              <Upload className="inline w-6 h-6 mr-2" />
              Upload Your Timeline Files
            </h2>
            <div className="mb-4 p-4 bg-gray-50 rounded border border-gray-200 text-base text-gray-700">
              <p><strong>💡 Tip:</strong> You can select multiple files at once (hold Ctrl/Cmd while clicking), or click "Choose Files" multiple times to add more files.</p>
            </div>
            <input
              type="file"
              multiple
              accept=".json"
              onChange={handleFileUpload}
              className="block w-full text-base text-gray-500 file:mr-4 file:py-3 file:px-6 file:rounded-lg file:border-0 file:text-base file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
            />
            {files.length > 0 && (
              <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-base font-semibold text-gray-700">
                    ✅ {files.length} file(s) selected
                  </p>
                  <button
                    onClick={clearFiles}
                    className="text-sm text-red-600 hover:text-red-800 font-semibold"
                  >
                    Clear All
                  </button>
                </div>
                <ul className="text-sm text-gray-600 space-y-1 max-h-32 overflow-y-auto">
                  {files.map((f, i) => (
                    <li key={i} className="truncate">• {f.name}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Data Cleaning Options */}
          <div className="mb-8 p-6 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="font-bold text-gray-900 mb-4 text-lg">🧹 Data Cleaning Options</h3>

            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <input
                  type="checkbox"
                  id="removeActivities"
                  checked={removeActivities}
                  onChange={(e) => setRemoveActivities(e.target.checked)}
                  className="mt-1 w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <label htmlFor="removeActivities" className="text-base font-medium text-gray-900 cursor-pointer">
                      Remove activity records (Recommended)
                    </label>
                    <div className="relative group">
                      <Info
                        className="w-5 h-5 text-gray-400 hover:text-gray-600 cursor-help"
                      />
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-80 p-4 bg-gray-800 text-white text-sm rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        <strong>What this does:</strong> Removes "Activity" records like driving, walking, and biking segments. These are not actual locations you visited, just movement data between places.
                        <br/><br/>
                        <strong>Result:</strong> Keeps only "Visit" records (actual places you stopped at), which dramatically reduces file size and makes mapping easier.
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <input
                  type="checkbox"
                  id="removeDuplicates"
                  checked={removeDuplicates}
                  onChange={(e) => setRemoveDuplicates(e.target.checked)}
                  className="mt-1 w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <label htmlFor="removeDuplicates" className="text-base font-medium text-gray-900 cursor-pointer">
                      Remove duplicates (Recommended)
                    </label>
                    <div className="relative group">
                      <Info
                        className="w-5 h-5 text-gray-400 hover:text-gray-600 cursor-help"
                      />
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-80 p-4 bg-gray-800 text-white text-sm rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        <strong>What this does:</strong> Removes duplicate visits to the same location based on PlaceId or coordinates.
                        <br/><br/>
                        <strong>Smart filtering:</strong> Only removes duplicates when the Address field is blank. Records with detailed addresses are always kept because they contain valuable information.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Process Button */}
          <button
            onClick={processFiles}
            disabled={processing || files.length === 0}
            className="w-full bg-blue-600 text-white py-4 px-6 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 text-base"
          >
            {processing ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Processing your files...
              </>
            ) : 'Process Files'}
          </button>

          {/* Error Display */}
          {error && (
            <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              <strong className="text-base">Error:</strong> {error}
            </div>
          )}

          {/* Results Section */}
          {results && (
            <div className="mt-12 space-y-6">
              <div className="p-6 bg-green-50 border border-green-200 rounded-lg">
                <h3 className="font-bold text-green-900 mb-2 text-lg flex items-center gap-2">
                  ✅ Success! Your files have been processed
                </h3>
                <p className="text-base text-green-800">Your data has been merged, cleaned, and is ready to download.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-blue-50 p-6 rounded-lg border border-blue-200">
                  <div className="flex items-center gap-2 mb-2">
                    <FileJson className="w-6 h-6 text-blue-600" />
                    <span className="text-base font-semibold text-blue-900">Original Records</span>
                  </div>
                  <p className="text-3xl font-bold text-blue-700">{results.originalCount.toLocaleString()}</p>
                  <p className="text-sm text-blue-600 mt-2">Total records from all uploaded files</p>
                </div>
                <div className="bg-green-50 p-6 rounded-lg border border-green-200">
                  <div className="flex items-center gap-2 mb-2">
                    <FileJson className="w-6 h-6 text-green-600" />
                    <span className="text-base font-semibold text-green-900">Final Records</span>
                  </div>
                  <p className="text-3xl font-bold text-green-700">{results.totalCount.toLocaleString()}</p>
                  <p className="text-sm text-green-600 mt-2">After cleaning and deduplication</p>
                </div>
              </div>

              {results.cleaningStats.totalRemoved > 0 && (
                <div className="p-6 bg-indigo-50 rounded-lg border border-indigo-200">
                  <h3 className="font-bold text-indigo-900 mb-3 text-lg">🧹 Cleaning Summary</h3>
                  <div className="text-base text-indigo-800 space-y-2">
                    {results.cleaningStats.removedActivities > 0 && (
                      <p>• Removed {results.cleaningStats.removedActivities.toLocaleString()} activity records (driving, walking, etc.)</p>
                    )}
                    {results.cleaningStats.removedDuplicates > 0 && (
                      <p>• Removed {results.cleaningStats.removedDuplicates.toLocaleString()} duplicate visits</p>
                    )}
                    <p className="font-semibold">
                      Total removed: {results.cleaningStats.totalRemoved.toLocaleString()} records
                      ({Math.round(results.cleaningStats.totalRemoved / results.originalCount * 100)}% reduction)
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-green-50 p-6 rounded-lg border border-green-200">
                  <div className="flex items-center gap-2 mb-2">
                    <MapPin className="w-6 h-6 text-green-600" />
                    <span className="text-base font-semibold text-green-900">Place Visits</span>
                  </div>
                  <p className="text-3xl font-bold text-green-700">{results.visitCount.toLocaleString()}</p>
                  <p className="text-sm text-green-600 mt-2">Actual locations you visited</p>
                </div>
                <div className="bg-blue-50 p-6 rounded-lg border border-blue-200">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="w-6 h-6 text-blue-600" />
                    <span className="text-base font-semibold text-blue-900">Activity Segments</span>
                  </div>
                  <p className="text-3xl font-bold text-blue-700">{results.activityCount.toLocaleString()}</p>
                  <p className="text-sm text-blue-600 mt-2">Movement between locations</p>
                </div>
              </div>

              {/* Download Section */}
              <div className="border-t pt-6">
                <h3 className="font-bold text-gray-900 mb-4 text-lg flex items-center gap-2">
                  <Download className="w-6 h-6" />
                  Download Your Converted Files
                </h3>

                <div className="mb-6 p-4 bg-gray-50 rounded border border-gray-200 text-base text-gray-800">
                  <p className="font-semibold mb-3 text-gray-900">Which format should you choose?</p>
                  <ul className="space-y-2 ml-6 list-disc">
                    <li><strong className="text-gray-900">CSV:</strong> Spreadsheet analysis and Google My Maps</li>
                    <li><strong className="text-gray-900">KML:</strong> For Google My Map, Google Earth, or other mapping software. <strong>Note:</strong> The Google My Maps import will <em>fail</em> if the KML contains more than 2,000 records</li>
                    <li><strong className="text-gray-900">JSON:</strong> Keep a backup in the original Google format</li>
                  </ul>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <button
                    onClick={() => downloadFile(results.csv, 'timeline_converted.csv', 'text/csv')}
                    className="flex items-center justify-center gap-3 bg-green-600 hover:bg-green-700 text-white py-4 px-6 rounded-lg transition-colors font-semibold text-base"
                  >
                    <FileText className="w-6 h-6" />
                    <div className="text-left">
                      <div>CSV</div>
                      <div className="text-sm font-normal opacity-90">Recommended</div>
                    </div>
                  </button>
                  <button
                    onClick={() => downloadFile(results.kml, 'timeline_converted.kml', 'application/vnd.google-earth.kml+xml')}
                    className="flex items-center justify-center gap-3 bg-gray-600 hover:bg-gray-700 text-white py-4 px-6 rounded-lg transition-colors text-base"
                  >
                    <Map className="w-6 h-6" />
                    KML
                  </button>
                  <button
                    onClick={() => downloadFile(results.oldFormatJson, 'timeline_converted.json', 'application/json')}
                    className="flex items-center justify-center gap-3 bg-gray-600 hover:bg-gray-700 text-white py-4 px-6 rounded-lg transition-colors text-base"
                  >
                    <FileJson className="w-6 h-6" />
                    JSON
                  </button>
                </div>
              </div>

              {/* Next Steps Section */}
              <div className="p-6 bg-gray-50 rounded-lg border border-gray-200">
                <h3 className="font-bold text-gray-900 mb-4 text-lg">🗺️ What's Next?</h3>
                <div className="text-base text-gray-800 space-y-3 leading-relaxed">
                  <p><strong className="text-gray-900">To create a map in Google My Maps:</strong></p>
                  <ol className="list-decimal list-inside space-y-2 ml-4">
                    <li>Go to <a href="https://www.google.com/mymaps" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 underline">Google My Maps</a></li>
                    <li>Click "Create a new map"</li>
                    <li>Click "Import" and upload your CSV or KML file</li>
                    <li>Choose "Latitude" and "Longitude" columns for positioning</li>
                    <li>Choose "Name" for the marker title</li>
                    <li>Your map will be created with all your location history!</li>
                  </ol>
                  {results.totalCount > 2000 && (
                    <div className="mt-4 p-4 bg-yellow-50 border border-yellow-300 rounded">
                      <p className="font-semibold text-yellow-900 text-base">⚠️ Note: You have {results.totalCount.toLocaleString()} records</p>
                      <p className="text-yellow-800 mt-2">Google My Maps has a 2,000 row limit. To reduce records further, you can:</p>
                      <ul className="list-disc ml-6 mt-2 space-y-1">
                        <li>Open the CSV in Excel/Google Sheets and delete local/home visits</li>
                        <li>Filter by specific date ranges</li>
                        <li>Keep only visits to new cities/countries</li>
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-12 py-6 border-t border-slate-200">
          <p className="mt-2">
            Made with ❤️ for travelers, data enthusiasts, and anyone who wants to visualize their journey through life.
          </p>
          <div className="mt-6 text-center text-slate-500">
                <p>Built by <a href="https://www.facebook.com/scivolette" target="_blank" className="font-semibold text-slate-600 hover:text-[#7a5195]">Brandon Scivolette</a></p>
                <div className="flex justify-center items-center space-x-4 mt-2">
                    <a href="https://github.com/BrandonML/google-maps-timeline-converter" target="_blank" className="hover:text-[#7a5195]">GitHub</a>
                    <span className="text-slate-300">|</span>
                    <a href="https://linke.ro/brandon" target="_blank" className="hover:text-[#7a5195]">Linke</a>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}
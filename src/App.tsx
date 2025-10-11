import React, { useState, useRef } from 'react';
import { Upload, Download, MapPin, Activity, FileJson, FileText, Map as MapIcon, Info, AlertCircle, ChevronDown } from 'lucide-react';

// --- Interface definitions (unchanged functional code) ---
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
  processingLogs: string[];
}

export default function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeActivities, setRemoveActivities] = useState(true);
  const [removeDuplicates, setRemoveDuplicates] = useState(true);
  const [isLogsOpen, setIsLogsOpen] = useState(false);

  // Ref added to manage the native file input element
  const fileInputRef = useRef<HTMLInputElement>(null);

const parseLatLng = (latLngStr?: string): { lat: number; lng: number } => {
    if (!latLngStr) return { lat: 0, lng: 0 };

    // Handle "geo:lat,lng" format (iOS/Apple)
    if (latLngStr.startsWith('geo:')) {
      const coords = latLngStr.replace('geo:', '').split(',');
      return { lat: parseFloat(coords[0]), lng: parseFloat(coords[1]) };
    }

    // Handle "lat°, lng°" format (Android)
    const parts = latLngStr.replace('°', '').split(', ');
    return { lat: parseFloat(parts[0]), lng: parseFloat(parts[1]) };
  };

const convertNewToOld = (newData: any, filename: string): { timelineObjects: TimelineObject[]; logs: string[] } => {
    const timelineObjects: TimelineObject[] = [];
    const logs: string[] = [];

    // Check if this is an array (iOS format) or object with semanticSegments (Android format)
    let segments: any[] = [];

    if (Array.isArray(newData)) {
      // iOS format - array of segments
      segments = newData;
      logs.push(`[${filename}] Detected iOS/Apple format (array of segments)`);
    } else if (newData.semanticSegments) {
      // Android format - object with semanticSegments property
      segments = newData.semanticSegments;
      logs.push(`[${filename}] Detected Android format (semanticSegments)`);
    } else {
      logs.push(`[${filename}] ERROR: Unknown format - no array or semanticSegments found`);
      return { timelineObjects, logs };
    }

    logs.push(`[${filename}] Processing ${segments.length} segments`);

    segments.forEach((segment: any, index: number) => {
      try {
        if (segment.visit) {
          const visit = segment.visit;
          const topCandidate = visit.topCandidate || {};

          // Handle placeLocation which can be a string (geo:lat,lng) or object
          let lat = 0, lng = 0;
          if (typeof topCandidate.placeLocation === 'string') {
            // iOS format: "geo:lat,lng"
            const coords = parseLatLng(topCandidate.placeLocation);
            lat = coords.lat;
            lng = coords.lng;
          } else if (topCandidate.placeLocation?.latLng) {
            // Android format: object with latLng property
            const coords = parseLatLng(topCandidate.placeLocation.latLng);
            lat = coords.lat;
            lng = coords.lng;
          }

          timelineObjects.push({
            placeVisit: {
              location: {
                latitudeE7: Math.round(lat * 1e7),
                longitudeE7: Math.round(lng * 1e7),
                placeId: topCandidate.placeId || '',
                name: topCandidate.placeLocation?.name || '',
                address: topCandidate.placeLocation?.address || '',
                semanticType: topCandidate.semanticType || 'TYPE_UNKNOWN'
              },
              duration: {
                startTimestamp: segment.startTime || segment.startTimestamp,
                endTimestamp: segment.endTime || segment.endTimestamp
              },
              centerLatE7: Math.round(lat * 1e7),
              centerLngE7: Math.round(lng * 1e7),
              visitConfidence: Math.round((parseFloat(visit.probability) || 0) * 100)
            }
          });
        } else if (segment.activity) {
          const activity = segment.activity;

          // Handle start/end which can be strings (geo:lat,lng) or objects
          let startCoords = { lat: 0, lng: 0 };
          let endCoords = { lat: 0, lng: 0 };

          if (typeof activity.start === 'string') {
            startCoords = parseLatLng(activity.start);
          } else if (activity.start?.latLng) {
            startCoords = parseLatLng(activity.start.latLng);
          }

          if (typeof activity.end === 'string') {
            endCoords = parseLatLng(activity.end);
          } else if (activity.end?.latLng) {
            endCoords = parseLatLng(activity.end.latLng);
          }

          const topCandidate = activity.topCandidate || {};

          const activities = topCandidate.type ? [{
            activityType: topCandidate.type,
            probability: parseFloat(topCandidate.probability) || 0
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
                startTimestamp: segment.startTime || segment.startTimestamp,
                endTimestamp: segment.endTime || segment.endTimestamp
              },
              distance: parseFloat(activity.distanceMeters) || 0,
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
                  startTimestamp: segment.startTime || segment.startTimestamp,
                  endTimestamp: segment.endTime || segment.endTimestamp
                }
              }
            });
          }
        }
      } catch (err: any) {
        logs.push(`[${filename}] ERROR processing segment ${index}: ${err.message}`);
      }
    });

    logs.push(`[${filename}] Successfully converted ${timelineObjects.length} objects`);
    return { timelineObjects, logs };
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
      const beforeCount = cleaned.length;

      // Step 1: Deduplicate by PlaceId first (for records that have one)
      const placeIdMap = new Map<string, TimelineObject[]>();
      const noPlaceIdRecords: TimelineObject[] = [];

      cleaned.forEach((obj) => {
        if (!obj.placeVisit) {
          noPlaceIdRecords.push(obj);
          return;
        }

        const loc = obj.placeVisit.location;
        const placeId = loc.placeId && loc.placeId.trim() !== '' ? loc.placeId.trim() : null;

        if (placeId) {
          if (!placeIdMap.has(placeId)) {
            placeIdMap.set(placeId, []);
          }
          placeIdMap.get(placeId)!.push(obj);
        } else {
          noPlaceIdRecords.push(obj);
        }
      });

      // Pick best record for each PlaceId group
      const recordsAfterPlaceIdDedup: TimelineObject[] = [];

      placeIdMap.forEach((group) => {
        if (group.length === 1) {
          recordsAfterPlaceIdDedup.push(group[0]);
        } else {
          // Multiple records with same PlaceId - prioritize those with addresses
          const withAddress = group.filter(obj => {
            const loc = obj.placeVisit?.location;
            return loc?.address && loc.address.trim() !== '';
          });

          if (withAddress.length > 0) {
            recordsAfterPlaceIdDedup.push(withAddress[0]);
          } else {
            recordsAfterPlaceIdDedup.push(group[0]);
          }
        }
      });

      // Step 2: Combine all records and deduplicate by LatLng
      const allRecordsAfterPlaceIdDedup = [...recordsAfterPlaceIdDedup, ...noPlaceIdRecords];
      const latLngMap = new Map<string, TimelineObject[]>();

      allRecordsAfterPlaceIdDedup.forEach((obj) => {
        if (!obj.placeVisit) {
          // Keep non-visit records as-is with unique keys
          latLngMap.set(`activity-${Math.random()}`, [obj]);
          return;
        }

        const loc = obj.placeVisit.location;
        const latLngKey = `${loc.latitudeE7},${loc.longitudeE7}`;

        if (!latLngMap.has(latLngKey)) {
          latLngMap.set(latLngKey, []);
        }
        latLngMap.get(latLngKey)!.push(obj);
      });

      // Pick best record for each LatLng group
      const finalRecords: TimelineObject[] = [];

      latLngMap.forEach((group) => {
        if (group.length === 1) {
          finalRecords.push(group[0]);
        } else {
          // Multiple records at same coordinates - prioritize those with addresses
          const withAddress = group.filter(obj => {
            const loc = obj.placeVisit?.location;
            return loc?.address && loc.address.trim() !== '';
          });

          if (withAddress.length > 0) {
            finalRecords.push(withAddress[0]);
          } else {
            finalRecords.push(group[0]);
          }
        }
      });

      cleaned = finalRecords;
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

    // Fix for the original user request: Reset the native input element's value to clear the visual filename label
    if (fileInputRef.current) {
        fileInputRef.current.value = '';
    }
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
      const allLogs: string[] = [];
      allLogs.push(`=== Processing Started at ${new Date().toISOString()} ===`);
      allLogs.push(`Total files to process: ${files.length}`);

      for (const file of files) {
        try {
          allLogs.push(`\n--- Processing file: ${file.name} ---`);
          const text = await file.text();

          let data;
          try {
            data = JSON.parse(text);
            allLogs.push(`[${file.name}] Successfully parsed JSON`);
          } catch (parseErr: any) {
            allLogs.push(`[${file.name}] ERROR: Failed to parse JSON - ${parseErr.message}`);
            throw new Error(`Failed to parse ${file.name}: ${parseErr.message}`);
          }

          // Log the structure of the data
          if (Array.isArray(data)) {
            allLogs.push(`[${file.name}] Data is an array with ${data.length} elements`);
          } else if (typeof data === 'object') {
            allLogs.push(`[${file.name}] Data is an object with keys: ${Object.keys(data).join(', ')}`);
          }

          if (Array.isArray(data) || data.semanticSegments) {
            // New format (Android or iOS)
            const { timelineObjects, logs } = convertNewToOld(data, file.name);
            allLogs.push(...logs);
            combinedTimelineObjects = [...combinedTimelineObjects, ...timelineObjects];
          } else if (data.timelineObjects) {
            // Old format
            allLogs.push(`[${file.name}] Detected old format (timelineObjects)`);
            allLogs.push(`[${file.name}] Found ${data.timelineObjects.length} timeline objects`);
            combinedTimelineObjects = [...combinedTimelineObjects, ...data.timelineObjects];
          } else {
            const errorMsg = `File ${file.name} has unrecognized format. Expected: array (iOS), semanticSegments (Android), or timelineObjects (old format). Found keys: ${Object.keys(data).join(', ')}`;
            allLogs.push(`[${file.name}] ERROR: ${errorMsg}`);
            throw new Error(errorMsg);
          }
        } catch (fileErr: any) {
          allLogs.push(`[${file.name}] FATAL ERROR: ${fileErr.message}`);
          throw fileErr;
        }
      }

      allLogs.push(`\n=== Combined ${combinedTimelineObjects.length} total timeline objects ===`);

      const { cleaned, stats } = cleanData(combinedTimelineObjects);
      allLogs.push(`\n=== Data Cleaning Complete ===`);
      allLogs.push(`Removed ${stats.removedActivities} activity segments`);
      allLogs.push(`Removed ${stats.removedDuplicates} duplicate visits`);
      allLogs.push(`Final record count: ${cleaned.length}`);

      const finalData = { timelineObjects: cleaned };

      const csv = convertToCSV(finalData);
      const kml = convertToKML(finalData);

      allLogs.push(`\n=== Conversion Complete ===`);
      allLogs.push(`Generated CSV with ${csv.split('\n').length - 1} rows`);
      allLogs.push(`Generated KML with placemark data`);
      allLogs.push(`Processing completed at ${new Date().toISOString()}`);

      setResults({
        oldFormatJson: JSON.stringify(finalData, null, 2),
        csv,
        kml,
        visitCount: cleaned.filter(o => o.placeVisit).length,
        activityCount: cleaned.filter(o => o.activitySegment).length,
        totalCount: cleaned.length,
        originalCount: combinedTimelineObjects.length,
        cleaningStats: stats,
        processingLogs: allLogs
      });
    } catch (err: any) {
      const errorMsg = `Error processing files: ${err.message}`;
      setError(errorMsg);
      console.error('Processing error:', err);
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

  // --- JSX / UI Refactor Starts Here ---

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8 font-sans">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-3xl shadow-2xl shadow-blue-100 p-6 sm:p-10">

          {/* Header */}
          <div className="flex items-center gap-4 mb-10 pb-4 border-b border-gray-100">
            <MapPin className="w-12 h-12 text-blue-600 flex-shrink-0" />
            <div>
              <h1 className="text-3xl font-extrabold text-gray-900">Google Maps Timeline Data Converter</h1>
              <p className="text-base text-gray-500 mt-1">Merge, clean, and convert your Google Location History (Old & New Formats)</p>
            </div>
          </div>

          {/* What This Does Section (Now permanently displayed) */}
          <div className="mb-10 p-6 bg-blue-50 rounded-2xl relative shadow-md">
            <h2 className="font-bold text-blue-900 mb-4 text-xl flex items-center gap-2">
              <AlertCircle className="w-6 h-6" />
              What Does This App Do?
            </h2>

            <div className="space-y-4 text-base text-blue-800 leading-relaxed">
              <p>
                <strong className="text-blue-900">The Problem:</strong> Google's 2024 format change broke compatibility.
                This tool unifies <code className="bg-blue-100 px-1 rounded font-mono text-sm">old (.json)</code> and <code className="bg-blue-100 px-1 rounded font-mono text-sm">new (Timeline.json)</code> data into one clean, usable file.
              </p>

              {/* Combined use cases into one list, cleaner design */}
              <div className="p-4 bg-white rounded-xl shadow-inner">
                <p className="font-semibold mb-3 text-blue-900">Key Benefits:</p>
                <ul className="space-y-2 ml-6 list-disc text-base marker:text-blue-500">
                  <li>Combine data from multiple accounts/years.</li>
                  <li>Create custom travel maps in Google My Maps.</li>
                  <li>Clean data to meet the 2,000-record My Maps import limit.</li>
                  <li>Keep a permanent, unified history backup.</li>
                </ul>
              </div>
            </div>
          </div>
          {/* End of permanent info section */}


          {/* Step-by-Step Instructions */}
          <div className="mb-12 p-8 bg-gray-100 rounded-2xl shadow-inner">
            <h2 className="font-bold text-gray-900 mb-6 text-2xl flex items-center gap-2">
              <MapIcon className="w-6 h-6" />
              Your Data Workflow
            </h2>

            <div className="space-y-8 text-base text-gray-700 leading-relaxed">
              <div>
                <h3 className="font-extrabold mb-3 text-lg text-gray-900 flex items-center gap-2">
                  <span className="text-xl font-mono px-3 py-1 bg-blue-200 text-blue-900 rounded-full">1</span>
                  Get OLD Timeline Data (Pre-2024)
                </h3>
                <ol className="list-decimal list-inside space-y-2 ml-10">
                  <li>Go to <a href="https://takeout.google.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 underline font-medium">Google Takeout</a>, select only "Location History."</li>
                  <li>Download the zip, and find files like <code className="bg-gray-200 px-2 py-1 rounded text-sm font-mono text-gray-700">2018_JANUARY.json</code> in the extracted folder.</li>
                </ol>
              </div>

              <div>
                <h3 className="font-extrabold mb-3 text-lg text-gray-900 flex items-center gap-2">
                  <span className="text-xl font-mono px-3 py-1 bg-blue-200 text-blue-900 rounded-full">2</span>
                  Get NEW Timeline Data (2024+)
                </h3>
                <p className="mb-3 text-base text-red-700 font-semibold flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-red-500" />
                  This data is only on your phone — not in Google Takeout!
                </p>
                <ol className="list-decimal list-inside space-y-2 ml-10">
                  <li>On your phone: <strong className="text-gray-900">Settings → Location → Timeline → Export data.</strong></li>
                  <li>Transfer the generated <code className="bg-gray-200 px-2 py-1 rounded text-sm font-mono text-gray-700">Timeline.json</code> file to your computer.</li>
                </ol>
              </div>

              <div>
                <h3 className="font-extrabold mb-3 text-lg text-gray-900 flex items-center gap-2">
                  <span className="text-xl font-mono px-3 py-1 bg-blue-200 text-blue-900 rounded-full">3</span>
                  Upload & Download
                </h3>
                <ol className="list-decimal list-inside space-y-2 ml-10">
                  <li>Use the "Choose Files" button below to select <strong>ALL</strong> your JSON files (old and new).</li>
                  <li>Click "Process Files" and download the merged, cleaned data.</li>
                </ol>
              </div>

              {/* Privacy Note: simplified design */}
              <div className="p-4 bg-gray-200 rounded-xl mt-4">
                <p className="font-semibold text-gray-900 flex items-center gap-2">🔒 Privacy Note:</p>
                <p className="text-sm text-gray-800">All processing happens directly in your browser. Your location data never leaves your device.</p>
              </div>
            </div>
          </div>

          {/* File Upload Section */}
          <div className="mb-10 pt-4 border-t border-gray-100">
            <h2 className="font-bold text-gray-900 mb-4 text-2xl flex items-center gap-2">
              <Upload className="inline w-6 h-6 text-blue-600 mr-1" />
              Upload Your Timeline Files
            </h2>
            {/* Simplified Tip Box - no border */}
            <div className="mb-4 p-4 bg-yellow-50 rounded-xl text-base text-yellow-800 shadow-sm">
              <p><strong>💡 Tip:</strong> You can select multiple files at once, or click "Choose Files" multiple times to add more.</p>
            </div>
            <input
              type="file"
              multiple
              accept=".json"
              onChange={handleFileUpload}
              // Attach ref to the input element (for clearing value)
              ref={fileInputRef}
              className="block w-full text-base text-gray-500 file:mr-4 file:py-3 file:px-6 file:rounded-xl file:border-0 file:text-base file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer transition-colors"
            />
            {files.length > 0 && (
              <div className="mt-4 p-4 bg-gray-100 rounded-xl shadow-inner">
                <div className="flex justify-between items-center mb-2 border-b border-gray-200 pb-2">
                  <p className="text-base font-semibold text-gray-700 flex items-center gap-1">
                    <FileJson className="w-5 h-5 text-green-600" />
                    {files.length} file(s) selected
                  </p>
                  <button
                    onClick={clearFiles}
                    className="text-sm text-red-600 hover:text-red-800 font-medium transition-colors"
                  >
                    Clear All
                  </button>
                </div>
                <ul className="text-sm text-gray-600 space-y-1 max-h-32 overflow-y-auto pt-2">
                  {files.map((f, i) => (
                    <li key={i} className="truncate">• {f.name}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Data Cleaning Options (Card style with shadow) */}
          <div className="mb-10 p-6 bg-indigo-50/70 rounded-2xl shadow-lg">
            <h3 className="font-bold text-indigo-900 mb-5 text-xl flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-indigo-700">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9.75 16.5c0 .375.362.583.636.436l7.5-4.5c.249-.15.249-.464 0-.614l-7.5-4.5c-.274-.147-.636.061-.636.437c.026.495-.152.921-.384 1.258a1.5 1.5 0 01-.194.223h-.001m.001 0c-.39-.126-1.074 0-1.074.437c0 .375.362.583.636.436l1.372-.823m3.33-2.673l.63.378M9.75 16.5V20.25c0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75V16.5m-8.67-6.095l-1.372.823m3.33-2.673l-.63.378M12 21a9 9 0 100-18 9 9 0 000 18z" />
              </svg>
              Data Cleaning & Optimization
            </h3>

            <div className="space-y-6">
              {/* Option 1 */}
              <div className="flex items-start gap-4 p-3 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow">
                <input
                  type="checkbox"
                  id="removeActivities"
                  checked={removeActivities}
                  onChange={(e) => setRemoveActivities(e.target.checked)}
                  className="mt-1 w-6 h-6 text-blue-600 rounded-lg border-gray-300 focus:ring-blue-500 cursor-pointer flex-shrink-0"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <label htmlFor="removeActivities" className="text-base font-semibold text-gray-900 cursor-pointer">
                      Remove activity segments
                      <span className="text-xs ml-2 px-2 py-0.5 bg-green-100 text-green-700 rounded-full">Recommended</span>
                    </label>
                    <div className="relative group">
                      <Info className="w-5 h-5 text-gray-400 hover:text-gray-600 cursor-help" />
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-80 p-4 bg-gray-800 text-white text-sm rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        <strong>Purpose:</strong> Removes movement records (driving, walking, biking), leaving only "Visit" records (actual places you stopped).
                        <br/><br/>
                        <strong>Benefit:</strong> Dramatically reduces file size and complexity for mapping applications like Google My Maps.
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">Keeps only actual place visits, ideal for creating maps.</p>
                </div>
              </div>

              {/* Option 2 */}
              <div className="flex items-start gap-4 p-3 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow">
                <input
                  type="checkbox"
                  id="removeDuplicates"
                  checked={removeDuplicates}
                  onChange={(e) => setRemoveDuplicates(e.target.checked)}
                  className="mt-1 w-6 h-6 text-blue-600 rounded-lg border-gray-300 focus:ring-blue-500 cursor-pointer flex-shrink-0"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <label htmlFor="removeDuplicates" className="text-base font-semibold text-gray-900 cursor-pointer">
                      Remove duplicate place visits
                      <span className="text-xs ml-2 px-2 py-0.5 bg-green-100 text-green-700 rounded-full">Recommended</span>
                    </label>
                    <div className="relative group">
                      <Info className="w-5 h-5 text-gray-400 hover:text-gray-600 cursor-help" />
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-80 p-4 bg-gray-800 text-white text-sm rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        <strong>Purpose:</strong> Identifies and removes redundant records at the exact same location (based on PlaceId or coordinates).
                        <br/><br/>
                        <strong>Smart Filtering:</strong> Keeps the record with the most detail (e.g., the one with a confirmed address) when duplicates are found.
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">Cleans up redundant data points at the same spot.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Process Button */}
          <button
            onClick={processFiles}
            disabled={processing || files.length === 0}
            className="w-full bg-blue-600 text-white py-4 px-6 rounded-xl font-extrabold hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-3 text-lg shadow-lg hover:shadow-xl transform hover:scale-[1.005] active:scale-[0.99]"
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

          {/* Error Display (Cleaned up alert box) */}
          {error && (
            <div className="mt-6 p-4 bg-red-100 border-l-4 border-red-500 rounded-lg text-red-800 flex items-center gap-2 shadow-md">
              <AlertCircle className="w-6 h-6 text-red-500 flex-shrink-0" />
              <div>
                <strong className="text-base font-semibold">Processing Error:</strong> {error}
              </div>
            </div>
          )}

          {/* Results Section (Consolidated and redesigned) */}
          {results && (
            <div className="mt-12 space-y-8">
              {/* Success Banner - Clean and prominent */}
              <div className="p-5 bg-emerald-50 border-l-4 border-emerald-500 rounded-xl shadow-md">
                <h3 className="font-bold text-emerald-900 mb-2 text-xl flex items-center gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Processing Complete!
                </h3>
                <p className="text-base text-emerald-800">Your data has been merged, cleaned, and is ready for download.</p>
              </div>

              {/* Consolidated Summary Card (Replaces multiple boxes) */}
              <div className="p-6 bg-gray-100 rounded-2xl shadow-xl border border-gray-200">
                <h3 className="font-bold text-gray-900 mb-5 text-xl">📊 Unified Data Summary</h3>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  {/* Original Count */}
                  <div className="p-4 bg-white rounded-xl shadow-md transition-all hover:bg-gray-50">
                    <p className="text-xs font-medium text-gray-500 uppercase">Original</p>
                    <p className="text-2xl font-bold text-blue-700 mt-1">{results.originalCount.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-1">Total Records</p>
                  </div>

                  {/* Final Count */}
                  <div className="p-4 bg-white rounded-xl shadow-md transition-all hover:bg-gray-50">
                    <p className="text-xs font-medium text-gray-500 uppercase">Final</p>
                    <p className="text-2xl font-bold text-green-700 mt-1">{results.totalCount.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-1">Total Records</p>
                  </div>

                  {/* Place Visits (Cleaned) */}
                  <div className="p-4 bg-white rounded-xl shadow-md transition-all hover:bg-gray-50">
                    <p className="text-xs font-medium text-gray-500 uppercase flex items-center justify-center gap-1"><MapPin className="w-3 h-3"/> Visits</p>
                    <p className="text-2xl font-bold text-green-600 mt-1">{results.visitCount.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-1">Place Stops</p>
                  </div>

                  {/* Activity Segments (Cleaned) */}
                  <div className="p-4 bg-white rounded-xl shadow-md transition-all hover:bg-gray-50">
                    <p className="text-xs font-medium text-gray-500 uppercase flex items-center justify-center gap-1"><Activity className="w-3 h-3"/> Activity</p>
                    <p className="text-2xl font-bold text-gray-600 mt-1">{results.activityCount.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-1">Movement Segments</p>
                  </div>
                </div>

                {/* Cleaning Summary - Concise representation using badges */}
                {results.cleaningStats.totalRemoved > 0 && (
                  <div className="mt-6 pt-4 border-t border-gray-200">
                    <h4 className="font-semibold text-gray-700 mb-3 text-lg">🧹 Cleaning Summary</h4>
                    <div className="flex flex-wrap gap-3 text-sm">
                      <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full font-medium shadow-sm">
                        Total Removed: {results.cleaningStats.totalRemoved.toLocaleString()}
                        ({Math.round(results.cleaningStats.totalRemoved / results.originalCount * 100)}% reduction)
                      </span>
                      {results.cleaningStats.removedActivities > 0 && (
                        <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full font-medium shadow-sm">
                          Activities Removed: {results.cleaningStats.removedActivities.toLocaleString()}
                        </span>
                      )}
                      {results.cleaningStats.removedDuplicates > 0 && (
                        <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full font-medium shadow-sm">
                          Duplicates Removed: {results.cleaningStats.removedDuplicates.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Download Section (Stronger visual separation) */}
              <div className="p-6 bg-blue-600/10 rounded-2xl shadow-lg">
                <h3 className="font-bold text-blue-900 mb-4 text-xl flex items-center gap-2">
                  <Download className="w-6 h-6 text-blue-700" />
                  Download Your Converted Files
                </h3>

                {/* Which format to choose - clean block */}
                <div className="mb-6 p-4 bg-white rounded-xl text-base text-gray-800 shadow-md">
                  <p className="font-semibold mb-3 text-gray-900">Which format should you choose?</p>
                  <ul className="space-y-2 ml-6 list-disc marker:text-blue-500">
                    <li><strong className="text-gray-900">CSV:</strong> Best for spreadsheet analysis (Excel, Sheets) and Google My Maps.</li>
                    <li><strong className="text-gray-900">KML:</strong> For Google Earth or mapping software. <strong>Note:</strong> Limited to 2,000 records for My Maps import.</li>
                    <li><strong className="text-gray-900">JSON:</strong> For a permanent backup in the unified Google format.</li>
                  </ul>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* CSV Button - Primary Focus */}
                  <button
                    onClick={() => downloadFile(results.csv, 'timeline_converted.csv', 'text/csv')}
                    className="flex flex-col sm:flex-row items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white py-4 px-4 rounded-xl transition-colors font-extrabold text-base shadow-lg hover:shadow-xl transform hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <FileText className="w-6 h-6" />
                    <div className="text-center sm:text-left">
                      <div>CSV</div>
                      <div className="text-xs font-normal opacity-90">Recommended</div>
                    </div>
                  </button>
                  {/* KML Button */}
                  <button
                    onClick={() => downloadFile(results.kml, 'timeline_converted.kml', 'application/vnd.google-earth.kml+xml')}
                    className="flex flex-col sm:flex-row items-center justify-center gap-2 bg-gray-700 hover:bg-gray-800 text-white py-4 px-4 rounded-xl transition-colors text-base shadow-lg transform hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <MapIcon className="w-6 h-6" />
                    KML
                  </button>
                  {/* JSON Button */}
                  <button
                    onClick={() => downloadFile(results.oldFormatJson, 'timeline_converted.json', 'application/json')}
                    className="flex flex-col sm:flex-row items-center justify-center gap-2 bg-gray-700 hover:bg-gray-800 text-white py-4 px-4 rounded-xl transition-colors text-base shadow-lg transform hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <FileJson className="w-6 h-6" />
                    JSON
                  </button>
                </div>
              </div>

              {/* Next Steps Section (Clean card style) */}
              <div className="p-6 bg-gray-100 rounded-2xl shadow-inner border border-gray-200">
                <h3 className="font-bold text-gray-900 mb-4 text-xl flex items-center gap-2">
                  <MapIcon className="w-6 h-6" />
                  Next Steps: Creating Your Map
                </h3>
                <div className="text-base text-gray-800 space-y-3 leading-relaxed">
                  <p><strong className="text-gray-900">To create a map in Google My Maps:</strong></p>
                  <ol className="list-decimal list-inside space-y-2 ml-4 marker:text-gray-600">
                    <li>Go to <a href="https://www.google.com/mymaps" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 underline">Google My Maps</a>.</li>
                    <li>Click "Create a new map" then "Import" and upload your CSV or KML file.</li>
                    <li>Follow the prompts to select <strong className="text-gray-900">Latitude/Longitude</strong> for positioning and <strong className="text-gray-900">Name</strong> for the marker title.</li>
                  </ol>
                  {results.totalCount > 2000 && (
                    <div className="mt-4 p-4 bg-red-50 border-l-4 border-red-500 rounded text-red-800 shadow-sm">
                      <p className="font-semibold text-red-900 text-base flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                        My Maps Limit Warning: {results.totalCount.toLocaleString()} records detected
                      </p>
                      <p className="mt-2 text-sm">Google My Maps has a <strong>2,000 row limit</strong>. To reduce records further, you can:</p>
                      <ul className="list-disc ml-6 mt-2 space-y-1 text-sm">
                        <li>Open the CSV in Excel/Google Sheets and delete local/home visits.</li>
                        <li>Filter the data by specific date ranges.</li>
                      </ul>
                    </div>
                  )}
                </div>
              </div>
              {/* Processing Logs Section */}
              <div className="p-6 bg-gray-800 rounded-2xl shadow-lg">
                <button onClick={() => setIsLogsOpen(!isLogsOpen)} className="w-full flex justify-between items-center">
                  <h3 className="font-bold text-gray-100 text-xl flex items-center gap-2">
                    <FileText className="w-6 h-6 text-blue-400" />
                    Processing Logs
                  </h3>
                  <ChevronDown className={`w-6 h-6 text-gray-400 transition-transform ${isLogsOpen ? 'rotate-180' : ''}`} />
                </button>
                {isLogsOpen && (
                  <div className="mt-4">
                    <p className="text-sm text-gray-300 mb-4">
                      Detailed information about how your files were processed. If you encounter any issues,
                      please download these logs and share them for troubleshooting.
                    </p>

                    <div className="bg-gray-900 rounded-xl p-4 max-h-96 overflow-y-auto font-mono text-xs text-green-400 mb-4">
                      {results.processingLogs.map((log, i) => (
                        <div key={i} className={`py-1 ${log.includes('ERROR') ? 'text-red-400 font-bold' : log.includes('===') ? 'text-yellow-400 font-bold' : ''}`}>
                          {log}
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={() => downloadFile(results.processingLogs.join('\n'), 'processing_logs.txt', 'text/plain')}
                      className="w-full bg-gray-700 hover:bg-gray-600 text-white py-3 px-4 rounded-xl transition-colors font-semibold text-sm shadow-lg flex items-center justify-center gap-2"
                    >
                      <Download className="w-5 h-5" />
                      Download Processing Logs
                    </button>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-12 py-6 border-t border-gray-200">
          <p className="mt-2 text-gray-500">
            Made with ❤️ for travelers, data enthusiasts, and anyone who wants to visualize their journey through life.
          </p>
          <div className="mt-4 text-center text-slate-500">
                <p>Built by <a href="https://www.facebook.com/scivolette" target="_blank" className="font-semibold text-slate-600 hover:text-blue-600 transition-colors underline">Brandon Scivolette</a></p>
                <div className="flex justify-center items-center space-x-4 mt-2">
                    <a href="https://github.com/BrandonML/google-maps-timeline-converter" target="_blank" className="hover:text-blue-600 transition-colors underline">GitHub</a>
                    <span className="text-gray-300">|</span>
                    <a href="https://linke.ro/brandon" target="_blank" className="hover:text-blue-600 transition-colors underline">Linke</a>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}

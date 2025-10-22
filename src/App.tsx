import React, { useState, useRef } from 'react';
import { Upload, Download, MapPin, Activity, FileJson, FileText, Info, AlertCircle, ChevronDown } from 'lucide-react';

// Add JSZip type declaration for browser usage
declare const JSZip: any;

// --- Interface definitions ---
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
  csv: string[];
  kml: string[];
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
  const [splitFiles, setSplitFiles] = useState(true);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [isLoadingJSZip, setIsLoadingJSZip] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseLatLng = (latLngStr?: string): { lat: number; lng: number } => {
    if (!latLngStr) return { lat: 0, lng: 0 };

    if (latLngStr.startsWith('geo:')) {
      const coords = latLngStr.replace('geo:', '').split(',');
      return { lat: parseFloat(coords[0]), lng: parseFloat(coords[1]) };
    }

    const parts = latLngStr.replace('°', '').split(', ');
    return { lat: parseFloat(parts[0]), lng: parseFloat(parts[1]) };
  };

  const convertNewToOld = (newData: any, filename: string): { timelineObjects: TimelineObject[]; logs: string[] } => {
    const timelineObjects: TimelineObject[] = [];
    const logs: string[] = [];

    let segments: any[] = [];

    if (Array.isArray(newData)) {
      segments = newData;
      logs.push(`[${filename}] Detected iOS/Apple format (array of segments)`);
    } else if (newData.semanticSegments) {
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

          let lat = 0, lng = 0;
          if (typeof topCandidate.placeLocation === 'string') {
            const coords = parseLatLng(topCandidate.placeLocation);
            lat = coords.lat;
            lng = coords.lng;
          } else if (topCandidate.placeLocation?.latLng) {
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

      const recordsAfterPlaceIdDedup: TimelineObject[] = [];

      placeIdMap.forEach((group) => {
        if (group.length === 1) {
          recordsAfterPlaceIdDedup.push(group[0]);
        } else {
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

      const allRecordsAfterPlaceIdDedup = [...recordsAfterPlaceIdDedup, ...noPlaceIdRecords];
      const latLngMap = new Map<string, TimelineObject[]>();

      allRecordsAfterPlaceIdDedup.forEach((obj) => {
        if (!obj.placeVisit) {
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

      const finalRecords: TimelineObject[] = [];

      latLngMap.forEach((group) => {
        if (group.length === 1) {
          finalRecords.push(group[0]);
        } else {
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

  const convertToCSV = (data: TimelineObject[]): string => {
    const rows: (string | number)[][] = [];
    rows.push(['Type', 'Name', 'Address', 'Latitude', 'Longitude', 'Start Time', 'End Time', 'PlaceId']);

    data.forEach((obj) => {
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

  const escapeXml = (unsafe: string): string => {
    return unsafe.replace(/[<>&"']/g, (c: string) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '"': return '&quot;';
        case "'": return '&apos;';
      }
      return c;
    });
  };

  const convertToKML = (data: TimelineObject[]): string => {
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

    data.forEach((obj) => {
      if (obj.placeVisit) {
        const pv = obj.placeVisit;
        const loc = pv.location;
        const lat = loc.latitudeE7 / 1e7;
        const lng = loc.longitudeE7 / 1e7;
        const name = escapeXml(loc.name || 'Unknown Location');
        const address = loc.address || '';

        kml += `    <Placemark>
      <name>${name}</name>
      <description><![CDATA[${address}
Start: ${pv.duration.startTimestamp}
End: ${pv.duration.endTimestamp}]]></description>
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

  const splitIntoChunks = (data: TimelineObject[], chunkSize: number = 2000): TimelineObject[][] => {
    const chunks: TimelineObject[][] = [];
    for (let i = 0; i < data.length; i += chunkSize) {
      chunks.push(data.slice(i, i + chunkSize));
    }
    return chunks;
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

          if (Array.isArray(data)) {
            allLogs.push(`[${file.name}] Data is an array with ${data.length} elements`);
          } else if (typeof data === 'object') {
            allLogs.push(`[${file.name}] Data is an object with keys: ${Object.keys(data).join(', ')}`);
          }

          if (Array.isArray(data) || data.semanticSegments) {
            const { timelineObjects, logs } = convertNewToOld(data, file.name);
            allLogs.push(...logs);
            combinedTimelineObjects = [...combinedTimelineObjects, ...timelineObjects];
          } else if (data.timelineObjects) {
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

      let csvFiles: string[] = [];
      let kmlFiles: string[] = [];

      if (splitFiles && cleaned.length > 2000) {
        allLogs.push(`\n=== Splitting Files (${cleaned.length} records > 2000) ===`);
        const chunks = splitIntoChunks(cleaned, 2000);
        allLogs.push(`Created ${chunks.length} file chunks`);

        chunks.forEach((chunk, index) => {
          allLogs.push(`Chunk ${index + 1}: ${chunk.length} records`);
          csvFiles.push(convertToCSV(chunk));
          kmlFiles.push(convertToKML(chunk));
        });
      } else {
        csvFiles.push(convertToCSV(cleaned));
        kmlFiles.push(convertToKML(cleaned));
      }

      allLogs.push(`\n=== Conversion Complete ===`);
      allLogs.push(`Generated ${csvFiles.length} CSV file(s)`);
      allLogs.push(`Generated ${kmlFiles.length} KML file(s)`);
      allLogs.push(`Processing completed at ${new Date().toISOString()}`);

      setResults({
        oldFormatJson: JSON.stringify(finalData, null, 2),
        csv: csvFiles,
        kml: kmlFiles,
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

  const loadJSZip = async (): Promise<void> => {
    if (typeof JSZip !== 'undefined') {
      return;
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load JSZip'));
      document.head.appendChild(script);
    });
  };

  const downloadZip = async (files: string[], baseName: string, extension: string) => {
    setIsLoadingJSZip(true);
    try {
      await loadJSZip();

      const zip = new JSZip();

      files.forEach((content, index) => {
        const filename = files.length === 1
          ? `${baseName}.${extension}`
          : `${baseName}_part${index + 1}.${extension}`;
        zip.file(filename, content);
      });

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (err) {
      console.error('Error creating zip:', err);
      setError('Failed to create zip file. Please try downloading files individually.');
    } finally {
      setIsLoadingJSZip(false);
    }
  };

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

          {/* What This Does Section */}
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

              <div className="p-4 bg-white rounded-xl shadow-inner">
                <p className="font-semibold mb-3 text-blue-900">Key Benefits:</p>
                <ul className="space-y-2 ml-6 list-disc text-base marker:text-blue-500">
                  <li>Combine data from multiple accounts/years.</li>
                  <li>Create custom travel maps in Google My Maps.</li>
                  <li>Clean data to meet the 2,000-record (per layer) limit for Google My Maps import.</li>
                  <li>Keep a permanent, unified history backup.</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Step-by-Step Instructions */}
          <div className="mb-12 p-8 bg-gray-100 rounded-2xl shadow-inner">
            <h2 className="font-bold text-gray-900 mb-6 text-2xl flex items-center gap-2">
              <MapPin className="w-6 h-6" />
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
            <div className="mb-4 p-4 bg-yellow-50 rounded-xl text-base text-yellow-800 shadow-sm">
              <p><strong>💡 Tip:</strong> You can select multiple files at once, or click "Choose Files" multiple times to add more.</p>
            </div>
            <input
              type="file"
              multiple
              accept=".json"
              onChange={handleFileUpload}
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

          {/* Data Cleaning Options */}
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

              {/* Option 3 - NEW: Split files option */}
              <div className="flex items-start gap-4 p-3 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow">
                <input
                  type="checkbox"
                  id="splitFiles"
                  checked={splitFiles}
                  onChange={(e) => setSplitFiles(e.target.checked)}
                  className="mt-1 w-6 h-6 text-blue-600 rounded-lg border-gray-300 focus:ring-blue-500 cursor-pointer flex-shrink-0"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <label htmlFor="splitFiles" className="text-base font-semibold text-gray-900 cursor-pointer">
                      Split files for Google My Maps import
                      <span className="text-xs ml-2 px-2 py-0.5 bg-green-100 text-green-700 rounded-full">Recommended</span>
                    </label>
                    <div className="relative group">
                      <Info className="w-5 h-5 text-gray-400 hover:text-gray-600 cursor-help" />
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-80 p-4 bg-gray-800 text-white text-sm rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        <strong>Purpose:</strong> Automatically splits your data into multiple files if you have more than 2,000 records.
                        <br/><br/>
                        <strong>Why?</strong> Google My Maps has a 2,000 record limit per layer. This option creates separate files (each with ≤2,000 records) so you can import them as individual layers.
                        <br/><br/>
                        <strong>Example:</strong> 5,875 records → 3 files (2,000 + 2,000 + 1,875)
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">Automatically creates multiple files if you have &gt;2,000 records.</p>
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

          {/* Error Display */}
          {error && (
            <div className="mt-6 p-4 bg-red-100 border-l-4 border-red-500 rounded-lg text-red-800 flex items-center gap-2 shadow-md">
              <AlertCircle className="w-6 h-6 text-red-500 flex-shrink-0" />
              <div>
                <strong className="text-base font-semibold">Processing Error:</strong> {error}
              </div>
            </div>
          )}

          {/* Results Section */}
          {results && (
            <div className="mt-12 space-y-8">
              {/* Success Banner */}
              <div className="p-5 bg-emerald-50 border-l-4 border-emerald-500 rounded-xl shadow-md">
                <h3 className="font-bold text-emerald-900 mb-2 text-xl flex items-center gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Processing Complete!
                </h3>
                <p className="text-base text-emerald-800">Your data has been merged, cleaned, and is ready for download.</p>
                {results.csv.length > 1 && (
                  <p className="text-base text-emerald-800 mt-2 font-semibold">
                    📦 Your data has been split into {results.csv.length} files for easy Google My Maps import.
                  </p>
                )}
              </div>

              {/* Consolidated Summary Card */}
              <div className="p-6 bg-gray-100 rounded-2xl shadow-xl border border-gray-200">
                <h3 className="font-bold text-gray-900 mb-5 text-xl">📊 Unified Data Summary</h3>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div className="p-4 bg-white rounded-xl shadow-md transition-all hover:bg-gray-50">
                    <p className="text-xs font-medium text-gray-500 uppercase">Original</p>
                    <p className="text-2xl font-bold text-blue-700 mt-1">{results.originalCount.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-1">Total Records</p>
                  </div>

                  <div className="p-4 bg-white rounded-xl shadow-md transition-all hover:bg-gray-50">
                    <p className="text-xs font-medium text-gray-500 uppercase">Final</p>
                    <p className="text-2xl font-bold text-green-700 mt-1">{results.totalCount.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-1">Total Records</p>
                  </div>

                  <div className="p-4 bg-white rounded-xl shadow-md transition-all hover:bg-gray-50">
                    <p className="text-xs font-medium text-gray-500 uppercase flex items-center justify-center gap-1"><MapPin className="w-3 h-3"/> Visits</p>
                    <p className="text-2xl font-bold text-green-600 mt-1">{results.visitCount.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-1">Place Stops</p>
                  </div>

                  <div className="p-4 bg-white rounded-xl shadow-md transition-all hover:bg-gray-50">
                    <p className="text-xs font-medium text-gray-500 uppercase flex items-center justify-center gap-1"><Activity className="w-3 h-3"/> Activity</p>
                    <p className="text-2xl font-bold text-gray-600 mt-1">{results.activityCount.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-1">Movement Segments</p>
                  </div>
                </div>

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

              {/* Download Section */}
              <div className="p-6 bg-blue-600/10 rounded-2xl shadow-lg">
                <h3 className="font-bold text-blue-900 mb-4 text-xl flex items-center gap-2">
                  <Download className="w-6 h-6 text-blue-700" />
                  Download Your Converted Files
                </h3>

                <div className="mb-6 p-4 bg-white rounded-xl text-base text-gray-800 shadow-md">
                  <p className="font-semibold mb-3 text-gray-900">Which format should you choose?</p>
                  <ul className="space-y-2 ml-6 list-disc marker:text-blue-500">
                    <li><strong className="text-gray-900">CSV:</strong> Best for spreadsheet analysis (Excel, Sheets) and Google My Maps.</li>
                    <li><strong className="text-gray-900">KML:</strong> For Google Earth or mapping software.</li>
                    <li><strong className="text-gray-900">JSON:</strong> For a permanent backup in the unified Google format.</li>
                  </ul>
                  {results.csv.length > 1 && (
                    <div className="mt-4 p-3 bg-blue-50 border-l-4 border-blue-500 rounded">
                      <p className="font-semibold text-blue-900">📦 Multiple Files Generated</p>
                      <p className="text-sm text-blue-800 mt-1">
                        Your data has been split into {results.csv.length} files. Each file contains 2,000 or fewer records.
                        Click the download button to get all files as a zip archive, then import each file as a separate layer in Google My Maps.
                      </p>
                    </div>
                  )}
                  <p className="mt-4"><strong>Note</strong>: Newer records from <code className="bg-gray-200 px-2 py-1 rounded text-sm font-mono text-gray-700">timeline.json</code> don't include the place name. Because all timeline records have a <strong>PlaceId</strong>, you can retrieve the place names by using the Google Maps API and an Apps Script. <a href="https://github.com/BrandonML/google-maps-timeline-converter/tree/main/tools" target="_blank" className="text-blue-600 hover:text-blue-800 underline">View the script and instructions on how to use it in the repo</a>.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <button
                    onClick={() => results.csv.length === 1
                      ? downloadFile(results.csv[0], 'timeline_converted.csv', 'text/csv')
                      : downloadZip(results.csv, 'timeline_converted', 'csv')
                    }
                    disabled={isLoadingJSZip}
                    className="flex flex-col sm:flex-row items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white py-4 px-4 rounded-xl transition-colors font-extrabold text-base shadow-lg hover:shadow-xl transform hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <FileText className="w-6 h-6" />
                    <div className="text-center sm:text-left">
                      <div>CSV {results.csv.length > 1 && `(${results.csv.length} files)`}</div>
                      <div className="text-xs font-normal opacity-90">Recommended</div>
                    </div>
                  </button>

                  <button
                    onClick={() => results.kml.length === 1
                      ? downloadFile(results.kml[0], 'timeline_converted.kml', 'application/vnd.google-earth.kml+xml')
                      : downloadZip(results.kml, 'timeline_converted', 'kml')
                    }
                    disabled={isLoadingJSZip}
                    className="flex flex-col sm:flex-row items-center justify-center gap-2 bg-gray-700 hover:bg-gray-800 disabled:bg-gray-400 text-white py-4 px-4 rounded-xl transition-colors text-base shadow-lg transform hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <MapPin className="w-6 h-6" />
                    <div className="text-center sm:text-left">
                      KML {results.kml.length > 1 && `(${results.kml.length} files)`}
                    </div>
                  </button>

                  <button
                    onClick={() => downloadFile(results.oldFormatJson, 'timeline_converted.json', 'application/json')}
                    className="flex flex-col sm:flex-row items-center justify-center gap-2 bg-gray-700 hover:bg-gray-800 text-white py-4 px-4 rounded-xl transition-colors text-base shadow-lg transform hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <FileJson className="w-6 h-6" />
                    JSON
                  </button>
                </div>

                {isLoadingJSZip && (
                  <div className="mt-4 p-3 bg-blue-50 rounded-xl text-center text-blue-800">
                    <p className="text-sm">Loading zip library... This only happens once.</p>
                  </div>
                )}

                <div className="my-8 p-4 bg-yellow-50 rounded-xl text-base text-yellow-800 shadow-sm">
                  <p><strong>Did you find this app useful?</strong> Show your thanks by <a href="https://buymeacoffee.com/scivolette" target="_blank" className="text-blue-600 hover:text-blue-800 underline">buying me a beer</a>! Me likey beer 🍺.</p>
                </div>
              </div>

              {/* Next Steps Section */}
              <div className="p-6 bg-gray-100 rounded-2xl shadow-inner border border-gray-200">
                <h3 className="font-bold text-gray-900 mb-4 text-xl flex items-center gap-2">
                  <MapPin className="w-6 h-6" />
                  Next Steps: Creating Your Map
                </h3>
                <div className="text-base text-gray-800 space-y-3 leading-relaxed">
                  <p><strong className="text-gray-900">To create a map in Google My Maps:</strong></p>
                  <ol className="list-decimal list-inside space-y-2 ml-4 marker:text-gray-600">
                    <li>Go to <a href="https://www.google.com/mymaps" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 underline">Google My Maps</a>.</li>
                    <li>Click "Create a new map" then "Import" and upload your CSV or KML file.</li>
                    {results.csv.length > 1 && (
                      <li className="font-semibold text-blue-900">
                        <strong>Multiple files:</strong> Import each file as a separate layer. After importing the first file, click "Add layer" in the left sidebar, then import the next file. Repeat for all {results.csv.length} files.
                      </li>
                    )}
                    <li>Follow the prompts to select <strong className="text-gray-900">Latitude/Longitude</strong> for positioning and <strong className="text-gray-900">Name</strong> for the marker title.</li>
                  </ol>
                  {results.totalCount > 10000 && (
                    <div className="mt-4 p-4 bg-red-50 border-l-4 border-red-500 rounded text-red-800 shadow-sm">
                      <p className="font-semibold text-red-900 text-base flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                        My Maps Total Limit Warning: {results.totalCount.toLocaleString()} records detected
                      </p>
                      <p className="mt-2">Google My Maps has a <strong>10,000 record maximum per map</strong>. You have {results.totalCount.toLocaleString()} records. Consider filtering your data further or creating multiple separate maps.</p>
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
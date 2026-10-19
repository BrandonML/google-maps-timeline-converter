import { useState, useRef, useEffect, type ChangeEvent, type DragEvent } from 'react';
import {
  Upload, Download, MapPin, Activity, FileJson, Info, CircleAlert, ChevronDown, X, RotateCcw, Coffee,
  Check, Lock, Layers, Package, Terminal,
} from 'lucide-react';
import { OptionRow } from './components/OptionRow';
import { sniffFileFormat, type FileFormat } from './lib/detectFormat';
import { formatFileSize, percentRemoved, pluralize } from './lib/format';

// Add Global Types for GA4 and JSZip
declare global {
  interface Window {
    gtag: (command: 'event' | 'config' | 'js', eventNameOrId: string, eventParameters?: Record<string, unknown>) => void;
    dataLayer: unknown[];
  }
}

declare const JSZip: {
  new(): JSZipInstance;
};

interface JSZipInstance {
  file(name: string, content: string): void;
  generateAsync(options: { type: 'blob' }): Promise<Blob>;
}

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
  fileCount: number;
  cleaningStats: {
    removedActivities: number;
    removedDuplicates: number;
    totalRemoved: number;
  };
  processingLogs: string[];
}

interface FileEntry {
  id: number;
  file: File;
  format: FileFormat | 'checking';
}

interface AppError {
  message: string;
  // Set when a specific uploaded file caused the error, to power the "remove and retry" action.
  fileName?: string;
  fileId?: number;
}

type ZipFormat = 'csv' | 'kml';
type SupportPlacement = 'results_card' | 'header_pill' | 'footer_link';

const BUY_ME_A_COFFEE_URL = 'https://buymeacoffee.com/scivolette';
const ISSUES_URL = 'https://github.com/BrandonML/google-maps-timeline-converter/issues';

const FORMAT_TAGS: Record<FileEntry['format'], { label: string; className: string } | null> = {
  checking: null,
  pre2024: { label: 'Pre-2024', className: 'bg-divider text-body' },
  current: { label: '2024+', className: 'bg-success-tint text-[oklch(0.45_0.12_160)]' },
  unverified: { label: 'JSON', className: 'bg-divider text-body' },
  unknown: { label: 'Unknown', className: 'bg-danger-tint text-danger-ink' },
};

const linkClass = 'text-link underline underline-offset-2 hover:text-link-hover';
const cardClass = 'rounded-2xl border border-line bg-white';
const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-4 w-4 animate-spin-fast rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

interface ConversionResult {
  timelineObjects: TimelineObject[];
  logs: string[];
}

interface CleanDataResult {
  cleaned: TimelineObject[];
  stats: {
    removedActivities: number;
    removedDuplicates: number;
    totalRemoved: number;
  };
}

interface NewFormatData {
  [key: string]: unknown;
  semanticSegments?: unknown[];
}

interface OldFormatData {
  timelineObjects?: TimelineObject[];
}

export default function App() {
  const [isIntroExpanded, setIsIntroExpanded] = useState(true);
  // Once dismissed the support card stays hidden for the session, including after Start over.
  const [isSupportDismissed, setIsSupportDismissed] = useState(false);
  const [hasDownloaded, setHasDownloaded] = useState(false);
  const [supportCardDownloadCount, setSupportCardDownloadCount] = useState(0);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [removeActivities, setRemoveActivities] = useState(true);
  const [removeDuplicates, setRemoveDuplicates] = useState(true);
  const [splitFiles, setSplitFiles] = useState(true);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [loadingZipFormat, setLoadingZipFormat] = useState<ZipFormat | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const supportCardRef = useRef<HTMLElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const nextFileId = useRef(0);

  const showSupportCard = results !== null && !isSupportDismissed;

  // Fires once each time the card goes from hidden to visible, not on re-renders.
  useEffect(() => {
    if (showSupportCard && window.gtag) {
      window.gtag('event', 'support_card_view', {
        promotion_name: 'buy_me_a_coffee',
        placement: 'results_card',
      });
    }
  }, [showSupportCard]);

  // Runs after every download (even if the card is already open) so it is never off screen.
  useEffect(() => {
    if (supportCardDownloadCount === 0) return;
    supportCardRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'nearest',
    });
  }, [supportCardDownloadCount]);

  // The input group (and the focused Convert button) disappears when results arrive,
  // so move focus and scroll to the results instead of dropping the user at the page's end.
  useEffect(() => {
    if (!results) return;
    const heading = resultsHeadingRef.current;
    if (!heading) return;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }, [results]);

  const registerDownload = () => {
    setHasDownloaded(true);
    setSupportCardDownloadCount((count) => count + 1);
  };

  const dismissSupportCard = () => {
    setIsSupportDismissed(true);
    if (window.gtag) {
      window.gtag('event', 'support_card_dismiss', {
        promotion_name: 'buy_me_a_coffee',
        placement: 'results_card',
      });
    }
  };

  const trackSupportClick = (placement: SupportPlacement) => {
    if (window.gtag) {
      window.gtag('event', 'support_cta_click', {
        promotion_name: 'buy_me_a_coffee',
        placement,
      });
    }
  };

  const parseLatLng = (latLngStr?: string): { lat: number; lng: number } => {
    if (!latLngStr) return { lat: 0, lng: 0 };

    if (latLngStr.startsWith('geo:')) {
      const coords = latLngStr.replace('geo:', '').split(',');
      return { lat: parseFloat(coords[0]), lng: parseFloat(coords[1]) };
    }

    const parts = latLngStr.replace('°', '').split(', ');
    return { lat: parseFloat(parts[0]), lng: parseFloat(parts[1]) };
  };

  const convertNewToOld = (newData: NewFormatData, filename: string): ConversionResult => {
    const timelineObjects: TimelineObject[] = [];
    const logs: string[] = [];

    let segments: unknown[] = [];

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

    segments.forEach((segment: unknown, index: number) => {
      try {
        const seg = segment as Record<string, unknown>;
        
        if (seg.visit) {
          const visit = seg.visit as Record<string, unknown>;
          const topCandidate = (visit.topCandidate || {}) as Record<string, unknown>;

          let lat = 0, lng = 0;
          if (typeof topCandidate.placeLocation === 'string') {
            const coords = parseLatLng(topCandidate.placeLocation);
            lat = coords.lat;
            lng = coords.lng;
          } else if (topCandidate.placeLocation && typeof topCandidate.placeLocation === 'object') {
            const placeLocation = topCandidate.placeLocation as Record<string, unknown>;
            if (typeof placeLocation.latLng === 'string') {
              const coords = parseLatLng(placeLocation.latLng);
              lat = coords.lat;
              lng = coords.lng;
            }
          }

          timelineObjects.push({
            placeVisit: {
              location: {
                latitudeE7: Math.round(lat * 1e7),
                longitudeE7: Math.round(lng * 1e7),
                placeId: (topCandidate.placeId as string) || '',
                name: (topCandidate.placeLocation && typeof topCandidate.placeLocation === 'object' 
                  ? (topCandidate.placeLocation as Record<string, unknown>).name 
                  : '') as string || '',
                address: (topCandidate.placeLocation && typeof topCandidate.placeLocation === 'object'
                  ? (topCandidate.placeLocation as Record<string, unknown>).address
                  : '') as string || '',
                semanticType: (topCandidate.semanticType as string) || 'TYPE_UNKNOWN'
              },
              duration: {
                startTimestamp: (seg.startTime || seg.startTimestamp) as string,
                endTimestamp: (seg.endTime || seg.endTimestamp) as string
              },
              centerLatE7: Math.round(lat * 1e7),
              centerLngE7: Math.round(lng * 1e7),
              visitConfidence: Math.round((parseFloat((visit.probability as string) || '0') || 0) * 100)
            }
          });
        } else if (seg.activity) {
          const activity = seg.activity as Record<string, unknown>;

          let startCoords = { lat: 0, lng: 0 };
          let endCoords = { lat: 0, lng: 0 };

          if (typeof activity.start === 'string') {
            startCoords = parseLatLng(activity.start);
          } else if (activity.start && typeof activity.start === 'object') {
            const start = activity.start as Record<string, unknown>;
            if (typeof start.latLng === 'string') {
              startCoords = parseLatLng(start.latLng);
            }
          }

          if (typeof activity.end === 'string') {
            endCoords = parseLatLng(activity.end);
          } else if (activity.end && typeof activity.end === 'object') {
            const end = activity.end as Record<string, unknown>;
            if (typeof end.latLng === 'string') {
              endCoords = parseLatLng(end.latLng);
            }
          }

          const topCandidate = (activity.topCandidate || {}) as Record<string, unknown>;

          const activities = topCandidate.type ? [{
            activityType: topCandidate.type as string,
            probability: parseFloat((topCandidate.probability as string) || '0') || 0
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
                startTimestamp: (seg.startTime || seg.startTimestamp) as string,
                endTimestamp: (seg.endTime || seg.endTimestamp) as string
              },
              distance: parseFloat((activity.distanceMeters as string) || '0') || 0,
              activities: activities
            }
          });
        } else if (seg.timelinePath) {
          const path = seg.timelinePath as Array<{ point: string }>;
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
                  startTimestamp: (seg.startTime || seg.startTimestamp) as string,
                  endTimestamp: (seg.endTime || seg.endTimestamp) as string
                }
              }
            });
          }
        }
      } catch (err) {
        const error = err as Error;
        logs.push(`[${filename}] ERROR processing segment ${index}: ${error.message}`);
      }
    });

    logs.push(`[${filename}] Successfully converted ${timelineObjects.length} objects`);
    return { timelineObjects, logs };
  };

const cleanData = (timelineObjects: TimelineObject[]): CleanDataResult => {
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

      // Helper to score records: Name is most valuable, Address is second.
      const getRecordScore = (obj: TimelineObject): number => {
        const loc = obj.placeVisit?.location;
        if (!loc) return 0;
        
        let score = 0;
        if (loc.name && loc.name.trim() !== '') score += 2;
        if (loc.address && loc.address.trim() !== '') score += 1;
        return score;
      };

      // Step 1: Deduplicate by PlaceId
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
          // Sort descending by score and grab the winner
          const sortedGroup = [...group].sort((a, b) => getRecordScore(b) - getRecordScore(a));
          recordsAfterPlaceIdDedup.push(sortedGroup[0]);
        }
      });

      // Step 2: Deduplicate by Coordinates
      const allRecordsAfterPlaceIdDedup = [...recordsAfterPlaceIdDedup, ...noPlaceIdRecords];
      const latLngMap = new Map<string, TimelineObject[]>();

      let activityCounter = 0;
      allRecordsAfterPlaceIdDedup.forEach((obj) => {
        if (!obj.placeVisit) {
          latLngMap.set(`activity-${activityCounter++}`, [obj]);
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
          // Sort descending by score and grab the winner
          const sortedGroup = [...group].sort((a, b) => getRecordScore(b) - getRecordScore(a));
          finalRecords.push(sortedGroup[0]);
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
        default: return c;
      }
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

  const addFiles = (newFiles: File[]) => {
    if (newFiles.length === 0) return;

    const entries: FileEntry[] = newFiles.map(file => ({ id: nextFileId.current++, file, format: 'checking' }));
    setFiles(prevFiles => [...prevFiles, ...entries]);
    setError(null);

    // Label each file (Pre-2024 / 2024+) from a small sample of its contents.
    entries.forEach(entry => {
      void sniffFileFormat(entry.file).then(format => {
        setFiles(prevFiles => prevFiles.map(f => (f.id === entry.id ? { ...f, format } : f)));
      });
    });
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files ? Array.from(e.target.files) : []);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // Ignore leave events fired when the pointer merely moves onto a child element.
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      // Filter out non-JSON files
      const jsonFiles = droppedFiles.filter(file => file.name.toLowerCase().endsWith('.json') || file.type === 'application/json');

      addFiles(jsonFiles);
    }
  };

  const removeFile = (idToRemove: number) => {
    setFiles(prevFiles => prevFiles.filter(f => f.id !== idToRemove));
    if (error?.fileId === idToRemove) setError(null);
  };

  const clearFiles = () => {
    setFiles([]);
    setError(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const startOver = () => {
    clearFiles();
    setResults(null);
    setHasDownloaded(false);
    setSupportCardDownloadCount(0);
    setIsLogsOpen(false);
    setIsIntroExpanded(true);
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  const retryWithoutFailedFile = () => {
    if (error?.fileId === undefined) return;

    const remaining = files.filter(f => f.id !== error.fileId);
    setFiles(remaining);
    setError(null);

    if (window.gtag) {
      window.gtag('event', 'error_retry_click', {
        remaining_file_count: remaining.length,
      });
    }

    if (remaining.length > 0) {
      void processFiles(remaining);
    }
  };

  const processFiles = async (entries: FileEntry[] = files) => {
    if (entries.length === 0) {
      setError({ message: 'Please upload at least one file' });
      return;
    }

    if (window.gtag) {
      window.gtag('event', 'process_files', {
        file_count: entries.length,
      });
    }

    setProcessing(true);
    setError(null);

    let failedFile: { id: number; name: string } | undefined;

    try {
      let combinedTimelineObjects: TimelineObject[] = [];
      const allLogs: string[] = [];
      allLogs.push(`=== Processing Started at ${new Date().toISOString()} ===`);
      allLogs.push(`Total files to process: ${entries.length}`);

      for (const { id, file } of entries) {
        try {
          allLogs.push(`\n--- Processing file: ${file.name} ---`);
          const text = await file.text();

          let data: unknown;
          try {
            data = JSON.parse(text);
            allLogs.push(`[${file.name}] Successfully parsed JSON`);
          } catch (parseErr) {
            const error = parseErr as Error;
            allLogs.push(`[${file.name}] ERROR: Failed to parse JSON - ${error.message}`);
            throw new Error(`Failed to parse ${file.name}: ${error.message}`);
          }

          if (Array.isArray(data)) {
            allLogs.push(`[${file.name}] Data is an array with ${data.length} elements`);
          } else if (typeof data === 'object' && data !== null) {
            allLogs.push(`[${file.name}] Data is an object with keys: ${Object.keys(data).join(', ')}`);
          }

          const dataObj = data as NewFormatData | OldFormatData;

          if (Array.isArray(data) || (dataObj as NewFormatData).semanticSegments) {
            const { timelineObjects, logs } = convertNewToOld(dataObj as NewFormatData, file.name);
            allLogs.push(...logs);
            combinedTimelineObjects = [...combinedTimelineObjects, ...timelineObjects];
          } else if ((dataObj as OldFormatData).timelineObjects) {
            allLogs.push(`[${file.name}] Detected old format (timelineObjects)`);
            const oldFormatData = (dataObj as OldFormatData).timelineObjects;
            allLogs.push(`[${file.name}] Found ${oldFormatData?.length || 0} timeline objects`);
            combinedTimelineObjects = [...combinedTimelineObjects, ...(oldFormatData || [])];
          } else {
            const errorMsg = `File ${file.name} has unrecognized format. Expected: array (iOS), semanticSegments (Android), or timelineObjects (old format). Found keys: ${Object.keys(dataObj || {}).join(', ')}`;
            allLogs.push(`[${file.name}] ERROR: ${errorMsg}`);
            throw new Error(errorMsg);
          }
        } catch (fileErr) {
          failedFile = { id, name: file.name };
          const error = fileErr as Error;
          allLogs.push(`[${file.name}] FATAL ERROR: ${error.message}`);
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

      const csvFiles: string[] = [];
      const kmlFiles: string[] = [];

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
        fileCount: entries.length,
        cleaningStats: stats,
        processingLogs: allLogs
      });
      setIsIntroExpanded(false);

      if (window.gtag) {
        window.gtag('event', 'processing_complete', {
          total_records: cleaned.length,
          original_records: combinedTimelineObjects.length,
          visit_count: cleaned.filter(o => o.placeVisit).length,
          activity_count: cleaned.filter(o => o.activitySegment).length,
          csv_file_count: csvFiles.length,
        });
      }
    } catch (err) {
      const error = err as Error;
      const errorMsg = `Error processing files: ${error.message}`;
      setError({ message: errorMsg, fileName: failedFile?.name, fileId: failedFile?.id });
      console.error('Processing error:', err);
      if (window.gtag) {
        window.gtag('event', 'exception', {
          description: errorMsg,
          fatal: false,
        });
      }
    } finally {
      setProcessing(false);
    }
  };

  const downloadFile = (content: string, filename: string, type: string, showSupport = true) => {
    if (window.gtag) {
      const fileExtension = filename.split('.').pop() || 'unknown';
      window.gtag('event', 'file_download', {
        file_extension: fileExtension,
        file_name: filename,
        is_multi_file_zip: false,
      });
    }

    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
    if (showSupport) registerDownload();
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

  const downloadZip = async (files: string[], baseName: string, extension: ZipFormat) => {
    if (window.gtag) {
      window.gtag('event', 'file_download', {
        file_extension: 'zip',
        file_name: `${baseName}.zip`,
        is_multi_file_zip: true,
        contained_file_extension: extension,
        contained_file_count: files.length,
      });
    }

    setError(null);
    setLoadingZipFormat(extension);
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
      registerDownload();
    } catch (err) {
      console.error('Error creating zip:', err);
      setError({ message: 'Failed to create zip file. Please try downloading files individually.' });
      if (window.gtag) {
        window.gtag('event', 'exception', {
          description: 'Failed to create zip file',
          fatal: false,
        });
      }
    } finally {
      setLoadingZipFormat(null);
    }
  };

  const hasFiles = files.length > 0;
  const failedFileLabel = error?.fileId !== undefined && error.fileName ? error.fileName : null;

  const percentOfOriginal = (count: number): string =>
    results && results.originalCount > 0 ? `${(count / results.originalCount) * 100}%` : '0%';

  const convertLabel = processing
    ? `Processing ${pluralize(files.length, 'file')}…`
    : hasFiles
      ? `Convert ${pluralize(files.length, 'file')}`
      : 'Add files to convert';

  const renderZipButtonContent = (format: ZipFormat, parts: number) =>
    loadingZipFormat === format ? (
      <>
        <Spinner />
        Preparing zip…
      </>
    ) : (
      <>
        <Download size={15} aria-hidden="true" />
        {parts > 1 ? `Download ${parts} files` : 'Download'}
      </>
    );

  const renderResults = (r: Results) => {
    const parts = r.csv.length;
    const isSplit = parts > 1;
    const reduction = percentRemoved(r.cleaningStats.totalRemoved, r.originalCount);

    return (
      <div className="mt-3 flex flex-col gap-5">
        {/* Summary */}
        <section className={`${cardClass} flex flex-col gap-5 p-6`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-success-tint text-success">
                <Check size={18} aria-hidden="true" />
              </div>
              <div>
                <h2
                  ref={resultsHeadingRef}
                  tabIndex={-1}
                  className="m-0 scroll-mt-6 text-xl font-bold tracking-[-0.02em] outline-none"
                >
                  {pluralize(r.totalCount, 'record')} ready
                </h2>
                <p className="mt-[3px] text-sm text-muted">
                  {r.fileCount > 1 ? 'Merged' : 'Converted'} {pluralize(r.fileCount, 'file')} · {reduction}% smaller than the original
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={startOver}
              className={`flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-[oklch(0.9_0.005_260)] bg-white px-3 py-2 text-[13px] font-medium text-body hover:bg-tile ${focusRing}`}
            >
              <RotateCcw size={14} aria-hidden="true" />
              Start over
            </button>
          </div>

          <div className="flex flex-col gap-2.5">
            <div aria-hidden="true" className="flex h-2.5 overflow-hidden rounded-full bg-divider">
              <div className="bg-primary" style={{ width: percentOfOriginal(r.totalCount) }} />
              <div className="bg-[oklch(0.78_0.08_262)]" style={{ width: percentOfOriginal(r.cleaningStats.removedDuplicates) }} />
              <div className="bg-[oklch(0.9_0.02_262)]" style={{ width: percentOfOriginal(r.cleaningStats.removedActivities) }} />
            </div>
            <div className="flex flex-wrap gap-x-[18px] gap-y-1.5 text-[13px] text-body">
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2 w-2 rounded-[2px] bg-primary" />
                Kept <strong className="font-mono font-medium text-ink">{r.totalCount.toLocaleString()}</strong>
              </span>
              {r.cleaningStats.removedDuplicates > 0 && (
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-2 w-2 rounded-[2px] bg-[oklch(0.78_0.08_262)]" />
                  Duplicates removed <strong className="font-mono font-medium text-ink">{r.cleaningStats.removedDuplicates.toLocaleString()}</strong>
                </span>
              )}
              {r.cleaningStats.removedActivities > 0 && (
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-2 w-2 rounded-[2px] bg-[oklch(0.9_0.02_262)]" />
                  Activities removed <strong className="font-mono font-medium text-ink">{r.cleaningStats.removedActivities.toLocaleString()}</strong>
                </span>
              )}
              <span className="ml-auto">
                of <strong className="font-mono font-medium text-ink">{r.originalCount.toLocaleString()}</strong> original
              </span>
            </div>
          </div>

          <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-px overflow-hidden rounded-xl border border-[oklch(0.93_0.005_260)] bg-[oklch(0.93_0.005_260)]">
            {[
              { label: 'Place visits', value: r.visitCount, Icon: MapPin },
              { label: 'Movement segments', value: r.activityCount, Icon: Activity },
              { label: 'My Maps layers', value: parts, Icon: Layers },
            ].map(({ label, value, Icon }) => (
              <div key={label} className="bg-white px-3.5 py-3">
                <dt className="flex items-center gap-[5px] text-xs text-muted">
                  <Icon size={12} aria-hidden="true" />
                  {label}
                </dt>
                <dd className="m-0 mt-1 font-mono text-xl font-medium">{value.toLocaleString()}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Download */}
        <section className={`${cardClass} flex flex-col gap-4 p-6`}>
          <h2 className="m-0 text-[17px] font-semibold">Download</h2>

          {isSplit && (
            <div className="flex items-start gap-2.5 rounded-[10px] bg-primary-tint px-3.5 py-3 text-[13.5px] leading-normal text-[oklch(0.38_0.1_262)]">
              <Package size={16} className="mt-0.5 flex-none" aria-hidden="true" />
              <span>
                Split into <strong>{parts} files</strong> of ≤2,000 records each. CSV and KML download as a .zip. Import each file as its own layer.
              </span>
            </div>
          )}

          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
            <div className="flex flex-col gap-2.5 rounded-xl border-[1.5px] border-primary bg-[oklch(0.985_0.008_262)] p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[15px] font-semibold">CSV</span>
                <span className="rounded-full bg-[oklch(0.94_0.04_262)] px-2 py-0.5 text-[11px] font-semibold text-link">Recommended</span>
              </div>
              <p className="m-0 flex-1 text-[13px] leading-normal text-muted">Google My Maps, Excel and Sheets</p>
              <button
                type="button"
                onClick={() => (isSplit
                  ? downloadZip(r.csv, 'timeline_converted', 'csv')
                  : downloadFile(r.csv[0], 'timeline_converted.csv', 'text/csv'))}
                disabled={loadingZipFormat !== null}
                className={`flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[9px] bg-primary text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-70 ${focusRing}`}
              >
                {renderZipButtonContent('csv', parts)}
              </button>
            </div>

            <div className="flex flex-col gap-2.5 rounded-xl border border-line p-4">
              <span className="font-mono text-[15px] font-semibold">KML</span>
              <p className="m-0 flex-1 text-[13px] leading-normal text-muted">Google Earth and other mapping software</p>
              <button
                type="button"
                onClick={() => (isSplit
                  ? downloadZip(r.kml, 'timeline_converted', 'kml')
                  : downloadFile(r.kml[0], 'timeline_converted.kml', 'application/vnd.google-earth.kml+xml'))}
                disabled={loadingZipFormat !== null}
                className={`flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[9px] border border-[oklch(0.88_0.005_260)] bg-white text-sm font-semibold text-[oklch(0.25_0.02_260)] hover:bg-tile disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`}
              >
                {renderZipButtonContent('kml', parts)}
              </button>
            </div>

            <div className="flex flex-col gap-2.5 rounded-xl border border-line p-4">
              <span className="font-mono text-[15px] font-semibold">JSON</span>
              <p className="m-0 flex-1 text-[13px] leading-normal text-muted">Permanent backup in the unified Google format</p>
              <button
                type="button"
                onClick={() => downloadFile(r.oldFormatJson, 'timeline_converted.json', 'application/json')}
                className={`flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[9px] border border-[oklch(0.88_0.005_260)] bg-white text-sm font-semibold text-[oklch(0.25_0.02_260)] hover:bg-tile ${focusRing}`}
              >
                <Download size={15} aria-hidden="true" />
                Download
              </button>
            </div>
          </div>

          {loadingZipFormat !== null && (
            <p role="status" className="m-0 text-center text-[13px] text-muted">
              Loading zip library… this only happens once.
            </p>
          )}

          <p className="m-0 flex gap-2 text-[13px] leading-normal text-muted">
            <Info size={14} className="mt-0.5 flex-none" aria-hidden="true" />
            <span>
              Records from <code className="rounded bg-divider px-[5px] py-px font-mono text-xs">Timeline.json</code> don't include place names. Only the older format has them.
            </span>
          </p>
        </section>

        {/* Support */}
        {showSupportCard && (
          <section
            ref={supportCardRef}
            role="region"
            aria-label="Support this tool"
            className="relative flex scroll-mb-6 flex-wrap items-center gap-[18px] rounded-2xl border border-[oklch(0.9_0.1_100)] bg-[oklch(0.975_0.05_100)] pt-7 pr-[52px] pb-6 pl-6"
          >
            <button
              type="button"
              onClick={dismissSupportCard}
              aria-label="Dismiss"
              className={`absolute top-2 right-2 flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-full text-[oklch(0.45_0.04_90)] before:absolute before:-inset-2 before:content-[''] hover:bg-[oklch(0.94_0.07_100)] ${focusRing}`}
            >
              <X size={12} aria-hidden="true" />
            </button>
            <div className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-full bg-coffee text-ink">
              <Coffee size={26} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-[1_1_260px]">
              <h3 className="m-0 text-[17px] font-bold tracking-[-0.01em]">
                {hasDownloaded ? 'Your download has started' : 'Saved you an hour of cleanup?'}
              </h3>
              <p className="m-0 mt-1 text-sm leading-[1.55] text-pretty text-[oklch(0.38_0.03_80)]">
                This tool is free, ad-free and built by one person. If it saved you an hour of cleanup, a coffee keeps it running.
              </p>
            </div>
            <a
              // Re-keyed on every download so the pulse animation restarts each time.
              key={supportCardDownloadCount}
              href={BUY_ME_A_COFFEE_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackSupportClick('results_card')}
              className={`inline-flex h-[46px] max-w-60 flex-[1_0_auto] items-center justify-center gap-2 rounded-full bg-coffee px-[22px] text-[15px] font-bold text-[oklch(0.2_0.02_260)] shadow-[0_2px_0_oklch(0.75_0.14_90)] hover:bg-coffee-hover ${focusRing} ${
                hasDownloaded ? 'motion-safe:animate-ring' : ''
              }`}
            >
              <Coffee size={18} aria-hidden="true" />
              Buy me a coffee
            </a>
          </section>
        )}

        {/* My Maps steps */}
        <section className={`${cardClass} flex flex-col gap-3.5 p-6`}>
          <h2 className="m-0 text-[17px] font-semibold">Make your map in Google My Maps</h2>
          <ol className="m-0 flex list-none flex-col gap-3 p-0 text-sm leading-[1.55] text-body">
            <li className="flex gap-3">
              <span className="h-[22px] w-[22px] flex-none rounded-full bg-divider text-center font-mono text-xs leading-[22px] font-medium text-body">1</span>
              <span>Open <a href="https://www.google.com/mymaps" target="_blank" rel="noopener noreferrer" className={linkClass}>Google My Maps</a> and click <strong className="font-semibold text-ink">Create a new map → Import</strong>.</span>
            </li>
            <li className="flex gap-3">
              <span className="h-[22px] w-[22px] flex-none rounded-full bg-divider text-center font-mono text-xs leading-[22px] font-medium text-body">2</span>
              <span>Upload your CSV or KML. Pick <strong className="font-semibold text-ink">Latitude/Longitude</strong> for position and <strong className="font-semibold text-ink">Name</strong> for marker titles.</span>
            </li>
            {isSplit && (
              <li className="flex gap-3">
                <span className="h-[22px] w-[22px] flex-none rounded-full bg-[oklch(0.94_0.04_262)] text-center font-mono text-xs leading-[22px] font-medium text-[oklch(0.45_0.2_262)]">3</span>
                <span><strong className="font-semibold text-ink">Multiple files:</strong> after the first import, click <strong className="font-semibold text-ink">Add layer</strong> and import the next file. Repeat for all {parts}.</span>
              </li>
            )}
          </ol>
          {r.totalCount > 10000 && (
            <div role="alert" className="flex gap-2.5 rounded-[10px] bg-danger-tint px-3.5 py-3 text-[13.5px] leading-normal text-danger-ink">
              <CircleAlert size={16} className="mt-0.5 flex-none text-danger" aria-hidden="true" />
              <span><strong>Over the My Maps limit.</strong> One map holds up to 10,000 records; you have {r.totalCount.toLocaleString()}. Filter further or spread layers across multiple maps.</span>
            </div>
          )}
        </section>

        {/* Processing log */}
        <section className="overflow-hidden rounded-2xl bg-[oklch(0.2_0.015_260)]">
          <button
            type="button"
            onClick={() => setIsLogsOpen(!isLogsOpen)}
            aria-expanded={isLogsOpen}
            aria-controls="processing-log"
            className={`flex w-full cursor-pointer items-center justify-between px-5 py-3.5 text-[oklch(0.85_0.01_260)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white`}
          >
            <span className="flex items-center gap-2.5 text-sm font-medium">
              <Terminal size={16} aria-hidden="true" />
              Processing log
              <span className="font-mono text-xs font-normal text-[oklch(0.66_0.01_260)]">{r.processingLogs.length} lines</span>
            </span>
            <ChevronDown size={16} aria-hidden="true" className={`transition-transform duration-200 ${isLogsOpen ? 'rotate-180' : ''}`} />
          </button>
          {isLogsOpen && (
            <div id="processing-log" className="flex flex-col gap-3 px-5 pb-5">
              <p className="m-0 text-[13px] text-[oklch(0.72_0.01_260)]">
                If something looks wrong, download this log and share it when reporting an issue.
              </p>
              <div className="max-h-[300px] overflow-y-auto rounded-[10px] bg-[oklch(0.15_0.012_260)] px-3.5 py-3 font-mono text-xs leading-[1.7] text-[oklch(0.78_0.01_260)]">
                {r.processingLogs.map((log, i) => (
                  <div
                    key={i}
                    className={`wrap-anywhere whitespace-pre-wrap ${
                      log.includes('ERROR') ? 'text-[oklch(0.72_0.16_25)]' : log.includes('===') ? 'text-[oklch(0.86_0.12_90)]' : ''
                    }`}
                  >
                    {log}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => downloadFile(r.processingLogs.join('\n'), 'processing_logs.txt', 'text/plain', false)}
                className="flex h-9 cursor-pointer items-center gap-2 self-start rounded-[9px] border border-[oklch(0.4_0.015_260)] px-3.5 text-[13px] font-medium text-[oklch(0.9_0.01_260)] hover:bg-[oklch(0.26_0.015_260)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <Download size={14} aria-hidden="true" />
                Download log
              </button>
            </div>
          )}
        </section>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-page px-5 pt-12 pb-8 font-sans text-ink">
      <div className="mx-auto flex max-w-[1040px] flex-col gap-5">

        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 pb-3">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-primary text-white">
              <MapPin size={22} aria-hidden="true" />
            </div>
            <div>
              <h1 className="m-0 text-[22px] leading-[1.2] font-bold tracking-[-0.02em]">Google Maps Timeline Converter</h1>
              <p className="m-0 mt-0.5 text-sm text-muted">Merge, clean and convert Google Maps location history</p>
            </div>
          </div>
          <a
            href={BUY_ME_A_COFFEE_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackSupportClick('header_pill')}
            className={`inline-flex items-center gap-2 rounded-full border border-line bg-white py-[7px] pr-3 pl-2 text-[13px] font-medium text-body no-underline hover:border-[#E6C700] hover:bg-[oklch(0.985_0.03_100)] hover:text-ink ${focusRing}`}
          >
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-coffee text-ink">
              <Coffee size={13} aria-hidden="true" />
            </span>
            Free &amp; ad-free · Support
          </a>
        </header>

        <p className="-mt-2 mb-1 text-[17px] leading-[1.6] text-pretty text-body">
          Google changed the Timeline format in 2024, splitting your history between old Takeout files and a new phone export. This tool merges both into one clean file you can map, sized to fit Google My Maps' 2,000-records-per-layer limit. Your files never leave your browser.
        </p>

        {/* How it works */}
        <div className={`${cardClass} overflow-hidden`}>
          <button
            type="button"
            onClick={() => setIsIntroExpanded(!isIntroExpanded)}
            aria-expanded={isIntroExpanded}
            aria-controls="how-it-works"
            className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-4 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          >
            <span className="flex items-center gap-2.5 text-[15px] font-semibold">
              <Info size={18} className="flex-none text-primary" aria-hidden="true" />
              How it works
            </span>
            <span className="flex items-center gap-2.5 text-[13px] text-muted">
              <span className="flex items-center gap-1.5">
                <Lock size={14} aria-hidden="true" />
                Runs in your browser
              </span>
              <ChevronDown size={18} aria-hidden="true" className={`transition-transform duration-200 ${isIntroExpanded ? 'rotate-180' : ''}`} />
            </span>
          </button>

          {isIntroExpanded && (
            <div id="how-it-works" className="flex flex-col gap-4 px-5 pt-1 pb-5">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
                <div className="flex flex-col gap-2 rounded-xl bg-tile p-4">
                  <span className="font-mono text-xs font-medium text-primary">01 · PRE-2024</span>
                  <p className="m-0 text-[15px] font-semibold">Old data from Takeout</p>
                  <p className="m-0 text-sm leading-[1.55] text-muted">
                    Export "Location History" from <a href="https://takeout.google.com/" target="_blank" rel="noopener noreferrer" className={linkClass}>Google Takeout</a>. Find files like <code className="rounded border border-line bg-white px-[5px] py-px font-mono text-[13px]">2018_JANUARY.json</code>.
                  </p>
                </div>
                <div className="flex flex-col gap-2 rounded-xl bg-tile p-4">
                  <span className="font-mono text-xs font-medium text-primary">02 · 2024+</span>
                  <p className="m-0 text-[15px] font-semibold">New data from your phone</p>
                  <p className="m-0 text-sm leading-[1.55] text-muted">
                    Settings → Location → Location Services → Timeline → <strong className="font-semibold text-[oklch(0.25_0.02_260)]">Export Timeline Data</strong>. Copy <code className="rounded border border-line bg-white px-[5px] py-px font-mono text-[13px]">Timeline.json</code> to your computer.
                  </p>
                  <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-[oklch(0.96_0.025_25)] px-2 py-[3px] text-xs font-medium text-danger-ink">
                    <CircleAlert size={12} aria-hidden="true" />
                    Not in Takeout, phone only
                  </span>
                </div>
                <div className="flex flex-col gap-2 rounded-xl bg-tile p-4">
                  <span className="font-mono text-xs font-medium text-primary">03 · CONVERT</span>
                  <p className="m-0 text-[15px] font-semibold">Upload everything at once</p>
                  <p className="m-0 text-sm leading-[1.55] text-muted">
                    Drop <strong className="font-semibold text-[oklch(0.25_0.02_260)]">all</strong> your old and new JSON files below, process, then download.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input group: hidden once results exist */}
        {!results && (
          <div className="flex flex-col gap-5">
            <section className={`${cardClass} flex flex-col gap-4 p-5`}>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="m-0 text-[17px] font-semibold tracking-[-0.01em]">Your timeline files</h2>
                {hasFiles && (
                  <button
                    type="button"
                    onClick={clearFiles}
                    className={`cursor-pointer rounded p-0 text-[13px] font-medium text-muted hover:text-danger-ink ${focusRing}`}
                  >
                    Clear all
                  </button>
                )}
              </div>

              <div
                role="button"
                tabIndex={0}
                aria-label="Add timeline JSON files"
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`flex cursor-pointer flex-col items-center gap-2.5 rounded-xl border-[1.5px] border-dashed text-center transition-all duration-150 ${focusRing} ${
                  hasFiles ? 'p-5' : 'px-5 py-9'
                } ${
                  isDragging
                    ? 'border-primary bg-primary-tint'
                    : 'border-[oklch(0.86_0.008_260)] bg-page hover:border-[oklch(0.7_0.1_262)]'
                }`}
              >
                <input
                  type="file"
                  multiple
                  accept=".json"
                  onChange={handleFileUpload}
                  ref={fileInputRef}
                  className="hidden"
                  tabIndex={-1}
                />
                <div className={`flex h-11 w-11 items-center justify-center rounded-full ${isDragging ? 'bg-primary text-white' : 'bg-white text-muted'}`}>
                  <Upload size={20} aria-hidden="true" />
                </div>
                <div>
                  <p className="m-0 text-[15px] font-semibold">{isDragging ? 'Drop to add files' : 'Drop your JSON files here'}</p>
                  <p className="m-0 mt-1 text-[13px] text-muted">
                    or <span className="font-medium text-link">browse</span> · .json files only
                  </p>
                </div>
              </div>

              {hasFiles && (
                <ul className="m-0 flex max-h-[220px] list-none flex-col overflow-x-hidden overflow-y-auto rounded-[10px] border border-line p-0">
                  {files.map(({ id, file, format }) => {
                    const tag = FORMAT_TAGS[format];
                    return (
                      <li key={id} className="flex items-center gap-2.5 border-b border-divider py-1 pr-1.5 pl-2.5 last:border-b-0">
                        <FileJson size={14} aria-hidden="true" className={`flex-none ${format === 'unknown' ? 'text-danger' : 'text-faint'}`} />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-body" title={file.name}>{file.name}</span>
                        {tag && (
                          <span className={`rounded-full px-1.5 py-px font-mono text-[10.5px] font-medium ${tag.className}`}>{tag.label}</span>
                        )}
                        <span className="w-[52px] text-right font-mono text-[11.5px] text-muted">{formatFileSize(file.size)}</span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removeFile(id); }}
                          aria-label={`Remove ${file.name}`}
                          title="Remove file"
                          className={`relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-faint before:absolute before:-inset-x-2 before:-inset-y-1 before:content-[''] hover:bg-danger-tint hover:text-danger-ink ${focusRing}`}
                        >
                          <X size={12} aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className={`${cardClass} px-5 py-2`}>
              <OptionRow
                title="Remove activity segments"
                description="Keep only places you stopped at. Ideal for maps."
                tip="Removes movement records (driving, walking, biking), leaving only visits. Dramatically reduces file size for tools like Google My Maps."
                checked={removeActivities}
                onChange={setRemoveActivities}
              />
              <OptionRow
                title="Remove duplicate visits"
                description="Merge repeat records at the same spot."
                tip="Matches by PlaceId or coordinates and keeps the record with the most detail, such as one with a name or address."
                checked={removeDuplicates}
                onChange={setRemoveDuplicates}
              />
              <OptionRow
                title="Split for Google My Maps"
                description="Create multiple files when over 2,000 records."
                tip="My Maps allows 2,000 records per layer. Example: 5,875 records → 3 files (2,000 + 2,000 + 1,875), each imported as its own layer."
                checked={splitFiles}
                onChange={setSplitFiles}
                isLast
              />
            </section>

            <button
              type="button"
              onClick={() => processFiles()}
              disabled={!hasFiles || processing}
              className={`flex h-[52px] w-full items-center justify-center gap-2.5 rounded-xl text-[15px] font-semibold transition-colors duration-150 disabled:cursor-not-allowed ${focusRing} ${
                processing
                  ? 'bg-primary text-white'
                  : hasFiles
                    ? 'cursor-pointer bg-ink text-white'
                    : 'bg-[oklch(0.93_0.005_260)] text-faint'
              }`}
            >
              {processing && <Spinner />}
              {convertLabel}
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div role="alert" className="flex gap-3 rounded-xl border border-danger-line bg-danger-tint p-4">
            <CircleAlert size={20} className="mt-px flex-none text-danger" aria-hidden="true" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <p className="m-0 text-[15px] font-semibold text-[oklch(0.4_0.15_25)] wrap-anywhere">
                {error.fileName ? `Couldn't read ${error.fileName}` : 'Something went wrong'}
              </p>
              <p className="m-0 text-[13.5px] leading-[1.55] text-danger-ink wrap-anywhere">{error.message}</p>
              {failedFileLabel && (
                <button
                  type="button"
                  onClick={retryWithoutFailedFile}
                  className={`mt-1 max-w-full cursor-pointer self-start rounded-lg border border-danger-line bg-white px-2.5 py-1.5 text-left text-[13px] font-medium text-danger-ink wrap-anywhere hover:bg-danger-tint ${focusRing}`}
                >
                  {files.length > 1 ? `Remove ${failedFileLabel} and retry` : `Remove ${failedFileLabel}`}
                </button>
              )}
              <p className="m-0 mt-1.5 text-[13px] text-danger-ink">
                Need to report an issue?{' '}
                <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-danger-ink underline underline-offset-2">
                  Open a GitHub issue
                </a>
              </p>
            </div>
          </div>
        )}

        {results && renderResults(results)}

        {/* Footer */}
        <footer className="mt-7 flex flex-wrap justify-between gap-2.5 border-t border-line pt-5 text-[13px] text-muted">
          <span>
            Built by <a href="https://www.facebook.com/scivolette" target="_blank" rel="noopener noreferrer" className="font-medium text-body">Brandon Scivolette</a> for travelers and data nerds.
          </span>
          <span className="flex gap-3.5">
            <a href="https://github.com/BrandonML/google-maps-timeline-converter" target="_blank" rel="noopener noreferrer" className="text-inherit">GitHub</a>
            <a href="https://linke.ro/brandon" target="_blank" rel="noopener noreferrer" className="text-inherit">Linke</a>
            <a href={BUY_ME_A_COFFEE_URL} target="_blank" rel="noopener noreferrer" onClick={() => trackSupportClick('footer_link')} className="text-inherit">Buy me a coffee</a>
          </span>
        </footer>
      </div>
    </div>
  );
}

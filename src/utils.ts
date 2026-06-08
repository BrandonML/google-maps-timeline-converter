export interface Location {
  latitudeE7: number;
  longitudeE7: number;
  placeId?: string;
  name?: string;
  address?: string;
  semanticType?: string;
}

export interface Duration {
  startTimestamp: string;
  endTimestamp: string;
}

export interface PlaceVisit {
  location: Location;
  duration: Duration;
  centerLatE7: number;
  centerLngE7: number;
  visitConfidence: number;
}

export interface ActivitySegment {
  startLocation: Partial<Location>;
  endLocation: Partial<Location>;
  duration: Duration;
  distance?: number;
  activities?: { activityType: string; probability: number }[];
}

export interface TimelineObject {
  placeVisit?: PlaceVisit;
  activitySegment?: ActivitySegment;
}

export const escapeXml = (unsafe: string): string => {
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

export const convertToKML = (data: TimelineObject[]): string => {
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

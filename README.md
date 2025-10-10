# Google Maps Timeline Converter

Use the app in your browser: https://brandonml.github.io/google-maps-timeline-converter/

## What Is This App?

Have you ever wanted to see all the places you've been on a map? Google Maps tracks your location history, but in 2024, Google changed how this data is stored and exported. This makes it difficult to:

- **Combine data from multiple accounts** (like your personal and work accounts)
- **Merge old and new timeline data** into one complete history
- **Import your data into mapping tools** like Google My Maps
- **Clean up duplicate records** to make the data manageable

This app solves these problems by converting, cleaning, and merging your Google Timeline data into formats you can actually use.

## Why You Need This

**Common scenarios:**

- You had multiple Google accounts on your phone and your location data is split across them
- You want to see your complete travel history on a single map
- Google's new Timeline format (2024+) isn't compatible with the old format
- You have thousands of records and need to reduce them to under 2,000 for Google My Maps
- You want to create a visual record of everywhere you've traveled

**What you can do with the converted data:**

- Create beautiful custom maps in Google My Maps showing everywhere you've been
- Import into spreadsheet software to analyze your travel patterns
- Keep a permanent backup of your location history in a usable format
- Share your travel map with friends and family
- Track business travel for expense reports or taxes

---

## How to Use

### Getting Your Timeline Data

**For OLD format data (pre-2024):**

1. Go to [Google Takeout](https://takeout.google.com/)
2. Deselect all, then select only "Location History"
3. Choose JSON format
4. Download and unzip
5. Find files in: `Location History\Semantic Location History\YEAR\YEAR_MONTH.json`

**For NEW format data (2024+):**

1. On your Android device: **Settings → Location → Timeline → Export**
2. This creates a `Timeline.json` file with all your recent data
3. Transfer this file to your computer

### Using the App

1. **Open the Webapp** - Open [the webapp](https://brandonml.github.io/google-maps-timeline-converter/) in your browser
2. **Upload your files** - Select all your old monthly JSON files AND your new Timeline.json file
3. **Choose cleaning options** - Keep both options checked to remove duplicates and unnecessary data
4. **Click "Process Files"** - The app merges and cleans everything
5. **Download your results** - Get CSV (for Google My Maps), KML (for mapping tools), or JSON (for backup)

### Privacy Note

All file processing happens entirely in your web browser. Your location data never leaves your device or gets uploaded to any server.

---

## For Developers

This is a React + TypeScript + Vite application using Tailwind CSS v4 for styling.

### Tech Stack

- **React 19** with TypeScript
- **Vite 7** for fast development and building
- **Tailwind CSS v4** via `@tailwindcss/vite` plugin
- **Lucide React** for icons

### Project Setup

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Preview production build
npm preview
```

The app will be available at `http://localhost:5173`

### File Structure

```
src/
  ├── App.tsx          # Main application component
  ├── main.tsx         # React app entry point
  └── index.css        # Tailwind CSS imports
```

### Tailwind Configuration

This project uses **Tailwind CSS v4** with the Vite plugin. The configuration is minimal:

- **`vite.config.ts`** - Includes `@tailwindcss/vite` plugin
- **`postcss.config.js`** - Uses `@tailwindcss/postcss` adapter
- **`src/index.css`** - Contains `@import "tailwindcss";`

**Important:** Do NOT mix Tailwind v3 and v4 syntax. Use `@import "tailwindcss";` in your CSS, not the old `@tailwind` directives.

### Key Features

- **Format Detection** - Automatically detects old (timelineObjects) vs new (semanticSegments) JSON formats
- **Data Conversion** - Converts new format to old format structure for compatibility
- **Smart Cleaning** - Removes activity records and duplicates while preserving valuable address data
- **Multi-Format Export** - Generates JSON, CSV, and KML outputs
- **Client-Side Processing** - All data processing happens in the browser using the File API

### Data Processing Logic

1. **Parse JSON** - Reads uploaded files and detects format
2. **Convert** - Transforms new format (semanticSegments) to old format (timelineObjects)
3. **Clean** - Optionally removes:
   - Activity records (walking, driving segments)
   - Duplicate visits (by PlaceId or coordinates, but only when Address is blank)
4. **Merge** - Combines all timeline objects from all uploaded files
5. **Export** - Converts to CSV/KML/JSON for download

### TypeScript Types

The app uses strict TypeScript with interfaces for:

- `Location` - Place coordinates and metadata
- `PlaceVisit` - Visit to a specific location
- `ActivitySegment` - Movement between locations
- `TimelineObject` - Union type of visits and activities

### Troubleshooting

**CSS not loading?**

- Ensure you have only ONE PostCSS config file (`postcss.config.js`)
- Check that `vite.config.ts` includes the `tailwindcss()` plugin
- Verify `index.css` uses `@import "tailwindcss";` (not `@tailwind` directives)
- Delete `node_modules` and reinstall if switching Tailwind versions

**Build errors?**

```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
npm run dev
```

### Contributing

This is a utility tool for personal use, but contributions are welcome! Feel free to:

- Report bugs or issues
- Suggest new features
- Submit pull requests
- Share your use cases

### License

This project is open source and available for personal and commercial use.

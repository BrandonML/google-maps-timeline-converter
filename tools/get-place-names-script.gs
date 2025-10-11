/**
 * Looks up missing place names in the 'Name' column using the PlaceId from the 'PlaceId' column.
 * It's designed to use the lowest-cost Place Details SKU (Essentials) by requesting only the 'name' field.
 */
function lookupMissingPlaceNames() {

  // ⚠️ IMPORTANT: Replace this with your actual Google Maps Platform API Key
  const API_KEY = "YOUR_API_KEY";

  // Define column indices (0-based) for the data
  // Column B ('Name') is index 1
  const NAME_COL = 1;
  // Column H ('PlaceId') is index 7
  const PLACE_ID_COL = 7;

  // Base URL for the Legacy Place Details API, requesting only the 'name' field
  // Requesting only 'name' ensures the request falls under the low-cost 'Essentials' SKU.
  const BASE_URL = "https://maps.googleapis.com/maps/api/place/details/json";

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // The script targets the currently active sheet (the one you are viewing)
  const sheet = ss.getActiveSheet();

  // Get all data (excluding the header row, so start from row 2)
  const range = sheet.getDataRange();
  const values = range.getValues();

  let requestsMade = 0;

  SpreadsheetApp.getUi().alert('Starting Place Name lookup. This may take a moment...');

  // Loop through rows, starting at index 1 (Row 2, skipping header)
  for (let i = 1; i < values.length; i++) {
    const row = values[i];

    // Check if the 'Name' column is empty or null, AND 'PlaceId' exists
    const nameValue = row[NAME_COL];
    const placeId = row[PLACE_ID_COL];

    if ((!nameValue || String(nameValue).trim() === "") && placeId) {

      const requestUrl = `${BASE_URL}?place_id=${placeId}&fields=name&key=${API_KEY}`;

      try {
        // Execute the API request
        const response = UrlFetchApp.fetch(requestUrl);
        const json = JSON.parse(response.getContentText());
        requestsMade++;

        // Check for a successful status and retrieve the place name
        if (json.status === "OK" && json.result && json.result.name) {
          const newName = json.result.name;

          // Update the cell in the sheet (row index + 1 to account for 0-based array vs 1-based sheet row)
          sheet.getRange(i + 1, NAME_COL + 1).setValue(newName);
          Logger.log(`Updated Row ${i + 1}: ${newName}`);
        } else {
          // Log an error if the status is not OK or name is missing
          Logger.log(`API Error on Row ${i + 1} for PlaceId ${placeId}. Status: ${json.status || 'No Status'}`);
          // You might set a temporary note in the cell for records that failed
          // sheet.getRange(i + 1, NAME_COL + 1).setValue(`Error: ${json.status}`);
        }

        // This is important for high volume requests:
        // to avoid hitting rate limits, and to give the sheet time to update
        // Optional: you can increase this for safety (e.g., 500ms)
        Utilities.sleep(100);

      } catch (e) {
        Logger.log(`Fatal Error fetching data for PlaceId ${placeId}: ${e.toString()}`);
        // This break is optional, but can prevent API misuse on network errors
        // break;
      }
    }
  }

  SpreadsheetApp.getUi().alert(`Processing complete! Made ${requestsMade} API requests.`);
}

/**
 * Creates a custom menu in the spreadsheet for easy access to the script.
 * This function runs automatically when the spreadsheet is opened.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Lookup Place Names')
      .addItem('Run Name Lookup', 'lookupMissingPlaceNames')
      .addToUi();
}

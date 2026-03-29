import Papa from 'papaparse';

// You will eventually replace this with the URL to your published Google Sheet CSV.
// e.g., 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT.../pub?gid=0&single=true&output=csv'
const GOOGLE_SHEET_CSV_URL = import.meta.env.VITE_GOOGLE_SHEET_CSV_URL || '';

export const fetchSheetData = async () => {
  if (!GOOGLE_SHEET_CSV_URL) {
    console.warn('No Google Sheet URL provided. Using mock data.');
    return null; // Will trigger fallback to mock data
  }

  return new Promise((resolve, reject) => {
    Papa.parse(GOOGLE_SHEET_CSV_URL, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length) {
          console.error("Errors while parsing CSV:", results.errors);
          reject(results.errors);
        } else {
          resolve(results.data);
        }
      },
      error: (error) => {
        console.error("Error fetching or parsing CSV:", error);
        reject(error);
      }
    });
  });
};

export const parseDataStructure = (data) => {
  // Organize flat CSV rows into a structured object for the sidebar and content pages
  // Expected columns: Subspecialty, Condition, Type, Title, Content_URL, Notes

  const structure = {};

  data.forEach(item => {
    const sub = item.Subspecialty?.trim();
    const cond = item.Condition?.trim();

    if (!sub || !cond) return; // Skip invalid rows

    // Initialize subspecialty if not exists
    if (!structure[sub]) {
      structure[sub] = {};
    }

    // Initialize condition if not exists
    if (!structure[sub][cond]) {
      structure[sub][cond] = [];
    }

    // Only push if there's actual content
    if (item.Title || item.Content_URL || item.Notes) {
      structure[sub][cond].push({
        type: item.Type?.trim() || 'Link',
        title: item.Title?.trim() || 'Untitled',
        url: item.Content_URL?.trim() || '',
        notes: item.Notes?.trim() || ''
      });
    }
  });

  return structure;
};

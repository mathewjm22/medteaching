// src/services/googleDrive.js

const API_KEY = import.meta.env.VITE_GOOGLE_API || import.meta.env.VITE_GOOGLE_API_KEY || '';
const ROOT_FOLDER_ID = import.meta.env.VITE_GOOGLE_DRIVE_ROOT_ID || '1X8YH60SKS9aVmq7qHjDkSCrcW-sdq1Je';
const BASE_URL = 'https://www.googleapis.com/drive/v3/files';

/**
 * Helper to fetch from Google Drive API
 */
const fetchDriveAPI = async (query, fields = 'files(id, name, mimeType, webViewLink, webContentLink, iconLink, hasThumbnail, thumbnailLink)') => {
  if (!API_KEY) {
    console.error('Google API Key is missing!');
    return [];
  }

  const url = `${BASE_URL}?q=${encodeURIComponent(query)}&key=${API_KEY}&fields=${encodeURIComponent(fields)}&pageSize=1000`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const err = await response.json();
      console.error('Google Drive API Error:', err);
      throw new Error(`Drive API Error: ${response.statusText}`);
    }
    const data = await response.json();
    return data.files || [];
  } catch (error) {
    console.error('Error fetching from Google Drive:', error);
    return [];
  }
};

/**
 * Fetch the complete folder structure (Subspecialties -> Conditions)
 * Does NOT fetch the files inside conditions yet (to save API calls).
 */
export const fetchFolderStructure = async () => {
  if (!API_KEY) {
    console.warn('No Google API Key provided. Returning empty structure.');
    return {};
  }

  const structure = {};

  try {
    // 1. Fetch Subspecialties (Folders inside ROOT_FOLDER_ID)
    const subspecialtyQuery = `'${ROOT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const subspecialties = await fetchDriveAPI(subspecialtyQuery, 'files(id, name)');

    // 2. Fetch Conditions for each Subspecialty
    // To optimize, we could do one big query if we know the parent IDs,
    // but a loop is safer and fine for a reasonable number of subspecialties.
    for (const sub of subspecialties) {
      const subName = sub.name.trim();
      structure[subName] = {};

      const conditionQuery = `'${sub.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
      const conditions = await fetchDriveAPI(conditionQuery, 'files(id, name)');

      for (const cond of conditions) {
        const condName = cond.name.trim();
        // Store the folder ID so we can fetch its files later
        structure[subName][condName] = { _folderId: cond.id, items: [] };
      }
    }

    return structure;
  } catch (error) {
    console.error("Error building folder structure:", error);
    return {};
  }
};

/**
 * Fetch files for a specific condition folder and format them as cards.
 */
export const fetchConditionFiles = async (folderId) => {
  if (!folderId || !API_KEY) return [];

  try {
    const fileQuery = `'${folderId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`;
    // We need webContentLink for direct download (useful for images/txt)
    // webViewLink for opening PDFs/Docs in browser
    const files = await fetchDriveAPI(fileQuery, 'files(id, name, mimeType, webViewLink, webContentLink, thumbnailLink)');

    const items = await Promise.all(files.map(async (file) => {
      return await formatDriveFileToCard(file);
    }));

    return items;
  } catch (error) {
    console.error(`Error fetching files for folder ${folderId}:`, error);
    return [];
  }
};

/**
 * Helper to fetch the text content of a .txt file from Drive.
 * Requires an API key or public access.
 */
const fetchTextFileContent = async (fileId) => {
  if (!API_KEY) return '';
  try {
    const url = `${BASE_URL}/${fileId}?alt=media&key=${API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) return '';
    return await response.text();
  } catch (err) {
    console.error('Error fetching text file content:', err);
    return '';
  }
};

/**
 * Parses a Drive file into our standard Card item format.
 */
const formatDriveFileToCard = async (file) => {
  let type = 'link';
  let url = file.webViewLink || ''; // Default to viewing in Drive
  let notes = '';
  let title = file.name.replace(/\.[^/.]+$/, ""); // Remove extension

  const mime = file.mimeType;

  if (mime.startsWith('image/')) {
    type = 'image';
    // Use thumbnail or direct download link for displaying the image
    // webContentLink works well if public, else use the thumbnail which allows high-res up to size limit.
    url = file.thumbnailLink ? file.thumbnailLink.replace('=s220', '=s800') : file.webContentLink;
  } else if (mime === 'application/pdf') {
    type = 'article';
    // Keep webViewLink to open PDF
  } else if (mime === 'text/plain') {
    // If it's a .txt file, we assume it contains a URL
    const content = await fetchTextFileContent(file.id);
    const extractedUrl = content.trim();

    if (extractedUrl.includes('youtube.com') || extractedUrl.includes('youtu.be')) {
      type = 'video';
      url = extractedUrl;
    } else if (extractedUrl) {
      // It's a generic link
      type = 'article';
      url = extractedUrl;
    }
  } else if (mime === 'application/vnd.google-apps.document') {
      type = 'article';
      // Google Docs open in webViewLink
  } else if (mime === 'video/mp4' || mime.startsWith('video/')) {
      type = 'video';
      url = file.webViewLink; // Play video in drive viewer
  }

  return {
    type,
    title,
    url,
    notes,
    id: file.id // Keep ID for potential future use
  };
};
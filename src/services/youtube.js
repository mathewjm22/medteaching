// src/services/youtube.js

const API_KEY = import.meta.env.VITE_GOOGLE_API || import.meta.env.VITE_GOOGLE_API_KEY || '';

/**
 * Extracts the YouTube Video ID from various forms of YouTube URLs.
 */
export const extractYouTubeVideoId = (url) => {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
};

/**
 * Converts a regular YouTube URL to an embed URL.
 */
export const getYouTubeEmbedUrl = (url) => {
  const videoId = extractYouTubeVideoId(url);
  if (videoId) {
    return `https://www.youtube.com/embed/${videoId}`;
  }
  return url; // return original if not parsable
};

/**
 * Optionally, fetch video details (title, description, thumbnails) using the YouTube Data API.
 * This can be used if you want to display a richer card before the user clicks to play.
 */
export const fetchYouTubeVideoDetails = async (videoId) => {
  if (!API_KEY || !videoId) return null;

  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch YouTube details');
    const data = await response.json();

    if (data.items && data.items.length > 0) {
      return data.items[0].snippet;
      // Contains title, description, thumbnails.high.url
    }
    return null;
  } catch (error) {
    console.error('Error fetching YouTube video details:', error);
    return null;
  }
};

// /api/player.js
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Helper constants and functions ---
const UI_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3NDk5OTgyNTQsIm5iZiI6MTc0OTk5ODI1NCwiZXhwIjoxNzgxMTAyMjc0LCJkYXRhIjp7InVpZCI6ODI2NDQ4LCJ0b2tlbiI6IjZlNzYxZTliNjkzZGQzYjgzOTY4NTBhMDhhMWI2ZWRkIn19.c19APBVLapkCwg4xsxA0issOlMCapTvc3_jbxCZsoKQ';

function getBaseUrl(type) {
  switch (type) {
    case 'meepet':
    case 'clumsy':
      return `https://hahoy.server.arlen.icu/${type}`;
    case 'cosmic':
    default:
      return `https://hahoy.onrender.com/cosmic`;
  }
}

function getHeaders(type) {
  return {
    'Accept': '*/*',
    'Origin': 'https://willow.arlen.icu',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'en-US,en;q=0.9',
    'Connection': 'keep-alive',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0...) Chrome/137.0.0.0',
    ...(type === 'cosmic' && { 'ui-token': UI_TOKEN }),
  };
}

function extractStreamAndSubtitles(type, data) {
  let streams = [], subtitles = [];
  if ((type === 'meepet' || type === 'clumsy') && Array.isArray(data.streams)) {
    streams = data.streams.map(s => ({
      url: type === 'meepet'
        ? `https://sonix-movies-v3-charlie.vercel.app/download?url=${encodeURIComponent(s.url)}`
        : s.url,
      label: s.resolutions || s.quality || s.format || 'Auto'
    }));
    const best = data.streams.reduce((a, b) => (parseInt(b.resolutions || 0) > parseInt(a.resolutions || 0) ? b : a), data.streams[0]);
    subtitles = best?.subtitles || [];
  } else if (type === 'cosmic' && Array.isArray(data.streams)) {
    streams = data.streams.map(s => ({
      url: s.url,
      label: s.quality || s.type || 'Auto'
    }));
    subtitles = data.subtitles || [];
  }
  return { streams, subtitles };
}

function pickDefaultStream(streams) {
  const find = (label) => streams.find(s => (s.label || '').toString().includes(label));
  return find('720') || find('1080') || find('480') || streams[0];
}

function injectPlayerVars(html, streams, subtitles, poster) {
  const defaultStream = pickDefaultStream(streams);
  const defaultIndex = streams.findIndex(s => s.url === defaultStream.url);
  const inject = `
    <script>
      window.__STREAMS__ = ${JSON.stringify(streams)};
      window.__SUBTITLES__ = ${JSON.stringify(subtitles)};
      window.__POSTER__ = ${JSON.stringify(poster || '')};
      window.__DEFAULT_STREAM_INDEX__ = ${defaultIndex};
    </script>
  `;
  return html.includes('<head>') ? html.replace('<head>', `<head>\n${inject}`) : inject + html;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Main handler for Vercel ---
export default async function handler(req, res) {
  // Show a message on root "/"
  if (req.url === '/' || req.url === '/api/server.js' || req.url === '/api/server.js/') {
    res.status(200).send('Sonix server is running');
    return;
  }

  // Parse the path for movie or TV show
  // Movie: /all/player/:tmdbId
  // TV:    /all/player/:tmdbId/:season/:episode
  const url = req.url.split('?')[0];
  const movieMatch = url.match(/^\/all\/player\/(\d+)\/?$/);
  const tvMatch = url.match(/^\/all\/player\/(\d+)\/(\d+)\/(\d+)\/?$/);

  let tmdbId, season, episode, isTV = false;
  if (tvMatch) {
    [, tmdbId, season, episode] = tvMatch;
    isTV = true;
  } else if (movieMatch) {
    [, tmdbId] = movieMatch;
    isTV = false;
  } else {
    res.status(404).send('Invalid route');
    return;
  }

  // Read player HTML (should be in project root or /public)
  let indexHtml;
  try {
    // Try /public/index.html first, fallback to ../index.html
    try {
      indexHtml = await fs.readFile(path.join(__dirname, '../public/index.html'), 'utf-8');
    } catch {
      indexHtml = await fs.readFile(path.join(__dirname, '../index.html'), 'utf-8');
    }
  } catch {
    return res.status(500).send('Player template not found.');
  }

  // Get TMDB Poster
  let poster = "";
  try {
    const tmdbUrl = isTV
      ? `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=1e2d76e7c45818ed61645cb647981e5c`
      : `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=1e2d76e7c45818ed61645cb647981e5c`;
    const tmdbRes = await axios.get(tmdbUrl);
    if (tmdbRes.data?.poster_path) {
      poster = `https://image.tmdb.org/t/p/w780${tmdbRes.data.poster_path}`;
    }
  } catch {}

  const types = ['meepet', 'clumsy', 'cosmic'];
  for (const type of types) {
    try {
      const baseUrl = getBaseUrl(type);
      const contentUrl = isTV
        ? `${baseUrl}/${tmdbId}/${season}/${episode}`
        : `${baseUrl}/${tmdbId}`;
      const response = await axios.get(contentUrl, {
        headers: getHeaders(type),
        decompress: true,
        timeout: 7000,
      });

      const { streams, subtitles } = extractStreamAndSubtitles(type, response.data || {});
      if (streams.length > 0) {
        const html = injectPlayerVars(indexHtml, streams, subtitles, poster);
        res.setHeader('Content-Type', 'text/html');
        return res.status(200).send(html);
      }
    } catch {
      // try next provider
    }
  }

  return res.status(404).send('No playable stream found.');
}

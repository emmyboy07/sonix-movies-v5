const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

const UI_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3NDk5OTgyNTQsIm5iZiI6MTc0OTk5ODI1NCwiZXhwIjoxNzgxMTAyMjc0LCJkYXRhIjp7InVpZCI6ODI2NDQ4LCJ0b2tlbiI6IjZlNzYxZTliNjkzZGQzYjgzOTY4NTBhMDhhMWI2ZWRkIn19.c19APBVLapkCwg4xsxA0issOlMCapTvc3_jbxCZsoKQ';

// Root route
app.get('/', (req, res) => {
  res.status(200).send('Sonix server up and running');
});

// Helper: Get base URL based on type
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

// Helper: Get headers based on type
function getHeaders(type) {
  return {
    'Accept': '*/*',
    'Origin': 'https://willow.arlen.icu',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'en-US,en;q=0.9',
    'Connection': 'keep-alive',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
    ...(type === 'cosmic' && { 'ui-token': UI_TOKEN }),
  };
}

// Helper: Extract streams/subtitles for movies or TV
function extractStreamAndSubtitles(type, data) {
  let streams = [];
  let subtitles = [];
  if ((type === 'meepet' || type === 'clumsy') && Array.isArray(data.streams)) {
    streams = data.streams.map(s => ({
      url: type === 'meepet'
        ? `https://sonix-movies-v3-charlie.vercel.app/download?url=${encodeURIComponent(s.url)}`
        : s.url,
      label: s.resolutions || s.quality || s.format || 'Auto'
    }));
    // Use subtitles from the highest quality stream (last one)
    const best = data.streams.reduce((a, b) => (parseInt(b.resolutions || 0) > parseInt(a.resolutions || 0) ? b : a), data.streams[0]);
    subtitles = best && best.subtitles ? best.subtitles : [];
  } else if (type === 'cosmic' && Array.isArray(data.streams)) {
    streams = data.streams.map(s => ({
      url: s.url,
      label: s.quality || s.type || 'Auto'
    }));
    subtitles = data.subtitles || [];
  }
  return { streams, subtitles };
}

// Pick default stream index: 720p > 1080p > 480p > first
function pickDefaultStream(streams) {
  const find = (label) => streams.find(s =>
    (s.label || s.quality || '').toString().includes(label)
  );
  return (
    find('720') ||
    find('1080') ||
    find('480') ||
    streams[0]
  );
}

// Inject player vars into HTML
function injectPlayerVars(html, streams, subtitles, poster) {
  const defaultStream = pickDefaultStream(streams);
  const defaultIndex = streams.findIndex(s => s.url === defaultStream.url);
  const inject = `
    <script>
      window.__STREAMS__ = ${JSON.stringify(streams)};
      window.__SUBTITLES__ = ${JSON.stringify(subtitles)};
      window.__POSTER__ = ${JSON.stringify(poster || "")};
      window.__DEFAULT_STREAM_INDEX__ = ${defaultIndex};
    </script>
  `;
  if (html.includes('<head>')) {
    return html.replace('<head>', `<head>\n${inject}`);
  }
  return inject + html;
}

// Serve static index.html for player
function getIndexHtml() {
  // Vercel's __dirname is /var/task/api, so go up one level
  const indexPath = path.join(__dirname, '..', 'index.html');
  try {
    return fs.readFileSync(indexPath, 'utf8');
  } catch {
    return null;
  }
}

// GET movie: /all/player/:tmdbId
app.get('/all/player/:tmdbId', async (req, res) => {
  const { tmdbId } = req.params;
  const types = ['meepet', 'clumsy', 'cosmic'];
  const indexHtml = getIndexHtml();
  if (!indexHtml) return res.status(500).send('Player template not found.');

  // Get poster from TMDB
  let poster = "";
  try {
    const tmdbRes = await axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=1e2d76e7c45818ed61645cb647981e5c`);
    if (tmdbRes.data && tmdbRes.data.poster_path) {
      poster = `https://image.tmdb.org/t/p/w780${tmdbRes.data.poster_path}`;
    }
  } catch {}

  for (const type of types) {
    const baseUrl = getBaseUrl(type);
    try {
      const response = await axios.get(`${baseUrl}/${tmdbId}`, {
        headers: getHeaders(type),
        decompress: true,
        timeout: 7000,
      });
      if (response.status === 200 && response.data) {
        const { streams, subtitles } = extractStreamAndSubtitles(type, response.data);
        if (streams.length > 0) {
          const html = injectPlayerVars(indexHtml, streams, subtitles, poster);
          res.setHeader('Content-Type', 'text/html');
          return res.send(html);
        }
      }
    } catch (e) {
      // Try next type
    }
  }
  res.status(404).send('No playable stream found.');
});

// GET TV episode: /all/player/:tmdbId/:season/:episode
app.get('/all/player/:tmdbId/:season/:episode', async (req, res) => {
  const { tmdbId, season, episode } = req.params;
  const types = ['meepet', 'clumsy', 'cosmic'];
  const indexHtml = getIndexHtml();
  if (!indexHtml) return res.status(500).send('Player template not found.');

  // Get poster from TMDB (use TV show poster)
  let poster = "";
  try {
    const tmdbRes = await axios.get(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=1e2d76e7c45818ed61645cb647981e5c`);
    if (tmdbRes.data && tmdbRes.data.poster_path) {
      poster = `https://image.tmdb.org/t/p/w780${tmdbRes.data.poster_path}`;
    }
  } catch {}

  for (const type of types) {
    const baseUrl = getBaseUrl(type);
    try {
      const url = `${baseUrl}/${tmdbId}/${season}/${episode}`;
      const response = await axios.get(url, {
        headers: getHeaders(type),
        decompress: true,
        timeout: 7000,
      });
      if (response.status === 200 && response.data) {
        const { streams, subtitles } = extractStreamAndSubtitles(type, response.data);
        if (streams.length > 0) {
          const html = injectPlayerVars(indexHtml, streams, subtitles, poster);
          res.setHeader('Content-Type', 'text/html');
          return res.send(html);
        }
      }
    } catch (e) {
      // Try next type
    }
  }
  res.status(404).send('No playable stream found.');
});

// API proxy for movie: /api/:type/:tmdbId
app.get('/api/:type/:tmdbId', async (req, res) => {
  const { type, tmdbId } = req.params;
  const baseUrl = getBaseUrl(type);

  try {
    const response = await axios.get(`${baseUrl}/${tmdbId}`, {
      headers: getHeaders(type),
      decompress: true,
    });
    res.status(200).json(response.data);
  } catch (err) {
    console.error(`[${type}] Movie fetch failed:`, err.message);
    res.status(500).json({ error: `Movie fetch failed for type '${type}'` });
  }
});

// API proxy for TV: /api/:type/:tmdbId/:season/:episode
app.get('/api/:type/:tmdbId/:season/:episode', async (req, res) => {
  const { type, tmdbId, season, episode } = req.params;
  const baseUrl = getBaseUrl(type);

  try {
    const response = await axios.get(`${baseUrl}/${tmdbId}/${season}/${episode}`, {
      headers: getHeaders(type),
      decompress: true,
    });
    res.status(200).json(response.data);
  } catch (err) {
    console.error(`[${type}] TV fetch failed:`, err.message);
    res.status(500).json({ error: `TV episode fetch failed for type '${type}'` });
  }
});

module.exports = app;

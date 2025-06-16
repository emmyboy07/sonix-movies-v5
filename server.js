const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());

const UI_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3NDk5OTgyNTQsIm5iZiI6MTc0OTk5ODI1NCwiZXhwIjoxNzgxMTAyMjc0LCJkYXRhIjp7InVpZCI6ODI2NDQ4LCJ0b2tlbiI6IjZlNzYxZTliNjkzZGQzYjgzOTY4NTBhMDhhMWI2ZWRkIn19.c19APBVLapkCwg4xsxA0issOlMCapTvc3_jbxCZsoKQ';

// Choose base URL for each type
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

// Choose headers based on type
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

// Movies: /:type/:tmdbId
app.get('/:type/:tmdbId', async (req, res) => {
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

// TV episodes: /:type/:tmdbId/:season/:episode
app.get('/:type/:tmdbId/:season/:episode', async (req, res) => {
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

function pickDefaultStream(streams) {
  // Try 720p, then 1080p, then 480p, else first available (could be 360p)
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

function injectPlayerVars(html, streams, subtitles, poster) {
  // Pick default stream index for frontend
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

// Movie route: /all/player/:tmdbId
app.get('/all/player/:tmdbId', async (req, res) => {
  const { tmdbId } = req.params;
  const types = ['meepet', 'clumsy', 'cosmic'];
  const indexPath = path.join(__dirname, 'index.html');
  let indexHtml;
  try {
    indexHtml = fs.readFileSync(indexPath, 'utf8');
  } catch {
    return res.status(500).send('Player template not found.');
  }

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


// TV Show route: /all/player/tmdb/:tmdbId/:season/:episode
app.get('/all/player/:tmdbId/:season/:episode', async (req, res) => {
  const { tmdbId, season, episode } = req.params;
  const types = ['meepet', 'clumsy', 'cosmic'];
  const indexPath = path.join(__dirname, 'index.html');
  let indexHtml;
  try {
    indexHtml = fs.readFileSync(indexPath, 'utf8');
  } catch {
    return res.status(500).send('Player template not found.');
  }

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
      // Most providers expect /:tmdbId/:season/:episode
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

// Add to server.js
app.get('/proxy-sub', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('No url');
  try {
    const response = await axios.get(url, { responseType: 'stream' });
    res.setHeader('Access-Control-Allow-Origin', '*');
    response.data.pipe(res);
  } catch {
    res.status(500).send('Failed to fetch subtitle');
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

const axios = require('axios');
const fs = require('fs');
const path = require('path');

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
    'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
    ...(type === 'cosmic' && { 'ui-token': UI_TOKEN }),
  };
}

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
  return html.includes('<head>')
    ? html.replace('<head>', `<head>\n${inject}`)
    : inject + html;
}

module.exports = async function handler(req, res) {
  const { method, url, query } = req;

  const urlParts = url.split('/').filter(Boolean).slice(1); // skip /api
  const [route, type, tmdbId, season, episode] = urlParts;

  const indexPath = path.join(__dirname, 'index.html');
  let indexHtml = '';

  try {
    indexHtml = fs.readFileSync(indexPath, 'utf8');
  } catch {
    return res.status(500).send('Player template not found.');
  }

  let poster = "";

  try {
    const tmdbType = season && episode ? 'tv' : 'movie';
    const tmdbRes = await axios.get(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=1e2d76e7c45818ed61645cb647981e5c`);
    if (tmdbRes.data?.poster_path) {
      poster = `https://image.tmdb.org/t/p/w780${tmdbRes.data.poster_path}`;
    }
  } catch {}

  const types = ['meepet', 'clumsy', 'cosmic'];
  for (const t of types) {
    const baseUrl = getBaseUrl(t);
    const mediaUrl = season && episode
      ? `${baseUrl}/${tmdbId}/${season}/${episode}`
      : `${baseUrl}/${tmdbId}`;
    try {
      const response = await axios.get(mediaUrl, {
        headers: getHeaders(t),
        decompress: true,
        timeout: 7000,
      });
      if (response.status === 200 && response.data) {
        const { streams, subtitles } = extractStreamAndSubtitles(t, response.data);
        if (streams.length > 0) {
          const html = injectPlayerVars(indexHtml, streams, subtitles, poster);
          res.setHeader('Content-Type', 'text/html');
          return res.status(200).send(html);
        }
      }
    } catch (err) {
      // Try next type
    }
  }

  return res.status(404).send('No playable stream found.');
};

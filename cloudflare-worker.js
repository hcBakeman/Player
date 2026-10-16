/**
 * Agent Player - Cloudflare Worker Stream & CORS Proxy
 * 
 * Tämä Cloudflare Worker toimii ilmaisena pilvipohjaisena videopurkajana ja
 * CORS-välityspalvelimena. Se mahdollistaa YouTube-videoiden toistamisen
 * täysin ilman mainoksia suoraan selaimen omalla HTML5 <video> -elementillä
 * GitHub Pagesin kautta ilman paikallista server.py -palvelinta.
 * 
 * Ilmainen Cloudflare-tili: 100 000 pyyntöä / päivä (ei vaadi luottokorttia).
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range, User-Agent',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
};

export default {
  async fetch(request, env, ctx) {
    // Käsittele CORS preflight -pyynnöt
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // 1. Terveystarkistus: /
    if (url.pathname === '/' || url.pathname === '/api/status') {
      return new Response(JSON.stringify({
        status: 'online',
        service: 'Agent Player Cloudflare Stream Worker',
        timestamp: new Date().toISOString()
      }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    // 2. Videon striimaus & proxy (ohittaa Googlen IP-lukituksen ja CORS-rajoitukset)
    // Esimerkki: /stream?url=https%3A%2F%2F...googlevideo.com%2F...
    if (url.pathname === '/stream') {
      const targetStreamUrl = url.searchParams.get('url');
      if (!targetStreamUrl) {
        return new Response('Virhe: url-parametri puuttuu.', { status: 400, headers: CORS_HEADERS });
      }

      // Välitetään selaimen Range-otsikko (tärkeää videon kelausta ja puskurointia varten)
      const forwardHeaders = new Headers();
      const range = request.headers.get('Range');
      if (range) {
        forwardHeaders.set('Range', range);
      }
      forwardHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');

      try {
        const streamResponse = await fetch(targetStreamUrl, {
          method: 'GET',
          headers: forwardHeaders
        });

        const responseHeaders = new Headers(streamResponse.headers);
        Object.entries(CORS_HEADERS).forEach(([k, v]) => responseHeaders.set(k, v));
        responseHeaders.set('Accept-Ranges', 'bytes');

        return new Response(streamResponse.body, {
          status: streamResponse.status,
          headers: responseHeaders
        });
      } catch (err) {
        return new Response('Striimivirhe: ' + err.message, { status: 502, headers: CORS_HEADERS });
      }
    }

    // 3. Videon purkaminen: /api/resolve?id=VIDEO_ID tai /api/resolve?url=YOUTUBE_URL
    if (url.pathname === '/api/resolve') {
      let videoId = url.searchParams.get('id');
      const inputUrl = url.searchParams.get('url');

      if (!videoId && inputUrl) {
        const match = inputUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/i);
        if (match) videoId = match[1];
      }

      if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
        return new Response(JSON.stringify({ success: false, error: 'Virheellinen tai puuttuva YouTube-video ID' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      const workerOrigin = url.origin;

      // Yritetään ensin Invidious-varapalvelimia Cloudflaren globaalin verkon kautta
      const backupInstances = [
        'https://invidious.f5.si',
        'https://inv.nadeko.net',
        'https://invidious.nerdvpn.de',
        'https://invidious.projectsegfau.lt'
      ];

      for (const inst of backupInstances) {
        try {
          const invRes = await fetch(`${inst}/api/v1/videos/${videoId}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            cf: { cacheTtl: 3600 }
          });
          if (invRes.ok) {
            const data = await invRes.json();
            const format = (data.formatStreams || []).find(f => f.container === 'mp4' && f.url);
            if (format && format.url) {
              const proxiedUrl = `${workerOrigin}/stream?url=${encodeURIComponent(format.url)}`;
              return new Response(JSON.stringify({
                success: true,
                videoId: videoId,
                title: data.title || 'YouTube Video',
                duration: data.lengthSeconds || 0,
                thumbnail: data.videoThumbnails?.[0]?.url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
                streamUrl: proxiedUrl,
                type: 'mp4',
                source: inst
              }), {
                headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
              });
            }
          }
        } catch (_) {}
      }

      // Jos Invidious-haku ei onnistunut, käytetään suoraa proxattua Invidious stream -osoitetta
      const directFallbackStream = `https://invidious.f5.si/latest_version?id=${videoId}&itag=18&local=true`;
      const proxiedFallback = `${workerOrigin}/stream?url=${encodeURIComponent(directFallbackStream)}`;

      return new Response(JSON.stringify({
        success: true,
        videoId: videoId,
        title: 'YouTube Video',
        duration: 0,
        thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        streamUrl: proxiedFallback,
        type: 'mp4',
        source: 'invidious-proxy'
      }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  }
};

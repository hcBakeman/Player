/**
 * Agent Player - Cloudflare Worker Stream & CORS Proxy
 * 
 * Toimii pilvipohjaisena videopurkajana ja CORS-välityspalvelimena.
 * Priorisoi suorat progressiiviset MP4-videot (ei HLS-katkoksia tai IP-lukitusvirheitä),
 * kilpailuttaa useat instanssit rinnakkain ja tallentaa tulokset Cloudflaren reunavälimuistiin.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range, User-Agent',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
};

const INVIDIOUS_INSTANCES = [
  'https://invidious.f5.si',
  'https://invidious.nerdvpn.de',
  'https://inv.nadeko.net'
];

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // 1. Terveystarkistus: / tai /api/status
    if (url.pathname === '/' || url.pathname === '/api/status') {
      return new Response(JSON.stringify({
        status: 'online',
        service: 'Agent Player Cloudflare Stream Worker',
        features: ['parallel-mp4-resolver', 'edge-cache', 'stream-proxy'],
        timestamp: new Date().toISOString()
      }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    // 2. Videon striimaus & proxy (välittää MP4 tavut Range-tuella)
    // Esimerkki: /stream?url=https%3A%2F%2F...googlevideo.com%2F...
    if (url.pathname === '/stream') {
      const targetStreamUrl = url.searchParams.get('url');
      if (!targetStreamUrl) {
        return new Response('Virhe: url-parametri puuttuu.', { status: 400, headers: CORS_HEADERS });
      }

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

        const contentType = streamResponse.headers.get('content-type') || '';

        // Estetään bottitunnistuksen HTML-haastesivujen välitys virheellisenä videona
        if (contentType.includes('text/html') && (streamResponse.status === 200 || streamResponse.status === 403)) {
          return new Response(JSON.stringify({ error: 'Upstream returned HTML challenge instead of video data' }), {
            status: 502,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
          });
        }

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

      // 0. Tarkistetaan Cloudflaren reunavälimuisti (vastataan 10ms jos jo välimuistissa)
      const cache = caches.default;
      const cacheKey = new Request(url.toString(), request);
      try {
        const cached = await cache.match(cacheKey);
        if (cached) return cached;
      } catch (_) {}

      // =========================================================================
      // TIER 1: Rinnakkainen nopea MP4-purku (kilpailutetaan parhaat instanssit)
      // =========================================================================
      const fetchCandidate = async (inst) => {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 5000);
        try {
          const invRes = await fetch(`${inst}/api/v1/videos/${videoId}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: controller.signal
          });
          clearTimeout(tid);
          if (invRes.ok) {
            const data = await invRes.json();
            const format = (data.formatStreams || []).find(f => f.container === 'mp4' && f.url);
            if (format && format.url) {
              return {
                title: data.title || 'YouTube Video',
                duration: data.lengthSeconds || 0,
                thumbnail: data.videoThumbnails?.[0]?.url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
                streamUrl: `${workerOrigin}/stream?url=${encodeURIComponent(format.url)}`,
                type: 'mp4',
                source: inst
              };
            }
          }
        } catch (_) {}
        throw new Error('Instance failed');
      };

      try {
        const winner = await Promise.any(INVIDIOUS_INSTANCES.map(fetchCandidate));
        if (winner) {
          const payload = {
            success: true,
            videoId: videoId,
            title: winner.title,
            duration: winner.duration,
            thumbnail: winner.thumbnail,
            streamUrl: winner.streamUrl,
            type: winner.type,
            source: winner.source
          };
          const response = new Response(JSON.stringify(payload), {
            headers: {
              ...CORS_HEADERS,
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=7200'
            }
          });
          try { ctx.waitUntil(cache.put(cacheKey, response.clone())); } catch (_) {}
          return response;
        }
      } catch (_) {}

      // Jos kaikki purkajat epäonnistuivat
      return new Response(JSON.stringify({
        success: false,
        error: 'Videota ei voitu purkaa suoraksi mainoksettomaksi MP4-striimiksi.'
      }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  }
};

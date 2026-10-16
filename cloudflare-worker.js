/**
 * Agent Player - Cloudflare Worker Stream & CORS Proxy
 * 
 * Tämä Cloudflare Worker toimii ilmaisena pilvipohjaisena videopurkajana ja
 * CORS-välityspalvelimena. Se mahdollistaa YouTube-videoiden toistamisen
 * täysin ilman mainoksia suoraan selaimen omalla HTML5 <video> -elementillä
 * GitHub Pagesin kautta ilman paikallista server.py -palvelinta.
 * 
 * Sisältää sisäänrakennetun VisionOS Direct Innertube -purkajan, joka ohittaa
 * YouTuben bottisuojaukset ja tuottaa puhtaan HLS Master Streamin ilman mainoksia.
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

    // 1. Terveystarkistus: / tai /api/status
    if (url.pathname === '/' || url.pathname === '/api/status') {
      return new Response(JSON.stringify({
        status: 'online',
        service: 'Agent Player Cloudflare Stream Worker',
        features: ['visionos-direct', 'hls-proxy', 'invidious-fallback'],
        timestamp: new Date().toISOString()
      }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    // 2. Videon striimaus & proxy (ohittaa Googlen CORS- ja IP-rajoitukset)
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

        const contentType = streamResponse.headers.get('content-type') || '';
        const isM3u8 = contentType.includes('mpegurl') || contentType.includes('application/x-mpegURL') || targetStreamUrl.includes('.m3u8');

        // Jos vastaus on HLS (.m3u8) soittolista, uudelleenkirjoitetaan alisoittolistat ja segmentit proxyn läpi
        if (isM3u8) {
          const m3u8Text = await streamResponse.text();
          const rewritten = m3u8Text.split('\n').map(line => {
            const trimmed = line.trim();
            if (!trimmed) return '';
            if (trimmed.includes('URI="http')) {
              return line.replace(/URI="(https?:\/\/[^"]+)"/g, (_, u) => {
                return `URI="${url.origin}/stream?url=${encodeURIComponent(u)}"`;
              });
            }
            if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
              return `${url.origin}/stream?url=${encodeURIComponent(trimmed)}`;
            }
            return line;
          }).join('\n');

          const hlsHeaders = new Headers(CORS_HEADERS);
          hlsHeaders.set('Content-Type', 'application/vnd.apple.mpegurl');
          hlsHeaders.set('Cache-Control', 'no-cache');
          return new Response(rewritten, { status: 200, headers: hlsHeaders });
        }

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

      // =========================================================================
      // TIER 1: Suora YouTube VisionOS Innertube -purkaja (100% Ad-Free HLS Master)
      // =========================================================================
      try {
        const watchRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
          }
        });

        if (watchRes.ok) {
          const html = await watchRes.text();
          const vMatch = html.match(/"VISITOR_DATA":\s*"([^"]+)"/);
          const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":\s*"([^"]+)"/);

          let title = 'YouTube Video';
          const titleMatch = html.match(/<title>([^<]+) - YouTube<\/title>/) || html.match(/<title>([^<]+)<\/title>/);
          if (titleMatch) title = titleMatch[1];

          if (vMatch && apiKeyMatch) {
            const visitorData = vMatch[1];
            const apiKey = apiKeyMatch[1];

            const innertubeBody = {
              context: {
                client: {
                  clientName: 'VISIONOS',
                  clientVersion: '1.02',
                  deviceMake: 'Apple',
                  deviceModel: 'RealityDevice17,1',
                  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
                  osName: 'visionOS',
                  osVersion: '26.5.23O471',
                  hl: 'en',
                  timeZone: 'UTC',
                  utcOffsetMinutes: 0
                }
              },
              videoId: videoId,
              playbackContext: {
                contentPlaybackContext: {
                  html5Preference: 'HTML5_PREF_WANTS',
                  signatureTimestamp: 20739
                }
              },
              contentCheckOk: true,
              racyCheckOk: true
            };

            const playerRes = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Youtube-Client-Name': '101',
                'X-Youtube-Client-Version': '1.02',
                'Origin': 'https://www.youtube.com',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
                'X-Goog-Visitor-Id': visitorData
              },
              body: JSON.stringify(innertubeBody)
            });

            if (playerRes.ok) {
              const pData = await playerRes.json();
              if (pData.playabilityStatus?.status === 'OK' && pData.streamingData?.hlsManifestUrl) {
                if (pData.videoDetails?.title) title = pData.videoDetails.title;
                const duration = parseInt(pData.videoDetails?.lengthSeconds, 10) || 0;
                const thumbnail = pData.videoDetails?.thumbnail?.thumbnails?.slice(-1)[0]?.url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
                const proxiedHls = `${workerOrigin}/stream?url=${encodeURIComponent(pData.streamingData.hlsManifestUrl)}`;

                return new Response(JSON.stringify({
                  success: true,
                  videoId: videoId,
                  title: title,
                  duration: duration,
                  thumbnail: thumbnail,
                  streamUrl: proxiedHls,
                  type: 'hls',
                  source: 'youtube-visionos'
                }), {
                  headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
                });
              }
            }
          }
        }
      } catch (_) {
        // Siirrytään Invidious-varavaihtoehtoon
      }

      // =========================================================================
      // TIER 2: Invidious API -varajärjestelmä
      // =========================================================================
      const backupInstances = [
        'https://invidious.f5.si',
        'https://inv.nadeko.net',
        'https://invidious.nerdvpn.de'
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

      // Jos kaikki purkajat epäonnistuivat
      return new Response(JSON.stringify({
        success: false,
        error: 'Videota ei voitu purkaa suoraksi mainoksettomaksi striimiksi.'
      }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  }
};

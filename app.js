/**
 * Agent Player – Saumaton monilähde-videosoitin
 * Tukee: YouTube, Vimeo, MP4/WebM suorat videot, HLS (.m3u8) striimit
 */

// ============================================================================
// Tilanhallinta (State)
// ============================================================================
const AppState = {
  playlist: [],
  currentIndex: -1,
  isPlaying: false,
  isLooping: true,
  skipErrors: true,
  currentType: null, // 'youtube' | 'vimeo' | 'html5' | 'iframe'
  serverOnline: false,
  cfWorkerUrl: localStorage.getItem('agentplayer_cf_worker_url') || '',
  
  // Soitin-instanssit
  ytPlayer: null,
  ytReady: false,
  vimeoPlayer: null,
  hlsInstance: null,

  // HUD & UI ajastimet
  hudTimeout: null,
  progressTicker: null,
  errorSkipTimeout: null,

  // Volume state
  volume: 1.0, // 0.0 to 1.0
  isMuted: false,
  volumeToastTimeout: null
};

// ============================================================================
// DOM-elementit
// ============================================================================
const DOM = {
  playerContainer: document.getElementById('player-container'),
  html5Video: document.getElementById('html5-video'),
  youtubeTarget: document.getElementById('youtube-target'),
  vimeoTarget: document.getElementById('vimeo-target'),
  iframeTarget: document.getElementById('iframe-target'),
  idleScreen: document.getElementById('player-idle-screen'),
  statusBadge: document.getElementById('player-status-badge'),
  statusText: document.getElementById('player-status-text'),
  serverStatusPill: document.getElementById('server-status-pill'),
  serverStatusLabel: document.getElementById('server-status-label'),
  
  // HUD
  hud: document.getElementById('player-hud'),
  hudTitle: document.getElementById('hud-title'),
  hudBadge: document.getElementById('hud-badge'),
  hudIndex: document.getElementById('hud-index'),
  hudProgressWrapper: document.getElementById('hud-progress-wrapper'),
  hudProgressBar: document.getElementById('hud-progress-bar'),
  hudCurrentTime: document.getElementById('hud-current-time'),
  hudDuration: document.getElementById('hud-duration'),
  hudPlayPauseBtn: document.getElementById('btn-hud-playpause'),
  hudPrevBtn: document.getElementById('btn-hud-prev'),
  hudNextBtn: document.getElementById('btn-hud-next'),
  hudVolumeBtn: document.getElementById('btn-hud-volume'),
  hudVolumeSlider: document.getElementById('hud-volume-slider'),
  hudLoopBtn: document.getElementById('btn-hud-loop'),
  hudFullscreenBtn: document.getElementById('btn-hud-fullscreen'),
  volumeToast: document.getElementById('volume-indicator-toast'),
  volumeToastIcon: document.getElementById('volume-indicator-icon'),
  volumeToastText: document.getElementById('volume-indicator-text'),
  nextVideoToast: document.getElementById('next-video-toast'),

  // Ulkoiset napit
  btnPlayAll: document.getElementById('btn-play-all'),
  btnFullscreenToggle: document.getElementById('btn-fullscreen-toggle'),
  btnIdlePlay: document.getElementById('btn-idle-play'),
  toggleLoop: document.getElementById('toggle-loop'),
  toggleHideTitle: document.getElementById('toggle-hide-title'),
  toggleSkipErrors: document.getElementById('toggle-skip-errors'),
  
  // Soittolistanäkymä
  formAddUrl: document.getElementById('form-add-url'),
  inputUrl: document.getElementById('input-video-url'),
  inputTitle: document.getElementById('input-video-title'),
  playlistItems: document.getElementById('playlist-items'),
  playlistCountBadge: document.getElementById('playlist-count-badge'),
  emptyPlaylistMsg: document.getElementById('empty-playlist-msg'),
  btnClearAll: document.getElementById('btn-clear-all'),
  btnLoadDemo: document.getElementById('btn-load-demo'),
  btnExportList: document.getElementById('btn-export-list'),
  fileImportInput: document.getElementById('file-import-input'),

  // Massalisäysmodaali
  btnBulkImport: document.getElementById('btn-bulk-import'),
  bulkModal: document.getElementById('bulk-modal'),
  bulkTextarea: document.getElementById('bulk-textarea'),
  btnConfirmBulk: document.getElementById('btn-confirm-bulk'),
  btnCancelBulk: document.getElementById('btn-cancel-bulk'),
  btnCloseModal: document.getElementById('btn-close-modal'),

  // Cloudflare Proxy -modaali
  btnCfSettings: document.getElementById('btn-cf-settings'),
  cfModal: document.getElementById('cf-modal'),
  inputCfWorkerUrl: document.getElementById('input-cf-worker-url'),
  btnSaveCf: document.getElementById('btn-save-cf'),
  btnClearCf: document.getElementById('btn-clear-cf'),
  btnCloseCfModal: document.getElementById('btn-close-cf-modal')
};

// ============================================================================
// Esimerkkilista (Demo URLs)
// ============================================================================
const DEMO_PLAYLIST = [
  {
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    title: 'Big Buck Bunny (MP4 HD)',
    type: 'mp4'
  },
  {
    url: 'https://www.youtube.com/watch?v=LXb3EKWsInQ',
    title: '4K Nature Drone Footage (YouTube)',
    type: 'youtube'
  },
  {
    url: 'https://vimeo.com/76979871',
    title: 'The New Normal (Vimeo)',
    type: 'vimeo'
  },
  {
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    title: 'Chromecast Demo Video (MP4)',
    type: 'mp4'
  },
  {
    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    title: 'Big Buck Bunny (HLS Stream)',
    type: 'hls'
  }
];

// ============================================================================
// Invidious API - Mainokseton suorastriimi & soittolistapurkaja
// ============================================================================
const INVIDIOUS_INSTANCES = [
  'https://invidious.f5.si',
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de'
];

function extractYouTubeId(url) {
  if (!url) return null;
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/i);
  return match ? match[1] : null;
}

function extractYouTubePlaylistId(url) {
  if (!url) return null;
  const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/i);
  return match ? match[1] : null;
}

async function resolveInvidiousStream(ytId) {
  if (!ytId) return null;

  // 1. Ensisijainen: Käyttäjän oma Cloudflare Worker (100% ad-free & unblocked)
  if (AppState.cfWorkerUrl) {
    try {
      const cleanUrl = AppState.cfWorkerUrl.replace(/\/+$/, '');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${cleanUrl}/api/resolve?id=${encodeURIComponent(ytId)}`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data && data.success && data.streamUrl) {
          console.log('[CLOUDFLARE] Mainokseton striimi ladattu omalta Workerilta!');
          return {
            success: true,
            streamUrl: data.streamUrl,
            title: data.title || '',
            duration: data.duration || 0,
            type: data.type || 'mp4',
            thumbnail: data.thumbnail || `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
            instance: 'Cloudflare Worker'
          };
        }
      }
    } catch (e) {
      console.warn('[CLOUDFLARE] Worker-pyyntö epäonnistui, kokeillaan julkisia palvelimia:', e);
    }
  }

  // 2. Toissijainen: Julkiset Invidious-instanssit
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`${instance}/api/v1/videos/${encodeURIComponent(ytId)}`, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      clearTimeout(timeoutId);

      if (!res.ok) continue;
      const data = await res.json();
      if (!data) continue;

      let chosenStream = null;
      if (Array.isArray(data.formatStreams) && data.formatStreams.length > 0) {
        const mp4Streams = data.formatStreams.filter(s => s.container === 'mp4' && s.url);
        if (mp4Streams.length > 0) {
          chosenStream = mp4Streams[0];
        }
      }

      if (!chosenStream && data.hlsUrl) {
        return {
          success: true,
          streamUrl: data.hlsUrl,
          title: data.title || '',
          duration: data.lengthSeconds || 0,
          type: 'hls',
          thumbnail: (data.videoThumbnails && data.videoThumbnails[0]) ? data.videoThumbnails[0].url : `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
          instance: instance
        };
      }

      if (chosenStream && chosenStream.url) {
        return {
          success: true,
          streamUrl: chosenStream.url,
          title: data.title || '',
          duration: data.lengthSeconds || 0,
          type: 'mp4',
          thumbnail: (data.videoThumbnails && data.videoThumbnails[0]) ? data.videoThumbnails[0].url : `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
          instance: instance
        };
      }
    } catch (e) {
      console.warn(`[INVIDIOUS] Instance ${instance} request failed:`, e);
    }
  }
  return null;
}

async function resolveInvidiousPlaylist(playlistId) {
  if (!playlistId) return null;
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${instance}/api/v1/playlists/${encodeURIComponent(playlistId)}`, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      clearTimeout(timeoutId);

      if (!res.ok) continue;
      const data = await res.json();
      if (data && Array.isArray(data.videos) && data.videos.length > 0) {
        return {
          success: true,
          title: data.title || 'YouTube Soittolista',
          count: data.videos.length,
          items: data.videos.map(v => ({
            url: `https://www.youtube.com/watch?v=${v.videoId}`,
            originalUrl: `https://www.youtube.com/watch?v=${v.videoId}`,
            title: v.title || 'Video',
            duration: v.lengthSeconds || 0,
            type: 'youtube',
            sourceId: v.videoId,
            badgeText: 'YOUTUBE',
            badgeClass: 'badge-yt'
          }))
        };
      }
    } catch (e) {
      console.warn(`[INVIDIOUS] Playlist request failed on ${instance}:`, e);
    }
  }
  return null;
}

// ============================================================================
// URL-tunnistus ja parsinta
// ============================================================================
function detectVideoSource(rawUrl) {
  const url = rawUrl.trim();

  // 1. YouTube
  // Muodot: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID, youtube.com/embed/ID
  const ytMatch = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
  if (ytMatch && ytMatch[1]) {
    return {
      type: 'youtube',
      sourceId: ytMatch[1],
      badgeText: 'YouTube',
      badgeClass: 'badge-yt'
    };
  }

  // 2. Vimeo
  // Muodot: vimeo.com/12345678, player.vimeo.com/video/12345678
  const vimeoMatch = url.match(/(?:vimeo\.com\/|player\.vimeo\.com\/video\/)(\d+)/i);
  if (vimeoMatch && vimeoMatch[1]) {
    return {
      type: 'vimeo',
      sourceId: vimeoMatch[1],
      badgeText: 'Vimeo',
      badgeClass: 'badge-vimeo'
    };
  }

  // 3. HLS (.m3u8)
  if (/\.m3u8($|\?)/i.test(url)) {
    return {
      type: 'hls',
      sourceId: url,
      badgeText: 'HLS',
      badgeClass: 'badge-hls'
    };
  }

  // 4. Suorat videotiedostot (mp4, webm, ogg, mov)
  if (/\.(mp4|webm|ogg|ogv|mov|m4v)($|\?)/i.test(url)) {
    return {
      type: 'mp4',
      sourceId: url,
      badgeText: 'MP4',
      badgeClass: 'badge-mp4'
    };
  }

  // 5. Yleinen / Tuntematon -> kokeillaan suorana videona oletuksena tai iframe
  return {
    type: 'mp4',
    sourceId: url,
    badgeText: 'VIDEO',
    badgeClass: 'badge-mp4'
  };
}

// ============================================================================
// YouTube API alustus
// ============================================================================
window.onYouTubeIframeAPIReady = function() {
  AppState.ytReady = true;
  console.log('YouTube IFrame API valmis');
};

function disableCaptions(player) {
  if (!player) return;
  try {
    if (typeof player.unloadModule === 'function') {
      player.unloadModule('captions');
      player.unloadModule('cc');
    }
    if (typeof player.setOption === 'function') {
      player.setOption('captions', 'track', {});
      player.setOption('cc', 'track', {});
      player.setOption('captions', 'reload', false);
      player.setOption('captions', 'fontSize', -1);
    }
  } catch (_) {}
}

function initYouTubePlayer(videoId, onReadyCallback) {
  const isHttp = window.location.protocol.startsWith('http');
  const origin = isHttp ? window.location.origin : 'https://www.youtube.com';

  if (AppState.ytPlayer) {
    try {
      if (typeof AppState.ytPlayer.destroy === 'function') {
        AppState.ytPlayer.destroy();
      }
    } catch (_) {}
    AppState.ytPlayer = null;
  }

  // Tyhjennetään kohde-elementti ennen alustusta
  DOM.youtubeTarget.innerHTML = '';
  const ytEmbedDiv = document.createElement('div');
  ytEmbedDiv.id = 'yt-embed-element';
  DOM.youtubeTarget.appendChild(ytEmbedDiv);

  AppState.ytPlayer = new YT.Player('yt-embed-element', {
    videoId: videoId,
    width: '100%',
    height: '100%',
    host: 'https://www.youtube-nocookie.com',
    playerVars: {
      autoplay: 1,
      controls: 0, // Piilottaa YouTuben omat säätimet ja aikajanan
      disablekb: 1, // Estää YouTuben omat pikanäppäimet
      enablejsapi: 1,
      origin: origin,
      widget_referrer: window.location.href,
      modestbranding: 1,
      rel: 0,
      iv_load_policy: 3,
      cc_load_policy: 0, // Estää tekstitysten automaattisen lataamisen
      playsinline: 1
    },
    events: {
      onReady: (event) => {
        try {
          const iframe = event.target.getIframe();
          if (iframe) {
            iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
            iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
          }
          // Poistetaan tekstitykset heti alussa
          disableCaptions(event.target);
        } catch (_) {}
        applyVolume();
        event.target.playVideo();
        if (onReadyCallback) onReadyCallback();
      },
      onApiChange: (event) => {
        // Kun tekstitysmoduuli tai API latautuu asynkronisesti, poistetaan tekstitykset
        disableCaptions(event.target);
      },
      onStateChange: onYouTubeStateChange,
      onError: (err) => {
        console.error('YouTube error code:', err.data || err);
        const errCode = err.data;
        if (!isHttp) {
          handleVideoError('YouTube blocks playback from file:// protocol (Error 153). Run "start.bat" and open http://localhost:8080!');
        } else if (errCode === 150 || errCode === 101 || errCode === 153) {
          handleVideoError('YouTube video has embed restrictions (Error ' + errCode + ').');
        } else {
          handleVideoError('YouTube playback failed (Error ' + (errCode || '') + ').');
        }
      }
    }
  });
}

function onYouTubeStateChange(event) {
  // YT.PlayerState: -1 (unstarted), 0 (ended), 1 (playing), 2 (paused), 3 (buffering)
  if (event.data === YT.PlayerState.ENDED) {
    console.log('YouTube video ended -> Next video automatically!');
    playNextVideo();
  } else if (event.data === YT.PlayerState.PLAYING) {
    applyVolume();
    // Varmistetaan että tekstitykset pysyvät poissa toiston aikanakin
    disableCaptions(event.target);
    setTimeout(() => disableCaptions(event.target), 400);
    setTimeout(() => disableCaptions(event.target), 1200);
    setTimeout(() => disableCaptions(event.target), 2500);
    AppState.isPlaying = true;
    updatePlayPauseIcons();
    hideStatus();
    startProgressTicker();
  } else if (event.data === YT.PlayerState.PAUSED) {
    AppState.isPlaying = false;
    updatePlayPauseIcons();
    stopProgressTicker();
  } else if (event.data === YT.PlayerState.BUFFERING) {
    disableCaptions(event.target);
    showStatus('Buffering video...');
  }
}

// ============================================================================
// Vimeo SDK alustus
// ============================================================================
function initVimeoPlayer(videoId, onReadyCallback) {
  if (AppState.vimeoPlayer) {
    try {
      AppState.vimeoPlayer.loadVideo(videoId).then(() => {
        AppState.vimeoPlayer.play();
        if (onReadyCallback) onReadyCallback();
      }).catch(err => {
        handleVideoError('Failed to load Vimeo video: ' + err.message);
      });
      return;
    } catch (e) {
      try { AppState.vimeoPlayer.destroy(); } catch (_) {}
      AppState.vimeoPlayer = null;
    }
  }

  DOM.vimeoTarget.innerHTML = '';
  AppState.vimeoPlayer = new Vimeo.Player(DOM.vimeoTarget, {
    id: videoId,
    autoplay: true,
    controls: false,
    responsive: true
  });

  AppState.vimeoPlayer.on('ended', () => {
    console.log('Vimeo video ended -> Next video automatically!');
    playNextVideo();
  });

  AppState.vimeoPlayer.on('play', () => {
    AppState.isPlaying = true;
    updatePlayPauseIcons();
    hideStatus();
    startProgressTicker();
  });

  AppState.vimeoPlayer.on('pause', () => {
    AppState.isPlaying = false;
    updatePlayPauseIcons();
    stopProgressTicker();
  });

  AppState.vimeoPlayer.on('error', (err) => {
    console.error('Vimeo error:', err);
    handleVideoError('Could not play Vimeo video.');
  });

  AppState.vimeoPlayer.ready().then(() => {
    applyVolume();
    AppState.vimeoPlayer.play();
    if (onReadyCallback) onReadyCallback();
  });
}

// ============================================================================
// HTML5 Video & HLS alustus
// ============================================================================
function initHtml5Video(url, isHls = false) {
  const video = DOM.html5Video;

  if (AppState.hlsInstance) {
    AppState.hlsInstance.destroy();
    AppState.hlsInstance = null;
  }

  video.pause();
  video.currentTime = 0;
  video.volume = AppState.volume;
  video.muted = AppState.isMuted;

  // Piilotetaan ja kytketään pois mahdolliset tekstitysraidat
  try {
    if (video.textTracks) {
      for (let i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].mode = 'disabled';
      }
    }
  } catch (_) {}

  if (isHls && Hls.isSupported()) {
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(e => console.log('Autoplay requires user interaction:', e));
    });
    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        console.error('HLS error:', data);
        handleVideoError('Error playing HLS stream.');
      }
    });
    AppState.hlsInstance = hls;
  } else {
    // Tavallinen MP4/WebM tai Safari natiivi HLS
    video.src = url;
    video.load();
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch(e => {
        console.warn('Autoplay restriction in browser:', e);
      });
    }
  }
}

// ============================================================================
// Soittimen vaihtologiikka (Universal Player Switcher)
// ============================================================================
function activatePlayerElement(type) {
  // Piilotetaan ja pysäytetään kaikki soittimet
  [DOM.html5Video, DOM.youtubeTarget, DOM.vimeoTarget, DOM.iframeTarget].forEach(el => {
    el.classList.remove('active');
  });

  // Pysäytä HTML5
  DOM.html5Video.pause();

  // Pysäytä YouTube jos oli aktiivinen
  if (AppState.ytPlayer && typeof AppState.ytPlayer.pauseVideo === 'function') {
    try { AppState.ytPlayer.pauseVideo(); } catch (_) {}
  }

  // Pysäytä Vimeo jos oli aktiivinen
  if (AppState.vimeoPlayer && typeof AppState.vimeoPlayer.pause === 'function') {
    try { AppState.vimeoPlayer.pause(); } catch (_) {}
  }

  // Aktivoidaan valittu tyyppi
  if (type === 'youtube') {
    DOM.youtubeTarget.classList.add('active');
  } else if (type === 'vimeo') {
    DOM.vimeoTarget.classList.add('active');
  } else if (type === 'iframe') {
    DOM.iframeTarget.classList.add('active');
  } else {
    // mp4 / hls
    DOM.html5Video.classList.add('active');
  }

  AppState.currentType = type;
}

// ============================================================================
// Soittolistan toistologiikka (Queue & Autoplay)
// ============================================================================
async function playVideoAtIndex(index) {
  if (index < 0 || index >= AppState.playlist.length) {
    console.warn('Indeksi soittolistan ulkopuolella:', index);
    return;
  }

  clearTimeout(AppState.errorSkipTimeout);
  AppState.currentIndex = index;
  const currentReqIndex = index;
  const item = AppState.playlist[index];

  DOM.idleScreen.classList.add('hidden');
  DOM.playerContainer.classList.remove('is-idle');
  showStatus(`Ladataan videota ${index + 1}/${AppState.playlist.length}...`);

  // Päivitetään HUD tiedot
  DOM.hudTitle.textContent = item.title || item.url;
  DOM.hudIndex.textContent = `(${index + 1} / ${AppState.playlist.length})`;
  DOM.hudBadge.textContent = item.badgeText || 'VIDEO';
  DOM.hudBadge.className = `badge ${item.badgeClass || ''}`;
  DOM.hudProgressBar.style.width = '0%';
  DOM.hudCurrentTime.textContent = '00:00';
  DOM.hudDuration.textContent = '00:00';

  updatePlaylistUI();

  // Käynnistä oikea soitin
  if (item.type === 'youtube') {
    showStatus('Haetaan mainokseton videostriimi...');
    try {
      const invStream = await resolveInvidiousStream(item.sourceId);
      if (AppState.currentIndex === currentReqIndex && invStream && invStream.streamUrl) {
        console.log('[AD-FREE] Mainokseton Invidious-videovirta ladattu! Toistetaan HTML5-soittimella.');
        DOM.hudBadge.textContent = 'MAINOKSETON MP4';
        DOM.hudBadge.className = 'badge badge-mp4';
        if (invStream.title && (item.title.startsWith('YouTube Video') || item.title === 'Video')) {
          item.title = invStream.title;
          DOM.hudTitle.textContent = item.title;
          updatePlaylistUI();
        }
        activatePlayerElement('mp4');
        initHtml5Video(invStream.streamUrl, invStream.type === 'hls');
        resetHudAutoHide();
        return;
      }
    } catch (err) {
      console.warn('Invidious stream fetch failed:', err);
    }

    if (AppState.currentIndex !== currentReqIndex) return;

    // Fallback: Virallinen YouTube IFrame -soitin
    console.log('[FALLBACK] Siirrytään viralliseen YouTube IFrame -soittimeen');
    DOM.hudBadge.textContent = 'YOUTUBE';
    DOM.hudBadge.className = 'badge badge-yt';
    activatePlayerElement('youtube');
    if (AppState.ytReady && window.YT) {
      initYouTubePlayer(item.sourceId);
    } else {
      // Odotetaan hetki jos API latautuu
      const checkYt = setInterval(() => {
        if (AppState.ytReady && window.YT) {
          clearInterval(checkYt);
          if (AppState.currentIndex === currentReqIndex) {
            initYouTubePlayer(item.sourceId);
          }
        }
      }, 200);
      setTimeout(() => clearInterval(checkYt), 5000);
    }
  } else if (item.type === 'vimeo') {
    activatePlayerElement('vimeo');
    initVimeoPlayer(item.sourceId);
  } else if (item.type === 'hls') {
    activatePlayerElement('mp4');
    initHtml5Video(item.url, true);
  } else {
    // MP4 tai muu suora videotiedosto
    activatePlayerElement('mp4');
    initHtml5Video(item.url, false);
  }

  // Varmistetaan että koko ruutu säilyy
  resetHudAutoHide();
}

/**
 * Automaattinen siirtyminen seuraavaan videoon
 */
function playNextVideo() {
  if (AppState.playlist.length === 0) return;

  const nextIndex = AppState.currentIndex + 1;

  if (nextIndex < AppState.playlist.length) {
    showNextToast(`Next video (${nextIndex + 1}/${AppState.playlist.length}): ${AppState.playlist[nextIndex].title}`);
    setTimeout(() => {
      playVideoAtIndex(nextIndex);
    }, 800);
  } else if (AppState.isLooping) {
    showNextToast('Looping playlist from start!');
    setTimeout(() => {
      playVideoAtIndex(0);
    }, 1000);
  } else {
    // Playlist finished
    showStatus('All videos played!');
    AppState.isPlaying = false;
    updatePlayPauseIcons();
    stopProgressTicker();
  }
}

function playPreviousVideo() {
  if (AppState.playlist.length === 0) return;

  const prevIndex = AppState.currentIndex - 1;
  if (prevIndex >= 0) {
    playVideoAtIndex(prevIndex);
  } else if (AppState.isLooping) {
    playVideoAtIndex(AppState.playlist.length - 1);
  }
}

function togglePlayPause() {
  if (AppState.currentIndex === -1) {
    if (AppState.playlist.length > 0) {
      playVideoAtIndex(0);
    }
    return;
  }

  const type = AppState.currentType;

  if (type === 'youtube' && AppState.ytPlayer) {
    try {
      const state = AppState.ytPlayer.getPlayerState();
      if (state === YT.PlayerState.PLAYING) {
        AppState.ytPlayer.pauseVideo();
      } else {
        AppState.ytPlayer.playVideo();
      }
    } catch (_) {}
  } else if (type === 'vimeo' && AppState.vimeoPlayer) {
    AppState.vimeoPlayer.getPaused().then(paused => {
      if (paused) AppState.vimeoPlayer.play();
      else AppState.vimeoPlayer.pause();
    });
  } else {
    // HTML5
    if (DOM.html5Video.paused) {
      DOM.html5Video.play();
    } else {
      DOM.html5Video.pause();
    }
  }
}

// ============================================================================
// Virhetilanteiden käsittely (Smart Skip)
// ============================================================================
function handleVideoError(message) {
  console.warn('Video error:', message);
  showStatus(`⚠️ ${message}`);

  if (AppState.skipErrors) {
    showNextToast('Unplayable video! Skipping in 3 seconds...');
    clearTimeout(AppState.errorSkipTimeout);
    AppState.errorSkipTimeout = setTimeout(() => {
      playNextVideo();
    }, 3000);
  }
}

// ============================================================================
// HUD ja edistymisen päivitys (Progress & Time)
// ============================================================================
function startProgressTicker() {
  stopProgressTicker();
  AppState.progressTicker = setInterval(updateProgress, 400);
}

function stopProgressTicker() {
  if (AppState.progressTicker) {
    clearInterval(AppState.progressTicker);
    AppState.progressTicker = null;
  }
}

function updateProgress() {
  let currentTime = 0;
  let duration = 0;

  if (AppState.currentType === 'youtube' && AppState.ytPlayer && typeof AppState.ytPlayer.getCurrentTime === 'function') {
    try {
      currentTime = AppState.ytPlayer.getCurrentTime() || 0;
      duration = AppState.ytPlayer.getDuration() || 0;
    } catch (_) {}
  } else if (AppState.currentType === 'vimeo' && AppState.vimeoPlayer) {
    Promise.all([
      AppState.vimeoPlayer.getCurrentTime(),
      AppState.vimeoPlayer.getDuration()
    ]).then(([cur, dur]) => {
      renderProgress(cur, dur);
    }).catch(() => {});
    return;
  } else {
    currentTime = DOM.html5Video.currentTime || 0;
    duration = DOM.html5Video.duration || 0;
  }

  renderProgress(currentTime, duration);
}

function renderProgress(currentTime, duration) {
  DOM.hudCurrentTime.textContent = formatTime(currentTime);
  if (duration && !isNaN(duration) && duration > 0) {
    DOM.hudDuration.textContent = formatTime(duration);
    const percent = Math.min(100, Math.max(0, (currentTime / duration) * 100));
    DOM.hudProgressBar.style.width = `${percent}%`;
  } else {
    DOM.hudDuration.textContent = '--:--';
  }
}

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const m = mins < 10 ? '0' + mins : mins;
  const s = secs < 10 ? '0' + secs : secs;
  return `${m}:${s}`;
}

function seekToPercentage(percentage) {
  percentage = Math.min(1, Math.max(0, percentage));

  if (AppState.currentType === 'youtube' && AppState.ytPlayer && typeof AppState.ytPlayer.getDuration === 'function') {
    const dur = AppState.ytPlayer.getDuration();
    if (dur) AppState.ytPlayer.seekTo(dur * percentage, true);
  } else if (AppState.currentType === 'vimeo' && AppState.vimeoPlayer) {
    AppState.vimeoPlayer.getDuration().then(dur => {
      if (dur) AppState.vimeoPlayer.setCurrentTime(dur * percentage);
    });
  } else {
    if (DOM.html5Video.duration) {
      DOM.html5Video.currentTime = DOM.html5Video.duration * percentage;
    }
  }
}

// ============================================================================
// Äänenvoimakkuuden hallinta (Volume Control)
// ============================================================================
function applyVolume() {
  const vol = AppState.isMuted ? 0 : AppState.volume;

  // HTML5 Video
  if (DOM.html5Video) {
    DOM.html5Video.volume = AppState.volume;
    DOM.html5Video.muted = AppState.isMuted;
  }

  // YouTube IFrame API (0..100)
  if (AppState.ytPlayer) {
    try {
      if (typeof AppState.ytPlayer.setVolume === 'function') {
        AppState.ytPlayer.setVolume(Math.round(AppState.volume * 100));
      }
      if (AppState.isMuted) {
        if (typeof AppState.ytPlayer.mute === 'function') AppState.ytPlayer.mute();
      } else {
        if (typeof AppState.ytPlayer.unMute === 'function') AppState.ytPlayer.unMute();
      }
    } catch (_) {}
  }

  // Vimeo SDK (0..1)
  if (AppState.vimeoPlayer) {
    try {
      if (typeof AppState.vimeoPlayer.setVolume === 'function') {
        AppState.vimeoPlayer.setVolume(vol).catch(() => {});
      }
    } catch (_) {}
  }

  updateVolumeUI();
}

function setVolume(newVol, showToast = true) {
  // Clamp between 0.0 and 1.0
  AppState.volume = Math.max(0, Math.min(1, Math.round(newVol * 100) / 100));
  if (AppState.volume > 0 && AppState.isMuted) {
    AppState.isMuted = false;
  } else if (AppState.volume === 0) {
    AppState.isMuted = true;
  }

  try {
    localStorage.setItem('agentplayer_volume', AppState.volume.toString());
    localStorage.setItem('agentplayer_muted', AppState.isMuted ? 'true' : 'false');
  } catch (_) {}

  applyVolume();

  if (showToast) {
    showVolumeToast();
  }
}

function toggleMute() {
  AppState.isMuted = !AppState.isMuted;
  if (!AppState.isMuted && AppState.volume === 0) {
    AppState.volume = 0.5; // Default un-mute level if it was at 0
  }
  try {
    localStorage.setItem('agentplayer_muted', AppState.isMuted ? 'true' : 'false');
    localStorage.setItem('agentplayer_volume', AppState.volume.toString());
  } catch (_) {}

  applyVolume();
  showVolumeToast();
}

function updateVolumeUI() {
  if (DOM.hudVolumeSlider) {
    DOM.hudVolumeSlider.value = AppState.isMuted ? 0 : Math.round(AppState.volume * 100);
  }
  if (DOM.hudVolumeBtn) {
    let icon = '🔊';
    if (AppState.isMuted || AppState.volume === 0) {
      icon = '🔇';
    } else if (AppState.volume < 0.5) {
      icon = '🔉';
    }
    DOM.hudVolumeBtn.textContent = icon;
    DOM.hudVolumeBtn.title = AppState.isMuted ? 'Unmute (M)' : 'Mute (M)';
  }
}

function showVolumeToast() {
  if (!DOM.volumeToast) return;
  const isMutedOrZero = AppState.isMuted || AppState.volume === 0;
  const percent = Math.round(AppState.volume * 100);

  if (DOM.volumeToastIcon) {
    DOM.volumeToastIcon.textContent = isMutedOrZero ? '🔇' : (AppState.volume < 0.5 ? '🔉' : '🔊');
  }
  if (DOM.volumeToastText) {
    DOM.volumeToastText.textContent = isMutedOrZero ? 'Muted' : `${percent}%`;
  }

  DOM.volumeToast.classList.remove('hidden');
  clearTimeout(AppState.volumeToastTimeout);
  AppState.volumeToastTimeout = setTimeout(() => {
    DOM.volumeToast.classList.add('hidden');
  }, 1200);
}

// ============================================================================
// Koko ruutu (Full Screen API)
// ============================================================================
function toggleFullScreen() {
  const container = DOM.playerContainer;

  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    // Siirry koko näyttöön
    if (container.requestFullscreen) {
      container.requestFullscreen();
    } else if (container.webkitRequestFullscreen) {
      container.webkitRequestFullscreen();
    }
  } else {
    // Poistu koko näytöstä
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }
}

document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

function handleFullscreenChange() {
  const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (isFull) {
    DOM.playerContainer.classList.add('is-fullscreen');
    DOM.hudFullscreenBtn.textContent = '🗗';
    DOM.hudFullscreenBtn.title = 'Exit Fullscreen (F)';
  } else {
    DOM.playerContainer.classList.remove('is-fullscreen');
    DOM.hudFullscreenBtn.textContent = '⛶';
    DOM.hudFullscreenBtn.title = 'Full Screen (F)';
  }
  resetHudAutoHide();
}

// ============================================================================
// HUD Auto-Hide & Mouse Activity
// ============================================================================
function resetHudAutoHide() {
  DOM.playerContainer.classList.add('show-controls');
  clearTimeout(AppState.hudTimeout);

  AppState.hudTimeout = setTimeout(() => {
    const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement || DOM.playerContainer.classList.contains('is-fullscreen'));
    // Piilotetaan ohjaimet aina koko ruudun tilassa (tai toiston aikana normaalitilassa), kun hiiri pysähtyy
    if (isFullscreen || AppState.isPlaying) {
      DOM.playerContainer.classList.remove('show-controls');
    }
  }, 2200);
}

// Kuunnellaan hiiren liikettä soittimessa ja koko näytöllä
DOM.playerContainer.addEventListener('mousemove', resetHudAutoHide);
DOM.playerContainer.addEventListener('pointermove', resetHudAutoHide);
window.addEventListener('mousemove', () => {
  const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement || DOM.playerContainer.classList.contains('is-fullscreen'));
  if (isFullscreen) {
    resetHudAutoHide();
  }
});

DOM.playerContainer.addEventListener('mouseleave', () => {
  const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement || DOM.playerContainer.classList.contains('is-fullscreen'));
  if (!isFullscreen && AppState.isPlaying) {
    DOM.playerContainer.classList.remove('show-controls');
  }
});

DOM.playerContainer.addEventListener('click', (e) => {
  // Jos klikataan HUD-nappeja, aikajanaa tai äänenvoimakkuussäädintä, annetaan niiden toimia
  if (e.target.closest('#player-hud button') || e.target.closest('#hud-progress-wrapper') || e.target.closest('.hud-volume-control') || e.target.closest('button') || e.target.closest('input')) {
    return;
  }
  togglePlayPause();
  resetHudAutoHide();
});

// Tuplaklikkaus videolla vaihtaa koko ruudun (Full Screen)
DOM.playerContainer.addEventListener('dblclick', (e) => {
  if (e.target.closest('#player-hud button') || e.target.closest('#hud-progress-wrapper') || e.target.closest('.hud-volume-control') || e.target.closest('button') || e.target.closest('input')) {
    return;
  }
  toggleFullScreen();
});

// ============================================================================
// UI Ilmoitukset (Toasts & Status)
// ============================================================================
function showStatus(text) {
  DOM.statusText.textContent = text;
  DOM.statusBadge.classList.remove('hidden');
}

function hideStatus() {
  DOM.statusBadge.classList.add('hidden');
}

function showNextToast(text) {
  DOM.nextVideoToast.textContent = text;
  DOM.nextVideoToast.classList.remove('hidden');
  setTimeout(() => {
    DOM.nextVideoToast.classList.add('hidden');
  }, 2500);
}

function updatePlayPauseIcons() {
  if (AppState.isPlaying) {
    DOM.playerContainer.classList.add('is-playing');
    DOM.hudPlayPauseBtn.textContent = '⏸';
    DOM.hudPlayPauseBtn.title = 'Pause (Space)';
    DOM.btnPlayAll.innerHTML = '<span class="icon">⏸</span> Pause';
  } else {
    DOM.playerContainer.classList.remove('is-playing');
    DOM.hudPlayPauseBtn.textContent = '▶';
    DOM.hudPlayPauseBtn.title = 'Play (Space)';
    DOM.btnPlayAll.innerHTML = '<span class="icon">▶</span> Play Playlist';
  }
}

// ============================================================================
// Soittolistan renderöinti ja hallinta
// ============================================================================
function renderPlaylist() {
  DOM.playlistItems.innerHTML = '';
  const count = AppState.playlist.length;
  DOM.playlistCountBadge.textContent = `${count} ${count === 1 ? 'video' : 'videos'}`;

  if (AppState.playlist.length === 0) {
    DOM.emptyPlaylistMsg.classList.remove('hidden');
    return;
  }

  DOM.emptyPlaylistMsg.classList.add('hidden');

  AppState.playlist.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = `playlist-item ${index === AppState.currentIndex ? 'active' : ''}`;
    li.dataset.index = index;

    const playStatusHtml = index === AppState.currentIndex ? '▶' : `${index + 1}`;

    li.innerHTML = `
      <div class="item-play-status">${playStatusHtml}</div>
      <div class="item-content">
        <div class="item-title" title="${escapeHtml(item.title || item.url)}">
          ${escapeHtml(item.title || `Video ${index + 1}`)}
        </div>
        <div class="item-url" title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</div>
      </div>
      <span class="item-badge ${item.badgeClass || ''}">${item.badgeText || 'VIDEO'}</span>
      <div class="item-actions">
        <button class="item-btn item-btn-up" title="Move up" data-action="up">▲</button>
        <button class="item-btn item-btn-down" title="Move down" data-action="down">▼</button>
        <button class="item-btn item-btn-delete" title="Remove" data-action="delete">✕</button>
      </div>
    `;

    // Klikkaus riviin aloittaa toiston
    li.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        const action = actionBtn.dataset.action;
        handleItemAction(action, index);
        return;
      }
      playVideoAtIndex(index);
    });

    DOM.playlistItems.appendChild(li);
  });
}

function handleItemAction(action, index) {
  if (action === 'delete') {
    AppState.playlist.splice(index, 1);
    if (AppState.currentIndex === index) {
      if (AppState.playlist.length > 0) {
        playVideoAtIndex(Math.min(index, AppState.playlist.length - 1));
      } else {
        stopAllPlayback();
      }
    } else if (AppState.currentIndex > index) {
      AppState.currentIndex--;
    }
  } else if (action === 'up' && index > 0) {
    const temp = AppState.playlist[index];
    AppState.playlist[index] = AppState.playlist[index - 1];
    AppState.playlist[index - 1] = temp;
    if (AppState.currentIndex === index) AppState.currentIndex--;
    else if (AppState.currentIndex === index - 1) AppState.currentIndex++;
  } else if (action === 'down' && index < AppState.playlist.length - 1) {
    const temp = AppState.playlist[index];
    AppState.playlist[index] = AppState.playlist[index + 1];
    AppState.playlist[index + 1] = temp;
    if (AppState.currentIndex === index) AppState.currentIndex++;
    else if (AppState.currentIndex === index + 1) AppState.currentIndex--;
  }

  savePlaylistToStorage();
  renderPlaylist();
}

function updatePlaylistUI() {
  const items = DOM.playlistItems.querySelectorAll('.playlist-item');
  items.forEach((item, idx) => {
    if (idx === AppState.currentIndex) {
      item.classList.add('active');
      item.querySelector('.item-play-status').textContent = '▶';
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      item.classList.remove('active');
      item.querySelector('.item-play-status').textContent = `${idx + 1}`;
    }
  });
}

function stopAllPlayback() {
  AppState.currentIndex = -1;
  AppState.isPlaying = false;
  DOM.html5Video.pause();
  if (AppState.ytPlayer && typeof AppState.ytPlayer.stopVideo === 'function') {
    try { AppState.ytPlayer.stopVideo(); } catch (_) {}
  }
  if (AppState.vimeoPlayer && typeof AppState.vimeoPlayer.pause === 'function') {
    try { AppState.vimeoPlayer.pause(); } catch (_) {}
  }
  DOM.idleScreen.classList.remove('hidden');
  DOM.playerContainer.classList.add('is-idle');
  updatePlayPauseIcons();
  stopProgressTicker();
  hideStatus();
}

async function checkServerStatus() {
  const dot = DOM.serverStatusPill ? DOM.serverStatusPill.querySelector('.status-dot') : null;
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  if (!isLocal) {
    // Ollaan GitHub Pagesissa tai verkossa
    AppState.serverOnline = false;
    if (dot) dot.className = 'status-dot online';
    if (DOM.serverStatusLabel) {
      DOM.serverStatusLabel.textContent = AppState.cfWorkerUrl ? 'Cloudflare Proxy Online' : 'Ad-Free Web Mode';
    }
    return Boolean(AppState.cfWorkerUrl);
  }

  try {
    const res = await fetch('/api/status', { cache: 'no-store', signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json();
      AppState.serverOnline = true;
      if (dot) dot.className = 'status-dot online';
      if (DOM.serverStatusLabel) {
        DOM.serverStatusLabel.textContent = 'Server: Online (yt-dlp)';
      }
      return true;
    }
  } catch (_) {}

  AppState.serverOnline = false;
  if (dot) dot.className = 'status-dot offline';
  if (DOM.serverStatusLabel) {
    DOM.serverStatusLabel.textContent = 'Local Server: Offline';
  }
  return false;
}

async function addVideoToPlaylist(url, customTitle = '') {
  if (!url || !url.trim()) return null;
  url = url.trim();

  const isDirectOrStandard = (
    /\.(mp4|webm|ogg|mov|m3u8)($|\?)/i.test(url) ||
    /youtu\.?be/i.test(url) ||
    /vimeo\.com/i.test(url)
  );

  const ytPlaylistId = extractYouTubePlaylistId(url);
  const isPlaylist = Boolean(ytPlaylistId) || /list=|playlist/i.test(url);
  showStatus(isPlaylist ? 'Extracting playlist tracks...' : 'Checking video link...');

  // 1. Jos taustapalvelin on aktiivisena, käytetään paikallista yt-dlp:tä
  let resolvedData = null;
  if (AppState.serverOnline) {
    try {
      const res = await fetch(`/api/resolve?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(25000) });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          if (data.isPlaylist && Array.isArray(data.items) && data.items.length > 0) {
            data.items.forEach(it => {
              AppState.playlist.push({
                url: it.url,
                originalUrl: it.url,
                title: it.title || 'Video',
                type: it.type || 'youtube',
                sourceId: it.sourceId || it.url,
                badgeText: it.badgeText || 'YOUTUBE',
                badgeClass: it.badgeClass || 'badge-yt',
                duration: it.duration || 0
              });
            });

            savePlaylistToStorage();
            renderPlaylist();
            hideStatus();
            showNextToast(`✨ Added playlist: "${data.playlistTitle || 'YouTube'}" (${data.count} items)!`);
            return data.items[0];
          } else if (data.streamUrl) {
            resolvedData = data;
          }
        }
      }
    } catch (e) {
      console.log('Server query failed:', e);
    }
  }

  // 2. Jos palvelin ei ole päällä ja kyseessä on YouTube-soittolista -> Invidious API
  if (!resolvedData && ytPlaylistId) {
    showStatus('Fetching YouTube playlist (Invidious API)...');
    const plData = await resolveInvidiousPlaylist(ytPlaylistId);
    if (plData && plData.items && plData.items.length > 0) {
      plData.items.forEach(it => AppState.playlist.push(it));
      savePlaylistToStorage();
      renderPlaylist();
      hideStatus();
      showNextToast(`✨ Added playlist: "${plData.title}" (${plData.count} items)!`);
      return plData.items[0];
    }
  }

  if (resolvedData) {
    const isHls = resolvedData.type === 'hls' || resolvedData.streamUrl.includes('.m3u8');
    const badgeText = resolvedData.extractor ? resolvedData.extractor.toUpperCase() : (isHls ? 'HLS' : 'MP4');
    const badgeClass = resolvedData.extractor ? 'badge-tube' : (isHls ? 'badge-hls' : 'badge-mp4');

    const newItem = {
      url: resolvedData.streamUrl,
      originalUrl: url,
      title: customTitle.trim() || resolvedData.title || `Video ${AppState.playlist.length + 1}`,
      type: isHls ? 'hls' : 'mp4',
      sourceId: resolvedData.streamUrl,
      badgeText: badgeText,
      badgeClass: badgeClass,
      duration: resolvedData.duration || 0,
      thumbnail: resolvedData.thumbnail || ''
    };

    AppState.playlist.push(newItem);
    savePlaylistToStorage();
    renderPlaylist();
    hideStatus();
    showNextToast(`Added: ${newItem.title}`);
    return newItem;
  }

  // 3. Fallback asiakaspään tunnistukseen
  const parsed = detectVideoSource(url);

  if (!isDirectOrStandard && !AppState.serverOnline) {
    alert(`⚠️ Note: This link requires the local background server (start.bat / server.py) to resolve direct video streams.`);
  }

  let finalTitle = customTitle.trim();
  if (!finalTitle) {
    if (parsed.type === 'youtube') {
      finalTitle = `YouTube Video ${AppState.playlist.length + 1}`;
    } else {
      try {
        const urlObj = new URL(url);
        const lastPart = urlObj.pathname.split('/').filter(Boolean).pop();
        finalTitle = (lastPart && lastPart !== 'watch') ? lastPart : urlObj.hostname;
      } catch (_) {
        finalTitle = `Video ${AppState.playlist.length + 1}`;
      }
    }
  }

  const newItem = {
    url: url,
    originalUrl: url,
    title: finalTitle,
    type: parsed.type,
    sourceId: parsed.sourceId,
    badgeText: parsed.badgeText,
    badgeClass: parsed.badgeClass
  };

  AppState.playlist.push(newItem);
  savePlaylistToStorage();
  renderPlaylist();
  hideStatus();
  showNextToast(`Added: ${newItem.title}`);
  return newItem;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

// ============================================================================
// Tallennus ja Tuonti (LocalStorage & JSON)
// ============================================================================
function savePlaylistToStorage() {
  try {
    localStorage.setItem('agent_player_playlist', JSON.stringify(AppState.playlist));
  } catch (e) {
    console.warn('LocalStorage virhe:', e);
  }
}

function loadPlaylistFromStorage() {
  try {
    const saved = localStorage.getItem('agent_player_playlist');
    if (saved) {
      AppState.playlist = JSON.parse(saved);
      renderPlaylist();
    }
  } catch (e) {
    console.warn('Ei voitu ladata tallennettua soittolistaa', e);
  }
}

// ============================================================================
// Tapahtumankuuntelijat (Event Listeners)
// ============================================================================
function initEventListeners() {
  // HTML5 Video tapahtumat
  DOM.html5Video.addEventListener('ended', () => {
    console.log('HTML5 video päättyi -> Seuraava video automaattisesti!');
    playNextVideo();
  });

  DOM.html5Video.addEventListener('play', () => {
    AppState.isPlaying = true;
    updatePlayPauseIcons();
    hideStatus();
    startProgressTicker();
  });

  DOM.html5Video.addEventListener('pause', () => {
    AppState.isPlaying = false;
    updatePlayPauseIcons();
    stopProgressTicker();
  });

  DOM.html5Video.addEventListener('error', async () => {
    const currentItem = AppState.playlist[AppState.currentIndex];

    // Jos suora YouTube-striimi vanhentui tai estettiin, siirrytään saumattomasti viralliseen YouTube-soittimeen
    if (currentItem && currentItem.sourceId && /youtu\.?be/i.test(currentItem.originalUrl || currentItem.url)) {
      console.log('[FALLBACK] Direct stream failed or expired. Falling back to YouTube IFrame player...');
      showNextToast('Striimi vanhentui – siirrytään YouTube-soittimeen');
      DOM.hudBadge.textContent = 'YOUTUBE';
      DOM.hudBadge.className = 'badge badge-yt';
      activatePlayerElement('youtube');
      if (AppState.ytReady && window.YT) {
        initYouTubePlayer(currentItem.sourceId);
      }
      return;
    }

    if (currentItem && currentItem.originalUrl && currentItem.originalUrl !== currentItem.url && AppState.serverOnline) {
      console.log('Stream link expired or invalid, refreshing stream from server...');
      showStatus('Refreshing stream link from server...');
      try {
        const res = await fetch(`/api/resolve?url=${encodeURIComponent(currentItem.originalUrl)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.streamUrl) {
            currentItem.url = data.streamUrl;
            initHtml5Video(data.streamUrl, data.type === 'hls');
            return;
          }
        }
      } catch (_) {}
    }
    handleVideoError('Video source could not be played or is unresponsive.');
  });

  // URL lisäyslomake
  DOM.formAddUrl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = DOM.inputUrl.value;
    const title = DOM.inputTitle.value;
    DOM.inputUrl.value = '';
    DOM.inputTitle.value = '';
    
    await addVideoToPlaylist(url, title);

    // Jos tämä oli ensimmäinen video eikä mikään toistu, aloitetaan
    if (AppState.playlist.length === 1 && AppState.currentIndex === -1) {
      playVideoAtIndex(0);
    }
  });

  // Pääpainikkeet
  DOM.btnPlayAll.addEventListener('click', togglePlayPause);
  DOM.btnIdlePlay.addEventListener('click', () => {
    if (AppState.playlist.length > 0) playVideoAtIndex(0);
  });
  DOM.btnFullscreenToggle.addEventListener('click', toggleFullScreen);

  // HUD painikkeet
  DOM.hudPlayPauseBtn.addEventListener('click', togglePlayPause);
  DOM.hudNextBtn.addEventListener('click', playNextVideo);
  DOM.hudPrevBtn.addEventListener('click', playPreviousVideo);
  DOM.hudFullscreenBtn.addEventListener('click', toggleFullScreen);
  DOM.hudLoopBtn.addEventListener('click', () => {
    AppState.isLooping = !AppState.isLooping;
    DOM.toggleLoop.checked = AppState.isLooping;
    DOM.hudLoopBtn.classList.toggle('active', AppState.isLooping);
    showNextToast(AppState.isLooping ? 'Looping Enabled' : 'Looping Disabled');
  });

  // Äänenvoimakkuus-painike ja liukusäädin
  if (DOM.hudVolumeBtn) {
    DOM.hudVolumeBtn.addEventListener('click', () => {
      toggleMute();
      resetHudAutoHide();
    });
  }

  if (DOM.hudVolumeSlider) {
    DOM.hudVolumeSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      setVolume(val / 100, false);
      resetHudAutoHide();
    });
  }

  // Asetuskytkimet
  DOM.toggleLoop.addEventListener('change', (e) => {
    AppState.isLooping = e.target.checked;
    DOM.hudLoopBtn.classList.toggle('active', AppState.isLooping);
  });
  DOM.toggleSkipErrors.addEventListener('change', (e) => {
    AppState.skipErrors = e.target.checked;
  });

  if (DOM.toggleHideTitle) {
    DOM.toggleHideTitle.addEventListener('change', (e) => {
      DOM.playerContainer.classList.toggle('hide-top-title', e.target.checked);
      try {
        localStorage.setItem('agentplayer_hide_title', e.target.checked ? 'true' : 'false');
      } catch (_) {}
    });
    // Palautetaan aiemmin tallennettu yläotsikkoasetus
    try {
      if (localStorage.getItem('agentplayer_hide_title') === 'true') {
        DOM.toggleHideTitle.checked = true;
        DOM.playerContainer.classList.add('hide-top-title');
      }
    } catch (_) {}
  }

  // Edistymispalkin kelaus (Klikkaus ja vetäminen)
  let isDraggingSeek = false;
  const handleSeek = (e) => {
    const rect = DOM.hudProgressWrapper.getBoundingClientRect();
    const pos = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    seekToPercentage(pos);
    DOM.hudProgressBar.style.width = `${pos * 100}%`;
  };

  DOM.hudProgressWrapper.addEventListener('mousedown', (e) => {
    isDraggingSeek = true;
    handleSeek(e);
  });

  window.addEventListener('mousemove', (e) => {
    if (isDraggingSeek) {
      handleSeek(e);
      resetHudAutoHide();
    }
  });

  window.addEventListener('mouseup', () => {
    if (isDraggingSeek) {
      isDraggingSeek = false;
    }
  });

  // Esimerkkilistan lataus
  DOM.btnLoadDemo.addEventListener('click', () => {
    AppState.playlist = [];
    DEMO_PLAYLIST.forEach(item => {
      addVideoToPlaylist(item.url, item.title);
    });
    playVideoAtIndex(0);
  });

  // Tyhjennä kaikki
  DOM.btnClearAll.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear the entire playlist?')) {
      AppState.playlist = [];
      stopAllPlayback();
      savePlaylistToStorage();
      renderPlaylist();
    }
  });

  // JSON Export / Import
  DOM.btnExportList.addEventListener('click', () => {
    if (AppState.playlist.length === 0) {
      alert('Playlist is empty.');
      return;
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(AppState.playlist, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", "agent_player_playlist.json");
    dlAnchor.click();
  });

  DOM.fileImportInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (Array.isArray(imported)) {
          AppState.playlist = imported;
          savePlaylistToStorage();
          renderPlaylist();
          if (AppState.playlist.length > 0) playVideoAtIndex(0);
        }
      } catch (err) {
        alert('Failed to read file: Invalid JSON format.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // Massalisäysmodaali
  DOM.btnBulkImport.addEventListener('click', () => {
    DOM.bulkModal.classList.remove('hidden');
    DOM.bulkTextarea.focus();
  });

  const closeBulkModal = () => DOM.bulkModal.classList.add('hidden');
  DOM.btnCloseModal.addEventListener('click', closeBulkModal);
  DOM.btnCancelBulk.addEventListener('click', closeBulkModal);

  DOM.btnConfirmBulk.addEventListener('click', async () => {
    const text = DOM.bulkTextarea.value;
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      DOM.bulkTextarea.value = '';
      closeBulkModal();
      showStatus(`Adding ${lines.length} videos...`);
      for (const line of lines) {
        await addVideoToPlaylist(line);
      }
      hideStatus();
      if (AppState.currentIndex === -1 && AppState.playlist.length > 0) {
        playVideoAtIndex(0);
      }
    }
  });

  // Cloudflare Proxy -modaali
  if (DOM.btnCfSettings) {
    DOM.btnCfSettings.addEventListener('click', () => {
      if (DOM.inputCfWorkerUrl) {
        DOM.inputCfWorkerUrl.value = AppState.cfWorkerUrl || '';
      }
      if (DOM.cfModal) {
        DOM.cfModal.classList.remove('hidden');
        if (DOM.inputCfWorkerUrl) DOM.inputCfWorkerUrl.focus();
      }
    });
  }

  const closeCfModal = () => DOM.cfModal && DOM.cfModal.classList.add('hidden');
  if (DOM.btnCloseCfModal) DOM.btnCloseCfModal.addEventListener('click', closeCfModal);

  if (DOM.btnSaveCf) {
    DOM.btnSaveCf.addEventListener('click', () => {
      const val = (DOM.inputCfWorkerUrl ? DOM.inputCfWorkerUrl.value : '').trim();
      AppState.cfWorkerUrl = val;
      try {
        localStorage.setItem('agentplayer_cf_worker_url', val);
      } catch (_) {}
      closeCfModal();
      checkServerStatus();
      showNextToast(val ? '☁️ Cloudflare Worker yhdistetty!' : 'Cloudflare Worker -osoite tyhjennetty.');
    });
  }

  if (DOM.btnClearCf) {
    DOM.btnClearCf.addEventListener('click', () => {
      AppState.cfWorkerUrl = '';
      if (DOM.inputCfWorkerUrl) DOM.inputCfWorkerUrl.value = '';
      try {
        localStorage.removeItem('agentplayer_cf_worker_url');
      } catch (_) {}
      closeCfModal();
      checkServerStatus();
      showNextToast('Cloudflare Worker -yhteys poistettu.');
    });
  }

  // Näppäinoikotiet (Keyboard Shortcuts)
  document.addEventListener('keydown', (e) => {
    // Älä käsittele pikanäppäimiä jos käyttäjä kirjoittaa tekstikenttään
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      return;
    }

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlayPause();
      resetHudAutoHide();
    } else if (e.code === 'KeyF') {
      e.preventDefault();
      toggleFullScreen();
    } else if (e.code === 'KeyN') {
      e.preventDefault();
      playNextVideo();
    } else if (e.code === 'KeyP') {
      e.preventDefault();
      playPreviousVideo();
    } else if (e.code === 'ArrowUp') {
      e.preventDefault();
      setVolume(AppState.volume + 0.05);
      resetHudAutoHide();
    } else if (e.code === 'ArrowDown') {
      e.preventDefault();
      setVolume(AppState.volume - 0.05);
      resetHudAutoHide();
    } else if (e.code === 'KeyM') {
      e.preventDefault();
      toggleMute();
      resetHudAutoHide();
    }
  });
}

// ============================================================================
// Sovelluksen käynnistys
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  initEventListeners();
  await checkServerStatus();
  loadPlaylistFromStorage();

  // Tarkistetaan taustapalvelin säännöllisesti jos ollaan localhostissa
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (isLocal) {
    setInterval(checkServerStatus, 10000);
  }

  // Jos soittolista on tyhjä, alustetaan esimerkkilista
  if (AppState.playlist.length === 0) {
    DEMO_PLAYLIST.forEach(item => {
      AppState.playlist.push({
        url: item.url,
        originalUrl: item.url,
        title: item.title,
        type: item.type,
        sourceId: item.url,
        badgeText: item.type.toUpperCase(),
        badgeClass: `badge-${item.type}`
      });
    });
    savePlaylistToStorage();
    renderPlaylist();
  }

  // Aseta alustavat HUD tilat
  DOM.hudLoopBtn.classList.toggle('active', AppState.isLooping);
  DOM.toggleLoop.checked = AppState.isLooping;

  // Palautetaan tallennettu äänenvoimakkuus
  try {
    const savedVol = localStorage.getItem('agentplayer_volume');
    if (savedVol !== null) {
      AppState.volume = parseFloat(savedVol);
    }
    const savedMuted = localStorage.getItem('agentplayer_muted');
    if (savedMuted !== null) {
      AppState.isMuted = savedMuted === 'true';
    }
  } catch (_) {}
  applyVolume();
});

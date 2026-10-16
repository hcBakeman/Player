# Agent Player – Seamless Multi-Source Video Player

**Agent Player** is a modern, responsive, browser-based video player and playlist platform. Add video links from YouTube, Vimeo, direct video files, or HLS streams and play them continuously without manual clicking – seamlessly staying in **Full Screen** mode across video changes.

Hosted live on GitHub Pages: **[https://hcbakeman.github.io/Player/](https://hcbakeman.github.io/Player/)**

---

## 🌟 Key Features

1. **Continuous Autoplay & Playlist Queue**:
   - When you press *Play*, videos play sequentially.
   - When a video ends, the player **automatically advances to the next video** without exiting fullscreen.
   - Optional *Loop* mode repeats the playlist from the beginning.

2. **Persistent Fullscreen Experience**:
   - Fullscreen is applied to the master container (`#player-container`).
   - When switching between different formats (e.g., YouTube to MP4 or Vimeo), **fullscreen never breaks**.
   - Intelligent auto-hiding HUD (Heads-Up Display): controls and timeline smoothly appear on mouse movement and fade out during playback.

3. **Multi-Source Video Engine**:
   - 🔴 **YouTube**: Standard videos, Shorts, embed URLs, and YouTube Playlists (via official YouTube IFrame API).
   - 🔵 **Vimeo**: Vimeo video links (via official Vimeo Player SDK).
   - 🟢 **Direct Video Files**: `.mp4`, `.webm`, `.mov`, `.ogg`, etc.
   - 🟣 **HLS Streams**: `.m3u8` live and adaptive bitrate streams (via Hls.js).

4. **Playlist Management & Storage**:
   - **Single URL**: Paste any supported link and optional title.
   - **Bulk Import**: Paste multiple links (one per line) or YouTube playlist URLs to add all songs/videos at once.
   - **Auto-Persistence**: Your playlist, playback volume, and settings are saved automatically in `localStorage`.
   - **Export / Import**: Save and load your playlists anytime as `.json` files.
   - **Smart Error Recovery**: If a video fails or is blocked, the player automatically skips to the next track after 3 seconds.

---

## 🚀 Deployment & Usage

### 🌐 GitHub Pages (Recommended)
This is a 100% static client-side web application running entirely in the browser:
1. Enable **GitHub Pages** in your repository settings:
   - Go to **Settings** > **Pages**.
   - Under **Build and deployment**, select **Deploy from a branch**.
   - Choose `main` branch and `/ (root)` folder, then click **Save**.
2. Visit your live site at: **https://hcbakeman.github.io/Player/**

### 💻 Local Usage
Simply open `index.html` in any modern web browser or serve locally with any static web server (e.g. `npx serve`, `python -m http.server 8080`, or Live Server).

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
|---|---|
| **Space** | Play / Pause |
| **F** | Toggle Full Screen |
| **N** | Next Video |
| **P** | Previous Video |
| **↑ (Up Arrow)** | Volume Up (+5%) |
| **↓ (Down Arrow)** | Volume Down (-5%) |
| **M** | Mute / Unmute |

---

## 🛠️ Architecture

| Component | Implementation |
|---|---|
| Frontend | Semantic HTML5, modern CSS3 (Glassmorphism dark theme, CSS grid & flexbox) |
| Video Players | HTML5 `<video>`, YouTube IFrame API, Vimeo SDK, Hls.js |
| State & Events | Event-driven architecture (`ended`, `onStateChange`, Fullscreen API, `localStorage`) |
| Deployment | GitHub Pages (zero backend dependencies required) |

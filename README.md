# Agent Player – Saumaton Monilähde-Videosoitin

**Agent Player** on selainpohjainen videosoitin ja soittolista-alusta, johon voit liittää videolinkkejä eri sivustoilta ja toistaa ne putkeen ilman manuaalista klikkailua – myös **Full Screen** (koko ruudun) tilassa!

---

## 🌟 Tärkeimmät ominaisuudet

1. **Automaattinen toisto (Autoplay & Next)**:
   - Kun painat *Toista soittolista*, videot toistuvat peräkkäin.
   - Kun video päättyy, soitin siirtyy **automaattisesti seuraavaan videoon** ilman erillistä napinpainallusta.
   - Valinnainen silmukointi (*Loop*): soittolistan päättyessä se voi alkaa automaattisesti alusta.

2. **Koko ruudun tila (Full Screen)**:
   - Fullscreen aktivoidaan koko soittimen ulkokuoreen (`#player-container`).
   - Kun video vaihtuu esimerkiksi YouTube-videosta MP4-tiedostoon tai Vimeoon, **koko ruudun tila ei katkea**, vaan seuraava video alkaa suoraan koko ruudulla!
   - Älykäs häipyvä HUD (Heads-Up Display): ohjauspainikkeet ja aikajana ilmestyvät kun liikutat hiirtä ja häipyvät automaattisesti taustalle.

3. **Laaja tuki eri videolähteille**:
   - 🔴 **YouTube**: Tavalliset videot, shorts-videot ja upotuslinkit (virallisen YouTube IFrame API:n kautta).
   - 🔵 **Vimeo**: Vimeo-videot (virallisen Vimeo Player SDK:n kautta).
   - 🟢 **Suorat videotiedostot**: `.mp4`, `.webm`, `.mov`, `.ogg` ym.
   - 🟣 **HLS-striimit**: `.m3u8` suorat live- ja adaptiiviset striimit (Hls.js-tuella).

4. **Käytettävyys & Soittolistan hallinta**:
   - **Yksittäinen lisäys**: Liitä URL ja anna halutessasi oma otsikko.
   - **Massalisäys (Bulk import)**: Liitä kymmeniä linkkejä kerralla (yksi per rivi).
   - **Automaattinen tallennus**: Soittolista säilyy selaimen muistissa (`localStorage`), vaikka päivittäisit sivun.
   - **Järjestele & Poista**: Siirrä videoita listalla ylös/alas tai poista tarpeettomat.
   - **Tallenna / Lataa tiedostosta**: Voit viedä ja tuoda soittolistoja `.json`-muodossa.
   - **Älykäs virheenohitus**: Jos jokin linkki on rikki tai estetty, soitin ilmoittaa siitä ja siirtyy automaattisesti seuraavaan 3 sekunnin kuluttua.

---

## 🚀 Käyttöönotto ja käynnistys

### Helpoin tapa (Windows):
Kaksoisnapsauta tiedostoa **[start.bat](file:///c:/Users/J/Documents/Agent-Player/start.bat)** kansiossa. Se:
1. Käynnistää taustapalvelimen (`server.py`), joka purkaa suorat videostriimit sadoilta sivustoilta.
2. Avaa automaattisesti selaimesi osoitteeseen **http://localhost:8080**.

### Vaihtoehtoisesti terminaalissa:
```powershell
python server.py
```
ja siirry selaimessa osoitteeseen: [http://localhost:8080](http://localhost:8080)

---

## 🔞 Ulkopuoliset testisivustot (kuten xHamster, Pornhub ym.)

Kun liität verkkosivun osoitteen (kuten `https://xhamster.com/videos/...`), kyseessä on kokonainen HTML-nettisivu, ei suora videotiedosto. 

`server.py` taustapalvelin:
1. Käyttää sisäänrakennettua `yt-dlp` -moottoria.
2. Etsii ja purkaa sekunnissa videon todellisen HLS- tai MP4-suoratoistolinkin (`.m3u8`), otsikon ja keston.
3. Syöttää striimin suoraan soittimeen – **ilman mainoksia, ilman ponnahdusikkunoita ja ilman ikärajakyselyitä**!
4. Koska soitin hallitsee suoraa striimiä, automaattinen seuraavaan siirtyminen ja koko ruudun tila toimivat 100 % luotettavasti.

---

## ⌨️ Pikanäppäimet

| Näppäin | Toiminto |
|---|---|
| **Välilyönti (Space)** | Toista / Keskeytä (Play / Pause) |
| **F** | Koko ruutu päälle / pois (Full Screen) |
| **N** | Seuraava video (Next) |
| **P** | Edellinen video (Previous) |
| **M** | Mykistä / Poista mykistys (Mute) |

---

## 🛠️ Tekninen arkkitehtuuri

| Komponentti | Toteutus |
|---|---|
| Käyttöliittymä | Semanttinen HTML5, moderni CSS3 (Glassmorphism Dark Theme, Flexbox & CSS Grid) |
| Soitinrajapinnat | HTML5 `<video>`, YouTube IFrame API v2, Vimeo Player SDK, Hls.js |
| Tapahtumaohjaus | `ended`, `onStateChange (0)`, `timeupdate`, Fullscreen API |
| Muistinhallinta | Selaimen `localStorage` ja JSON-vienti/tuonti |

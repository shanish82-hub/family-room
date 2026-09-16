# W ♡ S

Tiny private chat for Sammy (سامي) and Wafa (وفاء). Black/green terminal look, PeerJS link, push-to-talk, optional light camera call.

## Notes

- Password is client-side only (`DEFAULT_PASSWORD` in `app.js`). Default for this build: `wafa`.
- No backend. PeerJS broker helps two browsers find each other; chat goes over WebRTC.
- **Phone camera/mic needs HTTPS** (e.g. GitHub Pages). LAN `http://192.x` often blocks `getUserMedia`.
- Push-to-talk is the clearer voice path; camera call stays optional.
- History is localStorage on each device.

## Local test

```bash
python3 -m http.server 8765
```

Open http://localhost:8765 — enter `wafa`, pick Sammy or Wafa.

## v1 backup

Originals are in `v1-backup/`.

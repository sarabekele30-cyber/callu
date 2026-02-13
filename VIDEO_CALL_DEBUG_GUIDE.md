# Video Call Debugging Guide

## Changes Made

### 1. **Enhanced Error Handling**
Added comprehensive try-catch blocks for `getUserMedia` calls in both `startCall()` (caller) and `answerCall()` (answerer) functions.

**What it does:**
- **Catches getUserMedia failures** and shows detailed error messages
- **Checks for video track availability** - if video call is requested but no video track is obtained, it alerts the user
- **Provides actionable guidance** when camera access fails:
  - Check camera permission is granted
  - Ensure no other app is using the camera
  - Verify HTTPS connection (required for camera access)

### 2. **Detailed Console Logging**
Added extensive logging throughout the video call flow:

#### Startup Checks (Component Mount):
```
🔒 Secure context: true/false
📍 Protocol: https: or http:
🌐 Hostname: your-domain.com
⚠️ Warning if not in secure context
✅ getUserMedia availability check
```

#### During Call Setup:
```
[CALLER/ANSWERER] Requesting media: { video: {...}, audio: true }
[CALLER/ANSWERER] Got local stream - Video tracks: X, Audio tracks: Y
[CALLER/ANSWERER] Video track: (camera name), enabled: true, muted: false
[CALLER/ANSWERER] Audio track: (mic name), enabled: true, muted: false
[CALLER/ANSWERER] Set local video element srcObject
[CALLER/ANSWERER] Added track: video/audio
```

#### When Receiving Remote Stream:
```
[CALLER/ANSWERER] Received remote track: video/audio, stream count: 1
📹 VIDEO track received! ID: xxx, label: xxx, enabled: true
[CALLER/ANSWERER] Set remote stream with 2 tracks: [video (camera) enabled:true, audio (mic) enabled:true]
✅ Remote video/audio playing (vol: 1, muted: false)
```

### 3. **Security Context Verification**
Added checks to detect if the app is running in a secure context (HTTPS), which is **required for camera access** (except on localhost).

---

## How to Debug Video Call Issues

### Step 1: Open Browser Console
1. Press **F12** or **Ctrl+Shift+I** (Windows) or **Cmd+Option+I** (Mac)
2. Go to the **Console** tab
3. Clear the console (click trash icon)

### Step 2: Start a Video Call
1. Click the **Video Call** button on a user
2. Watch the console output in real-time

### Step 3: Check for Common Issues

#### Issue A: "Camera access denied or unavailable"
**Symptoms:** Alert appears when starting video call

**Check:**
1. **Browser Console**: Look for `[CALLER] getUserMedia failed:` 
2. **Error Details**: Read the error message after "getUserMedia failed:"

**Common Causes:**
- **NotAllowedError**: User denied permission or browser blocked it
  - **Fix**: Click the camera icon in address bar → Allow camera access → Refresh page
- **NotFoundError**: No camera detected
  - **Fix**: Check if camera is connected, try another camera
- **NotReadableError**: Camera is in use by another app
  - **Fix**: Close other apps using camera (Zoom, Teams, OBS, etc.)
- **Secure context error**: Not on HTTPS
  - **Fix**: Deploy on HTTPS (Render should do this automatically)

#### Issue B: "Camera not available" alert after permission granted
**Symptoms:** getUserMedia succeeds but `videoTracks.length === 0`

**Check:**
1. **Browser Console**: Look for `Video tracks: 0`
2. This means browser returned a stream without video

**Fix:**
- Check browser developer settings - sometimes dev tools can override media
- Try different browser (Chrome vs Firefox)
- Check if camera is disabled in system settings

#### Issue C: Local video shows but remote video doesn't
**Symptoms:** You can see yourself but not the other person

**Check Console for:**
```
[CALLER] Added track: video    ← Should see this on YOUR side
[ANSWERER] Received remote track: video    ← Other person should see this
📹 VIDEO track received!    ← Critical: means video is arriving
```

**If you DON'T see `📹 VIDEO track received!` on the receiving end:**
- **Problem**: Video track not being transmitted
- **Possible Causes**:
  - Network firewall blocking video (but allowing audio)
  - TURN server issues (try different network)
  - Bandwidth too low for video
  - Other person's camera is disabled

**If you DO see `📹 VIDEO track received!` but still no video:**
- **Problem**: Video element rendering issue
- **Check**:
  1. Is video element in DOM? (Inspect element)
  2. Is it hidden by CSS? (check z-index, opacity, display)
  3. Browser console error: `❌ Remote video/audio playback failed:`
  4. Try manually playing video: In console run `document.querySelector('video').play()`

#### Issue D: "Not in secure context" warning
**Symptoms:** Console shows `⚠️ NOT in secure context!`

**Impact:** Camera will NOT work on deployed site

**Fix:**
1. **Check protocol**: Should be `https://` not `http://`
2. **Render.com**: Automatically provides HTTPS
3. **Custom domain**: Ensure SSL certificate is active
4. **Local testing**: `localhost` works without HTTPS

### Step 4: Check Browser Permissions
1. Click the **lock icon** (🔒) or **info icon** (ℹ️) in address bar
2. Look for **Camera** and **Microphone** permissions
3. Should be set to **Allow**
4. If blocked, change to Allow and **refresh the page**

### Step 5: Test Camera Independently
Visit https://webcamtests.com/ to verify your camera works in the browser.

---

## Expected Console Output for Successful Video Call

### When Caller Starts Video Call:
```
[CALLER] Requesting media: { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true }
[CALLER] Got local stream - Video tracks: 1, Audio tracks: 1
[CALLER] Video track: Integrated Camera, enabled: true, muted: false
[CALLER] Audio track: Microphone, enabled: true, muted: false
[CALLER] Set local video element srcObject
[CALLER] Added track: video
[CALLER] Added track: audio
[CALLER] Created + sent offer
```

### When Answerer Receives Call:
```
[ANSWERER] Requesting media: { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true }
[ANSWERER] Got local stream - Video tracks: 1, Audio tracks: 1
[ANSWERER] Video track: Integrated Camera, enabled: true, muted: false
[ANSWERER] Audio track: Microphone, enabled: true, muted: false
[ANSWERER] Set local video element srcObject
[ANSWERER] Added track: video
[ANSWERER] Added track: audio
[ANSWERER] Received remote track: video, stream count: 1
📹 VIDEO track received! ID: xxx, label: yyy, enabled: true
[ANSWERER] Set remote stream with 2 tracks: [video (camera) enabled:true, audio (mic) enabled:true]
✅ [ANSWERER] Remote video/audio playing (vol: 1, muted: false)
[ANSWERER] Received remote track: audio, stream count: 1
```

### When Caller Receives Answer:
```
[CALLER] Received answer ✅
[CALLER] Set remote description (answer)
[CALLER] Received remote track: video, stream count: 1
📹 VIDEO track received! ID: xxx, label: yyy, enabled: true
[CALLER] Set remote stream with 2 tracks: [video (camera) enabled:true, audio (mic) enabled:true]
✅ [CALLER] Remote video/audio playing (vol: 1, muted: false)
```

---

## Quick Fixes Checklist

- [ ] **HTTPS enabled** (check protocol in address bar)
- [ ] **Camera permission granted** (click lock icon → Camera → Allow)
- [ ] **No other app using camera** (close Zoom, Teams, etc.)
- [ ] **Camera working in other apps** (test at webcamtests.com)
- [ ] **Browser console open** to see error messages
- [ ] **Try different browser** (Chrome vs Firefox)
- [ ] **Try different network** (mobile hotspot if corporate firewall)
- [ ] **Clear browser cache and refresh**
- [ ] **Restart browser completely**

---

## Technical Details

### Camera Access Requirements
- ✅ **Localhost**: Works on `http://localhost` or `http://127.0.0.1`
- ✅ **HTTPS**: Works on any `https://` URL
- ❌ **HTTP (non-localhost)**: Camera access BLOCKED by browser security

### Browser Compatibility
| Browser | Video Calls | Notes |
|---------|-------------|-------|
| Chrome 90+ | ✅ Yes | Best support |
| Firefox 88+ | ✅ Yes | Good support |
| Safari 14+ | ✅ Yes | May need extra permissions |
| Edge 90+ | ✅ Yes | Chromium-based |

### Network Requirements
- **Audio**: ~50 kbps upload/download
- **Video (720p)**: ~1-2 Mbps upload/download
- **Ports**: UDP/TCP on TURN server ports (80, 443)
- **Firewall**: May need to allowlist TURN server IPs

---

## Contact for Support

If video calls still don't work after following this guide, provide:
1. **Browser console logs** (copy all output)
2. **Browser name and version** (e.g., Chrome 120)
3. **Operating system** (Windows 11, macOS, etc.)
4. **Network type** (home wifi, corporate, mobile)
5. **Error messages** (screenshots if possible)

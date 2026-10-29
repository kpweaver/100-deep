# Phones and tablets

Status: **groundwork, landscape only**. Touch controls, a compact landscape
HUD, an installable web app and Android/iOS shells exist. They have been
tested only in a desktop browser emulating phone screens, never on a real
phone. Real-device testing comes first (see the end of this page).

## Recommendation

| Route | Effort from here | Cost | Main risk |
|---|---|---|---|
| **1. itch.io in a phone browser** | Small: test on real phones, then tick *Mobile friendly* | Free | iPhone Safari may delete saves of a site you haven't visited for 7 days |
| **2. Installable web app** (Add to Home Screen) | Done (manifest, icons, offline cache); needs a top-level host | Free (e.g. GitHub Pages) | iOS users must find Share ▸ Add to Home Screen themselves |
| **3. Android app** (Capacitor) | Medium: shell exists; build, test, sign, icons | $25 once (Play) or free (APK on itch) | Play makes new personal accounts run a closed test (12 testers, 14 days) first |
| **4. iPhone/iPad app** (Capacitor) | Medium to large: needs Xcode and a font swap | $99/year | Licensing: GPL code on the App Store (below) |

Do them in that order. Each step reuses the one before it. The game is one
browser build everywhere: the native apps run the same `client/dist-web`
inside the system web view (Capacitor), with the engine as WebAssembly.
Nothing is ported.

1. **itch.io first.** It is where the players already are. Once a real
   Android phone and iPhone have passed the checklist below, change the
   embed options:
   - Tick **Mobile friendly**.
   - Set **Orientation** to **Landscape**.

   On phones itch.io always launches HTML games click-to-play and full
   screen. iOS has no fullscreen API, so there it fills the browser window
   instead. ([itch.io][itch-mobile])
2. **Android APK on itch.io.** Skip the Play Store's testing rules at first:
   upload a signed APK next to the HTML build. Move to Google Play once
   there are 12 testers who will keep it installed for 14 days. Personal
   developer accounts made after 13 November 2023 must run that closed test
   before Play allows a public release. ([summary][play-12])
3. **iOS last.** Resolve the licensing question first, because it decides
   whether an App Store build can exist at all. TestFlight would be the
   first step after that.

## What exists now

### Touch controls (`client/src/ui/touch.ts`)

Touch becomes the input device on a phone or tablet: a coarse pointer with
no hover, or any finger on the screen. `?touch` forces it for testing on a
desktop. The on-screen controls press the same semantic actions as keys and
controller buttons, so game code never knows a finger did it.

- **Left:** a crawler-style movement pad. Top row: turn left, forward, turn
  right. Bottom row: step left, back, step right. Held buttons repeat, and
  holding forward runs.
- **Right:** one row of buttons along the bottom edge (Gear, Use and three
  situational ones, the most used nearest the thumb). Above its right end,
  a large contextual button appears only when there is something to do
  there, labelled with the action (Descend, Attack, Open, Pick up). Hold it
  for the context menu.
  - In a fight, the three situational buttons are Advance (step toward the
    nearest monster, or strike it when adjacent), Fire (Throw without
    ammunition) and Aim.
  - When it is quiet, they are Explore (Stop while exploring; hold: travel
    to the stairs), Rest (hold: wait a turn) and Look.
  - Casters get **Cast**, which opens the spell list in one tap, and a
    **Study** button appears left of Gear whenever a new spell can be learned.
  - **Use** opens the combat wheel; **Gear** opens the gear wheel. Both stay
    open until a slice is tapped.
- **Top right:** Full (full screen and landscape lock, where the browser
  allows it), Map, ⋯ (every command) and ≡ (the menu).
- **HUD taps:** tapping the minimap opens the map; tapping the vitals opens
  the character sheet.
- **Swipes** across the view: sideways turns the way the finger moves
  (Options ▸ Invert swipe turning reverses it), up steps forward, down
  steps back.
- **Menus:**
  - Rows take taps; a long press is the secondary action (Examine).
  - Every menu has a close button.
  - Footer prompts ("Select", "Examine", "Back") become buttons. A tapped
    prompt presses the key it names (`InputManager.pressLabel`), so every
    existing screen works on touch without changes.
  - On the map, a tap travels to that spot.
- **Name entry** uses the phone's own keyboard.

### Landscape layout (`client/src/styles.css`, "Touch")

Below 520 px of height in touch mode, the HUD shrinks:

- Top left: HP and SP bars, depth and status.
- Next to it: the message log.
- Top right: the minimap.
- Near the bottom, centred: the target's name, clear of the controls.

Everything stays inside the notch's safe areas (`env(safe-area-inset-*)`).
A phone held upright gets a "Turn your phone sideways" screen; the game is
turn-based, so nothing happens meanwhile. Tablets keep the desktop HUD,
with the touch controls added.

The page never scrolls, zooms or selects text under a finger
(`touch-action`, `user-select`). Lists, text and the map still scroll.

### Installable web app (`client/public/manifest.webmanifest`, `sw.js`)

- Add to Home Screen opens the game full screen in landscape, with the
  dragon icon (`client/public/icons/`, scaled from the favicon tile).
- When the browser build is the top-level page, a service worker caches it
  for offline play. It is not registered inside itch.io's frame, in the dev
  server or in the native shells.
  - Content-hashed files (`assets/`, `engine/<hash>/`) are cache-first.
  - The page and other files are network-first, so new releases arrive.
- The browser build asks for persistent storage
  (`navigator.storage.persist()`), so Chrome is less likely to evict saves.
- Saves were already written when the tab is hidden
  (`wasm/worker-connection.ts`), which is when phones kill background tabs.

A home-screen app also escapes Safari's 7-day storage limit: WebKit counts
days separately for it, so its saves stay. ([WebKit, via Search Engine
Land][webkit-7day]) The catch: it needs a top-level host such as GitHub
Pages or the project's own domain, because Add to Home Screen from inside
itch.io's frame installs itch.io, not the game.

### Android and iOS shells (`mobile/`)

[Capacitor](https://capacitorjs.com) 8 wraps `client/dist-web`. Like
`desktop/`, `mobile/` is **not** an npm workspace, so web builds never
download it.

- App id `com.hundreddeep.game` (the same as the desktop build). Change it
  before the first store upload if you want another; it is permanent after
  that.
- **Android** (`mobile/android`):
  - `sensorLandscape` orientation.
  - Immersive full screen: the system bars come back with an edge swipe.
  - Touch and gamepad are both optional features, so controller-only
    devices qualify.
- **iOS** (`mobile/ios`, Swift Package Manager, no CocoaPods):
  - Landscape left and right only.
  - Status bar hidden and full screen required.
  - Game controllers declared (`GCSupportedGameControllers`).
- **Both** (`App.installNativeHooks` in the client):
  - Android's back button backs out of a menu, opens the game menu in play,
    and leaves the app from the title screen.
  - The game saves when the app goes to the background.
- **Saves** live in the app's own web view storage. The system doesn't
  evict it the way browsers do, but uninstalling the app deletes it.

```bash
cd mobile
npm install
npm run android     # build:web, copy into the Android project, open Android Studio
npm run ios         # the same for Xcode
npm run apk         # debug APK without Android Studio (needs JDK 17–21 and the Android SDK)
```

#### Building on this Mac

- **iOS:** Xcode is not installed (only the command-line tools), so nothing
  iOS can be built or simulated yet. Install Xcode from the App Store; the
  project then opens and runs in the Simulator.
- **Android:** the SDK is here; there is no system image (emulator), so
  test on a phone.
  - Capacitor's Gradle 8.14 runs on JDK 17–21. `openjdk@21` is installed
    with Homebrew (keg-only, so the default `java` is unchanged); point
    Gradle at it:

    ```bash
    export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=~/Library/Android/sdk
    npm --prefix mobile run apk
    ```

    The APK lands in `mobile/android/app/build/outputs/apk/debug/`.
  - In Android Studio, point *Settings ▸ Build Tools ▸ Gradle ▸ Gradle JDK*
    at that same JDK 21.
  - Installing a debug APK on a phone: send it over, open it, and allow
    installs from that app when Android asks. Debug builds are signed with
    this Mac's debug key, so a Play build (signed differently) replaces it
    only after uninstalling.

## Feasibility notes

**Performance.** The engine is 1.8 MB of WebAssembly; the whole download is
about 2.4 MB. Turns take well under a frame even with Asyncify. Rendering
is light three.js (one dungeon mesh, billboards), with the pixel ratio
capped at 2. Any phone from the last five years should manage 60 fps. The
retro pixel-scale option is a ready fallback for weak GPUs.

**Saves in the browser.**
- On itch.io, saves sit in the storage of itch's game frame
  (`html-classic.itch.zone`).
- Browsers keep that storage separate from everything else.
- iPhone Safari may delete script-writable storage, IndexedDB included,
  after 7 days of Safari use without a visit. The partitioned third-party
  case isn't documented.
- An **export/import save** button is the cheap insurance: the engine's
  save is one file in its IndexedDB filesystem.
- The installed web app and the native apps don't have this problem.

**Controllers on phones.** Chrome on Android and Safari on iOS expose
Bluetooth Xbox, PlayStation and MFi pads through the Gamepad API, so the
controller scheme should work as it is. In a WKWebView (the iOS app), the
web view must be the first responder for the Gamepad API to report the pad.
Check this on a device; it is a few lines of Swift if not.
([WebKit bug 162385][wk-gamepad])

**Fullscreen.**
- Android Chrome: the Full button goes full screen and locks landscape.
- iPhones: no fullscreen API, so the button is hidden. itch.io maximises
  the frame, and the home-screen app and native app are full screen
  already.
- iPads: have the fullscreen API.

## Licensing for app stores

> From reading the licence files. This is not legal advice; check before
> relying on it, especially for iOS.

- **Google Play and itch.io:** GPLv2 is fine. The source is already public,
  and the APK should link to it, as the HTML build does.
- **Apple App Store:** the FSF holds that Apple's store terms add
  restrictions GPLv2 forbids, and VLC was pulled over this in 2011. Each
  part of the game needs a licence that allows the store:
  - **The Angband core** is dual-licensed: GPLv2 *or* the Angband licence,
    which allows copying "for educational, research, and not for profit
    purposes". A free app can use the Angband licence instead of the GPL.
  - **This project's code** (adapter, client, bridge) and its changes to
    `engine/lib` are GPLv2 by this project's choice. The copyright holder
    can add an App Store exception or dual-license them. That holds only
    while every contributor agrees; so far that is one person.
  - **The fonts** (`angband-8x16x`) are GPL-only, by Leon Marrick, Sheldon
    Simms III and Nick McConnell. An iOS build would swap in a pixel font
    under the SIL OFL, or ask permission.
  - **Gervais tiles:** CC BY 3.0, fine with credit. **three.js:** MIT.
- Apple's guideline 4.2 (minimum functionality) rejects thin website
  wrappers. A complete offline game bundled in the app is not one.

## Before turning on Mobile friendly: real-device checklist

- [ ] Android Chrome and iPhone Safari, inside the itch.io page:
  - [ ] the game loads;
  - [ ] the touch controls appear;
  - [ ] the notch doesn't cover the movement pad.
- [ ] The New character flow, including typing a name.
- [ ] A full session:
  - [ ] fight;
  - [ ] cast from the Use wheel;
  - [ ] pick up, wear and drop from the Gear wheel;
  - [ ] descend;
  - [ ] save, close the tab, reopen, Continue.
- [ ] Turn the phone upright and back: the rotate screen shows and goes,
      with no layout glitches.
- [ ] Android: Full enters full screen and locks landscape.
- [ ] A Bluetooth controller on a phone: the prompts switch to button
      glyphs, and back to touch on the next tap.
- [ ] Frame rate on an older phone: try the retro pixel scale if it is low.

## Next steps

1. Real-device testing (above), then *Mobile friendly* on itch.io.
2. Save export and import, for phone browsers.
3. Tap-to-travel in the 3D view: tap a floor grid, path there (like a map
   tap).
4. Native polish:
   - launcher icons and splash screens (`npx @capacitor/assets generate`);
   - Android edge-to-edge insets on notched phones (target SDK 36);
   - haptics on iOS (`@capacitor/haptics`; Safari has no `navigator.vibrate`).
5. A top-level web host (GitHub Pages), so the installable web app has
   somewhere to be installed from.
6. The iOS licence decisions, then Xcode, TestFlight.

[itch-mobile]: https://itch.io/updates/better-support-for-mobile-html-games-more
[play-12]: https://ontest.app/blog/google-play-12-testers-14-days-requirement-explained
[webkit-7day]: https://searchengineland.com/what-safaris-7-day-cap-on-script-writeable-storage-means-for-pwa-developers-332519
[wk-gamepad]: https://bugs.webkit.org/show_bug.cgi?id=162385

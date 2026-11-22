# Loading screen — short design (approved 2026-11-21)

**Why:** a first-time visitor sees a blank page while the code downloads, then a bare "Tap to play". The PO wants a
proper loading screen like Clash of Clans / Brawl Stars / Stumble Guys: key art, logo, progress bar, rotating tips, so
the player understands the game before Home and everything is ready when they get there.

**Prior art:** CoC / Clash Royale / Brawl Stars: full-bleed key art, big logo, bottom progress bar, one rotating
"Did you know" tip. Stumble Guys / Fall Guys: tips that teach the rules.

**Approaches considered**
1. *Chosen:* the loading screen lives in `index.html` (inline CSS) so it paints before any JS arrives, and becomes the
   existing "Tap to play" splash once ready. One screen, no extra tap.
2. Separate JS loading screen before the splash — rejected: it can't show during the bundle download (the blank part).
3. Custom painted key art — deferred: the PO can supply it later; v1 composes the three existing portraits over a CSS
   lava glow (Vite fingerprints the `<img>`s so they're preloaded with the page).

**Design**
- Stages: before JS the bar creeps to ~40 % (CSS). JS: 50 % "Building the arena…" → shaders compiled
  (`renderer.compileAsync`) 80 % "Heating the volcano…" → portraits decoded 90 % → first frame 100 %, bar swaps to a
  pulsing "Tap to play". A 10 s safety timeout makes it ready anyway.
- Pitch line: "Shove your rivals into the lava. Last one standing wins!" Tips rotate every 4 s and keep rotating on
  the tap screen, so fast connections still get reading time.
- Tap/keys behave as before (click only, modifier keys ignored), but only once ready. Deep links (`?room=`) unchanged.
- Reduced motion: no creep/pulse/rotation animation (tips still change).

**Non-goals:** audio, real byte-level download progress, a custom painted scene.

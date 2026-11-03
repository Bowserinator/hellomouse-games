# Tycoon verification

Verified 2026-11-02.

## Automated checks

- TypeScript build, Sass compilation, scoped ESLint and `git diff --check` passed.
- All 18 Node tests passed. The simulation includes 4,000 seeded games, both joker options and all round settings.
- Both copied images match the original Bullshit images byte-for-byte.

## Browser checks

- The local hand stays in the bottom HUD when the camera zooms. At 390 px it scrolls horizontally without page overflow.
- Cards use a 5:7 ratio: 65 × 91 px in the hand and 130 × 182 px in the enlarged focus preview.
- Native Space/Enter selects and plays a card. Tab/Space/Enter selects and confirms exchange cards; focus survives selection.
- Reconnect during play restores the human seat with zero replay events. Reconnect during exchange restores the outstanding choice with zero replay events.
- Two browser clients plus two AIs completed a one-round, jokers-off game without errors.
- Solo versus three AIs completed 20 jokers-off rounds without errors; scores were 47/24/26/23, totaling 120.
- A two-client, 20-round jokers-on run also completed with 120 total points. Its first automation driver submitted some exchange choices twice; the server rejected the duplicates. A state-key guard fixed the driver before the clean runs above.
- The earlier solo one-round jokers-on run completed with normal server pacing.
- Reduced-motion rendering applies final counts without flights.
- At normal speed and 4× CPU throttling, fixture-driven timelines covered shuffle/deal/reveal, gather, exchanges in both directions, play, clear, lucky 7, lone joker/2-spades counter, revolution, bankruptcy and Beggar discard. Each queue settled without errors or leftover ghosts. Destination hiding was observed. The hand remained selectable during play and clear flights.
- Zoom, fit and reset controls changed/restored the camera without moving the fixed hand.
- An isolated Chrome CDP check verified a 65 px HUD card flying into a 32.5 px zoomed table card: initial scale 2, final scale 1, top-left transform origin, hidden destination and zero remaining ghosts.
- Reviewed settled 1280 × 800 desktop, fitted table, 390 × 844 mobile and enlarged-preview screenshots from isolated headless Chrome. Card faces, controls, high-contrast panels and scrollable hand are readable. Fit reveals the full table; the closer default view can be panned. Screenshots are `/tmp/tycoon-desktop.png`, `/tmp/tycoon-fit.png`, `/tmp/tycoon-mobile.png`, `/tmp/tycoon-preview.png` and `/tmp/tycoon-mobile-preview.png`. Geometry assertions are in `/tmp/tycoon-visual-report.json`.

Long-session checks used an isolated server with only Tycoon game timers capped at 40 ms and client reduced-motion enabled. Production timing was not changed. Rare animation checks used injected engine views in a separate browser tab, with normal animation durations.

## Limitations

The shared browser backend could not capture screenshots, so visual review used a separate Chrome process and temporary profile. Reduced-motion checks forced the browser media-query branch rather than changing the OS preference. The thumbnail is deliberately unchanged: TODO: replace placeholder thumbnail.

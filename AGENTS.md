# Pfand Run
Browser runner game on a Berlin street. One run lasts 60 seconds and ends
at the Dönerladen. Player collects Pfand bottles, avoids obstacles, and is
chased by a BVG Kontrolleur. Score is the number of Döner bought with the
collected Pfand. Full rules are in docs/SPEC.md.

## Constraints
- Plain HTML/CSS/JS, single page, no build step, no API keys, no backend.
- Deploys on GitHub Pages. Graphics are drawn in code on the canvas: no image files, no libraries.
- All tuning values (Döner price, bottle value, speeds, spawn rates,
  Späti cost, crash window, hitbox scales) live in config.js.

## Rules
- docs/SPEC.md is the source of truth. Do not change rules without asking.
- Build only the step I name. The AI-learning idea is a later stretch.
- Commit after each working step; messages describe what and why.

## Definition of done per step
- Runs by opening index.html. No console errors.
- Goal and score readable within 10 seconds of starting.
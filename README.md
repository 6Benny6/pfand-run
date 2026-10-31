# Pfand Run

A Berlin runner game: collect Pfand bottles, dodge U-Bahn signs and Lime
scooters, escape the BVG Kontrolleur, and cash in at the Dönerladen.
Built with OpenAI Codex.

Play it here: https://6benny6.github.io/pfand-run/

## How to play
- Left / right arrow: switch lane
- Up arrow: jump (skips bottles while airborne)
- Down arrow: crouch, hold it (max 2 seconds)
- R: restart, H: show the hitbox debug overlay

Survive 60 seconds to reach the Dönerladen. Each bottle is worth 50 cents,
a Döner costs 7,50 (15 bottles). Crash twice within 3 seconds and the
Kontrolleur catches you. Späti shops cost you 3 bottles if you run through them.

## How it was built
I wrote the spec (docs/SPEC.md) and the rules first, then had Codex build
one step at a time: it proposed a plan, I checked it, and every working
step is a git commit and tag (step-1-game through the latest). The rules
live in the spec, and all tuning numbers live in config.js. The graphics
are drawn in code on a canvas, with no images or libraries.

## What Codex got wrong, and what I caught
- The first end screen showed leftover money in cents next to a euro total,
  and it read as wrong. I had it changed to euros.
- Rules I hadn't written down (when the Späti toll is charged, removing a
  bottle after pickup) had to be added to the plan before building.
- Codex left out the check that a jump or crouch lasts longer than an
  obstacle overlaps the player, so I asked it to report the numbers.
- Crouching was timed instead of held, so I changed the spec and rebuilt it.
- My AGENTS.md ended up empty after a paste error. I caught it by checking
  the file size and restored it.

## Known issues
- Large objects (U-Bahn signs, Spätis) keep scaling briefly after you
  pass them.
- Keyboard only for now.

## Next steps
- Touch controls
- Real 3D models
- An AI that learns to play the game, to show how learning works
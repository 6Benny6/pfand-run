# Pfand Run: Spec

## Goal
Collect Pfand bottles, dodge obstacles and escape the BVG Kontrolleur who
is chasing you. If you survive 60 seconds you arrive at the Dönerladen and
all your Pfand is converted into Döner. More Döner = more points. You lose
if you crash into two obstacles within 3 seconds of each other.

## Scoring
Each Pfand bottle is worth 50 cents and one Döner costs 7,50 (15 bottles
per Döner). At the end, all bottles are converted into Döner. With fewer
than 15 bottles the score is 0 Döner.

## Controls
Arrow keys: left/right switch lane, up = jump, down = crouch. R restarts.

## Obstacles
1) U-Bahn station signs: crouch under them. Jumping into one is a crash.
2) Lime scooters: jump over them or switch to a lane without one.
   Crouching into one is a crash.
3) Späti shops: not a crash. Passing through one costs 3 bottles
   (never below 0). Switching lane avoids it. (new) A Späti only spawns
   when the player has at least 3 bottles.
Rule: Obstacles must be cleared for their whole length. A crash takes place
 if the player is in the obstacle's lane and the required action (jump over
 scooter/ crouch under u-bahn) is not activated for the entire time the 
obstacles overlaps the player. one obstacle can cause one crash at most.

## Three behaviors
1) Three lanes; the player switches lanes, jumps and crouches to dodge.
2) The first crash brings the Kontrolleur into view as he closes in. A
   second crash within 3 seconds ends the run. (new) If the 3 seconds
   pass without a second crash, he drops back out of view.
3) Pfand bottles appear on the street. The player collects the bottle by touching it,
while in the same lane (running or crouching). Jumping over a bottle means it is not 
collected.


## Ending
- Survive 60 seconds: the Dönerladen appears and the end screen shows
  bottles collected, total Pfand in euros, and the number of Döner.
- Caught: the run ends with a "caught" screen and a restart key.

## What's different
It applies a common game idea to the context of the wild city that is
Berlin.

## Later (stretch)
Show how an AI learns to play this game and adapts to the troubles of
Berlin life. Not part of version 1.

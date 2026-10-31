(() => {
  'use strict';

  const config = window.GAME_CONFIG;
  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d');
  const crashCounter = document.querySelector('#crashes');
  const pfandCounter = document.querySelector('#pfand');
  const tollMessage = document.querySelector('#toll-message');
  const status = document.querySelector('#status');
  const pursuitLabel = document.querySelector('#pursuit-label');
  const distanceMeter = document.querySelector('#distance');
  const caughtScreen = document.querySelector('#caught');
  const finishedScreen = document.querySelector('#finished');
  const countdown = document.querySelector('#countdown');
  document.querySelector('#restart-key').textContent = config.restartKey.toUpperCase();
  document.querySelector('#finish-restart-key').textContent = config.restartKey.toUpperCase();
  // CSS pixels are independent of the canvas's high-DPI backing buffer.
  const viewport = { width: 0, height: 0, pixelRatio: 1 };
  function resizeCanvas() {
    viewport.width = window.innerWidth;
    viewport.height = window.innerHeight;
    viewport.pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.round(viewport.width * viewport.pixelRatio);
    canvas.height = Math.round(viewport.height * viewport.pixelRatio);
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // Mulberry32: the same seed produces the same spawn sequence.
  let seed = config.seed >>> 0;
  function random() {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  function nextInterval() {
    return Math.max(config.minObstacleGapSeconds,
      config.spawnIntervalMin + random() * (config.spawnIntervalMax - config.spawnIntervalMin));
  }

  function nextBottleInterval() {
    return config.bottleSpawnIntervalMin + random() *
      (config.bottleSpawnIntervalMax - config.bottleSpawnIntervalMin);
  }

  const player = { lane: config.startLane, action: 'run', actionRemaining: 0 };
  let crouchHeld = false;
  let debugHitboxes = config.debugHitboxes;
  let obstacles = [];
  let bottles = [];
  const recentLanes = [];
  let elapsed = 0;
  let spawnAt = nextInterval();
  let bottleSpawnAt = nextBottleInterval();
  let lastRowAt = -Infinity;
  let lastObstacleAt = -Infinity;
  let pfand = 0;
  let tollMessageRemaining = 0;
  let crashes = 0;
  let flashRemaining = 0;
  let previousTime = null;
  let firstCrashAt = null;
  let caught = false;
  let finished = false;
  // Leave enough time for even the tallest hazard to pass completely before the line.
  const finishClearanceSeconds = (config.playerY - config.spawnY +
    Math.max(config.obstacleHeight + config.signPostHeight, config.spaetiHeight)) /
    config.startSpeed + config.maxFrameSeconds;
  const laneWidth = (config.roadRight - config.roadLeft) / config.laneCount;
  const laneX = lane => config.roadLeft + laneWidth * (lane + 0.5);
  // Shrink both ground hitboxes around their existing centers.
  const overlapCenterY = config.playerY - config.playerSize / 2 + config.obstacleHeight / 2;
  const obstacleHitboxScale = obstacle => obstacle.definition.type === 'sign'
    ? config.signHitboxScale : config.hitboxScale;

  function overlapBounds(obstacle) {
    const halfHeight = (config.playerSize * config.hitboxScale +
      config.obstacleHeight * obstacleHitboxScale(obstacle)) / 2;
    return { overlapStartY: overlapCenterY - halfHeight, overlapEndY: overlapCenterY + halfHeight };
  }

  function updateCountdown() {
    countdown.textContent = `${Math.ceil(Math.max(0, config.runDurationSeconds - elapsed))}s`;
  }

  function finish() {
    finished = true;
    releaseCrouch();
    firstCrashAt = null;
    flashRemaining = 0;
    tollMessageRemaining = 0;
    tollMessage.textContent = '';
    player.action = 'run';
    player.actionRemaining = 0;
    const totalCents = pfand * config.bottleValueCents;
    const leftoverCents = totalCents % config.doenerPriceCents;
    const doener = (totalCents - leftoverCents) / config.doenerPriceCents;
    const formatEuros = cents => `€${(cents - cents % 100) / 100}.${String(cents % 100).padStart(2, '0')}`;
    document.querySelector('#result-bottles').textContent = String(pfand);
    document.querySelector('#result-pfand').textContent = formatEuros(totalCents);
    document.querySelector('#result-doener').textContent = String(doener);
    document.querySelector('#result-leftover').textContent = `${formatEuros(leftoverCents)} (${formatEuros(config.doenerPriceCents - leftoverCents)} short of Döner #${doener + 1})`;
    finishedScreen.hidden = false;
    status.textContent = 'You reached the Dönerladen!';
    updatePursuit();
  }

  function kontrolleurDistance() {
    const progress = Math.min(1, (elapsed - firstCrashAt) / config.crashWindowSeconds);
    return config.kontrolleurStartDistance + progress *
      (config.kontrolleurCloseDistance - config.kontrolleurStartDistance);
  }

  function updatePursuit() {
    distanceMeter.hidden = firstCrashAt === null;
    if (caught) {
      distanceMeter.value = 0;
      pursuitLabel.textContent = 'Kontrolleur: caught you';
    } else if (firstCrashAt !== null) {
      distanceMeter.value = Math.round(kontrolleurDistance() / config.kontrolleurStartDistance * 100);
      pursuitLabel.textContent = `Kontrolleur distance: ${distanceMeter.value}%`;
    } else {
      pursuitLabel.textContent = 'Kontrolleur out of view';
    }
  }

  function recordCrash(time) {
    crashes += 1;
    crashCounter.textContent = String(crashes);
    flashRemaining = config.crashFlashDuration;
    if (firstCrashAt !== null && time - firstCrashAt < config.crashWindowSeconds) {
      caught = true;
      releaseCrouch();
      caughtScreen.hidden = false;
      status.textContent = 'Caught. Restart to try again.';
    } else {
      firstCrashAt = time;
      status.textContent = 'Kontrolleur closing in! Avoid another crash until he drops back.';
    }
  }

  function restart() {
    releaseCrouch();
    seed = config.seed >>> 0;
    player.lane = config.startLane;
    player.action = 'run';
    player.actionRemaining = 0;
    obstacles = [];
    bottles = [];
    recentLanes.length = 0;
    elapsed = 0;
    spawnAt = nextInterval();
    bottleSpawnAt = nextBottleInterval();
    lastRowAt = -Infinity;
    lastObstacleAt = -Infinity;
    pfand = 0;
    pfandCounter.textContent = `Pfand: ${pfand} ${config.bottleEmoji}`;
    tollMessageRemaining = 0;
    tollMessage.textContent = '';
    crashes = 0;
    flashRemaining = 0;
    firstCrashAt = null;
    caught = false;
    finished = false;
    previousTime = null;
    crashCounter.textContent = '0';
    caughtScreen.hidden = true;
    finishedScreen.hidden = true;
    status.textContent = 'Dodge obstacles to keep the Kontrolleur away.';
    updatePursuit();
    updateCountdown();
  }

  function spawnObstacle() {
    // Never occupy all three lanes across three consecutive spawn events.
    const allowedLanes = Array.from({ length: config.laneCount }, (_, lane) => lane)
      .filter(lane => new Set([...recentLanes, lane]).size < config.laneCount);
    const lane = allowedLanes[Math.floor(random() * allowedLanes.length)];
    const canSpawnSpaeti = pfand >= config.spaetiCost &&
      !obstacles.some(obstacle => obstacle.definition.type === 'spaeti');
    const definition = canSpawnSpaeti && random() < config.spaetiSpawnChance
      ? config.spaeti
      : config.obstacles[Math.floor(random() * config.obstacles.length)];
    obstacles.push({ lane, y: config.spawnY, definition, passed: false, crashed: false });
    recentLanes.push(lane);
    if (recentLanes.length > config.laneCount - 1) recentLanes.shift();
  }

  function releaseCrouch() {
    crouchHeld = false;
    if (player.action !== 'crouch') return;
    player.action = 'run';
    player.actionRemaining = 0;
    if (!caught && !finished && firstCrashAt === null) {
      status.textContent = 'Dodge obstacles to keep the Kontrolleur away.';
    }
  }

  window.addEventListener('keyup', event => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    releaseCrouch();
  });
  window.addEventListener('blur', releaseCrouch);

  window.addEventListener('keydown', event => {
    if (event.key.toLowerCase() === 'h') {
      event.preventDefault();
      if (!event.repeat && !document.hidden) debugHitboxes = !debugHitboxes;
      return;
    }
    if ((caught || finished) && event.key.toLowerCase() === config.restartKey.toLowerCase()) {
      event.preventDefault();
      if (!event.repeat && !document.hidden) restart();
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    if (event.repeat || document.hidden || caught || finished) return;
    if (event.key === 'ArrowDown') {
      if (crouchHeld) return;
      crouchHeld = true;
    }
    const previousLane = player.lane;
    if (event.key === 'ArrowLeft') player.lane = Math.max(0, player.lane - 1);
    if (event.key === 'ArrowRight') player.lane = Math.min(config.laneCount - 1, player.lane + 1);
    if (player.lane !== previousLane) {
      for (const obstacle of obstacles) {
        const { overlapStartY, overlapEndY } = overlapBounds(obstacle);
        if (obstacle.definition.type !== 'spaeti' && !obstacle.crashed &&
            obstacle.lane === previousLane && obstacle.y > overlapStartY &&
            obstacle.y < overlapEndY) {
          obstacle.passed = true; // Leaving during overlap clears this obstacle.
        }
      }
    }
    if (player.action !== 'run') return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      player.action = event.key === 'ArrowUp' ? 'jump' : 'crouch';
      player.actionRemaining = player.action === 'jump' ? config.jumpDuration : config.crouchMaxSeconds;
      if (firstCrashAt === null) status.textContent = player.action === 'jump' ? 'Jumping' : 'Crouching';
    }
  });

  // Hidden tabs pause simulation so returning cannot cause unseen crashes.
  document.addEventListener('visibilitychange', () => { previousTime = null; });

  function update(dt) {
    if (caught || finished) return;
    dt = Math.min(dt, config.runDurationSeconds - elapsed);
    elapsed += dt;
    updateCountdown();
    flashRemaining = Math.max(0, flashRemaining - dt);
    tollMessageRemaining = Math.max(0, tollMessageRemaining - dt);
    if (!tollMessageRemaining) tollMessage.textContent = '';
    const actionAtStart = player.action;
    const actionTimeAtStart = player.actionRemaining;
    // A row is shared across all lanes. Defer due spawns until it is clear.
    const hazardsAllowed = elapsed < config.runDurationSeconds - finishClearanceSeconds;
    if (hazardsAllowed && elapsed >= spawnAt && elapsed - lastRowAt >= config.rowGapSeconds &&
        elapsed - lastObstacleAt >= config.minObstacleGapSeconds) {
      spawnObstacle();
      lastRowAt = elapsed;
      lastObstacleAt = elapsed;
      spawnAt = elapsed + nextInterval();
    }
    // Reserve the next obstacle row so bottles never delay its scheduled spawn.
    if (elapsed >= bottleSpawnAt && elapsed - lastRowAt >= config.rowGapSeconds &&
        (!hazardsAllowed || spawnAt - elapsed >= config.rowGapSeconds)) {
      bottles.push({ lane: Math.floor(random() * config.laneCount), y: config.spawnY });
      lastRowAt = elapsed;
      bottleSpawnAt = elapsed + nextBottleInterval();
    }
    for (const obstacle of obstacles) {
      const previousY = obstacle.y;
      obstacle.y += config.startSpeed * dt;
      if (obstacle.definition.type !== 'spaeti') {
        if (obstacle.passed || obstacle.crashed) continue;
        const { overlapStartY, overlapEndY } = overlapBounds(obstacle);
        // Sweep the full frame against the player's fixed ground footprint.
        const overlapStart = Math.max(0,
          (overlapStartY - previousY) / config.startSpeed);
        const overlapEnd = Math.min(dt,
          (overlapEndY - previousY) / config.startSpeed);
        if (overlapStart < overlapEnd && obstacle.lane === player.lane) {
          const correctAction = actionAtStart === obstacle.definition.requiredAction;
          if (!correctAction || actionTimeAtStart < overlapEnd) {
            const crashTime = correctAction ? Math.max(overlapStart, actionTimeAtStart) : overlapStart;
            obstacle.crashed = true;
            recordCrash(elapsed - dt + crashTime);
            if (caught) break;
          }
        }
        if (obstacle.y >= overlapEndY) obstacle.passed = true;
        continue;
      }
      if (!obstacle.passed && previousY < config.playerY && obstacle.y >= config.playerY) {
        obstacle.passed = true;
        if (obstacle.lane === player.lane && !caught && !finished) {
          if (obstacle.definition.type === 'spaeti') {
            pfand = Math.max(0, pfand - config.spaetiCost);
            pfandCounter.textContent = `Pfand: ${pfand} ${config.bottleEmoji}`;
            tollMessage.textContent = `Späti-Preise: -${config.spaetiCost} ${config.bottleEmoji}`;
            tollMessageRemaining = config.spaetiMessageDuration;
          }
        }
      }
    }
    if (!caught && firstCrashAt !== null && elapsed - firstCrashAt >= config.crashWindowSeconds) {
      firstCrashAt = null;
      status.textContent = 'Kontrolleur dropped back. Keep running!';
    }
    updatePursuit();
    if (caught) return;
    bottles = bottles.filter(bottle => {
      const previousY = bottle.y;
      bottle.y += config.startSpeed * dt;
      if (previousY < config.playerY && bottle.y >= config.playerY && bottle.lane === player.lane) {
        const crossingTime = (config.playerY - previousY) / config.startSpeed;
        const action = actionTimeAtStart > crossingTime ? actionAtStart : 'run';
        if (action === 'jump') return true;
        pfand += 1;
        pfandCounter.textContent = `Pfand: ${pfand} ${config.bottleEmoji}`;
        return false; // Remove immediately: every bottle can count only once.
      }
      return bottle.y < config.worldHeight + config.bottleSize;
    });
    player.actionRemaining = Math.max(0, player.actionRemaining - dt);
    if (!player.actionRemaining && player.action !== 'run') {
      player.action = 'run';
      if (firstCrashAt === null) status.textContent = 'Dodge obstacles to keep the Kontrolleur away.';
    }
    obstacles = obstacles.filter(obstacle => obstacle.y < config.worldHeight +
      Math.max(config.obstacleHeight + config.signPostHeight, config.spaetiHeight));
    if (elapsed >= config.runDurationSeconds) finish();
  }

  // Rendering only: shared depth for the road, upright artwork, and ground boxes.
  // Omitting y intersects a road edge with the bottom of the viewport.
  function project(x, y) {
    const horizonY = viewport.height * (config.camera.horizonY / config.worldHeight + 0.05);
    const playerScreenY = viewport.height * 0.84;
    const screenDepth = viewport.height - horizonY;
    const playerDepth = playerScreenY - horizonY;
    // Preserve a readable spawn scale while bringing the camera closer.
    const cameraDepth = (config.playerY - config.spawnY) * config.camera.minimumScale /
      (1 - config.camera.minimumScale);
    const depth = y === undefined ? cameraDepth * playerDepth / screenDepth
      : cameraDepth + config.playerY - y;
    const perspective = cameraDepth / depth;
    // Ground framing adapts to aspect ratio; upright height uses vertical FOV.
    const roadScale = viewport.width * 1.12 / (config.roadRight - config.roadLeft) *
      playerDepth / screenDepth * perspective;
    const scale = viewport.height / (config.playerSize * 4) * perspective;
    return {
      x: viewport.width / 2 + (x - config.worldWidth / 2) * roadScale,
      y: horizonY + playerDepth * perspective,
      scale,
      roadScale,
      horizonY,
    };
  }

  // These bounds mirror the ground geometry used by overlapBounds(), not artwork.
  function playerDrawBounds() {
    const size = config.playerSize * config.hitboxScale;
    return { x: laneX(player.lane), y: config.playerY - config.playerSize / 2,
      width: size, height: size };
  }

  function obstacleDrawBounds(obstacle) {
    const scale = obstacleHitboxScale(obstacle);
    return { x: laneX(obstacle.lane), y: obstacle.y - config.obstacleHeight / 2,
      width: config.obstacleWidth * scale, height: config.obstacleHeight * scale };
  }

  // Project all four real ground-box corners; the sprite stands on its near edge.
  // This stays independent of the upright artwork's pose and height.
  function rectanglePath(bounds, lift = 0, heightScale = 1) {
    const center = project(bounds.x, bounds.y);
    const bottom = project(bounds.x, bounds.y + bounds.height / 2);
    const corners = [
      [bounds.x - bounds.width / 2, bounds.y - bounds.height / 2],
      [bounds.x + bounds.width / 2, bounds.y - bounds.height / 2],
      [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2],
      [bounds.x - bounds.width / 2, bounds.y + bounds.height / 2],
    ].map(([x, y]) => project(x, y));
    ctx.beginPath();
    corners.forEach((point, index) => {
      const y = bottom.y - (bottom.y - point.y) * heightScale - lift * center.scale;
      if (index === 0) ctx.moveTo(point.x, y);
      else ctx.lineTo(point.x, y);
    });
    ctx.closePath();
  }

  // Stateless surface noise: never consume the gameplay RNG or store road state.
  function roadNoise(row, detail) {
    let value = Math.imul(row ^ config.seed, 374761393) ^ Math.imul(detail, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
  }

  function drawRoadTexture() {
    const travel = elapsed * config.startSpeed;
    const spacing = config.dashGap;
    const firstRow = Math.floor((config.spawnY - spacing - travel) / spacing);
    const lastRow = Math.ceil((config.worldHeight - travel) / spacing);
    const roadWidth = config.roadRight - config.roadLeft;
    ctx.save();
    for (let row = firstRow; row <= lastRow; row++) {
      const y = row * spacing + travel;
      // Fine aggregate, anchored to world coordinates and subdued beneath markings.
      for (let grain = 0; grain < 18; grain++) {
        const x = config.roadLeft + roadNoise(row, grain * 3) * roadWidth;
        const grainY = y + roadNoise(row, grain * 3 + 1) * spacing;
        const start = project(x, grainY);
        const end = project(x + 0.7, grainY + 1.5);
        ctx.globalAlpha = 0.07 + roadNoise(row, grain * 3 + 2) * 0.08;
        ctx.strokeStyle = grain % 3 ? config.colors.lane : config.colors.uniform;
        ctx.lineWidth = Math.max(0.4, start.roadScale * 0.5);
        ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
      }
      if (row % 7 === 0) {
        const x = config.roadLeft + roadNoise(row, 71) * roadWidth;
        ctx.globalAlpha = 0.32;
        ctx.fillStyle = config.colors.uniform;
        const patch = [project(x, y), project(x + 29, y + 3),
          project(x + 34, y + 21), project(x - 4, y + 18)];
        facePath(ctx, patch); ctx.fill();
      }
      if (row % 5 === 0) {
        const x = config.roadLeft + roadNoise(row, 79) * roadWidth;
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = config.colors.uniform;
        ctx.lineWidth = Math.max(0.6, project(x, y).roadScale * 0.6);
        ctx.beginPath();
        for (let segment = 0; segment < 5; segment++) {
          const point = project(x + (roadNoise(row, 80 + segment) - 0.5) * 15,
            y + segment * 5);
          if (segment === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawRoad() {
    ctx.fillStyle = config.colors.sky;
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    const bottomLeft = project(config.roadLeft);
    const bottomRight = project(config.roadRight);
    const sidewalkWidth = laneWidth / 10;
    ctx.fillStyle = config.colors.pavement;
    for (const [edge, outside] of [
      [config.roadLeft, config.roadLeft - sidewalkWidth],
      [config.roadRight, config.roadRight + sidewalkWidth],
    ]) {
      const inner = project(edge);
      const outer = project(outside);
      ctx.beginPath();
      ctx.moveTo(viewport.width / 2, bottomLeft.horizonY);
      ctx.lineTo(inner.x, inner.y);
      ctx.lineTo(outer.x, outer.y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = config.colors.road;
    ctx.beginPath();
    ctx.moveTo(viewport.width / 2, bottomLeft.horizonY);
    ctx.lineTo(bottomRight.x, bottomRight.y);
    ctx.lineTo(bottomLeft.x, bottomLeft.y);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.clip(); // Surface details remain inside the straight road edges.
    drawRoadTexture();
    ctx.restore();
    ctx.strokeStyle = config.colors.lane;
    // Dashes travel in world space at the unchanged world speed.
    const period = config.dashLength + config.dashGap;
    const offset = elapsed * config.startSpeed % period;
    for (let lane = 1; lane < config.laneCount; lane++) {
      const x = config.roadLeft + lane * laneWidth;
      const distant = project(x, config.spawnY - period);
      ctx.lineWidth = config.laneLineWidth * distant.scale;
      ctx.beginPath();
      ctx.moveTo(viewport.width / 2, bottomLeft.horizonY);
      ctx.lineTo(distant.x, distant.y);
      ctx.stroke();
      for (let y = config.spawnY - period + offset; y < config.worldHeight; y += period) {
        const start = project(x, y);
        const end = project(x, y + config.dashLength);
        ctx.lineWidth = config.laneLineWidth * start.scale;
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      }
    }
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Observe simulation state only; none of these positions feed back into collisions.
  const characterMotion = {
    lane: player.lane, fromX: laneX(player.lane), toX: laneX(player.lane),
    stepAt: -Infinity, recoilAt: -Infinity, lastElapsed: elapsed, lastCrashes: crashes,
    impactObstacle: null,
  };

  // A struck sign holds at contact and clears before the runner returns.
  // Weak keys leave the simulation's obstacle lifecycle completely untouched.
  let struckSignVisuals = new WeakMap();

  function signImpactVisual(obstacle) {
    const impact = struckSignVisuals.get(obstacle);
    if (!impact) return null;
    const age = elapsed - impact.at;
    const fade = Math.max(0, Math.min(1,
      (age - config.visualMotion.signImpactHoldSeconds) / config.visualMotion.signImpactFadeSeconds));
    return { y: impact.y, opacity: 1 - motionEase(fade) };
  }

  // ease-out: cubic-bezier(0.23, 1, 0.32, 1), inverted on its time axis.
  function motionEase(progress) {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    let low = 0, high = 1;
    for (let i = 0; i < 16; i++) {
      const t = (low + high) / 2;
      const x = 3 * (1 - t) ** 2 * t * 0.23 + 3 * (1 - t) * t * t * 0.32 + t ** 3;
      if (x < progress) low = t;
      else high = t;
    }
    return 1 - (1 - (low + high) / 2) ** 3;
  }

  function characterPose() {
    const progress = Math.min(1, Math.max(0,
      (elapsed - characterMotion.stepAt) / config.visualMotion.laneStepSeconds));
    const x = characterMotion.fromX + (characterMotion.toX - characterMotion.fromX) * motionEase(progress);
    const signImpact = characterMotion.impactObstacle?.definition.type === 'sign';
    const recoilAge = elapsed - characterMotion.recoilAt;
    const recoilDuration = signImpact ? config.visualMotion.signRecoilSeconds : config.visualMotion.recoilSeconds;
    const recoilProgress = recoilAge / recoilDuration;
    let recoil = 0;
    if (recoilProgress >= 0 && recoilProgress < 1) {
      // Hold the backward displacement until the struck sign has visibly cleared.
      const clearAt = config.visualMotion.signImpactHoldSeconds + config.visualMotion.signImpactFadeSeconds;
      recoil = signImpact ? (recoilProgress < 0.1 ? motionEase(recoilProgress / 0.1)
        : recoilAge < clearAt ? 1 : 1 - motionEase((recoilAge - clearAt) / (recoilDuration - clearAt)))
        : Math.sin(Math.PI * recoilProgress);
    }
    return {
      x: reducedMotion.matches ? characterMotion.toX : x,
      lean: reducedMotion.matches ? 0 : Math.sign(characterMotion.toX - characterMotion.fromX) *
        Math.sin(Math.PI * progress) * 0.09,
      step: reducedMotion.matches ? 0 : Math.sin(Math.PI * progress),
      recoil: recoil * (reducedMotion.matches ? 0.2 : 1),
      recoilDistance: signImpact ? config.visualMotion.signRecoilDistance : config.visualMotion.recoilDistance,
      crouch: player.action === 'crouch',
    };
  }

  function observeCharacterMotion() {
    if (elapsed < characterMotion.lastElapsed || crashes < characterMotion.lastCrashes) {
      characterMotion.lane = player.lane;
      characterMotion.fromX = characterMotion.toX = laneX(player.lane);
      characterMotion.stepAt = characterMotion.recoilAt = -Infinity;
      characterMotion.impactObstacle = null;
      struckSignVisuals = new WeakMap();
    }
    if (player.lane !== characterMotion.lane) {
      // Retarget from the currently drawn position, including rapid reversals.
      characterMotion.fromX = characterPose().x;
      characterMotion.toX = laneX(player.lane);
      characterMotion.stepAt = elapsed;
      characterMotion.lane = player.lane;
    }
    if (crashes > characterMotion.lastCrashes) {
      characterMotion.recoilAt = elapsed;
      characterMotion.impactObstacle = obstacles.filter(obstacle => obstacle.crashed && !struckSignVisuals.has(obstacle))
        .reduce((nearest, obstacle) => !nearest ||
          Math.abs(obstacle.y - overlapCenterY) < Math.abs(nearest.y - overlapCenterY)
          ? obstacle : nearest, null);
      if (characterMotion.impactObstacle?.definition.type === 'sign') {
        struckSignVisuals.set(characterMotion.impactObstacle,
          { at: elapsed, y: characterMotion.impactObstacle.y });
      }
    }
    characterMotion.lastCrashes = crashes;
    characterMotion.lastElapsed = elapsed;
  }

  function runningPose(inspector = false) {
    const running = !caught && !finished && (inspector ||
      (player.action === 'run' && characterPose().recoil < 0.15));
    const phase = elapsed * config.startSpeed / config.playerSize * Math.PI *
      (inspector ? 0.86 : 1) + (inspector ? Math.PI : 0);
    const strength = running ? (reducedMotion.matches ? 0.15 : 1) : 0;
    return { phase, strength,
      bob: (1 - Math.cos(phase * 2)) * (inspector ? 0.8 : 0.55) * strength,
      sway: Math.sin(phase) * (inspector ? 0.7 : 1.1) * strength };
  }

  // All volume vertices use the same projection as the H ground footprints.
  function volumePoint(bounds, u, v, height) {
    const point = project(bounds.x + (u - 0.5) * bounds.width,
      bounds.y + (v - 0.5) * bounds.height);
    return { x: point.x, y: point.y - height * point.scale };
  }

  function facePath(context, points) {
    context.beginPath();
    points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.closePath();
  }

  // Shade with existing palette colors; no extra color or gameplay settings.
  function drawFace(points, color, light = 0, glow = color) {
    ctx.save();
    const opacity = ctx.globalAlpha;
    facePath(ctx, points);
    ctx.fillStyle = color;
    ctx.fill();
    if (light) {
      ctx.globalAlpha = opacity * Math.abs(light);
      ctx.fillStyle = light > 0 ? config.colors.signText : config.colors.uniform;
      ctx.fill();
      ctx.globalAlpha = opacity;
    }
    if (glow) {
      ctx.strokeStyle = glow;
      ctx.lineWidth = Math.max(0.7, viewport.height / config.worldHeight);
      ctx.shadowColor = glow;
      ctx.shadowBlur = 4 * viewport.pixelRatio;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawGroundShadow(bounds) {
    ctx.save();
    ctx.fillStyle = config.colors.playerShadow;
    ctx.shadowColor = config.colors.playerShadow;
    ctx.shadowBlur = 10 * viewport.pixelRatio;
    rectanglePath(bounds);
    ctx.fill();
    ctx.restore();
  }

  // The front texture is attached to the near face, never a free screen offset.
  function paintFront(bounds, bottom, top, paint, profile) {
    const left = volumePoint(bounds, 0, 1, top);
    const right = volumePoint(bounds, 1, 1, top);
    const foot = volumePoint(bounds, 0, 1, bottom);
    ctx.save();
    if (profile) {
      facePath(ctx, profile.map(([u, z]) => volumePoint(bounds, u, 1, z)));
      ctx.clip();
    }
    ctx.translate(left.x, left.y);
    ctx.scale((right.x - left.x) / 100, (foot.y - left.y) / 100);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    paint(ctx);
    ctx.restore();
  }

  // Extrude an x/height silhouette through its exact world ground footprint.
  // Horizontal upper edges become light top faces; vertical edges become dark sides.
  function drawProfile(bounds, profile, color, paint, glow = color) {
    const front = profile.map(([u, z]) => volumePoint(bounds, u, 1, z));
    const back = profile.map(([u, z]) => volumePoint(bounds, u, 0, z));
    for (let i = 0; i < profile.length; i++) {
      const next = (i + 1) % profile.length;
      const top = profile[next][0] < profile[i][0] && profile[i][1] + profile[next][1] > 0;
      drawFace([back[i], back[next], front[next], front[i]], color, top ? 0.3 : -0.55, glow);
    }
    drawFace(front, color, 0, glow);
    if (paint) {
      const heights = profile.map(([, z]) => z);
      paintFront(bounds, Math.min(...heights), Math.max(...heights), paint, profile);
    }
  }

  function drawVolume(bounds, bottom, top, color, paint, glow = color) {
    drawProfile(bounds, [[0, bottom], [1, bottom], [1, top], [0, top]], color, paint, glow);
  }

  // Fit human proportions in screen space without changing the ground footprint.
  function drawArtwork(bounds, paint, lift = 0, heightScale = 1, gait = runningPose()) {
    const front = project(bounds.x, bounds.y + bounds.height / 2);
    const height = (bounds.artHeight || bounds.height) * heightScale * 0.88;
    const accent = bounds.accent || config.colors.player;
    const desiredWidth = height * front.scale * 0.55 / front.roadScale;
    const figure = { ...bounds, width: Math.min(desiredWidth, bounds.width * 2.6) };
    const aspect = figure.width * front.roadScale / (height * front.scale);
    drawGroundShadow(bounds);
    // Human bodies are shallow; keep their front anchored to the original feet.
    const body = { ...figure, height: bounds.height * 0.14,
      x: figure.x + gait.sway * figure.width / 100,
      y: bounds.y + bounds.height * 0.43 };
    const bodyLift = lift - height * (gait.bob / 100 + (bounds.crouch ? 0.22 : 0));
    drawProfile({ ...body, width: figure.width * 0.56 },
      [[0, bodyLift + height * 0.42], [1, bodyLift + height * 0.42],
        [1, bodyLift + height * 0.69], [0.83, bodyLift + height * 0.75],
        [0.17, bodyLift + height * 0.75], [0, bodyLift + height * 0.69]], accent);
    const head = { ...body, width: height * 0.15 * front.scale / front.roadScale };
    drawProfile(head, Array.from({ length: 16 }, (_, i) => {
      const angle = i * Math.PI / 8;
      return [0.5 + Math.cos(angle) / 2, bodyLift + height * (0.895 + Math.sin(angle) * 0.075)];
    }), config.colors.uniform, null, false);
    paintFront(figure, lift, lift + height, context => paint(context, aspect));
  }

  function neon(context, color, blur = 6) {
    context.strokeStyle = color;
    context.shadowColor = color;
    context.shadowBlur = blur;
  }

  function strokeLine(context, points, color, width) {
    context.strokeStyle = color;
    context.lineWidth = width;
    context.beginPath();
    points.forEach(([x, y], i) => {
      if (i === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  }

  function disc(context, x, y, radius, color) {
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  function drawSign(bounds) {
    const postWidth = config.laneLineWidth * 1.5;
    for (const side of [-1, 1]) {
      drawVolume({ ...bounds, x: bounds.x + side * (bounds.width - postWidth) / 2,
        width: postWidth }, 0, config.signPostHeight, config.colors.postBlack,
      null, false);
    }
    drawVolume(bounds, config.signPostHeight, config.signPostHeight + config.obstacleHeight,
      config.colors.sign, context => {
        neon(context, config.colors.signText);
        context.lineWidth = 2;
        context.strokeRect(3, 3, 94, 94);
        context.fillStyle = config.colors.signText;
        context.font = '900 84px system-ui';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText('U', 50, 52);
        context.shadowBlur = 0;
        const opacity = context.globalAlpha;
        context.globalAlpha = opacity * 0.24;
        context.fillStyle = config.colors.signText;
        context.fillRect(4, 4, 92, 5);
        context.fillStyle = config.colors.uniform;
        context.fillRect(90, 9, 6, 87);
        context.fillRect(4, 90, 86, 6);
        context.globalAlpha = opacity;
      });
  }

  function drawGroundBeam(bounds, start, end, thickness, bottom, top) {
    const dx = (end[0] - start[0]) * bounds.width;
    const dy = (end[1] - start[1]) * bounds.height;
    const length = Math.hypot(dx, dy);
    const u = -dy / length * thickness / (2 * bounds.width);
    const v = dx / length * thickness / (2 * bounds.height);
    const corners = [[start[0] + u, start[1] + v], [end[0] + u, end[1] + v],
      [end[0] - u, end[1] - v], [start[0] - u, start[1] - v]];
    const roof = corners.map(([x, y]) => volumePoint(bounds, x, y, top));
    const base = corners.map(([x, y]) => volumePoint(bounds, x, y, bottom));
    for (let i = 0; i < 4; i++) {
      const next = (i + 1) % 4;
      drawFace([base[i], base[next], roof[next], roof[i]], config.colors.signText,
        -0.4, config.colors.scooter);
    }
    drawFace(roof, config.colors.signText, 0.15, config.colors.scooter);
  }

  function drawScooter(bounds) {
    // Wheelbase crosses the road; the tipped stem points along the road.
    const wheelSize = bounds.width * 0.14;
    for (const u of [0.1, 0.9]) {
      const wheel = { ...bounds, x: bounds.x + (u - 0.5) * bounds.width,
        width: wheelSize, height: bounds.height * 0.14,
        y: bounds.y + bounds.height * 0.4 };
      drawProfile(wheel, Array.from({ length: 16 }, (_, i) => {
        const angle = i * Math.PI / 8;
        return [0.5 + Math.cos(angle) / 2, wheelSize * (0.5 + Math.sin(angle) / 2)];
      }), config.colors.uniform, context => {
        disc(context, 50, 50, 24, config.colors.signText);
        disc(context, 50, 50, 10, config.colors.scooter);
      }, config.colors.scooter);
    }
    const deck = { ...bounds, width: bounds.width * 0.8,
      x: bounds.x,
      height: bounds.height * 0.18, y: bounds.y + bounds.height * 0.35 };
    drawVolume(deck, wheelSize * 0.35, wheelSize * 0.7, config.colors.signText,
      context => strokeLine(context, [[10, 30], [90, 30]], config.colors.scooter, 14),
      config.colors.scooter);
    const thickness = config.laneLineWidth * 1.6;
    drawGroundBeam(bounds, [0.9, 0.9], [0.9, 0.065], thickness,
      thickness * 0.5, thickness * 1.5);
    drawGroundBeam(bounds, [0.72, 0.065], [0.97, 0.065], thickness,
      thickness * 0.5, thickness * 1.5);
  }

  function drawStorefront(context, label, glow) {
    context.fillStyle = config.colors.uniform;
    context.fillRect(0, 0, 100, 100);
    neon(context, glow);
    context.lineWidth = 2;
    context.strokeRect(1, 1, 98, 98);
    context.fillStyle = glow;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `800 ${label === 'SPÄTI' ? 21 : 13}px system-ui`;
    context.fillText(label, 50, 17);
    context.shadowBlur = 0;
    context.fillStyle = config.colors.road;
    context.fillRect(7, 34, 49, 59);
    context.fillRect(65, 34, 28, 65);
    context.globalAlpha = 0.32;
    context.fillStyle = glow;
    context.fillRect(7, 34, 49, 59);
    context.globalAlpha = 1;
    context.strokeStyle = glow;
    context.lineWidth = 1;
    context.strokeRect(7, 34, 49, 59);
    context.strokeRect(65, 34, 28, 65);
    strokeLine(context, [[12, 39], [29, 39]], config.colors.signText, 2);
    strokeLine(context, [[46, 38], [22, 85]], glow, 1);
    for (let row = 0; row < 3; row++) {
      strokeLine(context, [[11, 53 + row * 15], [52, 53 + row * 15]], glow, 1);
      for (let column = 0; column < 5; column++) {
        context.fillStyle = row % 2 ? config.colors.bottle : glow;
        context.fillRect(13 + column * 8, 42 + row * 15, 4, 9);
      }
    }
    context.fillStyle = glow;
    context.fillRect(87, 65, 2, 9);
    // Striped awning keeps the storefront recognizable without extra silhouette.
    for (let i = 0; i < 10; i++) {
      context.fillStyle = i % 2 ? config.colors.uniform : glow;
      context.fillRect(i * 10, 27, 10, 6);
    }
  }

  function drawObstacle(obstacle) {
    const impact = signImpactVisual(obstacle);
    if (impact?.opacity === 0) return;
    const renderY = impact ? impact.y : obstacle.y;
    const bounds = obstacle.definition.type === 'spaeti'
      ? { x: laneX(obstacle.lane), y: renderY - config.spaetiHeight / 2,
        width: config.obstacleWidth, height: config.spaetiHeight }
      : obstacleDrawBounds({ ...obstacle, y: renderY });
    ctx.save();
    if (impact) ctx.globalAlpha *= impact.opacity;
    drawGroundShadow(bounds);
    if (obstacle.definition.type === 'sign') drawSign(bounds);
    else if (obstacle.definition.type === 'scooter') drawScooter(bounds);
    else drawVolume(bounds, 0, config.spaetiHeight, config.colors.spaetiShop,
      context => drawStorefront(context, 'SPÄTI', config.colors.neonMagenta), config.colors.neonMagenta);
    ctx.restore();
  }

  function drawBottle(bottle) {
    const bounds = { x: laneX(bottle.lane), y: bottle.y - config.bottleSize / 2,
      width: config.bottleSize, height: config.bottleSize };
    const height = config.bottleSize;
    drawGroundShadow(bounds);
    const profile = [[0, 0], [1, 0], [1, height * 0.58], [0.7, height * 0.77],
      [0.7, height], [0.3, height], [0.3, height * 0.77], [0, height * 0.58]];
    drawProfile(bounds, profile, config.colors.bottle, context => {
      context.globalAlpha = 0.35;
      context.fillStyle = config.colors.uniform;
      context.fillRect(65, 0, 35, 100);
      context.globalAlpha = 1;
      context.fillStyle = config.colors.uniform;
      context.fillRect(0, 58, 100, 22);
      context.fillStyle = config.colors.signText;
      context.font = '800 18px system-ui';
      context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillText('↻', 50, 69);
      neon(context, config.colors.signText, 3);
      strokeLine(context, [[35, 12], [35, 24], [18, 43], [18, 52]], config.colors.signText, 5);
      strokeLine(context, [[18, 85], [18, 93]], config.colors.signText, 4);
    });
    drawVolume({ ...bounds, width: bounds.width * 0.44 }, height * 0.94, height,
      config.colors.uniform, null, config.colors.bottle);
  }

  function drawPerson(context, inspector = false, aspect = 0.55, pose = {}) {
    const gait = runningPose(inspector);
    const accent = inspector ? config.colors.kontrolleurBlue : config.colors.player;
    const trim = inspector ? config.colors.kontrolleurYellow : accent;
    const sleeves = accent;
    neon(context, accent, 2);
    const foot = offset => {
      const phase = ((gait.phase / (Math.PI * 2) + offset) % 1 + 1) % 1;
      const planted = phase < 0.58;
      const recovery = planted ? 0 : (phase - 0.58) / 0.42;
      const lift = Math.sin(Math.PI * recovery) * 14 * gait.strength;
      const travel = planted ? phase / 0.58 : 1 - motionEase(recovery);
      return { y: 94 + (travel * 10 - 6) * gait.strength - lift, lift,
        swing: Math.sin(phase * Math.PI * 2) * gait.strength };
    };
    // Each foot spends longer planted than recovering; the knee folds on recovery.
    for (const [side, offset] of [[-1, 0], [1, 0.5]]) {
      const leg = foot(offset);
      const hipX = 50 + side * 10;
      const ankleX = hipX + leg.swing * 3 + (pose.step || 0) * side * 6;
      const ankleY = pose.crouch ? 96 : leg.y;
      const hipY = pose.crouch ? 81 : 59;
      // Two fixed-length leg segments fold outward as the pelvis lowers.
      const knee = pose.crouch
        ? [hipX + side * Math.sqrt(18 ** 2 - ((ankleY - hipY) / 2) ** 2) / aspect,
          (hipY + ankleY) / 2]
        : [hipX + side * 2 + leg.swing * 2, Math.min(ankleY - 7, 77 - leg.lift * 0.5)];
      strokeLine(context, [[hipX, hipY], knee, [ankleX, ankleY]],
        inspector ? accent : config.colors.uniform, 12);
      strokeLine(context, [[ankleX - 5, ankleY + 1], [ankleX + 5, ankleY]], trim, 6);
      if (inspector) strokeLine(context, [[hipX + side * 3, 64], [knee[0], knee[1] - 5]], trim, 3);
      const armDrive = -leg.swing;
      const shoulder = [50 + side * 25, pose.crouch ? 51 : 29];
      const elbow = [50 + side * (30 - armDrive * 3), (pose.crouch ? 65 : 43) - armDrive * 3];
      const hand = [50 + side * (22 - armDrive * 5),
        (pose.crouch ? 76 : 54) + armDrive * 6 - (pose.recoil || 0) * 11];
      strokeLine(context, [shoulder, elbow, hand], sleeves, 11);
      if (inspector) strokeLine(context, [shoulder,
        [(shoulder[0] + elbow[0]) / 2, (shoulder[1] + elbow[1]) / 2]], trim, 11);
    }
    // Weight transfer affects the torso and head, leaving the planted foot grounded.
    context.save();
    context.translate(gait.sway, gait.bob + (pose.crouch ? 22 : 0));
    if (pose.crouch) context.transform(1, 0, -0.12, 1, 58 * 0.12, 0);
    context.fillStyle = sleeves;
    context.beginPath();
    context.moveTo(38, 24);
    context.quadraticCurveTo(27, 24, 22, 30);
    context.lineTo(33, 58); context.quadraticCurveTo(50, 63, 67, 58);
    context.lineTo(78, 30); context.quadraticCurveTo(73, 24, 62, 24);
    context.closePath(); context.fill();
    context.strokeStyle = accent; context.lineWidth = 1.5; context.stroke();
    context.shadowBlur = 0;
    // Compensate for the artwork transform so heads remain round on tall windows.
    const headRadiusX = 7.5 / aspect;
    context.fillStyle = config.colors.player;
    context.fillRect(44, 18, 12, 7);
    context.fillStyle = config.colors.uniform;
    context.beginPath();
    context.ellipse(50, 10.5, headRadiusX, 7.5, 0, 0, Math.PI * 2);
    context.fill();
    if (inspector) {
      context.fillStyle = accent;
      context.fillRect(50 - headRadiusX * 1.05, 4, headRadiusX * 2.1, 6);
      strokeLine(context, [[50 - headRadiusX, 10], [50 + headRadiusX, 10]], trim, 2);
      // Broad yellow yoke, sleeve panels, and bands: about 30% of the outfit.
      context.fillStyle = trim;
      context.beginPath();
      context.moveTo(25, 27); context.lineTo(75, 27);
      context.lineTo(71, 38); context.lineTo(29, 38);
      context.closePath(); context.fill();
      context.fillRect(35, 54, 30, 3);
    } else {
      context.fillStyle = config.colors.uniform;
      context.fillRect(37, 31, 26, 22);
      strokeLine(context, [[40, 34], [60, 34]], config.colors.signText, 2);
      strokeLine(context, [[34, 56], [66, 56]], config.colors.signText, 2);
    }
    context.restore();
  }

  function drawPlayer() {
    const pose = characterPose();
    const groundBounds = playerDrawBounds();
    const bounds = { ...groundBounds, x: pose.x,
      y: groundBounds.y + pose.recoil * pose.recoilDistance };
    const jumpProgress = player.action === 'jump'
      ? 1 - player.actionRemaining / config.jumpDuration : 0;
    const lift = Math.sin(jumpProgress * Math.PI) * config.jumpHeight;
    const anchor = project(bounds.x, bounds.y + bounds.height / 2);
    ctx.save();
    // Grounded sidestep: lean around the feet, with no added jump or vertical arc.
    ctx.translate(anchor.x, anchor.y);
    ctx.transform(1 + pose.recoil * 0.03, 0, -pose.lean, 1 - pose.recoil * 0.18, 0, 0);
    ctx.translate(-anchor.x, -anchor.y);
    drawArtwork({ ...bounds, artHeight: config.playerSize, crouch: pose.crouch },
      (context, aspect) => drawPerson(context, false, aspect, pose), lift);
    ctx.restore();
  }

  function drawKontrolleur() {
    drawArtwork({ x: characterPose().x,
      y: config.playerY + kontrolleurDistance() - config.kontrolleurSize / 2,
      width: config.kontrolleurSize, height: config.kontrolleurSize,
      accent: config.colors.kontrolleurBlue }, (context, aspect) => drawPerson(context, true, aspect),
    0, 1, runningPose(true));
  }

  function drawImpactContact() {
    const impact = characterMotion.impactObstacle;
    const pose = characterPose();
    if (!impact || impact.definition.type !== 'sign' || pose.recoil <= 0) return;
    const visual = signImpactVisual(impact);
    if (!visual || visual.opacity === 0) return;
    const bounds = obstacleDrawBounds({ ...impact, y: visual.y });
    const point = volumePoint(bounds, 0.5, 1, config.signPostHeight);
    const radius = Math.max(5, config.playerSize * project(bounds.x, bounds.y).scale * 0.17);
    ctx.save();
    ctx.globalAlpha = pose.recoil * visual.opacity;
    neon(ctx, config.colors.signText, 9 * viewport.pixelRatio);
    ctx.lineWidth = Math.max(1.5, viewport.height / config.worldHeight);
    ctx.beginPath();
    ctx.ellipse(point.x, point.y, radius, radius * 0.65, 0, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3;
      strokeLine(ctx, [[point.x + Math.cos(angle) * radius * 1.3,
        point.y + Math.sin(angle) * radius * 0.9],
      [point.x + Math.cos(angle) * radius * 1.8,
        point.y + Math.sin(angle) * radius * 1.3]], config.colors.signText, ctx.lineWidth);
    }
    ctx.restore();
  }

  function drawDoenerladen() {
    // The result overlay covers the road; paint the destination in that overlay.
    const destination = document.querySelector('#doenerladen');
    const context = destination.getContext('2d');
    context.save();
    context.clearRect(0, 0, destination.width, destination.height);
    context.translate(12, 10);
    context.scale((destination.width - 24) / 100, (destination.height - 20) / 100);
    drawStorefront(context, 'DÖNERLADEN', config.colors.neonAmber);
    // A warm rotisserie silhouette in the shop window.
    context.shadowColor = config.colors.neonAmber; context.shadowBlur = 8;
    strokeLine(context, [[32, 37], [32, 89]], config.colors.signText, 1);
    context.fillStyle = config.colors.neonAmber;
    context.beginPath();
    context.moveTo(19, 43); context.lineTo(45, 43);
    context.lineTo(38, 77); context.lineTo(26, 77);
    context.closePath(); context.fill();
    context.restore();
  }

  function draw() {
    // Moving between displays can change DPR without changing the window size.
    if (viewport.pixelRatio !== (window.devicePixelRatio || 1)) resizeCanvas();
    ctx.setTransform(viewport.pixelRatio, 0, 0, viewport.pixelRatio, 0, 0);
    observeCharacterMotion();
    drawRoad();
    // Paint far to near without sorting or modifying simulation arrays.
    const pose = characterPose();
    const playerDepth = config.playerY - config.playerSize / 2 + pose.recoil * pose.recoilDistance;
    const scene = [
      ...obstacles.map(obstacle => {
        const impact = signImpactVisual(obstacle);
        // Once struck, a sign cannot switch from behind the runner to in front.
        return { y: impact ? Math.min(impact.y - config.obstacleHeight / 2, playerDepth - 1)
          : obstacle.y - config.obstacleHeight / 2, draw: () => drawObstacle(obstacle) };
      }),
      ...bottles.map(bottle => ({ y: bottle.y - config.bottleSize / 2,
        draw: () => drawBottle(bottle) })),
      { y: playerDepth, draw: drawPlayer },
    ];
    if (firstCrashAt !== null) scene.push({ y: config.playerY + kontrolleurDistance(), draw: drawKontrolleur });
    scene.sort((a, b) => a.y - b.y);
    for (const item of scene) item.draw();
    drawImpactContact();
    if (flashRemaining > 0) {
      ctx.fillStyle = config.colors.flash;
      ctx.fillRect(0, 0, viewport.width, viewport.height);
    }
    if (debugHitboxes) drawHitboxes();
    if (finished) drawDoenerladen();
  }

  function drawHitboxes() {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = config.colors.debugPlayer;
    // Ground footprint stays fixed during jump and crouch, exactly as in logic.
    rectanglePath(playerDrawBounds());
    ctx.stroke();
    let overlapping = false;
    for (const obstacle of obstacles) {
      if (obstacle.definition.type === 'spaeti') continue;
      const { overlapStartY, overlapEndY } = overlapBounds(obstacle);
      const overlap = obstacle.lane === player.lane &&
        obstacle.y > overlapStartY && obstacle.y < overlapEndY;
      overlapping ||= overlap;
      ctx.strokeStyle = overlap ? config.colors.debugOverlap : config.colors.debugObstacle;
      rectanglePath(obstacleDrawBounds(obstacle));
      ctx.stroke();
    }
    ctx.fillStyle = config.colors.debugBackground;
    ctx.fillRect(viewport.width - 120, viewport.height * 0.4 - 24, 112, 24);
    ctx.fillStyle = config.colors.debugText;
    ctx.font = '12px system-ui';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Overlap: ${overlapping ? 'yes' : 'no'}`, viewport.width - 114, viewport.height * 0.4 - 12);
    ctx.restore();
  }

  function frame(time) {
    if (!document.hidden) {
      const dt = previousTime === null ? 0 : Math.min((time - previousTime) / 1000, config.maxFrameSeconds);
      update(dt);
      draw();
      previousTime = time;
    }
    requestAnimationFrame(frame);
  }
  updateCountdown();
  requestAnimationFrame(frame);
})();

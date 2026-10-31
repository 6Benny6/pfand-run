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
  canvas.width = config.worldWidth;
  canvas.height = config.worldHeight;

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

  // Rendering only: one reciprocal depth for road, objects, and hitboxes.
  function project(x, y) {
    const { horizonY, playerScreenY } = config.camera;
    const screenDepth = canvas.height - horizonY;
    const playerDepth = playerScreenY - horizonY;
    // Map the player's row as before and the world bottom to the canvas bottom.
    const cameraDepth = (config.worldHeight - config.playerY) * screenDepth /
      (canvas.height - playerScreenY);
    const playerScale = canvas.width * 0.8 / (config.roadRight - config.roadLeft) *
      playerDepth / screenDepth;
    const depth = cameraDepth + config.playerY - y;
    const scale = playerScale * cameraDepth / depth;
    return {
      x: canvas.width / 2 + (x - config.worldWidth / 2) * scale,
      y: horizonY + playerDepth * scale / playerScale,
      scale,
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

  // Project both longitudinal edges so visual contact matches ground overlap.
  // Filled primitives and the H overlay deliberately share this exact path.
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

  function drawRoad() {
    ctx.fillStyle = config.colors.sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const bottomLeft = project(config.roadLeft, config.worldHeight);
    const bottomRight = project(config.roadRight, config.worldHeight);
    const sidewalkWidth = laneWidth / 10;
    ctx.fillStyle = config.colors.pavement;
    for (const [edge, outside] of [
      [config.roadLeft, config.roadLeft - sidewalkWidth],
      [config.roadRight, config.roadRight + sidewalkWidth],
    ]) {
      const inner = project(edge, config.worldHeight);
      const outer = project(outside, config.worldHeight);
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2, config.camera.horizonY);
      ctx.lineTo(inner.x, inner.y);
      ctx.lineTo(outer.x, outer.y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = config.colors.road;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, config.camera.horizonY);
    ctx.lineTo(bottomRight.x, bottomRight.y);
    ctx.lineTo(bottomLeft.x, bottomLeft.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = config.colors.lane;
    // Dashes travel in world space at the unchanged world speed.
    const period = config.dashLength + config.dashGap;
    const offset = elapsed * config.startSpeed % period;
    for (let lane = 1; lane < config.laneCount; lane++) {
      const x = config.roadLeft + lane * laneWidth;
      const distant = project(x, config.spawnY - period);
      ctx.lineWidth = config.laneLineWidth * distant.scale;
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2, config.camera.horizonY);
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

  function drawObstacle(obstacle) {
    ctx.fillStyle = config.colors[obstacle.definition.type];
    const bounds = obstacle.definition.type === 'spaeti'
      ? { x: laneX(obstacle.lane), y: obstacle.y - config.spaetiHeight / 2,
        width: config.obstacleWidth, height: config.spaetiHeight }
      : obstacleDrawBounds(obstacle);
    rectanglePath(bounds);
    ctx.fill();
  }

  function drawBottle(bottle) {
    const point = project(laneX(bottle.lane), bottle.y - config.bottleSize / 2);
    ctx.fillStyle = config.colors.bottle;
    ctx.beginPath();
    ctx.arc(point.x, point.y, config.bottleSize * point.scale / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPlayer() {
    const ground = project(laneX(player.lane), config.playerY);
    ctx.fillStyle = config.colors.playerShadow;
    ctx.beginPath();
    ctx.ellipse(ground.x, ground.y, config.shadowWidth * ground.scale,
      config.shadowHeight * ground.scale, 0, 0, Math.PI * 2);
    ctx.fill();
    const jumpProgress = player.action === 'jump'
      ? 1 - player.actionRemaining / config.jumpDuration : 0;
    const lift = Math.sin(jumpProgress * Math.PI) * config.jumpHeight;
    ctx.fillStyle = config.colors.player;
    rectanglePath(playerDrawBounds(), lift, player.action === 'crouch' ? config.crouchScale : 1);
    ctx.fill();
  }

  function drawKontrolleur() {
    ctx.fillStyle = config.colors.kontrolleur;
    rectanglePath({ x: laneX(player.lane),
      y: config.playerY + kontrolleurDistance() - config.kontrolleurSize / 2,
      width: config.kontrolleurSize, height: config.kontrolleurSize });
    ctx.fill();
  }

  function draw() {
    drawRoad();
    // Paint far to near without sorting or modifying simulation arrays.
    const scene = [
      ...obstacles.map(obstacle => ({ y: obstacle.y - config.obstacleHeight / 2,
        draw: () => drawObstacle(obstacle) })),
      ...bottles.map(bottle => ({ y: bottle.y - config.bottleSize / 2,
        draw: () => drawBottle(bottle) })),
      { y: config.playerY - config.playerSize / 2, draw: drawPlayer },
    ];
    if (firstCrashAt !== null) scene.push({ y: config.playerY + kontrolleurDistance(), draw: drawKontrolleur });
    scene.sort((a, b) => a.y - b.y);
    for (const item of scene) item.draw();
    if (flashRemaining > 0) {
      ctx.fillStyle = config.colors.flash;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (debugHitboxes) drawHitboxes();
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
    ctx.fillRect(8, 8, 112, 24);
    ctx.fillStyle = config.colors.debugText;
    ctx.font = '12px system-ui';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Overlap: ${overlapping ? 'yes' : 'no'}`, 14, 20);
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

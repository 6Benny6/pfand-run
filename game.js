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

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Artwork uses a 100 × 100 local frame, clipped to the projected world box.
  // Jump/crouch affect only artwork; the H overlay keeps its ground footprint.
  function drawArtwork(bounds, paint, lift = 0, heightScale = 1) {
    const center = project(bounds.x, bounds.y);
    const top = project(bounds.x, bounds.y - bounds.height / 2);
    const bottom = project(bounds.x, bounds.y + bounds.height / 2);
    const width = bounds.width * center.scale;
    const height = (bottom.y - top.y) * heightScale;
    ctx.save();
    ctx.shadowColor = config.colors.playerShadow;
    ctx.shadowBlur = 0;
    rectanglePath(bounds, lift, heightScale);
    ctx.clip();
    ctx.translate(center.x - width / 2, bottom.y - height - lift * center.scale);
    ctx.scale(width / 100, height / 100);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    paint(ctx);
    ctx.restore();
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

  function drawSign(context) {
    context.fillStyle = config.colors.sign;
    context.fillRect(1, 1, 98, 98);
    neon(context, config.colors.signText);
    context.lineWidth = 3;
    context.strokeRect(3, 3, 94, 94);
    context.fillStyle = config.colors.signText;
    context.font = '900 86px system-ui';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('U', 50, 51);
  }

  function drawScooter(context) {
    neon(context, config.colors.scooter);
    for (const x of [16, 84]) {
      disc(context, x, 78, 16, config.colors.uniform);
      context.lineWidth = 4;
      context.stroke();
      disc(context, x, 78, 5, config.colors.scooter);
    }
    strokeLine(context, [[16, 77], [35, 78], [72, 78], [79, 16]], config.colors.scooter, 9);
    strokeLine(context, [[67, 12], [93, 12]], config.colors.scooter, 8);
    strokeLine(context, [[32, 70], [65, 70]], config.colors.signText, 2);
    context.shadowBlur = 0;
    strokeLine(context, [[79, 25], [82, 58]], config.colors.scooterText, 2);
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
    context.globalAlpha = 0.18;
    context.fillStyle = glow;
    context.fillRect(7, 34, 49, 59);
    context.globalAlpha = 1;
    context.strokeStyle = glow;
    context.lineWidth = 1;
    context.strokeRect(7, 34, 49, 59);
    context.strokeRect(65, 34, 28, 65);
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
    const bounds = obstacle.definition.type === 'spaeti'
      ? { x: laneX(obstacle.lane), y: obstacle.y - config.spaetiHeight / 2,
        width: config.obstacleWidth, height: config.spaetiHeight }
      : obstacleDrawBounds(obstacle);
    drawArtwork(bounds, context => {
      if (obstacle.definition.type === 'sign') drawSign(context);
      else if (obstacle.definition.type === 'scooter') drawScooter(context);
      else drawStorefront(context, 'SPÄTI', config.colors.neonMagenta);
    });
  }

  function drawBottle(bottle) {
    drawArtwork({ x: laneX(bottle.lane), y: bottle.y - config.bottleSize / 2,
      width: config.bottleSize, height: config.bottleSize }, context => {
      neon(context, config.colors.bottle, 5);
      context.fillStyle = config.colors.bottle;
      context.beginPath();
      context.moveTo(38, 4); context.lineTo(62, 4);
      context.lineTo(62, 29); context.lineTo(77, 43);
      context.lineTo(77, 96); context.lineTo(23, 96);
      context.lineTo(23, 43); context.lineTo(38, 29);
      context.closePath(); context.fill();
      context.shadowBlur = 0;
      context.fillStyle = config.colors.uniform;
      context.fillRect(36, 2, 28, 9);
      context.fillRect(25, 58, 50, 22);
      strokeLine(context, [[33, 48], [33, 53]], config.colors.signText, 5);
      strokeLine(context, [[33, 84], [33, 90]], config.colors.signText, 4);
      context.fillStyle = config.colors.signText;
      context.font = '800 15px system-ui';
      context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillText('↻', 50, 69);
    });
  }

  function drawPerson(context, inspector = false) {
    // A continuous distance-driven gait freezes naturally when the run pauses.
    const running = !reducedMotion.matches && !caught && !finished && player.action === 'run';
    const stride = running ? Math.sin(elapsed * config.startSpeed / config.playerSize * Math.PI) : 0;
    const accent = inspector ? config.colors.kontrolleur : config.colors.player;
    const swing = stride * 9;
    const sleeves = inspector ? config.colors.uniform : accent;
    neon(context, accent, 3);
    strokeLine(context, [[39, 59], [34 - swing, 77], [28 + swing, 95]], config.colors.uniform, 13);
    strokeLine(context, [[61, 59], [66 + swing, 77], [72 - swing, 95]], config.colors.uniform, 13);
    strokeLine(context, [[21 + swing, 96], [34 + swing, 96]], accent, 6);
    strokeLine(context, [[66 - swing, 96], [79 - swing, 96]], accent, 6);
    strokeLine(context, [[29, 30], [17, 47 + swing], [6, 55 + swing]], sleeves, 11);
    strokeLine(context, [[71, 30], [83, 47 - swing], [94, 55 - swing]], sleeves, 11);
    context.fillStyle = inspector ? config.colors.uniform : accent;
    context.beginPath();
    context.moveTo(27, 27); context.lineTo(73, 27);
    context.lineTo(69, 64); context.lineTo(31, 64);
    context.closePath(); context.fill();
    context.strokeStyle = accent; context.lineWidth = 2; context.stroke();
    context.shadowBlur = 0;
    disc(context, 50, 14, 12, config.colors.uniform);
    strokeLine(context, [[42, 25], [58, 25]], config.colors.player, 4);
    if (inspector) {
      context.fillStyle = config.colors.uniform;
      context.fillRect(33, 3, 34, 10);
      strokeLine(context, [[32, 12], [68, 12]], accent, 4);
      context.fillStyle = accent;
      context.fillRect(34, 39, 32, 6);
      context.fillRect(34, 54, 32, 3);
    } else {
      // Back-facing hood, backpack, and reflective seams.
      context.fillStyle = config.colors.uniform;
      context.fillRect(38, 32, 24, 25);
      strokeLine(context, [[41, 35], [59, 35]], config.colors.signText, 2);
      strokeLine(context, [[30, 59], [70, 59]], config.colors.signText, 3);
    }
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
    drawArtwork(playerDrawBounds(), context => drawPerson(context), lift,
      player.action === 'crouch' ? config.crouchScale : 1);
  }

  function drawKontrolleur() {
    drawArtwork({ x: laneX(player.lane),
      y: config.playerY + kontrolleurDistance() - config.kontrolleurSize / 2,
      width: config.kontrolleurSize, height: config.kontrolleurSize },
    context => drawPerson(context, true));
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

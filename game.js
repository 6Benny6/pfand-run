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
  const exchangeScreen = document.querySelector('#exchange');
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
    ctx.imageSmoothingEnabled = false;
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
  let finishPhase = 'running';
  let finishElapsed = 0;
  let finishResults = null;
  const approachAt = config.runDurationSeconds - config.finishApproachSeconds;
  const arrivalSeconds = Math.min(0.3, config.finishAnimationSeconds * 0.1);
  // Every hazard must leave the scene entirely before the shop appears.
  const finishClearanceSeconds = (config.worldHeight - config.spawnY +
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

  const formatEuros = cents => `€${(cents - cents % 100) / 100}.${String(cents % 100).padStart(2, '0')}`;

  // One unchanged integer-cent calculation for the live display and final exchange.
  function pfandResult(count) {
    const totalCents = count * config.bottleValueCents;
    const leftoverCents = totalCents % config.doenerPriceCents;
    const doener = (totalCents - leftoverCents) / config.doenerPriceCents;
    return { bottles: count, totalCents, leftoverCents, doener,
      exchangedBottles: (totalCents - leftoverCents) / config.bottleValueCents,
      leftoverBottles: leftoverCents / config.bottleValueCents };
  }

  function arrive() {
    finished = true;
    finishPhase = 'arrival';
    releaseCrouch();
    firstCrashAt = null;
    flashRemaining = 0;
    tollMessageRemaining = 0;
    tollMessage.textContent = '';
    player.action = 'run';
    player.actionRemaining = 0;
    finishResults = Object.freeze(pfandResult(pfand));
    status.textContent = 'You reached the Dönerladen!';
    updatePursuit();
    if (pfand === 0) showResults();
  }

  function showResults() {
    finishPhase = 'results';
    exchangeScreen.hidden = true;
    const result = finishResults;
    document.querySelector('#result-bottles').textContent = String(result.bottles);
    document.querySelector('#result-pfand').textContent = formatEuros(result.totalCents);
    document.querySelector('#result-doener').textContent = String(result.doener);
    document.querySelector('#result-leftover').textContent = `${formatEuros(result.leftoverCents)} (${formatEuros(config.doenerPriceCents - result.leftoverCents)} short of Döner #${result.doener + 1})`;
    document.querySelector('#finish-message').hidden = result.bottles !== 0;
    finishedScreen.hidden = false;
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
      pursuitLabel.textContent = '';
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
    pfandCounter.textContent = `Pfand: ${pfand} BOTTLES`;
    tollMessageRemaining = 0;
    tollMessage.textContent = '';
    crashes = 0;
    flashRemaining = 0;
    firstCrashAt = null;
    caught = false;
    finished = false;
    finishPhase = 'running';
    finishElapsed = 0;
    finishResults = null;
    previousTime = null;
    crashCounter.textContent = '0';
    caughtScreen.hidden = true;
    finishedScreen.hidden = true;
    exchangeScreen.hidden = true;
    document.querySelector('#finish-message').hidden = true;
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
    if (finishPhase === 'arrival' || finishPhase === 'exchange') {
      event.preventDefault();
      if (finishPhase === 'exchange' && !event.repeat && !document.hidden &&
          event.key.toLowerCase() !== config.restartKey.toLowerCase()) showResults();
      return;
    }
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
    if (finishPhase === 'arrival' || finishPhase === 'exchange') {
      finishElapsed = Math.min(config.finishAnimationSeconds, finishElapsed + dt);
      if (finishElapsed >= config.finishAnimationSeconds) showResults();
      else if (finishElapsed >= arrivalSeconds) {
        finishPhase = 'exchange';
        exchangeScreen.hidden = false;
      }
      return;
    }
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
    const hazardsAllowed = elapsed < approachAt - finishClearanceSeconds;
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
        if (obstacle.lane === player.lane && !caught && !finished && elapsed < config.runDurationSeconds) {
          if (obstacle.definition.type === 'spaeti') {
            pfand = Math.max(0, pfand - config.spaetiCost);
            pfandCounter.textContent = `Pfand: ${pfand} BOTTLES`;
            tollMessage.textContent = `Späti-Preise: -${config.spaetiCost} BOTTLES`;
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
        pfandCounter.textContent = `Pfand: ${pfand} BOTTLES`;
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
    if (elapsed >= config.runDurationSeconds) arrive();
  }

  // Rendering only. Eight existing colors; no gradients or blended UI colors.
  const ui = {
    ink: config.colors.uniform, shade: config.colors.road,
    white: config.colors.signText, green: config.colors.bottle, amber: config.colors.neonAmber,
    pink: config.colors.neonMagenta, lime: config.colors.scooter,
    red: config.colors.debugOverlap,
  };
  const font = {
    A: '01110/10001/10001/11111/10001/10001/10001', B: '11110/10001/10001/11110/10001/10001/11110',
    C: '01111/10000/10000/10000/10000/10000/01111', D: '11110/10001/10001/10001/10001/10001/11110',
    E: '11111/10000/10000/11110/10000/10000/11111', F: '11111/10000/10000/11110/10000/10000/10000',
    G: '01111/10000/10000/10111/10001/10001/01111', H: '10001/10001/10001/11111/10001/10001/10001',
    I: '11111/00100/00100/00100/00100/00100/11111', J: '00111/00010/00010/00010/10010/10010/01100',
    K: '10001/10010/10100/11000/10100/10010/10001', L: '10000/10000/10000/10000/10000/10000/11111',
    M: '10001/11011/10101/10101/10001/10001/10001', N: '10001/11001/10101/10011/10001/10001/10001',
    O: '01110/10001/10001/10001/10001/10001/01110', P: '11110/10001/10001/11110/10000/10000/10000',
    Q: '01110/10001/10001/10001/10101/10010/01101', R: '11110/10001/10001/11110/10100/10010/10001',
    S: '01111/10000/10000/01110/00001/00001/11110', T: '11111/00100/00100/00100/00100/00100/00100',
    U: '10001/10001/10001/10001/10001/10001/01110', V: '10001/10001/10001/10001/10001/01010/00100',
    W: '10001/10001/10001/10101/10101/10101/01010', X: '10001/10001/01010/00100/01010/10001/10001',
    Y: '10001/10001/01010/00100/00100/00100/00100', Z: '11111/00001/00010/00100/01000/10000/11111',
    0: '01110/10001/10011/10101/11001/10001/01110', 1: '00100/01100/00100/00100/00100/00100/01110',
    2: '01110/10001/00001/00010/00100/01000/11111', 3: '11110/00001/00001/01110/00001/00001/11110',
    4: '00010/00110/01010/10010/11111/00010/00010', 5: '11111/10000/10000/11110/00001/00001/11110',
    6: '01110/10000/10000/11110/10001/10001/01110', 7: '11111/00001/00010/00100/01000/01000/01000',
    8: '01110/10001/10001/01110/10001/10001/01110', 9: '01110/10001/10001/01111/00001/00001/01110',
    'Ö': '01010/00000/01110/10001/10001/10001/01110', 'Ä': '01010/01110/10001/11111/10001/10001/10001',
    'Ü': '01010/00000/10001/10001/10001/10001/01110', '€': '00111/01000/11110/01000/11110/01000/00111',
    '!': '00100/00100/00100/00100/00100/00000/00100', '?': '01110/10001/00001/00010/00100/00000/00100',
    '.': '00000/00000/00000/00000/00000/00110/00110', ',': '00000/00000/00000/00000/00110/00100/01000',
    ':': '00000/00110/00110/00000/00110/00110/00000',
    '/': '00001/00001/00010/00100/01000/10000/10000', '-': '00000/00000/00000/11111/00000/00000/00000',
    '+': '00000/00100/00100/11111/00100/00100/00000', '=': '00000/00000/11111/00000/11111/00000/00000',
    '(': '00010/00100/01000/01000/01000/00100/00010', ')': '01000/00100/00010/00010/00010/00100/01000',
    '#': '01010/11111/01010/01010/11111/01010/00000', '×': '00000/10001/01010/00100/01010/10001/00000',
    '→': '00000/00100/00010/11111/00010/00100/00000', ' ': '00000/00000/00000/00000/00000/00000/00000',
  };
  for (const letter of Object.keys(font)) font[letter] = font[letter].split('/');
  const icons = {
    bottle: ['...WW...', '...GG...', '...GG...', '..GGGG..', '..GGGG..', '..WWWW..', '..GGGG..', '..GGGG..'],
    doener: ['..AAAA..', '.AAAAAA.', 'AAAAAAAA', '.GGGGGG.', '.AAAAAA.', '..AAAA..', '..AAAA..', '...AA...'],
    clock: ['..WWWW..', '.W....W.', 'W..W...W', 'W..W...W', 'W..WWW.W', 'W......W', '.W....W.', '..WWWW..'],
    left: ['...W...', '..WW...', '.WWWWWW', 'WWWWWWW', '.WWWWWW', '..WW...', '...W...'],
    right: ['...W...', '...WW..', 'WWWWWW.', 'WWWWWWW', 'WWWWWW.', '...WW..', '...W...'],
    up: ['...W...', '..WWW..', '.WWWWW.', 'WWWWWWW', '..WWW..', '..WWW..', '..WWW..'],
    down: ['..WWW..', '..WWW..', '..WWW..', 'WWWWWWW', '.WWWWW.', '..WWW..', '...W...'],
  };

  function bitmap(context, rows, x, y, scale, color) {
    for (let row = 0; row < rows.length; row++) {
      for (let column = 0; column < rows[row].length; column++) {
        const cell = rows[row][column];
        if (cell === '0' || cell === '.') continue;
        context.fillStyle = color || ({ W: ui.white, G: ui.green, A: ui.amber })[cell];
        context.fillRect(x + column * scale, y + row * scale, scale, scale);
      }
    }
  }

  function bitmapText(context, text, x, y, scale, color, align = 'left') {
    const letters = String(text).toUpperCase();
    if (align === 'center') x -= (letters.length * 6 - 1) * scale / 2;
    if (align === 'right') x -= (letters.length * 6 - 1) * scale;
    x = Math.round(x); y = Math.round(y);
    for (const letter of letters) {
      bitmap(context, font[letter] || font['?'], x, y, scale, color);
      x += 6 * scale;
    }
  }

  // HUD rectangles are written in backing-buffer pixels, including on Retina displays.
  function pixelText(text, x, y, scale = 2, color = ui.white, align = 'left') {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    bitmapText(ctx, text, Math.round(x * viewport.pixelRatio), Math.round(y * viewport.pixelRatio),
      Math.max(1, Math.round(scale * viewport.pixelRatio)), color, align);
    ctx.restore();
  }

  function pixelIcon(name, x, y, scale) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    bitmap(ctx, icons[name], Math.round(x * viewport.pixelRatio), Math.round(y * viewport.pixelRatio),
      Math.max(1, Math.round(scale * viewport.pixelRatio)));
    ctx.restore();
  }

  function pixelPanel(x, y, width, height) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const ratio = viewport.pixelRatio;
    x = Math.round(x * ratio); y = Math.round(y * ratio);
    width = Math.round(width * ratio); height = Math.round(height * ratio);
    const border = Math.max(1, Math.round(3 * ratio));
    ctx.fillStyle = ui.white; ctx.fillRect(x, y, width, height);
    ctx.fillStyle = ui.shade; ctx.fillRect(x + border, y + border, width - border, height - border);
    ctx.fillStyle = ui.ink; ctx.fillRect(x + border, y + border, width - border * 2, height - border * 2);
    ctx.restore();
  }

  function drawPixelHud(time) {
    const width = viewport.width, height = viewport.height;
    const scale = Math.max(1, Math.min(3, Math.floor((width - 24) / 140), Math.floor((height - 24) / 140)));
    const center = Math.floor(width / 2);
    if (caught || finishPhase === 'results' || finishPhase === 'exchange') {
      const panelWidth = Math.min(width - 16, 246 * scale);
      const panelHeight = Math.min(height - 16, (finishPhase === 'exchange' ? 184 : 142) * scale);
      const x = Math.floor((width - panelWidth) / 2), y = Math.floor((height - panelHeight) / 2);
      ctx.fillStyle = ui.ink; ctx.fillRect(0, 0, width, height);
      pixelPanel(x, y, panelWidth, panelHeight);
      const line = 13 * scale;
      let row = y + 12 * scale;
      if (caught) {
        pixelText('CAUGHT!', center, row, scale * 2, ui.pink, 'center');
        pixelText('KONTROLLEUR WINS', center, row + line * 2, scale, ui.white, 'center');
      } else {
        const result = finishResults;
        const exchange = finishPhase === 'exchange';
        const view = exchange ? exchangePresentation() : null;
        pixelText(exchange ? 'PFAND → DÖNER' : 'DÖNERLADEN', center, row, scale, ui.amber, 'center');
        row += line * 1.5;
        if (exchange) {
          const art = document.querySelector('#exchange-art');
          const artWidth = Math.min(panelWidth - 24, 180 * scale);
          const artHeight = artWidth * art.height / art.width;
          drawExchange({ x: center - artWidth / 2, y: row, scale: artWidth / art.width });
          row += artHeight + 6 * scale;
          pixelText(document.querySelector('#exchange-bottles').textContent.replace('Bottles collected: ', 'BOTTLES '), center, row, scale, ui.green, 'center');
          row += line;
          pixelText(formatEuros(view.cents), center, row, scale * 2, ui.amber, 'center');
          row += line * 2;
          pixelText('ANY KEY EXCEPT R SKIPS', center, row, scale, ui.white, 'center');
        } else {
          const resultWidth = 24 * scale + (String(result.doener).length * 6 - 1) * scale * 3;
          const resultX = Math.round(center - resultWidth / 2);
          pixelIcon('doener', resultX, row, scale * 2);
          pixelText(result.doener, resultX + 24 * scale, row, scale * 3, ui.amber);
          row += line * 2;
          pixelText(`${result.bottles} BOTTLES`, center, row, scale, ui.green, 'center');
          pixelText(`PFAND ${formatEuros(result.totalCents)}`, center, row + line, scale, ui.white, 'center');
          pixelText(`LEFT ${formatEuros(result.leftoverCents)}`, center, row + line * 2, scale, ui.white, 'center');
          if (!result.bottles) pixelText('NO BOTTLES, NO DÖNER.', center, row + line * 3, scale, ui.pink, 'center');
        }
      }
      if (finishPhase !== 'exchange' && (reducedMotion.matches || Math.floor(time / 500) % 2 === 0)) {
        pixelText('PRESS R', center, y + panelHeight - 18 * scale, scale, ui.white, 'center');
      }
      return;
    }
    const panelWidth = Math.min(width - 16, 220 * scale), x = Math.floor((width - panelWidth) / 2);
    const barY = 8, barHeight = 16 * scale + 14;
    pixelPanel(x, barY, panelWidth, barHeight);
    const itemY = barY + 8;
    pixelIcon('bottle', x + 10, itemY, scale);
    pixelText(`× ${String(pfand).padStart(2, '0')}`, x + 10 + 11 * scale, itemY + scale, scale, ui.green);
    pixelIcon('doener', x + Math.floor(panelWidth * 0.39), itemY, scale);
    pixelText(pfandResult(pfand).doener, x + Math.floor(panelWidth * 0.39) + 11 * scale, itemY + scale, scale, ui.amber);
    pixelIcon('clock', x + panelWidth - 56 * scale, itemY, scale);
    pixelText(`TIME ${String(Math.ceil(Math.max(0, config.runDurationSeconds - elapsed))).padStart(2, '0')}`,
      x + panelWidth - 45 * scale, itemY + scale, scale);
    let nextY = barY + barHeight + 8;
    if (firstCrashAt !== null && !finished) {
      pixelPanel(x, nextY, panelWidth, 17 * scale + 7);
      pixelText('KONTROLLEUR!', center, nextY + 7, scale, ui.pink, 'center');
      const segmentWidth = Math.floor((panelWidth - 24) / 16);
      const filled = Math.ceil(distanceMeter.value * 16 / 100);
      for (let i = 0; i < 16; i++) {
        ctx.fillStyle = i < filled ? ui.lime : ui.shade;
        ctx.fillRect(x + 12 + i * segmentWidth, nextY + 12 * scale, segmentWidth - 2, 5 * scale);
      }
      nextY += 17 * scale + 15;
    }
    if (debugHitboxes) {
      pixelText(`CRASHES ${crashes}`, width - 12, nextY, scale, ui.red, 'right');
      nextY += 12 * scale;
    }
    if (elapsed < 5 && !finished) {
      pixelPanel(x, nextY, panelWidth, 32 * scale + 12);
      pixelText('PFAND RUN', center, nextY + 8, scale * 2, ui.amber, 'center');
      pixelText('BOTTLES → DÖNER', center, nextY + 23 * scale, scale, ui.white, 'center');
      const hintY = height - 30 * scale - 24;
      pixelPanel(x, hintY, panelWidth, 30 * scale + 12);
      pixelIcon('left', x + 12, hintY + 8, scale);
      pixelIcon('right', x + 12 + 9 * scale, hintY + 8, scale);
      pixelText('MOVE', x + 12 + 20 * scale, hintY + 8, scale);
      pixelIcon('up', x + 12, hintY + 10 + 11 * scale, scale);
      pixelText('JUMP', x + 12 + 9 * scale, hintY + 10 + 11 * scale, scale);
      pixelIcon('down', center + 3 * scale, hintY + 10 + 11 * scale, scale);
      pixelText('CROUCH', center + 12 * scale, hintY + 10 + 11 * scale, scale);
    }
    if (tollMessageRemaining > 0) {
      const text = `SPÄTI -${config.spaetiCost} BOTTLES`;
      pixelPanel(x, height - 24 * scale - 20, panelWidth, 18 * scale + 12);
      pixelText(text, center, height - 24 * scale - 10, scale, ui.pink, 'center');
    }
  }

  // Rendering only: shared depth for the road, upright artwork, and ground boxes.
  // Omitting y intersects a road edge with the bottom of the viewport.
  function project(x, y, exact = false) {
    const horizonY = viewport.height * (config.camera.horizonY / config.worldHeight + 0.05);
    const playerScreenY = viewport.height * 0.84;
    const screenDepth = viewport.height - horizonY;
    const playerDepth = playerScreenY - horizonY;
    // Preserve a readable spawn scale while bringing the camera closer.
    const cameraDepth = (config.playerY - config.spawnY) * config.camera.minimumScale /
      (1 - config.camera.minimumScale);
    const depth = y === undefined ? cameraDepth * playerDepth / screenDepth
      : cameraDepth + config.playerY - y;
    if (depth <= 0) return null;
    // Artwork never exceeds twice the player-row scale; debug geometry stays exact.
    const perspective = exact ? cameraDepth / depth : Math.min(2, cameraDepth / depth);
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

  const snapPixel = value => Math.round(value * viewport.pixelRatio) / viewport.pixelRatio;
  let objectFrame = null;
  const frontCanvas = document.createElement('canvas');
  frontCanvas.width = frontCanvas.height = 100;
  const frontContext = frontCanvas.getContext('2d');
  frontContext.imageSmoothingEnabled = false;

  function withObjectFrame(bounds, paint) {
    const previous = objectFrame;
    // One continuous depth per object, shared by every face, post and texture.
    const point = project(bounds.x, bounds.y);
    const cameraDepth = (config.playerY - config.spawnY) * config.camera.minimumScale /
      (1 - config.camera.minimumScale);
    if (!point || bounds.y + bounds.height / 2 >= config.playerY + cameraDepth) return;
    const perspective = point.scale / (viewport.height / (config.playerSize * 4));
    objectFrame = {
      worldX: bounds.x, worldY: bounds.y, x: point.x, y: point.y,
      roadScale: point.roadScale, scale: point.scale,
      depthScale: (point.y - point.horizonY) * perspective / cameraDepth,
      sideScale: (point.x - viewport.width / 2) * perspective / cameraDepth,
    };
    try { paint(); } finally { objectFrame = previous; }
  }

  function artworkPoint(x, y, height = 0) {
    const frame = objectFrame;
    if (!frame) {
      const point = project(x, y);
      if (!point) return null;
      return { ...point, x: snapPixel(point.x), y: snapPixel(point.y - height * point.scale) };
    }
    return {
      x: snapPixel(frame.x + (x - frame.worldX) * frame.roadScale + (y - frame.worldY) * frame.sideScale),
      y: snapPixel(frame.y + (y - frame.worldY) * frame.depthScale - height * frame.scale),
      roadScale: frame.roadScale, scale: frame.scale,
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
    ctx.beginPath();
    const center = project(bounds.x, bounds.y, true);
    const bottom = project(bounds.x, bounds.y + bounds.height / 2, true);
    const corners = [
      [bounds.x - bounds.width / 2, bounds.y - bounds.height / 2],
      [bounds.x + bounds.width / 2, bounds.y - bounds.height / 2],
      [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2],
      [bounds.x - bounds.width / 2, bounds.y + bounds.height / 2],
    ].map(([x, y]) => project(x, y, true));
    if (!center || !bottom || corners.some(point => !point)) return;
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
        ctx.strokeStyle = grain % 3 ? config.colors.worldLane : config.colors.worldRoad;
        ctx.lineWidth = Math.max(0.4, start.roadScale * 0.5);
        ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
      }
      if (row % 7 === 0) {
        const x = config.roadLeft + roadNoise(row, 71) * roadWidth;
        ctx.globalAlpha = 0.32;
        ctx.fillStyle = config.colors.worldRoad;
        const patch = [project(x, y), project(x + 29, y + 3),
          project(x + 34, y + 21), project(x - 4, y + 18)];
        facePath(ctx, patch); ctx.fill();
      }
      if (row % 5 === 0) {
        const x = config.roadLeft + roadNoise(row, 79) * roadWidth;
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = config.colors.worldRoad;
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

  let atmosphere = null;

  function drawBackdrop() {
    const horizon = project(config.worldWidth / 2, config.playerY).horizonY;
    // Cache gradients until a resize/DPR change; no game RNG or backdrop simulation.
    if (!atmosphere || atmosphere.height !== viewport.height || atmosphere.ratio !== viewport.pixelRatio) {
      const sky = ctx.createLinearGradient(0, 0, 0, horizon);
      sky.addColorStop(0, config.colors.worldSkyTop);
      sky.addColorStop(1, config.colors.worldSkyHorizon);
      const haze = ctx.createLinearGradient(0, horizon - 30, 0, horizon + 30);
      haze.addColorStop(0, config.colors.worldHazeClear);
      haze.addColorStop(0.5, config.colors.worldHaze);
      haze.addColorStop(1, config.colors.worldHazeClear);
      atmosphere = { height: viewport.height, ratio: viewport.pixelRatio, sky, haze };
    }
    ctx.fillStyle = config.colors.worldConcrete;
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    ctx.fillStyle = atmosphere.sky;
    ctx.fillRect(0, 0, viewport.width, Math.ceil(horizon));
    ctx.fillStyle = config.colors.worldSkyline;
    const skylineUnit = viewport.width / 36;
    for (let i = 0; i < 36; i++) {
      const height = (0.01 + roadNoise(i, 201) * 0.04) * viewport.height;
      ctx.fillRect(Math.floor(i * skylineUnit), Math.floor(horizon - height), Math.ceil(skylineUnit), Math.ceil(height));
    }
    const phase = elapsed / config.runDurationSeconds * 4;
    const landmark = Math.min(3, Math.floor(phase));
    const blend = landmark === 0 ? 1 : Math.min(1, (phase - landmark) / 0.12);
    if (landmark > 0 && blend < 1) drawLandmark(landmark - 1, horizon, 1 - blend);
    drawLandmark(landmark, horizon, blend);
    drawStreetBuildings();
    ctx.fillStyle = atmosphere.haze;
    ctx.fillRect(0, horizon - 30, viewport.width, 60);
  }

  function drawLandmark(index, horizon, opacity) {
    ctx.save();
    ctx.globalAlpha = opacity;
    const unit = Math.min(1.8, viewport.width / 480, viewport.height / 600);
    ctx.translate(viewport.width / 2, horizon + 2);
    ctx.scale(unit, unit);
    const color = config.colors.worldMonument;
    ctx.fillStyle = color;
    if (index === 0) {
      // Fernsehturm: slender shaft, observation sphere, antenna.
      ctx.fillRect(-3, -90, 6, 90);
      ctx.fillRect(-1, -132, 2, 42);
      ctx.beginPath(); ctx.ellipse(0, -91, 13, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(-8, -100, 16, 3);
    } else if (index === 1) {
      // Brandenburger Tor: six columns, entablature and a small quadriga silhouette.
      ctx.fillRect(-76, -48, 152, 10);
      ctx.fillRect(-66, -55, 132, 7);
      ctx.fillRect(-79, -4, 158, 4);
      for (let i = 0; i < 6; i++) ctx.fillRect(-62 + i * 23, -38, 9, 34);
      ctx.fillRect(-18, -62, 36, 7);
      strokeLine(ctx, [[-15, -65], [-6, -69], [0, -66], [6, -69], [15, -65]], color, 5);
      ctx.fillRect(-1, -78, 2, 14);
    } else if (index === 2) {
      // Oberbaumbrücke: repeated open arches between twin pointed brick towers.
      ctx.beginPath(); ctx.rect(-90, -20, 180, 20);
      for (let x = -72; x <= 72; x += 24) {
        ctx.moveTo(x - 8, 0); ctx.lineTo(x - 8, -8);
        ctx.quadraticCurveTo(x, -23, x + 8, -8);
        ctx.lineTo(x + 8, 0); ctx.closePath();
      }
      ctx.fill('evenodd');
      for (const x of [-51, 51]) {
        ctx.fillRect(x - 9, -56, 18, 56);
        ctx.beginPath(); ctx.moveTo(x - 12, -56); ctx.lineTo(x, -76);
        ctx.lineTo(x + 12, -56); ctx.closePath(); ctx.fill();
      }
      ctx.fillRect(-90, -25, 180, 5);
    } else {
      // Siegessäule: broad plinth, narrow column and winged Victoria.
      ctx.fillRect(-19, -9, 38, 9); ctx.fillRect(-13, -20, 26, 11);
      ctx.fillRect(-4, -91, 8, 71); ctx.fillRect(-8, -94, 16, 5);
      ctx.fillRect(-3, -108, 6, 14);
      ctx.beginPath();
      ctx.moveTo(-2, -105); ctx.lineTo(-17, -116); ctx.lineTo(-12, -102);
      ctx.lineTo(0, -98); ctx.lineTo(12, -110); ctx.lineTo(15, -123);
      ctx.lineTo(2, -106); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(0, -112, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawStreetBuildings() {
    const spacing = config.worldHeight / 4;
    const travel = elapsed * config.startSpeed;
    const phase = travel % spacing;
    for (let row = 0; row < 4; row++) {
      const y = config.spawnY + row * spacing + phase;
      if (y >= config.playerY) continue;
      const block = Math.floor(travel / spacing) - row;
      for (const side of [-1, 1]) {
        const edge = side < 0 ? config.roadLeft : config.roadRight;
        const point = project(edge + side * laneWidth * 0.5, y);
        if (!point) continue;
        const width = laneWidth * 0.68 * point.roadScale;
        const height = (65 + roadNoise(block, side + 210) * 40) * point.scale;
        const left = snapPixel(point.x - width / 2), top = snapPixel(point.y - height);
        ctx.fillStyle = config.colors.worldBuilding;
        ctx.fillRect(left, top, Math.ceil(width), Math.ceil(height));
        ctx.fillStyle = config.colors.worldBuildingSide;
        ctx.fillRect(side < 0 ? left + width * 0.8 : left, top, width * 0.2, height);
        ctx.fillStyle = config.colors.worldWindow;
        const windowSize = Math.max(1, Math.round(point.scale * 1.3));
        for (let floor = 1; floor <= 5; floor++) {
          for (let column = 1; column <= 4; column++) {
            if (roadNoise(block * 23 + floor * 4 + column, side + 220) > 0.24) continue;
            ctx.fillRect(Math.round(left + width * column / 6), Math.round(top + height * floor / 7),
              windowSize, windowSize * 2);
          }
        }
        const lamp = project(edge + side * laneWidth * 0.09, y);
        const lampTop = snapPixel(lamp.y - 65 * lamp.scale);
        strokeLine(ctx, [[lamp.x, lamp.y], [lamp.x, lampTop],
          [lamp.x - side * 9 * lamp.scale, lampTop]], config.colors.worldHardware,
        Math.max(1, snapPixel(1.2 * lamp.scale)));
        ctx.fillStyle = config.colors.worldLamp;
        ctx.fillRect(snapPixel(lamp.x - side * 9 * lamp.scale - 2 * lamp.scale), lampTop,
          Math.max(2, snapPixel(4 * lamp.scale)), Math.max(1, snapPixel(2 * lamp.scale)));
      }
    }
  }

  function drawRoad() {
    drawBackdrop();
    const bottomLeft = project(config.roadLeft);
    const bottomRight = project(config.roadRight);
    const sidewalkWidth = laneWidth / 10;
    ctx.fillStyle = config.colors.worldConcrete;
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
    ctx.fillStyle = config.colors.worldRoad;
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
    ctx.strokeStyle = config.colors.worldLane;
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

  // Artwork shares one depth frame; H footprints keep the exact ground projection.
  function volumePoint(bounds, u, v, height) {
    return artworkPoint(bounds.x + (u - 0.5) * bounds.width,
      bounds.y + (v - 0.5) * bounds.height, height);
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
  function drawFace(points, color, light = 0, glow = false) {
    if (points.some(point => !point)) return;
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
      ctx.lineWidth = Math.max(1, Math.round(viewport.height / config.worldHeight)) * 2 / viewport.pixelRatio;
      ctx.shadowColor = glow;
      ctx.shadowBlur = 4 * viewport.pixelRatio;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawGroundShadow(bounds) {
    const point = artworkPoint(bounds.x, bounds.y + bounds.height * 0.35);
    if (!point) return;
    const radiusX = Math.min(bounds.width * point.roadScale * 0.48, viewport.width * 0.12);
    const radiusY = Math.min(radiusX * 0.2, viewport.height * 0.016);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.scale(radiusX, radiusY);
    const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    shadow.addColorStop(0, config.colors.worldShadow);
    shadow.addColorStop(1, config.colors.worldShadowClear);
    ctx.fillStyle = shadow;
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2);
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
    // Fixed-resolution artwork avoids continuously rerasterizing scaled font outlines.
    frontContext.save();
    frontContext.clearRect(0, 0, 100, 100);
    frontContext.lineCap = 'round';
    frontContext.lineJoin = 'round';
    paint(frontContext);
    frontContext.restore();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frontCanvas, left.x, left.y, right.x - left.x, foot.y - left.y);
    ctx.restore();
  }

  // Extrude an x/height silhouette through its exact world ground footprint.
  // Horizontal upper edges become light top faces; vertical edges become dark sides.
  function drawProfile(bounds, profile, color, paint, glow = false) {
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

  function drawVolume(bounds, bottom, top, color, paint, glow = false) {
    drawProfile(bounds, [[0, bottom], [1, bottom], [1, top], [0, top]], color, paint, glow);
  }

  // Fit human proportions in screen space without changing the ground footprint.
  function drawArtwork(bounds, paint, lift = 0, heightScale = 1, gait = runningPose()) {
    const front = artworkPoint(bounds.x, bounds.y + bounds.height / 2);
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
        context.shadowBlur = 0;
        context.fillStyle = config.colors.signText;
        bitmapText(context, 'U', 50, 15, 10, ui.white, 'center');
        context.shadowBlur = 0;
        const opacity = context.globalAlpha;
        context.globalAlpha = opacity * 0.24;
        context.fillStyle = config.colors.signText;
        context.fillRect(4, 4, 92, 5);
        context.fillStyle = config.colors.uniform;
        context.fillRect(90, 9, 6, 87);
        context.fillRect(4, 90, 86, 6);
        context.globalAlpha = opacity;
      }, config.colors.signText);
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
      drawFace([base[i], base[next], roof[next], roof[i]], config.colors.worldHardware, -0.4);
    }
    drawFace(roof, config.colors.worldHardware);
  }

  function drawScooter(bounds) {
    // Wheelbase crosses the road; the stem rises from the deck's front axle.
    const wheelSize = bounds.width * 0.14;
    for (const u of [0.1, 0.9]) {
      const wheel = { ...bounds, x: bounds.x + (u - 0.5) * bounds.width,
        width: wheelSize, height: bounds.height * 0.14,
        y: bounds.y + bounds.height * 0.4 };
      drawProfile(wheel, Array.from({ length: 16 }, (_, i) => {
        const angle = i * Math.PI / 8;
        return [0.5 + Math.cos(angle) / 2, wheelSize * (0.5 + Math.sin(angle) / 2)];
      }), config.colors.worldHardware, context => {
        disc(context, 50, 50, 16, config.colors.worldHub);
      });
    }
    const deck = { ...bounds, width: bounds.width * 0.8,
      x: bounds.x,
      height: bounds.height * 0.18, y: bounds.y + bounds.height * 0.35 };
    drawVolume(deck, wheelSize * 0.35, wheelSize * 0.7, config.colors.scooter);
    const thickness = config.laneLineWidth * 1.6;
    const deckLeft = volumePoint(deck, 0, 1, wheelSize * 0.7);
    const deckRight = volumePoint(deck, 1, 1, wheelSize * 0.7);
    const deckPixels = Math.hypot(deckRight.x - deckLeft.x, deckRight.y - deckLeft.y);
    const stem = { ...bounds, x: bounds.x + bounds.width * 0.4,
      y: deck.y, width: thickness, height: deck.height };
    const stemBottom = wheelSize * 0.7;
    // Measure after projection so the proportion holds at every viewport size.
    const stemTop = stemBottom + deckPixels * 0.75 /
      artworkPoint(stem.x, stem.y + stem.height / 2).scale;
    drawVolume(stem, stemBottom, stemTop, config.colors.worldHardware);
    drawGroundBeam(bounds, [0.72, 0.85], [0.97, 0.85], thickness,
      stemTop - thickness * 0.5, stemTop + thickness * 0.5);
  }

  function drawStorefront(context, label, glow) {
    context.fillStyle = config.colors.uniform;
    context.fillRect(0, 0, 100, 100);
    neon(context, glow);
    context.lineWidth = 2;
    context.strokeRect(2, 2, 96, 24);
    context.fillStyle = glow;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    bitmapText(context, label, 50, 7, 3, glow, 'center');
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

  function streetOpacity(y) {
    // Fade only the final half-player-length before the row, then draw nothing.
    return clamp((config.playerY - y) / (config.playerSize * 0.5));
  }

  function drawObstacle(obstacle) {
    const opacity = streetOpacity(obstacle.y);
    if (opacity === 0) return;
    const impact = signImpactVisual(obstacle);
    if (impact?.opacity === 0) return;
    const renderY = impact ? impact.y : obstacle.y;
    const bounds = obstacle.definition.type === 'spaeti'
      ? { x: laneX(obstacle.lane), y: renderY - config.spaetiHeight / 2,
        width: config.obstacleWidth, height: config.spaetiHeight }
      : obstacleDrawBounds({ ...obstacle, y: renderY });
    withObjectFrame(bounds, () => {
      ctx.save();
      ctx.globalAlpha *= opacity;
      if (impact) ctx.globalAlpha *= impact.opacity;
      drawGroundShadow(bounds);
      if (obstacle.definition.type === 'sign') drawSign(bounds);
      else if (obstacle.definition.type === 'scooter') drawScooter(bounds);
      else drawVolume(bounds, 0, config.spaetiHeight, config.colors.spaetiShop,
        context => drawStorefront(context, 'SPÄTI', config.colors.neonMagenta));
      ctx.restore();
    });
  }

  function drawBottle(bottle) {
    const opacity = streetOpacity(bottle.y);
    if (opacity === 0) return;
    const bounds = { x: laneX(bottle.lane), y: bottle.y - config.bottleSize / 2,
      width: config.bottleSize, height: config.bottleSize };
    withObjectFrame(bounds, () => {
      ctx.save();
      ctx.globalAlpha *= opacity;
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
        bitmapText(context, 'P', 50, 61, 2, ui.white, 'center');
        strokeLine(context, [[35, 12], [35, 24], [18, 43], [18, 52]], config.colors.signText, 5);
        strokeLine(context, [[18, 85], [18, 93]], config.colors.signText, 4);
      });
      drawVolume({ ...bounds, width: bounds.width * 0.44 }, height * 0.94, height,
        config.colors.uniform);
      ctx.restore();
    });
  }

  function drawPerson(context, inspector = false, aspect = 0.55, pose = {}) {
    const gait = runningPose(inspector);
    const accent = inspector ? config.colors.kontrolleurBlue : config.colors.player;
    const trim = inspector ? config.colors.kontrolleurYellow : accent;
    const sleeves = accent;
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
    withObjectFrame({ ...bounds, artHeight: config.playerSize }, () => {
      const anchor = artworkPoint(bounds.x, bounds.y + bounds.height / 2);
      ctx.save();
      // Grounded sidestep: lean around the feet, with no added jump or vertical arc.
      ctx.translate(anchor.x, anchor.y);
      ctx.transform(1 + pose.recoil * 0.03, 0, -pose.lean, 1 - pose.recoil * 0.18, 0, 0);
      ctx.translate(-anchor.x, -anchor.y);
      drawArtwork({ ...bounds, artHeight: config.playerSize, crouch: pose.crouch },
        (context, aspect) => drawPerson(context, false, aspect, pose), lift);
      ctx.restore();
    });
  }

  function drawKontrolleur() {
    const bounds = { x: characterPose().x,
      y: config.playerY + kontrolleurDistance() - config.kontrolleurSize / 2,
      width: config.kontrolleurSize, height: config.kontrolleurSize,
      accent: config.colors.kontrolleurBlue };
    withObjectFrame(bounds, () => drawArtwork(bounds,
      (context, aspect) => drawPerson(context, true, aspect), 0, 1, runningPose(true)));
  }

  function drawImpactContact() {
    const impact = characterMotion.impactObstacle;
    const pose = characterPose();
    if (!impact || impact.y >= config.playerY || impact.definition.type !== 'sign' || pose.recoil <= 0) return;
    const visual = signImpactVisual(impact);
    if (!visual || visual.opacity === 0) return;
    const bounds = obstacleDrawBounds({ ...impact, y: visual.y });
    const point = volumePoint(bounds, 0.5, 1, config.signPostHeight);
    if (!point) return;
    const radius = Math.max(5, config.playerSize * project(bounds.x, bounds.y).scale * 0.17);
    ctx.save();
    ctx.globalAlpha = pose.recoil * visual.opacity;
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

  // Normalized storefront artwork is shared by the approach and result screen.
  function paintDoenerladen(context) {
    drawStorefront(context, 'DÖNER', config.colors.neonAmber);
    // A broad doorway covers every lane; the spit turns inside the amber glazing.
    context.fillStyle = config.colors.uniform;
    context.fillRect(6, 34, 88, 66);
    context.globalAlpha = 0.24;
    context.fillStyle = config.colors.neonAmber;
    context.fillRect(6, 34, 88, 66);
    context.globalAlpha = 1;
    context.strokeStyle = config.colors.neonAmber;
    context.strokeRect(6, 34, 88, 66);
    strokeLine(context, [[50, 34], [50, 100]], config.colors.neonAmber, 0.7);
    const time = elapsed + finishElapsed;
    const turn = reducedMotion.matches ? 0 : time * Math.PI;
    context.shadowColor = config.colors.neonAmber;
    context.shadowBlur = 0;
    strokeLine(context, [[27, 40], [27, 94]], config.colors.signText, 1);
    context.fillStyle = config.colors.neonAmber;
    context.beginPath();
    context.moveTo(14, 45); context.lineTo(40, 45);
    context.lineTo(33, 82); context.lineTo(21, 82);
    context.closePath(); context.fill();
    context.shadowBlur = 0;
    // Surface bands move around the spit at 0.5 Hz, with no flashing.
    for (let row = 0; row < 6; row++) {
      const y = 48 + row * 5;
      const x = 27 + Math.sin(turn + row * 0.4) * (11 - row);
      strokeLine(context, [[x, y], [x + 2, y + 4]], config.colors.spaetiShop, 1.5);
    }
  }

  function finishShopRect() {
    if (elapsed < approachAt) return null;
    const progress = Math.min(1, (elapsed - approachAt) / config.finishApproachSeconds);
    const row = project(config.worldWidth / 2, config.playerY);
    // Perspective starts just above the horizon, then reaches the player's row exactly.
    const perspective = 0.045 + progress * 0.955;
    const width = (config.roadRight - config.roadLeft) * row.roadScale * perspective;
    const height = viewport.height * 0.52 * perspective;
    const bottom = row.horizonY + (row.y - row.horizonY) * perspective;
    return { x: row.x - width / 2, y: bottom - height, width, height, bottom };
  }

  function drawFinishApproach() {
    const shop = finishShopRect();
    if (!shop) return;
    frontContext.clearRect(0, 0, 100, 100);
    frontContext.save();
    paintDoenerladen(frontContext);
    frontContext.restore();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frontCanvas, snapPixel(shop.x), snapPixel(shop.y),
      snapPixel(shop.width), snapPixel(shop.height));
  }

  function drawDoenerladen() {
    const destination = document.querySelector('#doenerladen');
    const context = destination.getContext('2d');
    context.save();
    context.clearRect(0, 0, destination.width, destination.height);
    context.translate(12, 10);
    context.scale((destination.width - 24) / 100, (destination.height - 20) / 100);
    paintDoenerladen(context);
    context.restore();
  }

  const clamp = value => Math.max(0, Math.min(1, value));

  function exchangePresentation() {
    const progress = clamp((finishElapsed - arrivalSeconds) /
      (config.finishAnimationSeconds - arrivalSeconds));
    return {
      revealed: Math.ceil(finishResults.bottles * clamp(progress / 0.3)),
      grouped: motionEase(clamp((progress - 0.3) / 0.1)),
      converted: clamp((progress - 0.4) / 0.4),
      cents: Math.round(finishResults.totalCents * clamp(progress / 0.8)),
    };
  }

  function drawExchange(screen) {
    const result = finishResults;
    const view = exchangePresentation();
    const icon = (name, x, y, size) => {
      const scale = Math.max(1, Math.round(size * screen.scale / 8));
      pixelIcon(name, screen.x + x * screen.scale - scale * 4,
        screen.y + y * screen.scale - scale * 4, scale);
    };
    const label = (text, x, y, color = ui.white) => pixelText(text,
      screen.x + x * screen.scale, screen.y + y * screen.scale,
      Math.max(1, Math.round(2 * screen.scale)), color, 'center');
    ctx.save();
    // Each token represents an exact, disjoint range of bottles. Work stays bounded.
    const tokens = Math.min(60, result.bottles);
    ctx.globalAlpha = 1 - view.grouped;
    for (let i = 0; i < tokens; i++) {
      const first = Math.floor(i * result.bottles / tokens);
      const last = Math.floor((i + 1) * result.bottles / tokens);
      const count = Math.max(0, Math.min(last, view.revealed) - first);
      if (!count) continue;
      const x = 24 + i % 15 * 48, y = 30 + Math.floor(i / 15) * 70;
      icon('bottle', x, y, 30);
      if (last - first > 1) label(`×${count}`, x, y + 28);
    }
    const cards = Math.min(4, result.doener);
    const slots = cards + (result.leftoverBottles > 0 ? 1 : 0);
    let shownDoener = 0;
    // Batch whole groups, never discard a group or extend the animation's duration.
    for (let i = 0; i < slots; i++) {
      const leftover = i === cards;
      const count = leftover ? 0 : Math.floor((i + 1) * result.doener / cards) -
        Math.floor(i * result.doener / cards);
      const converted = leftover ? 0 : motionEase(clamp(view.converted * cards - i));
      if (converted === 1) shownDoener += count;
      const x = (i + 0.5) * 720 / slots;
      const bottlesInGroup = leftover ? result.leftoverBottles :
        result.exchangedBottles / result.doener;
      ctx.globalAlpha = view.grouped * (1 - converted);
      for (let b = 0; b < bottlesInGroup; b++) {
        icon('bottle', x - 40 + b % 5 * 20, 75 + Math.floor(b / 5) * 38, 24);
      }
      ctx.globalAlpha = view.grouped * converted;
      icon('doener', x, 112, reducedMotion.matches ? 70 : 70 * (0.95 + 0.05 * converted));
      ctx.globalAlpha = view.grouped;
      label(leftover ? `${result.leftoverBottles} LEFT` : `${bottlesInGroup} × ${count}`, x, 215);
      if (!leftover) label(`→ ${count} DÖNER`, x, 242, ui.amber);
    }
    ctx.restore();
    document.querySelector('#exchange-bottles').textContent = `Bottles collected: ${view.revealed} / ${result.bottles}`;
    document.querySelector('#exchange-total').textContent = `Total Pfand: ${formatEuros(view.cents)}`;
    document.querySelector('#exchange-doener').textContent = `Döner bought: ${shownDoener} / ${result.doener}`;
    document.querySelector('#exchange-leftover').textContent = `Left over: ${formatEuros(result.leftoverCents)}`;
  }

  function draw(time = 0) {
    // Moving between displays can change DPR without changing the window size.
    if (viewport.pixelRatio !== (window.devicePixelRatio || 1)) resizeCanvas();
    ctx.setTransform(viewport.pixelRatio, 0, 0, viewport.pixelRatio, 0, 0);
    observeCharacterMotion();
    drawRoad();
    drawFinishApproach();
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
    if (finishPhase === 'arrival') {
      ctx.save();
      ctx.globalAlpha = motionEase(clamp(finishElapsed / arrivalSeconds));
      ctx.fillStyle = config.colors.uniform;
      ctx.fillRect(0, 0, viewport.width, viewport.height);
      ctx.restore();
    }
    if (debugHitboxes) drawHitboxes();
    if (finishPhase === 'results') drawDoenerladen();
    drawPixelHud(time);
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
    pixelText(`OVERLAP ${overlapping ? 'YES' : 'NO'}`, viewport.width - 114, viewport.height * 0.4 - 17, 1, ui.white);
    ctx.restore();
  }

  function frame(time) {
    if (!document.hidden) {
      const dt = previousTime === null ? 0 : Math.min((time - previousTime) / 1000, config.maxFrameSeconds);
      update(dt);
      draw(time);
      previousTime = time;
    }
    requestAnimationFrame(frame);
  }
  updateCountdown();
  requestAnimationFrame(frame);
})();

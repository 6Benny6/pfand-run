(() => {
  'use strict';

  const config = window.GAME_CONFIG;
  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d');
  const crashCounter = document.querySelector('#crashes');
  const status = document.querySelector('#status');
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

  const player = { lane: config.startLane, action: 'run', actionRemaining: 0 };
  let obstacles = [];
  const recentLanes = [];
  let elapsed = 0;
  let spawnAt = nextInterval();
  let crashes = 0;
  let flashRemaining = 0;
  let previousTime = null;
  const laneWidth = (config.roadRight - config.roadLeft) / config.laneCount;
  const laneX = lane => config.roadLeft + laneWidth * (lane + 0.5);

  function spawnObstacle() {
    // Never occupy all three lanes across three consecutive spawn events.
    const allowedLanes = Array.from({ length: config.laneCount }, (_, lane) => lane)
      .filter(lane => new Set([...recentLanes, lane]).size < config.laneCount);
    const lane = allowedLanes[Math.floor(random() * allowedLanes.length)];
    const definition = config.obstacles[Math.floor(random() * config.obstacles.length)];
    obstacles.push({ lane, y: config.spawnY, definition, passed: false });
    recentLanes.push(lane);
    if (recentLanes.length > config.laneCount - 1) recentLanes.shift();
  }

  window.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    if (event.repeat || document.hidden) return;
    if (event.key === 'ArrowLeft') player.lane = Math.max(0, player.lane - 1);
    if (event.key === 'ArrowRight') player.lane = Math.min(config.laneCount - 1, player.lane + 1);
    if (player.action !== 'run') return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      player.action = event.key === 'ArrowUp' ? 'jump' : 'crouch';
      player.actionRemaining = player.action === 'jump' ? config.jumpDuration : config.crouchDuration;
      status.textContent = player.action === 'jump' ? 'Jumping' : 'Crouching';
    }
  });

  // Hidden tabs pause simulation so returning cannot cause unseen crashes.
  document.addEventListener('visibilitychange', () => { previousTime = null; });

  function update(dt) {
    elapsed += dt;
    flashRemaining = Math.max(0, flashRemaining - dt);
    const actionAtStart = player.action;
    const actionTimeAtStart = player.actionRemaining;
    if (elapsed >= spawnAt) {
      spawnObstacle();
      spawnAt = elapsed + nextInterval();
    }
    for (const obstacle of obstacles) {
      const previousY = obstacle.y;
      obstacle.y += config.startSpeed * dt;
      if (!obstacle.passed && previousY < config.playerY && obstacle.y >= config.playerY) {
        obstacle.passed = true;
        const crossingTime = (config.playerY - previousY) / config.startSpeed;
        const action = actionTimeAtStart > crossingTime ? actionAtStart : 'run';
        if (obstacle.lane === player.lane && action !== obstacle.definition.requiredAction) {
          crashes += 1;
          crashCounter.textContent = String(crashes);
          flashRemaining = config.crashFlashDuration;
        }
      }
    }
    player.actionRemaining = Math.max(0, player.actionRemaining - dt);
    if (!player.actionRemaining && player.action !== 'run') {
      player.action = 'run';
      status.textContent = 'Run keeps going after a crash.';
    }
    obstacles = obstacles.filter(obstacle => obstacle.y < config.worldHeight + config.obstacleHeight);
  }

  function draw() {
    ctx.fillStyle = config.pavementColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = config.roadColor;
    ctx.fillRect(config.roadLeft, 0, config.roadRight - config.roadLeft, canvas.height);
    ctx.strokeStyle = config.laneColor;
    ctx.lineWidth = config.laneLineWidth;
    ctx.setLineDash([config.dashLength, config.dashGap]);
    ctx.lineDashOffset = -elapsed * config.startSpeed;
    for (let lane = 1; lane < config.laneCount; lane++) {
      const x = config.roadLeft + lane * laneWidth;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const obstacle of obstacles) {
      const x = laneX(obstacle.lane);
      const { definition, y } = obstacle;
      const height = config.obstacleHeight;
      const signOffset = definition.type === 'sign' ? config.signPostHeight : 0;
      ctx.fillStyle = definition.color;
      if (signOffset) {
        ctx.fillRect(x - config.obstacleWidth / 2, y - signOffset, config.laneLineWidth, signOffset);
        ctx.fillRect(x + config.obstacleWidth / 2 - config.laneLineWidth, y - signOffset, config.laneLineWidth, signOffset);
      }
      ctx.fillRect(x - config.obstacleWidth / 2, y - signOffset - height, config.obstacleWidth, height);
      ctx.fillStyle = definition.textColor;
      ctx.font = `bold ${config.obstacleFontSize}px system-ui`;
      ctx.fillText(definition.label, x, y - signOffset - height / 2);
    }
    const x = laneX(player.lane);
    ctx.fillStyle = config.playerShadowColor;
    ctx.beginPath();
    ctx.ellipse(x, config.playerY, config.shadowWidth, config.shadowHeight, 0, 0, Math.PI * 2);
    ctx.fill();
    const jumping = player.action === 'jump';
    const jumpProgress = jumping ? 1 - player.actionRemaining / config.jumpDuration : 0;
    const lift = Math.sin(jumpProgress * Math.PI) * config.jumpHeight;
    ctx.save();
    ctx.translate(x, config.playerY - config.playerSize / 2 - lift);
    if (player.action === 'crouch') {
      ctx.translate(0, config.playerSize * (1 - config.crouchScale) / 2);
      ctx.scale(1, config.crouchScale);
    }
    ctx.font = `${config.playerSize}px system-ui`;
    ctx.fillText(config.playerEmoji, 0, 0);
    ctx.restore();
    if (flashRemaining > 0) {
      ctx.fillStyle = config.flashColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
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
  requestAnimationFrame(frame);
})();

// No browser or dependencies needed: exercise the real game loop with a canvas recorder.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function game(reduceMotion = false, { width = 1280, height = 720, pixelRatio = 1 } = {}) {
  const listeners = {}, elements = new Map(), labels = [];
  const rectangles = [];
  const operations = [];
  let recordRectangles = false;
  const noop = () => {};
  const context = new Proxy({ globalAlpha: 1 }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return (...args) => {
        if (recordRectangles) operations.push([key, ...args]);
        return { addColorStop: noop };
      };
      if (key === 'fillText') return text => labels.push(text);
      if (key === 'fillRect') return (...args) => {
        if (recordRectangles) { rectangles.push(args); operations.push([key, ...args]); }
      };
      return recordRectangles ? (...args) => operations.push([key, ...args]) : noop;
    },
    set(target, key, value) {
      target[key] = value;
      if (recordRectangles) operations.push(['set', key, value]);
      return true;
    },
  });
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      hidden: true, textContent: '', width: 720, height: 300, getContext: () => context,
    });
    return elements.get(id);
  };
  const sandbox = {
    document: { hidden: false, querySelector: element, createElement: () => element('scratch'), addEventListener: noop },
    window: { innerWidth: width, innerHeight: height, devicePixelRatio: pixelRatio, labels,
      addEventListener: (name, handler) => { listeners[name] = handler; },
      matchMedia: () => ({ matches: reduceMotion }),
    },
    requestAnimationFrame: noop,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'config.js'), 'utf8'), sandbox);
  const source = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const marker = '  updateCountdown();\n  requestAnimationFrame(frame);';
  assert.ok(source.includes(marker));
  vm.runInContext(source.replace(marker, `
    const originalBitmapText = bitmapText;
    bitmapText = (context, text, ...args) => { window.labels.push(String(text)); originalBitmapText(context, text, ...args); };
    window.test = { update, draw, restart, finishShopRect, exchangePresentation, project, pixelText, pixelIcon,
      drawObstacle, drawBottle, drawPlayer, rectanglePath, streetOpacity, drawBackdrop,
      geometry: (bounds, vertices) => {
        let result;
        withObjectFrame(bounds, () => { result = vertices.map(([u, v, z]) => volumePoint(bounds, u, v, z)); });
        return result;
      },
      set: values => {
        if ('time' in values) elapsed = values.time;
        if ('pfand' in values) pfand = values.pfand;
        if ('obstacles' in values) obstacles = values.obstacles;
        if ('bottles' in values) bottles = values.bottles;
        if ('crashAt' in values) firstCrashAt = values.crashAt;
      },
      state: () => ({ elapsed, pfand, obstacles, bottles, finished, caught,
        finishPhase, finishElapsed, finishResults, firstCrashAt, crashes,
        lane: player.lane, action: player.action, seed, spawnAt, bottleSpawnAt }),
    };
  `), sandbox);
  const api = sandbox.window.test;
  api.key = (key, repeat = false) => listeners.keydown({ key, repeat, preventDefault: noop });
  api.element = element;
  api.labels = labels;
  api.rectangles = rectangles;
  api.operations = operations;
  api.captureRectangles = () => { recordRectangles = true; rectangles.length = 0; operations.length = 0; };
  api.config = sandbox.window.GAME_CONFIG;
  api.advance = seconds => {
    while (seconds > 1e-9) {
      const dt = Math.min(seconds, api.config.maxFrameSeconds);
      api.update(dt);
      seconds -= dt;
    }
    api.draw();
  };
  return api;
}

test('shop appears at 55s, covers all lanes and reaches player row exactly at 60s', () => {
  const g = game();
  g.set({ time: 54.999 });
  assert.equal(g.finishShopRect(), null);
  let lastWidth = 0;
  for (const time of [55, 56, 57, 58, 59, 60]) {
    g.set({ time });
    const rect = g.finishShopRect();
    assert.ok(rect.width > lastWidth);
    lastWidth = rect.width;
    g.draw();
  }
  const rect = g.finishShopRect();
  assert.equal(rect.bottom, g.project(240, g.config.playerY).y);
  for (let lane = 0; lane < 3; lane++) {
    const x = g.project(g.config.roadLeft + (lane + 0.5) * 132, g.config.playerY).x;
    assert.ok(x > rect.x && x < rect.x + rect.width);
  }
  assert.ok(g.labels.includes('DÖNER'));
});

test('scheduled hazards clear completely before the approach', () => {
  const g = game();
  g.set({ pfand: 30 });
  const types = new Set();
  // An invulnerable empty lane lets the real seeded spawn schedule run to completion.
  // Mark existing hazards as resolved without changing their movement or spawn timing.
  while (g.state().elapsed < 60 && !g.state().finished) {
    for (const obstacle of g.state().obstacles) {
      types.add(obstacle.definition.type);
      obstacle.passed = true;
    }
    g.update(0.05);
    if (g.state().elapsed >= 55) assert.equal(g.state().obstacles.length, 0);
  }
  assert.equal(g.state().elapsed, 60);
  assert.ok(g.state().finished);
  assert.ok(types.has('spaeti'));
});

test('a bottle collected in the last frame is included in the saved exchange', () => {
  const g = game();
  g.set({ time: 59.99, pfand: 14, bottles: [{ lane: 1, y: 589 }] });
  g.update(0.05);
  assert.equal(g.state().finishResults.bottles, 15);
  assert.equal(g.state().finishResults.doener, 1);
  assert.equal(g.state().finishResults.leftoverCents, 0);
});

test('arrival freezes world and controls, prevents toll, then exchanges the saved totals', () => {
  const g = game();
  g.set({ time: 59.99, pfand: 31, crashAt: 59,
    obstacles: [{ lane: 1, y: 589, definition: { type: 'spaeti' } }],
    bottles: [{ lane: 0, y: 300 }] });
  g.update(0.05);
  assert.equal(g.state().elapsed, 60);
  assert.equal(g.state().pfand, 31);
  assert.equal(g.state().firstCrashAt, null);
  assert.equal(g.state().finishPhase, 'arrival');
  const frozen = JSON.stringify(g.state().bottles);
  for (const key of ['ArrowLeft', 'ArrowUp', 'r', 'h', 'x']) g.key(key);
  assert.equal(g.state().lane, 1);
  assert.equal(g.state().action, 'run');
  g.advance(0.31);
  assert.equal(g.state().finishPhase, 'exchange');
  assert.equal(g.element('#finished').hidden, true);
  assert.equal(g.element('#exchange').hidden, false);
  g.key('r');
  assert.equal(g.state().finishPhase, 'exchange');
  g.advance(3);
  const view = g.exchangePresentation();
  assert.equal(view.revealed, 31);
  assert.equal(view.cents, 1550);
  assert.equal(g.element('#exchange-doener').textContent, 'Döner bought: 2 / 2');
  g.advance(0.7);
  assert.equal(g.state().finishPhase, 'results');
  assert.equal(g.state().elapsed, 60);
  assert.equal(JSON.stringify(g.state().bottles), frozen);
  assert.equal(g.element('#result-bottles').textContent, '31');
  assert.equal(g.element('#result-pfand').textContent, '€15.50');
  assert.equal(g.element('#result-doener').textContent, '2');
  assert.match(g.element('#result-leftover').textContent, /^€0.50 /);
});

test('zero bottles bypasses animation; R resets finish state and seeded schedule', () => {
  const g = game(), initial = g.state();
  g.set({ time: 59.99 });
  g.update(0.05);
  assert.equal(g.state().finishPhase, 'results');
  assert.equal(g.element('#finish-message').hidden, false);
  assert.equal(g.element('#exchange').hidden, true);
  assert.equal(g.element('#result-doener').textContent, '0');
  g.draw();
  g.key('R');
  const state = g.state();
  for (const field of ['elapsed', 'pfand', 'crashes', 'seed', 'spawnAt', 'bottleSpawnAt']) {
    assert.equal(state[field], initial[field]);
  }
  assert.equal(state.finishPhase, 'running');
  assert.equal(state.finishElapsed, 0);
  assert.equal(state.finishResults, null);
  assert.equal(g.element('#finished').hidden, true);
  assert.equal(g.finishShopRect(), null);
});

test('all non-R keys skip exchange, including H; held keys do not skip', () => {
  for (const key of ['ArrowLeft', 'h', ' ', 'Shift']) {
    const g = game();
    g.set({ time: 59.99, pfand: 15 });
    g.update(0.05);
    g.advance(0.31);
    g.key(key, true);
    assert.equal(g.state().finishPhase, 'exchange');
    g.key(key);
    assert.equal(g.state().finishPhase, 'results');
    assert.equal(g.element('#result-doener').textContent, '1');
  }
});

test('second crash before arrival still shows caught and can restart', () => {
  const g = game();
  g.set({ time: 50, crashAt: 49,
    obstacles: [{ lane: 1, y: 580, definition: { type: 'scooter', requiredAction: 'jump' } }] });
  g.update(0.05);
  assert.equal(g.state().caught, true);
  assert.equal(g.element('#caught').hidden, false);
  g.advance(15);
  assert.equal(g.state().finished, false);
  g.key('r');
  assert.equal(g.state().caught, false);
  assert.equal(g.state().elapsed, 0);
});

test('small, exact, large and reduced-motion exchanges show the saved results', () => {
  for (const count of [1, 14, 15, 30, 10001]) {
    for (const reduced of [false, true]) {
      const g = game(reduced);
      g.set({ time: 59.99, pfand: count });
      g.update(0.05);
      for (let i = 0; i < 75; i++) g.advance(0.05);
      const result = g.state().finishResults, view = g.exchangePresentation();
      assert.equal(view.revealed, result.bottles);
      assert.equal(view.cents, result.totalCents);
      assert.equal(result.exchangedBottles + result.leftoverBottles, count);
      assert.equal(g.element('#exchange-doener').textContent,
        `Döner bought: ${result.doener} / ${result.doener}`);
      g.advance(0.3);
      assert.equal(g.element('#result-pfand').textContent,
        g.element('#exchange-total').textContent.replace('Total Pfand: ', ''));
    }
  }
});

test('Retina HUD glyphs and icons occupy whole backing pixels at integer scales', () => {
  for (const pixelRatio of [1, 1.25, 2, 3]) {
    const g = game(false, { pixelRatio });
    g.captureRectangles();
    g.pixelText('PFAND RUN €15.50', 13.25, 20.5, 2);
    g.pixelIcon('bottle', 27.3, 40.7, 2);
    assert.ok(g.rectangles.length > 100);
    for (const rectangle of g.rectangles) {
      assert.ok(rectangle.every(Number.isInteger));
      assert.equal(rectangle[2], Math.round(2 * pixelRatio));
      assert.equal(rectangle[3], Math.round(2 * pixelRatio));
    }
  }
});

test('projected sign vertices stay pixel-aligned without reversing on approach', () => {
  for (const pixelRatio of [1, 2, 3]) {
    const g = game(false, { pixelRatio });
    let previous = -Infinity;
    for (let y = -81; y <= 569; y += 0.25) {
      const [top, foot] = g.geometry({ x: 108, y, width: 54, height: 25.2 },
        [[0, 1, 87], [0, 1, 0]]);
      for (const point of [top, foot]) {
        for (const coordinate of [point.x, point.y]) {
          assert.ok(Math.abs(coordinate * pixelRatio - Math.round(coordinate * pixelRatio)) < 1e-9);
        }
      }
      assert.ok(top.y >= previous, `top edge reversed at depth ${y}`);
      previous = top.y;
    }
  }
});

test('HUD uses live score and leaves game state unchanged in portrait and landscape', () => {
  for (const [width, height] of [[390, 844], [844, 390], [1440, 900], [320, 568]]) {
    const g = game(false, { width, height, pixelRatio: 2 });
    g.set({ time: 2, pfand: 31 });
    const before = JSON.stringify(g.state());
    g.draw();
    assert.ok(g.labels.includes('PFAND RUN'));
    assert.ok(g.labels.includes('2'));
    assert.equal(JSON.stringify(g.state()), before);
    g.labels.length = 0;
    g.set({ time: 5 });
    g.draw();
    assert.ok(!g.labels.includes('PFAND RUN'));
    assert.ok(!g.labels.includes('CROUCH'));
    assert.ok(!g.labels.includes('KONTROLLEUR!'));
    assert.ok(!g.labels.some(text => text.startsWith('CRASHES')));
    g.key('h');
    g.draw();
    assert.ok(g.labels.includes('CRASHES 0'));
  }
});

test('passed street objects and their shadows stop drawing without leaving simulation', () => {
  const g = game();
  for (const type of ['sign', 'scooter', 'spaeti', 'bottle']) {
    for (const y of [590, 591, 720, 868.6, 1000]) {
      const object = { lane: 1, y, definition: { type } };
      g.set(type === 'bottle' ? { bottles: [object] } : { obstacles: [object] });
      const before = JSON.stringify(g.state());
      g.captureRectangles();
      if (type === 'bottle') g.drawBottle(object);
      else g.drawObstacle(object);
      assert.equal(g.operations.length, 0, `${type} still drew at ${y}`);
      assert.equal(JSON.stringify(g.state()), before);
    }
  }
  assert.equal(g.streetOpacity(590), 0);
  assert.ok(g.streetOpacity(589) > 0);
});

test('artwork projection is capped and rejects the camera plane and everything behind it', () => {
  const g = game();
  const cameraY = g.config.playerY + (g.config.playerY - g.config.spawnY) *
    g.config.camera.minimumScale / (1 - g.config.camera.minimumScale);
  const playerScale = g.project(240, g.config.playerY).scale;
  assert.equal(g.project(240, cameraY), null);
  assert.equal(g.project(240, cameraY + 100), null);
  assert.ok(Math.abs(g.project(240, cameraY - 0.001).scale - playerScale * 2) < 1e-9);
  assert.ok(g.project(240, cameraY - 0.001, true).scale > playerScale * 2);
});

test('H still draws exact collision boxes after artwork is culled', () => {
  const g = game();
  g.set({ time: 10, obstacles: [{ lane: 1, y: 615, definition: { type: 'scooter' } }] });
  g.key('h');
  g.draw();
  assert.ok(g.labels.includes('OVERLAP YES'));
  g.captureRectangles();
  const bounds = { x: 240, y: 780, width: 63, height: 29.4 };
  g.rectanglePath(bounds);
  const vertex = g.operations.find(operation => operation[0] === 'moveTo');
  const exact = g.project(bounds.x - bounds.width / 2, bounds.y - bounds.height / 2, true);
  assert.equal(vertex[1], exact.x);
  assert.equal(vertex[2], exact.y);
  g.captureRectangles();
  g.rectanglePath({ ...bounds, y: 1000 });
  assert.ok(!g.operations.some(operation => operation[0] === 'moveTo'));
});

test('runner, scooter and bottles have no glow; only the requested signs do', () => {
  for (const type of ['runner', 'scooter', 'bottle', 'sign', 'spaeti']) {
    const g = game();
    g.captureRectangles();
    if (type === 'runner') g.drawPlayer();
    else if (type === 'bottle') g.drawBottle({ lane: 1, y: 500 });
    else g.drawObstacle({ lane: 1, y: 500, definition: { type } });
    const glowing = g.operations.some(operation => operation[0] === 'set' &&
      operation[1] === 'shadowBlur' && operation[2] > 0);
    assert.equal(glowing, type === 'sign' || type === 'spaeti', type);
    if (type === 'runner' || type === 'scooter') {
      assert.ok(g.operations.some(operation => operation[0] === 'createRadialGradient'));
    }
  }
});

test('all four backdrop phases render with bounded work, cached gradients and no game-state changes', () => {
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const g = game(false, { width, height, pixelRatio: 2 });
    for (const time of [0, 15, 16, 30, 31, 45, 46, 60]) {
      g.set({ time });
      const before = JSON.stringify(g.state());
      g.captureRectangles();
      g.drawBackdrop();
      assert.equal(JSON.stringify(g.state()), before);
      assert.ok(g.operations.length < 1000);
      assert.equal(g.operations.filter(operation => operation[0] === 'createLinearGradient').length,
        time === 0 ? 2 : 0);
      for (const operation of g.operations) {
        assert.ok(operation.filter(value => typeof value === 'number').every(Number.isFinite));
      }
    }
  }
});

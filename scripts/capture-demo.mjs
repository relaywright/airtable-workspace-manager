/**
 * Record the real Electron app using only its fictional Cedar & Pine Goods data.
 * Usage: npm run capture:demo
 * Outputs: artifacts/demo-capture/workspace-manager-demo.mp4, manifest.json,
 *          and docs/demo.webp (an endlessly looping README animation, <= 6 MB).
 * Requirements: Node 22+, installed project dependencies, a desktop session,
 *               ffmpeg on PATH with libx264/libwebp, and ffprobe on PATH.
 * An isolated temporary profile protects existing settings and tokens. If CDP
 * produces fewer than 50 frames, replay the story in another fresh profile
 * while polling screenshots. Only a Vite process started here is terminated.
 */
import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright-core');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(REPO_ROOT, 'artifacts', 'demo-capture');
const SERVER_URL = 'http://localhost:5174';
const VIEWPORT = { width: 1280, height: 800 };
const DPR = 1.25;
const MAX_WEBP_BYTES = 6_000_000;
const cancellation = new AbortController();

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function sleep(ms) {
  return delay(Math.max(0, ms), undefined, { signal: cancellation.signal });
}

// CDP calls through Playwright have no timeout, so a hung renderer would stall cleanup forever.
function withDeadline(promise, ms, description) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${description} did not finish within ${ms / 1000} seconds.`)),
      ms,
    );
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

async function until(check, description, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  do {
    cancellation.signal.throwIfAborted();
    const result = await check();
    if (result) return result;
    await sleep(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${description} (${timeout / 1000}s).`);
}

function run(command, args, { signal = cancellation.signal } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { cwd: REPO_ROOT, windowsHide: true, signal: signal ?? undefined });
    } catch (error) {
      reject(
        new Error(
          `Cannot launch ${command} (${error.code}): ${error.message}. Check PATH and run npm run capture:demo from a desktop terminal that permits child processes.`,
        ),
      );
      return;
    }
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      errors = (errors + chunk).slice(-12_000);
    });
    child.once('error', (error) => reject(new Error(`Cannot run ${command}: ${error.message}`)));
    child.once('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} exited with code ${code}.\n${errors}`));
    });
  });
}

async function responds() {
  try {
    const response = await fetch(SERVER_URL, { signal: AbortSignal.timeout(1500) });
    await response.body?.cancel();
    return response.status === 200;
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'TypeError') return false;
    throw error;
  }
}

async function killTree(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await run('taskkill', ['/pid', String(child.pid), '/T', '/F'], { signal: null });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    await delay(300);
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}

async function ensureVite(resources) {
  if (await responds()) {
    log('Reusing the server on port 5174; it will be left running.');
    return;
  }
  log('Starting Vite on port 5174.');
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'node_modules/vite/bin/vite.js')], {
    cwd: REPO_ROOT,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  resources.vite = child;
  let diagnostics = '';
  let spawnError;
  child.on('error', (error) => {
    spawnError = error;
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      diagnostics = (diagnostics + chunk).slice(-4000);
    });
  }
  await until(
    async () => {
      if (spawnError || child.exitCode !== null) {
        throw new Error(`Vite could not start: ${spawnError?.message || diagnostics}`);
      }
      return responds();
    },
    `Vite HTTP 200 on ${SERVER_URL}`,
    60_000,
  );
}

async function openApp(resources) {
  const profile = await mkdtemp(path.join(resources.temp, 'profile-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  log('Launching Electron with a fresh temporary profile.');
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: [REPO_ROOT, `--user-data-dir=${profile}`, '--force-device-scale-factor=1.25'],
    cwd: REPO_ROOT,
    env,
    timeout: 30_000,
  });
  resources.app = app;
  const actualProfile = await app.evaluate(({ app }) => app.getPath('userData'));
  if (actualProfile !== profile) {
    throw new Error(`Profile isolation failed: expected ${profile}, received ${actualProfile}. Aborting.`);
  }
  // In development the app also opens a DevTools window, which Playwright reports as a page too.
  const isAppPage = (candidate) => candidate.url().startsWith(SERVER_URL);
  await until(() => app.windows().some(isAppPage), `a window showing ${SERVER_URL}`, 15_000);
  const page = app.windows().find(isAppPage);
  page.setDefaultTimeout(15_000);
  await page.waitForLoadState('domcontentloaded');
  const setContentSize = (size) =>
    app.evaluate(({ BrowserWindow }, { width, height }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.webContents.closeDevTools();
      window.setContentSize(width, height);
      window.center();
      window.show();
      window.focus();
    }, size);
  const dimensions = () =>
    page.evaluate(() => ({
      width: globalThis.innerWidth,
      height: globalThis.innerHeight,
      dpr: globalThis.devicePixelRatio,
    }));
  // When the forced scale factor differs from the display's own scaling, Windows rounds the
  // requested size and the page can land a few pixels off. Measure and correct a few times.
  const requested = { ...VIEWPORT };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await setContentSize(requested);
    await sleep(250);
    const actual = await dimensions();
    if (actual.width === VIEWPORT.width && actual.height === VIEWPORT.height) break;
    requested.width += VIEWPORT.width - actual.width;
    requested.height += VIEWPORT.height - actual.height;
  }
  try {
    await until(
      async () => {
        const size = await dimensions();
        return size.width === VIEWPORT.width && size.height === VIEWPORT.height && size.dpr === DPR;
      },
      '1280 x 800 content size at DPR 1.25',
      5000,
    );
  } catch (error) {
    throw new Error(
      `${error.message} Actual: ${JSON.stringify(await dimensions())}. Check desktop scaling and available screen space.`,
    );
  }
  await page.getByRole('button', { name: 'Try with sample data', exact: true }).waitFor();
  return page;
}

async function closeApp(resources) {
  if (!resources.app) return;
  const app = resources.app;
  resources.app = null;
  const child = app.process();
  try {
    await Promise.race([
      app.close(),
      delay(8000).then(() => {
        throw new Error('Electron did not close within 8 seconds.');
      }),
    ]);
  } finally {
    await killTree(child);
  }
}

async function installCursor(page) {
  await page.evaluate(() => {
    const cursor = globalThis.document.createElement('div');
    cursor.id = 'demo-recording-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    cursor.style.cssText =
      'position:fixed;left:0;top:0;width:22px;height:28px;pointer-events:none;z-index:2147483647;transform:translate(420px,240px);filter:drop-shadow(0 2px 3px #0009)';
    cursor.innerHTML =
      '<svg width="22" height="28" viewBox="0 0 22 28"><path d="M2 2 L2 22 L7.5 17 L12 26 L16 24 L11.5 15 L20 15 Z" fill="white" stroke="#303642" stroke-width="1.2" stroke-linejoin="round"/></svg>';
    globalThis.document.body.append(cursor);
  });
  let position = { x: 420, y: 240 };
  await page.mouse.move(position.x, position.y);

  async function moveTo(target, duration = 650) {
    let point = target;
    if (typeof target.boundingBox === 'function') {
      await target.waitFor({ state: 'visible' });
      const box = await target.boundingBox();
      if (!box) throw new Error('Cannot locate the cursor destination.');
      point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    if (point.x < 0 || point.x >= VIEWPORT.width || point.y < 0 || point.y >= VIEWPORT.height) {
      throw new Error(`Cursor target is outside the viewport: ${JSON.stringify(point)}`);
    }
    const start = { ...position };
    const started = Date.now();
    for (let step = 1; step <= 24; step++) {
      const t = step / 24;
      const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
      position = { x: start.x + (point.x - start.x) * eased, y: start.y + (point.y - start.y) * eased };
      await page.mouse.move(position.x, position.y);
      await page.evaluate(({ x, y }) => {
        globalThis.document.getElementById('demo-recording-cursor').style.transform =
          `translate(${x}px,${y}px)`;
      }, position);
      await sleep(started + duration * t - Date.now());
    }
  }

  async function clickAt(target) {
    await moveTo(target);
    await page.evaluate(({ x, y }) => {
      const ring = globalThis.document.createElement('div');
      ring.setAttribute('aria-hidden', 'true');
      ring.style.cssText = `position:fixed;left:${x - 9}px;top:${y - 9}px;width:18px;height:18px;border:2px solid #fff;border-radius:50%;pointer-events:none;z-index:2147483646;box-sizing:border-box`;
      globalThis.document.body.append(ring);
      const animation = ring.animate(
        [
          { transform: 'scale(0.5)', opacity: 0.9 },
          { transform: 'scale(2.8)', opacity: 0 },
        ],
        { duration: 400, easing: 'ease-out' },
      );
      animation.onfinish = () => ring.remove();
    }, position);
    await page.mouse.click(position.x, position.y);
  }

  // Scroll via the real mouse wheel, keeping the app's existing scroll behavior.
  async function reveal(locator) {
    await locator.waitFor({ state: 'visible' });
    for (let attempt = 0; attempt < 6; attempt++) {
      const scroll = await locator.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const overflow = globalThis.getComputedStyle(parent).overflowY;
          if (!/auto|scroll/.test(overflow) || parent.scrollHeight <= parent.clientHeight) continue;
          const clip = parent.getBoundingClientRect();
          if (bounds.top >= clip.top + 12 && bounds.bottom <= clip.bottom - 12) continue;
          return {
            x: clip.x + clip.width / 2,
            y: clip.y + clip.height / 2,
            delta: bounds.y + bounds.height / 2 - (clip.y + clip.height / 2),
          };
        }
        return null;
      });
      if (!scroll) return;
      await moveTo(scroll, 500);
      for (let step = 0; step < 12; step++) {
        await page.mouse.wheel(0, scroll.delta / 12);
        await sleep(40);
      }
    }
    throw new Error(`Could not scroll the requested control into view: ${locator}`);
  }
  return { moveTo, clickAt, reveal };
}

// WorkspaceMap.jsx uses base.id for node IDs and base.name for data('label').
// Read Cytoscape's own container registration; no application instrumentation.
async function graphState(page) {
  return page.evaluate(() => {
    const container = [...globalThis.document.querySelectorAll('main div')].find((el) => el._cyreg?.cy);
    if (!container) return null;
    const cy = container._cyreg.cy;
    const bounds = container.getBoundingClientRect();
    return {
      animated: cy.animated() || cy.nodes().some((node) => node.animated()),
      nodes: cy.nodes().map((node) => {
        const point = node.renderedPosition();
        return { id: node.id(), label: node.data('label'), x: bounds.x + point.x, y: bounds.y + point.y };
      }),
    };
  });
}

async function stableMap(page) {
  let previous;
  let stableSince;
  return until(async () => {
    const current = await graphState(page);
    if (!current || current.nodes.length !== 15) return false;
    const stable =
      !current.animated &&
      previous?.nodes.length === current.nodes.length &&
      current.nodes.every(
        (node, i) => Math.hypot(node.x - previous.nodes[i].x, node.y - previous.nodes[i].y) < 0.3,
      );
    stableSince = stable ? stableSince || Date.now() : null;
    previous = current;
    return stableSince && Date.now() - stableSince >= 400 ? current : false;
  }, 'all 15 sample bases to finish laying out');
}

async function startCapture(app, page, directory, mode) {
  await mkdir(directory);
  const frames = [];
  const pending = new Set();
  const errors = [];
  let active = true;
  let session;
  let loop;
  let handler;
  // CDP TimeSinceEpoch is seconds on the renderer's wall clock. Calibrate it
  // against Node's Date.now marks using the midpoint of a round trip.
  const before = Date.now();
  const browserNow = await page.evaluate(() => Date.now());
  const clockOffset = browserNow - (before + Date.now()) / 2;

  function save(data, timestamp) {
    const file = `frame-${String(frames.length).padStart(6, '0')}.jpg`;
    frames.push({ file, timestamp, wallTime: timestamp * 1000 - clockOffset });
    const writing = writeFile(path.join(directory, file), data).catch((error) => {
      errors.push(error);
    });
    pending.add(writing);
    void writing.finally(() => pending.delete(writing));
  }

  if (mode === 'screencast') {
    session = await app.context().newCDPSession(page);
    handler = ({ data, metadata, sessionId }) => {
      const ack = session.send('Page.screencastFrameAck', { sessionId }).catch((error) => {
        errors.push(error);
      });
      pending.add(ack);
      void ack.finally(() => pending.delete(ack));
      if (active && Number.isFinite(metadata.timestamp))
        save(Buffer.from(data, 'base64'), metadata.timestamp);
    };
    session.on('Page.screencastFrame', handler);
    await session.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 92,
      everyNthFrame: 1,
      maxWidth: 1600,
      maxHeight: 1000,
    });
  } else {
    loop = (async () => {
      while (active) {
        const started = Date.now();
        const data = await page.screenshot({ type: 'jpeg', quality: 92, scale: 'device', timeout: 5000 });
        save(data, ((started + Date.now()) / 2 + clockOffset) / 1000);
        await sleep(70 - (Date.now() - started));
      }
    })().catch((error) => {
      errors.push(error);
    });
  }

  return {
    frames,
    async stop() {
      try {
        if (session) await withDeadline(session.send('Page.stopScreencast'), 5000, 'Stopping the screencast');
      } finally {
        active = false;
        if (session) session.off('Page.screencastFrame', handler);
        if (loop) await loop;
        await withDeadline(Promise.all([...pending]), 5000, 'Saving the last frames');
        if (session) await withDeadline(session.detach(), 5000, 'Detaching from the app window');
      }
      if (errors.length) throw new AggregateError(errors, 'Frame capture failed.');
      frames.sort((a, b) => a.timestamp - b.timestamp);
    },
  };
}

async function storyboard(page, cursor) {
  const marks = [];
  const beginning = Date.now();
  const mark = (name) => {
    marks.push({ name, time: Date.now() });
    log(`Scene: ${name}`);
  };
  const finishScene = async (targetSeconds, minimumHold, drift) => {
    const started = Date.now();
    if (drift) await cursor.moveTo(drift, 800);
    await sleep(Math.max(beginning + targetSeconds * 1000, started + minimumHold) - Date.now());
  };
  mark('setup');
  await sleep(900);
  await cursor.clickAt(page.getByRole('button', { name: 'Try with sample data', exact: true }));
  await page.getByText("You're viewing sample data from a fictional company.", { exact: true }).waitFor();
  await finishScene(2.5, 0);

  mark('map');
  await stableMap(page);
  await finishScene(6, 2000, { x: 720, y: 680 });

  mark('detail');
  const graph = await stableMap(page);
  const product = graph.nodes.find((node) => node.label === 'Product Catalog');
  if (!product) throw new Error('The sample map has no Product Catalog node.');
  await cursor.clickAt(product);
  const panel = page
    .getByRole('complementary')
    .filter({ has: page.getByRole('heading', { name: 'Product Catalog', exact: true }) });
  await panel.getByRole('heading', { name: /^Tables \(/ }).waitFor();
  await stableMap(page);
  await cursor.reveal(panel.getByText('Products', { exact: true }));
  await finishScene(10.5, 2500);

  mark('impact');
  // ImpactPanel is expanded by default, below the tables and connections.
  // Reveal its existing contents instead of toggling them closed on camera.
  await cursor.reveal(panel.getByText(/^Depended on by \(\d+\)$/));
  await panel.getByRole('button', { name: 'Impact Analysis', exact: true }).waitFor();
  await finishScene(14.5, 2500);

  mark('changelog');
  await cursor.clickAt(panel.getByRole('button', { name: 'Close panel', exact: true }));
  await panel.waitFor({ state: 'hidden' });
  await cursor.clickAt(page.getByRole('button', { name: 'Change Log', exact: true }));
  await page.getByRole('heading', { name: 'Change Log', exact: true }).waitFor();
  const snapshot = page.getByRole('button', { name: /^Product Catalog Schema snapshot at/ }).first();
  await cursor.reveal(snapshot);
  await cursor.clickAt(snapshot);
  const added = page.getByText(/^\+1 field:/);
  await added.waitFor();
  await page.getByText(/^~1 field changed:/).waitFor();
  await page.getByText('~ Products', { exact: true }).waitFor();
  await cursor.reveal(added);
  await finishScene(19, 2500);

  mark('return');
  await cursor.clickAt(page.getByRole('button', { name: 'Close', exact: true }));
  await page.getByRole('heading', { name: 'Change Log', exact: true }).waitFor({ state: 'hidden' });
  await cursor.clickAt(page.getByRole('button', { name: 'Fit to view', exact: true }));
  await stableMap(page);
  await finishScene(21.5, 1500, { x: 720, y: 680 });
  // Force a final changed frame after the still hold; concat then holds it 0.5s.
  await cursor.moveTo({ x: 722, y: 680 }, 100);
  return marks;
}

async function record(resources, mode) {
  const page = await openApp(resources);
  const cursor = await installCursor(page);
  await cursor.reveal(page.getByRole('button', { name: 'Try with sample data', exact: true }));
  const directory = path.join(resources.temp, mode);
  let capture;
  let marks;
  try {
    capture = await startCapture(resources.app, page, directory, mode);
    if (mode === 'screenshots') await until(() => capture.frames.length, 'first screenshot');
    // Cursor movement also triggers CDP's initial frame on idle windows.
    await cursor.moveTo({ x: 422, y: 240 }, 100);
    marks = await storyboard(page, cursor);
    await sleep(100);
  } finally {
    try {
      if (capture) await capture.stop();
    } finally {
      await closeApp(resources);
    }
  }
  log(`Captured ${capture.frames.length} frames using ${mode}.`);
  return { frames: capture.frames, marks, directory, mode };
}

async function encode(recording, temp, version) {
  const { frames, marks, directory, mode } = recording;
  if (frames.length < 50) throw new Error(`Only ${frames.length} frames were captured, even after fallback.`);
  const first = frames[0];
  const last = frames.at(-1);
  const frameProbe = JSON.parse(
    await run('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=width,height',
      '-of',
      'json',
      path.join(directory, first.file),
    ]),
  );
  if (frameProbe.streams[0]?.width !== 1600 || frameProbe.streams[0]?.height !== 1000) {
    throw new Error(
      `Captured frames must be 1600 x 1000 physical pixels; received ${JSON.stringify(frameProbe.streams[0])}. Check desktop scaling.`,
    );
  }
  const duration = last.timestamp - first.timestamp + 0.5;
  // Relative, generated filenames avoid ffconcat quoting pitfalls on Windows.
  const lines = ['ffconcat version 1.0'];
  for (const [i, frame] of frames.entries()) {
    const gap = i === frames.length - 1 ? 0.5 : frames[i + 1].timestamp - frame.timestamp;
    lines.push(
      `file '${frame.file}'`,
      'option framerate 1000',
      `duration ${Math.max(0.001, gap).toFixed(6)}`,
    );
  }
  // Concat needs a repeated final file for the preceding duration to take effect.
  lines.push(`file '${last.file}'`, 'option framerate 1000');
  const concat = path.join(directory, 'frames.ffconcat');
  await writeFile(concat, `${lines.join('\n')}\n`);
  const mp4 = path.join(temp, 'workspace-manager-demo.mp4');
  log(`Encoding ${duration.toFixed(2)}s MP4 at 1600 x 1000.`);
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concat,
    '-t',
    duration.toFixed(6),
    '-vf',
    'fps=30,scale=1600:1000:flags=lanczos,format=yuv420p',
    '-c:v',
    'libx264',
    '-crf',
    '16',
    '-preset',
    'slow',
    '-movflags',
    '+faststart',
    '-an',
    mp4,
  ]);
  const probe = JSON.parse(
    await run('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=width,height',
      '-of',
      'json',
      mp4,
    ]),
  );
  const encodedDuration = Number(probe.format.duration);
  if (
    probe.streams[0].width !== 1600 ||
    probe.streams[0].height !== 1000 ||
    !Number.isFinite(encodedDuration)
  ) {
    throw new Error('Encoded MP4 has unexpected dimensions or duration.');
  }
  const webp = path.join(temp, 'demo.webp');
  let webpBytes;
  let settings;
  for (const [quality, fps] of [
    [60, 12],
    [50, 12],
    [50, 10],
    // A slow machine stretches the tour (34s instead of 25s once); fewer frames keeps text sharp.
    [50, 8],
  ]) {
    log(`Encoding README WebP: quality ${quality}, ${fps} fps.`);
    await run('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      mp4,
      '-vf',
      `fps=${fps},scale=960:-2:flags=lanczos`,
      '-c:v',
      'libwebp',
      '-lossless',
      '0',
      '-quality',
      String(quality),
      '-compression_level',
      '6',
      '-loop',
      '0',
      '-an',
      webp,
    ]);
    webpBytes = (await stat(webp)).size;
    settings = { quality, fps };
    log(`WebP size: ${(webpBytes / 1_000_000).toFixed(2)} MB.`);
    if (webpBytes <= MAX_WEBP_BYTES) break;
  }
  // Preserve the MP4 even if the requested WebP limit cannot be met.
  await mkdir(OUTPUT, { recursive: true });
  await copyFile(mp4, path.join(OUTPUT, 'workspace-manager-demo.mp4'));
  const seconds = (time) => Math.max(0, Math.min(encodedDuration, (time - first.wallTime) / 1000));
  const scenes = marks.map((mark, i) => ({
    name: mark.name,
    start: i === 0 ? 0 : Number(seconds(mark.time).toFixed(3)),
    end: i === marks.length - 1 ? encodedDuration : Number(seconds(marks[i + 1].time).toFixed(3)),
  }));
  const manifest = {
    capturedAt: new Date(first.wallTime).toISOString(),
    appVersion: version,
    viewport: VIEWPORT,
    dpr: DPR,
    frameSize: { width: 1600, height: 1000 },
    duration: encodedDuration,
    frameCount: frames.length,
    captureMethod: mode,
    webp: { ...settings, bytes: webpBytes, withinLimit: webpBytes <= MAX_WEBP_BYTES },
    scenes,
  };
  await writeFile(path.join(OUTPUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (webpBytes > MAX_WEBP_BYTES) {
    throw new Error(
      `README WebP is ${(webpBytes / 1_000_000).toFixed(2)} MB after quality 60/50 and 12/10/8 fps retries (limit 6 MB). MP4 and manifest saved; docs/demo.webp was not replaced.`,
    );
  }
  await mkdir(path.join(REPO_ROOT, 'docs'), { recursive: true });
  await copyFile(webp, path.join(REPO_ROOT, 'docs', 'demo.webp'));
  log(`Done: ${frames.length} frames; ffprobe duration ${encodedDuration}s; WebP ${webpBytes} bytes.`);
  console.log(JSON.stringify(scenes, null, 2));
}

// Playwright installs its own Ctrl+C handler for Electron (not configurable) that closes the app
// and then exits the process, before main()'s finally block can run. This synchronous last pass
// still stops a Vite started here and removes the temporary profile and frames.
function cleanupOnExit(resources) {
  const vite = resources.vite;
  if (vite?.pid && vite.exitCode === null && vite.signalCode === null) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(vite.pid), '/T', '/F'], { windowsHide: true });
    } else {
      try {
        process.kill(-vite.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') console.error(`Could not stop Vite: ${error.message}`);
      }
    }
  }
  if (!resources.temp) return;
  try {
    rmSync(resources.temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch (error) {
    console.error(`Could not remove ${resources.temp}: ${error.message}`);
  }
}

async function main() {
  const resources = {};
  const errors = [];
  const interrupt = () => cancellation.abort(new Error('Capture interrupted; cleaning up.'));
  const onExit = () => cleanupOnExit(resources);
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  process.once('exit', onExit);
  try {
    const encoders = await run('ffmpeg', ['-hide_banner', '-encoders']);
    if (!/\blibx264\b/.test(encoders) || !/\blibwebp\b/.test(encoders)) {
      throw new Error('ffmpeg must include the libx264 and libwebp encoders.');
    }
    await run('ffprobe', ['-version']);
    const { version } = JSON.parse(await readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    resources.temp = await mkdtemp(path.join(os.tmpdir(), 'workspace-manager-demo-'));
    await ensureVite(resources);
    let recording = await record(resources, 'screencast');
    if (recording.frames.length < 50) {
      log('CDP emitted fewer than 50 frames. Replaying in a fresh profile with screenshot polling.');
      recording = await record(resources, 'screenshots');
    }
    await encode(recording, resources.temp, version);
  } catch (error) {
    errors.push(error);
  } finally {
    for (const cleanup of [
      () => closeApp(resources),
      () => killTree(resources.vite),
      () =>
        resources.temp &&
        rm(resources.temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
        log(`Cleanup failed: ${error.message}`);
      }
    }
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    process.removeListener('exit', onExit);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, errors.map((error) => error.message).join('\n'));
}

main().catch((error) => {
  console.error(`Demo capture failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});

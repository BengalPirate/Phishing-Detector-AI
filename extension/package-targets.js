/**
 * Generates per-browser builds from the single Chrome/Edge manifest.
 *
 * Output (each a loadable, self-contained extension folder):
 *   build/chrome/   - Chrome & Edge (side panel)        [base manifest, unchanged]
 *   build/firefox/  - Firefox (native sidebar)          [sidebar_action + gecko id]
 *   build/safari/   - Safari (popup; convert w/ Xcode)  [action.default_popup]
 *
 * Run `npm run build` first (produces dist/sidepanel.bundle.js), then this.
 */
import { promises as fs } from 'fs';
import path from 'path';

const ROOT = path.resolve('.');
const OUT = path.join(ROOT, 'build');

// Files every target needs (relative to the extension root).
const SHARED = [
  'sidepanel.html',
  'sidepanel.css',
  'dist', // includes the bundled sidepanel + background (dist/background.js)
  'assets',
  'icons',
];

async function rmrf(p) {
  await fs.rm(p, { recursive: true, force: true });
}

async function copy(src, dest) {
  // Skip dev-only sourcemaps in packaged builds (they're large and unneeded).
  if (src.endsWith('.map')) return;
  const stat = await fs.stat(src);
  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    for (const entry of await fs.readdir(src)) {
      await copy(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
  }
}

function firefoxManifest(base) {
  const m = structuredClone(base);
  delete m.minimum_chrome_version;
  delete m.side_panel;
  m.permissions = (m.permissions || []).filter((p) => p !== 'sidePanel');
  m.background = { scripts: ['dist/background.js'] }; // Firefox MV3 uses an event page
  m.sidebar_action = {
    default_panel: 'sidepanel.html',
    default_title: 'Phishing Detector AI',
    default_icon: base.icons,
  };
  m.browser_specific_settings = {
    gecko: { id: 'phishing-detector@brandonnewtondev', strict_min_version: '121.0' },
  };
  return m;
}

function safariManifest(base) {
  const m = structuredClone(base);
  delete m.minimum_chrome_version;
  delete m.side_panel;
  m.permissions = (m.permissions || []).filter((p) => p !== 'sidePanel');
  m.action = { ...(m.action || {}), default_popup: 'sidepanel.html' };
  return m;
}

const TARGETS = {
  chrome: (base) => base, // Chrome + Edge use the base manifest unchanged
  firefox: firefoxManifest,
  safari: safariManifest,
};

async function main() {
  const base = JSON.parse(await fs.readFile(path.join(ROOT, 'manifest.json'), 'utf8'));

  // Ensure the bundle exists.
  try {
    await fs.access(path.join(ROOT, 'dist', 'sidepanel.bundle.js'));
  } catch {
    throw new Error('dist/sidepanel.bundle.js missing — run `npm run build` first.');
  }

  await rmrf(OUT);
  for (const [name, transform] of Object.entries(TARGETS)) {
    const dir = path.join(OUT, name);
    await fs.mkdir(dir, { recursive: true });
    for (const f of SHARED) {
      await copy(path.join(ROOT, f), path.join(dir, f));
    }
    const manifest = transform(base);
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`✅ build/${name}/`);
  }
  console.log('\nChrome & Edge: load build/chrome/');
  console.log('Firefox:       load build/firefox/ (about:debugging)');
  console.log('Safari:        convert build/safari/ with safari-web-extension-converter');
}

main().catch((err) => {
  console.error('✘', err.message);
  process.exit(1);
});

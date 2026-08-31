/**
 * Stylesheet test -- plain Node, no framework, no dependencies.
 *
 *   node test/styles.test.js
 *
 * These assertions exist because of a real bug: `.panel { display: flex }` is
 * an author-origin rule, and the UA stylesheet's `[hidden] { display: none }`
 * is user-agent origin, so the author rule won regardless of specificity.
 * `panel.hidden = true` therefore never hid anything -- the panel stayed over
 * the running game and swallowed every tap, so PLAY and START looked dead.
 *
 * The flow test cannot catch this: it drives a DOM stub with no cascade, where
 * setting .hidden is by definition effective. The cascade has to be asserted
 * against the stylesheet itself.
 */

import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles/main.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ''}`);
  }
}

/** Body of the first rule whose selector matches exactly. */
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return match ? match[2] : null;
}

console.log('styles\n');

// --- the bug itself
{
  const body = ruleBody('[hidden]');
  check('the stylesheet overrides the hidden attribute', body !== null);
  check(
    'the override sets display: none',
    body !== null && /display\s*:\s*none/.test(body),
    String(body)
  );
  check(
    'the override is !important, so no author display rule can beat it',
    body !== null && /display\s*:\s*none\s*!important/.test(body),
    String(body)
  );
}

// Keeps the assertions above meaningful: if .panel ever stops setting display,
// the override is no longer load-bearing and this test should be revisited.
{
  const body = ruleBody('.panel');
  check('.panel still sets display, so the override is still needed', body !== null && /display\s*:/.test(body), String(body));
}

// Every element the app toggles with .hidden must be covered.
{
  const hiddenIds = [...html.matchAll(/id="([^"]+)"[^>]*\shidden/g)].map((m) => m[1]);
  check(
    'the elements marked hidden in the markup are the ones the panel toggles',
    hiddenIds.includes('panel') && hiddenIds.includes('panel-note') && hiddenIds.includes('panel-footer'),
    JSON.stringify(hiddenIds)
  );
}

// --- the panel must not let the game read through it
{
  const body = ruleBody('.panel');
  const background = body && body.match(/background\s*:\s*([^;]+);/);
  check('the panel declares a background', background !== null, String(body));
  check(
    'the panel background is opaque',
    background !== null &&
      !/transparent|rgba\s*\([^)]*,\s*0?\.\d+\s*\)|color-mix/.test(background[1]),
    background ? background[1].trim() : ''
  );
}

// --- tap targets
{
  const body = ruleBody('.btn');
  check(
    'buttons meet the 44px minimum tap target',
    body !== null && /min-height\s*:\s*2\.75rem/.test(body),
    String(body)
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

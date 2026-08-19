// The branding maths. Two things here are worth guarding: a hex parser that must reject typos
// instead of silently colouring the header black, and the black-or-white decision for the band —
// "white on the brand colour" is the default assumption and it is wrong for every light brand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bandContrast, dataUri, mimeFor, parseColor, readableOn } from '../dist/render/brand.js';

test('hex colours are normalised, typos are rejected', () => {
  assert.equal(parseColor('#0A5C9E'), '#0a5c9e');
  assert.equal(parseColor('0a5c9e'), '#0a5c9e');
  assert.equal(parseColor('#abc'), '#aabbcc');
  for (const bad of ['blue', '#12', '#12345', 'rgb(1,2,3)', '', '#gggggg']) {
    assert.throws(() => parseColor(bad), /brand-color/, `accepted "${bad}"`);
  }
});

test('the header ink follows how light the colour LOOKS', () => {
  // Ratio-maximising disagrees with the obvious answer on saturated mid-tones; these are the cases
  // that decided the rule, so they are the cases that guard it.
  const expected = {
    '#ea6212': '#ffffff',   // saturated orange — dark scores 5.6:1, white 3.4:1, and white is right
    '#00a0a8': '#ffffff',   // same shape: saturated, mid lightness
    '#0a5c9e': '#ffffff',
    '#742774': '#ffffff',
    '#d03b3b': '#ffffff',
    '#1e2428': '#ffffff',
    '#576168': '#ffffff',
    '#ffd400': '#111111',   // yellow is genuinely light
    '#f7b500': '#111111',
    '#e8e8e8': '#111111',
    '#ffffff': '#111111',
    '#999999': '#111111',   // a neutral at the same lightness as the orange, but white reads 2.85:1
  };
  for (const [color, ink] of Object.entries(expected)) {
    assert.equal(readableOn(color), ink, `${color} (${bandContrast(color).toFixed(2)}:1)`);
  }
});

test('the ink never falls below 3:1 while the other one would have cleared it', () => {
  for (let r = 0; r < 256; r += 17) {
    for (let g = 0; g < 256; g += 17) {
      for (let b = 0; b < 256; b += 17) {
        const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
        const picked = readableOn(hex);
        const other = picked === '#ffffff' ? '#111111' : '#ffffff';
        const mine = bandContrast(hex);
        const theirs = contrastWith(hex, other);
        assert.ok(mine >= 3 || theirs < 3,
          `${hex}: picked ${picked} at ${mine.toFixed(2)}:1 while ${other} would have given ${theirs.toFixed(2)}:1`);
      }
    }
  }
});

test('a logo becomes a self-contained data URI', () => {
  assert.equal(mimeFor('logo.svg'), 'image/svg+xml');
  assert.equal(mimeFor('brand.PNG'), 'image/png');
  assert.equal(mimeFor('image/png;charset=binary'), 'image/png');
  assert.equal(mimeFor('logo.txt'), null, 'an unknown extension must not be guessed');
  assert.equal(dataUri(new Uint8Array([104, 105]), 'image/png'), 'data:image/png;base64,aGk=');
});

/** The WCAG formula written out here, so the test is not just the implementation repeated. */
function contrastWith(a, b) {
  const lum = (hex) => {
    const parts = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

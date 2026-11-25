import { test } from 'node:test';
import assert from 'node:assert/strict';
import { squareSlice } from '../public/cross-section-lesson.js';

test('a section stays perpendicular to x and its profile has the area used to check the prediction', () => {
  for (const x of [0, 0.25, 1.5, 2, 3]) {
    const { corners, side, area } = squareSlice(x);
    assert.ok(corners.every(point => point[0] === x));
    assert.equal(Math.min(...corners.map(p => p[1])), 0);
    assert.equal(Math.max(...corners.map(p => p[1])), 1 + x);
    // Shoelace area of the polygon drawn in the yz plane.
    let twiceArea = 0;
    for (const [i, [, y, z]] of corners.entries()) {
      const [, v, w] = corners[(i + 1) % corners.length];
      assert.equal(Math.hypot(v - y, w - z), side);
      twiceArea += y * w - v * z;
    }
    assert.equal(Math.abs(twiceArea) / 2, area);
  }
  assert.equal(squareSlice(2).area, 9);
});

test('slice areas reconstruct the volume shown in the worked explanation', () => {
  // Simpson's rule is exact for a quadratic area function.
  const volume = (3 / 6) * (squareSlice(0).area + 4 * squareSlice(1.5).area + squareSlice(3).area);
  assert.equal(volume, 21);
});

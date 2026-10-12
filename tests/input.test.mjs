import test from 'node:test';
import assert from 'node:assert/strict';
import { InputManager, applyDeadzone, PAD } from '../src/input/Input.js';

function fakePad(buttons = {}, axes = [0, 0]) {
  const b = [];
  for (let i = 0; i < 17; i++) b.push({ pressed: !!buttons[i], value: buttons[i] ? 1 : 0 });
  return { connected: true, id: 'Xbox Controller (STANDARD GAMEPAD)', buttons: b, axes, mapping: 'standard' };
}

test('deadzone rescales stick input', () => {
  assert.equal(applyDeadzone(0.1), 0);
  assert.equal(applyDeadzone(1), 1);
  assert.equal(applyDeadzone(-1), -1);
  assert.ok(applyDeadzone(0.5) > 0 && applyDeadzone(0.5) < 0.5);
});

test('gamepad buttons map to actions with edge detection', () => {
  const im = new InputManager();
  let pad = fakePad({ [PAD.A]: true, [PAD.X]: true }, [0.9, 0]);
  im.getPad = () => pad;
  im.update(1);
  assert.equal(im.held.jump, true);
  assert.equal(im.pressed.jump, true);
  assert.equal(im.pressed.light, true);
  assert.ok(im.moveX > 0.8);
  assert.equal(im.held.right, true);
  assert.equal(im.lastDevice, 'gamepad');
  im.update(2);
  assert.equal(im.held.jump, true);
  assert.equal(im.pressed.jump, false, 'second frame is held, not pressed');
  pad = fakePad({}, [0, 0]);
  im.update(3);
  assert.equal(im.released.jump, true);
  assert.equal(im.moveX, 0);
});

test('same frame number does not double-update', () => {
  const im = new InputManager();
  im.getPad = () => fakePad({ [PAD.B]: true });
  im.update(7);
  assert.equal(im.pressed.dodge, true);
  im.update(7);
  assert.equal(im.pressed.dodge, true, 'repeat call for same frame keeps state');
});

test('keyboard keys map to actions', () => {
  const im = new InputManager();
  im.getPad = () => null;
  im.keys.add('KeyA'); im.keys.add('Space');
  im.update(1);
  assert.equal(im.moveX, -1);
  assert.equal(im.pressed.jump, true);
  assert.equal(im.padConnected, false);
});

test('virtual (autopilot) input merges in and real activity is flagged separately', () => {
  const im = new InputManager();
  im.getPad = () => null;
  im.virtual = { moveX: 1, actions: new Set(['light', 'defend']) };
  im.update(1);
  assert.equal(im.moveX, 1);
  assert.equal(im.pressed.light, true);
  assert.equal(im.held.defend, true);
  assert.equal(im.realActivity, false);
  im.keys.add('KeyJ');
  im.update(2);
  assert.equal(im.realActivity, true);
});

test('left trigger maps to defend', () => {
  const im = new InputManager();
  im.getPad = () => fakePad({ [PAD.LT]: true });
  im.update(1);
  assert.equal(im.held.defend, true);
});

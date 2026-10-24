// The run's settings as one line of chips on the launch screen (ui/launch.js): the standing
// orders (a preset, or custom) and the difficulty, each remembered from the last run, so the
// rows of buttons stay folded away until something needs changing.
import { DEFAULT_DIFFICULTY, DIFFICULTY, fitDifficulty } from '../meta/difficulty.js';
import { KNOBS, LEAD_KNOBS, PRESETS, isManual } from '../sim/doctrine.js';
import { tileOf } from './orders.js';

export const sameOrders = (a, b) => Object.keys(KNOBS).every((k) => a[k] === b[k]);

/** Manual whenever the route is the player's; otherwise the autonomous preset it matches (or null for custom). */
export const presetOf = (d) => (isManual(d) ? 'standard' : Object.keys(PRESETS).find((k) => sameOrders(PRESETS[k].doctrine, d)) ?? null);

/**
 * The chips: [{k, label, value, changed, title}]. Squad mode: the orders preset (or Custom;
 * `preset` is the one the player started from, "adjusted" when the knobs have moved since)
 * and the four difficulty knobs. Lead mode: the followers' four orders instead of a preset.
 */
export function settingsChips(doctrine, difficulty, control = 'squad', preset = presetOf(doctrine)) {
  const chips = [];
  if (control === 'lead') {
    for (const k of LEAD_KNOBS) {
      const tile = tileOf(k);
      chips.push({ k, label: tile.label, value: tile.short[doctrine[k]] ?? doctrine[k], changed: doctrine[k] !== PRESETS.standard.doctrine[k], title: tile.detail[doctrine[k]] ?? '' });
    }
  } else {
    const p = preset && PRESETS[preset] ? preset : presetOf(doctrine);
    const adjusted = p && !sameOrders(PRESETS[p].doctrine, doctrine);
    chips.push({ k: 'orders', label: 'Orders', value: p ? `${PRESETS[p].label}${adjusted ? ' (adjusted)' : ''}` : 'Custom', changed: p !== 'standard', title: p ? PRESETS[p].text : 'Custom orders - the squad runs itself' });
  }
  const f = fitDifficulty(difficulty);
  for (const [k, knob] of Object.entries(DIFFICULTY)) {
    chips.push({ k, label: knob.label, value: knob.options[f[k]], changed: f[k] !== DEFAULT_DIFFICULTY[k], title: `${knob.label}: ${knob.options[f[k]]}` });
  }
  return chips;
}

/** True when nothing is at its default: the chip row says so in one word. */
export const allDefault = (chips) => chips.every((c) => !c.changed);

// The controls, behind a CONTROLS button on the title and launch screens (and ? in a run):
// one table for squad mode's keys, one for lead mode's pad and keyboard. Nothing else on
// those screens explains a key any more.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const SQUAD_CONTROLS = [
  ['C', 'cover: stop and crouch'], ['T', 'turn back'],
  ['Q · E · D', 'grenade, flare, defend'], ['K', 'kit: use it or save it'],
  ['R · F · G', 'route, fire discipline, pace'], ['L · H · V', 'loot, stims, flashlights'],
  ['1 - 3', 'choose at an encounter'], ['Tab', 'the ship map'],
  ['Click', 'point the squad at a door, ladder, crate, terminal, survivor or barrel'],
  ['Space', 'pause'], ['P', 'pixel mode on / off'], ['+ −', 'zoom (or the wheel)'], ['M', 'mute'],
];

export const LEAD_CONTROLS = [
  ['L stick', 'walk, run (push it all the way) · up or down at a ladder or stairwell'],
  ['R stick', 'aim (a hostile near your line draws the fire)'],
  ['RT', 'fire'], ['LT', 'cover: everyone crouches'],
  ['A', 'use: a crate, terminal, door, the console, a man down'],
  ['B', 'followers hold where they are / fall in again'],
  ['X · Y · LB', 'grenade, flare, defend'], ['RB', 'reload'],
  ['D-pad', 'the followers\' orders · an encounter\'s options (A picks)'],
  ['Back', 'the ship map'], ['Start', 'pause'],
  ['Keyboard', 'WASD walk · mouse aims · click fires · Shift cover · E use · R reload · T hold · Q F G kit · Tab map'],
];

const table = (rows) => `<div class="controls">${rows.map(([k, t]) => `<div><kbd>${esc(k)}</kbd><span>${esc(t)}</span></div>`).join('')}</div>`;

/** The whole help card: both modes, side by side. `mode` puts that one first. */
export function helpHtml(mode = 'squad') {
  const squad = `<div><h3>SQUAD <small>the four run themselves by your orders; you point and click</small></h3>${table(SQUAD_CONTROLS)}</div>`;
  const lead = `<div><h3>LEAD <small>you walk one marine with a controller, or keys and mouse</small></h3>${table(LEAD_CONTROLS)}</div>`;
  return `<div class="helpcols">${mode === 'lead' ? lead + squad : squad + lead}</div>`;
}

/**
 * A CONTROLS button that opens the help card over its screen; returns the button. The card
 * closes on its own button, on Escape, or on a click outside it.
 */
export function helpButton(root, mode = 'squad', label = 'CONTROLS') {
  const btn = document.createElement('button');
  btn.className = 'helpbtn';
  btn.textContent = label;
  let card = null;
  const close = () => { card?.remove(); card = null; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (card) return close();
    card = document.createElement('div');
    card.className = 'help';
    card.innerHTML = `<div class="helpcard panel"><div class="helptop"><h2>CONTROLS</h2><button class="close">CLOSE</button></div>${helpHtml(mode)}</div>`;
    card.addEventListener('click', (ev) => { if (ev.target === card || ev.target.classList.contains('close')) close(); });
    root.appendChild(card);
    document.addEventListener('keydown', onKey);
  });
  return btn;
}

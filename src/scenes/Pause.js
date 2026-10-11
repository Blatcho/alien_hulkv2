import { WIDTH, HEIGHT } from '../config.js';
import { getInput } from '../input/Input.js';
import { compareItems, describeItem, RARITY_COLORS } from '../systems/Loot.js';
import { INVENTORY_SIZE } from '../data/items.js';

// Pause + character screen (scene key 'Pause'). The Game scene launches it with
//   this.scene.launch('Pause'); this.scene.pause('Game');
// and it closes itself with scene.resume('Game') + scene.stop(). Fully gamepad navigable:
// left/right switch columns (stats / equipment / inventory), up/down move within a column,
// A/confirm acts (spend point, unequip, equip, menu row), B/back or Start closes.

const PANEL = { x: 60, y: 60, w: 1160, h: 600 };
const COLS = { left: 100, mid: 470, right: 800 };
const RARITY_TINT = {};
for (const [k, v] of Object.entries(RARITY_COLORS)) RARITY_TINT[k] = parseInt(v.slice(1), 16);
const DIM = 0x7a7468;
const TEXT = 0xd8d0c0;
const LABEL = 0x9a8a70;
const STAT_ROWS = ['str', 'vit', 'agi'];
const MENU_ROWS = ['resume', 'restart', 'quit'];
const MENU_LABELS = { resume: 'Resume', restart: 'Restart from checkpoint', quit: 'Quit to title' };
const SLOT_ORDER = ['claws', 'hide', 'charm'];
const elide = (s, n) => (s.length > n ? `${s.slice(0, n - 2)}..` : s);

export default class PauseScene extends Phaser.Scene {
  constructor() { super('Pause'); }

  create() {
    this.input_ = getInput();
    this.scene.pause('Game');
    this.game_ = this.scene.get('Game');
    this.col = 0;
    this.rows = [0, 0, 0];
    this.repeat = { dir: 0, t: 0 };

    this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x000000, 0.6).setOrigin(0);
    this.add.nineslice(PANEL.x + PANEL.w / 2, PANEL.y + PANEL.h / 2, 'ui_panel', undefined, PANEL.w, PANEL.h, 24, 24, 24, 24);
    this.add.bitmapText(WIDTH / 2, PANEL.y + 34, 'title', 'PAUSED', 36).setOrigin(0.5).setTint(0xd8c7a0);

    // column headers + dividers
    const headY = PANEL.y + 74;
    this.add.bitmapText(COLS.left, headY, 'small', 'CHARACTER', 16).setTint(LABEL);
    this.add.bitmapText(COLS.mid, headY, 'small', 'EQUIPMENT', 16).setTint(LABEL);
    this.add.bitmapText(COLS.right, headY, 'small', 'INVENTORY', 16).setTint(LABEL);
    for (const x of [COLS.mid - 24, COLS.right - 24]) this.add.rectangle(x, headY - 6, 1, PANEL.h - 150, 0x3a3444).setOrigin(0);
    for (const x of [COLS.left, COLS.mid, COLS.right]) this.add.rectangle(x, headY + 22, 300, 1, 0x3a3444).setOrigin(0);

    // highlight + cursor shared by every column
    this.highlight = this.add.rectangle(0, 0, 10, 10, 0xd8c7a0, 0.12).setOrigin(0, 0.5).setVisible(false);
    this.cursor = this.add.image(0, 0, 'ui_cursor').setOrigin(21 / 24, 0.5).setVisible(false);

    // ---- left column: stats ----------------------------------------------------------------
    const lx = COLS.left;
    let y = headY + 46;
    const mk = (txt, tint = TEXT, size = 20) => this.add.bitmapText(lx, y, 'body', txt, size).setOrigin(0, 0.5).setTint(tint);
    this.lvlText = mk('Level 1'); y += 28;
    this.xpText = mk('XP 0 / 60', DIM, 18); y += 28;
    this.pointsText = mk('Points to spend: 0', 0xe8c868, 18); y += 34;
    this.statRows = [];
    for (const key of STAT_ROWS) {
      const label = mk(key.toUpperCase());
      const value = this.add.bitmapText(lx + 100, y, 'body', '5', 20).setOrigin(0, 0.5).setTint(TEXT);
      const plus = this.add.bitmapText(lx + 170, y, 'body', '[+]', 20).setOrigin(0, 0.5).setTint(0x80e080);
      this.statRows.push({ key, y, label, value, plus });
      y += 30;
    }
    y += 8;
    this.add.rectangle(lx, y, 300, 1, 0x3a3444).setOrigin(0, 0.5); y += 18;
    this.derived = {};
    for (const [key, label] of [['hp', 'Max HP'], ['stamina', 'Stamina'], ['damage', 'Damage'], ['crit', 'Crit'], ['armor', 'Armor']]) {
      this.add.bitmapText(lx, y, 'small', label, 16).setOrigin(0, 0.5).setTint(LABEL);
      this.derived[key] = this.add.bitmapText(lx + 150, y, 'small', '', 16).setOrigin(0, 0.5).setTint(TEXT);
      y += 24;
    }
    // menu rows at the bottom of the left column
    this.menuRows = [];
    let my = PANEL.y + PANEL.h - 128;
    for (const key of MENU_ROWS) {
      const t = this.add.bitmapText(lx, my, 'body', MENU_LABELS[key], 20).setOrigin(0, 0.5).setTint(TEXT);
      this.menuRows.push({ key, y: my, text: t });
      my += 30;
    }

    // ---- middle column: equipment ----------------------------------------------------------
    this.slotRows = [];
    let sy = headY + 70;
    for (const slot of SLOT_ORDER) {
      const label = this.add.bitmapText(COLS.mid, sy - 54, 'small', slot.toUpperCase(), 16).setTint(LABEL);
      const frame = this.add.image(COLS.mid + 28, sy, 'ui_slot');
      const icon = this.add.bitmapText(COLS.mid + 28, sy, 'title', slot[0].toUpperCase(), 28).setOrigin(0.5).setTint(DIM).setAlpha(0.6);
      const name = this.add.bitmapText(COLS.mid + 68, sy - 14, 'body', '', 18).setOrigin(0, 0.5);
      const mods = this.add.bitmapText(COLS.mid + 68, sy + 12, 'small', '', 13).setOrigin(0, 0.5).setTint(DIM).setMaxWidth(236);
      this.slotRows.push({ slot, y: sy, label, frame, icon, name, mods });
      sy += 130;
    }

    // ---- right column: inventory -----------------------------------------------------------
    this.invRows = [];
    let iy = headY + 46;
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const name = this.add.bitmapText(COLS.right, iy, 'body', '', 18).setOrigin(0, 0.5);
      const cmp = this.add.bitmapText(COLS.right, iy + 18, 'small', '', 13).setOrigin(0, 0.5).setTint(DIM);
      this.invRows.push({ y: iy, name, cmp });
      iy += 40;
    }
    this.invEmpty = this.add.bitmapText(COLS.right, headY + 46, 'body', 'Nothing carried', 18).setOrigin(0, 0.5).setTint(DIM);
    this.invCount = this.add.bitmapText(COLS.right + 380, headY, 'small', '', 16).setOrigin(1, 0).setTint(LABEL);

    // ---- legend ----------------------------------------------------------------------------
    const ly = PANEL.y + PANEL.h - 28;
    let lxx = COLS.left;
    const legend = (tex, text) => {
      if (this.textures.exists(tex)) { this.add.image(lxx + 14, ly, tex); lxx += 34; }
      const t = this.add.bitmapText(lxx, ly, 'small', text, 16).setOrigin(0, 0.5).setTint(LABEL);
      lxx += t.width + 36;
    };
    legend('ui_button_a', 'Select (Enter)');
    legend('ui_button_b', 'Back (Esc)');
    legend('ui_button_start', 'Resume');
    this.add.bitmapText(PANEL.x + PANEL.w - 40, ly, 'small', 'Left/Right - columns    Up/Down - rows', 14).setOrigin(1, 0.5).setTint(DIM);

    this.hint = this.add.bitmapText(WIDTH / 2, PANEL.y + PANEL.h + 24, 'small', '', 16).setOrigin(0.5).setTint(LABEL);

    this.cameras.main.fadeIn(160, 0, 0, 0);
    this.refresh();
    this.sfx('sfx_ui_confirm', { volume: 0.5 });
  }

  // ------------------------------------------------------------------------------- helpers
  get player() { const g = this.scene.get('Game'); return g && g.player ? g.player : null; }
  get stats() { const p = this.player; return p && p.stats ? p.stats : null; }
  inventory() { const p = this.player; if (!p) return []; if (!Array.isArray(p.inventory)) p.inventory = []; return p.inventory; }

  sfx(key, opts) {
    const g = this.scene.get('Game');
    if (g && g.audio && g.audio.play) g.audio.play(key, opts);
  }

  colRows(col) {
    if (col === 0) return STAT_ROWS.length + MENU_ROWS.length;
    if (col === 1) return SLOT_ORDER.length;
    return this.inventory().length;
  }

  // pull Player's max values from the recalculated stats (gear / points change them)
  syncPlayer() {
    const p = this.player, s = this.stats;
    if (!p || !s) return;
    const dHp = s.maxHp - p.maxHp;
    p.maxHp = s.maxHp;
    if (dHp > 0) p.hp += dHp;
    p.hp = Math.max(1, Math.min(p.hp, p.maxHp));
    const dSt = s.maxStamina - p.maxStamina;
    p.maxStamina = s.maxStamina;
    if (dSt > 0) p.stamina += dSt;
    p.stamina = Math.min(p.stamina, p.maxStamina);
  }

  refresh() {
    const p = this.player, s = this.stats;
    const inv = this.inventory();
    if (s) {
      this.lvlText.setText(`Level ${s.level}`);
      this.xpText.setText(`XP ${Math.floor(s.xp)} / ${s.xpToNext()}`);
      this.pointsText.setText(`Points to spend: ${s.points}`).setTint(s.points > 0 ? 0xe8c868 : DIM);
      for (const r of this.statRows) {
        r.value.setText(String(s[r.key]));
        r.plus.setAlpha(s.points > 0 ? 1 : 0.25);
      }
      this.derived.hp.setText(`${s.maxHp}${p ? `  (${Math.round(p.hp)} now)` : ''}`);
      this.derived.stamina.setText(String(Math.round(s.maxStamina)));
      this.derived.damage.setText(String(Math.round(s.baseDamage * 10) / 10));
      this.derived.crit.setText(`${Math.round(s.critChance * 100)}%`);
      this.derived.armor.setText(`${Math.round((1 - s.damageTakenMult) * 100)}%`);
      for (const r of this.slotRows) {
        const item = s.gear[r.slot];
        if (item) {
          r.name.setText(elide(item.name, 26)).setTint(RARITY_TINT[item.rarity] || TEXT);
          r.mods.setText(`Lv ${item.level}  ${describeItem(item)}`);
          r.icon.setTint(RARITY_TINT[item.rarity] || TEXT).setAlpha(1);
        } else {
          r.name.setText('- empty -').setTint(DIM);
          r.mods.setText('');
          r.icon.setTint(DIM).setAlpha(0.5);
        }
      }
    }
    for (let i = 0; i < this.invRows.length; i++) {
      const r = this.invRows[i];
      const item = inv[i];
      if (item) {
        r.name.setText(elide(item.name, 34)).setTint(RARITY_TINT[item.rarity] || TEXT).setVisible(true);
        const eq = s ? s.gear[item.slot] : null;
        r.cmp.setText(elide(`${item.slot}  Lv ${item.level}   ${compareItems(item, eq)}`, 60)).setVisible(true);
      } else { r.name.setVisible(false); r.cmp.setVisible(false); }
    }
    this.invEmpty.setVisible(inv.length === 0);
    this.invCount.setText(`${inv.length} / ${INVENTORY_SIZE}`);
    this.placeCursor();
  }

  placeCursor() {
    const n = this.colRows(this.col);
    if (n === 0) { this.col = 1; }
    this.rows[this.col] = Math.max(0, Math.min(this.colRows(this.col) - 1, this.rows[this.col]));
    const row = this.rows[this.col];
    for (const r of this.slotRows) r.frame.setTexture('ui_slot');
    let x, y, w, h, hint = '';
    if (this.col === 0) {
      if (row < STAT_ROWS.length) { const r = this.statRows[row]; x = COLS.left; y = r.y; w = 230; h = 28; hint = 'Spend a point to raise this stat'; }
      else { const r = this.menuRows[row - STAT_ROWS.length]; x = COLS.left; y = r.y; w = 300; h = 28; hint = r.key === 'restart' ? 'Return to the last shrine you lit' : r.key === 'quit' ? 'Unsaved progress since the last shrine is lost' : ''; }
    } else if (this.col === 1) {
      const r = this.slotRows[row]; x = COLS.mid; y = r.y; w = 300; h = 64;
      r.frame.setTexture('ui_slot_selected');
      hint = this.stats && this.stats.gear[r.slot] ? 'Select to unequip into the inventory' : 'Nothing equipped here';
    } else {
      const r = this.invRows[row]; x = COLS.right; y = r.y + 9; w = 390; h = 38;
      hint = 'Select to equip';
    }
    this.highlight.setPosition(x - 8, y).setSize(w, h).setVisible(true);
    this.cursor.setPosition(x - 10, y).setVisible(true);
    this.hint.setText(hint);
  }

  // ------------------------------------------------------------------------------- actions
  move(dx, dy) {
    if (dx) {
      let c = this.col;
      for (let i = 0; i < 3; i++) { c = (c + dx + 3) % 3; if (this.colRows(c) > 0) break; }
      if (c !== this.col) { this.col = c; this.sfx('sfx_ui_move', { volume: 0.6 }); }
    }
    if (dy) {
      const n = this.colRows(this.col);
      if (n > 0) { this.rows[this.col] = (this.rows[this.col] + dy + n) % n; this.sfx('sfx_ui_move', { volume: 0.6 }); }
    }
    this.placeCursor();
  }

  confirm() {
    const s = this.stats;
    const inv = this.inventory();
    const row = this.rows[this.col];
    if (this.col === 0) {
      if (row < STAT_ROWS.length) {
        if (s && s.spend(STAT_ROWS[row])) { this.syncPlayer(); this.sfx('sfx_ui_confirm'); this.flashRow(); }
        else this.sfx('sfx_ui_back', { volume: 0.6 });
      } else {
        const key = MENU_ROWS[row - STAT_ROWS.length];
        if (key === 'resume') this.close();
        else if (key === 'restart') this.restart();
        else if (key === 'quit') this.quit();
        return;
      }
    } else if (this.col === 1) {
      const slot = SLOT_ORDER[row];
      const item = s && s.gear[slot];
      if (item && inv.length < INVENTORY_SIZE) {
        s.gear[slot] = null; s.recalc(); inv.push(item);
        this.syncPlayer(); this.sfx('sfx_ui_confirm');
      } else this.sfx('sfx_ui_back', { volume: 0.6 });
    } else {
      const item = inv[row];
      if (item && s) {
        const prev = s.equip(item);
        inv.splice(row, 1);
        if (prev) inv.splice(row, 0, prev);
        this.syncPlayer(); this.sfx('sfx_ui_confirm'); this.flashRow();
      } else this.sfx('sfx_ui_back', { volume: 0.6 });
    }
    this.refresh();
  }

  flashRow() {
    this.highlight.setFillStyle(0xffffff, 0.35);
    this.tweens.add({ targets: this.highlight, fillAlpha: 0.12, duration: 220 });
  }

  close() {
    this.sfx('sfx_ui_back', { volume: 0.7 });
    this.scene.resume('Game');
    this.scene.stop();
  }

  restart() {
    this.sfx('sfx_ui_confirm');
    const g = this.scene.get('Game');
    if (g && g.events) g.events.emit('restart-checkpoint');
    this.scene.resume('Game');
    this.scene.stop();
  }

  quit() {
    this.sfx('sfx_ui_confirm');
    const g = this.scene.get('Game');
    if (g && g.audio && g.audio.music) { try { g.audio.music.stop(); } catch (e) { /* ignore */ } }
    try { this.game.sound.stopAll(); } catch (e) { /* ignore */ }
    if (this.scene.isActive('HUD') || this.scene.isPaused('HUD')) this.scene.stop('HUD');
    this.scene.stop('Game');
    this.scene.start('Title');
  }

  // ------------------------------------------------------------------------------- update
  update(time, delta) {
    const inp = this.input_;
    inp.update(this.game.loop.frame);

    // Enter is mapped to both 'confirm' and 'pause', Esc to both 'back' and 'pause':
    // back always closes, confirm wins over pause, and a bare pause (Start / Tab) closes.
    if (inp.pressed.back || (inp.pressed.pause && !inp.pressed.confirm)) {
      inp.consume('pause'); inp.consume('back'); inp.consume('confirm'); inp.consume('jump');
      this.close();
      return;
    }
    if (inp.pressed.confirm) {
      inp.consume('confirm'); inp.consume('pause'); inp.consume('jump'); inp.consume('light');
      this.confirm();
      return;
    }
    let dx = 0, dy = 0;
    if (inp.pressed.left) { dx = -1; inp.consume('left'); }
    if (inp.pressed.right) { dx = 1; inp.consume('right'); }
    if (inp.pressed.up) { dy = -1; inp.consume('up'); inp.consume('jump'); }
    if (inp.pressed.down) { dy = 1; inp.consume('down'); }
    // hold-to-repeat for up/down
    const heldDir = inp.held.up ? -1 : inp.held.down ? 1 : 0;
    if (heldDir && heldDir === this.repeat.dir && !dy) {
      this.repeat.t += delta;
      if (this.repeat.t > 380) { dy = heldDir; this.repeat.t = 270; }
    } else { this.repeat.dir = heldDir; this.repeat.t = 0; }
    if (dx || dy) this.move(dx, dy);
  }
}

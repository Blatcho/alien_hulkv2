// Thin wrapper over Phaser's sound manager: SFX with random variants/pitch, one music track with crossfade.
export default class AudioSystem {
  constructor(scene) {
    this.scene = scene;
    this.game = scene.game;
    this.music = null;
    this.musicKey = '';
    this.sfxVolume = 0.9;
    this.musicVolume = 0.55;
    this.lastPlayed = {};
  }

  has(key) { return this.game.cache.audio.exists(key); }

  play(key, { volume = 1, rate = 1, detune = 0, variants = 0, minGap = 40 } = {}) {
    let k = key;
    if (variants > 0) k = `${key}${1 + Math.floor(Math.random() * variants)}`;
    if (!this.has(k)) return null;
    const now = this.game.loop.now;
    if (this.lastPlayed[k] && now - this.lastPlayed[k] < minGap) return null;
    this.lastPlayed[k] = now;
    try {
      return this.game.sound.play(k, { volume: volume * this.sfxVolume, rate, detune: detune + (Math.random() * 120 - 60) });
    } catch (e) { return null; }
  }

  playMusic(key, { fade = 900, loop = true, volume = 1 } = {}) {
    if (this.musicKey === key && this.music && this.music.isPlaying) return;
    if (!this.has(key)) return;
    const old = this.music;
    if (old) {
      this.scene.tweens.add({ targets: old, volume: 0, duration: fade, onComplete: () => old.stop() });
    }
    try {
      this.music = this.game.sound.add(key, { loop, volume: 0 });
      this.music.play();
      this.scene.tweens.add({ targets: this.music, volume: this.musicVolume * volume, duration: fade });
      this.musicKey = key;
    } catch (e) { this.music = null; }
  }

  stopMusic(fade = 600) {
    const old = this.music;
    if (!old) return;
    this.scene.tweens.add({ targets: old, volume: 0, duration: fade, onComplete: () => old.stop() });
    this.music = null; this.musicKey = '';
  }
}

export const SFX_KEYS = [
  'sfx_swing1', 'sfx_swing2', 'sfx_swing3', 'sfx_heavy_swing', 'sfx_hit_flesh1', 'sfx_hit_flesh2', 'sfx_hit_metal1', 'sfx_hit_metal2',
  'sfx_block', 'sfx_player_hurt', 'sfx_player_death', 'sfx_enemy_hurt', 'sfx_enemy_death', 'sfx_skeleton_rattle', 'sfx_bat',
  'sfx_jump', 'sfx_land', 'sfx_dodge', 'sfx_footstep1', 'sfx_footstep2', 'sfx_coin', 'sfx_gem', 'sfx_potion', 'sfx_levelup',
  'sfx_loot', 'sfx_chest', 'sfx_checkpoint', 'sfx_gate', 'sfx_ui_move', 'sfx_ui_confirm', 'sfx_ui_back', 'sfx_boss_roar',
  'sfx_thunder', 'sfx_torch', 'sfx_door', 'sfx_wall_hit', 'sfx_wall_break', 'sfx_room_clear',
];
export const MUSIC_KEYS = ['music_title', 'music_moor', 'music_graveyard', 'music_castle', 'music_boss', 'music_victory'];

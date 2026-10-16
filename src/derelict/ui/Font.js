// BMFont (XML) bitmap fonts drawn onto a 2D canvas, with a tint via an offscreen cache per colour.
export class BitmapFont {
  constructor(name) { this.name = name; this.chars = new Map(); this.lineHeight = 16; this.base = 12; this.image = null; this.tints = new Map(); this.kern = new Map(); }

  async load() {
    const [xml, img] = await Promise.all([
      fetch(`assets/fonts/derelict/${this.name}.xml`).then((r) => r.text()),
      new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `assets/fonts/derelict/${this.name}.png`; }),
    ]);
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const common = doc.querySelector('common');
    this.lineHeight = Number(common.getAttribute('lineHeight')); this.base = Number(common.getAttribute('base'));
    for (const c of doc.querySelectorAll('char')) {
      this.chars.set(Number(c.getAttribute('id')), { x: +c.getAttribute('x'), y: +c.getAttribute('y'), w: +c.getAttribute('width'), h: +c.getAttribute('height'), xo: +c.getAttribute('xoffset'), yo: +c.getAttribute('yoffset'), adv: +c.getAttribute('xadvance') });
    }
    this.image = img;
    return this;
  }

  tinted(color) {
    if (color === '#ffffff' || !color) return this.image;
    let c = this.tints.get(color);
    if (c) return c;
    c = document.createElement('canvas'); c.width = this.image.width; c.height = this.image.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(this.image, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color; ctx.fillRect(0, 0, c.width, c.height);
    // keep the outline dark: multiply original alpha-weighted darkness back in
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this.image, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(this.image, 0, 0);
    this.tints.set(color, c);
    return c;
  }

  width(text, scale = 1) {
    let w = 0;
    for (const ch of text) { const c = this.chars.get(ch.charCodeAt(0)) || this.chars.get(63); if (c) w += c.adv; }
    return w * scale;
  }

  draw(ctx, text, x, y, { color = '#ffffff', scale = 1, align = 'left', alpha = 1 } = {}) {
    if (!this.image) return;
    const img = this.tinted(color);
    const w = this.width(text, scale);
    let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    cx = Math.round(cx);
    const oa = ctx.globalAlpha; ctx.globalAlpha = alpha;
    for (const ch of text) {
      const c = this.chars.get(ch.charCodeAt(0)) || this.chars.get(63);
      if (!c) continue;
      if (c.w > 1) ctx.drawImage(img, c.x, c.y, c.w, c.h, cx + c.xo * scale, Math.round(y) + c.yo * scale, c.w * scale, c.h * scale);
      cx += c.adv * scale;
    }
    ctx.globalAlpha = oa;
    return w;
  }
}

"""Shared procedural-art helpers for the asset generators (Pillow + NumPy only)."""
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops


def hex2rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lerp(a, b, t):
    return a + (b - a) * t


def lerp_rgb(c1, c2, t):
    return tuple(int(round(lerp(c1[i], c2[i], t))) for i in range(3))


def smoothstep(t):
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- noise ----

def value_noise_1d(n, cells, seed, period=True):
    """Tileable 1D value noise in [0,1], n samples, `cells` lattice points across the span."""
    rs = np.random.RandomState(seed)
    lattice = rs.rand(cells + 1)
    if period:
        lattice[-1] = lattice[0]
    x = np.linspace(0, cells, n, endpoint=not period)
    i0 = np.floor(x).astype(int) % (cells + 1)
    i1 = (i0 + 1) % (cells + 1)
    t = smoothstep(x - np.floor(x))
    return lattice[i0] * (1 - t) + lattice[i1] * t


def fbm_1d(n, cells=8, octaves=5, persistence=0.5, seed=0, ridged=False):
    out = np.zeros(n)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        v = value_noise_1d(n, cells * (2 ** o), seed + o * 101)
        if ridged:
            v = 1 - np.abs(v * 2 - 1)
        out += v * amp
        total += amp
        amp *= persistence
    return out / total


def value_noise_2d(w, h, cx, cy, seed, wrap_x=True):
    rs = np.random.RandomState(seed)
    lat = rs.rand(cy + 2, cx + 1)
    if wrap_x:
        lat[:, -1] = lat[:, 0]
    xs = np.linspace(0, cx, w, endpoint=not wrap_x)
    ys = np.linspace(0, cy, h, endpoint=False)
    xi0 = np.floor(xs).astype(int)
    yi0 = np.floor(ys).astype(int)
    tx = smoothstep(xs - xi0)[None, :]
    ty = smoothstep(ys - yi0)[:, None]
    xi0 = xi0 % (cx + 1); xi1 = (xi0 + 1) % (cx + 1)
    yi1 = np.minimum(yi0 + 1, cy + 1)
    a = lat[yi0][:, xi0]; b = lat[yi0][:, xi1]
    c = lat[yi1][:, xi0]; d = lat[yi1][:, xi1]
    top = a * (1 - tx) + b * tx
    bot = c * (1 - tx) + d * tx
    return top * (1 - ty) + bot * ty


def fbm_2d(w, h, cx=8, cy=4, octaves=5, persistence=0.5, seed=0, wrap_x=True):
    out = np.zeros((h, w))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        out += value_noise_2d(w, h, cx * (2 ** o), cy * (2 ** o), seed + o * 7919, wrap_x) * amp
        total += amp
        amp *= persistence
    return out / total


# -------------------------------------------------------------- images ----

def gradient_column(h, stops):
    """stops: list of (t in 0..1, '#rrggbb'). Returns (h,3) float array."""
    ts = np.array([s[0] for s in stops])
    cols = np.array([hex2rgb(s[1]) for s in stops], dtype=float)
    y = np.linspace(0, 1, h)
    out = np.zeros((h, 3))
    for c in range(3):
        out[:, c] = np.interp(y, ts, cols[:, c])
    return out


def vgradient_image(w, h, stops):
    col = gradient_column(h, stops)
    arr = np.repeat(col[:, None, :], w, axis=1)
    return Image.fromarray(arr.astype(np.uint8), 'RGB').convert('RGBA')


def rgba(arr_rgb, alpha):
    """arr_rgb (h,w,3) float 0..255, alpha (h,w) float 0..255 -> RGBA image."""
    a = np.clip(alpha, 0, 255).astype(np.uint8)
    rgb = np.clip(arr_rgb, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([rgb, a]), 'RGBA')


def new_rgba(w, h, color=(0, 0, 0, 0)):
    return Image.new('RGBA', (w, h), color)


def tile_draw(fn, W, copies=(-1, 0, 1)):
    """Call fn(dx) for each wrap offset so drawings tile horizontally across width W."""
    for k in copies:
        fn(k * W)


def ridge_fill(w, h, ridge_y, color_top, color_bottom, fade_to=None, fade_start=0.0, fade_power=1.5,
               texture=None, texture_strength=0.0):
    """Fill everything below ridge_y[x] with a vertical gradient (colour_top at the ridge,
    colour_bottom at the image bottom), optionally fading into a fog colour toward the bottom.
    Returns an RGBA image."""
    ys = np.arange(h)[:, None]
    ridge = np.asarray(ridge_y)[None, :]
    mask = (ys >= ridge).astype(float)
    # soft edge for antialiasing
    edge = np.clip(ys - ridge + 0.5, 0, 1)
    mask = edge
    t = np.clip((ys - ridge) / np.maximum(1, (h - ridge)), 0, 1)
    ct = np.array(hex2rgb(color_top), float); cb = np.array(hex2rgb(color_bottom), float)
    rgb = ct[None, None, :] * (1 - t[..., None]) + cb[None, None, :] * t[..., None]
    if texture is not None and texture_strength > 0:
        rgb = rgb * (1 + (texture[..., None] - 0.5) * 2 * texture_strength)
    if fade_to is not None:
        f = np.clip((ys / h - fade_start) / max(1e-6, 1 - fade_start), 0, 1) ** fade_power
        f = np.repeat(f, w, axis=1)
        ft = np.array(hex2rgb(fade_to), float)
        rgb = rgb * (1 - f[..., None]) + ft[None, None, :] * f[..., None]
    return rgba(rgb, mask * 255)


def alpha_fade_bottom(img, start_frac, end_alpha=0.0):
    """Multiply alpha by a vertical ramp from 1 at start_frac*h down to end_alpha at the bottom."""
    w, h = img.size
    a = np.array(img.getchannel('A'), float)
    ys = np.arange(h)
    ramp = np.clip((ys - start_frac * h) / max(1, h - start_frac * h), 0, 1)
    mult = 1 - ramp * (1 - end_alpha)
    a *= mult[:, None]
    img.putalpha(Image.fromarray(a.astype(np.uint8)))
    return img


def blend_toward(img, color, strength_map):
    """Blend the RGB of img toward color by strength_map (h,w) in 0..1 (alpha untouched)."""
    arr = np.array(img).astype(float)
    c = np.array(hex2rgb(color), float)
    s = strength_map[..., None]
    arr[..., :3] = arr[..., :3] * (1 - s) + c[None, None, :] * s
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA')


def soft_disc(size, color, inner=0.0, power=1.0):
    """Radial soft disc RGBA of given size: alpha 1 at centre to 0 at edge."""
    y, x = np.mgrid[0:size, 0:size]
    cx = cy = (size - 1) / 2
    r = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / (size / 2)
    a = np.clip(1 - (r - inner) / max(1e-6, 1 - inner), 0, 1) ** power
    rgb = np.ones((size, size, 3)) * np.array(hex2rgb(color), float)[None, None, :]
    return rgba(rgb, a * 255)


def multiply_alpha(img, factor):
    a = np.array(img.getchannel('A'), float) * factor
    img.putalpha(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)))
    return img


def tint_noise(img, strength=0.06, seed=0, scale=4):
    """Add subtle brightness noise so flat fills do not band."""
    w, h = img.size
    n = fbm_2d(w, h, max(1, w // (scale * 32)), max(1, h // (scale * 32)), octaves=3, seed=seed)
    arr = np.array(img).astype(float)
    arr[..., :3] *= 1 + (n[..., None] - 0.5) * 2 * strength
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA')


def draw_tapered_line(draw, p0, p1, w0, w1, fill):
    """Polygon between two points with linearly varying width."""
    (x0, y0), (x1, y1) = p0, p1
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy) or 1
    nx, ny = -dy / L, dx / L
    poly = [
        (x0 + nx * w0 / 2, y0 + ny * w0 / 2), (x1 + nx * w1 / 2, y1 + ny * w1 / 2),
        (x1 - nx * w1 / 2, y1 - ny * w1 / 2), (x0 - nx * w0 / 2, y0 - ny * w0 / 2),
    ]
    draw.polygon(poly, fill=fill)
    if w0 > 2:
        draw.ellipse([x0 - w0 / 2, y0 - w0 / 2, x0 + w0 / 2, y0 + w0 / 2], fill=fill)
    if w1 > 2:
        draw.ellipse([x1 - w1 / 2, y1 - w1 / 2, x1 + w1 / 2, y1 + w1 / 2], fill=fill)


def draw_tree(draw, x, y, height, rs, fill, trunk_w=None, depth=0, max_depth=7, angle=-90, spread=38,
              lean=0.0, gnarl=0.35):
    """Recursive dead tree silhouette. (x,y) is the base, angle in degrees (-90 = up)."""
    if trunk_w is None:
        trunk_w = height * 0.09
    if depth > max_depth or height < 4:
        return
    a = math.radians(angle + lean)
    # gnarled: bend the segment with a mid-point offset
    seg = height * (0.55 if depth == 0 else 0.62)
    mx = x + math.cos(a) * seg * 0.5 + rs.uniform(-1, 1) * seg * gnarl * 0.3
    my = y + math.sin(a) * seg * 0.5
    ex = x + math.cos(a) * seg + rs.uniform(-1, 1) * seg * gnarl * 0.4
    ey = y + math.sin(a) * seg
    w_end = trunk_w * 0.62
    draw_tapered_line(draw, (x, y), (mx, my), trunk_w, (trunk_w + w_end) / 2, fill)
    draw_tapered_line(draw, (mx, my), (ex, ey), (trunk_w + w_end) / 2, w_end, fill)
    n = 2 if depth < 2 else rs.choice([1, 2, 2, 3])
    base_angle = math.degrees(math.atan2(ey - my, ex - mx))
    for i in range(n):
        da = rs.uniform(-spread, spread) + (spread * 0.6 if i == 0 else -spread * 0.6 if i == 1 else 0)
        draw_tree(draw, ex, ey, height * rs.uniform(0.52, 0.7), rs, fill, w_end, depth + 1, max_depth,
                  base_angle + da, spread, lean * 0.5, gnarl)
    # occasional side twig
    if depth >= 1 and rs.rand() < 0.5:
        t = rs.uniform(0.3, 0.8)
        sx, sy = x + (ex - x) * t, y + (ey - y) * t
        draw_tree(draw, sx, sy, height * rs.uniform(0.25, 0.4), rs, fill, w_end * 0.6, depth + 2, max_depth,
                  base_angle + rs.choice([-1, 1]) * rs.uniform(45, 80), spread, 0, gnarl)


def draw_vine(draw, pts, width, fill, thorn_fill=None, rs=None, thorn_every=18, thorn_len=9):
    """Smooth vine along control points (Catmull-Rom), with thorns."""
    if len(pts) < 2:
        return
    P = [pts[0]] + list(pts) + [pts[-1]]
    path = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for s in np.linspace(0, 1, 12, endpoint=False):
            s2, s3 = s * s, s * s * s
            x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * s + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * s2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * s3)
            y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * s + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * s2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * s3)
            path.append((x, y))
    path.append(pts[-1])
    n = len(path)
    for i in range(n - 1):
        w0 = width * (1 - 0.6 * i / n)
        w1 = width * (1 - 0.6 * (i + 1) / n)
        draw_tapered_line(draw, path[i], path[i + 1], w0, w1, fill)
    if thorn_fill is not None and rs is not None:
        acc = 0
        for i in range(1, n - 1):
            acc += math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
            if acc >= thorn_every:
                acc = 0
                (x, y) = path[i]
                dx, dy = path[i + 1][0] - path[i - 1][0], path[i + 1][1] - path[i - 1][1]
                L = math.hypot(dx, dy) or 1
                nx, ny = -dy / L, dx / L
                side = rs.choice([-1, 1])
                tl = thorn_len * rs.uniform(0.6, 1.3)
                w = width * (1 - 0.6 * i / n)
                tip = (x + nx * side * (tl + w / 2) + dx / L * tl * 0.5, y + ny * side * (tl + w / 2) + dy / L * tl * 0.5)
                b0 = (x - dx / L * w * 0.6, y - dy / L * w * 0.6)
                b1 = (x + dx / L * w * 0.6, y + dy / L * w * 0.6)
                draw.polygon([b0, tip, b1], fill=thorn_fill)


def outline_glow(img, color, radius, strength=1.0):
    """Return a glow image (blurred alpha in colour) to composite under img."""
    a = img.getchannel('A').filter(ImageFilter.GaussianBlur(radius))
    glow = Image.new('RGBA', img.size, color + (0,))
    glow.putalpha(Image.fromarray((np.array(a) * strength).astype(np.uint8)))
    return glow


def shade_sprite(img, light_dir=(-0.6, -0.8), ambient=0.55, strength=0.45, rim=0.35, rim_color=(120, 150, 200)):
    """Cheap 'painted' shading: derive a height field from the alpha (distance-ish via blur) and light it.
    Darkens edges facing away from the light and adds a cool rim on the far side."""
    a = np.array(img.getchannel('A'), float) / 255.0
    hgt = np.array(img.getchannel('A').filter(ImageFilter.GaussianBlur(max(1, min(img.size) * 0.06))), float) / 255.0
    gy, gx = np.gradient(hgt)
    lx, ly = light_dir
    L = math.hypot(lx, ly) or 1
    lx, ly = lx / L, ly / L
    ndotl = (gx * lx + gy * ly)
    ndotl = ndotl / (np.abs(ndotl).max() + 1e-6)
    lit = ambient + strength * np.clip(ndotl * 2 + 0.5, 0, 1.3)
    arr = np.array(img).astype(float)
    arr[..., :3] *= np.clip(lit, 0.2, 1.4)[..., None]
    # rim light on the side away from the key light
    rimmask = np.clip(-ndotl, 0, 1) * (1 - hgt) * a
    arr[..., :3] += np.array(rim_color, float)[None, None, :] * (rimmask * rim)[..., None]
    out = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA')
    return out


# ----------------------------------------------- background texture helpers (added by bg pass) ----

def noise2d_at(xs, ys, cx, cy, seed):
    """Value noise sampled at arbitrary float lattice coordinates xs, ys (arrays of equal shape).
    The lattice has cx cells along x (wrapping, so x in [0,cx) tiles) and cy cells along y (clamped).
    Returns values in 0..1 with the same shape as xs."""
    rs = np.random.RandomState(seed)
    lat = rs.rand(cy + 2, cx + 1)
    lat[:, -1] = lat[:, 0]
    xs = np.mod(xs, cx)
    ys = np.clip(ys, 0, cy + 0.999)
    xi0 = np.floor(xs).astype(int)
    yi0 = np.floor(ys).astype(int)
    tx = smoothstep(xs - xi0)
    ty = smoothstep(ys - yi0)
    xi0 = xi0 % (cx + 1)
    xi1 = (xi0 + 1) % (cx + 1)
    yi1 = np.minimum(yi0 + 1, cy + 1)
    a = lat[yi0, xi0]; b = lat[yi0, xi1]; c = lat[yi1, xi0]; d = lat[yi1, xi1]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def fbm_at(xs, ys, cx, cy, octaves=5, persistence=0.5, seed=0, ridged=False):
    """fbm of noise2d_at over arbitrary coordinates (tileable in x over [0,cx))."""
    out = np.zeros(np.shape(xs))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        v = noise2d_at(xs * (2 ** o), ys * (2 ** o), cx * (2 ** o), cy * (2 ** o), seed + o * 7919)
        if ridged:
            v = 1 - np.abs(v * 2 - 1)
        out += v * amp
        total += amp
        amp *= persistence
    return out / total


def fbm_warp(w, h, cx=8, cy=4, octaves=5, persistence=0.5, seed=0, warp=0.6, warp_cells=None, ridged=False):
    """Domain-warped fbm (h,w) in 0..1 that tiles horizontally. The sampling coordinates are
    displaced by a second low-frequency fbm by up to +-warp lattice cells, which turns blobby
    value noise into billowing / marbled shapes (clouds, rock, bark)."""
    cy = max(1, cy)
    xs = np.repeat(np.linspace(0, cx, w, endpoint=False)[None, :], h, axis=0)
    ys = np.repeat(np.linspace(0, cy, h, endpoint=False)[:, None], w, axis=1)
    wc = warp_cells or max(1, cx // 2)
    wcy = max(1, int(round(wc * cy / cx)))
    wx = fbm_2d(w, h, wc, wcy, octaves=3, seed=seed + 311) - 0.5
    wy = fbm_2d(w, h, wc, wcy, octaves=3, seed=seed + 613) - 0.5
    return fbm_at(xs + wx * 2 * warp, ys + wy * 2 * warp, cx, cy, octaves, persistence, seed, ridged)


def gaussian_blur_array(arr, radius):
    """Gaussian blur of a float (h,w) array (any range) via Pillow; returns float array."""
    if radius <= 0:
        return arr.copy()
    lo, hi = float(arr.min()), float(arr.max())
    if hi - lo < 1e-9:
        return arr.copy()
    im = Image.fromarray(((arr - lo) / (hi - lo) * 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(radius))
    return np.array(im, float) / 255.0 * (hi - lo) + lo


def height_shade(rgb, height, light=(-0.6, -0.8), strength=0.5, ambient=1.0, lo=0.15, hi=2.0):
    """Light an (h,w,3) float rgb array with a height field (h,w). `light` is the direction the
    light comes FROM in image space (y down), e.g. (-0.6,-0.8) = upper left. Slopes facing the
    light brighten, slopes facing away darken. Returns a new array."""
    gy, gx = np.gradient(height)
    lx, ly = light
    L = math.hypot(lx, ly) or 1
    lx, ly = lx / L, ly / L
    nd = -(gx * lx + gy * ly)
    lit = np.clip(ambient + strength * nd, lo, hi)
    return rgb * lit[..., None]


def normal_map_from_height(height, strength=1.0):
    """Tangent-space normal map (h,w,3) uint8 from a height field, OpenGL convention (green = up,
    i.e. image +y is flipped): flat = (128,128,255). `strength` scales the slopes."""
    gy, gx = np.gradient(height)
    nx = -gx * strength
    ny = gy * strength
    nz = np.ones_like(nx)
    n = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / n, ny / n, nz / n
    rgb = np.dstack([nx * 127.5 + 127.5, ny * 127.5 + 127.5, nz * 127.5 + 127.5])
    return np.clip(np.rint(rgb), 0, 255).astype(np.uint8)


def brick_height(w, h, course=8, brick=24, mortar=1.5, bevel=2.0, seed=0, chip=0.3, chip_cells=16):
    """Coursed stonework height field (h,w) in 0..1 (stones raised, mortar joints low, per-stone
    height variation, chipped corners) plus a per-stone random id field in 0..1 for colour variation."""
    rs = np.random.RandomState(seed)
    y, x = np.mgrid[0:h, 0:w].astype(float)
    row = np.floor(y / course)
    xo = x + (row % 2) * brick * 0.5
    col = np.floor(xo / brick)
    fy = y - row * course
    fx = xo - col * brick
    d = np.minimum(np.minimum(fx, brick - fx), np.minimum(fy, course - fy))
    hgt = np.clip((d - mortar) / max(1e-6, bevel), 0, 1)
    rows, cols = int(h // course) + 3, int(w // brick) + 4
    lat = rs.rand(rows, cols)
    sid = lat[np.clip(row.astype(int), 0, rows - 1), np.clip(col.astype(int) + 1, 0, cols - 1)]
    hgt = hgt * (0.7 + 0.3 * sid)
    if chip > 0:
        n = fbm_2d(w, h, max(1, w // chip_cells), max(1, h // chip_cells), octaves=3, seed=seed + 5)
        hgt = hgt - np.clip((n - 0.62) / 0.3, 0, 1) * chip * hgt
    return np.clip(hgt, 0, 1), sid


def mask_array(img_l, blur=0.0):
    """'L' (or RGBA alpha) image -> float (h,w) 0..1, optionally blurred."""
    if img_l.mode != 'L':
        img_l = img_l.getchannel('A')
    if blur > 0:
        img_l = img_l.filter(ImageFilter.GaussianBlur(blur))
    return np.array(img_l, float) / 255.0


def rim_light(mask, light=(0.6, -0.8), width=3.0, power=1.0):
    """Edge-light weight (h,w) 0..1 for a silhouette mask: edges facing the light direction
    (the direction the light comes FROM) within `width` px of the outline."""
    soft = gaussian_blur_array(mask, width)
    gy, gx = np.gradient(soft)
    lx, ly = light
    L = math.hypot(lx, ly) or 1
    nd = -(gx * lx + gy * ly) / L
    nd = nd / (np.abs(nd).max() + 1e-6)
    return np.clip(nd, 0, 1) ** power * mask


def paint_grain(img, strength=0.05, stroke=0.04, seed=0):
    """Painterly surface: fine grain plus horizontally stretched brush-stroke modulation (RGB only)."""
    w, h = img.size
    arr = np.array(img).astype(float)
    g = fbm_2d(w, h, max(1, w // 6), max(1, h // 6), octaves=2, seed=seed + 77)
    s = fbm_2d(w, h, max(1, w // 40), max(1, h // 6), octaves=3, seed=seed + 88)
    m = 1 + (g - 0.5) * 2 * strength + (s - 0.5) * 2 * stroke
    arr[..., :3] *= m[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA')


def draw_tree2(draw, x, y, height, rs, fill, trunk_w=None, depth=0, max_depth=7, angle=-90, spread=38,
               lean=0.0, gnarl=0.35, segments=None, twist=0.0):
    """Like draw_tree but records every drawn segment as (x0,y0,x1,y1,w0,w1,depth) in `segments`
    so bark detail, knots, moss and roots can be placed afterwards. `twist` adds a persistent
    curl to branch angles for more gnarled silhouettes."""
    if trunk_w is None:
        trunk_w = height * 0.09
    if depth > max_depth or height < 4:
        return
    a = math.radians(angle + lean)
    seg = height * (0.55 if depth == 0 else 0.62)
    mx = x + math.cos(a) * seg * 0.5 + rs.uniform(-1, 1) * seg * gnarl * 0.3
    my = y + math.sin(a) * seg * 0.5 + rs.uniform(-1, 1) * seg * gnarl * 0.12
    ex = x + math.cos(a) * seg + rs.uniform(-1, 1) * seg * gnarl * 0.4
    ey = y + math.sin(a) * seg + rs.uniform(-1, 1) * seg * gnarl * 0.15
    w_end = trunk_w * 0.62
    draw_tapered_line(draw, (x, y), (mx, my), trunk_w, (trunk_w + w_end) / 2, fill)
    draw_tapered_line(draw, (mx, my), (ex, ey), (trunk_w + w_end) / 2, w_end, fill)
    if segments is not None:
        segments.append((x, y, mx, my, trunk_w, (trunk_w + w_end) / 2, depth))
        segments.append((mx, my, ex, ey, (trunk_w + w_end) / 2, w_end, depth))
    n = 2 if depth < 2 else rs.choice([1, 2, 2, 3])
    base_angle = math.degrees(math.atan2(ey - my, ex - mx))
    for i in range(n):
        da = rs.uniform(-spread, spread) + (spread * 0.6 if i == 0 else -spread * 0.6 if i == 1 else 0)
        draw_tree2(draw, ex, ey, height * rs.uniform(0.52, 0.7), rs, fill, w_end, depth + 1, max_depth,
                   base_angle + da + twist, spread, lean * 0.5, gnarl, segments, twist)
    if depth >= 1 and rs.rand() < 0.5:
        t = rs.uniform(0.3, 0.8)
        sx, sy = x + (ex - x) * t, y + (ey - y) * t
        draw_tree2(draw, sx, sy, height * rs.uniform(0.25, 0.4), rs, fill, w_end * 0.6, depth + 2, max_depth,
                   base_angle + rs.choice([-1, 1]) * rs.uniform(45, 80), spread, 0, gnarl, segments, twist)


def draw_glow_blob(img, x, y, rx, ry, color, alpha=1.0, power=2.0):
    """Composite a soft elliptical glow (additive-looking via alpha) onto an RGBA image."""
    size = int(max(rx, ry) * 2) + 2
    if size < 2:
        return
    disc = soft_disc(size, color, inner=0.0, power=power)
    if rx != ry:
        disc = disc.resize((max(1, int(rx * 2)), max(1, int(ry * 2))), Image.BILINEAR)
    disc = multiply_alpha(disc, alpha)
    img.alpha_composite(disc, (int(x - disc.size[0] / 2), int(y - disc.size[1] / 2)))


def polygon_rotated(cx, cy, pts, angle_deg):
    """Rotate a list of (x,y) points (relative to origin) by angle and translate to (cx,cy)."""
    a = math.radians(angle_deg)
    c, s = math.cos(a), math.sin(a)
    return [(cx + px * c - py * s, cy + px * s + py * c) for px, py in pts]


# ------------------------------------------------------ sprite shading helpers ----
# (added for gen_sprites.py: height fields, normal maps, float blurs; pure NumPy)

def box_blur_f(arr, r):
    """Box blur of a float (h,w) array with radius r (px) using cumulative sums (edge-clamped)."""
    if r < 1:
        return arr.astype(np.float64)
    a = np.asarray(arr, dtype=np.float64)
    for axis in (0, 1):
        n = a.shape[axis]
        pad = [(0, 0), (0, 0)]
        pad[axis] = (r, r)
        p = np.pad(a, pad, mode='edge')
        c = np.cumsum(p, axis=axis)
        c = np.concatenate([np.zeros_like(np.take(c, [0], axis=axis)), c], axis=axis)
        hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
        lo = np.take(c, np.arange(0, n), axis=axis)
        a = (hi - lo) / (2 * r + 1)
    return a


def gauss_f(arr, sigma):
    """Approximate Gaussian blur of a float (h,w) array via three box blurs."""
    if sigma <= 0.3:
        return np.asarray(arr, dtype=np.float64)
    r = max(1, int(round(sigma * 0.9)))
    a = np.asarray(arr, dtype=np.float64)
    for _ in range(3):
        a = box_blur_f(a, r)
    return a


def chamfer_dt(mask):
    """Approximate Euclidean distance (in px) from every True pixel of a boolean (h,w) mask to the
    nearest False pixel (chamfer 3-4 metric, two passes, vectorised per row)."""
    mask = np.asarray(mask, dtype=bool)
    H, W = mask.shape
    INF = 1e6
    d = np.where(mask, INF, 0.0)
    xs = np.arange(W, dtype=np.float64) * 3.0

    def hpass(row):
        r1 = np.minimum.accumulate(row - xs) + xs
        r2 = np.minimum.accumulate((row + xs)[::-1])[::-1] - xs
        return np.minimum(r1, r2)

    def vcand(prev):
        c = prev + 3.0
        c[1:] = np.minimum(c[1:], prev[:-1] + 4.0)
        c[:-1] = np.minimum(c[:-1], prev[1:] + 4.0)
        return c

    d[0] = hpass(d[0])
    for y in range(1, H):
        d[y] = hpass(np.minimum(d[y], vcand(d[y - 1])))
    for y in range(H - 2, -1, -1):
        d[y] = hpass(np.minimum(d[y], vcand(d[y + 1])))
    d[~mask] = 0.0
    return np.minimum(d, INF) / 3.0


def height_to_normals(h, strength=1.0, wrap_x=False):
    """Image-space normals (y down) from a height field h (h,w) in pixel units: returns (nx, ny, nz)."""
    h = np.asarray(h, dtype=np.float64)
    if wrap_x:
        hx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    else:
        hx = np.gradient(h, axis=1)
    hy = np.gradient(h, axis=0)
    nx, ny, nz = -hx * strength, -hy * strength, np.ones_like(h)
    L = np.sqrt(nx * nx + ny * ny + nz * nz)
    return nx / L, ny / L, nz / L


def encode_normal_map(nx, ny, nz, alpha, scale=1):
    """Encode image-space normals (y down) as an OpenGL-convention (green = up) tangent-space normal
    map RGBA image, optionally block-downsampling by `scale`. Transparent pixels are (128,128,255,0)."""
    a = np.asarray(alpha, dtype=np.float64)
    if scale > 1:
        H, W = a.shape
        h2, w2 = H // scale, W // scale
        blk = lambda v: v[:h2 * scale, :w2 * scale].reshape(h2, scale, w2, scale).mean(axis=(1, 3))
        wgt = blk(np.clip(a, 0, 1)) + 1e-6
        nx = blk(nx * np.clip(a, 0, 1)) / wgt
        ny = blk(ny * np.clip(a, 0, 1)) / wgt
        nz = blk(nz * np.clip(a, 0, 1)) / wgt
        a = blk(a)
        L = np.sqrt(nx * nx + ny * ny + nz * nz) + 1e-9
        nx, ny, nz = nx / L, ny / L, nz / L
    r = np.clip(nx * 0.5 + 0.5, 0, 1) * 255
    g = np.clip(-ny * 0.5 + 0.5, 0, 1) * 255
    b = np.clip(nz * 0.5 + 0.5, 0, 1) * 255
    vis = a > 0.002
    r = np.where(vis, r, 128); g = np.where(vis, g, 128); b = np.where(vis, b, 255)
    rgb = np.dstack([r, g, b]).astype(np.uint8)
    return Image.fromarray(np.dstack([rgb, np.clip(a * 255, 0, 255).astype(np.uint8)]), 'RGBA')


def downsample_premultiplied(rgba_arr, scale):
    """LANCZOS-downsample an RGBA float array (0..255) by an integer factor with premultiplied alpha
    so transparent neighbours do not darken the edges."""
    arr = np.asarray(rgba_arr, dtype=np.float64)
    H, W = arr.shape[:2]
    w2, h2 = W // scale, H // scale
    a = arr[..., 3] / 255.0
    chans = []
    for c in range(3):
        im = Image.fromarray((arr[..., c] * a).astype(np.float32), 'F').resize((w2, h2), Image.LANCZOS)
        chans.append(np.array(im, dtype=np.float64))
    ai = np.array(Image.fromarray(a.astype(np.float32), 'F').resize((w2, h2), Image.LANCZOS), dtype=np.float64)
    ai = np.clip(ai, 0, 1)
    rgb = [np.clip(np.where(ai > 1e-4, ch / np.maximum(ai, 1e-4), 0), 0, 255) for ch in chans]
    out = np.dstack(rgb + [ai * 255]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')

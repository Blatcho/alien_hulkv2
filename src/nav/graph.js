// Room-level navigation. Nodes are portal endpoints (and vent openings); inside a room
// movement is 1D along the floor, so in-room edges cost |dx| / speed. Portal edges cost
// their traversal time. Used for alien hunting (with vents) and for map-click routing.
import { SQUAD, ALIEN } from '../core/config.js';
import { portalEnds } from '../gen/level.js';

export class NavGraph {
  constructor(level) {
    this.level = level;
    this.nodes = [];       // {room, x, y, link: [{to, cost, step}]}
    this.byRoom = level.rooms.map(() => []);
    for (const p of level.portals) {
      const ends = portalEnds(level, p);
      const na = this.add(p.a, ends[p.a]);
      const nb = this.add(p.b, ends[p.b]);
      const cost = p.kind === 'door' ? 0.4
        : p.kind === 'ladder' ? (p.yHigh - p.yLow) / SQUAD.CLIMB
        : Math.hypot(p.xt - p.xb, p.yHigh - p.yLow) / SQUAD.STAIRS;
      this.connect(na, nb, cost, { type: 'portal', portal: p.id }, false);
    }
    this.ventNode = new Map();
    for (const v of level.vents ?? []) this.ventNode.set(v.id, this.add(v.room, v, v.id));
    for (const v of level.vents ?? []) {
      for (const o of v.links) {
        if (o < v.id) continue;
        const d = Math.hypot(level.vents[o].x - v.x, level.vents[o].y - v.y) + 2;
        this.connect(this.ventNode.get(v.id), this.ventNode.get(o), d / ALIEN.VENT_SPEED, { type: 'vent' }, true);
      }
    }
  }

  weldedVent(id) { return id !== null && id !== undefined && !!this.level.vents?.[id]?.welded; }

  add(room, { x, y }, vent = null) {
    const id = this.nodes.length;
    this.nodes.push({ id, room, x, y, vent, link: [] });
    this.byRoom[room].push(id);
    return id;
  }

  connect(a, b, cost, step, ventOnly) {
    this.nodes[a].link.push({ to: b, cost, step, ventOnly });
    this.nodes[b].link.push({ to: a, cost, step, ventOnly });
  }

  /**
   * Cheapest route between two floor positions.
   * @param {{room:number,x:number}} from @param {{room:number,x:number}} to
   * @param {{vents?:boolean, speed?:number, blocked?:(portalId)=>boolean}} opt
   * @returns {{cost:number, steps:Array}|null} steps: {type:'walk', room, x} | {type:'portal', portal, from, to} | {type:'vent', from, to}
   */
  route(from, to, { vents = false, speed = SQUAD.WALK, blocked = null } = {}) {
    const n = this.nodes.length;
    const START = n;
    const GOAL = n + 1;
    const dist = new Float64Array(n + 2).fill(Infinity);
    const prev = new Int32Array(n + 2).fill(-1);
    const via = new Array(n + 2);
    const done = new Uint8Array(n + 2);
    dist[START] = 0;
    const inRoom = (room, x, idx) => this.byRoom[room].map((j) => ({ to: j, cost: Math.abs(this.nodes[j].x - x) / speed })).filter((e) => e.to !== idx);

    for (;;) {
      let u = -1;
      let best = Infinity;
      for (let i = 0; i < n + 2; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u === -1 || u === GOAL) break;
      done[u] = 1;
      const here = u === START ? from : this.nodes[u];
      const edges = inRoom(here.room, here.x, u);
      if (here.room === to.room) edges.push({ to: GOAL, cost: Math.abs(to.x - here.x) / speed });
      if (u !== START) {
        for (const l of this.nodes[u].link) {
          if (l.ventOnly && !vents) continue;
          if (l.step.type === 'vent' && (this.weldedVent(this.nodes[u].vent) || this.weldedVent(this.nodes[l.to].vent))) continue;
          if (l.step.type === 'portal' && blocked?.(l.step.portal)) continue;
          edges.push({ to: l.to, cost: l.cost, step: l.step });
        }
      }
      for (const e of edges) {
        const nd = dist[u] + e.cost;
        if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; via[e.to] = e.step ?? null; }
      }
    }
    if (dist[GOAL] === Infinity) return null;

    const chain = [];
    for (let v = GOAL; v !== START; v = prev[v]) chain.unshift(v);
    const steps = [];
    let cur = START;
    for (const v of chain) {
      const step = via[v];
      if (step) {
        const a = this.nodes[cur];
        const b = this.nodes[v];
        if (step.type === 'portal') steps.push({ type: 'portal', portal: step.portal, from: a.room, to: b.room });
        else steps.push({ type: 'vent', from: a.vent, to: b.vent, fromRoom: a.room, toRoom: b.room });
      } else {
        const node = v === GOAL ? to : this.nodes[v];
        steps.push({ type: 'walk', room: node.room, x: node.x });
      }
      cur = v;
    }
    return { cost: dist[GOAL], steps };
  }
}

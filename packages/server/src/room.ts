/**
 * Pure room logic for online play: lobby, match loop, reconnects, abuse limits.
 * No Cloudflare / Node APIs; time and randomness are injected so tests are deterministic.
 */
import {
  BOT_NAMES,
  BotController,
  CONFIG,
  Phase,
  createMatch,
  encodeSnap,
  parseClientMsg,
  pickBotSetup,
  sanitizeNickname,
  step,
  type BotDifficulty,
  type CharacterId,
  type ErrorCode,
  type LobbyMember,
  type MatchState,
  type PlayerInput,
  type PlayerSetup,
  type ServerMsg,
  type SimEvent,
  type Tile,
} from "@lava-sumo/shared";

export type ConnId = string;
export type Outgoing = { to: ConnId | "all"; msg: ServerMsg } | { close: ConnId; code: ErrorCode };

export interface RoomDeps {
  random: () => number;
  randomSeed: () => number;
}

const MAX_TOKEN_LEN = 64;
const TOTAL_SLOTS = 4;

interface Member {
  id: string;
  token: string;
  nickname: string;
  character: CharacterId;
  conn: ConnId | null;
  /** When the socket dropped; -Infinity if the player left for good. */
  disconnectedAt: number;
  input: PlayerInput;
  lastSeq: number;
  lastMsgAt: number;
  bot: BotController | null;
}

interface ConnState {
  member: Member | null;
  windowStart: number;
  windowCount: number;
  overSince: number | null;
}

export class RoomLogic {
  private phase: Phase = Phase.LOBBY;
  private difficulty: BotDifficulty = "medium";
  private readonly members: Member[] = []; // join order
  private readonly conns = new Map<ConnId, ConnState>();
  /** Starts at construction (a never-joined room dies too); cleared on join, restarted when the last human leaves. */
  private emptySince: number | null;
  /** Last message from any connection; bounds the life of idle LOBBY/RESULTS rooms. */
  private lastActivityAt: number;

  private state: MatchState | null = null;
  private bots: BotController[] = [];
  private startInfo: { seed: number; setups: PlayerSetup[] } | null = null;
  private countdownEndsAt = 0;
  private lastSimMs = 0;
  private acc = 0;
  private nextSnapAt = 0;
  private snapTiles: Tile[] | null = null;
  private pendingEvents: SimEvent[] = [];

  constructor(
    private readonly code: string,
    private readonly deps: RoomDeps,
    createdAtMs: number,
  ) {
    this.emptySince = createdAtMs;
    this.lastActivityAt = createdAtMs;
  }

  // ---- queries ----

  joinable(): { ok: true } | { ok: false; code: "FULL" | "IN_PROGRESS" } {
    if (this.phase === Phase.COUNTDOWN || this.phase === Phase.PLAYING) return { ok: false, code: "IN_PROGRESS" };
    if (this.members.length >= CONFIG.NET_MAX_HUMANS) return { ok: false, code: "FULL" };
    return { ok: true };
  }

  needsTicking(): boolean {
    return (
      this.phase === Phase.COUNTDOWN ||
      this.phase === Phase.PLAYING ||
      this.emptySince !== null ||
      this.members.some((m) => m.conn === null && Number.isFinite(m.disconnectedAt))
    );
  }

  isDead(nowMs: number): boolean {
    if (this.emptySince !== null && nowMs - this.emptySince >= CONFIG.NET_EMPTY_ROOM_MS) return true;
    const idlePhase = this.phase === Phase.LOBBY || this.phase === Phase.RESULTS;
    return idlePhase && nowMs - this.lastActivityAt >= CONFIG.NET_IDLE_ROOM_MS;
  }

  // ---- connection lifecycle ----

  connect(conn: ConnId, _nowMs: number): Outgoing[] {
    this.conns.set(conn, { member: null, windowStart: 0, windowCount: 0, overSince: null });
    return [];
  }

  disconnect(conn: ConnId, nowMs: number): Outgoing[] {
    const cs = this.conns.get(conn);
    this.conns.delete(conn);
    const m = cs?.member;
    if (!m || m.conn !== conn) return [];
    return this.dropMember(m, nowMs, false);
  }

  message(conn: ConnId, raw: unknown, nowMs: number): Outgoing[] {
    const cs = this.conns.get(conn);
    if (!cs) return [];
    this.lastActivityAt = nowMs;
    if (cs.member) cs.member.lastMsgAt = nowMs;
    // Rate limit every message (pre-join and invalid included); over-limit ones are dropped unprocessed.
    const verdict = this.allowMessage(cs, nowMs);
    if (verdict === "kick") return [{ close: conn, code: "KICKED" }, ...this.disconnect(conn, nowMs)];
    if (verdict === "drop") return [];
    const msg = parseClientMsg(raw);
    if (!msg) return [];
    const m = cs.member;
    if (msg.t === "join") return m ? [] : this.join(conn, cs, msg.token, msg.nickname, msg.character, nowMs);
    if (!m) return [];
    const isHost = this.hostId() === m.id;

    switch (msg.t) {
      case "in": {
        if (msg.seq <= m.lastSeq) return [];
        m.lastSeq = msg.seq;
        m.input = { seq: msg.seq, dirX: msg.dirX, dirZ: msg.dirZ, skill: msg.skill };
        return [];
      }
      case "pick":
        if (this.phase !== Phase.LOBBY) return [];
        m.character = msg.character;
        return [this.lobbyMsg()];
      case "diff":
        if (this.phase !== Phase.LOBBY || !isHost) return [];
        this.difficulty = msg.difficulty;
        return [this.lobbyMsg()];
      case "start":
        if (this.phase !== Phase.LOBBY || !isHost) return [];
        return this.startMatch(nowMs);
      case "again":
        if (this.phase !== Phase.RESULTS) return [];
        return this.backToLobby();
      case "leave":
        return this.dropMember(m, nowMs, true);
    }
  }

  // ---- simulation ----

  tick(nowMs: number): Outgoing[] {
    const out: Outgoing[] = [];
    const st = this.state;
    if (this.phase === Phase.COUNTDOWN && st) {
      if (nowMs >= this.countdownEndsAt) {
        this.phase = Phase.PLAYING;
        this.lastSimMs = nowMs;
        this.acc = 0;
        out.push(this.lobbyMsg());
      }
      this.maybeSnap(nowMs, out);
    } else if (this.phase === Phase.PLAYING && st) {
      this.acc += nowMs - this.lastSimMs;
      this.lastSimMs = nowMs;
      let steps = 0;
      while (this.acc >= CONFIG.TICK_MS && steps < CONFIG.MAX_CATCHUP_STEPS && this.state!.phase === Phase.PLAYING) {
        this.stepOnce(nowMs);
        this.acc -= CONFIG.TICK_MS;
        steps++;
      }
      if (steps === CONFIG.MAX_CATCHUP_STEPS) this.acc = 0;
      if (this.state!.phase === Phase.PLAYING) {
        this.maybeSnap(nowMs, out);
      } else {
        this.phase = Phase.RESULTS;
        this.lastActivityAt = nowMs;
        this.sendSnap(nowMs, out);
        out.push(this.lobbyMsg());
      }
    }
    return out;
  }

  // ---- internals ----

  private stepOnce(nowMs: number): void {
    const state = this.state!;
    const seq = state.tick + 1;
    const inputs: Record<string, PlayerInput> = {};
    for (const m of this.members) inputs[m.id] = m.bot ? { ...m.bot.input(state, seq), seq: 0 } // bots never advance lastProcessedSeq
        : nowMs - m.lastMsgAt > CONFIG.NET_SILENT_INPUT_MS
          ? { seq: Math.max(0, m.lastSeq), dirX: 0, dirZ: 0, skill: false } // silent connection: don't keep steering
          : m.input;
    for (const b of this.bots) inputs[b.playerId] = b.input(state, seq);
    const r = step(state, inputs);
    this.state = r.state;
    this.pendingEvents.push(...r.events);
  }

  private maybeSnap(nowMs: number, out: Outgoing[]): void {
    if (this.snapTiles !== null && nowMs < this.nextSnapAt - 1e-6) return;
    this.sendSnap(nowMs, out);
    // Advance on a fixed 50 ms grid so a 33 ms tick still averages 20 snaps/s.
    this.nextSnapAt = Math.max(this.nextSnapAt + CONFIG.NET_SNAP_MS, nowMs + 1);
  }

  private sendSnap(nowMs: number, out: Outgoing[]): void {
    const state = this.state!;
    const snap = encodeSnap(state, this.snapTiles, this.pendingEvents);
    snap.phase = this.phase;
    this.snapTiles = state.tiles;
    this.pendingEvents = [];
    out.push({ to: "all", msg: { t: "snap", ...snap } });
  }

  private startMatch(nowMs: number): Outgoing[] {
    const seed = this.deps.randomSeed() >>> 0;
    const botSetups = pickBotSetup(seed, Math.max(0, TOTAL_SLOTS - this.members.length));
    const setups: PlayerSetup[] = [
      ...this.members.map((m) => ({ id: m.id, nickname: m.nickname, character: m.character, isBot: false })),
      ...botSetups.map((b, i) => ({ id: `bot${i + 1}`, nickname: b.nickname, character: b.character, isBot: true })),
    ];
    this.state = createMatch(seed, setups);
    this.bots = botSetups.map((_, i) => new BotController(`bot${i + 1}`, this.difficulty, (seed ^ (i + 1)) >>> 0));
    for (const m of this.members) {
      m.lastSeq = -1;
      m.lastMsgAt = nowMs;
      m.input = { seq: 0, dirX: 0, dirZ: 0, skill: false };
      m.bot = null;
    }
    this.snapTiles = null;
    this.nextSnapAt = 0;
    this.pendingEvents = [];
    this.acc = 0;
    this.phase = Phase.COUNTDOWN;
    this.countdownEndsAt = nowMs + CONFIG.NET_COUNTDOWN_MS;
    this.startInfo = { seed, setups };
    const startMsg: ServerMsg = { t: "start", seed, setups, countdownMs: CONFIG.NET_COUNTDOWN_MS };
    return [{ to: "all", msg: startMsg }, this.lobbyMsg()];
  }

  private backToLobby(): Outgoing[] {
    for (let i = this.members.length - 1; i >= 0; i--) {
      if (this.members[i]!.conn === null) this.members.splice(i, 1);
    }
    for (const m of this.members) m.bot = null;
    this.phase = Phase.LOBBY;
    this.state = null;
    this.startInfo = null;
    this.bots = [];
    this.snapTiles = null;
    this.pendingEvents = [];
    return [this.lobbyMsg()];
  }

  private join(
    conn: ConnId,
    cs: ConnState,
    token: string,
    rawNick: string,
    character: CharacterId,
    nowMs: number,
  ): Outgoing[] {
    if (token.length === 0 || token.length > MAX_TOKEN_LEN) return [];
    const out: Outgoing[] = [];
    let m = this.members.find((x) => x.token === token);
    const rejoined = m !== undefined;

    if (m) {
      if (m.conn !== null) {
        const old = m.conn;
        this.conns.delete(old);
        out.push({ close: old, code: "REPLACED" });
      } else if (
        (this.phase === Phase.COUNTDOWN || this.phase === Phase.PLAYING) &&
        nowMs - m.disconnectedAt >= CONFIG.NET_RECONNECT_MS
      ) {
        this.conns.delete(conn);
        return [{ close: conn, code: "IN_PROGRESS" }];
      }
      m.conn = conn;
      m.input = { seq: 0, dirX: 0, dirZ: 0, skill: false };
      m.bot = null;
      m.disconnectedAt = 0;
      m.lastSeq = -1;
      m.lastMsgAt = nowMs;
      // Client seq may restart; bot driving never advanced it, so clear any stale value.
      const p = this.state?.players.find((x) => x.id === m!.id);
      if (p) p.lastProcessedSeq = 0;
    } else {
      const j = this.joinable();
      if (!j.ok) {
        this.conns.delete(conn); // the adapter drops its socket handle on close, so no disconnect() will follow
        return [{ close: conn, code: j.code }];
      }
      const used = new Set(this.members.map((x) => x.id));
      let n = 1;
      while (used.has(`p${n}`)) n++;
      const nickname = sanitizeNickname(rawNick, () => this.randomNick());
      m = {
        id: `p${n}`,
        token,
        nickname,
        character,
        conn,
        disconnectedAt: 0,
        input: { seq: 0, dirX: 0, dirZ: 0, skill: false },
        lastSeq: -1,
        lastMsgAt: nowMs,
        bot: null,
      };
      this.members.push(m);
    }
    cs.member = m;
    this.emptySince = null;
    out.push({ to: conn, msg: { t: "welcome", you: m.id, code: this.code } }, this.lobbyMsg());
    const inMatch = this.startInfo?.setups.some((s) => s.id === m!.id) === true;
    if (rejoined && inMatch && this.state && this.startInfo && this.phase !== Phase.LOBBY) {
      // Resync only this conn: the match setup, then a full snapshot. (A friend who joined during RESULTS
      // is not in setups; they just see the lobby until the next match.)
      const remaining = this.phase === Phase.COUNTDOWN ? Math.max(0, this.countdownEndsAt - nowMs) : 0;
      out.push({ to: conn, msg: { t: "start", ...this.startInfo, countdownMs: remaining } });
      // Rejoining into RESULTS: replay the match end so the client shows its results screen.
      const ended: SimEvent[] =
        this.phase === Phase.RESULTS && this.state.result ? [{ type: "matchEnd", result: this.state.result }] : [];
      const snap = encodeSnap(this.state, null, ended);
      snap.phase = this.phase;
      out.push({ to: conn, msg: { t: "snap", ...snap } });
    }
    return out;
  }

  private dropMember(m: Member, nowMs: number, forever: boolean): Outgoing[] {
    if (m.conn !== null) {
      const cs = this.conns.get(m.conn);
      if (cs) cs.member = null;
    }
    m.conn = null;
    if (this.phase === Phase.LOBBY) {
      this.members.splice(this.members.indexOf(m), 1);
    } else {
      m.disconnectedAt = forever ? -Infinity : nowMs;
      if (this.state && this.phase !== Phase.RESULTS && !m.bot) {
        m.bot = new BotController(m.id, this.difficulty, (this.deps.randomSeed() ^ 0x9e3779b9) >>> 0);
      }
    }
    if (!this.members.some((x) => x.conn !== null)) this.emptySince = nowMs;
    return [this.lobbyMsg()];
  }

  private hostId(): string {
    return (this.members.find((m) => m.conn !== null) ?? this.members[0])?.id ?? "";
  }

  private lobbyMsg(): Outgoing {
    const members: LobbyMember[] = this.members.map((m) => ({
      id: m.id,
      nickname: m.nickname,
      character: m.character,
      connected: m.conn !== null,
    }));
    return {
      to: "all",
      msg: { t: "lobby", phase: this.phase, hostId: this.hostId(), difficulty: this.difficulty, members },
    };
  }

  private randomNick(): string {
    const i = Math.min(BOT_NAMES.length - 1, Math.floor(this.deps.random() * BOT_NAMES.length));
    return BOT_NAMES[i]!;
  }

  /** Fixed 1 s windows. "kick" = continuously over the limit for NET_ABUSE_KICK_MS. */
  private allowMessage(cs: ConnState, nowMs: number): "ok" | "drop" | "kick" {
    if (nowMs - cs.windowStart >= 1000) {
      if (cs.overSince !== null && cs.windowCount <= CONFIG.NET_SERVER_MSG_MAX_PER_SEC) cs.overSince = null;
      cs.windowStart = nowMs;
      cs.windowCount = 0;
    }
    cs.windowCount++;
    if (cs.windowCount > CONFIG.NET_SERVER_MSG_MAX_PER_SEC) {
      if (cs.overSince === null) cs.overSince = nowMs;
      if (nowMs - cs.overSince >= CONFIG.NET_ABUSE_KICK_MS) return "kick";
      return "drop";
    }
    return "ok";
  }
}

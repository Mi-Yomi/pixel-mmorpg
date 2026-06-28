import './style.css';

const TILE = 32;
const WORLD_W = 1600;
const WORLD_H = 1088;
const SAVE_KEY = 'pixel-mmorpg-save-v1';
const ASSET_BASE = `${import.meta.env.BASE_URL}assets/generated/`;

const imageFiles = {
  playerSprite: 'clean_player.png',
  elderSprite: 'clean_elder.png',
  merchantSprite: 'clean_merchant.png',
  elderPortrait: 'elder_portrait.png',
  merchantPortrait: 'merchant_portrait.png',
  slimeSprite: 'clean_slime.png',
  tileset: 'tileset_generated.png',
} as const;

type ImageKey = keyof typeof imageFiles;
type Images = Record<ImageKey, HTMLImageElement>;
type NpcId = 'miron' | 'anya';

interface Vec {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Player {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  gold: number;
  speed: number;
  facing: Vec;
  attackCd: number;
}

interface Slime {
  id: number;
  x: number;
  y: number;
  spawnX: number;
  spawnY: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  respawn: number;
  attackCd: number;
  hitFlash: number;
}

interface Npc {
  id: NpcId;
  name: string;
  title: string;
  x: number;
  y: number;
  portrait: ImageKey;
  sprite: ImageKey;
  frame: number;
}

interface QuestState {
  killStarted: boolean;
  kills: number;
  rewarded: boolean;
  potionDone: boolean;
  exitUnlocked: boolean;
  complete: boolean;
}

interface SaveState {
  version: 1;
  player: Pick<Player, 'x' | 'y' | 'hp' | 'gold'>;
  quest: QuestState;
  inventory: string[];
}

interface Dialogue {
  speaker: string;
  title: string;
  text: string;
  portrait: ImageKey;
}

interface Notice {
  text: string;
  ttl: number;
}

const houses: Rect[] = [
  { x: 232, y: 254, w: 126, h: 102 },
  { x: 520, y: 244, w: 136, h: 106 },
  { x: 272, y: 704, w: 136, h: 108 },
  { x: 702, y: 330, w: 130, h: 104 },
];

const well: Rect = { x: 465, y: 515, w: 70, h: 70 };
const gate: Rect = { x: 1460, y: 472, w: 86, h: 130 };
const exitTrigger: Rect = { x: 1538, y: 468, w: 60, h: 140 };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointInRect(p: Vec, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

function circleRect(cx: number, cy: number, radius: number, rect: Rect): boolean {
  const nx = clamp(cx, rect.x, rect.x + rect.w);
  const ny = clamp(cy, rect.y, rect.y + rect.h);
  return Math.hypot(cx - nx, cy - ny) < radius;
}

function riverCenter(y: number): number {
  return 1168 + Math.sin(y / 126) * 54 + Math.sin(y / 53) * 18;
}

function isBridge(x: number, y: number): boolean {
  return x > 1090 && x < 1280 && y > 488 && y < 590;
}

function isRiver(x: number, y: number): boolean {
  return Math.abs(x - riverCenter(y)) < 66 && !isBridge(x, y);
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function loadImages(): Promise<Images> {
  const entries = Object.entries(imageFiles) as Array<[ImageKey, string]>;
  return Promise.all(
    entries.map(
      ([key, file]) =>
        new Promise<[ImageKey, HTMLImageElement]>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve([key, image]);
          image.onerror = () => reject(new Error(`Не удалось загрузить ${file}`));
          image.src = `${ASSET_BASE}${file}`;
        }),
    ),
  ).then((loaded) => Object.fromEntries(loaded) as Images);
}

class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly images: Images;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private camera: Vec = { x: 0, y: 0 };
  private last = performance.now();
  private keys = new Set<string>();
  private touch = new Set<string>();
  private saveTimer = 0;
  private player: Player = {
    x: 382,
    y: 565,
    hp: 100,
    maxHp: 100,
    gold: 0,
    speed: 176,
    facing: { x: 0, y: 1 },
    attackCd: 0,
  };
  private quest: QuestState = {
    killStarted: false,
    kills: 0,
    rewarded: false,
    potionDone: false,
    exitUnlocked: false,
    complete: false,
  };
  private inventory: string[] = ['Хлеб'];
  private dialogue: Dialogue | null = null;
  private notices: Notice[] = [];
  private trees: Vec[] = [];
  private npcs: Npc[] = [
    {
      id: 'miron',
      name: 'Мирон',
      title: 'староста',
      x: 432,
      y: 468,
      portrait: 'elderPortrait',
      sprite: 'elderSprite',
      frame: 0,
    },
    {
      id: 'anya',
      name: 'Аня',
      title: 'торговка',
      x: 640,
      y: 570,
      portrait: 'merchantPortrait',
      sprite: 'merchantSprite',
      frame: 1,
    },
  ];
  private slimes: Slime[] = [
    { id: 1, x: 930, y: 234, spawnX: 930, spawnY: 234, hp: 2, maxHp: 2, alive: true, respawn: 0, attackCd: 0, hitFlash: 0 },
    { id: 2, x: 1030, y: 290, spawnX: 1030, spawnY: 290, hp: 2, maxHp: 2, alive: true, respawn: 0, attackCd: 0, hitFlash: 0 },
    { id: 3, x: 875, y: 380, spawnX: 875, spawnY: 380, hp: 2, maxHp: 2, alive: true, respawn: 0, attackCd: 0, hitFlash: 0 },
    { id: 4, x: 1110, y: 408, spawnX: 1110, spawnY: 408, hp: 2, maxHp: 2, alive: true, respawn: 0, attackCd: 0, hitFlash: 0 },
    { id: 5, x: 1004, y: 486, spawnX: 1004, spawnY: 486, hp: 2, maxHp: 2, alive: true, respawn: 0, attackCd: 0, hitFlash: 0 },
  ];

  constructor(canvas: HTMLCanvasElement, images: Images) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D недоступен');
    }
    this.canvas = canvas;
    this.ctx = ctx;
    this.images = images;
    this.trees = this.buildTrees();
    this.load();
    this.bindEvents();
    this.resize();
    this.notice('Сохранение загружено');
    requestAnimationFrame((time) => this.frame(time));
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (event) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
        event.preventDefault();
      }
      if (event.code === 'KeyE') {
        this.interact();
      } else if (event.code === 'Space') {
        this.attack();
      } else {
        this.keys.add(event.code);
      }
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    document.querySelectorAll<HTMLButtonElement>('[data-hold]').forEach((button) => {
      const action = button.dataset.hold ?? '';
      const down = (event: PointerEvent) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        button.classList.add('is-down');
        this.touch.add(action);
      };
      const up = () => {
        button.classList.remove('is-down');
        this.touch.delete(action);
      };
      button.addEventListener('pointerdown', down);
      button.addEventListener('pointerup', up);
      button.addEventListener('pointercancel', up);
      button.addEventListener('pointerleave', up);
    });
    document.querySelectorAll<HTMLButtonElement>('[data-tap]').forEach((button) => {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        button.classList.add('is-down');
        if (button.dataset.tap === 'interact') this.interact();
        if (button.dataset.tap === 'attack') this.attack();
      });
      button.addEventListener('pointerup', () => button.classList.remove('is-down'));
      button.addEventListener('pointercancel', () => button.classList.remove('is-down'));
    });
  }

  private resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(320, window.innerWidth);
    this.height = Math.max(240, window.innerHeight);
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  private frame(time: number): void {
    const dt = Math.min(0.05, (time - this.last) / 1000);
    this.last = time;
    this.update(dt);
    this.draw();
    requestAnimationFrame((next) => this.frame(next));
  }

  private update(dt: number): void {
    if (!this.quest.complete) {
      this.updatePlayer(dt);
      this.updateSlimes(dt);
      if (this.quest.exitUnlocked && pointInRect(this.player, exitTrigger)) {
        this.quest.complete = true;
        this.dialogue = null;
        this.notice('Продолжение следует');
        this.save();
      }
    }

    this.player.attackCd = Math.max(0, this.player.attackCd - dt);
    this.notices.forEach((notice) => (notice.ttl -= dt));
    this.notices = this.notices.filter((notice) => notice.ttl > 0);
    this.saveTimer += dt;
    if (this.saveTimer > 1.5) {
      this.saveTimer = 0;
      this.save();
    }
    this.camera.x = clamp(this.player.x - this.width / 2, 0, WORLD_W - this.width);
    this.camera.y = clamp(this.player.y - this.height / 2, 0, WORLD_H - this.height);
  }

  private updatePlayer(dt: number): void {
    const move = { x: 0, y: 0 };
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.touch.has('up')) move.y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown') || this.touch.has('down')) move.y += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft') || this.touch.has('left')) move.x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight') || this.touch.has('right')) move.x += 1;
    const length = Math.hypot(move.x, move.y);
    if (length === 0 || this.dialogue) return;

    move.x /= length;
    move.y /= length;
    this.player.facing = { ...move };
    const step = this.player.speed * dt;
    const nx = this.player.x + move.x * step;
    if (!this.blocked(nx, this.player.y, 15)) this.player.x = nx;
    const ny = this.player.y + move.y * step;
    if (!this.blocked(this.player.x, ny, 15)) this.player.y = ny;
  }

  private updateSlimes(dt: number): void {
    for (const slime of this.slimes) {
      slime.hitFlash = Math.max(0, slime.hitFlash - dt);
      slime.attackCd = Math.max(0, slime.attackCd - dt);
      if (!slime.alive) {
        slime.respawn -= dt;
        if (slime.respawn <= 0 && this.quest.kills < 5) {
          slime.alive = true;
          slime.hp = slime.maxHp;
          slime.x = slime.spawnX + Math.sin(performance.now() / 900 + slime.id) * 14;
          slime.y = slime.spawnY + Math.cos(performance.now() / 1100 + slime.id) * 14;
        }
        continue;
      }

      const toPlayer = { x: this.player.x - slime.x, y: this.player.y - slime.y };
      const distance = Math.hypot(toPlayer.x, toPlayer.y);
      if (distance < 300 && !this.dialogue && !this.quest.complete) {
        const speed = distance < 120 ? 72 : 46;
        const nx = slime.x + (toPlayer.x / Math.max(1, distance)) * speed * dt;
        const ny = slime.y + (toPlayer.y / Math.max(1, distance)) * speed * dt;
        if (!this.blocked(nx, slime.y, 12)) slime.x = nx;
        if (!this.blocked(slime.x, ny, 12)) slime.y = ny;
      } else {
        slime.x += Math.sin(performance.now() / 760 + slime.id * 2) * 6 * dt;
        slime.y += Math.cos(performance.now() / 820 + slime.id) * 6 * dt;
      }

      if (distance < 28 && slime.attackCd <= 0) {
        slime.attackCd = 0.9;
        this.player.hp = Math.max(0, this.player.hp - 7);
        this.notice('-7 здоровья');
        if (this.player.hp <= 0) {
          this.player.hp = this.player.maxHp;
          this.player.x = 382;
          this.player.y = 565;
          this.player.gold = Math.max(0, this.player.gold - 5);
          this.notice('Вы очнулись у колодца');
        }
      }
    }
  }

  private blocked(x: number, y: number, radius: number): boolean {
    if (x < 24 || y < 24 || x > WORLD_W - 24 || y > WORLD_H - 24) return true;
    if (isRiver(x, y)) return true;
    if (!this.quest.exitUnlocked && circleRect(x, y, radius, gate)) return true;
    if (circleRect(x, y, radius, well)) return true;
    return houses.some((house) => circleRect(x, y, radius, house));
  }

  private interact(): void {
    if (this.quest.complete) return;
    if (this.dialogue) {
      this.dialogue = null;
      return;
    }

    const npc = this.npcs.find((candidate) => dist(this.player, candidate) < 68);
    if (npc) {
      this.talk(npc);
      return;
    }

    if (!this.quest.exitUnlocked && dist(this.player, { x: gate.x + gate.w / 2, y: gate.y + gate.h / 2 }) < 115) {
      this.dialogue = {
        speaker: 'Страж',
        title: 'восточный выход',
        text: 'Ворота закрыты. Аня пропустит путника только с дорожным зельем.',
        portrait: 'merchantPortrait',
      };
      return;
    }

    this.notice('Рядом никого нет');
  }

  private talk(npc: Npc): void {
    if (npc.id === 'miron') {
      if (!this.quest.killStarted) {
        this.quest.killStarted = true;
        this.dialogue = {
          speaker: npc.name,
          title: npc.title,
          text: 'Слизни заняли северную поляну. Победите пятерых, и деревня даст вам меч и золото.',
          portrait: npc.portrait,
        };
      } else if (this.quest.kills < 5) {
        this.dialogue = {
          speaker: npc.name,
          title: npc.title,
          text: `Нужно победить еще ${5 - this.quest.kills}. Поляна к северо-востоку, за дорогой.`,
          portrait: npc.portrait,
        };
      } else if (!this.quest.rewarded) {
        this.quest.rewarded = true;
        this.player.gold += 50;
        this.addItem('Меч Ольховки');
        this.dialogue = {
          speaker: npc.name,
          title: npc.title,
          text: 'Дело сделано. Возьмите меч и 50 золотых. Теперь купите у Ани дорожное зелье для восточного выхода.',
          portrait: npc.portrait,
        };
      } else {
        this.dialogue = {
          speaker: npc.name,
          title: npc.title,
          text: 'Аня держит лавку у южной дороги. С зельем ворота откроются.',
          portrait: npc.portrait,
        };
      }
    } else if (!this.quest.rewarded) {
      this.dialogue = {
        speaker: npc.name,
        title: npc.title,
        text: 'Сначала помогите Мирону со слизнями. Потом подберу товар для дороги.',
        portrait: npc.portrait,
      };
    } else if (!this.quest.potionDone) {
      if (this.player.gold >= 30) {
        this.player.gold -= 30;
        this.quest.potionDone = true;
        this.quest.exitUnlocked = true;
        this.addItem('Дорожное зелье');
        this.dialogue = {
          speaker: npc.name,
          title: npc.title,
          text: 'Зелье стоит 30 золотых. Готово: стража у восточного моста уже знает, что вы идете.',
          portrait: npc.portrait,
        };
      } else {
        this.dialogue = {
          speaker: npc.name,
          title: npc.title,
          text: 'Для дорожного зелья нужно 30 золотых. Мирон заплатит, когда поляна будет чистой.',
          portrait: npc.portrait,
        };
      }
    } else {
      this.dialogue = {
        speaker: npc.name,
        title: npc.title,
        text: 'Зелье при вас. Идите через мост к восточному выходу.',
        portrait: npc.portrait,
      };
    }
    this.save();
  }

  private attack(): void {
    if (this.quest.complete || this.dialogue || this.player.attackCd > 0) return;
    this.player.attackCd = this.quest.rewarded ? 0.28 : 0.42;
    const damage = this.quest.rewarded ? 2 : 1;
    let hit = false;
    for (const slime of this.slimes) {
      if (!slime.alive) continue;
      const distance = dist(this.player, slime);
      const forward = {
        x: this.player.x + this.player.facing.x * 28,
        y: this.player.y + this.player.facing.y * 28,
      };
      if (distance < 58 || dist(forward, slime) < 46) {
        hit = true;
        slime.hp -= damage;
        slime.hitFlash = 0.14;
        if (slime.hp <= 0) {
          slime.alive = false;
          slime.respawn = 3.8 + slime.id * 0.3;
          if (this.quest.killStarted && this.quest.kills < 5) {
            this.quest.kills += 1;
            this.notice(`Слизни: ${this.quest.kills}/5`);
            if (this.quest.kills === 5) this.notice('Вернитесь к Мирону');
          } else if (!this.quest.killStarted) {
            this.notice('Мирон ведет счет заданиям');
          }
        }
        break;
      }
    }
    if (!hit) this.notice('Промах');
    this.save();
  }

  private addItem(item: string): void {
    if (!this.inventory.includes(item)) this.inventory.push(item);
  }

  private notice(text: string): void {
    this.notices.unshift({ text, ttl: 2.1 });
    this.notices = this.notices.slice(0, 4);
  }

  private save(): void {
    const state: SaveState = {
      version: 1,
      player: {
        x: Math.round(this.player.x),
        y: Math.round(this.player.y),
        hp: this.player.hp,
        gold: this.player.gold,
      },
      quest: this.quest,
      inventory: this.inventory,
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    } catch {
      return;
    }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw) as Partial<SaveState>;
      if (state.version !== 1 || !state.player || !state.quest) return;
      this.player.x = clamp(Number(state.player.x) || this.player.x, 40, WORLD_W - 40);
      this.player.y = clamp(Number(state.player.y) || this.player.y, 40, WORLD_H - 40);
      this.player.hp = clamp(Number(state.player.hp) || this.player.maxHp, 1, this.player.maxHp);
      this.player.gold = Math.max(0, Number(state.player.gold) || 0);
      this.quest = { ...this.quest, ...state.quest };
      if (Array.isArray(state.inventory)) this.inventory = state.inventory.slice(0, 8);
    } catch {
      return;
    }
  }

  private buildTrees(): Vec[] {
    const trees: Vec[] = [];
    for (let x = 34; x < WORLD_W - 40; x += 70) {
      trees.push({ x, y: 54 + ((x * 17) % 30) });
      trees.push({ x: x + 24, y: WORLD_H - 60 - ((x * 11) % 28) });
    }
    for (let y = 112; y < WORLD_H - 110; y += 78) {
      trees.push({ x: 54 + ((y * 7) % 28), y });
      trees.push({ x: WORLD_W - 72 - ((y * 5) % 34), y: y + 16 });
    }
    for (let i = 0; i < 28; i += 1) {
      trees.push({ x: 780 + ((i * 67) % 360), y: 104 + ((i * 43) % 145) });
    }
    return trees;
  }

  private draw(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.save();
    this.ctx.translate(-this.camera.x, -this.camera.y);
    this.drawTerrain();
    this.drawDecor();
    this.drawEntities();
    this.ctx.restore();
    this.drawHud();
    if (this.dialogue) this.drawDialogue(this.dialogue);
    this.drawNotices();
    if (this.quest.complete) this.drawEnding();
  }

  private drawTerrain(): void {
    const ctx = this.ctx;
    const startX = Math.floor(this.camera.x / TILE) - 1;
    const endX = Math.ceil((this.camera.x + this.width) / TILE) + 1;
    const startY = Math.floor(this.camera.y / TILE) - 1;
    const endY = Math.ceil((this.camera.y + this.height) / TILE) + 1;

    for (let ty = startY; ty <= endY; ty += 1) {
      for (let tx = startX; tx <= endX; tx += 1) {
        const x = tx * TILE;
        const y = ty * TILE;
        const shade = (tx * 19 + ty * 31) % 4;
        ctx.fillStyle = ['#2f7d3d', '#347f42', '#2b7338', '#3a8848'][shade];
        ctx.fillRect(x, y, TILE, TILE);
        if ((tx + ty) % 9 === 0) {
          ctx.fillStyle = 'rgba(245, 221, 126, 0.12)';
          ctx.fillRect(x + 6, y + 9, 3, 3);
          ctx.fillRect(x + 22, y + 21, 2, 2);
        }
      }
    }

    ctx.fillStyle = '#8e6840';
    ctx.fillRect(0, 500, 1120, 82);
    ctx.fillRect(342, 220, 90, 760);
    ctx.fillStyle = '#a67a4b';
    ctx.fillRect(0, 526, 1125, 24);
    ctx.fillRect(372, 220, 28, 760);

    ctx.fillStyle = 'rgba(150, 210, 104, 0.52)';
    ctx.beginPath();
    ctx.ellipse(1000, 360, 230, 170, -0.18, 0, Math.PI * 2);
    ctx.fill();

    this.drawRiver();
  }

  private drawRiver(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let y = -60; y <= WORLD_H + 60; y += 34) {
      const x = riverCenter(y);
      if (y === -60) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#1e5f91';
    ctx.lineWidth = 150;
    ctx.stroke();
    ctx.strokeStyle = '#2c8cc0';
    ctx.lineWidth = 126;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(196, 235, 255, 0.42)';
    ctx.lineWidth = 6;
    ctx.setLineDash([28, 34]);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#7b5430';
    ctx.fillRect(1094, 496, 184, 86);
    ctx.fillStyle = '#a87848';
    for (let x = 1104; x < 1275; x += 22) ctx.fillRect(x, 501, 10, 76);
    ctx.fillStyle = '#4d321f';
    ctx.fillRect(1094, 496, 184, 8);
    ctx.fillRect(1094, 574, 184, 8);
  }

  private drawDecor(): void {
    const ctx = this.ctx;
    for (const tree of this.trees) this.drawTree(tree.x, tree.y);
    houses.forEach((house, index) => this.drawHouse(house, index));
    this.drawWell();
    this.drawGate();

    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.drawImage(this.images.tileset, 0, 0, 512, 512, 838, 194, 300, 300);
    ctx.restore();
  }

  private drawTree(x: number, y: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#553820';
    ctx.fillRect(x - 5, y + 12, 10, 24);
    ctx.fillStyle = '#184f2c';
    ctx.beginPath();
    ctx.arc(x, y + 8, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#23703a';
    ctx.beginPath();
    ctx.arc(x - 9, y, 17, 0, Math.PI * 2);
    ctx.arc(x + 11, y - 3, 18, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawHouse(rect: Rect, index: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fillRect(rect.x + 8, rect.y + rect.h - 10, rect.w - 8, 18);
    ctx.fillStyle = index % 2 === 0 ? '#c7a06a' : '#b88d61';
    ctx.fillRect(rect.x + 14, rect.y + 34, rect.w - 28, rect.h - 36);
    ctx.fillStyle = index % 2 === 0 ? '#793f33' : '#5f4b36';
    ctx.beginPath();
    ctx.moveTo(rect.x + 4, rect.y + 40);
    ctx.lineTo(rect.x + rect.w / 2, rect.y - 4);
    ctx.lineTo(rect.x + rect.w - 4, rect.y + 40);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#4b2f23';
    ctx.fillRect(rect.x + rect.w / 2 - 13, rect.y + rect.h - 42, 26, 40);
    ctx.fillStyle = '#f0c46d';
    ctx.fillRect(rect.x + 28, rect.y + 54, 22, 18);
    ctx.fillRect(rect.x + rect.w - 50, rect.y + 54, 22, 18);
  }

  private drawWell(): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#7e8079';
    ctx.beginPath();
    ctx.ellipse(well.x + 35, well.y + 38, 35, 25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#313934';
    ctx.beginPath();
    ctx.ellipse(well.x + 35, well.y + 35, 22, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8a5938';
    ctx.fillRect(well.x + 8, well.y - 4, 8, 45);
    ctx.fillRect(well.x + 54, well.y - 4, 8, 45);
    ctx.fillStyle = '#6e3d2e';
    ctx.fillRect(well.x + 4, well.y - 8, 62, 10);
  }

  private drawGate(): void {
    const ctx = this.ctx;
    if (this.quest.exitUnlocked) {
      ctx.fillStyle = 'rgba(238, 214, 106, 0.24)';
      ctx.fillRect(exitTrigger.x, exitTrigger.y, exitTrigger.w, exitTrigger.h);
      ctx.fillStyle = '#e6c46b';
      ctx.fillText('Выход', 1480, 456);
      return;
    }
    ctx.fillStyle = '#3e2a20';
    ctx.fillRect(gate.x, gate.y, gate.w, gate.h);
    ctx.fillStyle = '#70503a';
    for (let x = gate.x + 8; x < gate.x + gate.w; x += 18) ctx.fillRect(x, gate.y + 8, 10, gate.h - 16);
    ctx.fillStyle = '#c4a35c';
    ctx.fillRect(gate.x + 25, gate.y + 55, 36, 20);
  }

  private drawEntities(): void {
    const renderables = [
      ...this.npcs.map((npc) => ({ y: npc.y, draw: () => this.drawNpc(npc) })),
      ...this.slimes.filter((slime) => slime.alive).map((slime) => ({ y: slime.y, draw: () => this.drawSlime(slime) })),
      { y: this.player.y, draw: () => this.drawPlayer() },
    ].sort((a, b) => a.y - b.y);
    renderables.forEach((item) => item.draw());
  }

  private drawNpc(npc: Npc): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.26)';
    ctx.beginPath();
    ctx.ellipse(npc.x, npc.y + 16, 18, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(this.images[npc.sprite], npc.x - 26, npc.y - 48, 52, 56);
    if (dist(this.player, npc) < 68 && !this.dialogue) this.drawBubble(npc.x, npc.y - 54, 'E');
  }

  private drawSlime(slime: Slime): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(slime.x, slime.y + 14, 18, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    if (slime.hitFlash > 0) {
      ctx.globalAlpha = 0.75;
      ctx.filter = 'brightness(1.8)';
    }
    ctx.drawImage(this.images.slimeSprite, slime.x - 24, slime.y - 30, 48, 48);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    if (slime.hp < slime.maxHp) {
      ctx.fillStyle = '#321c1c';
      ctx.fillRect(slime.x - 16, slime.y - 34, 32, 5);
      ctx.fillStyle = '#e35b5b';
      ctx.fillRect(slime.x - 16, slime.y - 34, 32 * (slime.hp / slime.maxHp), 5);
    }
  }

  private drawPlayer(): void {
    const ctx = this.ctx;
    const attacking = this.player.attackCd > 0.12;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(this.player.x, this.player.y + 16, 19, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(this.images.playerSprite, this.player.x - 25, this.player.y - 50, 50, 58);
    if (attacking) {
      ctx.strokeStyle = this.quest.rewarded ? '#d7d0a8' : '#f2df9b';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(this.player.x + this.player.facing.x * 12, this.player.y + this.player.facing.y * 12);
      ctx.lineTo(this.player.x + this.player.facing.x * 42, this.player.y + this.player.facing.y * 42);
      ctx.stroke();
    }
  }

  private drawBubble(x: number, y: number, text: string): void {
    const ctx = this.ctx;
    ctx.save();
    roundedRect(ctx, x - 14, y - 12, 28, 24, 6);
    ctx.fillStyle = 'rgba(18, 24, 22, 0.82)';
    ctx.fill();
    ctx.fillStyle = '#fff0be';
    ctx.font = '700 14px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  private drawHud(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '14px system-ui';
    this.panel(16, 14, 292, 88);
    ctx.drawImage(this.images.playerSprite, 28, 26, 48, 54);
    ctx.fillStyle = '#fff1d0';
    ctx.font = '800 16px system-ui';
    ctx.fillText('Деревня Ольховка', 88, 38);
    ctx.font = '13px system-ui';
    ctx.fillText(`Золото: ${this.player.gold}`, 88, 82);
    ctx.fillStyle = '#422021';
    ctx.fillRect(88, 50, 174, 14);
    ctx.fillStyle = '#d84d47';
    ctx.fillRect(88, 50, 174 * (this.player.hp / this.player.maxHp), 14);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.strokeRect(88, 50, 174, 14);
    ctx.fillStyle = '#fff1d0';
    ctx.fillText(`${this.player.hp}/${this.player.maxHp}`, 268, 62);

    const questW = Math.min(390, this.width - 340);
    if (questW > 220) {
      this.panel(this.width - questW - 16, 14, questW, 88);
      ctx.fillStyle = '#f8e7bd';
      ctx.font = '800 15px system-ui';
      ctx.fillText('Задание', this.width - questW, 39);
      ctx.font = '13px system-ui';
      this.wrapText(this.questText(), this.width - questW, 60, questW - 28, 17);
      ctx.drawImage(this.images.slimeSprite, this.width - 66, 26, 40, 40);
    }

    const invY = this.height - 76;
    this.panel(16, invY, Math.min(420, this.width - 32), 58);
    ctx.fillStyle = '#f8e7bd';
    ctx.font = '800 13px system-ui';
    ctx.fillText('Инвентарь', 30, invY + 23);
    this.inventory.slice(0, 5).forEach((item, index) => {
      const x = 116 + index * 56;
      ctx.fillStyle = 'rgba(255, 247, 212, 0.1)';
      ctx.fillRect(x, invY + 12, 44, 36);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.strokeRect(x, invY + 12, 44, 36);
      ctx.fillStyle = '#fff1d0';
      ctx.font = '11px system-ui';
      this.wrapText(item, x + 4, invY + 26, 37, 11);
    });
    ctx.restore();
  }

  private questText(): string {
    if (!this.quest.killStarted) return 'Поговорите с Мироном у колодца.';
    if (this.quest.killStarted && this.quest.kills < 5) return `Победите слизней: ${this.quest.kills}/5.`;
    if (!this.quest.rewarded) return 'Вернитесь к Мирону за наградой.';
    if (!this.quest.potionDone) return 'Купите дорожное зелье у Ани.';
    if (!this.quest.complete) return 'Идите к восточному выходу за мостом.';
    return 'Продолжение следует.';
  }

  private drawDialogue(dialogue: Dialogue): void {
    const ctx = this.ctx;
    const w = Math.min(720, this.width - 32);
    const h = 132;
    const x = (this.width - w) / 2;
    const y = this.height - h - 18;
    this.panel(x, y, w, h);
    ctx.drawImage(this.images[dialogue.portrait], x + 18, y + 18, 84, 84);
    ctx.fillStyle = '#fff0c8';
    ctx.font = '800 18px system-ui';
    ctx.fillText(dialogue.speaker, x + 120, y + 36);
    ctx.fillStyle = '#d5c4a4';
    ctx.font = '13px system-ui';
    ctx.fillText(dialogue.title, x + 120, y + 57);
    ctx.fillStyle = '#fff8df';
    ctx.font = '15px system-ui';
    this.wrapText(dialogue.text, x + 120, y + 84, w - 142, 20);
  }

  private drawNotices(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    this.notices.forEach((notice, index) => {
      const y = 128 + index * 26;
      ctx.globalAlpha = Math.min(1, notice.ttl);
      roundedRect(ctx, this.width / 2 - 120, y - 18, 240, 24, 6);
      ctx.fillStyle = 'rgba(18, 24, 22, 0.7)';
      ctx.fill();
      ctx.fillStyle = '#fff0c8';
      ctx.font = '700 13px system-ui';
      ctx.fillText(notice.text, this.width / 2, y);
    });
    ctx.restore();
  }

  private drawEnding(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(7, 11, 10, 0.72)';
    ctx.fillRect(0, 0, this.width, this.height);
    const w = Math.min(560, this.width - 36);
    const h = 176;
    const x = (this.width - w) / 2;
    const y = (this.height - h) / 2;
    this.panel(x, y, w, h);
    ctx.fillStyle = '#f7df9b';
    ctx.font = '900 30px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Продолжение следует', this.width / 2, y + 64);
    ctx.fillStyle = '#fff4d6';
    ctx.font = '15px system-ui';
    this.wrapText('За восточным мостом начинается большая дорога, но история Ольховки только открылась.', x + 40, y + 104, w - 80, 22);
    ctx.restore();
  }

  private panel(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    roundedRect(ctx, x, y, w, h, 8);
    ctx.fillStyle = 'rgba(21, 28, 25, 0.86)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 238, 190, 0.28)';
    ctx.stroke();
  }

  private wrapText(text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
    const ctx = this.ctx;
    const words = text.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, y);
        line = word;
        y += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, y);
  }
}

async function bootstrap(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game');
  if (!canvas) throw new Error('Canvas #game не найден');
  const images = await loadImages();
  new Game(canvas, images);
}

bootstrap().catch((error: unknown) => {
  document.body.innerHTML = `<pre>${error instanceof Error ? error.message : String(error)}</pre>`;
});

#!/usr/bin/env node
// cli.js — HATCHERY terminal UI
// A living pixel world in your terminal

const { generateWorld, BIOMES, getBiome, getBiomePopulation } = require('./engine/world');
const { createCreature, addHistory, isAlive, heal } = require('./engine/creatures');
const { STATES, decideAction, attemptTask, moveToward } = require('./engine/behavior');
const { processXP, processStatGrowth, processFailure, calculatePower, getCreatureSummary } = require('./engine/evolution');
const { getSpeciesInfo, SPECIES } = require('./engine/dna');
const { spawnTasks } = require('./engine/world');

// ===== ANSI HELPERS =====
const ESC = '\x1b[';
const CLEAR = ESC + '2J';
const HOME = ESC + 'H';
const HIDE_CURSOR = ESC + '?25l';
const SHOW_CURSOR = ESC + '?25h';
const BOLD = ESC + '1m';
const DIM = ESC + '2m';
const RESET = ESC + '0m';
const ITALIC = ESC + '3m';

function fg(r, g, b) { return `${ESC}38;2;${r};${g};${b}m`; }
function bg(r, g, b) { return `${ESC}48;2;${r};${g};${b}m`; }
function moveTo(x, y) { return `${ESC}${y};${x}H`; }

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

function colorFromHex(hex) {
  const [r,g,b] = hexToRgb(hex);
  return fg(r, g, b);
}

// ===== SPRITES =====
const CREATURE_SPRITES = {
  glimmer: '◉',
  ember:   '✦',
  whisp:   '◌',
  thunk:   '■',
  shade:   '◈',
  bloom:   '❀',
  crux:    '△',
};

const TASK_SPRITE = '✧';
const EGG_SPRITE = '◎';
const BIOME_CHARS = {
  meadow:  ['.', ',', '\'', '`'],
  forge:   ['░', '▒', '~', '^'],
  library: ['·', ':', '.', '¨'],
  garden:  [',', '.', '\'', '*'],
  arena:   ['x', '+', '·', '-'],
  depths:  ['.', '·', ' ', '·'],
  nest:    ['~', '.', ',', '·'],
  bazaar:  ['$', '.', '·', '%'],
  void:    [' ', '·', ' ', ' '],
};

const MUTATION_ICONS = {
  horns: '♔',
  wings: '♦',
  armor: '♜',
  thirdEye: '◉',
  biolum: '★',
  fins: '≈',
  crown: '♛',
  voidTouch: '◆',
};

// ===== STATE =====
const state = {
  creatures: [],
  tasks: [],
  events: [],
  cycle: 0,
  camera: { x: 30, y: 30 },
  selected: 0,
  mode: 'world', // world | inspect | help
  startedAt: Date.now(),
  stats: { totalHatched: 0, totalTasks: 0, totalLevelUps: 0, totalMutations: 0 },
  worldTiles: null,
  paused: false,
};

// ===== TERMINAL SETUP =====
let W = process.stdout.columns || 120;
let H = process.stdout.rows || 40;

const MAP_W = Math.max(40, W - 38);
const MAP_H = Math.max(15, H - 12);
const PANEL_X = MAP_W + 2;
const PANEL_W = W - MAP_W - 3;

process.stdout.write(HIDE_CURSOR);
process.stdout.write(CLEAR + HOME);

if (process.stdin.setRawMode) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');

process.on('exit', () => {
  process.stdout.write(SHOW_CURSOR + RESET + CLEAR + HOME);
});
process.on('SIGINT', () => process.exit());

// ===== WORLD INIT =====
function init() {
  state.worldTiles = generateWorld();

  // Spawn initial creatures
  for (let i = 0; i < 6; i++) {
    const biome = BIOMES[Math.floor(Math.random() * BIOMES.length)];
    const x = (biome.x + 3 + Math.random() * (biome.w - 6)) * 16;
    const y = (biome.y + 3 + Math.random() * (biome.h - 6)) * 16;
    const creature = createCreature(x, y);
    state.creatures.push(creature);
    state.stats.totalHatched++;
    logEvent(`${creature.name} the ${getSpeciesInfo(creature.genome.species).name} hatched!`, 'hatch');
  }

  // Spawn tasks
  const tasks = spawnTasks([], state.creatures.length);
  state.tasks.push(...tasks);

  // Center camera on first creature
  if (state.creatures.length > 0) {
    state.camera.x = Math.floor(state.creatures[0].x / 16) - Math.floor(MAP_W / 2);
    state.camera.y = Math.floor(state.creatures[0].y / 16) - Math.floor(MAP_H / 2);
  }
}

function logEvent(text, type) {
  state.events.unshift({ text, type, time: Date.now() });
  if (state.events.length > 50) state.events.pop();
}

// ===== INPUT =====
process.stdin.on('data', (key) => {
  if (key === '\x03' || key === 'q') process.exit(); // ctrl-c or q

  if (state.mode === 'help') {
    state.mode = 'world';
    return;
  }

  switch(key) {
    // Arrow keys
    case '\x1b[A': state.camera.y = Math.max(0, state.camera.y - 3); break; // up
    case '\x1b[B': state.camera.y = Math.min(128 - MAP_H, state.camera.y + 3); break; // down
    case '\x1b[C': state.camera.x = Math.min(128 - MAP_W, state.camera.x + 3); break; // right
    case '\x1b[D': state.camera.x = Math.max(0, state.camera.x - 3); break; // left

    case 'w': state.camera.y = Math.max(0, state.camera.y - 3); break;
    case 's': state.camera.y = Math.min(128 - MAP_H, state.camera.y + 3); break;
    case 'd': state.camera.x = Math.min(128 - MAP_W, state.camera.x + 3); break;
    case 'a': state.camera.x = Math.max(0, state.camera.x - 3); break;

    case '\t': // tab — cycle selected creature
    case 'n':
      state.selected = (state.selected + 1) % Math.max(1, state.creatures.length);
      // Center camera on selected
      const sel = state.creatures[state.selected];
      if (sel) {
        state.camera.x = Math.floor(sel.x / 16) - Math.floor(MAP_W / 2);
        state.camera.y = Math.floor(sel.y / 16) - Math.floor(MAP_H / 2);
        clampCamera();
      }
      break;

    case 'e': // hatch egg
      hatchEgg();
      break;

    case 'i': // inspect mode
      state.mode = state.mode === 'inspect' ? 'world' : 'inspect';
      break;

    case 'h': // help
    case '?':
      state.mode = 'help';
      break;

    case 'f': // follow selected
      const c = state.creatures[state.selected];
      if (c) {
        state.camera.x = Math.floor(c.x / 16) - Math.floor(MAP_W / 2);
        state.camera.y = Math.floor(c.y / 16) - Math.floor(MAP_H / 2);
        clampCamera();
      }
      break;

    case 'p': // pause
      state.paused = !state.paused;
      break;

    case ' ': // space — pause
      state.paused = !state.paused;
      break;
  }
});

function clampCamera() {
  state.camera.x = Math.max(0, Math.min(128 - MAP_W, state.camera.x));
  state.camera.y = Math.max(0, Math.min(128 - MAP_H, state.camera.y));
}

function hatchEgg() {
  const cx = (state.camera.x + Math.floor(MAP_W / 2)) * 16;
  const cy = (state.camera.y + Math.floor(MAP_H / 2)) * 16;
  const creature = createCreature(cx, cy);
  state.creatures.push(creature);
  state.stats.totalHatched++;
  logEvent(`${creature.name} the ${getSpeciesInfo(creature.genome.species).name} hatched!`, 'hatch');
}

// ===== TICK =====
function tick() {
  if (state.paused) return;

  const dt = 0.5; // simulated dt

  for (const creature of state.creatures) {
    if (!isAlive(creature)) continue;

    creature.age += dt;
    creature.stateTimer = (creature.stateTimer || 0) - dt;
    creature.currentBiome = getBiome(Math.floor(creature.x / 16), Math.floor(creature.y / 16)).id;

    if (creature.state === 'resting' && creature.hp < creature.maxHp) {
      heal(creature, dt * 5);
    }

    if (creature.stateTimer <= 0) {
      switch (creature.state) {
        case 'idle':
        case 'wander':
        case 'socializing':
        case 'resting': {
          const action = decideAction(creature, state.tasks, state.creatures);
          creature.state = action.state;
          creature.stateTimer = action.duration || 10;
          creature.stateData = action;

          if (action.target) {
            creature.targetX = action.target.x;
            creature.targetY = action.target.y;
          }

          if (action.taskId) {
            const task = state.tasks.find(t => t.id === action.taskId);
            if (task && !task.claimed) {
              task.claimed = true;
              task.claimedBy = creature.id;
              creature.activity = `seeking ${task.type} task`;
            } else {
              creature.state = 'idle';
              creature.stateTimer = 1;
            }
          } else if (action.state === STATES.WANDER) {
            creature.activity = `wandering to ${action.destination || '?'}`;
          } else if (action.state === STATES.RESTING) {
            creature.activity = 'resting...';
          } else if (action.state === STATES.SOCIALIZING) {
            creature.activity = 'socializing';
          }
          break;
        }

        case 'seeking_task': {
          const taskId = creature.stateData?.taskId;
          const task = state.tasks.find(t => t.id === taskId);
          if (!task) { creature.state = 'idle'; creature.stateTimer = 1; break; }

          const arrived = moveToward(creature, { x: task.x, y: task.y }, dt + 1);
          if (arrived) {
            creature.state = 'working';
            creature.stateTimer = 2 + task.difficulty * 0.5;
            creature.activity = `working: ${task.type}`;
          } else {
            creature.stateTimer = 0.5;
          }
          break;
        }

        case 'working': {
          const taskId = creature.stateData?.taskId;
          const task = state.tasks.find(t => t.id === taskId);

          if (task) {
            const result = attemptTask(creature, task);
            creature.taskCount = (creature.taskCount || 0) + 1;
            state.stats.totalTasks++;

            if (result.success) {
              const evo = processXP(creature, result.xp);
              processStatGrowth(creature, result.statGrowth);
              creature.activity = `done! +${result.xp}xp`;
              logEvent(`${creature.name} completed ${task.type} (+${result.xp}xp)`, 'success');

              if (evo.leveledUp) {
                logEvent(`${creature.name} leveled up to ${evo.newLevel}!`, 'levelup');
                state.stats.totalLevelUps++;
              }
              for (const mut of evo.mutations) {
                logEvent(`${creature.name} mutated: ${mut.visual}!`, 'mutation');
                state.stats.totalMutations++;
              }
            } else {
              processFailure(creature);
              processXP(creature, result.xp);
              creature.activity = `failed ${task.type}...`;
              logEvent(`${creature.name} failed ${task.type}`, 'fail');
            }

            state.tasks = state.tasks.filter(t => t.id !== taskId);
          }

          creature.state = 'idle';
          creature.stateTimer = 2 + Math.random() * 3;
          break;
        }

        default:
          creature.state = 'idle';
          creature.stateTimer = 1;
      }
    }

    if (creature.targetX !== undefined && creature.state !== 'working') {
      moveToward(creature, { x: creature.targetX, y: creature.targetY }, dt);
    }
  }

  // Spawn tasks
  const newTasks = spawnTasks(state.tasks, state.creatures.length);
  if (newTasks.length > 0) state.tasks.push(...newTasks);

  // Clean stale claims
  for (const task of state.tasks) {
    if (task.claimed && task.claimedBy) {
      const claimer = state.creatures.find(c => c.id === task.claimedBy);
      if (!claimer || claimer.state === 'idle') {
        task.claimed = false;
        task.claimedBy = null;
      }
    }
  }

  state.cycle++;
}

// ===== RENDER =====
function render() {
  let buf = HOME;

  // Header
  const title = `${colorFromHex('#50fa7b')}${BOLD} HATCHERY ${RESET}`;
  const statsStr = `${DIM}creatures:${RESET}${colorFromHex('#bd93f9')}${state.creatures.length}${RESET} ${DIM}tasks:${RESET}${colorFromHex('#ffb86c')}${state.tasks.length}${RESET} ${DIM}cycle:${RESET}${colorFromHex('#8be9fd')}${state.cycle}${RESET}`;
  const pauseStr = state.paused ? ` ${colorFromHex('#ff5555')}[PAUSED]${RESET}` : '';
  buf += title + '  ' + statsStr + pauseStr + '  ' + `${DIM}[h]elp${RESET}`;
  buf += '\n';

  // Separator
  buf += colorFromHex('#2a2a4a') + '─'.repeat(W - 1) + RESET + '\n';

  // Map + Side Panel
  for (let row = 0; row < MAP_H; row++) {
    let line = '';

    // Map column
    for (let col = 0; col < MAP_W; col++) {
      const tx = state.camera.x + col;
      const ty = state.camera.y + row;

      if (tx < 0 || tx >= 128 || ty < 0 || ty >= 128) {
        line += ' ';
        continue;
      }

      // Check for creature at this tile
      let creatureHere = null;
      let creatureIdx = -1;
      for (let ci = 0; ci < state.creatures.length; ci++) {
        const c = state.creatures[ci];
        const cx = Math.floor(c.x / 16);
        const cy = Math.floor(c.y / 16);
        if (cx === tx && cy === ty) { creatureHere = c; creatureIdx = ci; break; }
      }

      // Check for task
      let taskHere = null;
      for (const t of state.tasks) {
        if (Math.floor(t.x / 16) === tx && Math.floor(t.y / 16) === ty) { taskHere = t; break; }
      }

      if (creatureHere) {
        const sp = getSpeciesInfo(creatureHere.genome.species);
        const sprite = CREATURE_SPRITES[sp.id] || '?';
        const isSelected = creatureIdx === state.selected;
        if (isSelected) {
          line += `${bg(40, 40, 60)}${colorFromHex(sp.base)}${BOLD}${sprite}${RESET}`;
        } else {
          line += `${colorFromHex(sp.base)}${sprite}${RESET}`;
        }
      } else if (taskHere) {
        const biome = BIOMES.find(b => b.id === taskHere.biome) || BIOMES[0];
        line += `${colorFromHex(biome.accent)}${TASK_SPRITE}${RESET}`;
      } else {
        const biome = getBiome(tx, ty);
        const chars = BIOME_CHARS[biome.id] || ['.'];
        const tileData = state.worldTiles[ty * 128 + tx];
        let ch;
        if (tileData && tileData.type === 'feature') {
          ch = chars[2] || '.';
          line += `${colorFromHex(biome.accent)}${DIM}${ch}${RESET}`;
        } else if (tileData && tileData.type === 'deco') {
          ch = chars[1] || '.';
          const [r,g,b_] = hexToRgb(biome.color);
          line += `${fg(r+30, g+30, b_+30)}${ch}${RESET}`;
        } else {
          ch = chars[0] || '.';
          const [r,g,b_] = hexToRgb(biome.color);
          line += `${fg(r, g, b_)}${ch}${RESET}`;
        }
      }
    }

    // Divider
    line += `${colorFromHex('#2a2a4a')}│${RESET}`;

    // Side panel
    line += renderSidePanel(row);

    buf += line + '\n';
  }

  // Separator
  buf += colorFromHex('#2a2a4a') + '─'.repeat(W - 1) + RESET + '\n';

  // Event log (bottom)
  const logLines = Math.min(H - MAP_H - 4, 8);
  for (let i = 0; i < logLines; i++) {
    const ev = state.events[i];
    if (!ev) { buf += '\n'; continue; }

    const age = Math.floor((Date.now() - ev.time) / 1000);
    const timeStr = age < 60 ? `${age}s` : `${Math.floor(age/60)}m`;

    let typeColor = '#888888';
    let icon = '·';
    if (ev.type === 'hatch')    { typeColor = '#8be9fd'; icon = '🥚'; }
    if (ev.type === 'success')  { typeColor = '#50fa7b'; icon = '✓'; }
    if (ev.type === 'fail')     { typeColor = '#ff5555'; icon = '✗'; }
    if (ev.type === 'levelup')  { typeColor = '#bd93f9'; icon = '⬆'; }
    if (ev.type === 'mutation') { typeColor = '#ffb86c'; icon = '★'; }

    buf += `${DIM}${timeStr.padStart(4)}${RESET} ${colorFromHex(typeColor)}${icon} ${ev.text}${RESET}\n`;
  }

  // Help overlay
  if (state.mode === 'help') {
    buf += renderHelp();
  }

  process.stdout.write(buf);
}

function renderSidePanel(row) {
  const sel = state.creatures[state.selected];
  const pw = PANEL_W - 1;
  if (pw < 10) return '';

  switch(row) {
    case 0: {
      if (!sel) return pad('  no creature selected', pw);
      const sp = getSpeciesInfo(sel.genome.species);
      return pad(`  ${colorFromHex(sp.base)}${BOLD}${sel.name}${RESET} ${DIM}the ${sp.name}${RESET}`, pw + 20);
    }
    case 1: {
      if (!sel) return pad('', pw);
      const pwr = calculatePower(sel);
      return pad(`  ${DIM}L${sel.level}${RESET} ${colorFromHex('#bd93f9')}PWR:${pwr}${RESET} ${DIM}HP:${sel.hp}/${sel.maxHp}${RESET}`, pw + 30);
    }
    case 2: return pad(`  ${colorFromHex('#2a2a4a')}${'─'.repeat(Math.max(1, pw - 3))}${RESET}`, pw + 20);
    case 3: return statBar('INT', sel?.genome?.stats?.intelligence, '#8be9fd', pw);
    case 4: return statBar('CRE', sel?.genome?.stats?.creativity, '#ff79c6', pw);
    case 5: return statBar('STR', sel?.genome?.stats?.strength, '#ff5555', pw);
    case 6: return statBar('SPD', sel?.genome?.stats?.speed, '#50fa7b', pw);
    case 7: return statBar('LCK', sel?.genome?.stats?.luck, '#f1fa8c', pw);
    case 8: return pad(`  ${colorFromHex('#2a2a4a')}${'─'.repeat(Math.max(1, pw - 3))}${RESET}`, pw + 20);
    case 9: {
      if (!sel) return pad('', pw);
      const muts = sel.genome.mutations;
      if (muts.length === 0) return pad(`  ${DIM}no mutations${RESET}`, pw + 10);
      const icons = muts.map(m => `${colorFromHex('#ffb86c')}${MUTATION_ICONS[m] || '?'}${RESET}`).join(' ');
      return pad(`  ${icons}`, pw + muts.length * 15);
    }
    case 10: {
      if (!sel) return pad('', pw);
      const needed = sel.level * 50;
      const pct = Math.floor((sel.xp / needed) * 100);
      const barW = Math.max(5, pw - 14);
      const filled = Math.floor((pct / 100) * barW);
      const bar = `${colorFromHex('#50fa7b')}${'█'.repeat(filled)}${DIM}${'░'.repeat(barW - filled)}${RESET}`;
      return pad(`  XP ${bar} ${pct}%`, pw + 25);
    }
    case 11: {
      if (!sel) return pad('', pw);
      return pad(`  ${DIM}${sel.activity || 'idle'}${RESET}`, pw + 10);
    }
    case 12: return pad(`  ${colorFromHex('#2a2a4a')}${'─'.repeat(Math.max(1, pw - 3))}${RESET}`, pw + 20);
    case 13: return pad(`  ${colorFromHex('#ff79c6')}${BOLD}BIOMES${RESET}`, pw + 20);
    default: {
      const biomeIdx = row - 14;
      if (biomeIdx >= 0 && biomeIdx < BIOMES.length) {
        const b = BIOMES[biomeIdx];
        const pop = state.creatures.filter(c => {
          return Math.floor(c.x/16) >= b.x && Math.floor(c.x/16) < b.x+b.w &&
                 Math.floor(c.y/16) >= b.y && Math.floor(c.y/16) < b.y+b.h;
        }).length;
        return pad(`  ${colorFromHex(b.accent)}${b.name.padEnd(8)}${RESET} ${DIM}${b.taskType.padEnd(8)}${RESET} ${colorFromHex('#bd93f9')}${pop}${RESET}`, pw + 30);
      }
      return pad('', pw);
    }
  }
}

function statBar(label, val, color, pw) {
  if (val === undefined) return pad('', pw);
  const barW = Math.max(5, pw - 14);
  const filled = Math.floor((Math.min(val, 50) / 50) * barW);
  const bar = `${colorFromHex(color)}${'█'.repeat(filled)}${DIM}${'░'.repeat(barW - filled)}${RESET}`;
  return pad(`  ${DIM}${label}${RESET} ${bar} ${colorFromHex(color)}${String(val).padStart(2)}${RESET}`, pw + 30);
}

function pad(str, targetLen) {
  // Rough padding — ANSI codes make length inaccurate but it works well enough
  return str;
}

function renderHelp() {
  const lines = [
    '',
    `${colorFromHex('#50fa7b')}${BOLD}  HATCHERY CONTROLS${RESET}`,
    '',
    `  ${BOLD}wasd/arrows${RESET}  pan camera`,
    `  ${BOLD}tab/n${RESET}       cycle creature`,
    `  ${BOLD}f${RESET}           follow selected`,
    `  ${BOLD}e${RESET}           hatch new egg`,
    `  ${BOLD}i${RESET}           inspect mode`,
    `  ${BOLD}space/p${RESET}     pause/unpause`,
    `  ${BOLD}h/?${RESET}         this help`,
    `  ${BOLD}q${RESET}           quit`,
    '',
    `  ${DIM}press any key to close${RESET}`,
  ];
  return lines.join('\n');
}

// ===== MAIN =====
init();

// Tick engine
setInterval(tick, 500);

// Render
setInterval(render, 150);

// Welcome
logEvent('welcome to the hatchery. press [e] to hatch, [h] for help.', 'hatch');

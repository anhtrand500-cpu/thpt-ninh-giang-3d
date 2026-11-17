const GAME_NAMES = {
  caro: 'Cờ Caro',
  horses: 'Cờ Cá Ngựa',
  chess: 'Cờ Vua',
};

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function control(label, className, action) {
  const button = element('button', className, label);
  button.type = 'button';
  button.addEventListener('click', action);
  return button;
}

function modePicker(mode, onChange) {
  const select = element('select', 'yard-game-mode');
  select.setAttribute('aria-label', 'Chế độ chơi');
  for (const [value, label] of [['local', '2 người'], ['computer', 'Đấu với máy']]) {
    const option = element('option', '', label);
    option.value = value;
    option.selected = mode === value;
    select.appendChild(option);
  }
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function caroHasFive(cells, index, mark) {
  const row = Math.floor(index / 15), col = index % 15;
  return [[1, 0], [0, 1], [1, 1], [1, -1]].some(([dr, dc]) => {
    let count = 1;
    for (const sign of [-1, 1]) {
      let r = row + dr * sign, c = col + dc * sign;
      while (r >= 0 && r < 15 && c >= 0 && c < 15 && cells[r * 15 + c] === mark) {
        count++;
        r += dr * sign;
        c += dc * sign;
      }
    }
    return count >= 5;
  });
}

function caroLineScore(cells, index, mark, dr, dc) {
  const row = Math.floor(index / 15), col = index % 15;
  let count = 1, open = 0;
  for (const sign of [-1, 1]) {
    let r = row + dr * sign, c = col + dc * sign;
    while (r >= 0 && r < 15 && c >= 0 && c < 15 && cells[r * 15 + c] === mark) {
      count++;
      r += dr * sign;
      c += dc * sign;
    }
    if (r >= 0 && r < 15 && c >= 0 && c < 15 && !cells[r * 15 + c]) open++;
  }
  if (count >= 5) return 1e8;
  if (count === 4) return open === 2 ? 1e6 : open ? 1e5 : 0;
  if (count === 3) return open === 2 ? 12000 : open ? 1200 : 0;
  if (count === 2) return open === 2 ? 300 : open ? 35 : 0;
  return open === 2 ? 8 : 1;
}

function bestCaroMove(cells) {
  const open = cells.map((value, index) => value ? -1 : index).filter(index => index >= 0);
  if (open.length === 225) return 7 * 15 + 7;
  for (const mark of ['O', 'X']) {
    for (const index of open) {
      cells[index] = mark;
      const wins = caroHasFive(cells, index, mark);
      cells[index] = '';
      if (wins) return index;
    }
  }
  const scored = open.map(index => {
    cells[index] = 'O';
    const offense = [[1, 0], [0, 1], [1, 1], [1, -1]]
      .reduce((sum, [dr, dc]) => sum + caroLineScore(cells, index, 'O', dr, dc), 0);
    cells[index] = 'X';
    const defense = [[1, 0], [0, 1], [1, 1], [1, -1]]
      .reduce((sum, [dr, dc]) => sum + caroLineScore(cells, index, 'X', dr, dc), 0);
    cells[index] = '';
    const row = Math.floor(index / 15), col = index % 15;
    return { index, score: offense + defense * 0.9 - (Math.abs(row - 7) + Math.abs(col - 7)) };
  });
  const best = Math.max(...scored.map(move => move.score));
  const choices = scored.filter(move => move.score >= best - 1);
  return choices[Math.floor(Math.random() * choices.length)].index;
}

function initialChessState(mode = 'local') {
  const back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  return {
    board: [
      back.map(type => ({ color: 'b', type })),
      Array.from({ length: 8 }, () => ({ color: 'b', type: 'p' })),
      ...Array.from({ length: 4 }, () => Array(8).fill(null)),
      Array.from({ length: 8 }, () => ({ color: 'w', type: 'p' })),
      back.map(type => ({ color: 'w', type })),
    ],
    turn: 'w',
    mode,
    aiThinking: false,
    castling: new Set(['K', 'Q', 'k', 'q']),
    enPassant: null,
    selected: null,
    legal: [],
    status: 'Lượt Trắng',
    finished: false,
  };
}

function chessAttacked(board, row, col, byColor) {
  const pawnRow = row + (byColor === 'w' ? 1 : -1);
  for (const dc of [-1, 1]) {
    const piece = board[pawnRow]?.[col + dc];
    if (piece?.color === byColor && piece.type === 'p') return true;
  }
  for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
    const piece = board[row + dr]?.[col + dc];
    if (piece?.color === byColor && piece.type === 'n') return true;
  }
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const piece = board[row + dr]?.[col + dc];
    if (piece?.color === byColor && piece.type === 'k') return true;
  }
  for (const [dr, dc, types] of [
    [-1, 0, 'rq'], [1, 0, 'rq'], [0, -1, 'rq'], [0, 1, 'rq'],
    [-1, -1, 'bq'], [-1, 1, 'bq'], [1, -1, 'bq'], [1, 1, 'bq'],
  ]) {
    for (let r = row + dr, c = col + dc; board[r]?.[c] !== undefined; r += dr, c += dc) {
      const piece = board[r][c];
      if (!piece) continue;
      if (piece.color === byColor && types.includes(piece.type)) return true;
      break;
    }
  }
  return false;
}

function chessInCheck(board, color) {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (board[r][c]?.color === color && board[r][c].type === 'k') {
      return chessAttacked(board, r, c, color === 'w' ? 'b' : 'w');
    }
  }
  return true;
}

function chessPseudoMoves(state, row, col) {
  const { board, castling, enPassant } = state;
  const piece = board[row][col];
  if (!piece) return [];
  const moves = [];
  const add = (r, c, extra = {}) => {
    if (r < 0 || r > 7 || c < 0 || c > 7) return false;
    const target = board[r][c];
    if (target?.color === piece.color || target?.type === 'k') return false;
    moves.push({ from: [row, col], to: [r, c], ...extra });
    return !target;
  };
  if (piece.type === 'p') {
    const dir = piece.color === 'w' ? -1 : 1;
    const start = piece.color === 'w' ? 6 : 1;
    const promote = piece.color === 'w' ? 0 : 7;
    if (!board[row + dir]?.[col]) {
      add(row + dir, col, { promotion: row + dir === promote ? 'q' : null });
      if (row === start && !board[row + dir * 2]?.[col]) add(row + dir * 2, col, { doublePawn: true });
    }
    for (const dc of [-1, 1]) {
      const r = row + dir, c = col + dc;
      if (board[r]?.[c] && board[r][c].color !== piece.color && board[r][c].type !== 'k') {
        add(r, c, { promotion: r === promote ? 'q' : null });
      } else if (enPassant?.[0] === r && enPassant?.[1] === c) {
        moves.push({ from: [row, col], to: [r, c], enPassant: true });
      }
    }
  } else if (piece.type === 'n') {
    for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) add(row + dr, col + dc);
  } else if (piece.type === 'k') {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (dr || dc) add(row + dr, col + dc);
    }
    const home = piece.color === 'w' ? 7 : 0;
    const enemy = piece.color === 'w' ? 'b' : 'w';
    const kingRight = piece.color === 'w' ? 'K' : 'k';
    const queenRight = piece.color === 'w' ? 'Q' : 'q';
    if (row === home && col === 4 && !chessInCheck(board, piece.color)) {
      if (castling.has(kingRight) && !board[home][5] && !board[home][6]
        && board[home][7]?.type === 'r' && board[home][7].color === piece.color
        && !chessAttacked(board, home, 5, enemy) && !chessAttacked(board, home, 6, enemy)) {
        add(home, 6, { castle: 'king' });
      }
      if (castling.has(queenRight) && !board[home][1] && !board[home][2] && !board[home][3]
        && board[home][0]?.type === 'r' && board[home][0].color === piece.color
        && !chessAttacked(board, home, 3, enemy) && !chessAttacked(board, home, 2, enemy)) {
        add(home, 2, { castle: 'queen' });
      }
    }
  } else {
    const dirs = piece.type === 'r' ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
      : piece.type === 'b' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]]
        : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [dr, dc] of dirs) {
      for (let r = row + dr, c = col + dc; r >= 0 && r < 8 && c >= 0 && c < 8; r += dr, c += dc) {
        if (!add(r, c)) break;
      }
    }
  }
  return moves;
}

function chessApply(state, move) {
  const board = state.board.map(row => row.slice());
  const castling = new Set(state.castling);
  const [fr, fc] = move.from, [tr, tc] = move.to;
  const piece = board[fr][fc], captured = board[tr][tc];
  board[tr][tc] = { ...piece, ...(move.promotion ? { type: move.promotion } : {}) };
  board[fr][fc] = null;
  if (move.enPassant) board[tr + (piece.color === 'w' ? 1 : -1)][tc] = null;
  if (move.castle === 'king') {
    board[tr][5] = board[tr][7];
    board[tr][7] = null;
  } else if (move.castle === 'queen') {
    board[tr][3] = board[tr][0];
    board[tr][0] = null;
  }
  if (piece.type === 'k') {
    for (const right of piece.color === 'w' ? ['K', 'Q'] : ['k', 'q']) castling.delete(right);
  }
  if (piece.type === 'r' && fr === 7 && fc === 0) castling.delete('Q');
  if (piece.type === 'r' && fr === 7 && fc === 7) castling.delete('K');
  if (piece.type === 'r' && fr === 0 && fc === 0) castling.delete('q');
  if (piece.type === 'r' && fr === 0 && fc === 7) castling.delete('k');
  if (captured?.type === 'r' && tr === 7 && tc === 0) castling.delete('Q');
  if (captured?.type === 'r' && tr === 7 && tc === 7) castling.delete('K');
  if (captured?.type === 'r' && tr === 0 && tc === 0) castling.delete('q');
  if (captured?.type === 'r' && tr === 0 && tc === 7) castling.delete('k');
  return {
    ...state,
    board,
    castling,
    enPassant: move.doublePawn ? [(fr + tr) / 2, fc] : null,
  };
}

function chessLegalMoves(state, row, col) {
  const piece = state.board[row][col];
  if (!piece) return [];
  return chessPseudoMoves(state, row, col).filter(move => !chessInCheck(chessApply(state, move).board, piece.color));
}

function chessAllLegalMoves(state, color) {
  const moves = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (state.board[r][c]?.color === color) moves.push(...chessLegalMoves(state, r, c));
  }
  return moves;
}

function chessEvaluate(board) {
  const values = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 20000 };
  let score = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const piece = board[r][c];
    if (!piece) continue;
    const sign = piece.color === 'w' ? 1 : -1;
    const center = 7 - Math.abs(3.5 - r) - Math.abs(3.5 - c);
    const advance = piece.type === 'p' ? (piece.color === 'w' ? 6 - r : r - 1) * 7 : 0;
    score += sign * (values[piece.type] + center * (piece.type === 'n' || piece.type === 'b' ? 5 : 1) + advance);
  }
  return score;
}

function chessMinimax(state, depth, alpha, beta) {
  const moves = chessAllLegalMoves(state, state.turn);
  if (!moves.length) {
    if (!chessInCheck(state.board, state.turn)) return 0;
    return state.turn === 'w' ? -100000 - depth : 100000 + depth;
  }
  if (depth === 0) return chessEvaluate(state.board);
  const maximizing = state.turn === 'w';
  let best = maximizing ? -Infinity : Infinity;
  for (const move of moves) {
    const next = chessApply(state, move);
    next.turn = state.turn === 'w' ? 'b' : 'w';
    const score = chessMinimax(next, depth - 1, alpha, beta);
    if (maximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) break;
  }
  return best;
}

function bestChessMove(state) {
  const moves = chessAllLegalMoves(state, 'b');
  let best = Infinity;
  let choices = [];
  for (const move of moves) {
    const next = chessApply(state, move);
    next.turn = 'w';
    const score = chessMinimax(next, 1, -Infinity, Infinity);
    if (score < best) {
      best = score;
      choices = [move];
    } else if (score === best) choices.push(move);
  }
  return choices[Math.floor(Math.random() * choices.length)] || null;
}

const CHESS_GLYPHS = {
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟',
};

export function mountYardGames(content, tabs, initialGame = 'caro') {
  const states = {
    caro: { cells: Array(225).fill(''), turn: 1, winner: 0, mode: 'local', aiThinking: false },
    horses: null,
    chess: initialChessState('local'),
  };
  let activeGame = Object.hasOwn(GAME_NAMES, initialGame) ? initialGame : 'caro';
  const availableGames = Object.keys(GAME_NAMES);
  const aiTimers = new Map();
  const clearAITimer = game => {
    clearTimeout(aiTimers.get(game));
    aiTimers.delete(game);
  };
  const scheduleAI = (game, action) => {
    clearAITimer(game);
    aiTimers.set(game, setTimeout(() => {
      aiTimers.delete(game);
      action();
    }, 550));
  };
  const button = (label, className, action) => control(label, className, action);
  const reset = () => {
    clearAITimer(activeGame);
    if (activeGame === 'caro') states.caro = { cells: Array(225).fill(''), turn: 1, winner: 0, mode: states.caro.mode, aiThinking: false };
    if (activeGame === 'horses') states.horses = newHorseGame(states.horses?.playerCount ?? 2, states.horses?.mode ?? 'local');
    if (activeGame === 'chess') states.chess = initialChessState(states.chess.mode);
    render();
  };
  const renderTabs = () => {
    tabs.replaceChildren();
    for (const game of availableGames) {
      const tab = button(GAME_NAMES[game], `yard-game-tab${activeGame === game ? ' active' : ''}`, () => {
        activeGame = game;
        if (game === 'horses' && !states.horses) states.horses = newHorseGame(2);
        render();
      });
      tab.setAttribute('aria-pressed', String(activeGame === game));
      tabs.appendChild(tab);
    }
  };
  function renderCaro() {
    const state = states.caro;
    const section = element('section', 'yard-game-play');
    const controls = element('div', 'yard-game-controls');
    controls.appendChild(modePicker(state.mode, mode => {
      clearAITimer('caro');
      states.caro = { cells: Array(225).fill(''), turn: 1, winner: 0, mode, aiThinking: false };
      render();
    }));
    section.appendChild(controls);
    const finished = state.winner || state.turn === 0;
    const status = state.aiThinking
      ? 'Máy đang suy nghĩ…'
      : state.winner
      ? state.mode === 'computer'
        ? state.winner === 1 ? 'Bạn thắng!' : 'Máy thắng!'
        : `Người chơi ${state.winner === 1 ? 'Đỏ' : 'Xanh'} thắng!`
      : state.turn === 0 ? 'Ván cờ hòa.'
        : state.mode === 'computer'
          ? state.turn === 1 ? 'Lượt của bạn (X).' : 'Lượt của máy (O).'
          : `Lượt người chơi ${state.turn === 1 ? 'Đỏ (X)' : 'Xanh (O)'}.`;
    section.appendChild(element('p', 'yard-game-status', status));
    const board = element('div', 'caro-board');
    board.setAttribute('role', 'grid');
    for (let i = 0; i < state.cells.length; i++) {
      const cell = button(state.cells[i] || '', `caro-cell${state.cells[i] ? ` mark-${state.cells[i]}` : ''}`, () => playCaro(i));
      cell.setAttribute('aria-label', `Hàng ${Math.floor(i / 15) + 1}, cột ${i % 15 + 1}${state.cells[i] ? `: ${state.cells[i]}` : ''}`);
      cell.disabled = !!finished || state.aiThinking || (state.mode === 'computer' && state.turn === 2) || !!state.cells[i];
      board.appendChild(cell);
    }
    section.appendChild(board);
    section.appendChild(element('p', 'yard-game-help', 'Nối 5 quân liên tiếp theo hàng, cột hoặc đường chéo để thắng.'));
    section.appendChild(button('Ván mới', 'yard-game-primary', reset));
    content.appendChild(section);
  }
  function playCaro(index, computerMove = false) {
    const state = states.caro;
    if (state.winner || state.turn === 0 || state.cells[index] || state.aiThinking
      || (state.mode === 'computer' && state.turn === 2 && !computerMove)) return;
    const mark = state.turn === 1 ? 'X' : 'O';
    state.cells[index] = mark;
    const won = caroHasFive(state.cells, index, mark);
    if (won) state.winner = state.turn;
    else if (state.cells.every(Boolean)) state.turn = 0;
    else state.turn = state.turn === 1 ? 2 : 1;
    if (state.mode === 'computer' && state.turn === 2 && !state.winner && state.turn !== 0) {
      state.aiThinking = true;
      render();
      scheduleAI('caro', () => {
        const current = states.caro;
        if (current.mode !== 'computer' || current.turn !== 2 || current.winner || current.turn === 0) return;
        current.aiThinking = false;
        playCaro(bestCaroMove(current.cells), true);
      });
      return;
    }
    render();
  }
  function newHorseGame(playerCount, mode = 'local') {
    const count = mode === 'computer' ? 2 : playerCount === 4 ? 4 : 2;
    return {
      playerCount: count,
      mode,
      players: Array.from({ length: count }, (_, index) => ({
        name: mode === 'computer' && index === 1 ? 'Máy' : ['Đỏ', 'Xanh', 'Vàng', 'Lục'][index],
        color: ['red', 'blue', 'yellow', 'green'][index],
        start: (count === 2 ? index * 14 : index * 7) + 2,
        horses: Array(4).fill(-1),
      })),
      turn: 0,
      die: null,
      winner: -1,
      aiThinking: false,
      status: 'Đổ xúc xắc. Cần 6 để đưa ngựa ra khỏi chuồng.',
    };
  }
  function renderHorses() {
    const state = states.horses || (states.horses = newHorseGame(2));
    const section = element('section', 'yard-game-play');
    const controls = element('div', 'horse-controls');
    const turn = state.aiThinking
      ? 'Máy đang đổ xúc xắc và chọn ngựa…'
      : state.winner >= 0
      ? `${state.players[state.winner].name} thắng ván cờ!`
      : `Lượt ${state.players[state.turn].name} · ${state.status}`;
    controls.appendChild(element('p', 'yard-game-status', turn));
    const mode = modePicker(state.mode, nextMode => {
      clearAITimer('horses');
      states.horses = newHorseGame(nextMode === 'computer' ? 2 : state.playerCount, nextMode);
      render();
      scheduleHorseAI();
    });
    const size = element('select', 'horse-player-count');
    size.setAttribute('aria-label', 'Số người chơi');
    for (const count of [2, 4]) {
      const option = element('option', '', `${count} người chơi`);
      option.value = String(count);
      option.selected = state.playerCount === count;
      size.appendChild(option);
    }
    size.disabled = state.mode === 'computer';
    size.addEventListener('change', () => {
      clearAITimer('horses');
      states.horses = newHorseGame(Number(size.value), state.mode);
      render();
    });
    const roll = button(state.die == null ? '🎲 Đổ xúc xắc' : `🎲 ${state.die} · chọn ngựa`, 'yard-game-primary', rollHorse);
    roll.disabled = state.winner >= 0 || state.aiThinking || state.die != null || (state.mode === 'computer' && state.turn === 1);
    controls.append(mode, size, roll);
    section.appendChild(controls);
    const board = element('div', 'horse-board');
    board.setAttribute('aria-label', 'Bàn cờ cá ngựa');
    for (let i = 0; i < 64; i++) {
      const row = Math.floor(i / 8), col = i % 8;
      const cell = element('div', 'horse-cell');
      cell.style.gridRow = String(row + 1);
      cell.style.gridColumn = String(col + 1);
      const pathIndex = horsePathIndex(row, col);
      if (pathIndex >= 0) {
        cell.classList.add('horse-track');
        if (state.players.some(entry => entry.start === pathIndex)) cell.classList.add('horse-safe');
        for (let player = 0; player < state.players.length; player++) {
          const entry = state.players[player];
          for (let horse = 0; horse < entry.horses.length; horse++) {
            if (entry.horses[horse] < 0 || entry.horses[horse] >= 28) continue;
            if ((entry.start + entry.horses[horse]) % 28 !== pathIndex) continue;
            const token = button('●', `horse-token ${entry.color}`, () => moveHorse(player, horse));
            token.title = `${entry.name} · ngựa ${horse + 1}`;
            token.disabled = state.winner >= 0 || state.aiThinking || state.die == null || state.turn !== player
              || (state.mode === 'computer' && player === 1);
            cell.appendChild(token);
          }
        }
      } else if ((row < 2 && col < 2) || (row < 2 && col > 5) || (row > 5 && col < 2) || (row > 5 && col > 5)) {
        cell.classList.add('horse-stable');
        const playerIndex = row < 2 ? (col < 2 ? 0 : 1) : (col < 2 ? 3 : 2);
        const ownerIndex = state.playerCount === 2
          ? (playerIndex === 0 ? 0 : playerIndex === 2 ? 1 : -1)
          : playerIndex;
        const player = ownerIndex >= 0 ? ownerIndex : -1;
        if (player >= 0) {
          const entry = state.players[player];
          for (let horse = 0; horse < entry.horses.length; horse++) {
            if (entry.horses[horse] !== -1) continue;
            const token = button('●', `horse-token ${entry.color}`, () => moveHorse(player, horse));
            token.title = `${entry.name} · ngựa ${horse + 1} trong chuồng`;
            token.disabled = state.winner >= 0 || state.aiThinking || state.die !== 6 || state.turn !== player
              || (state.mode === 'computer' && player === 1);
            cell.appendChild(token);
          }
        }
      }
      board.appendChild(cell);
    }
    const center = element('div', 'horse-center', 'Mỗi ngựa đi một vòng về đích. Ăn quân đối thủ để được đổ thêm lượt.');
    board.appendChild(center);
    section.appendChild(board);
    section.appendChild(element(
      'p',
      'horse-score',
      state.players.map(player => `${player.name}: ${player.horses.filter(progress => progress === 28).length}/4 ngựa về đích`).join(' · '),
    ));
    const rules = element('p', 'yard-game-help', 'Cần 6 để xuất chuồng · về đích đúng số · ô an toàn không bị ăn · mỗi người có 4 ngựa.');
    section.appendChild(rules);
    section.appendChild(button('Ván mới', 'yard-game-secondary', reset));
    content.appendChild(section);
  }
  function horsePathIndex(row, col) {
    if (row === 0) return col;
    if (col === 7) return 7 + row;
    if (row === 7) return 15 + (6 - col);
    if (col === 0) return 22 + (6 - row);
    return -1;
  }
  function rollHorse(computerMove = false) {
    const state = states.horses;
    if (!state || state.winner >= 0 || state.die != null || state.aiThinking
      || (state.mode === 'computer' && state.turn === 1 && !computerMove)) return;
    state.die = Math.floor(Math.random() * 6) + 1;
    const current = state.players[state.turn];
    const canMove = current.horses.some(progress => progress === -1 ? state.die === 6 : progress < 28 && progress + state.die <= 28);
    state.status = canMove ? 'Chọn một quân để di chuyển.' : state.die === 6 ? 'Không có nước đi hợp lệ.' : 'Không có nước đi · lượt kế tiếp.';
    if (!canMove) {
      state.die = null;
      state.turn = (state.turn + 1) % state.playerCount;
      state.status = 'Đổ xúc xắc. Cần 6 để đưa ngựa ra khỏi chuồng.';
    }
    render();
    scheduleHorseAI();
  }
  function scheduleHorseAI() {
    const state = states.horses;
    if (!state || state.mode !== 'computer' || state.turn !== 1 || state.winner >= 0 || state.die != null || state.aiThinking) return;
    state.aiThinking = true;
    render();
    scheduleAI('horses', () => {
      const current = states.horses;
      if (!current || current.mode !== 'computer' || current.turn !== 1 || current.winner >= 0) return;
      current.aiThinking = false;
      current.die = Math.floor(Math.random() * 6) + 1;
      const candidates = current.players[1].horses.map((progress, index) => {
        if (progress === -1) return current.die === 6 ? { index, next: 0, score: 40 } : null;
        const next = progress + current.die;
        if (progress >= 28 || next > 28) return null;
        const position = (current.players[1].start + next) % 28;
        const captures = current.players.some((player, playerIndex) => playerIndex !== 1
          && player.horses.some(other => other >= 0 && other < 28 && (player.start + other) % 28 === position));
        return { index, next, score: (next === 28 ? 10000 : next) + (captures ? 500 : 0) };
      }).filter(Boolean);
      if (!candidates.length) {
        current.die = null;
        current.turn = 0;
        current.status = 'Đổ xúc xắc. Cần 6 để đưa ngựa ra khỏi chuồng.';
        render();
        return;
      }
      const best = Math.max(...candidates.map(candidate => candidate.score));
      const choices = candidates.filter(candidate => candidate.score === best);
      const choice = choices[Math.floor(Math.random() * choices.length)];
      moveHorse(1, choice.index, true);
    });
  }
  function moveHorse(playerIndex, horseIndex, computerMove = false) {
    const state = states.horses;
    if (!state || state.winner >= 0 || state.die == null || playerIndex !== state.turn || state.aiThinking
      || (state.mode === 'computer' && playerIndex === 1 && !computerMove)) return;
    const player = state.players[playerIndex], oldProgress = player.horses[horseIndex], die = state.die;
    if (oldProgress === -1 && die !== 6) return;
    const progress = oldProgress === -1 ? 0 : oldProgress + die;
    if (progress > 28) return;
    player.horses[horseIndex] = progress;
    let captured = false;
    if (progress < 28) {
      const position = (player.start + progress) % 28;
      if (!state.players.some(entry => entry.start === position)) {
        for (let otherIndex = 0; otherIndex < state.players.length; otherIndex++) {
          if (otherIndex === playerIndex) continue;
          const other = state.players[otherIndex];
          for (let i = 0; i < other.horses.length; i++) {
            if (other.horses[i] >= 0 && other.horses[i] < 28 && (other.start + other.horses[i]) % 28 === position) {
              other.horses[i] = -1;
              captured = true;
            }
          }
        }
      }
    }
    if (player.horses.every(value => value === 28)) state.winner = playerIndex;
    const extraTurn = die === 6 || captured;
    state.die = null;
    if (state.winner < 0 && !extraTurn) state.turn = (state.turn + 1) % state.playerCount;
    state.status = state.winner >= 0
      ? `${player.name} đã đưa đủ ngựa về đích.`
      : extraTurn ? 'Được thêm lượt! Đổ xúc xắc tiếp.' : 'Đổ xúc xắc. Cần 6 để đưa ngựa ra khỏi chuồng.';
    render();
    scheduleHorseAI();
  }
  function renderChess() {
    const state = states.chess;
    const section = element('section', 'yard-game-play');
    const controls = element('div', 'yard-game-controls');
    controls.appendChild(modePicker(state.mode, mode => {
      clearAITimer('chess');
      states.chess = initialChessState(mode);
      render();
    }));
    section.appendChild(controls);
    section.appendChild(element('p', 'yard-game-status', state.aiThinking ? 'Máy đang suy nghĩ…' : state.status));
    const board = element('div', 'chess-board');
    board.setAttribute('role', 'grid');
    const legalTargets = new Set(state.legal.map(move => move.to.join(',')));
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const piece = state.board[r][c];
      const selected = state.selected?.[0] === r && state.selected?.[1] === c;
      const target = legalTargets.has(`${r},${c}`);
      const square = button(piece ? CHESS_GLYPHS[piece.color + piece.type] : '',
        `chess-square ${(r + c) % 2 ? 'dark' : 'light'}${selected ? ' selected' : ''}${target ? ' legal' : ''}${piece?.color === 'w' ? ' white-piece' : ''}`,
        () => clickChess(r, c));
      square.setAttribute('aria-label', `${String.fromCharCode(97 + c)}${8 - r}${piece ? ` ${piece.color === 'w' ? 'Trắng' : 'Đen'} ${piece.type}` : ''}`);
      square.disabled = state.finished || state.aiThinking || (state.mode === 'computer' && state.turn === 'b');
      board.appendChild(square);
    }
    section.appendChild(board);
    section.appendChild(element('p', 'yard-game-help', 'Luân phiên Trắng–Đen · nhập thành, bắt tốt qua đường và phong hậu tự động.'));
    section.appendChild(button('Ván mới', 'yard-game-primary', reset));
    content.appendChild(section);
  }
  function clickChess(row, col) {
    const state = states.chess;
    if (state.finished || state.aiThinking || (state.mode === 'computer' && state.turn === 'b')) return;
    if (state.selected) {
      const move = state.legal.find(item => item.to[0] === row && item.to[1] === col);
      if (move) {
        completeChessMove(move);
        return;
      }
    }
    if (state.board[row][col]?.color === state.turn) {
      state.selected = [row, col];
      state.legal = chessLegalMoves(state, row, col);
    } else {
      state.selected = null;
      state.legal = [];
    }
    render();
  }
  function completeChessMove(move) {
    const state = states.chess;
    const next = chessApply(state, move);
    next.turn = state.turn === 'w' ? 'b' : 'w';
    next.selected = null;
    next.legal = [];
    next.aiThinking = false;
    const checked = chessInCheck(next.board, next.turn);
    const moves = chessAllLegalMoves(next, next.turn);
    if (!moves.length) {
      next.finished = true;
      next.status = checked
        ? `Chiếu hết! ${next.turn === 'w' ? 'Đen' : 'Trắng'} thắng.`
        : 'Hòa cờ do hết nước đi hợp lệ.';
    } else if (next.mode === 'computer' && next.turn === 'b') {
      next.aiThinking = true;
      next.status = 'Máy đang suy nghĩ…';
    } else next.status = `${next.turn === 'w' ? 'Lượt Trắng' : 'Lượt Đen'}${checked ? ' · Chiếu!' : ''}`;
    states.chess = next;
    render();
    if (next.aiThinking) scheduleAI('chess', playChessAI);
  }
  function playChessAI() {
    const state = states.chess;
    if (!state || state.mode !== 'computer' || state.turn !== 'b' || !state.aiThinking) return;
    const move = bestChessMove(state);
    if (!move) {
      state.aiThinking = false;
      state.finished = true;
      state.status = 'Máy không còn nước đi hợp lệ.';
      render();
      return;
    }
    completeChessMove(move);
  }
  function render() {
    renderTabs();
    content.replaceChildren();
    const heading = element('header', 'yard-game-heading');
    heading.append(
      element('div', 'yard-game-eyebrow', 'KỲ ĐÀI HỌC TRÒ · CHƠI TẠI MÁY'),
      element('h3', '', GAME_NAMES[activeGame]),
    );
    content.appendChild(heading);
    if (activeGame === 'caro') renderCaro();
    else if (activeGame === 'horses') renderHorses();
    else renderChess();
  }
  render();
  return () => {
    for (const timer of aiTimers.values()) clearTimeout(timer);
    aiTimers.clear();
    content.replaceChildren();
    tabs.replaceChildren();
  };
}

// ====== CORE SETUP ======
const boardElement = document.getElementById('board');
let board = [], selected = null, legalMoves = [], lastMove = null, turn = 'white';

let capturedByWhite = [],  // black pieces captured
  capturedByBlack = [];  // white pieces captured

let SIMULATING = false;   // true only inside wouldBeInCheck

let activeEffects = {
  portal: null
};

// initial piece layout (lowercase=black, uppercase=white)
const initial = [
  ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
  ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
  ['', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', ''],
  ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
  ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
];

// build a piece object from its char
function makePiece(ch) {
  if (!ch) return null;
  return {
    color: ch === ch.toUpperCase() ? 'white' : 'black',
    type: ch.toLowerCase(),
    hasMoved: false,
    frozen: 0,
    shielded: 0
  };
}

// ====== INITIALIZE & RENDER ======
function initBoard() {
  board = initial.map(row => row.map(makePiece));
  selected = null; legalMoves = []; lastMove = null; turn = 'white';
  capturedByWhite = [];
  capturedByBlack = [];
  activeEffects = { portal: null };
  renderBoard();
  updateCapturedDisplays();
}

function renderBoard() {
  boardElement.innerHTML = '';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = document.createElement('div');
      sq.className = `square ${((r + c) % 2) ? 'dark' : 'light'}`;
      sq.dataset.r = r; sq.dataset.c = c;
      sq.addEventListener('click', onSquareClick);

      // Effects rendering
      if (activeEffects.portal) {
        const { a, b } = activeEffects.portal;
        if ((r === a.r && c === a.c) || (r === b.r && c === b.c)) {
          sq.classList.add('portal');
        }
      }

      // 1) mark selected square
      if (selected && selected.r === r && selected.c === c) {
        sq.classList.add('selected');
      }

      // 2) show legal-move dots
      if (legalMoves.some(m => m.r === r && m.c === c)) {
        const dot = document.createElement('div');
        dot.className = 'dot';
        sq.appendChild(dot);
      }

      // draw the piece SVG if present
      const p = board[r][c];
      if (p) {
        if (p.type === 'boulder') {
          const boulderEl = document.createElement('div');
          boulderEl.className = 'boulder-icon';
          boulderEl.textContent = '🪨';
          sq.appendChild(boulderEl);
        } else {
          const img = document.createElement('img');
          const prefix = p.color === 'white' ? 'w' : 'b';
          img.src = `images/${prefix}-${p.type}.svg`;
          img.alt = `${p.color} ${p.type}`;
          sq.appendChild(img);
        }
        if (p.frozen > 0) {
          sq.classList.add('frozen');
        }
        if (p.shielded > 0) {
          sq.classList.add('shielded');
        }
      }

      boardElement.appendChild(sq);
    }
  }
}

// ====== MAGICAL EFFECTS ======
function advanceTurnEffects() {
  if (SIMULATING) return;

  // Decrement freeze and shield
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p) {
        if (p.frozen > 0) p.frozen--;
        if (p.shielded > 0) p.shielded--;
      }
    }
  }

  // Decrement portal
  if (activeEffects.portal) {
    activeEffects.portal.turnsLeft--;
    if (activeEffects.portal.turnsLeft <= 0) {
      const { a, b } = activeEffects.portal;
      if (board[a.r][a.c]) board[a.r][a.c] = null;
      if (board[b.r][b.c]) board[b.r][b.c] = null;
      activeEffects.portal = null;
    }
  }
}

function applyRandomEffect() {
  if (SIMULATING) return;

  // 70% chance to trigger any magic
  if (Math.random() > 0.70) return;

  const effects = [
    { name: 'lightning', weight: 10 },
    { name: 'freeze', weight: 10 },
    { name: 'boulder', weight: 8 },
    { name: 'tornado', weight: 8 },
    { name: 'portal', weight: 4 },
    { name: 'resurrection', weight: 4 },
    { name: 'shield', weight: 4 }
  ];

  const totalWeight = effects.reduce((sum, e) => sum + e.weight, 0);
  let randomVal = Math.random() * totalWeight;
  let effect = null;
  for (const e of effects) {
    if (randomVal < e.weight) {
      effect = e.name;
      break;
    }
    randomVal -= e.weight;
  }

  let emptySquares = [];
  let validPieces = [];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) emptySquares.push({ r, c });
      else if (p.type !== 'k' && p.type !== 'boulder') validPieces.push({ r, c, p });
    }
  }

  if (effect === 'lightning') {
    const sq = { r: Math.floor(Math.random() * 8), c: Math.floor(Math.random() * 8) };
    const p = board[sq.r][sq.c];
    if (p && p.type !== 'k' && p.type !== 'boulder') {
      if (p.shielded > 0) {
        p.shielded = 0; // lightning breaks shield
      } else {
        if (p.color === 'white') capturedByBlack.push(p);
        else capturedByWhite.push(p);
        board[sq.r][sq.c] = null;
        if (activeEffects.portal) {
          const { a, b } = activeEffects.portal;
          if (sq.r === a.r && sq.c === a.c) board[b.r][b.c] = null;
          if (sq.r === b.r && sq.c === b.c) board[a.r][a.c] = null;
        }
      }
    }
    const el = boardElement.children[sq.r * 8 + sq.c];
    if (el) {
      el.classList.add('lightning');
      setTimeout(() => el.classList.remove('lightning'), 500);
    }
  }
  else if (effect === 'freeze') {
    if (validPieces.length > 0) {
      const target = validPieces[Math.floor(Math.random() * validPieces.length)];
      target.p.frozen = 2; // frozen until player's next move finishes
    }
  }
  else if (effect === 'boulder') {
    if (emptySquares.length > 0) {
      const target = emptySquares[Math.floor(Math.random() * emptySquares.length)];
      board[target.r][target.c] = { type: 'boulder', color: 'neutral', hasMoved: true, frozen: 0, shielded: 0 };
    }
  }
  else if (effect === 'portal') {
    if (!activeEffects.portal && emptySquares.length >= 2) {
      emptySquares.sort(() => Math.random() - 0.5);
      activeEffects.portal = {
        a: emptySquares[0],
        b: emptySquares[1],
        turnsLeft: 4 // Lasts for 2 full rounds
      };
    }
  }
  else if (effect === 'tornado') {
    if (validPieces.length > 0 && emptySquares.length > 0) {
      const target = validPieces[Math.floor(Math.random() * validPieces.length)];
      const dest = emptySquares[Math.floor(Math.random() * emptySquares.length)];
      
      board[dest.r][dest.c] = target.p;
      board[target.r][target.c] = null;
      
      const srcEl = boardElement.children[target.r * 8 + target.c];
      const destEl = boardElement.children[dest.r * 8 + dest.c];
      if (srcEl) srcEl.classList.add('tornado-src');
      if (destEl) destEl.classList.add('tornado-dest');
      setTimeout(() => {
        if (srcEl) srcEl.classList.remove('tornado-src');
        if (destEl) destEl.classList.remove('tornado-dest');
      }, 800);
    }
  }
  else if (effect === 'resurrection') {
    const bothCaptured = capturedByWhite.concat(capturedByBlack);
    if (bothCaptured.length > 0 && emptySquares.length > 0) {
      const isWhiteList = capturedByBlack.length === 0 ? true : 
                          (capturedByWhite.length === 0 ? false : 
                           Math.random() < (capturedByWhite.length / bothCaptured.length));
      
      const targetList = isWhiteList ? capturedByWhite : capturedByBlack;
      if (targetList.length > 0) {
        const pIdx = Math.floor(Math.random() * targetList.length);
        const p = targetList.splice(pIdx, 1)[0];
        const dest = emptySquares[Math.floor(Math.random() * emptySquares.length)];
        
        p.hasMoved = true;
        p.frozen = 0;
        p.shielded = 0;
        board[dest.r][dest.c] = p;
        
        const destEl = boardElement.children[dest.r * 8 + dest.c];
        if (destEl) {
          destEl.classList.add('resurrected');
          setTimeout(() => destEl.classList.remove('resurrected'), 1000);
        }
      }
    }
  }
  else if (effect === 'shield') {
    if (validPieces.length > 0) {
      const target = validPieces[Math.floor(Math.random() * validPieces.length)];
      target.p.shielded = 3; // shielded for 3 half-turns
    }
  }
}

// ====== CLICK HANDLING ======
function onSquareClick(e) {
  const r = parseInt(e.currentTarget.dataset.r, 10);
  const c = parseInt(e.currentTarget.dataset.c, 10);
  const piece = board[r][c];

  if (selected && selected.r === r && selected.c === c) {
    selected = null;
    legalMoves = [];
    return renderBoard();
  }

  if (selected) {
    const move = legalMoves.find(m => m.r === r && m.c === c);
    if (move) {
      movePiece(selected, move);
      turn = (turn === 'white') ? 'black' : 'white';

      advanceTurnEffects();
      applyRandomEffect();
      updateCapturedDisplays();

      const sideToMove = turn;
      const hasAnyMove = board.flatMap((row, r) =>
        row.flatMap((p, c) =>
          (p && p.color === sideToMove) ? getLegalMoves(r, c) : []
        )
      ).length > 0;

      if (!hasAnyMove) {
        if (isInCheck(sideToMove)) {
          const winner = sideToMove === 'white' ? 'Black' : 'White';
          document.getElementById('game-over-msg').textContent = `${winner} wins by checkmate!`;
        } else {
          document.getElementById('game-over-msg').textContent = `Stalemate! Game is a draw.`;
        }
        document.getElementById('game-over').classList.remove('hidden');
      }

      selected = null;
      legalMoves = [];
      return renderBoard();
    } else if (piece && piece.color === turn && piece.frozen === 0) {
      selected = { r, c };
      legalMoves = getLegalMoves(r, c);
      return renderBoard();
    }

    selected = null;
    legalMoves = [];
    return renderBoard();
  }

  if (piece && piece.color === turn && piece.frozen === 0) {
    selected = { r, c };
    legalMoves = getLegalMoves(r, c);
    return renderBoard();
  }
}

// ====== MOVE LOGIC ======
const dirs = {
  p: [[1, 0]],
  n: [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]],
  b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  q: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]],
  k: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
};

function getLegalMovesCore(r, c) {
  const p = board[r][c];
  if (!p) return [];
  let moves = [];
  const sign = p.color === 'white' ? -1 : 1;

  if (p.type === 'p') {
    const nr = r + sign;
    if (inBounds(nr, c) && !board[nr][c]) moves.push({ r: nr, c });
    if (!p.hasMoved) {
      const nr2 = r + 2 * sign;
      if (inBounds(nr2, c) && !board[nr2][c] && !board[nr + sign][c]) {
        moves.push({ r: nr2, c });
      }
    }
    for (let dc of [-1, 1]) {
      const nc = c + dc;
      if (inBounds(nr, nc)) {
        const target = board[nr][nc];
        if (target && target.color !== p.color && target.type !== 'boulder' && target.shielded === 0) {
          moves.push({ r: nr, c: nc });
        }
        if (!target && lastMove?.piece?.type === 'p') {
          const lm = lastMove;
          if (lm.from.r === r + 2 * sign && lm.to.r === r && lm.to.c === nc) {
            moves.push({ r: nr, c: nc, enPassant: true });
          }
        }
      }
    }
  } else {
    for (let [dr, dc] of dirs[p.type]) {
      const maxSteps = (p.type === 'n' || p.type === 'k') ? 1 : 8;
      for (let i = 1; i <= maxSteps; i++) {
        const nr = r + dr * i, nc = c + dc * i;
        if (!inBounds(nr, nc)) break;
        const target = board[nr][nc];
        if (!target) {
          moves.push({ r: nr, c: nc });
        } else {
          if (target.color !== p.color && target.type !== 'boulder' && target.shielded === 0) moves.push({ r: nr, c: nc });
          break;
        }
      }
    }
    if (p.type === 'k' && !p.hasMoved && !isInCheck(p.color)) {
      if (canCastle(r, c, 'king')) moves.push({ r, c: c + 2, castle: 'king' });
      if (canCastle(r, c, 'queen')) moves.push({ r, c: c - 2, castle: 'queen' });
    }
  }

  return moves;
}

function getLegalMoves(r, c) {
  const p = board[r][c];
  if (!p || p.frozen > 0) return [];

  let moves = getLegalMovesCore(r, c);

  if (activeEffects.portal) {
    const { a, b } = activeEffects.portal;
    if (r === a.r && c === a.c) moves = moves.concat(getLegalMovesCore(b.r, b.c));
    else if (r === b.r && c === b.c) moves = moves.concat(getLegalMovesCore(a.r, a.c));
  }

  return moves.filter(m => !wouldBeInCheck(r, c, m));
}

function inBounds(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function movePiece(from, to) {
  const p = board[from.r][from.c];

  const target = board[to.r][to.c];
  if (!SIMULATING && target) {
    if (target.type !== 'boulder') {
      if (target.color === 'white') capturedByBlack.push(target);
      else capturedByWhite.push(target);
    }
  }

  if (to.enPassant) {
    const sign = p.color === 'white' ? 1 : -1;
    const epVictim = board[to.r + sign][to.c];
    board[to.r + sign][to.c] = null;
    if (!SIMULATING && epVictim && epVictim.type !== 'boulder') {
      if (epVictim.color === 'white') capturedByBlack.push(epVictim);
      else capturedByWhite.push(epVictim);
    }

    if (activeEffects.portal) {
      const { a, b } = activeEffects.portal;
      if (to.r + sign === a.r && to.c === a.c) board[b.r][b.c] = null;
      if (to.r + sign === b.r && to.c === b.c) board[a.r][a.c] = null;
    }
  }

  if (to.castle) {
    const rookC = to.castle === 'king' ? 7 : 0;
    const newRookC = to.castle === 'king' ? to.c - 1 : to.c + 1;
    const rook = board[from.r][rookC];
    board[from.r][rookC] = null;
    board[from.r][newRookC] = rook;
    rook.hasMoved = true;

    if (activeEffects.portal) {
      const { a, b } = activeEffects.portal;
      if (from.r === a.r && rookC === a.c) board[b.r][b.c] = null;
      if (from.r === b.r && rookC === b.c) board[a.r][a.c] = null;

      if (from.r === a.r && newRookC === a.c) board[b.r][b.c] = rook;
      if (from.r === b.r && newRookC === b.c) board[a.r][a.c] = rook;
    }
  }

  board[to.r][to.c] = p;
  board[from.r][from.c] = null;

  if (activeEffects.portal) {
    const { a, b } = activeEffects.portal;
    if (from.r === a.r && from.c === a.c) board[b.r][b.c] = null;
    if (from.r === b.r && from.c === b.c) board[a.r][a.c] = null;

    if (to.r === a.r && to.c === a.c) board[b.r][b.c] = p;
    if (to.r === b.r && to.c === b.c) board[a.r][a.c] = p;
  }

  p.hasMoved = true;

  if (p.type === 'p' && (to.r === 0 || to.r === 7)) p.type = 'q';

  if (!SIMULATING) lastMove = { from, to, piece: { ...p } };
  if (!SIMULATING) updateCapturedDisplays();
}

function canCastle(r, c, side) {
  const p = board[r][c];
  const rookC = side === 'king' ? 7 : 0;
  const rook = board[r][rookC];
  if (!rook || rook.type !== 'r' || rook.color !== p.color || rook.hasMoved) return false;
  const dir = side === 'king' ? 1 : -1;
  for (let i = 1; i < (side === 'king' ? 3 : 4); i++) {
    const nc = c + dir * i;
    if (board[r][nc] || (i <= 2 && squareAttacked(r, nc, p.color))) return false;
  }
  return true;
}

function getPseudoMoves(r, c) {
  const p = board[r][c];
  if (!p) return [];
  const dirsFor = {
    p: [],
    n: dirs.n,
    b: dirs.b,
    r: dirs.r,
    q: dirs.q,
    k: dirs.k
  };
  let moves = [];
  if (p.type === 'p') {
    const sign = p.color === 'white' ? -1 : 1;
    for (let dc of [-1, 1]) {
      const nr = r + sign, nc = c + dc;
      if (inBounds(nr, nc)) moves.push({ r: nr, c: nc });
    }
  } else {
    for (let [dr, dc] of dirsFor[p.type]) {
      const max = (p.type === 'n' || p.type === 'k') ? 1 : 8;
      for (let i = 1; i <= max; i++) {
        const nr = r + dr * i, nc = c + dc * i;
        if (!inBounds(nr, nc)) break;
        moves.push({ r: nr, c: nc });
        if (board[nr][nc]) break;
      }
    }
  }
  return moves;
}

function squareAttacked(r, c, color) {
  const enemy = color === 'white' ? 'black' : 'white';
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const p = board[i][j];
      if (p && p.color === enemy && p.type !== 'boulder') {
        let pMoves = getPseudoMoves(i, j);
        if (activeEffects.portal) {
          const { a, b } = activeEffects.portal;
          if (i === a.r && j === a.c) pMoves = pMoves.concat(getPseudoMoves(b.r, b.c));
          else if (i === b.r && j === b.c) pMoves = pMoves.concat(getPseudoMoves(a.r, a.c));
        }
        if (pMoves.some(m => m.r === r && m.c === c)) {
          return true;
        }
      }
    }
  }
  return false;
}

function isInCheck(color) {
  let kings = [];
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const p = board[i][j];
      if (p && p.type === 'k' && p.color === color) {
        kings.push({ r: i, c: j });
      }
    }
  }
  if (kings.length === 0) return false;
  return kings.some(k => squareAttacked(k.r, k.c, color));
}

function wouldBeInCheck(r, c, move) {
  const boardSnap = JSON.stringify(board);
  const lastSnap = lastMove && { from: { ...lastMove.from }, to: { ...lastMove.to }, piece: { ...lastMove.piece } };
  const capWhiteSnap = [...capturedByWhite];
  const capBlackSnap = [...capturedByBlack];

  SIMULATING = true;
  movePiece({ r, c }, move);
  SIMULATING = false;

  const p = board[move.r][move.c];
  const inChk = p ? isInCheck(p.color) : false;

  board = JSON.parse(boardSnap);
  lastMove = lastSnap || null;
  capturedByWhite = capWhiteSnap;
  capturedByBlack = capBlackSnap;

  return inChk;
}

function updateCapturedDisplays() {
  const cb = document.getElementById('captured-black');
  const cw = document.getElementById('captured-white');
  cb.innerHTML = '';
  cw.innerHTML = '';

  capturedByBlack.forEach(p => {
    const img = document.createElement('img');
    img.src = `images/w-${p.type}.svg`;
    cb.appendChild(img);
  });

  capturedByWhite.forEach(p => {
    const img = document.createElement('img');
    img.src = `images/b-${p.type}.svg`;
    cw.appendChild(img);
  });
}

initBoard();

document.getElementById('restart-btn').addEventListener('click', () => {
  document.getElementById('game-over').classList.add('hidden');
  initBoard();
});

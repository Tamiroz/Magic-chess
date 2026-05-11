// ====== CORE SETUP ======
const boardElement = document.getElementById('board');
let board = [], selected = null, legalMoves = [], lastMove = null, turn = 'white';

let capturedByWhite = [],  // black pieces captured
  capturedByBlack = [];  // white pieces captured

let SIMULATING = false;   // true only inside wouldBeInCheck

let activeEffects = {
  portal: null
};

let stateHistory = [];
let pendingAnimations = [];

function saveState() {
  stateHistory.push({
    board: JSON.stringify(board),
    turn,
    capturedByWhite: [...capturedByWhite],
    capturedByBlack: [...capturedByBlack],
    activeEffects: JSON.stringify(activeEffects)
  });
}

function restoreState() {
  const prevState = stateHistory.pop();
  board = JSON.parse(prevState.board);
  turn = prevState.turn;
  capturedByWhite = prevState.capturedByWhite;
  capturedByBlack = prevState.capturedByBlack;
  activeEffects = JSON.parse(prevState.activeEffects);

  if (activeEffects.portal) {
    const { a, b } = activeEffects.portal;
    if (board[a.r][a.c] && board[b.r][b.c]) {
      board[b.r][b.c] = board[a.r][a.c];
    }
  }
}

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
  stateHistory = [];
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

      // Add pending animations
      const anims = pendingAnimations.filter(a => a.r === r && a.c === c);
      for (const a of anims) {
        sq.classList.add(a.animClass);
      }

      boardElement.appendChild(sq);
    }
  }

  // Clear pending animations so they only play once
  pendingAnimations = [];
}

// ====== MAGICAL EFFECTS ======
function advanceTurnEffects() {
  if (SIMULATING) return;

  // Decrement freeze and shield
  const processed = new Set();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && !processed.has(p)) {
        processed.add(p);
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
      const p = board[a.r][a.c];
      if (p && p.type !== 'boulder') {
        if (p.color === 'white') capturedByBlack.push(p);
        else capturedByWhite.push(p);
      }
      if (board[a.r][a.c]) board[a.r][a.c] = null;
      if (board[b.r][b.c]) board[b.r][b.c] = null;
      activeEffects.portal = null;
    }
  }
}

function showNotification(text, colorHex) {
  const notif = document.getElementById('effect-notification');
  notif.textContent = text;
  notif.style.textShadow = `0 0 10px ${colorHex}, 0 0 20px ${colorHex}`;
  notif.classList.remove('show-notification');
  // trigger reflow to restart animation
  void notif.offsetWidth;
  notif.classList.add('show-notification');
}

function applyRandomEffect() {
  if (SIMULATING) return;

  // 1/6 chance to trigger any magic per turn (~16.6%)
  if (Math.random() > 1 / 6) return;

  // Weights strictly adjusted by strength (higher weight = more common, lower = rarer)
  const effects = [
    { name: 'boulder', weight: 15 },       // Mild: just blocks a square
    { name: 'freeze', weight: 12 },        // Mild: immobilizes one piece
    { name: 'shield', weight: 12 },        // Mild: protective buff
    { name: 'portal', weight: 8 },         // Moderate: tactical map change
    { name: 'tornado', weight: 6 },        // Moderate: unexpected reposition
    { name: 'lightning', weight: 5 },      // Strong: destroys a piece
    { name: 'swap', weight: 3 },           // Very Strong: ruins positional play
    { name: 'resurrection', weight: 3 },   // Very Strong: brings back captured pieces
    { name: 'mindcontrol', weight: 1 },    // Game-Changing: steals an enemy piece
    { name: 'timewarp', weight: 1 }        // Game-Changing: cancels the entire turn
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
    pendingAnimations.push({ r: sq.r, c: sq.c, animClass: 'lightning' });
    setTimeout(() => {
      const idx = sq.r * 8 + sq.c;
      if (boardElement.children[idx]) boardElement.children[idx].classList.remove('lightning');
    }, 500);
    showNotification('⚡ Lightning Strike!', '#ffff00');
  }
  else if (effect === 'freeze') {
    if (validPieces.length > 0) {
      const target = validPieces[Math.floor(Math.random() * validPieces.length)];
      target.p.frozen = 2; // frozen until player's next move finishes
      showNotification('❄️ Freeze!', '#00ffff');
    }
  }
  else if (effect === 'boulder') {
    if (emptySquares.length > 0) {
      const target = emptySquares[Math.floor(Math.random() * emptySquares.length)];
      const bPiece = { type: 'boulder', color: 'neutral', hasMoved: true, frozen: 0, shielded: 0 };
      board[target.r][target.c] = bPiece;
      if (activeEffects.portal) {
        const { a, b } = activeEffects.portal;
        if (target.r === a.r && target.c === a.c) board[b.r][b.c] = bPiece;
        if (target.r === b.r && target.c === b.c) board[a.r][a.c] = bPiece;
      }
      showNotification('🪨 Boulder Dropped!', '#a9a9a9');
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
      showNotification('🌀 Portals Opened!', '#8a2be2');
    }
  }
  else if (effect === 'tornado') {
    if (validPieces.length > 0 && emptySquares.length > 0) {
      const target = validPieces[Math.floor(Math.random() * validPieces.length)];
      const dest = emptySquares[Math.floor(Math.random() * emptySquares.length)];

      board[dest.r][dest.c] = target.p;
      board[target.r][target.c] = null;

      if (activeEffects.portal) {
        const { a, b } = activeEffects.portal;
        if (target.r === a.r && target.c === a.c) board[b.r][b.c] = null;
        if (target.r === b.r && target.c === b.c) board[a.r][a.c] = null;

        if (dest.r === a.r && dest.c === a.c) board[b.r][b.c] = target.p;
        if (dest.r === b.r && dest.c === b.c) board[a.r][a.c] = target.p;
      }

      pendingAnimations.push({ r: target.r, c: target.c, animClass: 'tornado-src' });
      pendingAnimations.push({ r: dest.r, c: dest.c, animClass: 'tornado-dest' });
      setTimeout(() => {
        const srcIdx = target.r * 8 + target.c;
        const destIdx = dest.r * 8 + dest.c;
        if (boardElement.children[srcIdx]) boardElement.children[srcIdx].classList.remove('tornado-src');
        if (boardElement.children[destIdx]) boardElement.children[destIdx].classList.remove('tornado-dest');
      }, 800);
      showNotification('🌪️ Tornado!', '#ffffff');
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

        if (activeEffects.portal) {
          const { a, b } = activeEffects.portal;
          if (dest.r === a.r && dest.c === a.c) board[b.r][b.c] = p;
          if (dest.r === b.r && dest.c === b.c) board[a.r][a.c] = p;
        }

        pendingAnimations.push({ r: dest.r, c: dest.c, animClass: 'resurrected' });
        setTimeout(() => {
          const destIdx = dest.r * 8 + dest.c;
          if (boardElement.children[destIdx]) boardElement.children[destIdx].classList.remove('resurrected');
        }, 1000);
        showNotification('✨ Resurrection!', '#00ff00');
      }
    }
  }
  else if (effect === 'shield') {
    if (validPieces.length > 0) {
      const target = validPieces[Math.floor(Math.random() * validPieces.length)];
      target.p.shielded = 3; // shielded for 3 half-turns
      showNotification('🛡️ Shield Applied!', '#ffd700');
    }
  }
  else if (effect === 'swap') {
    const whitePieces = validPieces.filter(vp => vp.p.color === 'white');
    const blackPieces = validPieces.filter(vp => vp.p.color === 'black');
    if (whitePieces.length > 0 && blackPieces.length > 0) {
      const w = whitePieces[Math.floor(Math.random() * whitePieces.length)];
      const b = blackPieces[Math.floor(Math.random() * blackPieces.length)];

      board[w.r][w.c] = b.p;
      board[b.r][b.c] = w.p;

      if (activeEffects.portal) {
        const { a, b: pb } = activeEffects.portal;
        if (w.r === a.r && w.c === a.c) board[pb.r][pb.c] = b.p;
        if (w.r === pb.r && w.c === pb.c) board[a.r][a.c] = b.p;
        if (b.r === a.r && b.c === a.c) board[pb.r][pb.c] = w.p;
        if (b.r === pb.r && b.c === pb.c) board[a.r][a.c] = w.p;
      }

      pendingAnimations.push({ r: w.r, c: w.c, animClass: 'swap-anim' });
      pendingAnimations.push({ r: b.r, c: b.c, animClass: 'swap-anim' });
      setTimeout(() => {
        const wIdx = w.r * 8 + w.c;
        const bIdx = b.r * 8 + b.c;
        if (boardElement.children[wIdx]) boardElement.children[wIdx].classList.remove('swap-anim');
        if (boardElement.children[bIdx]) boardElement.children[bIdx].classList.remove('swap-anim');
      }, 600);
      showNotification('🔄 Pieces Swapped!', '#ff8c00');
    }
  }
  else if (effect === 'mindcontrol') {
    const playerThatJustMoved = turn === 'white' ? 'black' : 'white';
    const enemyPieces = validPieces.filter(vp => vp.p.color === turn && vp.p.type !== 'k');
    if (enemyPieces.length > 0) {
      const target = enemyPieces[Math.floor(Math.random() * enemyPieces.length)];
      target.p.color = playerThatJustMoved;

      pendingAnimations.push({ r: target.r, c: target.c, animClass: 'mindcontrol-anim' });
      setTimeout(() => {
        const idx = target.r * 8 + target.c;
        if (boardElement.children[idx]) boardElement.children[idx].classList.remove('mindcontrol-anim');
      }, 1000);
      showNotification('👁️ Mind Control!', '#ff00ff');
    }
  }
  else if (effect === 'timewarp' && stateHistory.length > 0) {
    const turnsToRewind = Math.min(stateHistory.length, Math.floor(Math.random() * 2) + 2); // 2 or 3 turns
    for (let i = 0; i < turnsToRewind; i++) {
      restoreState();
    }
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        pendingAnimations.push({ r, c, animClass: 'timewarp-anim' });
      }
    }
    setTimeout(() => {
      Array.from(boardElement.children).forEach(el => el.classList.remove('timewarp-anim'));
    }, 500);
    showNotification(`⏳ Time Warp! (-${turnsToRewind} turns)`, '#00ffff');
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
      if (!SIMULATING) saveState();
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
            const epVictim = board[r][nc];
            if (epVictim && epVictim.shielded === 0) {
              moves.push({ r: nr, c: nc, enPassant: true });
            }
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
  if (!rook || rook.type !== 'r' || rook.color !== p.color || rook.hasMoved || rook.frozen > 0) return false;
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
  if (activeEffects.portal) {
    const { a, b } = activeEffects.portal;
    if (board[a.r][a.c] && board[b.r][b.c]) {
      board[b.r][b.c] = board[a.r][a.c];
    }
  }

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

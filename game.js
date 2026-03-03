'use strict';

const EMOJIS = ['🐶', '🐱', '🦊', '🐸', '🦁', '🐧', '🦋', '🌟'];

let moves = 0;
let pairsFound = 0;
let firstCard = null;
let secondCard = null;
let lockBoard = false;

const board        = document.getElementById('board');
const movesEl      = document.getElementById('moves');
const pairsEl      = document.getElementById('pairs');
const winOverlay   = document.getElementById('win-overlay');
const winMessage   = document.getElementById('win-message');

document.getElementById('new-game-btn').addEventListener('click', startGame);
document.getElementById('play-again-btn').addEventListener('click', () => {
  winOverlay.hidden = true;
  startGame();
});

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createCard(emoji) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.emoji = emoji;

  card.innerHTML = `
    <div class="card-inner">
      <div class="card-face card-back"></div>
      <div class="card-face card-front">${emoji}</div>
    </div>
  `;

  card.addEventListener('click', onCardClick);
  return card;
}

function onCardClick() {
  if (lockBoard) return;
  if (this === firstCard) return;
  if (this.classList.contains('matched')) return;

  this.classList.add('flipped');

  if (!firstCard) {
    firstCard = this;
    return;
  }

  secondCard = this;
  lockBoard = true;
  moves++;
  movesEl.textContent = moves;

  checkMatch();
}

function checkMatch() {
  const isMatch = firstCard.dataset.emoji === secondCard.dataset.emoji;
  isMatch ? markMatched() : flipBack();
}

function markMatched() {
  firstCard.classList.add('matched');
  secondCard.classList.add('matched');
  firstCard.removeEventListener('click', onCardClick);
  secondCard.removeEventListener('click', onCardClick);

  pairsFound++;
  pairsEl.textContent = `${pairsFound} / ${EMOJIS.length}`;

  resetTurn();

  if (pairsFound === EMOJIS.length) {
    setTimeout(showWin, 400);
  }
}

function flipBack() {
  setTimeout(() => {
    firstCard.classList.remove('flipped');
    secondCard.classList.remove('flipped');
    resetTurn();
  }, 900);
}

function resetTurn() {
  firstCard = null;
  secondCard = null;
  lockBoard = false;
}

function showWin() {
  winMessage.textContent = `You matched all pairs in ${moves} move${moves === 1 ? '' : 's'}!`;
  winOverlay.hidden = false;
}

function startGame() {
  moves = 0;
  pairsFound = 0;
  firstCard = null;
  secondCard = null;
  lockBoard = false;

  movesEl.textContent = '0';
  pairsEl.textContent = `0 / ${EMOJIS.length}`;

  const deck = shuffle([...EMOJIS, ...EMOJIS]);
  board.innerHTML = '';
  deck.forEach(emoji => board.appendChild(createCard(emoji)));
}

startGame();

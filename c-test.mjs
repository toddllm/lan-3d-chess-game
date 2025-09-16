import { Chess } from 'chess.js';

const game = new Chess('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
const move = game.move('e4');

console.log('Move:', move);
console.log('FEN:', game.fen());


const http = require('http');
const express = require('express');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');
const { Chess } = require('chess.js');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));

// Serve three.js and OrbitControls from node_modules
app.use('/scripts/three.module.min.js', express.static(path.join(__dirname, '..', 'node_modules', 'three', 'build', 'three.module.min.js')));
app.use('/scripts/chess.js', express.static(path.join(__dirname, '..', 'node_modules', 'chess.js', 'dist', 'esm', 'chess.js')));
app.use('/scripts/', express.static(path.join(__dirname, '..', 'node_modules', 'three', 'examples', 'jsm')));


app.get('/favicon.ico', (req, res) => res.status(204).send());

app.get('/r/:roomId', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

const rooms = {};
const connIdCounter = 0;

function generateRoomId() {
    return Math.random().toString(36).substring(2, 8);
}

function getLanUrls(port) {
    const interfaces = os.networkInterfaces();
    const urls = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                urls.push(`http://${iface.address}:${port}`);
            }
        }
    }
    return urls;
}

function broadcastRoomState(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    const game = room.game;
    const result = getGameResult(game);

    const state = {
        type: 'roomState',
        roomId: room.id,
        fen: game.fen(),
        turn: game.turn(),
        lastMove: room.lastMove,
        inCheck: game.isCheck(),
        result,
        seats: {
            w: room.seats.w,
            b: room.seats.b,
        },
        players: room.players,
        drawOffer: room.drawOffer,
    };

    room.clients.forEach(client => {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify(state));
        }
    });
}

function getGameResult(game) {
    if (game.isCheckmate()) {
        return { status: 'checkmate', winner: game.turn() === 'w' ? 'b' : 'w' };
    }
    if (game.isStalemate()) {
        return { status: 'stalemate' };
    }
    if (game.isThreefoldRepetition()) {
        return { status: 'draw', reason: 'threefold repetition' };
    }
    if (game.isInsufficientMaterial()) {
        return { status: 'draw', reason: 'insufficient material' };
    }
    if (game.isDraw()) {
        return { status: 'draw', reason: '50-move rule' };
    }
    return null;
}

function getClient(roomId, ws) {
    const room = rooms[roomId];
    if (!room) return null;
    for (const client of room.clients) {
        if (client.ws === ws) {
            return client;
        }
    }
    return null;
}


wss.on('connection', (ws) => {
    ws.connId = `guest-${Math.random().toString(36).substring(2, 7)}`;
    ws.send(JSON.stringify({ type: 'welcome', connId: ws.connId }));

    let currentRoomId = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const { type, roomId } = data;

            if (type === 'createRoom') {
                const newRoomId = generateRoomId();
                rooms[newRoomId] = {
                    id: newRoomId,
                    game: new Chess(),
                    seats: { w: null, b: null },
                    clients: new Set(),
                    players: {},
                    lastMove: null,
                    drawOffer: null,
                    restartVotes: new Set(),
                    lastActivityTs: Date.now(),
                };
                ws.send(JSON.stringify({ type: 'roomCreated', roomId: newRoomId }));
                return;
            }

            if (!roomId || !rooms[roomId]) {
                ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
                return;
            }

            const room = rooms[roomId];
            const client = getClient(roomId, ws);

            switch (type) {
                case 'join': {
                    currentRoomId = roomId;
                    const newClient = {
                        ws,
                        connId: ws.connId,
                        nickname: `Guest-${ws.connId.slice(-4)}`
                    };
                    room.clients.add(newClient);
                    room.players[ws.connId] = { nickname: newClient.nickname };
                    room.lastActivityTs = Date.now();
                    broadcastRoomState(roomId);
                    break;
                }

                case 'takeSeat': {
                    const { color } = data;
                    if (room.seats[color]) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Seat already taken' }));
                        return;
                    }
                    // Vacate any other seat the player might have
                    if (room.seats.w === ws.connId) room.seats.w = null;
                    if (room.seats.b === ws.connId) room.seats.b = null;

                    room.seats[color] = ws.connId;
                    room.lastActivityTs = Date.now();
                    broadcastRoomState(roomId);
                    break;
                }

                case 'leaveSeat': {
                    if (room.seats.w === ws.connId) room.seats.w = null;
                    if (room.seats.b === ws.connId) room.seats.b = null;
                    room.lastActivityTs = Date.now();
                    broadcastRoomState(roomId);
                    break;
                }

                case 'move': {
                    if (room.seats[room.game.turn()] !== ws.connId) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Not your turn or you are not seated' }));
                        return;
                    }
                    try {
                        const move = room.game.move({ from: data.from, to: data.to, promotion: data.promotion });
                        if (move) {
                            room.lastMove = { from: move.from, to: move.to };
                            room.drawOffer = null; // Any move cancels a draw offer
                            room.lastActivityTs = Date.now();
                            broadcastRoomState(roomId);
                        } else {
                            ws.send(JSON.stringify({ type: 'error', message: 'Invalid move' }));
                        }
                    } catch (e) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Invalid move format' }));
                    }
                    break;
                }

                case 'resign': {
                    const playerColor = room.seats.w === ws.connId ? 'w' : (room.seats.b === ws.connId ? 'b' : null);
                    if (!playerColor) return;

                    room.game.setComment('Resigned');
                    const winner = playerColor === 'w' ? 'b' : 'w';
                    room.game.move('e8=Q'); // Invalid move to end game
                    room.game.undo();
                    room.game.header('Result', winner === 'w' ? '1-0' : '0-1');
                    
                    const roomState = rooms[roomId];
                    roomState.result = { status: 'resign', winner };
                    broadcastRoomState(roomId);
                    break;
                }

                case 'offerDraw': {
                    const playerColor = room.seats.w === ws.connId ? 'w' : (room.seats.b === ws.connId ? 'b' : null);
                    if (!playerColor || room.drawOffer) return;
                    room.drawOffer = playerColor;
                    room.lastActivityTs = Date.now();
                    broadcastRoomState(roomId);
                    break;
                }

                case 'respondDraw': {
                    const playerColor = room.seats.w === ws.connId ? 'w' : (room.seats.b === ws.connId ? 'b' : null);
                    if (!playerColor || !room.drawOffer || room.drawOffer === playerColor) return;

                    if (data.accept) {
                        room.game.setComment('Draw agreed');
                        room.game.header('Result', '1/2-1/2');
                        room.result = { status: 'draw', reason: 'agreement' };
                    }
                    room.drawOffer = null;
                    room.lastActivityTs = Date.now();
                    broadcastRoomState(roomId);
                    break;
                }
                
                case 'restart': {
                    const canRestart = (room.seats.w === null && room.seats.b === null) || (room.seats.w !== null && room.seats.b !== null);
                    if (!canRestart) return;

                    if (room.seats.w === null && room.seats.b === null) {
                        room.game.reset();
                        room.lastMove = null;
                        room.drawOffer = null;
                        room.result = null;
                        room.restartVotes.clear();
                        broadcastRoomState(roomId);
                        return;
                    }

                    const clientConnId = ws.connId;
                    if (room.seats.w === clientConnId || room.seats.b === clientConnId) {
                        room.restartVotes.add(clientConnId);
                    }

                    if (room.restartVotes.has(room.seats.w) && room.restartVotes.has(room.seats.b)) {
                        room.game.reset();
                        room.lastMove = null;
                        room.drawOffer = null;
                        room.result = null;
                        room.restartVotes.clear();
                        broadcastRoomState(roomId);
                    } else {
                        // Notify players that a restart has been requested
                        room.clients.forEach(c => c.ws.send(JSON.stringify({ type: 'restartRequested', from: ws.connId })));
                    }
                    break;
                }
            }
        } catch (e) {
            console.error('Error processing message:', e);
        }
    });

    ws.on('close', () => {
        if (!currentRoomId || !rooms[currentRoomId]) return;

        const room = rooms[currentRoomId];
        const client = getClient(currentRoomId, ws);
        if (client) {
            room.clients.delete(client);
            delete room.players[client.connId];
        }

        if (room.seats.w === ws.connId) room.seats.w = null;
        if (room.seats.b === ws.connId) room.seats.b = null;
        
        room.restartVotes.delete(ws.connId);

        if (room.clients.size === 0) {
            // Schedule room for deletion
            setTimeout(() => {
                if (rooms[currentRoomId] && rooms[currentRoomId].clients.size === 0) {
                    delete rooms[currentRoomId];
                    console.log(`Room ${currentRoomId} deleted due to inactivity.`);
                }
            }, 10 * 60 * 1000); // 10 minutes
        } else {
            broadcastRoomState(currentRoomId);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    const urls = getLanUrls(PORT);
    if (urls.length > 0) {
        console.log(`
Access the app via these LAN URLs:`);
        urls.forEach(url => console.log(`- ${url}`));
    } else {
        console.log(`
Could not determine LAN IP. Access via http://localhost:3000`);
    }
});

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Chess } from 'chess.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
let renderer;

let controls;
let webSocket;
let roomId = null;
let myConnId = null;
let playerColor = null;
let isSpectator = false;
let clientChess;

const pieceMeshes = {}; // { 'e1': mesh, ... }
const boardGroup = new THREE.Group();
let selectedPiece = null;
const legalMoveMarkers = [];

const state = {
    fen: null,
    turn: 'w',
    seats: { w: null, b: null },
    result: null,
};

// DOM Elements
const sceneContainer = document.getElementById('scene-container');
const homeScreen = document.getElementById('home-screen');
const roomScreen = document.getElementById('room-screen');
const createRoomBtn = document.getElementById('create-room-btn');
const roomIdDisplay = document.getElementById('room-id-display');
const playerInviteUrl = document.getElementById('player-invite-url');
const spectatorInviteUrl = document.getElementById('spectator-invite-url');
const turnIndicator = document.getElementById('turn-indicator');
const checkIndicator = document.getElementById('check-indicator');
const gameResult = document.getElementById('game-result');
const whitePlayerName = document.getElementById('white-player-name');
const blackPlayerName = document.getElementById('black-player-name');
const takeWhiteBtn = document.getElementById('take-white-btn');
const takeBlackBtn = document.getElementById('take-black-btn');
const leaveSeatBtn = document.getElementById('leave-seat-btn');
const flipBoardBtn = document.getElementById('flip-board-btn');
const resignBtn = document.getElementById('resign-btn');
const offerDrawBtn = document.getElementById('offer-draw-btn');
const acceptDrawBtn = document.getElementById('accept-draw-btn');
const declineDrawBtn = document.getElementById('decline-draw-btn');
const drawOfferStatus = document.getElementById('draw-offer-status');
const restartBtn = document.getElementById('restart-btn');
const promotionModal = document.getElementById('promotion-modal');
const promotionChoices = document.getElementById('promotion-choices');

function init() {
    if (!checkWebGL()) {
        document.getElementById('webgl-fallback').style.display = 'block';
        document.getElementById('scene-container').style.display = 'none';
    }

    handleRouting();
    bindUIEvents();
}

function checkWebGL() {
    try {
        const canvas = document.createElement('canvas');
        return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
    } catch (e) {
        return false;
    }
}

function handleRouting() {
    const path = window.location.pathname;
    if (path.startsWith('/r/')) {
        roomId = path.split('/')[2];
        const urlParams = new URLSearchParams(window.location.search);
        isSpectator = urlParams.has('spectate');
        showRoomScreen();
        connectWebSocket();
    } else {
        showHomeScreen();
    }
}

function showHomeScreen() {
    homeScreen.style.display = 'block';
    roomScreen.style.display = 'none';
}

function showRoomScreen() {
    homeScreen.style.display = 'none';
    roomScreen.style.display = 'block';
    roomIdDisplay.textContent = `Room: ${roomId}`;

    const base = window.location.origin;
    playerInviteUrl.value = `${base}/r/${roomId}`;
    spectatorInviteUrl.value = `${base}/r/${roomId}?spectate=1`;

    if (checkWebGL()) {
        init3D();
    }
}

function connectWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    webSocket = new WebSocket(`${wsProtocol}//${window.location.host}`);

    webSocket.onopen = () => {
        console.log('WebSocket connected');
        // The join message will be sent after we receive our connId
    };

    webSocket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        console.log('Received:', message);
        switch (message.type) {
            case 'welcome':
                myConnId = message.connId;
                sendMessage({ type: 'join', roomId, spectate: isSpectator });
                break;
            case 'roomState':
                handleRoomState(message);
                break;
            case 'roomCreated':
                window.location.href = `/r/${message.roomId}`;
                break;
            case 'error':
                alert(`Error: ${message.message}`);
                break;
            case 'restartRequested':
                alert(`Player wants to restart. Click Restart to agree.`);
                break;
        }
    };

    webSocket.onclose = () => {
        console.log('WebSocket disconnected');
        alert('Connection lost. Please refresh.');
    };
}

function sendMessage(message) {
    if (webSocket && webSocket.readyState === WebSocket.OPEN) {
        webSocket.send(JSON.stringify(message));
    }
}

function handleRoomState(newState) {
    const oldFen = state.fen;
    Object.assign(state, newState);
    clientChess = new Chess(state.fen);

    if (checkWebGL()) {
        updateBoard(oldFen, state.fen);
    }
    updateUI();
}

function bindUIEvents() {
    createRoomBtn.addEventListener('click', () => {
        // Temporarily connect to create a room
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const tempSocket = new WebSocket(`${wsProtocol}//${window.location.host}`);
        tempSocket.onopen = () => {
            // We don't need to wait for welcome here, just create
            tempSocket.send(JSON.stringify({ type: 'createRoom' }));
        };
        tempSocket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'roomCreated') {
                window.location.href = `/r/${message.roomId}`;
            }
        };
    });

    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetInput = document.querySelector(btn.dataset.target);
            targetInput.select();
            navigator.clipboard.writeText(targetInput.value).then(() => {
                alert('URL copied to clipboard!');
            });
        });
    });

    takeWhiteBtn.addEventListener('click', () => sendMessage({ type: 'takeSeat', roomId, color: 'w' }));
    takeBlackBtn.addEventListener('click', () => sendMessage({ type: 'takeSeat', roomId, color: 'b' }));
    leaveSeatBtn.addEventListener('click', () => sendMessage({ type: 'leaveSeat', roomId }));
    resignBtn.addEventListener('click', () => sendMessage({ type: 'resign', roomId }));
    offerDrawBtn.addEventListener('click', () => sendMessage({ type: 'offerDraw', roomId }));
    acceptDrawBtn.addEventListener('click', () => sendMessage({ type: 'respondDraw', roomId, accept: true }));
    declineDrawBtn.addEventListener('click', () => sendMessage({ type: 'respondDraw', roomId, accept: false }));
    restartBtn.addEventListener('click', () => sendMessage({ type: 'restart', roomId }));

    flipBoardBtn.addEventListener('click', () => {
        if (playerColor) return; // Players auto-flip
        const currentRot = boardGroup.rotation.y;
        boardGroup.rotation.y = (currentRot === 0) ? Math.PI : 0;
    });

    promotionChoices.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            const piece = e.target.dataset.piece;
            const { from, to } = promotionModal.dataset;
            sendMessage({ type: 'move', roomId, from, to, promotion: piece });
            promotionModal.style.display = 'none';
        }
    });
}

function updateUI() {
    // Seat display
    whitePlayerName.textContent = state.seats.w ? state.players[state.seats.w]?.nickname : 'Empty';
    blackPlayerName.textContent = state.seats.b ? state.players[state.seats.b]?.nickname : 'Empty';

    // Determine current player's role
    if (myConnId) {
        if (state.seats.w === myConnId) playerColor = 'w';
        else if (state.seats.b === myConnId) playerColor = 'b';
        else playerColor = null;
    }

    // Flip board for black player
    if (checkWebGL()) {
        boardGroup.rotation.y = (playerColor === 'b') ? Math.PI : 0;
    }

    // Button states
    takeWhiteBtn.disabled = !!state.seats.w;
    takeBlackBtn.disabled = !!state.seats.b;
    leaveSeatBtn.style.display = playerColor ? 'block' : 'none';
    flipBoardBtn.style.display = !playerColor ? 'block' : 'none';

    const isPlayer = playerColor !== null;
    const gameOngoing = !state.result;
    resignBtn.disabled = !isPlayer || !gameOngoing;
    offerDrawBtn.disabled = !isPlayer || !gameOngoing || state.drawOffer;

    // Draw offer UI
    acceptDrawBtn.style.display = 'none';
    declineDrawBtn.style.display = 'none';
    drawOfferStatus.textContent = '';
    if (state.drawOffer) {
        const offeringPlayer = state.drawOffer === 'w' ? 'White' : 'Black';
        if (isPlayer && playerColor !== state.drawOffer) {
            acceptDrawBtn.style.display = 'inline-block';
            declineDrawBtn.style.display = 'inline-block';
            drawOfferStatus.textContent = `${offeringPlayer} offered a draw.`;
        } else {
            drawOfferStatus.textContent = `Draw offered by ${offeringPlayer}.`;
        }
    }

    // Status indicators
    turnIndicator.textContent = `Turn: ${state.turn === 'w' ? 'White' : 'Black'}`;
    turnIndicator.className = `turn-${state.turn}`;
    checkIndicator.textContent = state.inCheck ? 'Check!' : '';

    // Game result
    if (state.result) {
        let resultText = '';
        switch (state.result.status) {
            case 'checkmate': resultText = `Checkmate! ${state.result.winner === 'w' ? 'White' : 'Black'} wins.`; break;
            case 'stalemate': resultText = 'Stalemate.'; break;
            case 'draw': resultText = `Draw by ${state.result.reason}.`; break;
            case 'resign': resultText = `${state.result.winner === 'w' ? 'White' : 'Black'} wins by resignation.`; break;
        }
        gameResult.textContent = resultText;
    } else {
        gameResult.textContent = '';
    }
}

// --- 3D LOGIC ---

function init3D() {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(sceneContainer.clientWidth, sceneContainer.clientHeight);
    renderer.shadowMap.enabled = true;
    sceneContainer.appendChild(renderer.domElement);

    scene.background = new THREE.Color(0xeeeeee);

    camera.position.set(0, 8, 10);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enablePan = false;
    controls.maxPolarAngle = Math.PI / 2 - 0.1;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    scene.add(boardGroup);

    createBoard();

    window.addEventListener('resize', onWindowResize, false);
    renderer.domElement.addEventListener('click', onBoardClick, false);

    animate();
}

function createBoard() {
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xf0d9b5 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0xb58863 });
    const geometry = new THREE.BoxGeometry(1, 0.2, 1);

    for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
            const material = (i + j) % 2 === 0 ? lightMat : darkMat;
            const square = new THREE.Mesh(geometry, material);
            square.position.set(i - 3.5, -0.1, j - 3.5);
            square.receiveShadow = true;
            square.userData.square = `${String.fromCharCode(97 + i)}${8 - j}`;
            boardGroup.add(square);
        }
    }
}

function fenToBoard(fen) {
    clearBoard();
    const [placement] = fen.split(' ');
    const rows = placement.split('/');
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        let col = 0;
        for (const char of row) {
            if (isNaN(char)) {
                const square = `${String.fromCharCode(97 + col)}${8 - i}`;
                createPiece(char, square);
                col++;
            } else {
                col += parseInt(char, 10);
            }
        }
    }
}

function updateBoard(oldFen, newFen) {
    if (!oldFen) {
        fenToBoard(newFen);
        return;
    }
    // A simple update for now - full redraw
    // TODO: Animate move based on diffing FENs or lastMove from server
    fenToBoard(newFen);
}

function clearBoard() {
    for (const square in pieceMeshes) {
        boardGroup.remove(pieceMeshes[square]);
        delete pieceMeshes[square];
    }
}

function createPiece(type, square) {
    const color = (type === type.toUpperCase()) ? 0xe0e0e0 : 0x303030;
    const material = new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.6 });

    const pieceGroup = new THREE.Group();
    const pieceType = type.toLowerCase();

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.15, 32), material);
    base.position.y = 0.075;
    pieceGroup.add(base);

    switch (pieceType) {
        case 'p': { // Pawn
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 32, 16), material);
            head.position.y = 0.3;
            pieceGroup.add(head);
            break;
        }
        case 'r': { // Rook
            const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.5, 32), material);
            body.position.y = 0.15 + 0.25;
            pieceGroup.add(body);
            const top = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.2, 32), material);
            top.position.y = 0.15 + 0.5 + 0.1;
            pieceGroup.add(top);
            // Crenellations
            for (let i = 0; i < 4; i++) {
                const c = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.1), material);
                const angle = i * Math.PI / 2;
                c.position.set(Math.cos(angle) * 0.3, top.position.y + 0.1, Math.sin(angle) * 0.3);
                pieceGroup.add(c);
            }
            break;
        }
        case 'n': { // Knight
            // A more complex shape for the knight
            const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 0.4, 32), material);
            body.position.y = 0.15 + 0.2;
            pieceGroup.add(body);
            const neck = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.2), material);
            neck.position.y = body.position.y + 0.3;
            neck.rotation.z = -Math.PI / 8;
            pieceGroup.add(neck);
            const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.2), material);
            head.position.y = neck.position.y + 0.1;
            head.position.x = -0.1;
            pieceGroup.add(head);
            break;
        }
        case 'b': { // Bishop
            const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.2, 0.6, 32), material);
            body.position.y = 0.15 + 0.3;
            pieceGroup.add(body);
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 16), material);
            head.position.y = body.position.y + 0.3;
            pieceGroup.add(head);
            const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 16), material);
            tip.position.y = head.position.y + 0.2;
            pieceGroup.add(tip);
            break;
        }
        case 'q': { // Queen
            const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.25, 0.7, 32), material);
            body.position.y = 0.15 + 0.35;
            pieceGroup.add(body);
            const head = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.15, 32), material);
            head.position.y = body.position.y + 0.4;
            pieceGroup.add(head);
            // Spikes
            for (let i = 0; i < 8; i++) {
                const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 16), material);
                const angle = i * Math.PI / 4;
                spike.position.set(Math.cos(angle) * 0.3, head.position.y + 0.1, Math.sin(angle) * 0.3);
                spike.rotation.z = Math.PI;
                pieceGroup.add(spike);
            }
            break;
        }
        case 'k': { // King
            const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.3, 0.8, 32), material);
            body.position.y = 0.15 + 0.4;
            pieceGroup.add(body);
            const top = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.15, 32), material);
            top.position.y = body.position.y + 0.45;
            pieceGroup.add(top);
            // Cross
            const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), material);
            crossV.position.y = top.position.y + 0.15;
            pieceGroup.add(crossV);
            const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.08), material);
            crossH.position.y = top.position.y + 0.2;
            pieceGroup.add(crossH);
            break;
        }
    }

    pieceGroup.traverse(node => {
        if (node.isMesh) {
            node.castShadow = true;
            node.userData.square = square; // Propagate square data to all meshes for raycasting
        }
    });

    const pos = squareToPosition(square);
    pieceGroup.position.set(pos.x, 0, pos.z);
    pieceGroup.userData.piece = type;
    pieceGroup.userData.square = square;

    pieceMeshes[square] = pieceGroup;
    boardGroup.add(pieceGroup);
}

function squareToPosition(square) {
    const col = square.charCodeAt(0) - 97;
    const row = parseInt(square[1], 10) - 1;
    return { x: col - 3.5, z: -(row - 3.5) };
}

function onWindowResize() {
    camera.aspect = sceneContainer.clientWidth / sceneContainer.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(sceneContainer.clientWidth, sceneContainer.clientHeight);
}

function onBoardClick(event) {
    console.log('onBoardClick triggered');
    if (!playerColor || playerColor !== state.turn || state.result || !clientChess) {
        console.log('Click blocked:', { playerColor, turn: state.turn, result: state.result });
        return;
    }

    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(boardGroup.children, true);
    console.log(`Raycaster intersected ${intersects.length} objects`);

    if (intersects.length > 0) {
        const clickedObject = intersects[0].object;
        let targetSquare = null;
        let currentObject = clickedObject;
        while(currentObject) {
            if(currentObject.userData.square) {
                targetSquare = currentObject.userData.square;
                break;
            }
            currentObject = currentObject.parent;
        }

        console.log(`Identified target square: ${targetSquare}`);
        if (!targetSquare) return;

        if (selectedPiece) {
            console.log(`Second click. From: ${selectedPiece.userData.square}, To: ${targetSquare}`);
            const from = selectedPiece.userData.square;
            const to = targetSquare;

            const move = clientChess.moves({ square: from, verbose: true }).find(m => m.to === to);
            if (move) {
                console.log('Move is legal. Sending to server.');
                handleMove(from, to);
            } else {
                console.log('Move is illegal.');
            }
            clearHighlights();
            selectedPiece = null;
        } else {
            const piece = clientChess.get(targetSquare);
            console.log(`First click. Piece on square:`, piece);
            if (piece && piece.color === playerColor) {
                console.log(`Selecting piece:`, piece);
                selectedPiece = pieceMeshes[targetSquare];
                highlightPiece(selectedPiece);
                showLegalMoves(targetSquare);
            } else {
                console.log('No piece selected or not your color.');
            }
        }
    }
}

function handleMove(from, to) {
    const piece = clientChess.get(from);
    const promotionRank = piece.color === 'w' ? '8' : '1';

    if (piece.type === 'p' && to[1] === promotionRank) {
        showPromotionDialog(from, to);
    } else {
        sendMessage({ type: 'move', roomId, from, to });
    }
}

function showPromotionDialog(from, to) {
    promotionModal.style.display = 'flex';
    promotionModal.dataset.from = from;
    promotionModal.dataset.to = to;
}

function highlightPiece(pieceMesh) {
    if (!pieceMesh) return;
    pieceMesh.material.emissive.setHex(0x555500);
}

function showLegalMoves(square) {
    const moves = clientChess.moves({ square, verbose: true });
    const markerGeo = new THREE.RingGeometry(0.3, 0.4, 32);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide });

    moves.forEach(move => {
        const pos = squareToPosition(move.to);
        const marker = new THREE.Mesh(markerGeo, markerMat);
        marker.position.set(pos.x, 0.05, pos.z);
        marker.rotation.x = -Math.PI / 2;
        boardGroup.add(marker);
        legalMoveMarkers.push(marker);
    });
}

function clearHighlights() {
    if (selectedPiece) {
        selectedPiece.material.emissive.setHex(0x000000);
    }
    legalMoveMarkers.forEach(marker => boardGroup.remove(marker));
    legalMoveMarkers.length = 0;
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

// --- Init ---
init();

// Expose for testing
if (window.location.hostname === 'localhost') {
    window.state = state;
    window.boardGroup = boardGroup;
    window.pieceMeshes = pieceMeshes;
    window.handleMove = handleMove;
    window.showLegalMoves = showLegalMoves;
    window.highlightPiece = highlightPiece;
    window.selectedPiece = selectedPiece;
    window.clientChess = clientChess;
    window.legalMoveMarkers = legalMoveMarkers;
    window.onBoardClick = onBoardClick;
}

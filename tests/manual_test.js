const { chromium } = require('playwright');

const BASE_URL = 'http://localhost:3000';

async function runTest() {
    console.log('Launching browser...');
    const browser = await chromium.launch();
    const page = await browser.newPage();

    try {
        console.log(`Navigating to ${BASE_URL}...`);
        await page.goto(BASE_URL);

        console.log('Clicking "Create New Game Room"...');
        await page.click('#create-room-btn');

        console.log('Waiting for room URL...');
        await page.waitForURL(/\/r\/.+/);
        console.log(`Room URL: ${page.url()}`);

        console.log('Clicking "Take White"...');
        await page.click('#take-white-btn');

        console.log('Waiting for seat confirmation...');
        await page.waitForFunction(() => document.getElementById('white-player-name').innerText !== 'Empty');
        console.log('White seat taken.');

        const initialFen = await page.evaluate(() => window.state.fen);
        console.log(`Initial FEN: ${initialFen}`);

        console.log('Simulating click on e2...');
        await page.evaluate(() => {
            window.selectedPiece = window.pieceMeshes['e2'];
            window.highlightPiece(window.selectedPiece);
            window.showLegalMoves('e2');
        });

        const markers = await page.evaluate(() => window.legalMoveMarkers.length);
        console.log(`Number of legal move markers: ${markers}`);
        if (markers !== 2) {
            throw new Error(`Expected 2 legal move markers, but found ${markers}`);
        }

        console.log('Simulating move e2 to e4...');
        await page.evaluate(() => {
            window.handleMove('e2', 'e4');
        });

        console.log('Waiting for FEN to change...');
        await page.waitForFunction(
            (initialFen) => window.state.fen !== initialFen,
            initialFen,
            { timeout: 5000 }
        );

        const newFen = await page.evaluate(() => window.state.fen);
        console.log(`New FEN: ${newFen}`);

        const expectedFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
        if (newFen !== expectedFen) {
            throw new Error(`FEN mismatch! Expected ${expectedFen}, got ${newFen}`);
        }

        console.log('Test PASSED!');

    } catch (error) {
        console.error('Test FAILED:', error.message);
    } finally {
        await browser.close();
    }
}

runTest();

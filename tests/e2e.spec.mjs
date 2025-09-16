import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';

// Helper function to get the FEN from the client
const getClientFen = (page) => page.evaluate(() => window.state.fen);

// Helper function to get the number of children in the boardGroup
const getBoardGroupChildCount = (page) => page.evaluate(() => {
    // Assuming 'boardGroup' is accessible globally for testing
    if (window.boardGroup) {
        return window.boardGroup.children.length;
    }
    return -1;
});

test.describe('3D Chess Gameplay', () => {
    let page;

    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
        // Expose client-side state for testing
        await page.exposeFunction('getState', () => page.evaluate(() => window.state));
        await page.exposeFunction('getBoardGroup', () => page.evaluate(() => window.boardGroup));
    });

    test.afterAll(async () => {
        await page.close();
    });

    test('should allow a player to create a room, take a seat, and move a piece', async () => {
        await page.goto(BASE_URL);

        // 1. Create a room
        await page.click('#create-room-btn');
        await page.waitForURL(/\/r\/.+/);
        const roomUrl = page.url();
        expect(roomUrl).toContain('/r/');

        // 2. Take the White seat
        await page.click('#take-white-btn');
        
        // Wait for the UI to reflect the seat being taken
        await expect(page.locator('#white-player-name')).not.toContainText('Empty');

        const initialFen = await getClientFen(page);
        expect(initialFen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

        // The board has 64 squares + 32 pieces = 96 children initially
        const initialChildCount = await getBoardGroupChildCount(page);
        expect(initialChildCount).toBe(96);

        // 3. Click the e2 pawn
        // To click a 3D object, we need to calculate its 2D screen coordinates.
        // A simpler way for testing is to trigger the logic directly or use a test hook.
        // Let's add a test hook to simulate a click on a square.
        await page.evaluate(() => {
            window.selectedPiece = window.pieceMeshes['e2'];
            window.highlightPiece(window.selectedPiece);
            window.showLegalMoves('e2');
        });

        // 4. Check if legal move markers appeared
        // e2 pawn has 2 initial moves (e3, e4). So 96 + 2 = 98 children.
        const childCountAfterClick = await getBoardGroupChildCount(page);
        expect(childCountAfterClick).toBe(98);

        // 5. Click the e4 square to move the pawn
        await page.evaluate(() => {
            window.handleMove('e2', 'e4');
        });

        // 6. Wait for the state to update and check the new FEN
        await page.waitForFunction(
            (initialFen) => window.state.fen !== initialFen,
            initialFen,
            { timeout: 5000 }
        );

        const newFen = await getClientFen(page);
        expect(newFen).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    });
});
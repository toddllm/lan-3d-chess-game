# LAN 3D Chess

A LAN-only 3D chess web app that runs locally, requires no login, and supports invite links.

## Prerequisites

- Node.js (v18+ recommended)

## Installation & Running

1.  Clone the repository.
2.  Install the dependencies:

    ```bash
    npm install
    ```

3.  Start the server:

    ```bash
    npm start
    ```

4.  After starting, the console will print the LAN URLs for the application (e.g., `http://192.168.1.23:3000`). Open one of these URLs in your browser.

## How to Play

1.  Visit the app URL and click **Create New Game Room**.
2.  You will be redirected to a new room. The UI will display two URLs:
    *   **Player URL**: Share this with your opponent.
    *   **Spectator URL**: Share this with anyone who just wants to watch.
3.  Use the **Copy** button to easily copy the links to your clipboard.
4.  The first two people to join via the Player URL can click **Take White** or **Take Black** to join the game.
5.  All other users (or those who join via the Spectator URL) will be viewers.

## Notes

*   **Firewall**: Ensure your firewall allows connections on port 3000 from other devices on your local network.
*   **Same LAN**: All players and spectators must be connected to the same local network (e.g., the same Wi-Fi).

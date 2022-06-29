
# Hellomouse Games

This is the repo for the Hellomouse games website at https://games.hellomouse.net, a collection of some multiplayer web games you can play with friends.

## Getting Started

### Prerequisites

- Node.js v16
- A modern web browser (to access the site)
- A webserver to serve static assets (You can use `python -m SimpleHTTPServer` for local testing)

### Install

```
git clone https://github.com/Bowserinator/hellomouse-games
npm install
npm run buildAll
npm run serve
```

In a separate terminal:

```
cd build/client
python -m SimpleHTTPServer
```


For more info see `INSTALL.md` in `docs/INSTALL.md`

## Adding a New Game

See `MAKE_A_GAME.md` in `docs`

## License

See `LICENSE.md` for more details

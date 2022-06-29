# Installing and Building

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

## NPM Scripts

Use the following NPM scripts for your build:

- `npm run serve` - Run the server in `build/`
- `npm run build` - Build typescript files
- `npm run copyfiles` - Copy static assets from `client` to `build/client`
- `npm run scssHot` - Hot reload SCSS changes in `scss` to `client`
- `npm run scss` - Compile SCSS in `scss` and copy to `client` and `build/client`
- `npm run minify` - Minify output JS files
- `npm run buildAll` - Same as `build scss copyfiles minify`

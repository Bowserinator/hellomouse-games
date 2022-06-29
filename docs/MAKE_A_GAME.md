
# Making a Game

## Getting Started

In `server/games`, create a new `.ts` file with the name of your game, ie `tictactoe.ts`. This will be auto-imported, and the name of the file is the name of the game (used only for requests).

Inside the file, make a default export of a class that extends `Game`, ie
```js
export default class TicTacToeGame extends Game {
	constructor() {
		super({
			maxLobbies: 10,     // Default: 100
			syncAfterMove: true // Default: true
		});
	}
}
```

The object passed to `super()` is a `GameConfig`, which configs some basic aspects about the game. The keys are:
- `maxLobbies` - Maximum number of instances of this game that can run at once. Set to a smaller number for resource intensive games.
- `syncAfterMove` - Sends the output of `globalStateSync()` (more on that later) to every client after anyone makes a `MOVE`. Useful for turn-based games, for event-loop based game you'll have to manually send whenever (recommended to disable this if  you don't use it, especially if the users send a lot of moves).

**You don't have to pass anything into `super()` if you want all defaults. You can also omit keys that you want to leave as default.**

### Properties

The `Game` class has some useful properties:

```ts
uuid: string;
	// A unique UUID for this game lobby, also used in the url
players: Array<Client | null>;
	// Array of clients, can be used to get client ids and connections
playerCount: number;
	// Number of connected players
type: string;
	// Type of the game, same as filename. DO NOT CHANGE
config: GameConfig;
	// Access to game config object
```

### Methods

The `Game` class comes with some builtin methods that are useful:

- `everyoneReady()` - Returns if all clients are ready
- `broadcast(object)` - Sends the object to all connected clients.

Note if you want to send to an individual user, use:

```js
client.connection.send(JSON.stringify(obj));
```

### Override

There are many methods you can override for your `Game` class:

```js
onRoomCreate() {
	// Must override, even if it's nothing
	// Called when a room is created for the first time
}

globalStateSync(player: Client): MessageData {
	// Must override, even if it's nothing
	// Called if this.config.syncAfterMove is enabled
	// here you can return any relevant game states to
	// all players, called after a player makes a move
}

onJoin(client: Client): boolean {
	if (!super.onJoin(client))
		return false;
	// Do whatever when a player joins
	// Return false if a player can't join
	// and true if join was successful
}

onMove(client: Client, message: object) {
	// Called when a MOVE message is passed
	// Check message.action for what action was performed
}

onMessage(client: Client, message: object) {
	// Any non-special messages (ie USERNAME, MOVE, etc...)
	// are passed to here, useful for custom messages
}

onDisconnect(client: Client) {
	super.onDisconnect(client); // Must call to update this.players
	// Do whatever when a player disconnects
}

onUsernameChange(client: Client) {
	// Called when a player sends a USERNAME message
	// At this point client.username is updated and
	// the game can do additional processing with that information
}

onReady(client: Client) {
	// Called when a player sends a READY message
	// At this point client.ready is updated and
	// the game can do additional processing with that information
}
 
onRemove() {
	// Called when the game has 0 players
	// and is removed.
	// Any memory cleanup should happen here.
}
```

## Client

In `client/` make a new folder for your game, ie `client/tictactoe`

In that folder make a file called `index.html`. Here is a general checklist of what you should include:

- Correct `<title>` for your game
- Correct metadata + social information (also change the social thumbnail!)
- CSS for your game. You can put SCSS files in `scss/nameofyourgame/css` and it will compile into `client/nameofyourgame/css`
- JS files
- Other assets such as images, sounds, etc... 


### JS: Connecting

Basic setup:

```js
// 1: Create a connection
// Note creating this and importing it twice may
// behave wonky, I'm not sure why.
const connection = createConnection();

// 2: Get the game UUID
// You can also use windowParams and more advanced methods, but
// most games just have the UUID after the =
const uuid = window.location.search.substr(1).split('=')[0];
```

How to setup connection handlers:

```js
// Helpful function to check if you are currently connected
function isConnected() {
	return connection.readyState === WebSocket.OPEN;
}

connection.onopen = () => {
	// Note: UUID is a global as defined above
	if (uuid.length === 0) // Create a new game
		connection.send(JSON.stringify({ type: 'CREATE', gameType: 'tanks' }));
	else // Join existing game
		connection.send((JSON.stringify({ type: 'JOIN', gameID: uuid })));
};

connection.onmessage = (msg: { data: string }) => {
	let message = JSON.parse(msg.data);
	
	// switch (message.type) { ...
	// Here are simple handlers for two basic server messages:
	if (message.type === 'ERROR') {
		// If game doesn't exist redirect to home game to get new url
		if (message.code === 'NO_GAME')
			window.location.href = window.location.href.split('?')[0];
		alert(message.error);
	} else if (message.type === 'UUID') {
		// Game UUID recieved
		let url = window.location.href.split('?')[0] + '?' + message.uuid;
		history.pushState({}, '', url);
		// Update your invite link too
	}
}
```




### JS: Shared Utils

Under `/shared/js` there are some JS utils. You can include them before your scripts with

```html
<script src="/shared/js/index.js" defer></script>
```

#### Functions

- `createConnection()` - Create a websocket connection, by default connects to either `wss://currenturl/ws` or `ws://localhost:8124`. Requires you to set up your server to proxy secure websockets correctly if you use `wss`.
- `beep()` - Play a quick, annoying beep
- `copyToClipboard(text: string)` - Copy text to clipboard
- `parseWindowParams(url: string)` - Decode url string parameters into a map of key: value.

#### Variables

- `windowParams` - Decoded window parameters after the ?, a map of key : value

#### Classes

- **RateLimited**: Call a function with automatic rate limiting
	- `constructor(delay: number, function: Function)` - Construct a rate limited function. `function` is called with at least a `delay` between calls
	- `call()` - Call function(). If `delay` hasn't passed since the last call, this won't call the function.
	- `f()` - Directly call the function, bypassing any delays (it won't reset the delay either)

### CSS: Shared Utils

Under `scss/shared/css/index.scss`:

`.side-by-side` - Split the screen equally into two halves. Stacks vertically when screen is small. Example:

```html
<div class="side-by-side">
	<div>Left half</div>
	<div>Right half</div>
</div>
```

---

`.js-tabs` - Add additional styles to this to style tabs, you can add on your own styles as follows:
```scss
.js-tabs {
	// Styles for the tabs at the top (parent container)
	
	& > div {
		// Styles for tabs themselves
	}
	& > div.active {
		// Styles for active tabs
	}
}

.js-tab-container {
	& > div:not(:first-child) {
		// Styles for tab content (not the tabs themselves)
	}
}
```

---

`.modal` - Easy modal placement, only requires you to style the modal:

```html
<div class="modal-darken" style="display: none">
	<div class="modal">
		<!-- Modal content -->
	</div>
</div>

```
	
To style the modal:

```scss
.modal {
	// Your custom styles here
}
```

By default the modal background is `z-index: 1000` and the modal `z-index: 1001`, you may have to change this in your custom CSS if you use higher z-indices.


**Other changes:**

- Better `hr` (for light theme only)

### HTML: Shared Utils

If you import the shares js file, then tabs are automatically created if you use the `js-tab-container` class with the right layout, ie:

```html
<div class="js-tab-container">
	<!-- Tab headers -->
	<div class="js-tabs">
		<div>Tab 1</div>
		<div>Tab 2</div>
		<div>Tab 3</div>
	</div>
	<div>Tab 1 content</div>
	<div>Tab 2 content</div>
	<div>Tab 3 content</div>
<div>
```
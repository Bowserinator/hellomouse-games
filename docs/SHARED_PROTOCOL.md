
# Shared Protocol

Some messages you can send directly to the server (not the Game, these messages are game-independent):

## Don't have to be a game:

These messages don't require you to be in a game:

### JOIN

Make the client join an existing game.

```json
{
	type: "JOIN",
	gameID: "<game UUID>"
}
```
Will fail if:

1. Client is already in a game (Error: `IN_GAME`)
2. The game ID is missing (Error: `NO_ID`)
3. The game ID doesn't exist (Error: `NO_GAME`)
4. The player is not allowed to join (Error: `NOT_ALLOWED`)

Otherwise responds with:

```json
{
	type: "UUID",
	uuid: "<game UUID here>"
}
```


### CREATE

Create a new game (and join it, no need to JOIN after)

```json
{
	type: "CREATE",
	gameType: "<game type string>"
}
```
Will fail if:

1. Client is already in a game (Error: `IN_GAME`)
2. The game type is missing (Error: `NO_TYPE`)
3. Failed to create the game (invalid type?) (Error: `FAILED_CREATE`)

Otherwise responds with:

```json
{
	type: "UUID",
	uuid: "<game UUID here>"
}
```

### PING

Check ping.

```json
{
	type: "PING",
	ping: Date.now()
}
```

Will respond with the same message, you can calculate the round-trip ping with `Date.now() - message.ping`.

## Require you to be in a game:
 
 These messages require you to be in a game. If you're not in a game it will error `NOT_IN_GAME`.

### CHAT

Send a chat message.

```json
{
	type: "CHAT",
	message: "<Message>"
}
```

Will fail if:

1. Message is missing (Error: `BAD_CHAT`)

Otherwise will strip the text message of HTML entities and truncate to 1000 chars, then broadcast to everyone including the sender:

```json
{
	type: "CHAT",
	message: "<stripped message>"
}
```

### USERNAME

Change the client's username.

```json
{
	type: "USERNAME",
	username: "<username>"
}
```

Will fail if:

1. Username is missing or invalid (non-alphanumeric + _, len of 16 or less) (Error: `BAD_USERNAME`)
2. Username is already taken by someone else (Error: `ALREADY_TAKEN_USERNAME`)

Otherwise will succeed. There is no response, but `game.onUsernameChange`  is called, so games are expected to respond themselves.

### READY

Toggles the client's ready state.

```json
{
	type: "READY"
}
```

There is no response, but `game.onReady` is called, so games are expected to respond themselves.

### MOVE

Performs a move. Other properties are game-dependent.

```json
{
	type: "MOVE",
	...
}
```

`game.onMove` is called and global state is synced (if enabled in game config), so games are expected to respond themselves (if not using global state sync).

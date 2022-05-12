// From raw socket
interface Message {
    utf8Data: string;
    type: string;
}

// Parsed from JSON
interface MessageData {
    type: string;
    gameID?: string;
    gameType?: string;
    message?: string;
    username?: string;
}

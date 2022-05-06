window.WebSocket = window.WebSocket || window.MozWebSocket;

const connection = new WebSocket('ws://127.0.0.1:1337');
const uuid = window.location.search.substr(1);

connection.onopen = () => {
    if (uuid.length === 0) // Create a new game
        connection.send(JSON.stringify({ type: 'CREATE', gameType: 'connect6' }));
    else // Join existing game
        connection.send((JSON.stringify({ type: 'JOIN', gameID: uuid })));
};

connection.onerror = error => console.error(error);

connection.onmessage = message => {
    message = JSON.parse(message.data);
    console.log(message);

    if (message.type === 'ERROR')
        alert(message.error);
    else if (message.type === 'UUID')
        console.log(window.location.href + '?' + message.uuid);
};

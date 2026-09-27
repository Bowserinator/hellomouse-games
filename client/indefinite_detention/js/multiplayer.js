"use strict"

const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 8000

var connection = createConnection()
const uuid = window.location.search.substr(1).split('=')[0]

var is_host = false
var username = ""
var game_started = false
var pending_join = false
var game_uuid = uuid
var joined_game = false
var is_reconnect_attempt = false
var reconnect_attempts = 0
var reconnect_timer = null

function isConnected(){
    return connection && connection.readyState === WebSocket.OPEN
}

function showDisconnectBanner(text){
    let banner = document.getElementById("disconnect_banner")
    if(!banner) return
    banner.innerHTML = text
    banner.style.top = "0px"
}

function hideDisconnectBanner(){
    let banner = document.getElementById("disconnect_banner")
    if(!banner) return
    banner.style.top = "-100px"
}

function sendGameMessage(data){
    if(data.command === "update_score")
        connection.send(JSON.stringify({
            type: "MOVE",
            action: "SCORE",
            score: data.score,
            alive: data.is_alive
        }))
}

var host_connection = { send: sendGameMessage }

function sendToAll(data){
    sendGameMessage(data)
}

function addNewUser(name){
    document.getElementById("users_joined").innerHTML +=
        (name === username ? "<li style='color: yellow'>" : "<li>")
        + "<b>[SUBJECT]</b> "
        + name.toUpperCase() + "</li>"
}

function joinOrCreate(){
    if(game_uuid.length === 0)
        connection.send(JSON.stringify({ type: "CREATE", gameType: "indefinite_detention" }))
    else
        connection.send(JSON.stringify({ type: "JOIN", gameID: game_uuid }))
    connection.send(JSON.stringify({ type: "MOVE", action: "NAME", name: username }))
    joined_game = true
}

function rejoinGame(){
    if(game_uuid.length === 0) return
    is_reconnect_attempt = true
    connection.send(JSON.stringify({ type: "JOIN", gameID: game_uuid }))
    connection.send(JSON.stringify({ type: "MOVE", action: "NAME", name: username }))
    if(game.current_turn > 0)
        sendToAll({ command: "update_score", name: username, score: game.current_turn - 1, is_alive: !game.game_is_over })
}

function setupUsername(){
    let name = document.getElementById("username").value
    if(name.trim().length === 0)
        return

    username = name.replace(/ /g, "-")
    username += "-" + Math.round(Math.random() * 900 + 100)

    document.getElementById("subject_name").innerHTML = username.toUpperCase()
    document.getElementById("users_joined").innerHTML = ""
    document.getElementById("url").innerHTML = game_uuid.length === 0
        ? "Generating a game url..."
        : "Please wait for the interrogation to start.<br>(The host will start the game)"

    promptScreen('multiplayer_setup_screen_2')

    if(isConnected())
        joinOrCreate()
    else
        pending_join = true
}

function startGame(){
    if(!isConnected()) return
    connection.send(JSON.stringify({ type: "MOVE", action: "START" }))
}

function playAgain(){
    if(isConnected())
        connection.send(JSON.stringify({ type: "MOVE", action: "REPLAY" }))
    promptScreen('multiplayer_setup_screen_2')
    game.resetGame()
}

function othersStillDetained(){
    for(let key of Object.keys(game.player_scores)){
        let p = game.player_scores[key]
        if(p.name !== username && p.is_alive) return true
    }
    return false
}

function updatePlayAgainButton(){
    let btn = document.getElementById("play_again_btn")
    if(!btn) return
    let waiting = othersStillDetained()
    btn.disabled = waiting
    btn.innerHTML = waiting ? "Awaiting Other Subjects..." : "Play Again"
}

function beginCountdown(){
    promptScreen("countdown_screen")
    document.getElementById("counter").innerHTML = 3
    setTimeout(function(){ document.getElementById("counter").innerHTML = 2 }, 1000)
    setTimeout(function(){ document.getElementById("counter").innerHTML = 1 }, 2000)
    setTimeout(function(){ game.startGame(true) }, 3000)
}

function handleMessage(message){
    message = JSON.parse(message.data)

    if(message.type === "ERROR"){
        if(message.code === "NO_GAME"){
            if(is_reconnect_attempt){
                is_reconnect_attempt = false
                showDisconnectBanner("Could not reconnect: the interrogation session no longer exists.")
                return
            }
            window.location.href = window.location.href.split("?")[0]
        }
        alert(message.error)
    } else if(message.type === "UUID"){
        game_uuid = message.uuid
        let url = window.location.href.split("?")[0] + "?" + message.uuid
        history.pushState({}, "", url)
    } else if(message.type === "SYNC"){
        is_reconnect_attempt = false
        is_host = !!message.isHost

        document.getElementById('start_interrogate').style.display =
            (is_host && message.state === "LOBBY") ? "inline" : "none"

        if(is_host)
            document.getElementById("url").innerHTML =
                "<span style='color: white'>Share this link with your accomplices</span><br>"
                + "<small>(Click to copy)</small><br>"
                + window.location.href.split("?")[0] + window.location.search

        document.getElementById("users_joined").innerHTML = ""
        for(let name of message.players)
            addNewUser(name)

        if(message.scores)
            for(let s of message.scores){
                if(is_host && s.name === username) continue
                game.updatePlayerScores({ name: s.name, score: s.score, is_alive: s.alive })
            }

        if(message.state === "LOBBY")
            game_started = false

        if(message.state === "GAME" && !game_started){
            game_started = true
            beginCountdown()
        }

        if(game.game_is_over){
            game.drawPlayerScores()
            updatePlayAgainButton()
        }
    }
}

function scheduleReconnect(){
    if(reconnect_timer) return
    let delay = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnect_attempts), RECONNECT_MAX_DELAY_MS)
    reconnect_timer = setTimeout(function(){
        reconnect_timer = null
        reconnect_attempts++
        connection = createConnection()
        setupConnection()
    }, delay)
}

function setupConnection(){
    connection.onopen = () => {
        reconnect_attempts = 0
        hideDisconnectBanner()
        if(pending_join){
            pending_join = false
            joinOrCreate()
        } else if(joined_game){
            rejoinGame()
        }
    }

    connection.onerror = error => console.error(error)
    connection.onmessage = handleMessage

    connection.onclose = () => {
        showDisconnectBanner("Connection to the facility was lost. Reconnecting...")
        scheduleReconnect()
    }
}

setupConnection()

function copyGameLink(){
    if(!is_host) return
    let link = document.getElementById("url")
    link.classList.add('flash')
    setTimeout(() => link.classList.remove('flash'), 500)
    copyToClipboard(window.location.href.split("?")[0] + window.location.search)
}

function attemptToJoinGame(){
    if(uuid.length > 0){
        document.getElementById('start_interrogate').style.display = "none"
        promptScreen("multiplayer_setup_screen")
    }
}

window.onload = attemptToJoinGame

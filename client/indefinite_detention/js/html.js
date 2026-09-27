"use strict"

function getHighScoreCookie(){
    let match = document.cookie.match(/(?:^|;\s*)high_score=(\d+)/)
    return match ? +match[1] : 0
}

/**
 * hideAllMenus - Hide all current game menus, setting
 * display property to none */
function hideAllMenus(){
    let menus = ["title_screen", "game_question", "game_over_screen", "help_screen", "credits_screen", "multiplayer_setup_screen",
        "multiplayer_setup_screen_2", "countdown_screen", "game_score_screen"]
    for(let menu of menus)
        document.getElementById(menu).style.display = "none"
}

/**
 * animateText - Given some text, animates it to
 * create a typing effect
 *
 * @param  {String} id              Id of div to change text for
 * @param  {String} text_to_display Text to type
 * @param  {String} delay=40        Delay between letters (ms)
 * @return {Array}                  Array of set timeout objects
 */
function animateText(id, text_to_display, delay=40){
    text_to_display = text_to_display.replace(/<br>/g, "<")

    let ele = document.getElementById(id)
    ele.innerHTML = ""
    let returned = []

    for(let i=0;i<text_to_display.length;i++){
        returned.push(
        setTimeout(function(){
            let text_to_add = text_to_display.substring(0, i + 1).replace(/</g, "<br>")
            ele.innerHTML = text_to_add
            ele.scrollTop = ele.scrollHeight
        }, i * delay))
        i++
    }
    return returned
}

/**
 * setProgressBar - Set the value of the game
 * progress_bar (timer)
 *
 * @param  {String} id      Id of the progress bar
 * @param  {Number} percent Percent completed, as a number between 0 to 1
 */
function setProgressBar(id, percent){
    percent *= 100
    document.getElementById(id).style.width = percent + "%"
}

/**
 * fadeOutButtons - Fades out all buttons from
 * id + (number from 1 to 4), excluding id equal
 * to ignore_id
 *
 * @param  {String} id                Id without the prefix number
 * @param  {Number} ignore_answer=""  Button with this text will be ignored
 */
function fadeOutButtons(id, ignore_answer=""){
    for(let i=1;i<=4;i++){
        let btn = document.getElementById("game_btn_" + i)
        if(btn.innerHTML != ignore_answer){
            btn.style.opacity = "0"
        }
        btn.setAttribute( "onClick", "" )
    }
}

function unFadeOutButtons(){
    for(let i=1;i<=4;i++){
        let btn = document.getElementById("game_btn_" + i)
        btn.style.opacity = "1"
    }
}

/**
 * flashBackground - Flashes the screen with color
 * @param  {String} color="white" Color to flash screen
 * @param  {Number} fade=1000     Time in ms, for fade effect
 */
function flashBackground(color="#ddd", fade=400){
    document.body.style.backgroundColor = color
    setTimeout(function(){
        document.body.style.transition = fade + "ms"
        document.body.style.backgroundColor = "#111"
    }, 100)
    setTimeout(function(){
        document.body.style.transition = "0s"
    }, fade)
}

/**
 * promptGameOverScreen - Prompts the game over
 * screen to display
 */
function promptGameOverScreen(){
    promptScreen("game_over_screen")
}

/* promptScreen - Makes the screen with id visible */
function promptScreen(id){
    hideAllMenus()
    document.getElementById(id).style.display = "inline"
}

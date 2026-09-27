"use strict"

const DUPLICATE_QUESTIONS_AFTER_THIS_TURN = 4
const ODDS_OF_DUPLICATING_QUESTION = 0.4

const DELAY_PER_CHARACTER_MS = 35

class Game{
    constructor(){
        /* Data about our subject */
        this.character_age = -1
        this.character_name = ""
        this.character_job = ""
        this.character_born_country = ""
        this.character_in_country = ""
        this.character_religion = ""
        this.character_activity = ""
        this.character_closest = ""
        this.character_people_killed = 0
        this.character_family_members_lost = 0
        this.character_seemed_strange = ""
        this.character_no_memory = ""

        this.sister_age = 0
        this.sister_job = ""
        this.sister_country = ""
        this.sister_sig_other = ""
        this.sister_run_away = ""
        this.sister_reason_convert = ""
        this.sister_last_phoned = ""

        this.previous_questions = []

        this.current_turn = 0          // Note: 1st question is turn 1, not 0
        this.current_question = null   // Current question object
        this.question_list_index = 0   // Keeps track of position in list, not counting duplicates
        this.current_timer = null      // Current timer object
        this.is_multiplayer = false    // Is the game multiplayer?
        this.report_animation = []
        this.player_scores = {}        // Scores for every player
        this.game_is_over = false
    }

    /* Update the player scores */
    updatePlayerScores(data){
        this.player_scores[data.name] = data
    }

    drawPlayerScores(){
        let table = document.getElementById("team_score")
        table.innerHTML = "<tr><th><b>Player</b></th><th><b>Score</b></th></tr>"

        /* Format the data into an array */
        let data = []
        for(let key of Object.keys(this.player_scores))
            data.push(this.player_scores[key])
        if(is_host) data.push({ name: username, score: this.current_turn - 1 })

        /* Sort the data by score, highest to lowest */
        data.sort((a,b) => b.score - a.score)

        /* Add the data to the table */
        for(let player of data)
            table.innerHTML += (player.name === username ? "<tr style='color: yellow'>" : "<tr>")
                + "<th>" + player.name + "</th><th>" + player.score + "</th></tr>"
    }

    animateMultiplayerGameOverText(){
        animateText("multiplayer_game_story", `
        ACCESS AUTHORIZED<br><br>
        Several suspects have been detained for possible involvement in The Incident. The
        interrogations have revealed little; however our subjects all cooperated fully, even
        in the absence of actual information. For example, all subjects that were prompted
        agreed that they had a sister named Clara, who had some involvement ḯ̷͈̂n̶̰̆ ̶̧͉̿̑T̶̢̩͝h̶̹̼̏̂e̸͈͝ ̵̨̝̃͋İ̵̠̒n̶̩͍̈́̈c̶̖͙͛̕i̸̪̤͠d̵̨̼̈e̸̲͖͠n̴̢̓̓ẗ̷̟̗́̽,̸̧̱̀ ̴͍͑
̸̲̆͜ ̵͕̆̅ ̷̭͔͌͗\ <br><br>
        ERROR CONNECTION TERMINATED BY REMOTE HOST
        `)
    }

    /**
     * resetGame - Resets all instance variables back
     * to the default state */
    resetGame(){
        /* Data about our subject */
        this.character_age = -1
        this.character_name = ""
        this.character_job = ""
        this.character_born_country = ""
        this.character_in_country = ""
        this.character_religion = ""
        this.character_activity = ""
        this.character_closest = ""
        this.character_people_killed = 0
        this.character_family_members_lost = 0
        this.character_seemed_strange = ""
        this.character_no_memory = ""

        this.sister_age = 0
        this.sister_job = ""
        this.sister_country = ""
        this.sister_sig_other = ""
        this.sister_run_away = ""
        this.sister_reason_convert = ""
        this.sister_last_phoned = ""

        /* Other variables */
        this.previous_questions = []
        this.player_scores = {}

        this.current_turn = 0
        this.current_question = null

        this.question_list_index = 0
        this.current_timer = null
        this.game_is_over = false

        for(let report of this.report_animation)
            clearTimeout(report)
        this.report_animation = []

        unFadeOutButtons()
        document.getElementById("progress_bar_wrapper").style.opacity = "1"
        document.getElementById("game_over_story").innerHTML = ""
        document.getElementById("multiplayer_game_story").innerHTML = ""
        document.getElementById("score").innerHTML = 0
    }

    /**
     * startGame - Does the setup for the HTML to start
     * the game */
    startGame(is_multiplayer=false){
        this.is_multiplayer = is_multiplayer

        /* Hide other menus */
        hideAllMenus()
        /* Display game menu */
        document.getElementById("game_question").style.display = "inline"
        /* Start the turns! */
        this.advanceTurn()
    }

    /**
     * doGameOver - Disables buttons, fades out
     * buttons and timers, etc... */
    doGameOver(correct_answer=""){
        /* Multiplayer mode: On game over
         * a) If you're the host, relay your loss to everyone
         * b) Otherwise relay loss to host */
        if(this.is_multiplayer){
            let data_to_send = {
                command: "update_score",
                name: username,
                score: this.current_turn - 1,
                is_alive: false
            }
            if(is_host) sendToAll(data_to_send)
            else host_connection.send(data_to_send)
        }

        /* Save the high score */
        let current_high_score = getHighScoreCookie()
        let new_high_score = Math.max(current_high_score, this.current_turn - 1)
        if(new_high_score > current_high_score)
            document.cookie = "high_score=" + new_high_score + "; expires=Fri, 31 Dec 9999 23:59:59 GMT"
        this.game_is_over = true

        /* Animations and stuff */
        fadeOutButtons("game_btn_", correct_answer)
        document.getElementById("progress_bar_wrapper").style.opacity = "0"
        flashBackground()

        document.getElementById("score").innerHTML = this.current_turn - 1
        document.getElementById("best_score").innerHTML = new_high_score

        setTimeout(function(){
            promptGameOverScreen()
            if(game.is_multiplayer){
                document.getElementById("game_over_view_score").style.display = "inline"
                document.getElementById("game_over_main_menu").style.display = "none"
            } else{
                document.getElementById("game_over_view_score").style.display = "none"
                document.getElementById("game_over_main_menu").style.display = "inline"
            }

            game.report_animation = animateText("game_over_story", new Report(game).report, 25)
        }, 3000)
    }

    /**
     * outOfTime - User ran out of time, prompt out
     * of time game over screen */
    outOfTime(){
        animateText("question",
            randChoice([
                "Can't answer faster than that?<br>This proves you're guilty.",
                "You didn't answer in time.<br>We're ending this now.",
                "This proves you're guilty.<br>Innocents wouldn't need so long."
            ]), DELAY_PER_CHARACTER_MS)

        this.doGameOver()
        return false
    }

    /** advanceTurn - Advances one turn of the game
     * @param answered_correctly Was the previous question answered correctly? */
    advanceTurn(answered_correctly=true){
        let c_question = this.getPreviousQuestions()[this.getPreviousQuestions().length - 1]
        if(!answered_correctly){
            animateText("question",
                randChoice([
                    "Liar! You contradicted yourself!",
                    "You slipped up!",
                    "You didn't say that earlier.",
                    "Your answers don't match."
                ]) + "<br>You told me THIS was the answer:", DELAY_PER_CHARACTER_MS)

            this.doGameOver(c_question.choice)
            return false
        }

        /* If current question contains data, add it */
        if(c_question && c_question.data){
            this[c_question.data] = c_question.choice
        }

        /* Create the new question */
        let question = this.getQuestion()
        document.getElementById("question_num").innerHTML = this.current_turn
        document.getElementById("question").innerHTML = question.question

        /* Set the timer for the new question, based on question length
         *
         * We're going to change the question time slightly based on question
         * length, aka 50ms per word added
         *
         * Based on the online flash version of Indefinite Interrogation,
         * the high score is around 300 - assuming they tapped wildly for the
         * last 20 questions, with a speed of 0.5 s per question, the reduction
         * per turn comes out to be around 0.035  seconds per turn
         *
         * Finally, we'll give the user at least 1000ms to react */
        let subtract = (this.current_turn - 1) * 0.035 * 1000
        let base_time = 50 * question.question.split(" ").length
        let bonus = 4700
        this.current_timer = new Timer(Math.max(bonus + base_time - subtract, 1000), this)

        /* Create the choice buttons */
        for(let i=1;i<=4;i++){
            let btn = document.getElementById("game_btn_" + i)
            btn.innerHTML = question.answers[i - 1]
            btn.setAttribute( "onClick", "game.advanceTurn(game.answerQuestion('"
                + question.answers[i - 1].replace("'", '&#39;').replace('"', "&#34;")
                + "'))" )
        }
    }

    /**
     * getQuestion - Prompt the user with
     * the next question. Adds to previous question list
     * if not already prompted.
     *
     * @return {Object}  Question class object */
    getQuestion(){
        this.current_turn++

        random_question: if((this.current_turn > DUPLICATE_QUESTIONS_AFTER_THIS_TURN &&
                Math.random() < ODDS_OF_DUPLICATING_QUESTION) ||
                this.question_list_index >= QUESTIONS.length) {
            /* Select a previous question, exluding the most recent choice */
            let possible = this.previous_questions.slice(0, -2)
                .filter(x => (x.prompt_once ?  // Prompt only once
                    !this.isPreviousQuestion(x) : true) &&
                    this.current_question.id != x.id
                )
            if(possible.length === 0) break random_question

            let s = randChoice(possible)
            s.regenerateChoices()

            this.current_question = s
            return s
        } else {
            /* Select the next question in the list */
            let returned = new Question(QUESTIONS[this.question_list_index])
            this.previous_questions.push(returned)
            this.current_question = returned
            this.question_list_index++
            return returned
        }
    }

    /**
     * answerQuestion - Answer a question, returns
     * true or false if it has been solved. Modifies the
     * choice property of the previous question.
     *
     * The question answered is the current_question
     *
     * @param  {String} choice   Choice as a string
     * @return {Boolean}         Is the answer acceptable?
     */
    answerQuestion(choice){
        /* Multiplayer mode:
         * a) if host send new score data to everyone
         * b) otherwise send to host */
        if(this.is_multiplayer){
            let data_to_send = {
                command: "update_score",
                name: username,
                score: this.current_turn - 1,
                is_alive: true
            }
            if(is_host) sendToAll(data_to_send)
            else host_connection.send(data_to_send)
        }

        let prev_question = this.getPreviousQuestions()
        this.current_timer.stop()

        // Unanswered question - all answers are correct
        if(prev_question.length === 0){
            this.current_question.choice = choice
            return true
        }
        // Previously answered question
        return prev_question[prev_question.length - 1].choice == choice // == so numbers and strings can be equal
    }

    /**
     * isPreviousQuestion - Check if a question is
     * in the previous_questions array
     *
     * @param  {Object} question  Question to check
     * @return {Boolean}          Has the question been asked previously?
     */
    isPreviousQuestion(question){
        return this.previous_questions.map(y => y.id).includes(question.id)
    }

    /**
     * getPreviousQuestion - Get the previous question
     * object that matches the question id
     *
     * @param  {Object} question  Question to check
     * @return {Object}           Previous question object
     */
    getPreviousQuestions(question){
        return this.previous_questions.filter(x => x.id === this.current_question.id && x.choice)
    }
}

let game = new Game()

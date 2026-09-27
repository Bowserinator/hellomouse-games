"use strict"

const UPDATE_EVERY_N_MS = 50

class Timer{
    /**
     * constructor - Create a new time object.
     *
     * @param  {Number} total_time Time in ms for the timer
     * @param  {Object} game       Game object
     */
    constructor(total_time, game){
        this.total_time = total_time
        this.time = this.total_time

        this.timer = setTimeout(function(){
            game.outOfTime()
        }, this.total_time + 100)

        this.effect_timers = []
        for(let i=0; i<=this.total_time;i+=UPDATE_EVERY_N_MS)
            this.effect_timers.push(setTimeout(function(){ setProgressBar("progress_bar", 1 - i / total_time ) }, i))
    }

    stop(){
        clearTimeout(this.timer)
        for(let timer of this.effect_timers)
            clearTimeout(timer)
    }
}

"use strict"

function randInt(a, b){
    return Math.round(Math.random() * b) + a
}

function randStr(length){
    return Math.random().toString(36).replace(/[^a-z]+/g, "").substr(0, length)
}

function randChoice(arr){
    return arr[randInt(0, arr.length - 1)]
}

function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1))
        let temp = a[i]
        a[i] = a[j]
        a[j] = temp
    }
    return a
}

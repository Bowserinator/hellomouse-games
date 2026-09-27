"use strict"

/* A database of questions, along with the answer types
 * question:
 *      A string representing the question, ie "what is your name"
 *
 * answers:
 *      An array of Strings representing possible answers. Answers have
 *      the following special strings:
 *
 *          {range:a|b}: A random integer between a and b, inclusive
 *          {random_text}: Some random text, ie "qik 24easd"
 *          {random_time}: Random time, ie "5:40 PM"
 *
 *      Furthermore, several variables already contain a list of possible answers:
 *          NAMES: A random list of names for your character
 *          COUNTRIES: A list of common countries, ie "Canada"
 *          PEOPLE: List of family members, ie "Mother", "Father", etc...
 *          JOBS: A list of jobs, ie "teacher"
 *          FUTURE_TIMES: A list of future times, ie "next week"
 *          HIDING_PLACES: A list of places to hide things, ie "A safe"
 *
 *      If the array is less than length 4, a random element will be selected.
 *      If the array is greater than length 4, a random subset of 4 elements will be selected
 *
 * id:
 *      A unique string identifying the question
 *
 * required_answer: (Optional) (Not implemented)
 *      Array of answers that must be displayed
 *
 * conflict: (Optional) (Not implemented)
 *      Question answers that might conflict with this question.
 *
 * prompt_once: (Optional)
 *      Prompt the question only once
 *
 * data: (Optional)
 *      Sets game.[data] to answer choice
 *
 * The id of a question is equal to its index in the array. */
const QUESTIONS = [
    {
        id: "name",
        question: "What is your full name?",
        answers: NAMES,
        data: "character_name"
    },
    {
        id: "age",
        question: "How old are you?",
        answers: ["{range:16|60}"],
        data: "character_age"
    },
    {
        id: "country-born",
        question: "What country were you born?",
        answers: COUNTRIES,
        data: "character_born_country"
    },
    {
        id: "location-during-incident",
        question: "Where were you during The Incident?",
        answers: COUNTRIES,
        data: "character_in_country"
    },
    {
        id: "activity-during-incident",
        question: "What were you doing the day of the incident?",
        answers: [
            "Enjoying nature",
            "Visiting a friend",
            "Working",
            "Attending a funeral",
            "Throwing a party",
            "Watching television",
            "Ice skating",
            "Using the bathroom",
            "Sleeping in",
            "Hiking",
            "Reading a book",
            "Taking a vacation"
        ],
        data: "character_activity"
    },
    {
        id: "job",
        question: "What is your occupation?",
        answers: JOBS,
        data: "character_job"
    },
    {
        id: "closest-to",
        question: "Who are you closest to?",
        data: "character_closest",
        answers: PEOPLE
    },
    {
        id: "phoning",
        question: "Who were you phoning last night?",
        answers: PEOPLE,
    },
    {
        id: "religion",
        question: "Which religion do you identify with?",
        answers: [
            "Islam",
            "Christianity",
            "Buddhism",
            "Hinduism",
            "Judaism",
            "Confucianism",
            "Syntheism",
            "None"
        ],
        data: "character_religion"
    },
    {
        id: "stick-with-religion",
        question: "Why do you stick with your religion anyways?",
        answers: [
            "My family does",
            "For the children",
            "For a friend",
            "For protection",
            "For political reasons",
            "For religious reasons",
            "Just for fun"
        ]
    },
    {
        id: "valuables",
        question: "Where do you hide your valuables?",
        answers: HIDING_PLACES
    },
    {
        id: "hide-journal",
        question: "Where does your sister keep her private journal?",
        answers: HIDING_PLACES
    },
    {
        id: "how-many-killed",
        question: "How many people did you kill in The Incident?",
        answers: ["0", "1", "2", "5-10", "11+", "I don't remember"],
        data: "character_people_killed"
    },
    {
        id: "family-members-lost",
        question: "How many family members did you lose in The Incident?",
        answers:  ["0", "1", "2", "3", "4", "5-10", "11+"],
        data: "character_family_members_lost"
    },
    {
        id: "last-contact-sister",
        question: "When was the last time you made contact your sister?",
        answers: [
            "Yesterday",
            "A few days ago",
            "A month ago",
            "Last year",
            "4 years ago",
            "8 years ago",
            "I don't remember"
        ],
        data: "sister_last_phoned"
    },
    {
        id: "sister-age",
        question: "How old is your sister?",
        answers: ["{range:20|60}"],
        data: "sister_age"
    },
    {
        id: "see-sister-in-person",
        question: "When did you last see your sister in person?",
        answers: [
            "2 days ago",
            "A week ago",
            "Last month",
            "2 years ago",
            "5 years ago",
            "7 years ago",
            "8 years ago"
        ],
    },
    {
        id: "criticize-gov",
        question: "Years ago, your sister criticized the government. Why?",
        answers: [
            "She was angry",
            "For school",
            "That question is unfair",
            "I don't remember",
            "For political reasons",
            "She felt it was important"
        ],
        prompt_once: true,
    },
    {
        id: "significant-other",
        question: "Who is your sister's significant other?",
        answers: NAMES.concat(["She has none"]),
        data: "sister_sig_other"
    },
    {
        id: "why-buy-illegal-drugs",
        question: "Why have you been buying illegal drugs like SpyteFire?",
        answers: [
            "Out of necessity",
            "My sister told me to",
            "For political reasons",
            "It clears a guilty heart",
            "For the children",
            "For religious reasons",
            "Just for fun",
            "For a friend",
            "It clears the mind",
            "For protection",
            "To keep warm"
        ],
    },
    {
        id: "sister-convert-religion",
        question: "Why did your sister convert to Buddhism?",
        answers: [
            "Out of necessity",
            "For political reasons",
            "For the children",
            "Just for fun",
            "For a loved one",
            "For protection",
            "For a friend",
            "I don't know"
        ],
        data: "sister_reason_convert"
    },
    {
        id: "last-login",
        question: "When did you last login to the computer terminal?",
        answers: [
            "Noon",
            "Midnight",
            "{random_time}"
        ],
    },
    {
        id: "What seemed strange",
        question: "What seemed strange to you the day before The Incident?",
        answers: [
            "A hooded figure",
            "A glowing skyward object",
            "A white motor vehicle",
            "Nothing",
            "Computer glitches",
            "Television static",
            "A clock",
            "A one-eyed man"
        ],
        data: "character_seemed_strange"
    },
    {
        id: "talk-about-sister",
        question: "When were you planning to talk to us about your sister?",
        answers: FUTURE_TIMES,
    },
    {
        id: "sister-job",
        question: "What is your sister's occupation?",
        answers: JOBS,
        data: "sister_job"
    },
    {
        id: "where-sister",
        question: "Where are the whereabouts of your sister?",
        answers: COUNTRIES.concat(["I don't know"]),
        data: "sister_country"
    },
    {
        id: "when-sister-run-away",
        question: "When did your sister run away from home?",
        answers: [
            "A few hours ago",
            "Before The Incident",
            "Last week",
            "A few weeks ago",
            "Last month",
            "A few months ago",
            "About a year ago",
            "2 years ago",
            "5 years ago",
            "8 years ago",
            "10 years ago"
        ],
        data: "sister_run_away"
    },
    {
        id: "when-leave-earth",
        question: "When were you planning to leave earth?",
        answers: FUTURE_TIMES,
    },
    {
        id: "where-leave-earth",
        question: "Where were you planning to go once you left Earth?",
        answers:[
            "The asteroid belt",
            "The moon colony",
            "Mars",
            "Venus",
            "Jupiter"
        ],
    },
    {
        id: "coded-msg",
        question: "What coded message did you recieve during The Incident?",
        answers: ["{random_text}"],
    },
    {
        id: "reason-leave-earth",
        question: "Why were you planning to leave Earth?",
        answers: [
            "For the children",
            "For a friend",
            "For protection",
            "For political reasons",
            "For religious reasons",
            "Guilt over The Incident",
            "For a loved one",
            "Just for fun"
        ],
    },
    {
        id: "leader-terrorist-cell",
        question: "Who is the leader of your terrorist cell?",
        answers: [
            "I'm not a terrorist",
            "...What?",
            "Dr. Smith",
            "Lady Dukkha"
        ],
    },
    {
        id: "illegal-drugs",
        question: "Who sold you illegal drugs like SpyteFire?",
        answers: PEOPLE.concat(["Nobody!", "A stranger"]),
    },
    {
        id: "leave-earth-person",
        question: "Who helped arrange your departure from Earth?",
        answers: PEOPLE.concat(["Nobody!", "A stranger"]),
    },
    {
        id: "no-memory",
        question: "What period of The Incident do you have no memory of?",
        answers: [
            "8AM - 6PM",
            "6AM - 9PM",
            "7AM - 3PM",
            "I remember everything"
        ],
        data: "character_no_memory"
    },
    {
        id: "what-did-you-hear",
        question: "What did you hear, just as you lost your memory?",
        required_answer: ["I did not lose my memory"],
        answers: [
            "When did you exist?",
            "You must be removed",
            "They must be exposed",
            "What we do is out of necessity",
            "I don't remember",
            "Our governments conspire together",
            "Your government knows more than they say"
        ],
        conflict: {  // Conflict with the "I remember everything" question
            conflict_ids: ["no-memory"],
            conflict_choices: {
                "no-memory": ["I don't remember", "I remember everything"]
            },
            conflict_messages: {
                "no-memory": "You said you remembered everything during The Incident!"
            }
        },
    },
]

/**
 * selectAnswers - Given an array of answers, selects
 * 4 and returns the new Array. If there are less than 4
 * answers, randomly repeats answers, trying to avoid
 * duplciate answers.
 *
 * If there are more than 5, randomly selects a subset of 4.
 *
 * @param  {Array} answers Answer array
 * @return {Array}         New answer array
 */
function selectAnswers(answers){
    if(answers.length === 4) return answers // That was easy
    if(answers.length < 4){
        /* Try to select "randomizable" choices to duplicate
         * If none exist, duplicate any choice */
        let allowed_to_duplicate = answers.filter(x => x.startsWith("{") && x.endsWith("}"))
        allowed_to_duplicate = allowed_to_duplicate.length > 0 ? allowed_to_duplicate : answers

        for(let i=answers.length; i < 4; i++)
            answers.push(randChoice(allowed_to_duplicate))
        return answers
    }
    if(answers.length > 4){
        /* Randomly select 4 elements */
        answers = shuffle(answers)
        return answers.slice(0, 4)
    }
}

/**
 * formatAnswers - Given an array of answers, formats
 * so that wildcards are filled in
 *
 * @param answers  An array of Answers
 * @return {None}  Modifies array in place
 */
function formatAnswers(answers){
    for(let i=0;i<answers.length;i++){
        /* Random number in range, inclusive */
        if(/{range:(\d+)\|(\d+)}/g.test(answers[i])){
            answers[i] = answers[i].split(":")[1].replace("}", "").split("|")
            answers[i] = "" + randInt(+answers[i][0], +answers[i][1])
        }

        /* Random text: Create 2-3 crypto random strings of
         * lengths 2-5 and join together */
        else if(answers[i] === "{random_text}"){
            let num_words = randInt(2,3)
            let sentence = []

            for(let j=0;j<num_words;j++)
                sentence.push(randStr( randInt(2,5) ))
            answers[i] = sentence.join(" ")
        }

        /* Create a date. Hour should be 1 to 11 inclusive
         * to avoid confusion with "midnight" and "noon"
         *
         * Minute has 30% chance to be 0, otherwise random
         * number between 1 and 59 */
        else if(answers[i] === "{random_time}"){
            let hour = randInt(1, 11)
            let minute = Math.random() < 0.3 ? 0 : randInt(1, 59)
            let am_or_pm = randChoice(["AM", "PM"])

            minute = minute < 10 ? "0" + minute: minute
            answers[i] = hour + ":" + minute + " " + am_or_pm
        }
    }
}

class Question{
    /**
     * constructor - Create a randomized question
     * that the user has not previously seen
     *
     * @param question_object Question object to generate from */
    constructor(question_object){
        this.question_obj = question_object

        this.question_obj.answers = this.question_obj.answers.slice(0)  // Make an array copy

        let ans = []
        let attempts = 0
        while((new Set(ans)).size != ans.length || ans.length < 4){
            ans = selectAnswers(this.question_obj.answers)
            formatAnswers(ans)
            ans = shuffle(ans)

            if(attempts > 5) break
            attempts++
        }

        this.question = this.question_obj.question
        this.answers = ans
        this.id = this.question_obj.id
        this.prompt_after = this.question_obj.prompt_after

        this.choice = null // User selected choice
        this.data = this.question_obj.data
    }

    /**
     * regenerateChoices - Recreates the choices
     * for the question. One will be the previously selected
     * choice, the rest will be random. */
    regenerateChoices(){
        let ans = []
        let attempts = 0
        while(attempts < 5 && ans.length < 3){
            ans = selectAnswers(this.question_obj.answers)
            formatAnswers(ans)
            ans = ans.filter(x => x != this.choice)
            attempts++
        }

        ans = shuffle(ans)
        this.answers = [this.choice].concat(ans.slice(0, 3))
        this.answers = shuffle(this.answers)
    }
}

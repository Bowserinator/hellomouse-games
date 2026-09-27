"use strict"

const MALE_PRONOUNS = ["His", "He"]
const FEMALE_PRONOUNS = ["Her", "She"]

class Report{
    constructor(game){
        /* No data has been given. Give the execution
         * outcome report */
        if(!game.character_name){
            this.report = `We ended the Interrogation after 5 seconds. It is unlikely they would cooperate given more time.<br><br>
            Punishment: Execution.`
            return
        }

        /* Additional variables */
        let first_name = game.character_name.split(" ")[0]
        let last_name = game.character_name.split(" ")[1]
        let pronoun = NAME_PRONOUN_MAP[game.character_name] === "M" ?
            MALE_PRONOUNS : FEMALE_PRONOUNS

        /* First paragraph: about the subject */
        let paragraph1 = ""
        let sentence1, sentence2, sentence3, sentence4

        /* 1st sentence: some background */
        if(game.character_name && game.character_age > 0 && game.character_born_country && game.character_job){
            sentence1 = "Our subject is " + game.character_name + ", a " + game.character_age + " year old "
                + game.character_job.toLowerCase() + " born in " + game.character_born_country + "."
        } else if(game.character_name && game.character_age > 0 && game.character_born_country && !game.character_job){
            sentence1 = "Our subject is " + game.character_name + ", a " + game.character_age + " year old "
                + "born in " + game.character_born_country + "."
        } else if(game.character_name && game.character_age > 0 && !game.character_born_country && !game.character_job){
            sentence1 = "Our subject is " + game.character_name + ", a " + game.character_age + " year old."
        } else if(game.character_name && game.character_age <= 0&& !game.character_born_country && !game.character_job){
            sentence1 = "Our subject is " + game.character_name + "."
        }
        paragraph1 += sentence1 + " "

        if(game.character_job){
            if(game.character_age < 18) // Underaged for a job
                sentence1 += " " + first_name + " is extremely young for " + pronoun[0].toLowerCase() + " job; " + pronoun[1].toLowerCase() + " "
                    + "employment will be put under further investigation."
            else if(game.character_age < 26 && ADVANCED_JOBS.includes(game.character_job))
                sentence1 += " " + game.character_name + " claims to be young for their profession, which is highly suspicious."
        }

        /* 2nd sentence: Religious belief */
        sentence2 = game.character_religion ? pronoun[1] + " follows "
            + game.character_religion.replace("None", "no religion")
            + ", " + RELIGION_DESCRIPTIONS[game.character_religion] : ""
        paragraph1 += sentence2 + " "

        /* 3rd sentence what happened during the incident */
        sentence3 = game.character_in_country ?
            "During The Incident, "
                + first_name + " was in " + game.character_in_country
                + (game.character_activity ? " " + game.character_activity.toLowerCase() : "")
                + (game.character_seemed_strange ? " when " + pronoun[1].toLowerCase() + " saw " + game.character_seemed_strange.toLowerCase() : "")
                + "."
            : ""
        paragraph1 += sentence3 + " "

        /* 4th sentence: Extra family data */
        sentence4 = game.character_closest ? pronoun[1] + " is closest to " + pronoun[0].toLowerCase() + " " + game.character_closest.replace("My ", "") + "." : ""
        paragraph1 = paragraph1.trim()
        paragraph1 += " " + sentence4


        /* 2nd paragraph: About subject's sister */
        let paragraph2 = ""
        if(game.sister_age || game.sister_country || game.sister_last_phoned || game.sister_sig_other || game.sister_run_away){
            let first_name_possessive = first_name.endsWith("s") ? first_name + "'" : first_name + "'s"
            sentence1 = game.sister_run_away ?
                "We learned a lot about Clara " + last_name + ", " + first_name_possessive + " sister and member of radical Buddhist group 'Four Truths': " :
                "We learned some things about Clara " + last_name + ", " + first_name_possessive + " sister and suspected terrorist: "
            sentence1 += "she "
                + (game.sister_age ? "is " + game.sister_age + ", " : "")
                + (game.sister_job ? "is a " + game.sister_job.toLowerCase() + ", " : "")
                + (!["I don't know", ""].includes(game.sister_country) ? "is in " + game.sister_country + ", ": "")
                + (!["I don't remember", ""].includes(game.sister_last_phoned) ? "was phoned by our subject " + game.sister_last_phoned.toLowerCase() + ", " : "")
                + (game.sister_reason_convert ?
                    game.sister_reason_convert === "I don't know" ?
                        "never revealed why she converted to Buddhism, " :
                        "converted to Buddhism " + game.sister_reason_convert.toLowerCase() + ", "
                    : ""
                )
                + (game.sister_run_away ? "ran away from home " + game.sister_run_away.toLowerCase() + ", " : "")
                + (game.sister_sig_other ?
                    game.sister_sig_other === "She has none" ?
                        "is currently single" :
                        "is in a relationship with " + game.sister_sig_other
                            + " - which we can use to get to her. A team has been sent to pick "
                            + game.sister_sig_other.split(" ")[0]
                            + " up for interrogation."
                    : ""
                )
            /* Add an "and" to the last phrase */
            let last_index = sentence1.lastIndexOf(", ")
            sentence1 = sentence1.substring(0, last_index + 2) + "and " + sentence1.substr(last_index + 2)
            paragraph2 = sentence1
        }


        /* 3rd paragraph: what the subject did */
        let paragraph3 = ""
        sentence1 = ""
        if(game.character_people_killed){
            sentence1 = game.character_name + " " + (game.character_people_killed > 0 ? "admitted" : "claimed") + " "
            if(game.character_people_killed == 0)
                sentence1 += pronoun[1].toLowerCase() + " did not kill anyone"
            else if(game.character_people_killed == 1)
                sentence1 += "to killing a single person"
            else
                sentence1 += "to killing " + game.character_people_killed + " people"
        }

        sentence1 += game.character_no_memory ?
            (game.character_no_memory === "I remember everything" ?
                ", but claims " + pronoun[1].toLowerCase() + " has no memory of " + game.character_no_memory + " that day." :
                ", and claims " + pronoun[1].toLowerCase() + " remembers everything that day."
            ) : "."

        sentence1 += game.character_family_members_lost ?
            " " + first_name + " claims " + pronoun[1].toLowerCase() + " lost " + game.character_family_members_lost + " family "
                + (game.character_family_members_lost > 1 ? "members": "member")
                + " during The Incident."
            : ""
        paragraph3 = sentence1



        /* Conclusion of report */
        let last_paragraph = ""
        if(!game.sister_age){
            last_paragraph = "Based on our interrogation, we determined that " + game.character_name + " is likely" +
            " hiding something about " + pronoun[0].toLowerCase() + " involvement in The Incident."
        } else if(!game.character_no_memory){
            last_paragraph = "Based on our interrogation, we determined that " + game.character_name + " was recruited by " + pronoun[0].toLowerCase()
            + " sister Clara into Buddhist terrorist group 'Four Truths' to play an unknown role in The Incident."
        } else{
            last_paragraph = "Based on our interrogation, we determined that " + game.character_name +
            " was recruited by " + pronoun[0].toLowerCase() + " sister Clara into Buddhist terrorist group 'Four Truths' but became "
            + "possessed by telepathic aliens and had " + pronoun[0].toLowerCase() + " memory wiped before being used for more sinister purposes in The Incident."
        }

        /* Punishment */
        last_paragraph += "<br><br>Punishment: Indefinite Detention."

        /* Fix up some paragraphs */
        if(paragraph2.trim() === ".") paragraph2 = ""
        if(paragraph3.trim() === ".") paragraph3 = ""

        this.report = paragraph1
            + (paragraph2.trim() ? "<br><br>" + paragraph2 : "")
            + (paragraph3.trim() ? "<br><br>" + paragraph3 : "")
            + "<br><br>" + last_paragraph
    }
}

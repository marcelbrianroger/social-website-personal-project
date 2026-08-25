/**
 * The words for 36 Questions. Split from the rules because it is copy, not
 * logic — nothing here decides anything.
 *
 * ENGLISH, like every other player-facing string in this app. The originals
 * are Aron et al. (1997), adapted rather than quoted: the study's wording reads
 * like a form, and these have to sound like something you would actually ask
 * someone on a video call at eleven at night.
 *
 * Dare titles are set as short labels on purpose — it is what makes a dare read
 * as a card being dealt rather than an instruction being issued.
 */

/**
 * Three sets of twelve, escalating.
 *
 * The escalation is the entire mechanism of the original study — set one is
 * small talk with a pulse, set three asks you to say something you would
 * normally not. Do not reorder these to "mix it up"; the ramp is the point.
 */
export const QUESTIONS: readonly string[] = [
  // --- Set I ---------------------------------------------------------------
  'If you could have anyone in the world over for dinner, who would it be?',
  'Do you want to be famous? If so, famous for what?',
  'Do you rehearse what you are going to say before you phone someone? Why?',
  'What would a "perfect" day actually look like for you?',
  'When did you last sing to yourself? And to somebody else?',
  'If you could live to ninety, would you keep the body or the mind of a thirty-year-old for the last sixty years?',
  'Do you have a hunch about how you are going to die?',
  'Name three things you think the two of us have in common.',
  'What is the one thing in your life you are most grateful for?',
  'If you could change one thing about how you were raised, what would you change?',
  'Take four minutes and tell me your life story in as much detail as you can.',
  'If you woke up tomorrow with one new ability, what would you want it to be?',

  // --- Set II --------------------------------------------------------------
  'If a crystal ball could tell you anything about yourself, what would you ask it?',
  'Is there something you have wanted to do for ages? Why have you not done it?',
  'What is the greatest thing you have pulled off so far?',
  'What do you value most in a friendship?',
  'What is your most treasured memory?',
  'What is the memory you would least like to live through again?',
  'If you knew you would die suddenly in a year, would you change anything about how you live now?',
  'What does friendship actually mean to you?',
  'How much room do love and affection take up in your life?',
  'Take turns naming something you like about the other person, until you have five each.',
  'Would you call your family warm and close?',
  'How do you feel about your relationship with your mother?',

  // --- Set III -------------------------------------------------------------
  'Make three sentences starting with "we", and every one has to be true. For example: "We are both feeling..."',
  'Finish this sentence: "I wish I had somebody I could share..."',
  'If we were going to become close friends, what is the one thing they should know about you?',
  'Tell the other person what you like about them. Honestly — the kind of thing you would not normally say to someone new.',
  'Tell them the single most embarrassing moment of your life.',
  'When did you last cry in front of somebody else? And on your own?',
  'Name one thing about the other person you already like.',
  'What, if anything, is too serious to joke about?',
  'If you died tonight with no chance to speak to anyone, what would you most regret not having said? Why have you not said it?',
  'Your house is on fire. Everyone and every pet is safe. You have time for one more thing. What do you take? Why?',
  'Of everyone in your family, whose death would hit you hardest? Why?',
  'Describe a personal problem, then ask the other person how they would handle it. Then ask them to reflect back how they think you feel about it.',
]

/**
 * Penalty dares, drawn when someone vetoes a question.
 *
 * TWO CONSTRAINTS, both from where this is played. Everything has to work over
 * a video call with nothing but a camera and a voice — no props to fetch, no
 * second device, nothing that needs the other person in the room. And every
 * dare has to have a visible END, because the partner is the one who decides it
 * is finished; "be funnier for a while" gives them nothing to judge.
 */
export const DARES: readonly string[] = [
  'Face Challenge: grin as wide as you physically can, all teeth, and hold it until the other person says stop.',
  'Blind Recipe: explain how to cook your favourite dish in full detail, from scratch, no Googling.',
  'Room Tour: pick up your laptop or phone and show the messiest corner of your room, right now.',
  'Vocal Switch: describe your whole day in a silly accent. Any accent — just keep it up to the end.',
  'Silent Movie: act out how your morning went with no sound at all. Movement only.',
  'Fridge Reveal: open your fridge, show what is in it, and explain whatever has been sitting there longest.',
  'Object Show: grab the nearest thing to your left hand and sell it like a TV advert.',
  'Gallery Roulette: open your photos, show the oldest one that is safe for other people to see, and tell the story.',
  'Compliment Rally: give the other person five compliments back to back, never pausing more than three seconds.',
  'One Breath: summarise your favourite film from the opening to the spoiler ending, in a single breath.',
  'Reverse Talk: say three sentences, each one with its words in reverse order.',
  'Frozen Frame: hold completely still like a statue, no laughing, until the other person gives up.',
]

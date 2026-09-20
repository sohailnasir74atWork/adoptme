// =====================================================================
// blocklist.js — the single source of truth for banned chat content.
//
// Consumed by Code/Helper/ContentModeration.js, which every chat input and
// post composer already calls. Editing this file is the whole workflow: add
// or remove a line, ship a build, done.
//
// SCOPE — this is a CLIENT-SIDE filter. It stops the ordinary case, which is
// the overwhelming majority: a kid typing a word they should not. It does not
// stop someone posting straight to the API with a modified client. If that
// ever matters, the same list and the same normalisation have to be restated
// as a Postgres trigger; nothing here has to change for that to happen.
//
// ---------------------------------------------------------------------
// HOW MATCHING WORKS — read this before adding a term
// ---------------------------------------------------------------------
// Incoming text is normalised twice, and a term declares which form it wants:
//
//   mode 'word'   — matched against TOKENS. The message is lowercased, common
//                   leetspeak is undone inside words (4→a 3→e 1→i 0→o 5→s 7→t
//                   8→b @→a $→s !→i |→l), split on anything non-alphanumeric,
//                   and each token is also offered with runs of repeated
//                   letters collapsed.
//                   So 'fuck' catches: Fuck / fuck! / (fuck) / fuuuck /
//                   fuckkk / f4ck / fu(k? no.
//                   It CANNOT match inside another word, which is the point:
//                   'ass' never fires on "class", "pass" or "grass".
//                   >>> Use 'word' for single words. This is the safe default.
//
//   mode 'squash' — matched as a SUBSTRING of the message with every
//                   non-letter removed entirely.
//                   So 'sendnudes' catches: "send nudes" / "s-e-n-d n u d e s"
//                   / "send.nudes!!" and 'fuck' would also catch "f u c k".
//                   It CAN fire inside other words, so only long, unambiguous
//                   strings belong here. The classic trap is 'rapist', which
//                   would flag "the rapist" → "therapist".
//                   >>> Use 'squash' for PHRASES, and for single words long
//                   enough that a cross-word collision is implausible.
//
// A term is stored already normalised: lowercase, and for 'squash' with all
// spaces removed. The helpers below do that for you, so write terms the
// natural way ('send nudes', not 'sendnudes').
//
// KNOWN GAP, ACCEPTED: an attacker who combines BOTH evasions at once
// ("f u u u c k") defeats both paths — the token path never sees a whole word,
// and the squash path does not collapse repeats (collapsing the whole message
// would turn "Niger" into a slur hit and "bookkeeper" into gibberish). Closing
// it costs more in false positives than it buys.
//
// ---------------------------------------------------------------------
// enabled: false
// ---------------------------------------------------------------------
// Terms shipped OFF are ones where the false-positive cost is real and the
// call is yours, not mine — mild swearing, insults, and words with an innocent
// everyday meaning. They stay in the file so the decision stays visible: flip
// `enabled: false` to `true` on the group to turn a whole category on. Each
// group carries a comment saying what it would break.
//
// AUDIENCE: this app's floor is 13. The default posture is "block it", because
// a rejected message costs a retype and a missed one costs a child.
// =====================================================================

const norm = (s) => String(s).toLowerCase().trim();

/** Single words, matched as whole tokens. */
const W = (category, terms, opts = {}) =>
  terms.map((t) => ({ term: norm(t), category, mode: 'word', enabled: true, ...opts }));

/** Phrases (or long unambiguous words), matched against the de-spaced message. */
const P = (category, phrases, opts = {}) =>
  phrases.map((t) => ({
    term: norm(t).replace(/[^a-z0-9]/g, ''),
    category,
    mode: 'squash',
    enabled: true,
    ...opts,
  }));

export const BLOCKLIST = [
  // ===================================================================
  // GROOMING & CHILD SAFETY
  // The reason this file exists. Everything here is a phrase a predator
  // uses and an ordinary 13-year-old trading pets does not. Highest
  // priority: if you only ever maintain one section, maintain this one.
  // ===================================================================
  ...P('grooming', [
    // Soliciting images
    'send nudes', 'send nude', 'send noods', 'send pics', 'send pic',
    'send me pics', 'send me a pic', 'send me a photo', 'send me pictures',
    'send me your pic', 'send me your photo', 'send a pic of you',
    'show me your body', 'show me yourself', 'show me your',
    'pic of you', 'photo of you without', 'without your clothes',
    'take your clothes off', 'take off your clothes', 'get naked',
    'no clothes on', 'in your underwear', 'what are you wearing',
    // Isolation checks
    'are you alone', 'are you home alone', 'home alone', 'you alone right now',
    'is anyone watching', 'is anyone home', 'is anyone with you',
    'are your parents home', 'where are your parents', 'are your parents there',
    'when are your parents out', 'do your parents check',
    // Secrecy
    'dont tell anyone', 'do not tell anyone', 'dont tell anybody',
    'dont tell your parents', 'dont tell your mom', 'dont tell your dad',
    'keep it secret', 'keep our secret', 'our little secret', 'our secret',
    'this is our secret', 'between you and me only',
    'dont screenshot', 'no screenshots',
    // Moving the child off-platform or into the real world
    'meet up in person', 'meet me in person', 'meet in real life',
    'meet in rl', 'lets meet alone', 'come over to my house',
    'come to my house', 'come over to mine', 'ill pick you up',
    'can i pick you up', 'ill come get you', 'whats your address',
    'where do you live', 'what school do you go to', 'what is your school',
    'which school do you go to', 'send me your number',
    'whats your number', 'what is your number', 'give me your number',
    'turn on your camera', 'turn on your cam', 'turn on cam',
    'go on video', 'are you on video',
    // Flattery / age-gap normalising
    'you are so mature', 'youre so mature', 'mature for your age',
    'you look older', 'act older than', 'only for your eyes',
    'age is just a number', 'i wont tell if you wont',
    // Roblox-specific sexual-content slang
    'condo game', 'condo games', 'scented con', 'scented cons',
    'erotic roleplay', 'online dating', 'lets online date',
  ]),
  ...W('grooming', [
    // 'erp' is unambiguous inside a Roblox community: erotic role play.
    'erp', 'erping',
    // Roblox "condo" = a user-made sex game. No innocent use in a pet-trading
    // chat. Flip off if you ever get real-estate chatter, which you will not.
    'condo', 'condos',
    'sugardaddy', 'sugarbaby', 'sugarmommy', 'sugarmomma',
  ]),

  // ===================================================================
  // SEXUAL CONTENT
  // ===================================================================
  ...W('sexual', [
    // Umbrella terms
    'sex', 'sexy', 'sexual', 'sexually', 'sexting', 'sext', 'sexts', 'sexted',
    'porn', 'porno', 'pornos', 'pron', 'pornhub', 'pornography', 'pornstar',
    'xxx', 'nsfw', 'hentai', 'ecchi', 'doujin', 'doujinshi', 'rule34', 'r34',
    'erotic', 'erotica', 'smut', 'lewd', 'lewds',
    // Nudity
    'nude', 'nudes', 'nudez', 'noods', 'nudity', 'naked', 'nakey', 'topless',
    // Anatomy — chest
    'boob', 'boobs', 'boobies', 'booby', 'tit', 'tits', 'titty', 'titties',
    'tiddies', 'tiddy', 'breast', 'breasts', 'nipple', 'nipples', 'areola',
    'areolas', 'cleavage',
    // Anatomy — male
    'penis', 'penises', 'dick', 'dicks', 'dickhead', 'dickface', 'dik',
    'cock', 'cocks', 'cocksucker', 'schlong', 'wiener', 'weiner', 'pecker',
    'phallus', 'ballsack', 'testicle', 'testicles', 'scrotum',
    // Anatomy — female
    'vagina', 'vaginas', 'vag', 'vajayjay', 'pussy', 'pussies', 'clit',
    'clitoris', 'labia', 'vulva', 'coochie', 'cooch', 'minge', 'twat', 'twats',
    // Anatomy — rear
    'anus', 'anal', 'butthole', 'buttholes', 'rectum', 'asscrack',
    // Acts
    'blowjobs', 'handjobs', 'fellatio',
    'cunnilingus', 'deepthroat', 'creampie', 'gangbang', 'gangbanged',
    'threesome', 'orgy', 'orgies', 'bukkake', 'felching', 'scissoring',
    'doggystyle', 'missionary',
    // Fluids
    'cum', 'cumming', 'cumshot', 'jizz', 'jism', 'semen', 'ejaculate',
    'ejaculation', 'ejaculating', 'precum', 'squirting',
    // Masturbation
    'masturbate', 'masturbates', 'masturbating', 'masturbation',     'fap', 'fapping', 'wank', 'wanking', 'fingering',
    'fingered', 'edging',
    // Arousal
    'orgasm', 'orgasms', 'orgasmic', 'horny', 'hornyy', 'aroused',
    'erection', 'erections', 'boner', 'boners', 'hardon', 'morningwood',
    // Objects
    'condom', 'condoms', 'lube', 'viagra', 'dildo', 'dildos', 'vibrator',
    'vibrators', 'buttplug', 'buttplugs', 'fleshlight', 'onahole', 'strapon',
    'sextoy', 'sextoys',
    // Kink
    'bdsm', 'bondage', 'kink', 'kinky', 'fetish', 'fetishes', 'dominatrix',
    'sadism', 'masochism', 'cuckold', 'milf', 'dilf', 'gilf', 'ahegao',
    // Sex work
    'prostitute', 'prostitution', 'hooker', 'hookers', 'brothel', 'pimp',
    'callgirl', 'stripper', 'strippers', 'stripclub', 'striptease', 'lapdance',
    'camgirl', 'camwhore', 'onlyfans', 'chaturbate',
    // Porn sites — the whole point of naming them is stopping the handoff
    'xvideos', 'xhamster', 'redtube', 'youporn', 'brazzers', 'xnxx',
    'nhentai', 'e621', 'spankbang', 'motherless', 'efukt',
    // Illegal / extreme
    'incest', 'bestiality', 'zoophilia', 'necrophilia', 'lolicon', 'shotacon',
    'loli', 'shota', 'cp',   ]),
  ...P('sexual', [
    'blow job', 'hand job', 'rim job', 'jerk off', 'jack off', 'hard core',
    'soft core', 'adult content', 'sex tape', 'make love', 'have sex',
    'cyber sex', 'lets cyber', 'phone sex', 'sexual content',
    'child porn', 'cheese pizza',
  ]),
  ...W('sexual', [
    // Real words with an innocent sense. Off by default — each would misfire.
    'explicit',   // "explicit" appears in ordinary sentences
    'breastfeed', // health talk
    'virgin',     // "virgin" olive oil, Virgin Islands, game item names
    'thicc',      // slang, usually about a pet or a character
    'daddy',      // overwhelmingly innocent
    'snatch',     // "snatch the deal"
    'shaft',      // tool/part
    'knob',       // door
    'johnson',    // surname
    'facial',     // skincare
    'climax',     // story climax
    'submissive', // ordinary adjective
    'bj',         // someone's initials
  ], { enabled: false }),

  // ===================================================================
  // PROFANITY
  // Variants are spelled out rather than inferred: normalisation handles
  // CASE, punctuation, repeated letters and leetspeak, but not a missing
  // or swapped letter. 'fuk' has to be its own row.
  // ===================================================================
  ...W('profanity', [
    'fuck', 'fucks', 'fucked', 'fucking', 'fuckin', 'fucker', 'fuckers',
    'fuckface', 'fuckboy', 'fuckboi', 'fuckwit', 'fuckhead', 'fucktard',
    'fuk', 'fuks', 'fuking', 'fukking', 'fukk', 'fuc', 'fuq', 'fux', 'fuxk',
    'fck', 'fcking', 'fcked', 'fuckk', 'phuck', 'fvck', 'fawk', 'effing',
    'motherfucker', 'motherfuckers', 'motherfucking', 'mofo', 'clusterfuck',
    'wtf', 'stfu', 'gtfo', 'ffs', 'af',
    'shit', 'shits', 'shite', 'shitty', 'shitting', 'shithead', 'shitface',
    'shithole', 'shitshow', 'bullshit', 'dogshit', 'horseshit', 'batshit',
    'shyt', 'sht', 'shiz',
    'bitch', 'bitches', 'bitching', 'bitchy', 'biatch', 'biotch', 'bich',
    'btch',     'ass', 'asses', 'asshole', 'assholes', 'asshat', 'asswipe', 'assclown',
    'arse', 'arsehole', 'jackass', 'dumbass', 'smartass', 'asskisser',
    'bastard', 'bastards', 'cunt', 'cunts', 'kunt', 'cnut',
    'prick', 'pricks', 'wanker', 'bollocks', 'bollock', 'bugger', 'bugging',
    'douche', 'douchebag', 'douchey', 'twatwaffle',
    'piss', 'pissed', 'pissing', 'pisshead',
    'slut', 'sluts', 'slutty', 'whore', 'whores', 'whoring', 'skank', 'skanky',
    'goddamn', 'goddamnit', 'godammit', 'jesuschrist',
  ]),
  ...P('profanity', [
    'what the fuck', 'shut the fuck up', 'fuck off', 'fuck you', 'piss off',
    'son of a bitch', 'go to hell', 'kiss my ass', 'up yours',
  ]),
  ...W('profanity_mild', [
    // Mild swearing. Off by default: blocking these generates a lot of noise
    // and most 13-year-olds will just retype. Flip on if you want a stricter
    // room than the app store rating requires.
    'damn', 'damnit', 'dammit', 'crap', 'crappy', 'hell', 'bloody', 'freaking',
    'frick', 'fricking', 'frig', 'frigging', 'heck', 'darn', 'sucks', 'screwed',
  ], { enabled: false }),
  ...W('insult', [
    // Plain meanness. Off by default — this is bullying policy, not language
    // policy, and blocking the word does not stop the behaviour. Your call.
    'idiot', 'idiots', 'stupid', 'dumb', 'moron', 'morons', 'imbecile',
    'loser', 'losers', 'ugly', 'fatso', 'noob', 'trash', 'garbage', 'pathetic',
  ], { enabled: false }),

  // ===================================================================
  // SLURS
  // Zero tolerance. None of these have a defensible use in this app, so
  // none of them are conditional. Kept in one section so the policy is
  // reviewable in one place.
  // ===================================================================
  ...W('slur_racial', [
    'nigger', 'niggers', 'nigga', 'niggas', 'niggah', 'nigg', 'niggar',
    'negro', 'negroes', 'chink', 'chinks', 'gook', 'gooks', 'spic', 'spics',
    'wetback', 'wetbacks', 'beaner', 'beaners', 'kike', 'kikes', 'paki',
    'pakis', 'raghead', 'ragheads', 'towelhead', 'sandnigger', 'coon', 'coons',
    'jap', 'japs', 'zipperhead', 'gyppo', 'pickaninny', 'mulatto', 'halfbreed',
    'redskin', 'squaw', 'wog', 'wops', 'dago', 'honky', 'gringo',
  ]),
  ...W('slur_lgbt', [
    'fag', 'fags', 'faggot', 'faggots', 'faggy', 'fgt', 'fagot',
    'dyke', 'dykes', 'tranny', 'trannies', 'shemale', 'shemales',
    'homo', 'homos', 'lesbo', 'lezbo', 'battyboy', 'poofter',
    'ladyboy', 'heshe',
  ]),
  ...W('slur_ableist', [
    'retard', 'retards', 'retarded', 'tard', 'tards', 'libtard',
    'spastic', 'spaz', 'spazz', 'mongoloid', 'midget', 'midgets', 'cripple',
  ]),
  ...W('slur_hate', [
    'nazi', 'nazis', 'hitler', 'kkk',     'lynch', 'lynching', 'genocide', 'holocaust',
    // 1488 is the neo-Nazi numeric code. Leetspeak turns digits into letters
    // inside words only, so a bare '1488' survives normalisation intact.
    '1488', '14words',
  ]),
  ...P('slur_hate', [
    'heil hitler', 'white power', 'white pride', 'gas the', 'ethnic cleansing',
    'kill all the',
  ]),
  ...W('slur_hate', [
    // '88' alone is a year, a score, a pet level, a trade count. Almost always
    // innocent here. Seeded so you can turn it on if you ever need to.
    '88',
  ], { enabled: false }),

  // ===================================================================
  // SELF-HARM & SUICIDE
  // Blocking is the floor, not the goal: consider surfacing a helpline
  // to the sender when one of these fires rather than only rejecting.
  // ===================================================================
  ...W('selfharm', [
    'suicide', 'suicidal', 'kys', 'kms', 'anorexia', 'bulimia',
    'thinspo', 'thinspiration', 'proana', 'promia', 'unalive',
  ]),
  ...P('selfharm', [
    'kill myself', 'kill yourself', 'kill urself', 'killing myself',
    'go kill yourself', 'end my life', 'end your life', 'end it all',
    'want to die', 'i want to die', 'wish i was dead', 'wish i were dead',
    'better off dead', 'no one would miss me', 'nobody would miss me',
    'self harm', 'cut myself', 'cutting myself', 'cut yourself',
    'slit my wrists', 'slit your wrists', 'hang myself', 'hang yourself',
    'jump off a bridge', 'overdose on', 'take my own life',
  ]),

  // ===================================================================
  // VIOLENCE & THREATS
  // ===================================================================
  ...W('violence', [
    'rape', 'raped', 'rapes', 'raping', 'rapist', 'rapists', 'gangrape',
    'molest', 'molested', 'molester', 'molestation',
    'pedo', 'pedos', 'pedophile', 'paedophile', 'pedophilia', 'groomer', 'nonce',
    'schoolshooter', 'massshooting', 'terrorist', 'terrorism',
    'swatting', 'doxx', 'doxxing', 'doxxed',
  ]),
  ...P('violence', [
    'kill you', 'ill kill you', 'im going to kill you', 'gonna kill you',
    'beat you up', 'ill beat you', 'im gonna hurt you', 'stab you',
    'shoot you', 'shoot up the school', 'i know where you live',
    'i know where you go to school', 'ill find you', 'im gonna find you',
    'ill swat you', 'ill dox you', 'hope you die', 'you should die',
    'bomb threat', 'school shooting',
  ]),

  // ===================================================================
  // OFF-PLATFORM CONTACT
  // Not "bad words" — a grooming vector. Moving a child into an
  // unmoderated DM is step one of almost every case. YouTube and TikTok
  // are deliberately absent: the link policy already allows those two.
  // ===================================================================
  ...W('offplatform', [
    'discord', 'discordgg', 'discordapp', 'snapchat', 'kik', 'whatsapp',
    'telegram', 'omegle', 'chatroulette', 'yubo', 'monkeyapp', 'wizz',
  ]),
  ...P('offplatform', [
    'add me on discord', 'join my discord', 'my discord is', 'dm me on discord',
    'add me on snap', 'my snap is', 'snap me', 'add my snap',
    'add me on insta', 'my insta is', 'dm me on insta',
    'text me on', 'message me on', 'lets talk somewhere else',
    'lets move this to', 'talk off the app', 'chat off the app',
  ]),
  ...W('offplatform', [
    // Ambiguous on their own — 'snap' is a card game and a verb, 'ig' is
    // "I guess" far more often than Instagram. Off by default; the phrase
    // rows above catch the actual handoff.
    'snap', 'insta', 'instagram', 'ig', 'facebook', 'messenger', 'skype',
  ], { enabled: false }),

  // ===================================================================
  // PERSONAL INFORMATION
  // ===================================================================
  ...W('pii', [
    'cvv', 'ssn', 'routingnumber',
  ]),
  ...P('pii', [
    'what is your address', 'your home address',
    'where do you live exactly', 'whats your postcode', 'whats your zipcode',
    'whats your phone number', 'give me your phone', 'your credit card',
    'your debit card', 'card number', 'bank account', 'social security',
    'whats your password', 'give me your password', 'tell me your password',
    'send me your password', 'your real name', 'whats your real name',
  ]),
  ...W('pii', [
    // 'password' fires on legitimate support talk ("never share your password").
    // Off by default; the phrase rows above catch the actual request.
    'password', 'email', 'phonenumber',
  ], { enabled: false }),

  // ===================================================================
  // DRUGS, ALCOHOL, VAPING
  // ===================================================================
  ...W('drugs', [
    'cocaine', 'heroin', 'meth', 'methamphetamine', 'marijuana', 'cannabis',
    'weed', 'shrooms', 'psilocybin', 'lsd', 'mdma', 'ecstasy', 'ketamine',
    'fentanyl', 'oxycodone', 'oxycontin', 'percocet', 'xanax', 'adderall',
    'codeine', 'dmt', 'pcp', 'crackcocaine', 'angeldust',
    'vape', 'vapes', 'vaping', 'juul', 'nicotine', 'cigarette', 'cigarettes',
    'bong', 'spliff', 'doobie', 'stoned', 'getstoned',
    'vodka', 'whiskey', 'tequila', 'booze', 'alcoholic', 'drunk',
  ]),
  ...P('drugs', [
    'buy drugs', 'sell drugs', 'drug dealer', 'get high', 'getting high',
    'smoke weed', 'do drugs', 'get drunk', 'got any weed',
  ]),
  ...W('drugs', [
    // Every one of these has a common innocent sense in a game chat.
    'pot', 'coke', 'acid', 'crack', 'molly', 'joint', 'dab', 'dabs', 'plug',
    'lean', 'blunt',
    'beer', 'wine', 'rum', 'alcohol', 'smoking', 'high', 'wasted', 'baked',
  ], { enabled: false }),

  // ===================================================================
  // SCAMS
  // Note what is deliberately NOT here: "free", "giveaway", "free gems",
  // "trading". Those are the normal vocabulary of a pet-trading app and
  // blocking them was tried and reverted. Leave them out.
  // ===================================================================
  ...W('scam', [
    'hackaccount', 'accounthack',
    'exploit', 'exploits', 'modmenu', 'aimbot', 'dupeglitch', 'duping',
    'paypal', 'cashapp', 'venmo', 'zelle', 'bitcoin', 'ethereum', 'crypto',
  ]),
  ...P('scam', [
    'free robux', 'robux generator', 'robux hack', 'get free robux',
    'click here', 'click the link', 'limited time offer', 'act now',
    'subscribe to my channel', 'subscribe my channel', 'sub to my channel',
    'check out my channel', 'visit my channel', 'referral code',
    'selling account', 'buying account', 'account for sale', 'sell my account',
    'buy my account', 'trade account', 'free account', 'gift card code',
    'send me your login', 'give me your account', 'i can dupe',
  ]),
];

// =====================================================================
// ALLOWLIST — words that must never be matched.
//
// Repeat-collapsing ("fuuuck" -> "fuck") is what makes padded profanity
// detectable, but it is lossy in both directions: a few ordinary words collapse
// ONTO a banned term. Sweeping the whole of /usr/share/dict/words (235,764
// entries) against this list turned up exactly six, and two of them matter:
//
//     rapping -> raping      a kid talking about music
//     Shiite  -> shite       a branch of Islam read as British swearing
//     annal   -> anal
//     rappe / Rappist        archaic, harmless
//     Bastaard -> bastard
//
// Listing the word here suppresses its collapsed form only. The word itself is
// still matched normally, so putting something here cannot open a hole — it can
// only stop a padded-spelling guess.
//
// Re-run the sweep after adding terms:
//     node -e '...' (see the false-positive check in the commit for this file)
// =====================================================================
export const ALLOWED_TOKENS = new Set([
  'annal', 'annals',
  'bastaard',
  'rappe', 'rapping', 'rappings', 'rappist', 'rappists',
  'shiite', 'shiites',
]);

/** Terms that are live. The client only ever evaluates these. */
export const ACTIVE_BLOCKLIST = BLOCKLIST.filter((t) => t.enabled);

export const BLOCKLIST_CATEGORIES = [...new Set(BLOCKLIST.map((t) => t.category))].sort();

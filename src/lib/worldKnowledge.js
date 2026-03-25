/**
 * WORLD KNOWLEDGE BASE
 * 
 * This file contains background knowledge about the world that characters live in.
 * Characters do NOT inherently know this information — they may learn it through
 * conversation, study, or lived experience. This context guides the LLM in generating
 * realistic, grounded character behavior, dialogue, and decision-making.
 */

export const WORLD_KNOWLEDGE = {

  // ─────────────────────────────────────────────
  // ACTIVITIES OF DAILY LIVING
  // ─────────────────────────────────────────────
  adls: {
    basic: [
      "Bathing/Showering (grooming, brushing teeth, washing)",
      "Dressing (selecting clothing and getting dressed)",
      "Eating (feeding oneself, not necessarily preparing food)",
      "Mobility/Transferring (moving in/out of bed, chairs, walking)",
      "Toileting (getting to/from the toilet and cleaning oneself)",
      "Continence (managing bowel and bladder control)",
    ],
    instrumental: [
      "Housework (cleaning and maintaining the home)",
      "Meal Preparation (cooking and organizing meals)",
      "Managing Finances (paying bills, managing assets)",
      "Medication Management (taking medications as prescribed)",
      "Transportation (driving or arranging transportation)",
      "Shopping (buying groceries or clothing)",
    ],
    notes: "Impairment usually starts with IADLs (e.g., finances) before progressing to basic ADLs. Causes include aging, chronic illness, injury, or cognitive decline.",
  },

  // ─────────────────────────────────────────────
  // AVERAGE AMERICAN DAILY ROUTINE (ATUS 2024–2025)
  // ─────────────────────────────────────────────
  dailyRoutine: {
    sleep: "~9 hours/day",
    leisure: "~5.1 hours/day (94% of adults engage daily; TV is #1 at 2.6hrs, then socializing and gaming)",
    work: "Average 3.5 hrs/day across all adults; employed people work ~8.4 hrs on workdays",
    householdActivities: "~2 hours/day (women avg 2.7 hrs, men avg 2.3 hrs)",
    eating: "~1.1 hours/day",
    smartphoneChecks: "~58 times/day",
    demographics: {
      gender: "Women do more chores and caregiving; men have more leisure time",
      age: "Adults 75+ spend the most leisure time (7.6 hrs/day)",
      parents: "Parents with kids under 6 spend 2.5 hrs on primary childcare",
      remoteWork: "About 24% of workers do at least some work from home",
    },
  },

  // ─────────────────────────────────────────────
  // EDUCATION — HIGH SCHOOLS (Top school per state)
  // ─────────────────────────────────────────────
  topHighSchools: {
    northeast: {
      "New Jersey": "Bergen County Academies (Hackensack)",
      "New York": "Bronx High School of Science (Bronx)",
      "Massachusetts": "Lexington High School (Lexington)",
      "Connecticut": "Darien High School (Darien)",
      "Pennsylvania": "Conestoga High School (Berwyn)",
      "Rhode Island": "Classical High School (Providence)",
      "New Hampshire": "Academy for Science and Design (Nashua)",
      "Maine": "Maine School of Science & Mathematics (Limestone)",
      "Vermont": "St. Johnsbury Academy (St. Johnsbury)",
    },
    south: {
      "Florida": "Pine View School (Osprey)",
      "Georgia": "Gwinnett School of Mathematics, Science & Technology (Lawrenceville)",
      "Texas": "Carnegie Vanguard High School (Houston)",
      "Virginia": "Thomas Jefferson High School for Science & Technology (Alexandria)",
      "North Carolina": "North Carolina School of Science & Math (Durham)",
      "South Carolina": "Academic Magnet High School (North Charleston)",
      "Tennessee": "Hume-Fogg Academic Magnet School (Nashville)",
      "Alabama": "Loveless Academic Magnet Program (Montgomery)",
      "Mississippi": "West Union Attendance Center (Myrtle)",
      "Louisiana": "Baton Rouge Magnet High School (Baton Rouge)",
      "Arkansas": "Haas Hall Academy (Fayetteville)",
      "Kentucky": "DuPont Manual High School (Louisville)",
    },
    midwest: {
      "Illinois": "Payton College Prep (Chicago)",
      "Ohio": "Walnut Hills High School (Cincinnati)",
      "Michigan": "International Academy (Bloomfield Hills)",
      "Indiana": "Signature School (Evansville)",
      "Wisconsin": "Whitefish Bay High School (Whitefish Bay)",
      "Minnesota": "St. Croix Prep Academy (Stillwater)",
      "Iowa": "Decorah High School (Decorah)",
      "Missouri": "Clayton High School (St. Louis)",
      "Kansas": "Pawnee Heights (Rozel)",
      "Nebraska": "Elkhorn South High School (Omaha)",
      "North Dakota": "Fargo Davies High School (Fargo)",
      "South Dakota": "Lincoln High School (Sioux Falls)",
    },
    west: {
      "California": "California Academy of Mathematics & Science (Long Beach)",
      "Washington": "Tesla STEM High School (Redmond)",
      "Oregon": "Corvallis High School (Corvallis)",
      "Nevada": "Davidson Academy (Reno)",
      "Arizona": "BASIS Tucson North (Tucson)",
      "Colorado": "Peak to Peak Charter School (Lafayette)",
      "Utah": "Academy for Math, Engineering & Science (Salt Lake City)",
      "Idaho": "Boise High School (Boise)",
      "Montana": "Fairfield High School (Fairfield)",
      "Wyoming": "Jackson Hole High School (Jackson)",
      "New Mexico": "Albuquerque Institute of Math & Science",
      "Alaska": "West Anchorage High School (Anchorage)",
      "Hawaii": "Punahou School (Honolulu)",
    },
    notes: "Many top schools are magnet/specialized STEM schools. Northeast dominates overall quality. 'Best' depends on location, programs, and student support needs.",
  },

  // ─────────────────────────────────────────────
  // EDUCATION — COLLEGES & UNIVERSITIES
  // ─────────────────────────────────────────────
  topColleges: {
    eliteTier: ["Harvard University", "Stanford University", "MIT", "Yale University", "Princeton University"],
    ivyLeague: ["Columbia University", "University of Pennsylvania", "Brown University", "Dartmouth College", "Cornell University"],
    stemFocused: ["Caltech", "Carnegie Mellon University", "UC Berkeley", "Georgia Tech", "University of Illinois Urbana-Champaign"],
    businessAndCareer: ["University of Pennsylvania", "NYU", "University of Michigan", "UT Austin", "Indiana University Bloomington"],
    publicValues: ["UCLA", "University of Virginia", "UNC Chapel Hill", "University of Florida", "University of Washington"],
    notes: "74–75% of high school seniors aspire to college, but only 61.4% actually enroll. Cost is the #1 barrier. Trade schools and apprenticeships are rising alternatives. The real 'best' college is where someone can stay enrolled, graduate, and build stability.",
    collegeDesireStats: {
      wantCollege: "74–75% of high school seniors",
      expectToEnroll: "~66% in 2023 (down from 73% in 2018)",
      femaleAspiration: "83% of women vs 68% of men",
      byRace: "Asian students: 90% aspire; American Indian/Alaska Native: 58%",
    },
  },

  // ─────────────────────────────────────────────
  // CRIMINAL JUSTICE SYSTEM
  // ─────────────────────────────────────────────
  criminalJustice: {
    incarceratedRights: {
      legal: [
        "Protection from cruel and unusual punishment (8th Amendment)",
        "Access to courts and legal counsel",
        "Protection against discrimination",
      ],
      healthAndSafety: [
        "Right to medical and mental health care",
        "Protection from inhumane conditions",
        "Reasonable protection from violence",
      ],
      civil: [
        "Limited free speech and religious rights",
        "Right to practice religion",
        "Right to file grievances",
      ],
      reality: "Rights exist on paper but enforcement is inconsistent. Conditions vary heavily by state and facility. There is no single national enforcement authority.",
    },
    jailVsPrison: {
      jail: "Run by local county/city. Holds pre-trial detainees and short sentences. High turnover, often overcrowded and worse conditions. 3,000+ local jails.",
      prison: "Run by state or federal government. Holds longer sentences (felonies). More structured but conditions vary. ~1,500 state prisons.",
    },
    highestIncarcerationStates: {
      rankings: {
        "Mississippi": "661 per 100,000",
        "Louisiana": "596 per 100,000",
        "Arkansas": "574 per 100,000",
        "Oklahoma": "563 per 100,000",
        "Idaho": "460 per 100,000",
        "Texas": "452 per 100,000",
        "Arizona": "446 per 100,000",
        "Kentucky": "437 per 100,000",
        "Georgia": "435 per 100,000",
      },
      commonFactors: [
        "Tough sentencing laws (mandatory minimums, three strikes)",
        "Higher poverty and inequality",
        "Overcrowding, staffing shortages, delayed medical care",
        "Pay-to-stay systems (48 states charge inmates fees)",
        "Prison labor (legal under 13th Amendment; some states pay nothing)",
        "Solitary confinement (up to 20% of inmates experience it)",
      ],
      racialDisparities: {
        "Oklahoma": "Black/white disparity 4.4:1",
        "Louisiana": "3.8:1",
        "Arkansas": "3.5:1",
        "Texas": "3.5:1",
        "Mississippi": "2.6:1",
      },
    },
    crimeAndPrisonStats: {
      topArrests: "Drug violations (822,488), DUI (804,926), larceny-theft (725,109)",
      statePrisonOffenses: "62.3% violent, 12.6% property, 12.6% drug, 11.8% public-order",
      federalPrisonOffenses: "45.2% drug, 43.5% public-order, 7.6% violent, 3.5% property",
      racialBreakdown: "State prisons: ~33% Black, 32% white, 22% Hispanic. Federal: 34% Hispanic, 32% Black, 24% white.",
      gender: "93% male, 7% female",
      peakAgeGroup: "30–34 (841 per 100,000)",
    },
    wrongfulConvictions: {
      total: "3,646 exonerations from 1989–2024; 147 in 2024 alone",
      demographics2024: "78% people of color, nearly 60% Black",
      averageLost: "13.5 years per exonerated person",
      topCrime: "Homicide (58% of 2024 exonerations)",
      racialRisk: "Innocent Black people are 7x more likely to be wrongly convicted of murder than innocent white people",
    },
    homelessnessAndJailCycle: "Citations, fines, arrests, incarceration, displacement push unhoused people deeper into instability. Survival behaviors (sleeping outside, loitering, trespassing) become enforcement targets. The 2024 Grants Pass decision allowed cities to punish sleeping outside even where shelter is inadequate.",
    gangs: {
      whyYouthJoin: "Status, belonging, protection, identity, money (pulls). Poverty, neighborhood disorder, weak school attachment, family stress, prior victimization, delinquent peers (pushes).",
      riskFactor: "Children exposed to 7+ risk factors are 13x more likely to join a gang than those exposed to none or one.",
    },
    overallSupervisedPopulation: "5+ million Americans under correctional supervision (including probation/parole)",
  },

  // ─────────────────────────────────────────────
  // STI STATISTICS (USA)
  // ─────────────────────────────────────────────
  stiStats: {
    prevalence: "~1 in 5 Americans (20%) had an STI on any given day (CDC)",
    mostCommon: "HPV is the most widespread; often asymptomatic",
    trends2024: {
      chlamydia: "Down 8%; still #1 reported bacterial STI with 1.6M+ cases",
      gonorrhea: "Down 10% (3rd consecutive year of decline)",
      syphilis: "Down 22% primary/secondary — first major drop in 20 years; but congenital syphilis up 700% over a decade",
    },
    ageGroup: "Ages 15–24 account for ~50% of new STIs despite being only 25% of sexually active population",
    geographicHotspots: "Southern and Western U.S.; Mississippi and Louisiana have highest combined rates",
    disparities: "Black, Hispanic, and American Indian/Alaska Native communities disproportionately affected due to social determinants and unequal care access",
  },

  // ─────────────────────────────────────────────
  // RELIGION — PSYCHOLOGY & CULTURE
  // ─────────────────────────────────────────────
  religion: {
    whyPeopleStay: [
      "Meaning in chaos — suffering has a framework and purpose",
      "Control when life feels uncontrollable — certainty, clear rules",
      "Community and belonging — family-like structures and identity",
      "Moral grounding — clear sense of right vs wrong",
    ],
    whyPeopleLeave: [
      "Trauma or harm tied to religion — judgment, rejection, exclusion (especially LGBTQ+ experiences)",
      "Intellectual conflict — science vs literal belief, exposure to other worldviews",
      "Hypocrisy and institutions — leaders not practicing what they preach, religion used for power",
      "Identity conflict — sexuality or lifestyle conflicts with doctrine; forced to choose self or system",
    ],
    morelikelyToStay: "Older adults, lower-income/high-stress environments, communities where religion is deeply cultural (e.g., Black church tradition), limited exposure to alternative beliefs",
    moreLikelyToLeave: "Younger generations (Millennials, Gen Z), higher education, urban/diverse environments, LGBTQ+ individuals, those who experienced religious harm",
    stigma: {
      againstReligious: "Seen as closed-minded or outdated, especially in secular spaces",
      againstNonReligious: "Seen as lost, immoral, or disconnected from God",
    },
    connectionToOtherIssues: "Religion often becomes a coping mechanism in incarceration. Faith-based organizations are major support systems for homelessness. Both religion and gangs can offer identity, belonging, and protection — serving similar emotional roles in very different ways.",
    coreTruth: "People don't randomly choose or reject religion. They are responding to their environment, experiences, and need for belonging, safety, and meaning.",
  },

};

/**
 * Returns a condensed world context string for injection into LLM prompts.
 * This gives the LLM background awareness without overwhelming the token budget.
 */
export function getWorldContextForPrompt() {
  return `
WORLD CONTEXT (background knowledge the character lives within — they may not know all of this explicitly):

DAILY LIFE: The average American sleeps ~9 hours, spends ~5 hours on leisure (TV, socializing, gaming), works ~3.5–8 hours, does ~2 hours of household chores, and checks their phone ~58 times/day. About 24% work remotely.

EDUCATION: ~74% of high school seniors aspire to college but only ~61% actually enroll. Cost is the #1 barrier. Trade schools and apprenticeships are rising alternatives. Top universities include Harvard, Stanford, MIT, Yale, Princeton, and the Ivy League. Many top high schools are specialized STEM/magnet schools.

JUSTICE SYSTEM: The U.S. incarcerates over 2 million people. Jails are local (pre-trial/short sentences), prisons are state/federal (longer sentences). Highest incarceration states: Mississippi, Louisiana, Arkansas, Oklahoma, Texas. Rights exist on paper but enforcement is inconsistent. Innocent Black people are 7x more likely to be wrongly convicted of murder. A homelessness-jail cycle pushes unhoused people deeper into instability through fines, arrests, and property seizure.

CRIME & DEMOGRAPHICS: State prisons are 62% violent offenders. Prison population is 93% male, heaviest in the 30–34 age group. Racial disparities are significant throughout the system.

HEALTH: ~1 in 5 Americans has an STI at any given time. Ages 15–24 account for half of new STIs. Southern U.S. has the highest rates. STI rates are disproportionately higher in Black, Hispanic, and Indigenous communities.

RELIGION: People stay for meaning, community, control, and moral grounding. People leave due to trauma, intellectual conflict, hypocrisy, or identity clashes. Religion and gangs can serve similar emotional roles (belonging, protection, identity). Religion is often strongest under systemic stress.

GANGS & POVERTY: Youth join gangs due to pulls (status, belonging, money) and pushes (poverty, instability, trauma, weak school ties). Children with 7+ risk factors are 13x more likely to join a gang.

ADLs: Basic self-care tasks (bathing, dressing, eating, mobility, toileting) and instrumental tasks (cooking, finances, medication, transportation, shopping) are markers of independence and functional health.
`.trim();
}
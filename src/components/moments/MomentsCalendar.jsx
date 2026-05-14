import { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, X, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths } from 'date-fns';

// ── CATEGORY CONFIG ────────────────────────────────────────────────────────────
const CATEGORIES = {
  holiday:    { label: 'Holiday',       dot: 'bg-red-400',     badge: 'bg-red-500/20 text-red-300' },
  awareness:  { label: 'Awareness',     dot: 'bg-orange-400',  badge: 'bg-orange-500/20 text-orange-300' },
  cultural:   { label: 'Cultural',      dot: 'bg-fuchsia-400', badge: 'bg-fuchsia-500/20 text-fuchsia-300' },
  seasonal:   { label: 'Seasonal',      dot: 'bg-sky-400',     badge: 'bg-sky-500/20 text-sky-300' },
  novelty:    { label: 'Fun Day',       dot: 'bg-yellow-400',  badge: 'bg-yellow-500/20 text-yellow-300' },
  community:  { label: 'Community',     dot: 'bg-emerald-400', badge: 'bg-emerald-500/20 text-emerald-300' },
  birthday:   { label: 'Birthday',      dot: 'bg-rose-400',    badge: 'bg-rose-500/20 text-rose-300' },
  user:       { label: 'My Event',      dot: 'bg-indigo-400',  badge: 'bg-indigo-500/20 text-indigo-300' },
};

// ── MONTH-BASED OBSERVANCES (apply every year by month/day) ──────────────────
// Format: { month, day, name, icon, category }
const ANNUAL_OBSERVANCES = [
  // ── JANUARY ──────────────────────────────────────────────────────────────────
  { month: 1,  day: 1,  name: "New Year's Day",              icon: '🎉', category: 'holiday' },
  { month: 1,  day: 1,  name: 'National Hangover Day',       icon: '😵', category: 'novelty' },
  { month: 1,  day: 2,  name: 'World Cancer Day Prep',       icon: '🎗️', category: 'awareness' },
  { month: 1,  day: 7,  name: 'Penguin Awareness Day',       icon: '🐧', category: 'novelty' },
  { month: 1,  day: 13, name: 'National Rubber Duck Day',    icon: '🦆', category: 'novelty' },
  { month: 1,  day: 14, name: 'National Dress Up Your Pet Day', icon: '🐾', category: 'novelty' },
  { month: 1,  day: 15, name: 'National Strawberry Ice Cream Day', icon: '🍓', category: 'novelty' },
  // MLK Day — computed dynamically, not hardcoded here
  { month: 1,  day: 21, name: 'Squirrel Appreciation Day',   icon: '🐿️', category: 'novelty' },
  { month: 1,  day: 24, name: 'Belly Laugh Day',             icon: '😂', category: 'novelty' },
  { month: 1,  day: 31, name: 'Gorilla Suit Day',            icon: '🦍', category: 'novelty' },
  // January = Cervical Health Awareness Month
  { month: 1,  day: 1,  name: 'Cervical Health Awareness Month Begins', icon: '🎗️', category: 'awareness' },

  // ── FEBRUARY ─────────────────────────────────────────────────────────────────
  { month: 2,  day: 1,  name: 'American Heart Month Begins', icon: '❤️', category: 'awareness' },
  { month: 2,  day: 1,  name: 'Black History Month Begins',  icon: '✊', category: 'cultural' },
  { month: 2,  day: 4,  name: 'World Cancer Day',            icon: '🎗️', category: 'awareness' },
  { month: 2,  day: 6,  name: 'National Frozen Yogurt Day',  icon: '🍦', category: 'novelty' },
  { month: 2,  day: 7,  name: 'Nat\'l Black HIV/AIDS Awareness Day', icon: '🎗️', category: 'awareness' },
  { month: 2,  day: 10, name: 'National Cream Cheese Brownie Day', icon: '🍫', category: 'novelty' },
  { month: 2,  day: 14, name: "Valentine's Day",             icon: '❤️', category: 'holiday' },
  // Presidents' Day — computed dynamically, not hardcoded here
  { month: 2,  day: 20, name: 'National Love Your Pet Day',  icon: '🐾', category: 'novelty' },
  { month: 2,  day: 22, name: 'National Margarita Day',      icon: '🍹', category: 'novelty' },

  // ── MARCH ────────────────────────────────────────────────────────────────────
  { month: 3,  day: 1,  name: 'National Nutrition Month Begins', icon: '🥗', category: 'awareness' },
  { month: 3,  day: 1,  name: 'Colorectal Cancer Awareness Month Begins', icon: '🎗️', category: 'awareness' },
  { month: 3,  day: 4,  name: 'National Grammar Day',        icon: '📝', category: 'novelty' },
  { month: 3,  day: 7,  name: 'National Cereal Day',         icon: '🥣', category: 'novelty' },
  { month: 3,  day: 8,  name: "International Women's Day",   icon: '♀️', category: 'cultural' },
  { month: 3,  day: 14, name: 'Pi Day',                      icon: '🥧', category: 'novelty' },
  { month: 3,  day: 14, name: 'National Corn Dog Day',       icon: '🌭', category: 'novelty' },
  { month: 3,  day: 17, name: "St. Patrick's Day",           icon: '🍀', category: 'holiday' },
  { month: 3,  day: 21, name: 'World Down Syndrome Day',     icon: '🎗️', category: 'awareness' },
  { month: 3,  day: 21, name: 'International Day of Forests', icon: '🌲', category: 'seasonal' },
  { month: 3,  day: 25, name: 'National Waffle Day',         icon: '🧇', category: 'novelty' },
  { month: 3,  day: 31, name: "National She's Funny That Way Day", icon: '😄', category: 'novelty' },

  // ── APRIL ────────────────────────────────────────────────────────────────────
  { month: 4,  day: 1,  name: "April Fools' Day",            icon: '😂', category: 'holiday' },
  { month: 4,  day: 2,  name: 'World Autism Awareness Day',  icon: '🎗️', category: 'awareness' },
  { month: 4,  day: 4,  name: 'National Vitamin C Day',      icon: '🍊', category: 'novelty' },
  { month: 4,  day: 7,  name: 'World Health Day',            icon: '🌍', category: 'awareness' },
  { month: 4,  day: 10, name: 'National Siblings Day',       icon: '👫', category: 'novelty' },
  { month: 4,  day: 11, name: 'National Pet Day',            icon: '🐾', category: 'novelty' },
  { month: 4,  day: 14, name: 'National Dolphin Day',        icon: '🐬', category: 'novelty' },
  { month: 4,  day: 15, name: 'Casimir Pulaski Day',         icon: '🇵🇱', category: 'cultural' },
  { month: 4,  day: 18, name: 'National Animal Crackers Day', icon: '🍪', category: 'novelty' },
  { month: 4,  day: 20, name: 'National Weed Day',           icon: '🌿', category: 'novelty' },
  { month: 4,  day: 22, name: 'Earth Day',                   icon: '🌍', category: 'seasonal' },
  { month: 4,  day: 25, name: 'National Telephone Day',      icon: '📞', category: 'novelty' },
  { month: 4,  day: 25, name: 'National Youth HIV/AIDS Awareness Day', icon: '🎗️', category: 'awareness' },
  { month: 4,  day: 29, name: 'Arbor Day',                   icon: '🌳', category: 'seasonal' },

  // ── MAY ──────────────────────────────────────────────────────────────────────
  { month: 5,  day: 1,  name: 'Mental Health Awareness Month Begins', icon: '💚', category: 'awareness' },
  { month: 5,  day: 1,  name: "Asian Pacific American Heritage Month Begins", icon: '🌏', category: 'cultural' },
  { month: 5,  day: 4,  name: 'Star Wars Day',               icon: '⭐', category: 'novelty' },
  { month: 5,  day: 5,  name: 'Cinco de Mayo',               icon: '🎊', category: 'cultural' },
  { month: 5,  day: 8,  name: 'No Socks Day',                icon: '🦶', category: 'novelty' },
  // Mother's Day — computed dynamically, not hardcoded here
  { month: 5,  day: 19, name: 'National Asian & PI HIV/AIDS Awareness Day', icon: '🎗️', category: 'awareness' },
  { month: 5,  day: 19, name: "National Devil's Food Cake Day", icon: '🍰', category: 'novelty' },
  { month: 5,  day: 21, name: 'National Memo Day',           icon: '📋', category: 'novelty' },
  // Memorial Day — computed dynamically, not hardcoded here
  { month: 5,  day: 29, name: 'National Biscuit Day',        icon: '🥐', category: 'novelty' },
  { month: 5,  day: 31, name: "National Selfie Day Eve",     icon: '📸', category: 'novelty' },

  // ── JUNE ─────────────────────────────────────────────────────────────────────
  { month: 6,  day: 1,  name: 'Pride Month Begins',          icon: '🏳️‍🌈', category: 'cultural' },
  { month: 6,  day: 1,  name: "Men's Health Month Begins",   icon: '💪', category: 'awareness' },
  { month: 6,  day: 4,  name: 'National Cheese Day',         icon: '🧀', category: 'novelty' },
  // Father's Day — computed dynamically, not hardcoded here
  { month: 6,  day: 19, name: 'Juneteenth',                  icon: '✊', category: 'holiday' },
  { month: 6,  day: 21, name: 'Summer Solstice',             icon: '☀️', category: 'seasonal' },
  { month: 6,  day: 21, name: 'National Selfie Day',         icon: '📸', category: 'novelty' },
  { month: 6,  day: 27, name: 'National HIV Testing Day',    icon: '🎗️', category: 'awareness' },
  { month: 6,  day: 27, name: 'National Sunglasses Day',     icon: '😎', category: 'novelty' },
  { month: 6,  day: 28, name: 'Pride Parade Day',            icon: '🏳️‍🌈', category: 'cultural' },

  // ── JULY ─────────────────────────────────────────────────────────────────────
  { month: 7,  day: 1,  name: 'National Creative Ice Cream Flavor Day', icon: '🍦', category: 'novelty' },
  { month: 7,  day: 4,  name: 'Independence Day',            icon: '🎆', category: 'holiday' },
  { month: 7,  day: 7,  name: 'World Chocolate Day',         icon: '🍫', category: 'novelty' },
  { month: 7,  day: 13, name: 'Nat\'l French Fry Day',       icon: '🍟', category: 'novelty' },
  { month: 7,  day: 16, name: 'National Ice Cream Day',      icon: '🍨', category: 'novelty' },
  { month: 7,  day: 17, name: 'World Emoji Day',             icon: '😊', category: 'novelty' },
  { month: 7,  day: 22, name: 'National Hot Dog Day',        icon: '🌭', category: 'novelty' },
  { month: 7,  day: 30, name: 'Nat\'l Cheesecake Day',       icon: '🍰', category: 'novelty' },

  // ── AUGUST ───────────────────────────────────────────────────────────────────
  { month: 8,  day: 1,  name: "National Girlfriends' Day",   icon: '👭', category: 'novelty' },
  { month: 8,  day: 3,  name: 'National Watermelon Day',     icon: '🍉', category: 'novelty' },
  { month: 8,  day: 8,  name: 'National Cat Day',            icon: '🐱', category: 'novelty' },
  { month: 8,  day: 10, name: 'National Lazy Day',           icon: '😴', category: 'novelty' },
  { month: 8,  day: 12, name: "International Youth Day",     icon: '🌍', category: 'cultural' },
  { month: 8,  day: 13, name: 'International Left-Handers Day', icon: '✋', category: 'novelty' },
  { month: 8,  day: 15, name: 'National Relaxation Day',     icon: '🧘', category: 'novelty' },
  { month: 8,  day: 16, name: 'National Tell a Joke Day',    icon: '😄', category: 'novelty' },
  { month: 8,  day: 19, name: 'World Photo Day',             icon: '📷', category: 'novelty' },
  { month: 8,  day: 26, name: "Women's Equality Day",        icon: '♀️', category: 'cultural' },
  { month: 8,  day: 28, name: 'National Red Wine Day',       icon: '🍷', category: 'novelty' },

  // ── SEPTEMBER ────────────────────────────────────────────────────────────────
  // Labor Day — computed dynamically, not hardcoded here
  { month: 9,  day: 5,  name: 'National Cheese Pizza Day',   icon: '🍕', category: 'novelty' },
  { month: 9,  day: 9,  name: 'National HIV/AIDS & Aging Awareness Day', icon: '🎗️', category: 'awareness' },
  { month: 9,  day: 10, name: 'World Suicide Prevention Day', icon: '💚', category: 'awareness' },
  { month: 9,  day: 13, name: 'National Celiac Disease Awareness Day', icon: '🌾', category: 'awareness' },
  { month: 9,  day: 15, name: 'Hispanic Heritage Month Begins', icon: '🌮', category: 'cultural' },
  { month: 9,  day: 19, name: 'National Voter Registration Day', icon: '🗳️', category: 'cultural' },
  { month: 9,  day: 22, name: 'Autumn Equinox',              icon: '🍂', category: 'seasonal' },
  { month: 9,  day: 22, name: 'National Ice Cream Cone Day', icon: '🍦', category: 'novelty' },
  { month: 9,  day: 27, name: 'World Tourism Day',           icon: '✈️', category: 'cultural' },
  { month: 9,  day: 28, name: 'National Good Neighbor Day',  icon: '🤝', category: 'novelty' },

  // ── OCTOBER ──────────────────────────────────────────────────────────────────
  { month: 10, day: 1,  name: 'Breast Cancer Awareness Month Begins', icon: '🎀', category: 'awareness' },
  { month: 10, day: 1,  name: 'LGBTQ+ History Month Begins', icon: '🏳️‍🌈', category: 'cultural' },
  { month: 10, day: 4,  name: 'National Taco Day',           icon: '🌮', category: 'novelty' },
  { month: 10, day: 7,  name: 'National Frappe Day',         icon: '☕', category: 'novelty' },
  { month: 10, day: 10, name: 'World Mental Health Day',     icon: '💚', category: 'awareness' },
  { month: 10, day: 11, name: 'National Coming Out Day',     icon: '🏳️‍🌈', category: 'cultural' },
  { month: 10, day: 15, name: 'National Breast Cancer Awareness Day', icon: '🎀', category: 'awareness' },
  { month: 10, day: 16, name: 'World Food Day',              icon: '🌍', category: 'cultural' },
  { month: 10, day: 18, name: 'National Sweetest Day',       icon: '🍬', category: 'novelty' },
  { month: 10, day: 20, name: 'Testicular Cancer Awareness Day', icon: '🎗️', category: 'awareness' },
  { month: 10, day: 28, name: 'National First Responders Day', icon: '🚒', category: 'cultural' },
  { month: 10, day: 31, name: 'Halloween',                   icon: '🎃', category: 'holiday' },

  // ── NOVEMBER ─────────────────────────────────────────────────────────────────
  { month: 11, day: 1,  name: "Dia de los Muertos",          icon: '💀', category: 'cultural' },
  { month: 11, day: 1,  name: "Men's Movember Begins",       icon: '👨', category: 'awareness' },
  { month: 11, day: 1,  name: 'Native American Heritage Month Begins', icon: '🦅', category: 'cultural' },
  { month: 11, day: 2,  name: "Dia de los Muertos (Day 2)",  icon: '🌸', category: 'cultural' },
  { month: 11, day: 3,  name: 'National Sandwich Day',       icon: '🥪', category: 'novelty' },
  { month: 11, day: 8,  name: 'National Cappuccino Day',     icon: '☕', category: 'novelty' },
  { month: 11, day: 11, name: 'Veterans Day',                icon: '🇺🇸', category: 'holiday' },
  { month: 11, day: 13, name: 'World Kindness Day',          icon: '💛', category: 'cultural' },
  { month: 11, day: 14, name: 'World Diabetes Day',          icon: '🎗️', category: 'awareness' },
  { month: 11, day: 19, name: "National Shower with a Friend Day", icon: '🚿', category: 'novelty' },
  { month: 11, day: 20, name: 'Trans Day of Remembrance',    icon: '🏳️‍⚧️', category: 'cultural' },
  // Thanksgiving — computed dynamically, not hardcoded here
  { month: 11, day: 28, name: 'Black Friday',                icon: '🛍️', category: 'novelty' },

  // ── DECEMBER ─────────────────────────────────────────────────────────────────
  { month: 12, day: 1,  name: 'World AIDS Day',              icon: '🎗️', category: 'awareness' },
  { month: 12, day: 3,  name: 'Int\'l Day of Persons with Disabilities', icon: '♿', category: 'awareness' },
  { month: 12, day: 4,  name: 'National Cookie Day',         icon: '🍪', category: 'novelty' },
  { month: 12, day: 4,  name: 'Fruitcake Toss Day',          icon: '🍰', category: 'novelty' },
  { month: 12, day: 12, name: 'Poinsettia Day',              icon: '🌺', category: 'seasonal' },
  { month: 12, day: 21, name: 'Winter Solstice',             icon: '❄️', category: 'seasonal' },
  { month: 12, day: 24, name: 'Christmas Eve',               icon: '🎄', category: 'holiday' },
  { month: 12, day: 25, name: 'Christmas',                   icon: '🎁', category: 'holiday' },
  { month: 12, day: 26, name: 'Kwanzaa Begins',              icon: '🕯️', category: 'cultural' },
  { month: 12, day: 31, name: "New Year's Eve",              icon: '🥂', category: 'holiday' },
];

// ── DYNAMIC FLOATING HOLIDAY CALCULATOR ────────────────────────────────────────
// Computes rule-based holidays for ANY year — no hardcoded static tables.
// Rules: Rule 8 compliance — floating dates recalculated dynamically per year.

function getNthWeekday(year, month, weekday, n) {
  // n=1 → first, n=2 → second, etc. weekday: 0=Sun,1=Mon,...,6=Sat
  const first = new Date(year, month - 1, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return 1 + offset + (n - 1) * 7;
}

function getLastWeekday(year, month, weekday) {
  const last = new Date(year, month, 0); // last day of month
  const offset = (last.getDay() - weekday + 7) % 7;
  return last.getDate() - offset;
}

function calculateEasterDate(year) {
  // Computus algorithm
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31);
  const da = ((h + l - 7 * m + 114) % 31) + 1;
  return { month: mo, day: da };
}

function getMardiGras(year) {
  // Mardi Gras = 47 days before Easter
  const easter = calculateEasterDate(year);
  const easterDate = new Date(year, easter.month - 1, easter.day);
  const mg = new Date(easterDate);
  mg.setDate(mg.getDate() - 47);
  return { month: mg.getMonth() + 1, day: mg.getDate() };
}

function getFloatingHolidaysForYear(year) {
  const fmt = (m, d) => `${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const easter = calculateEasterDate(year);
  const mardiGras = getMardiGras(year);
  const mlkDay = getNthWeekday(year, 1, 1, 3);       // 3rd Monday in January
  const presDay = getNthWeekday(year, 2, 1, 3);       // 3rd Monday in February
  const mothersDay = getNthWeekday(year, 5, 0, 2);    // 2nd Sunday in May
  const memorialDay = getLastWeekday(year, 5, 1);     // Last Monday in May
  const fathersDay = getNthWeekday(year, 6, 0, 3);    // 3rd Sunday in June
  const laborDay = getNthWeekday(year, 9, 1, 1);      // 1st Monday in September
  const thanksgiving = getNthWeekday(year, 11, 4, 4); // 4th Thursday in November

  return [
    { date: fmt(1, mlkDay),       name: 'MLK Day',          icon: '✊',   category: 'holiday' },
    { date: fmt(2, presDay),      name: "Presidents' Day",  icon: '🇺🇸',  category: 'holiday' },
    { date: fmt(mardiGras.month, mardiGras.day), name: 'Mardi Gras', icon: '🎭', category: 'cultural' },
    { date: fmt(easter.month, easter.day),       name: 'Easter',     icon: '🐣', category: 'holiday' },
    { date: fmt(5, mothersDay),   name: "Mother's Day",     icon: '💐',   category: 'holiday' },
    { date: fmt(5, memorialDay),  name: 'Memorial Day',     icon: '🇺🇸',  category: 'holiday' },
    { date: fmt(6, fathersDay),   name: "Father's Day",     icon: '👨‍👧',  category: 'holiday' },
    { date: fmt(9, laborDay),     name: 'Labor Day',        icon: '⚒️',   category: 'holiday' },
    { date: fmt(11, thanksgiving),name: 'Thanksgiving',     icon: '🦃',   category: 'holiday' },
  ];
}

// Cache computed floating holidays per year (recomputed only when year changes)
const _floatingCache = {};
function getFloatingForYear(year) {
  if (!_floatingCache[year]) _floatingCache[year] = getFloatingHolidaysForYear(year);
  return _floatingCache[year];
}

// ── BIRTHDAY PARSER ────────────────────────────────────────────────────────────
function parseBirthday(bdStr) {
  if (!bdStr) return null;
  const parts = bdStr.split('-');
  if (parts.length === 3) return { month: parseInt(parts[1], 10), day: parseInt(parts[2], 10) };
  if (parts.length === 2) return { month: parseInt(parts[0], 10), day: parseInt(parts[1], 10) };
  return null;
}

// ── MAIN COMPONENT ─────────────────────────────────────────────────────────────
export default function MomentsCalendar({ characters = [], userBirthday = null, communityEvents = [] }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [userEvents, setUserEvents] = useState([]);
  const [selectedDay, setSelectedDay] = useState(null);
  const [panelMode, setPanelMode] = useState('view');
  const [eventName, setEventName] = useState('');
  const [addToCommunity, setAddToCommunity] = useState(null);

  const year = currentMonth.getFullYear();

  // Build all events for a given date string
  const getEventsForDate = (date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const m = date.getMonth() + 1;
    const d = date.getDate();

    // Annual observances (month+day match)
    const annual = ANNUAL_OBSERVANCES
      .filter(o => o.month === m && o.day === d)
      .map(o => ({ ...o, date: dateStr }));

    // Floating year-specific holidays — dynamically computed for any year
    const annualNames = new Set(annual.map(o => o.name));
    const floating = getFloatingForYear(year)
      .filter(o => o.date === dateStr && !annualNames.has(o.name));

    // Birthdays
    const birthdays = [];
    characters.forEach(char => {
      if (!char.birthday) return;
      const parsed = parseBirthday(char.birthday);
      if (!parsed) return;
      if (parsed.month === m && parsed.day === d) {
        birthdays.push({ name: `${char.name}'s Birthday`, icon: '🎂', category: 'birthday', date: dateStr });
      }
    });
    if (userBirthday) {
      const parsed = parseBirthday(userBirthday);
      if (parsed && parsed.month === m && parsed.day === d) {
        birthdays.push({ name: 'Your Birthday', icon: '🎂', category: 'birthday', date: dateStr });
      }
    }

    // Community events (from CommunityEvent entity)
    const community = communityEvents
      .filter(ev => {
        if (!ev.start_date) return false;
        const evDate = ev.start_date.split('T')[0];
        return evDate === dateStr;
      })
      .map(ev => ({
        name: ev.name,
        icon: '🏘️',
        category: 'community',
        date: dateStr,
        location: ev.location_name || null,
        description: ev.description || null,
      }));

    // User-created events
    const custom = userEvents.filter(e => e.date === dateStr);

    return [...annual, ...floating, ...birthdays, ...community, ...custom];
  };

  const handleDayClick = (date) => {
    setSelectedDay(date);
    setPanelMode('view');
    setEventName('');
    setAddToCommunity(null);
  };

  const handleAddEvent = () => {
    if (!selectedDay || !eventName.trim() || addToCommunity === null) return;
    const dateStr = format(selectedDay, 'yyyy-MM-dd');
    setUserEvents(prev => [...prev, {
      date: dateStr,
      name: eventName.trim(),
      icon: '📅',
      category: 'user',
      addedToCommunity: addToCommunity,
    }]);
    setEventName('');
    setAddToCommunity(null);
    setPanelMode('view');
  };

  const closePanel = () => {
    setSelectedDay(null);
    setPanelMode('view');
    setEventName('');
    setAddToCommunity(null);
  };

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const emptyDays = Array(monthStart.getDay()).fill(null);
  const selectedEvents = selectedDay ? getEventsForDate(selectedDay) : [];

  // Unique dot colors for a day (deduplicated by category)
  const getDotCategories = (date) => {
    const evs = getEventsForDate(date);
    const seen = new Set();
    return evs
      .map(e => e.category)
      .filter(c => { if (seen.has(c)) return false; seen.add(c); return true; })
      .slice(0, 3);
  };

  return (
    <div className="bg-card/50 border border-border rounded-xl overflow-hidden mb-2">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          <h2 className="text-base font-semibold text-foreground">{format(currentMonth, 'MMMM yyyy')}</h2>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="h-7 w-7 p-0">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="h-7 w-7 p-0">
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setSelectedDay(new Date()); setPanelMode('add'); }}
            className="ml-1 h-7 px-2 gap-1 text-xs"
          >
            <Plus className="w-3 h-3" /> Add
          </Button>
        </div>
      </div>

      <div className="p-3">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 mb-1">
          {['S','M','T','W','T','F','S'].map((d, i) => (
            <div key={i} className="text-[10px] font-semibold text-muted-foreground text-center py-1">{d}</div>
          ))}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-7 gap-0.5">
          {emptyDays.map((_, i) => <div key={`e-${i}`} />)}
          {daysInMonth.map(date => {
            const isToday = isSameDay(date, new Date());
            const isSelected = selectedDay && isSameDay(date, selectedDay);
            const dotCats = getDotCategories(date);

            return (
              <div
                key={date.toISOString()}
                onClick={() => handleDayClick(date)}
                className={`relative flex flex-col items-center justify-start rounded-md p-1 cursor-pointer transition-colors min-h-[38px]
                  ${isSelected ? 'bg-primary/30 border border-primary/60' : isToday ? 'bg-primary/15 border border-primary/30' : 'hover:bg-secondary/50 border border-transparent'}
                `}
              >
                <span className={`text-[11px] font-medium leading-none mb-0.5 ${isToday ? 'text-primary font-bold' : 'text-foreground'}`}>
                  {date.getDate()}
                </span>
                {dotCats.length > 0 && (
                  <div className="flex gap-0.5 flex-wrap justify-center">
                    {dotCats.map((cat, i) => (
                      <span key={i} className={`w-1 h-1 rounded-full ${CATEGORIES[cat]?.dot || 'bg-muted-foreground'}`} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
          {Object.entries(CATEGORIES).filter(([k]) => k !== 'user' && k !== 'birthday').map(([key, val]) => (
            <div key={key} className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${val.dot}`} />
              <span className="text-[9px] text-muted-foreground">{val.label}</span>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            <span className="text-[9px] text-muted-foreground">Birthday</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
            <span className="text-[9px] text-muted-foreground">My Event</span>
          </div>
        </div>
      </div>

      {/* Day panel */}
      {selectedDay && (
        <div className="border-t border-border bg-secondary/20 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">{format(selectedDay, 'EEEE, MMMM d')}</h3>
            <button onClick={closePanel} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* View mode */}
          {panelMode === 'view' && (
            <div>
              {selectedEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground mb-3">Nothing on this day.</p>
              ) : (
                <ul className="space-y-1.5 mb-3">
                  {selectedEvents.map((ev, i) => {
                    const cat = CATEGORIES[ev.category] || CATEGORIES.user;
                    return (
                      <li key={i} className={`flex items-start gap-2 px-3 py-2 rounded-lg text-sm ${cat.badge}`}>
                        <span className="text-base leading-none shrink-0 mt-0.5">{ev.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{ev.name}</div>
                          {ev.location && <div className="text-[10px] opacity-70 truncate">📍 {ev.location}</div>}
                          {ev.description && <div className="text-[10px] opacity-60 truncate">{ev.description}</div>}
                        </div>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full border border-current opacity-70 shrink-0 mt-0.5`}>
                          {cat.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Button variant="outline" size="sm" onClick={() => setPanelMode('add')} className="h-7 px-3 text-xs gap-1">
                <Plus className="w-3 h-3" /> Add event on this day
              </Button>
            </div>
          )}

          {/* Add mode */}
          {panelMode === 'add' && (
            <div>
              <input
                type="text"
                placeholder="Event name..."
                value={eventName}
                onChange={e => setEventName(e.target.value)}
                className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground text-sm mb-3 focus:outline-none focus:ring-1 focus:ring-primary/50"
                autoFocus
              />
              <p className="text-xs text-muted-foreground mb-2">Add to Homepage Community Event strip?</p>
              <div className="flex gap-2 mb-3">
                {[true, false].map(val => (
                  <button
                    key={String(val)}
                    onClick={() => setAddToCommunity(val)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      addToCommunity === val
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-secondary/40 text-muted-foreground border-border hover:border-primary/40'
                    }`}
                  >
                    {val ? 'Yes' : 'No'}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAddEvent} disabled={!eventName.trim() || addToCommunity === null} className="h-8 flex-1">
                  Save
                </Button>
                <Button size="sm" variant="outline" onClick={() => selectedEvents.length > 0 ? setPanelMode('view') : closePanel()} className="h-8">
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
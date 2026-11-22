import { MapPin, Home, Briefcase, Coffee, Trees, Wine, GraduationCap, Heart, Dumbbell, Users } from "lucide-react";

/**
 * Location form configuration — zone presets, categories and venue subtypes.
 * Pure data used by the Locations page and its form. No behavior lives here.
 */

export const ZONE_PRESETS = {
  home: ["Living Room", "Kitchen", "Bedroom 1", "Bedroom 2", "Bedroom 3", "Bedroom 4", "Bathroom", "Dining Room", "Hallway", "Backyard", "Basement", "Office"],
  hotel: ["Lobby", "Standard Room", "Suite", "Deluxe Room", "Hallway", "Elevator", "Fitness Center", "Pool Area", "Restaurant", "Parking", "Rooftop"],
  shelter: ["Dormitory", "Common Area", "Intake Desk", "Bathroom", "Dining Hall", "Counseling Room", "Storage", "Entrance"],
  gym: ["Workout Floor", "Front Desk", "Locker Room", "Bathroom", "Stretching Area", "Cardio Zone", "Weight Room", "Pool", "Sauna"],
  workplace: ["Office", "Office 1", "Office 2", "Admin Office", "Manager Office", "Staff Office", "Break Room", "Conference Room", "Reception", "Hallway", "Parking"],
  social: ["Main Floor", "Bar Area", "VIP Section", "Outdoor Patio", "Entrance", "Bathroom"],
  food_drink: ["Dining Area", "Counter / Bar", "Outdoor Seating", "Bathroom", "Entrance"],
  grocery: ["Main Floor", "Produce", "Deli", "Checkout", "Entrance", "Bakery", "Pharmacy"],
  school: ["Classroom", "Classroom 2", "Hallway", "Office", "Admin Office", "Cafeteria", "Gym", "Courtyard", "Library", "Auditorium", "Parking"],
  education: ["Classroom", "Classroom 2", "Hallway", "Office", "Admin Office", "Cafeteria", "Gym", "Courtyard", "Library", "Auditorium", "Parking"],
  community: ["Main Hall", "Activity Room", "Office", "Waiting Area", "Kitchen", "Meeting Room", "Playground", "Parking", "Entrance"],
  religion: ["Main Sanctuary", "Prayer Room", "Chapel", "Office", "Admin Office", "Fellowship Hall", "Study Room", "Entrance", "Parking"],
  outdoor: ["Main Area", "Trail", "Parking", "Entrance", "Shelter / Pavilion", "Picnic Area", "Playground"],
  medical: ["Waiting Area", "Front Desk", "Triage", "Patient Room", "Hallway", "Office", "Admin Office", "Operating Room", "Recovery Room", "Pharmacy"],
  business: ["Office", "Office 1", "Office 2", "Admin Office", "Manager Office", "Staff Office", "Conference Room", "Break Room", "Reception", "Hallway"],
  government: ["Office", "Admin Office", "Reception", "Hallway", "Meeting Room", "Entrance"],
  public: ["Main Area", "Entrance", "Information Desk", "Hallway", "Bathroom"],
  generic: ["Main Area", "Entrance", "Back Area", "Bathroom"],
  other: ["Main Area", "Entrance", "Back Area", "Bathroom"],
  jail_prison: ["Entrance", "Exterior", "Cell", "General Population / Day Room", "Exercise Yard", "Cafeteria", "Medical", "Visiting Area", "Holding Area", "Intake / Booking", "Shower Area", "Laundry", "Library / Education Room", "Chapel", "Work Area", "Kitchen", "Guard / Control Room"],
  transportation: ["Main Lobby", "Ticket Booth", "Waiting Area", "Platform", "Concourse", "Boarding Gate", "Transit Shelter", "Information Desk", "Baggage Claim", "Security Checkpoint"],
};

// Allowed character types for assignment in location selectors (workers, residents, inmates)
export const ALLOWED_ASSIGNABLE_CHARACTER_TYPES = [
  'active_created_character',
  'npc_fictitious',
  'npc_family_member',
];

export const CATEGORIES = [
  { value: "home", label: "Home", icon: Home, emoji: "🏠" },
  { value: "hotel", label: "Hotel (Temp)", icon: Home, emoji: "🏨" },
  { value: "shelter", label: "Shelter (Temp)", icon: Home, emoji: "🛖" },
  { value: "workplace", label: "Workplace", icon: Briefcase, emoji: "💼" },
  { value: "school", label: "School / Education", icon: GraduationCap, emoji: "🏫" },
  { value: "gym", label: "Gym", icon: Dumbbell, emoji: "🏋️" },
  { value: "grocery", label: "Grocery Store", icon: Coffee, emoji: "🛒" },
  { value: "religion", label: "Religion / Worship", icon: GraduationCap, emoji: "🛐" },
  { value: "food_drink", label: "Food & Drink", icon: Coffee, emoji: "🍽️" },
  { value: "outdoor", label: "Outdoors", icon: Trees, emoji: "🌳" },
  { value: "social", label: "Social / Nightlife", icon: Wine, emoji: "🍸" },
  { value: "medical", label: "Medical", icon: Heart, emoji: "🏨" },
  { value: "business", label: "Business", icon: Briefcase, emoji: "🏢" },
  { value: "community", label: "Community", icon: Users, emoji: "🏘️" },
  { value: "government", label: "Government", icon: MapPin, emoji: "🏛️" },
  { value: "public", label: "Public", icon: MapPin, emoji: "🗺️" },
  { value: "generic", label: "Generic", icon: MapPin, emoji: "📍" },
  { value: "jail_prison", label: "Jail / Prison", icon: MapPin, emoji: "🔒" },
  { value: "transportation", label: "Transportation", icon: MapPin, emoji: "🚉" },
];

export const SUBTYPE_OPTIONS = {
  home: ["apartment", "house", "condo", "studio", "building"],
  hotel: ["budget_motel", "standard_hotel", "boutique_hotel", "extended_stay", "hostel"],
  shelter: ["emergency_shelter", "transitional_shelter", "womens_shelter", "family_shelter", "overflow_shelter"],
  food_drink: ["coffee_shop", "cafe", "diner", "lunch_spot", "breakfast_spot", "fine_dining_restaurant", "casual_restaurant", "fast_casual", "pizza_place", "sushi_restaurant", "steakhouse", "taco_stand", "burger_joint", "bbq_place", "ramen_shop", "thai_restaurant", "mexican_restaurant", "italian_restaurant", "asian_fusion", "vegan_restaurant", "gastropub", "all_you_can_eat_buffet", "free_food_soup_kitchen"],
  social: ["cocktail_bar", "dive_bar", "sports_bar", "beer_hall", "gay_bar", "lesbian_bar", "queer_bar", "upscale_lounge", "neighborhood_bar", "wine_bar", "tiki_bar", "house_music_club", "hip_hop_club", "electronic_club", "punk_venue", "rock_venue", "latin_dance_club", "country_bar", "jazz_club", "karaoke_bar", "nightclub", "dance_club", "rave_venue", "rooftop_bar", "lounge_club"],
  gym: ["gym", "yoga_studio", "pilates_studio", "crossfit_box", "swimming_pool"],
  outdoor: ["park", "hiking_trail", "beach", "lake", "river", "botanical_garden", "urban_plaza"],
  grocery: ["grocery_store", "supermarket", "farmers_market", "convenience_store"],
  business: ["clothing_store", "bookstore", "record_store", "electronics_store", "home_goods_store", "thrift_store", "warehouse", "mall", "shopping_district", "salon", "barbershop"],
  workplace: ["office", "corporate_office", "startup_office", "factory", "warehouse", "retail_store"],
  medical: ["hospital", "clinic", "urgent_care", "dentist_office", "therapist_office"],
  education: ["university", "college", "high_school", "elementary_school", "library", "classroom"],
  school: ["university", "college", "high_school", "elementary_school"],
  religion: ["church", "temple", "mosque", "synagogue", "meditation_center"],
  public: ["museum", "art_gallery", "theater", "cinema", "concert_venue", "sports_arena", "stadium", "community_center"],
  government: ["government_office", "police_station", "courthouse", "city_hall", "park_ranger_station"],
  community: ["community_center", "drop_in_center", "after_school_program", "daycare", "youth_center", "resource_hub"],
  jail_prison: ["jail", "prison", "detention_center", "holding_cell", "correctional_facility", "juvenile_detention", "halfway_house", "confinement_facility", "pretrial_detention", "adult_detention", "immigration_detention"],
  transportation: ["train_station", "bus_terminal", "transit_center", "airport", "subway_metro_station", "light_rail_station", "ferry_terminal", "boarding_dock", "cruise_terminal", "marina", "port_terminal", "taxi_stand", "ride_share_pickup", "park_and_ride", "tram_station", "cable_car_station"],
};

// Display labels where the raw subtype name would read poorly as a venue type.
export const SUBTYPE_LABELS = {
  free_food_soup_kitchen: "Free Food / Soup Kitchen",
  all_you_can_eat_buffet: "All-You-Can-Eat Buffet",
  warehouse: "Warehouse",
};

export const WORK_CATEGORIES = ['workplace', 'business', 'food_drink', 'gym', 'social', 'education', 'medical', 'school', 'grocery', 'religion', 'government', 'community', 'jail_prison', 'transportation'];

export const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
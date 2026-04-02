import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const SUBTYPE_MAPPING = {
  home: {
    default: "apartment",
    keywords: {
      house: "house",
      condo: "condo",
      apartment: "apartment",
      studio: "studio"
    }
  },
  food_drink: {
    default: "casual_restaurant",
    keywords: {
      coffee: "coffee_shop",
      cafe: "cafe",
      diner: "diner",
      lunch: "lunch_spot",
      breakfast: "breakfast_spot",
      fine_dining: "fine_dining_restaurant",
      casual: "casual_restaurant",
      fast_casual: "fast_casual",
      pizza: "pizza_place",
      sushi: "sushi_restaurant",
      steak: "steakhouse",
      taco: "taco_stand",
      burger: "burger_joint",
      bbq: "bbq_place",
      ramen: "ramen_shop",
      thai: "thai_restaurant",
      mexican: "mexican_restaurant",
      italian: "italian_restaurant",
      fusion: "asian_fusion",
      vegan: "vegan_restaurant",
      gastropub: "gastropub"
    }
  },
  social: {
    default: "neighborhood_bar",
    keywords: {
      cocktail: "cocktail_bar",
      dive: "dive_bar",
      sports: "sports_bar",
      beer: "beer_hall",
      gay: "gay_bar",
      lesbian: "lesbian_bar",
      queer: "queer_bar",
      upscale: "upscale_lounge",
      wine: "wine_bar",
      tiki: "tiki_bar",
      house_music: "house_music_club",
      hip_hop: "hip_hop_club",
      electronic: "electronic_club",
      punk: "punk_venue",
      rock: "rock_venue",
      latin: "latin_dance_club",
      country: "country_bar",
      jazz: "jazz_club",
      karaoke: "karaoke_bar",
      nightclub: "nightclub",
      dance: "dance_club",
      rave: "rave_venue",
      rooftop: "rooftop_bar",
      lounge: "lounge_club"
    }
  },
  gym: {
    default: "gym",
    keywords: {
      yoga: "yoga_studio",
      pilates: "pilates_studio",
      crossfit: "crossfit_box",
      swimming: "swimming_pool"
    }
  },
  outdoor: {
    default: "park",
    keywords: {
      park: "park",
      hiking: "hiking_trail",
      beach: "beach",
      lake: "lake",
      river: "river",
      botanical: "botanical_garden",
      plaza: "urban_plaza"
    }
  },
  grocery: {
    default: "grocery_store",
    keywords: {
      supermarket: "supermarket",
      farmers: "farmers_market",
      convenience: "convenience_store"
    }
  },
  business: {
    default: "retail_store",
    keywords: {
      clothing: "clothing_store",
      bookstore: "bookstore",
      record: "record_store",
      electronics: "electronics_store",
      home_goods: "home_goods_store",
      thrift: "thrift_store",
      mall: "mall",
      district: "shopping_district",
      salon: "salon",
      barbershop: "barbershop"
    }
  },
  workplace: {
    default: "office",
    keywords: {
      office: "office",
      corporate: "corporate_office",
      startup: "startup_office",
      factory: "factory",
      warehouse: "warehouse",
      retail: "retail_store"
    }
  },
  medical: {
    default: "clinic",
    keywords: {
      hospital: "hospital",
      urgent: "urgent_care",
      dentist: "dentist_office",
      therapist: "therapist_office"
    }
  },
  education: {
    default: "library",
    keywords: {
      university: "university",
      college: "college",
      high_school: "high_school",
      elementary: "elementary_school",
      library: "library",
      classroom: "classroom"
    }
  },
  school: {
    default: "high_school",
    keywords: {
      university: "university",
      college: "college",
      high_school: "high_school",
      elementary: "elementary_school"
    }
  },
  religion: {
    default: "church",
    keywords: {
      church: "church",
      temple: "temple",
      mosque: "mosque",
      synagogue: "synagogue",
      meditation: "meditation_center"
    }
  },
  public: {
    default: "community_center",
    keywords: {
      museum: "museum",
      gallery: "art_gallery",
      theater: "theater",
      cinema: "cinema",
      concert: "concert_venue",
      arena: "sports_arena",
      stadium: "stadium",
      community: "community_center"
    }
  },
  government: {
    default: "government_office",
    keywords: {
      police: "police_station",
      courthouse: "courthouse",
      city_hall: "city_hall",
      ranger: "park_ranger_station"
    }
  }
};

function guessSubtype(location) {
  const category = location.category || "generic";
  const mapping = SUBTYPE_MAPPING[category];

  if (!mapping) return "";

  const name = (location.name || "").toLowerCase();
  const subtype = (location.subtype || "").toLowerCase();
  const description = (location.description || "").toLowerCase();

  const searchText = `${name} ${subtype} ${description}`;

  for (const [keyword, subtypeValue] of Object.entries(mapping.keywords || {})) {
    if (searchText.includes(keyword)) {
      return subtypeValue;
    }
  }

  return mapping.default || "";
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const locations = await base44.entities.LocationReference.list("", 1000);

    const updates = [];
    for (const loc of locations) {
      if (!loc.subtype || loc.subtype.trim() === "") {
        const newSubtype = guessSubtype(loc);
        if (newSubtype) {
          updates.push({
            id: loc.id,
            oldSubtype: loc.subtype || "(empty)",
            newSubtype,
          });
          await base44.entities.LocationReference.update(loc.id, { subtype: newSubtype });
        }
      }
    }

    return Response.json({
      success: true,
      message: `Migrated ${updates.length} locations to new subtype enum`,
      updates,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
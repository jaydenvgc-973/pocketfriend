/**
 * Static venue NPC definitions for the Scene page.
 * These are fallback/background NPCs only — real assigned workers always take priority.
 * Extracted to reduce Scene file size and allow editing.
 */
export const VENUE_NPCS = {
  food_drink: [
    { id: "npc_server", name: "Server", role: "Server", npcType: "staff" },
    { id: "npc_bartender", name: "Bartender", role: "Bartender", npcType: "staff" },
    { id: "npc_diner_1", name: "Diner", role: "Customer", npcType: "customer" },
    { id: "npc_diner_2", name: "Couple nearby", role: "Customers", npcType: "customer" },
  ],
  social: [
    { id: "npc_bartender", name: "Bartender", role: "Bartender", npcType: "staff" },
    { id: "npc_security_guard", name: "Security Guard", role: "Security Guard", npcType: "staff" },
    { id: "npc_bar_patron_1", name: "Guy at the bar", role: "Patron", npcType: "customer" },
    { id: "npc_bar_patron_2", name: "Woman nearby", role: "Patron", npcType: "customer" },
    { id: "npc_group", name: "Group of friends", role: "Patrons", npcType: "customer" },
  ],
  gym: [
    { id: "npc_personal_trainer", name: "Personal Trainer", role: "Personal Trainer", npcType: "staff" },
    { id: "npc_front_desk_clerk", name: "Front Desk Clerk", role: "Front Desk Clerk", npcType: "staff" },
    { id: "npc_gym_goer_1", name: "Guy lifting weights", role: "Member", npcType: "customer" },
    { id: "npc_gym_goer_2", name: "Woman on treadmill", role: "Member", npcType: "customer" },
  ],
  grocery: [
    { id: "npc_cashier", name: "Cashier", role: "Cashier", npcType: "staff" },
    { id: "npc_stock_associate", name: "Stock Associate", role: "Stock Associate", npcType: "staff" },
    { id: "npc_shopper_1", name: "Shopper", role: "Customer", npcType: "customer" },
    { id: "npc_shopper_2", name: "Shopper with cart", role: "Customer", npcType: "customer" },
  ],
  business: [
    { id: "npc_sales_associate", name: "Sales Associate", role: "Sales Associate", npcType: "staff" },
    { id: "npc_store_manager", name: "Store Manager", role: "Store Manager", npcType: "staff" },
    { id: "npc_shopper_1", name: "Shopper", role: "Customer", npcType: "customer" },
    { id: "npc_shopper_2", name: "Customer browsing", role: "Customer", npcType: "customer" },
  ],
  // Clothing store specific — used when venueSubtype === 'clothing_store'
  clothing_store: [
    { id: "npc_sales_associate", name: "Sales Associate", role: "Sales Associate", npcType: "staff" },
    { id: "npc_store_manager", name: "Store Manager", role: "Store Manager", npcType: "staff" },
    { id: "npc_cashier", name: "Cashier", role: "Cashier", npcType: "staff" },
    { id: "npc_shopper_1", name: "Shopper", role: "Customer", npcType: "customer" },
  ],
  medical: [
    { id: "npc_medical_receptionist", name: "Medical Receptionist", role: "Medical Receptionist", npcType: "staff" },
    { id: "npc_nurse", name: "Nurse", role: "Nurse", npcType: "staff" },
    { id: "npc_patient", name: "Patient in waiting room", role: "Patient", npcType: "customer" },
  ],
  outdoor: [
    { id: "npc_park_ranger", name: "Park Ranger", role: "Park Ranger", npcType: "staff" },
    { id: "npc_jogger", name: "Jogger", role: "Visitor", npcType: "customer" },
    { id: "npc_dog_walker", name: "Dog walker", role: "Visitor", npcType: "customer" },
  ],
  workplace: [
    { id: "npc_receptionist", name: "Receptionist", role: "Receptionist", npcType: "staff" },
    { id: "npc_office_manager", name: "Office Manager", role: "Office Manager", npcType: "staff" },
    { id: "npc_coworker", name: "Coworker", role: "Colleague", npcType: "customer" },
  ],
  school: [
    { id: "npc_teacher", name: "Teacher", role: "Teacher", npcType: "staff" },
    { id: "npc_school_secretary", name: "School Secretary", role: "School Secretary", npcType: "staff" },
    { id: "npc_classmate", name: "Classmate", role: "Student", npcType: "customer" },
  ],
  hotel: [
    { id: "npc_hotel_concierge", name: "Hotel Concierge", role: "Hotel Concierge", npcType: "staff" },
    { id: "npc_front_desk_agent", name: "Front Desk Agent", role: "Front Desk Agent", npcType: "staff" },
    { id: "npc_hotel_guest", name: "Hotel Guest", role: "Guest", npcType: "customer" },
  ],
  shelter: [
    { id: "npc_shelter_intake_worker", name: "Shelter Intake Worker", role: "Shelter Intake Worker", npcType: "staff" },
    { id: "npc_case_manager", name: "Case Manager", role: "Case Manager", npcType: "staff" },
    { id: "npc_shelter_resident", name: "Shelter Resident", role: "Resident", npcType: "customer" },
  ],
  government: [
    { id: "npc_government_clerk", name: "Government Clerk", role: "Government Clerk", npcType: "staff" },
    { id: "npc_security_officer", name: "Security Officer", role: "Security Officer", npcType: "staff" },
    { id: "npc_visitor_1", name: "Visitor", role: "Visitor", npcType: "customer" },
  ],
  jail_prison: [
    { id: "npc_corrections_officer", name: "Corrections Officer", role: "Corrections Officer", npcType: "staff" },
    { id: "npc_court_officer", name: "Court Officer", role: "Court Officer", npcType: "staff" },
  ],
  religion: [
    { id: "npc_usher", name: "Usher", role: "Usher", npcType: "staff" },
    { id: "npc_congregation_member", name: "Congregation Member", role: "Congregation Member", npcType: "customer" },
  ],
  education: [
    { id: "npc_instructor", name: "Instructor", role: "Instructor", npcType: "staff" },
    { id: "npc_admin_staff", name: "Administrative Staff", role: "Administrative Staff", npcType: "staff" },
    { id: "npc_student", name: "Student", role: "Student", npcType: "customer" },
  ],
  community: [
    { id: "npc_community_coordinator", name: "Community Coordinator", role: "Community Coordinator", npcType: "staff" },
    { id: "npc_volunteer", name: "Volunteer", role: "Volunteer", npcType: "staff" },
    { id: "npc_community_member", name: "Community Member", role: "Community Member", npcType: "customer" },
  ],
};

// Category → required operational staff roles (for temporary NPC generation)
export const REQUIRED_STAFF_ROLES = {
  food_drink:  [{ id: "tmp_server",       name: "Server",              role: "Server",              npcType: "staff", isTemporary: true }],
  social:      [{ id: "tmp_bartender",    name: "Bartender",           role: "Bartender",           npcType: "staff", isTemporary: true },
                { id: "tmp_security",     name: "Security Guard",      role: "Security Guard",      npcType: "staff", isTemporary: true }],
  gym:         [{ id: "tmp_trainer",      name: "Fitness Instructor",  role: "Fitness Instructor",  npcType: "staff", isTemporary: true },
                { id: "tmp_front_desk",   name: "Front Desk Clerk",    role: "Front Desk Clerk",    npcType: "staff", isTemporary: true }],
  grocery:     [{ id: "tmp_cashier",      name: "Cashier",             role: "Cashier",             npcType: "staff", isTemporary: true }],
  business:    [{ id: "tmp_associate",    name: "Sales Associate",     role: "Sales Associate",     npcType: "staff", isTemporary: true }],
  medical:     [{ id: "tmp_receptionist", name: "Medical Receptionist","role": "Medical Receptionist", npcType: "staff", isTemporary: true }],
  hotel:       [{ id: "tmp_concierge",    name: "Hotel Concierge",     role: "Hotel Concierge",     npcType: "staff", isTemporary: true },
                { id: "tmp_front_desk",   name: "Front Desk Agent",    role: "Front Desk Agent",    npcType: "staff", isTemporary: true }],
  shelter:     [{ id: "tmp_intake",       name: "Shelter Intake Worker","role": "Shelter Intake Worker", npcType: "staff", isTemporary: true }],
  government:  [{ id: "tmp_gov_clerk",    name: "Government Clerk",    role: "Government Clerk",    npcType: "staff", isTemporary: true },
                { id: "tmp_sec_officer",  name: "Security Officer",    role: "Security Officer",    npcType: "staff", isTemporary: true }],
  jail_prison: [{ id: "tmp_co",           name: "Corrections Officer", role: "Corrections Officer", npcType: "staff", isTemporary: true }],
  school:      [{ id: "tmp_secretary",    name: "School Secretary",    role: "School Secretary",    npcType: "staff", isTemporary: true }],
  education:   [{ id: "tmp_instructor",   name: "Instructor",          role: "Instructor",          npcType: "staff", isTemporary: true }],
  workplace:   [{ id: "tmp_receptionist", name: "Receptionist",        role: "Receptionist",        npcType: "staff", isTemporary: true }],
  community:   [{ id: "tmp_coordinator",  name: "Community Coordinator","role": "Community Coordinator", npcType: "staff", isTemporary: true }],
  religion:    [{ id: "tmp_usher",        name: "Usher",               role: "Usher",               npcType: "staff", isTemporary: true }],
  outdoor:     [{ id: "tmp_park_ranger",  name: "Park Ranger",         role: "Park Ranger",         npcType: "staff", isTemporary: true }],
};

export const DEFAULT_VENUE_NPC = [
  { id: "npc_visitor", name: "Visitor", role: "Visitor", npcType: "customer" },
];
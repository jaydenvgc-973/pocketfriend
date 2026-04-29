/**
 * Static venue NPC definitions for the Scene page.
 * Extracted to reduce Scene file size and allow editing.
 */
export const VENUE_NPCS = {
  food_drink: [
    { id: "npc_waiter", name: "Waiter", role: "Server", npcType: "staff" },
    { id: "npc_bartender", name: "Bartender", role: "Bartender", npcType: "staff" },
    { id: "npc_diner_1", name: "Diner", role: "Customer", npcType: "customer" },
    { id: "npc_diner_2", name: "Couple nearby", role: "Customers", npcType: "customer" },
  ],
  social: [
    { id: "npc_bartender", name: "Bartender", role: "Bartender", npcType: "staff" },
    { id: "npc_bouncer", name: "Bouncer", role: "Security", npcType: "staff" },
    { id: "npc_bar_patron_1", name: "Guy at the bar", role: "Patron", npcType: "customer" },
    { id: "npc_bar_patron_2", name: "Woman nearby", role: "Patron", npcType: "customer" },
    { id: "npc_group", name: "Group of friends", role: "Patrons", npcType: "customer" },
  ],
  gym: [
    { id: "npc_trainer", name: "Personal Trainer", role: "Trainer", npcType: "staff" },
    { id: "npc_gym_front_desk", name: "Front Desk", role: "Staff", npcType: "staff" },
    { id: "npc_gym_goer_1", name: "Guy lifting weights", role: "Member", npcType: "customer" },
    { id: "npc_gym_goer_2", name: "Woman on treadmill", role: "Member", npcType: "customer" },
  ],
  grocery: [
    { id: "npc_cashier", name: "Cashier", role: "Cashier", npcType: "staff" },
    { id: "npc_stock_worker", name: "Stock Worker", role: "Staff", npcType: "staff" },
    { id: "npc_shopper_1", name: "Shopper", role: "Customer", npcType: "customer" },
    { id: "npc_shopper_2", name: "Mom with cart", role: "Customer", npcType: "customer" },
  ],
  business: [
    { id: "npc_store_clerk", name: "Store Clerk", role: "Sales Associate", npcType: "staff" },
    { id: "npc_store_manager", name: "Manager", role: "Manager", npcType: "staff" },
    { id: "npc_shopper_clothing_1", name: "Shopper", role: "Customer", npcType: "customer" },
    { id: "npc_shopper_clothing_2", name: "Woman browsing", role: "Customer", npcType: "customer" },
  ],
  medical: [
    { id: "npc_nurse", name: "Nurse", role: "Nurse", npcType: "staff" },
    { id: "npc_receptionist", name: "Receptionist", role: "Staff", npcType: "staff" },
    { id: "npc_patient", name: "Patient in waiting room", role: "Patient", npcType: "customer" },
  ],
  outdoor: [
    { id: "npc_jogger", name: "Jogger", role: "Passerby", npcType: "customer" },
    { id: "npc_dog_walker", name: "Dog walker", role: "Passerby", npcType: "customer" },
    { id: "npc_stranger", name: "Stranger on bench", role: "Passerby", npcType: "customer" },
  ],
  workplace: [
    { id: "npc_coworker", name: "Coworker", role: "Colleague", npcType: "staff" },
    { id: "npc_manager_work", name: "Manager", role: "Manager", npcType: "staff" },
  ],
  school: [
    { id: "npc_teacher", name: "Teacher", role: "Teacher", npcType: "staff" },
    { id: "npc_classmate", name: "Classmate", role: "Student", npcType: "customer" },
    { id: "npc_classmate_2", name: "Student nearby", role: "Student", npcType: "customer" },
  ],
};

export const DEFAULT_VENUE_NPC = [
  { id: "npc_local", name: "Local", role: "Nearby person", npcType: "customer" },
];
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Briefcase, Plus } from "lucide-react";
import BusinessPaymentEditor from "./BusinessPaymentEditor";
import CharacterBusinessModal from "./CharacterBusinessModal";
import BusinessCard from "./BusinessCard";

const BUSINESS_TYPE_CATEGORIES = {
  "Retail & Sales": ["Clothing Store / Boutique", "Convenience Store / Bodega", "Supermarket / Grocery Store", "Electronics Store", "Furniture Store", "Jewelry Store", "Online Retail Store (E-commerce)", "Thrift / Resale Shop"],
  "Food & Hospitality": ["Restaurant", "Café / Coffee Shop", "Bakery", "Catering Business", "Food Truck", "Bar", "Nightclub", "Lounge"],
  "Health & Wellness": ["Gym / Fitness Center", "Personal Training Business", "Yoga / Pilates Studio", "Spa / Massage Therapy", "Barber Shop", "Hair Salon", "Nail Salon", "Medical Practice / Clinic", "Therapy / Counseling Practice"],
  "Professional Services": ["Consulting Firm", "Marketing / Branding Agency", "Accounting / Tax Services", "Legal Practice", "Real Estate Agency", "Insurance Agency", "Staffing / Recruiting Agency"],
  "Creative & Media": ["Photography Business", "Videography / Production Company", "Music Studio / Label", "Graphic Design Business", "Fashion Design Brand", "Art Studio / Gallery", "Content Creation / Influencer Brand"],
  "Education & Child Services": ["Daycare / Childcare Center", "Tutoring Service", "Private School", "Training / Workshop Business"],
  "Transportation & Logistics": ["Delivery Service", "Trucking Company", "Rideshare / Car Service", "Moving Company"],
  "Home & Maintenance": ["Cleaning Service", "Landscaping Business", "Construction Company", "Handyman Services", "Property Management"],
  "Tech & Digital": ["App Development Company", "Software Company", "IT Services / Tech Support", "Cybersecurity Firm"],
  "Financial & Investment": ["Investment Firm", "Trading / Stock Business", "Lending / Finance Company"],
};



export default function CharacterBusinessesPanel({ characterId }) {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);

  const { data: allCharacters = [] } = useQuery({
    queryKey: ["characters_for_biz"],
    queryFn: async () => {
      await new Promise(r => setTimeout(r, 1200));
      return base44.entities.Character.filter({ status: "active" });
    },
    staleTime: 60000,
  });

  const { data: character = {} } = useQuery({
    queryKey: ["character", characterId],
    queryFn: () => base44.entities.Character.filter({ id: characterId }).then(r => r[0] || {}),
    enabled: !!characterId,
    staleTime: 30000,
  });

  const { data: ownedLocations = [] } = useQuery({
    queryKey: ["ownedLocations", characterId],
    queryFn: async () => {
      await new Promise(r => setTimeout(r, 800));
      return base44.entities.LocationReference.filter({ owner_character_id: characterId });
    },
    enabled: !!characterId,
  });

  const locationBasedBusinesses = ownedLocations.map(loc => ({
    id: loc.id,
    name: loc.name,
    type: loc.category || loc.location_type || "Location",
    visibility: loc.vip_access?.has_vip ? "private" : "public",
    isLocationBased: true,
    linkedLocationId: loc.id,
    income: loc.income_generated || 0,
    notes: loc.description || "",
    worker_character_ids: loc.worker_character_ids || [],
  }));

  const customBusinesses = character.businesses || [];

  const handleDeleteBusiness = async (businessId) => {
    if (!confirm("Delete this business?")) return;
    const results = await base44.entities.Character.filter({ id: characterId });
    const char = results[0];
    const updated = (char.businesses || []).filter(b => b.id !== businessId);
    await base44.entities.Character.update(characterId, { businesses: updated });
    queryClient.invalidateQueries({ queryKey: ["character", characterId] });
  };

  if (!ownedLocations.length && !customBusinesses.length) {
    return (
      <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-primary" />
            <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Businesses</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="p-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            title="Add business"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground italic">No businesses yet</p>
        {showModal && (
          <CharacterBusinessModal
            characterId={characterId}
            onClose={() => setShowModal(false)}
            onBusinessAdded={() => queryClient.invalidateQueries({ queryKey: ["character", characterId] })}
          />
        )}
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-primary" />
          <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Businesses</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="p-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          title="Add business"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-3">
        {customBusinesses.map(biz => (
          <BusinessCard
            key={biz.id}
            business={biz}
            characterId={characterId}
            isLocationBased={false}
            onDelete={handleDeleteBusiness}
            allCharacters={allCharacters}
          />
        ))}
        {locationBasedBusinesses.map(biz => (
          <BusinessCard
            key={biz.id}
            business={biz}
            characterId={characterId}
            isLocationBased={true}
            onDelete={handleDeleteBusiness}
            allCharacters={allCharacters}
          />
        ))}
      </div>

      {showModal && (
        <CharacterBusinessModal
          characterId={characterId}
          onClose={() => setShowModal(false)}
          onBusinessAdded={() => queryClient.invalidateQueries({ queryKey: ["character", characterId] })}
        />
      )}
    </div>
  );
}
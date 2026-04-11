import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Briefcase, MapPin, Lock, Globe, Eye, EyeOff } from "lucide-react";

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

function VisibilityIcon({ visibility }) {
  if (visibility === "public") return <Globe className="w-4 h-4 text-green-500" />;
  if (visibility === "private") return <Eye className="w-4 h-4 text-amber-500" />;
  return <EyeOff className="w-4 h-4 text-red-500" />;
}

function VisibilityLabel({ visibility }) {
  const map = { public: "Public", private: "Private", secret: "Secret" };
  return <span className="text-xs font-medium capitalize">{map[visibility] || visibility}</span>;
}

export default function CharacterBusinessesPanel({ characterId }) {
  const { data: character = {} } = useQuery({
    queryKey: ["character", characterId],
    queryFn: () => base44.entities.Character.filter({ id: characterId }).then(r => r[0] || {}),
    enabled: !!characterId,
  });

  const { data: ownedLocations = [] } = useQuery({
    queryKey: ["ownedLocations", characterId],
    queryFn: () => base44.entities.LocationReference.filter({ owner_character_id: characterId }),
    enabled: !!characterId,
  });

  if (!ownedLocations.length) {
    return null;
  }

  const locationBasedBusinesses = ownedLocations.map(loc => ({
    id: loc.id,
    name: loc.name,
    type: loc.category || loc.location_type || "Location",
    visibility: loc.vip_access?.has_vip ? "private" : "public", // placeholder; extend Location schema for actual visibility
    isLocationBased: true,
    linkedLocationId: loc.id,
    income: loc.income_generated || 0,
    workers: loc.worker_character_ids?.length || 0,
  }));

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Briefcase className="w-4 h-4 text-primary" />
        <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Businesses</p>
      </div>

      {locationBasedBusinesses.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Locations Owned</p>
          {locationBasedBusinesses.map(biz => (
            <div key={biz.id} className="pl-3 border-l-2 border-primary/30 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{biz.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{biz.type}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <VisibilityIcon visibility={biz.visibility} />
                </div>
              </div>
              {biz.income > 0 && (
                <p className="text-xs text-green-500">Income: ${biz.income.toLocaleString()}</p>
              )}
              {biz.workers > 0 && (
                <p className="text-xs text-muted-foreground">{biz.workers} {biz.workers === 1 ? "worker" : "workers"}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
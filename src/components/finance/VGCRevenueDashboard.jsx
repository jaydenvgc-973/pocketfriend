import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { TrendingUp, DollarSign, Phone, Users } from "lucide-react";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import { resolveUserScopedCharacters } from "@/lib/characterEditableListResolver";

function StatCard({ icon: Icon, label, value, sub, color = "text-primary" }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold text-foreground">{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function VGCRevenueDashboard({ userSettings }) {
  const [months] = useState(6);

  // Get current user for account-scoped filtering
  const { data: currentUser } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  // Fetch financial transactions scoped by character_id (VGC Mobile bills have no owner_email — written by service role)
  // We fetch all transactions and filter client-side by character IDs belonging to this user
  const { data: transactions = [], isLoading: txLoading } = useQuery({
    queryKey: ["allFinancialTransactions", currentUser?.email],
    queryFn: () => base44.entities.FinancialTransaction.list("-timestamp", 1000),
    enabled: !!currentUser?.email,
  });

  // ── AUTHORITATIVE CHARACTER ROSTER ───────────────────────────────────────────
  // Mirrors EXACTLY the same query path as Settings/useSettingsCharacters:
  //   1. RLS query by owner_email (handles legacy + migrated records)
  //   2. Backend fetchNPCsForUser (catches service-created records)
  //   3. resolveUserScopedCharacters for type resolution (legacy-safe)
  // This ensures the dashboard count matches the Settings "Active Characters (N)" header.

  const { data: rlsCharacters = [] } = useQuery({
    queryKey: ["characters", currentUser?.email],
    queryFn: () => base44.entities.Character.filter({ owner_email: currentUser.email }, "-created_date", 300),
    enabled: !!currentUser?.email,
  });

  const { data: npcFictitiousRaw = [] } = useQuery({
    queryKey: ["npc-characters", currentUser?.id],
    queryFn: async () => {
      if (!currentUser?.id) return [];
      const res = await base44.functions.invoke("fetchNPCsForUser", {});
      return res?.data?.npcs || [];
    },
    enabled: !!currentUser?.id,
  });

  // Merge + deduplicate (same logic as useSettingsCharacters)
  const allCharacters = useMemo(() => {
    const seen = new Set();
    return [...rlsCharacters, ...npcFictitiousRaw].filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }, [rlsCharacters, npcFictitiousRaw]);

  // Resolve types via the same authoritative resolver used by Settings
  // This handles legacy null types, migrated records, and all character variants
  const scopedCharacters = useMemo(
    () => resolveUserScopedCharacters(allCharacters, currentUser?.id, currentUser?.email),
    [allCharacters, currentUser?.id, currentUser?.email]
  );

  // Active created characters — same classification as Settings "Active Characters" section
  // Excludes: deleted, soft_deleted, merged, NPCs, family members
  const createdActiveCharacters = useMemo(
    () => scopedCharacters.filter(c =>
      c._resolvedType === 'active_created_character' &&
      !['deleted', 'soft_deleted', 'merged'].includes(c.status)
    ),
    [scopedCharacters]
  );

  const createdActiveCharIds = new Set(createdActiveCharacters.map(c => c.id));

  // Fetch ALL character financials — records are created by backend service, not the user
  const { data: allCharFinancials = [] } = useQuery({
    queryKey: ["allCharacterFinancials", currentUser?.email],
    queryFn: () => base44.entities.CharacterFinancial.list("-updated_date", 200),
    enabled: !!currentUser?.email,
  });

  // For each active created character, find their most recently updated financial record
  // (some characters may have duplicate records — always use the latest)
  const charFinancialMap = {};
  for (const cf of allCharFinancials) {
    if (!createdActiveCharIds.has(cf.character_id)) continue;
    if (!charFinancialMap[cf.character_id] || cf.updated_date > charFinancialMap[cf.character_id].updated_date) {
      charFinancialMap[cf.character_id] = cf;
    }
  }

  if (txLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        Loading revenue data...
      </div>
    );
  }

  // Build monthly buckets for the last N months
  const now = new Date();
  const monthBuckets = Array.from({ length: months }, (_, i) => {
    const d = subMonths(now, months - 1 - i);
    const key = format(d, "MMM yyyy");
    const start = startOfMonth(d).toISOString();
    const end = endOfMonth(d).toISOString();
    return { key, start, end, label: format(d, "MMM") };
  });

  // Scope all transaction metrics to this user's characters only
  const userCharacterIds = new Set(allCharacters.map(c => c.id));

  // VGC Mobile bills: expense transactions from VGC Mobile system for user's characters
  const vgcIncome = transactions.filter(t =>
    userCharacterIds.has(t.character_id) &&
    t.direction === "expense" &&
    t.sender_name === "VGC Mobile"
  );

  // Total character expenses = ALL expense-direction transactions for user's characters
  const charExpenses = transactions.filter(t =>
    userCharacterIds.has(t.character_id) &&
    t.direction === "expense"
  );

  const chartData = monthBuckets.map(({ key, label, start, end }) => {
    const vgcRev = vgcIncome
      .filter(t => t.timestamp >= start && t.timestamp <= end)
      .reduce((s, t) => s + (t.amount || 0), 0);

    const totalExp = charExpenses
      .filter(t => t.timestamp >= start && t.timestamp <= end)
      .reduce((s, t) => s + (t.amount || 0), 0);

    return { label, vgcRevenue: Math.round(vgcRev), charExpenses: Math.round(totalExp) };
  });

  // UserSettings.vgc_mobile_revenue is the authoritative accumulated total written by processMonthlyVGCMobileBilling
  // Use it as the all-time VGC revenue figure; fall back to summing transactions if not set
  const totalVGCRevenue = userSettings?.vgc_mobile_revenue ?? vgcIncome.reduce((s, t) => s + (t.amount || 0), 0);
  const totalCharExp = charExpenses.reduce((s, t) => s + (t.amount || 0), 0);
  const userBalance = userSettings?.user_balance ?? 0;
  const activeCharCount = createdActiveCharacters.length;

  const tooltipStyle = {
    backgroundColor: "hsl(240 5% 10%)",
    border: "1px solid hsl(240 4% 18%)",
    borderRadius: "8px",
    color: "hsl(0 0% 95%)",
    fontSize: "12px",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <Phone className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">VGC Mobile Revenue Dashboard</h3>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard icon={DollarSign} label="Your Balance" value={`$${userBalance.toLocaleString()}`} sub="current" color="text-green-400" />
        <StatCard icon={Phone} label="Total VGC Revenue" value={`$${Math.round(totalVGCRevenue).toLocaleString()}`} sub="all time" color="text-primary" />
        <StatCard icon={TrendingUp} label="Char. Expenses" value={`$${Math.round(totalCharExp).toLocaleString()}`} sub="all time tracked" color="text-amber-400" />
        <StatCard icon={Users} label="Active Accounts" value={activeCharCount} sub="active created characters" color="text-blue-400" />
      </div>

      {/* Revenue trend */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <p className="text-xs font-semibold text-foreground uppercase tracking-wider">VGC Revenue vs Character Expenses</p>
        <p className="text-[10px] text-muted-foreground">Last {months} months</p>
        {chartData.every(d => d.vgcRevenue === 0 && d.charExpenses === 0) ? (
          <p className="text-xs text-muted-foreground italic py-6 text-center">No transaction data yet. Revenue will appear after the first billing cycle.</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="vgcGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(262 83% 68%)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(262 83% 68%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(45 80% 60%)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(45 80% 60%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 4% 18%)" />
              <XAxis dataKey="label" tick={{ fill: "hsl(0 0% 55%)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "hsl(0 0% 55%)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`$${v.toLocaleString()}`, undefined]} />
              <Legend wrapperStyle={{ fontSize: 10, color: "hsl(0 0% 55%)" }} />
              <Area type="monotone" dataKey="vgcRevenue" name="VGC Revenue" stroke="hsl(262 83% 68%)" fill="url(#vgcGrad)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="charExpenses" name="Char. Expenses" stroke="hsl(45 80% 60%)" fill="url(#expGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Per-character balance bars — only active created characters */}
      {createdActiveCharacters.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Character Balances</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={createdActiveCharacters.map(char => ({
                name: char.name?.split(" ")[0] || "?",
                balance: Math.round(charFinancialMap[char.id]?.current_balance ?? 0),
              }))}
              margin={{ top: 5, right: 5, bottom: 0, left: -20 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 4% 18%)" />
              <XAxis dataKey="name" tick={{ fill: "hsl(0 0% 55%)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "hsl(0 0% 55%)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`$${v.toLocaleString()}`, "Balance"]} />
              <Bar dataKey="balance" fill="hsl(262 83% 68%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
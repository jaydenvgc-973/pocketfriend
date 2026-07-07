import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { DollarSign, Phone, TrendingUp, Users } from "lucide-react";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import { resolveUserScopedCharacters } from "@/lib/characterEditableListResolver";
import ProfileSectionHeader from "@/components/profile/ProfileSectionHeader";

function StatCard({ icon: Icon, label, value, sub, color = "text-primary" }) {
  return (
    <div className="bg-secondary/40 border border-border/60 rounded-xl p-3 flex items-start gap-2.5">
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">{label}</p>
        <p className="text-base font-bold text-foreground leading-tight">{value}</p>
        {sub && <p className="text-[9px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  );
}

export default function ProfileAnalytics({ userSettings }) {
  const [months] = useState(6);

  const { data: currentUser } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { data: transactions = [], isLoading: txLoading } = useQuery({
    queryKey: ["allFinancialTransactions", currentUser?.email],
    queryFn: () => base44.entities.FinancialTransaction.list("-timestamp", 1000),
    enabled: !!currentUser?.email,
  });

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

  const allCharacters = useMemo(() => {
    const seen = new Set();
    return [...rlsCharacters, ...npcFictitiousRaw].filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }, [rlsCharacters, npcFictitiousRaw]);

  const scopedCharacters = useMemo(
    () => resolveUserScopedCharacters(allCharacters, currentUser?.id, currentUser?.email),
    [allCharacters, currentUser?.id, currentUser?.email]
  );

  const createdActiveCharacters = useMemo(
    () => scopedCharacters.filter(c =>
      c._resolvedType === 'active_created_character' &&
      !['deleted', 'soft_deleted', 'merged'].includes(c.status)
    ),
    [scopedCharacters]
  );

  const createdActiveCharIds = new Set(createdActiveCharacters.map(c => c.id));

  const { data: allCharFinancials = [] } = useQuery({
    queryKey: ["allCharacterFinancials", currentUser?.email],
    queryFn: () => base44.entities.CharacterFinancial.list("-updated_date", 200),
    enabled: !!currentUser?.email,
  });

  const charFinancialMap = useMemo(() => {
    const map = {};
    for (const cf of allCharFinancials) {
      if (!createdActiveCharIds.has(cf.character_id)) continue;
      if (!map[cf.character_id] || cf.updated_date > map[cf.character_id].updated_date) {
        map[cf.character_id] = cf;
      }
    }
    return map;
  }, [allCharFinancials, createdActiveCharIds]);

  if (txLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        Loading analytics...
      </div>
    );
  }

  const now = new Date();
  const monthBuckets = Array.from({ length: months }, (_, i) => {
    const d = subMonths(now, months - 1 - i);
    const key = format(d, "MMM yyyy");
    const start = startOfMonth(d).toISOString();
    const end = endOfMonth(d).toISOString();
    return { key, start, end, label: format(d, "MMM") };
  });

  const userCharacterIds = new Set(allCharacters.map(c => c.id));

  const vgcIncome = transactions.filter(t =>
    userCharacterIds.has(t.character_id) &&
    t.direction === "expense" &&
    t.sender_name === "VGC Mobile"
  );

  const charExpenses = transactions.filter(t =>
    userCharacterIds.has(t.character_id) &&
    t.direction === "expense"
  );

  const chartData = monthBuckets.map(({ label, start, end }) => {
    const vgcRev = vgcIncome
      .filter(t => t.timestamp >= start && t.timestamp <= end)
      .reduce((s, t) => s + (t.amount || 0), 0);
    const totalExp = charExpenses
      .filter(t => t.timestamp >= start && t.timestamp <= end)
      .reduce((s, t) => s + (t.amount || 0), 0);
    return { label, vgcRevenue: Math.round(vgcRev), charExpenses: Math.round(totalExp) };
  });

  const totalVGCRevenue = userSettings?.vgc_mobile_revenue ?? vgcIncome.reduce((s, t) => s + (t.amount || 0), 0);
  const totalCharExp = Object.values(charFinancialMap).reduce((s, cf) => s + (cf.total_expenses || 0), 0);
  const userBalance = userSettings?.user_balance ?? 0;
  const activeCharCount = createdActiveCharacters.length;

  const tooltipStyle = {
    backgroundColor: "hsl(240 5% 10%)",
    border: "1px solid hsl(240 4% 18%)",
    borderRadius: "8px",
    color: "hsl(0 0% 95%)",
    fontSize: "12px",
  };

  const charBalanceData = createdActiveCharacters.map(char => ({
    name: char.name?.split(" ")[0] || "?",
    balance: Math.round(charFinancialMap[char.id]?.current_balance ?? 0),
  }));

  return (
    <>
      {/* ═══ REVENUE DASHBOARD — STACKED ═══ */}
      <section className="bg-card border border-border rounded-2xl p-5">
        <ProfileSectionHeader icon={Phone} title="Revenue Dashboard" />
        {/* Summary cards on top — 2x2 grid */}
        <div className="grid grid-cols-2 gap-2.5 mb-3">
          <StatCard icon={DollarSign} label="Balance" value={`$${userBalance.toLocaleString()}`} sub="current" color="text-green-400" />
          <StatCard icon={Phone} label="VGC Revenue" value={`$${Math.round(totalVGCRevenue).toLocaleString()}`} sub="all time" color="text-primary" />
          <StatCard icon={TrendingUp} label="Char. Expenses" value={`$${Math.round(totalCharExp).toLocaleString()}`} sub="tracked" color="text-amber-400" />
          <StatCard icon={Users} label="Active Accounts" value={activeCharCount} sub="characters" color="text-blue-400" />
        </div>
        {/* Revenue vs Expenses graph — full width below */}
        <div className="bg-secondary/30 border border-border/50 rounded-xl p-3 flex flex-col">
          <p className="text-[9px] font-semibold text-foreground uppercase tracking-wider mb-1">Revenue vs Expenses</p>
          <p className="text-[8px] text-muted-foreground mb-2">Last {months} months</p>
          {chartData.every(d => d.vgcRevenue === 0 && d.charExpenses === 0) ? (
            <div className="flex-1 flex items-center justify-center text-center py-4">
              <p className="text-[10px] text-muted-foreground italic">No data yet</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: -25 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 4% 18%)" />
                <XAxis dataKey="label" tick={{ fill: "hsl(0 0% 55%)", fontSize: 8 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "hsl(0 0% 55%)", fontSize: 8 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`$${v.toLocaleString()}`, undefined]} />
                <Line type="monotone" dataKey="vgcRevenue" name="Revenue" stroke="hsl(262 83% 68%)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="charExpenses" name="Expenses" stroke="hsl(45 80% 60%)" strokeWidth={2} dot={false} />
                <Legend wrapperStyle={{ fontSize: 8, color: "hsl(0 0% 55%)" }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* ═══ CHARACTER BALANCES — FULL WIDTH ═══ */}
      {createdActiveCharacters.length > 0 && (
        <section className="bg-card border border-border rounded-2xl p-5">
          <ProfileSectionHeader icon={DollarSign} title="Character Balances" subtitle={`${createdActiveCharacters.length} active characters`} />
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={charBalanceData}
              margin={{ top: 5, right: 5, bottom: 5, left: -20 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 4% 18%)" />
              <XAxis dataKey="name" tick={{ fill: "hsl(0 0% 55%)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "hsl(0 0% 55%)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`$${v.toLocaleString()}`, "Balance"]} cursor={{ fill: "hsl(240 4% 18%)" }} />
              <Bar dataKey="balance" fill="hsl(262 83% 68%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>
      )}
    </>
  );
}
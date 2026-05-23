import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { TrendingUp, DollarSign, Phone, Users } from "lucide-react";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";

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

  // Fetch financial transactions for current user only
  const { data: transactions = [], isLoading: txLoading } = useQuery({
    queryKey: ["allFinancialTransactions", currentUser?.email],
    queryFn: () => base44.entities.FinancialTransaction.filter({ character_id: { $exists: true } }, "-timestamp", 500),
    enabled: !!currentUser?.email,
  });

  // Fetch only active characters owned by current user
  const { data: activeCharacters = [] } = useQuery({
    queryKey: ["activeCharacters", currentUser?.email],
    queryFn: () => base44.entities.Character.filter({ owner_email: currentUser.email, status: "active" }, null, 200),
    enabled: !!currentUser?.email,
  });

  // Filter to ONLY active_created_character type — excludes NPCs, family NPCs, background, etc.
  const createdActiveCharacters = activeCharacters.filter(c => c.character_type === "active_created_character");
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

  // VGC Mobile income = transactions with transaction_type "utilities" or description matching VGC, direction "income", sender_type "character"
  // More precisely: user income transactions that match VGC Mobile
  const vgcIncome = transactions.filter(t =>
    t.direction === "income" &&
    (t.description?.toLowerCase().includes("vgc mobile") || t.transaction_type === "utilities")
  );

  // Total character expenses (expense direction, character sender)
  const charExpenses = transactions.filter(t =>
    t.direction === "expense" && t.sender_type === "character"
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

  const totalVGCRevenue = vgcIncome.reduce((s, t) => s + (t.amount || 0), 0);
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
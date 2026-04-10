import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from 'recharts';

const CATEGORY_COLORS = {
  rent: '#ef4444',
  utilities: '#f97316',
  groceries: '#eab308',
  gym: '#06b6d4',
  tuition: '#a855f7',
  childcare: '#ec4899',
  phone: '#3b82f6',
  internet: '#8b5cf6',
  automotive: '#f59e0b',
  insurance: '#10b981',
  subscription: '#6366f1',
  custom: '#6b7280',
};

export default function ExpenseBreakdownChart({ transactions }) {
  if (!transactions || transactions.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-xs text-muted-foreground">
        No expense data to display
      </div>
    );
  }

  // Group expenses by transaction type
  const expenseData = {};
  transactions
    .filter(t => t.direction === 'expense')
    .forEach(t => {
      const type = t.transaction_type || 'other';
      const label = t.transaction_type === 'bar_restaurant' ? 'Food' : 
                   t.transaction_type === 'scene_purchase' ? 'Scene' :
                   (type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' '));
      if (!expenseData[label]) {
        expenseData[label] = 0;
      }
      expenseData[label] += t.amount || 0;
    });

  const chartData = Object.entries(expenseData)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-xs text-muted-foreground">
        No expenses this month
      </div>
    );
  }

  const getColor = (name) => {
    const key = name.toLowerCase().replace(/\s+/g, '_');
    return CATEGORY_COLORS[key] || CATEGORY_COLORS.custom;
  };

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={({ name, value }) => `${name}: $${value.toLocaleString()}`}
            outerRadius={80}
            fill="#8884d8"
            dataKey="value"
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={getColor(entry.name)} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => `$${value.toLocaleString()}`}
            contentStyle={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', border: '1px solid #333' }}
          />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
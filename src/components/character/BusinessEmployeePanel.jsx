import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Plus, Trash2, Users, DollarSign } from "lucide-react";

const PAY_TYPES = ["hourly", "monthly"];

function EmployeeRow({ emp, onRemove, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [rate, setRate] = useState(emp.pay_rate || 0);
  const [type, setType] = useState(emp.pay_type || "monthly");
  const [title, setTitle] = useState(emp.job_title || "");

  const save = () => {
    onUpdate(emp.character_id, { pay_rate: parseFloat(rate), pay_type: type, job_title: title });
    setEditing(false);
  };

  return (
    <div className="bg-secondary/40 rounded-lg p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        {emp.avatar_url
          ? <img src={emp.avatar_url} alt={emp.character_name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
          : <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] font-bold text-primary">{emp.character_name?.[0]}</span>
            </div>
        }
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground truncate">{emp.character_name}</p>
          {!editing && (
            <p className="text-[10px] text-muted-foreground">
              {emp.job_title || "Employee"} · ${emp.pay_rate || 0}/{emp.pay_type || "monthly"}
            </p>
          )}
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button
            onClick={() => setEditing(v => !v)}
            className="text-[10px] text-primary hover:text-primary/80 font-medium px-1.5 py-0.5 rounded"
          >
            {editing ? "Cancel" : "Edit"}
          </button>
          <button
            onClick={() => onRemove(emp.character_id)}
            className="text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {editing && (
        <div className="space-y-1.5">
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Job title"
            className="w-full bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 border border-border outline-none focus:ring-1 focus:ring-primary/50"
          />
          <div className="flex gap-2">
            <input
              type="number"
              value={rate}
              onChange={e => setRate(e.target.value)}
              placeholder="Pay rate"
              min="0"
              className="flex-1 bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 border border-border outline-none focus:ring-1 focus:ring-primary/50"
            />
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              className="bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 border border-border outline-none"
            >
              {PAY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <button
            onClick={save}
            className="w-full text-xs text-primary-foreground bg-primary rounded-lg py-1.5 hover:bg-primary/90 transition-colors"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

export default function BusinessEmployeePanel({ business, characterId, onBusinessUpdate, allCharacters = [] }) {
  const queryClient = useQueryClient();
  const [showPicker, setShowPicker] = useState(false);

  const employees = business.employees || [];

  const availableChars = allCharacters.filter(c =>
    c.id !== characterId &&
    !employees.some(e => e.character_id === c.id)
  );

  const addEmployee = (char) => {
    const updated = [...employees, {
      character_id: char.id,
      character_name: char.name,
      avatar_url: char.avatar_url || null,
      job_title: "",
      pay_rate: 0,
      pay_type: "monthly",
    }];
    onBusinessUpdate({ employees: updated });
    setShowPicker(false);
  };

  const removeEmployee = (charId) => {
    onBusinessUpdate({ employees: employees.filter(e => e.character_id !== charId) });
  };

  const updateEmployee = (charId, fields) => {
    const updated = employees.map(e => e.character_id === charId ? { ...e, ...fields } : e);
    onBusinessUpdate({ employees: updated });
  };

  const monthlyPayroll = employees.reduce((sum, e) => {
    if (e.pay_type === "hourly") return sum + (e.pay_rate || 0) * 160; // ~160hrs/month
    return sum + (e.pay_rate || 0);
  }, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5 text-muted-foreground" />
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Employees</p>
        </div>
        {monthlyPayroll > 0 && (
          <span className="text-[10px] text-red-400 font-medium">-${monthlyPayroll.toFixed(0)}/mo payroll</span>
        )}
      </div>

      {employees.length === 0 && (
        <p className="text-[10px] text-muted-foreground italic">No employees yet</p>
      )}

      <div className="space-y-1.5">
        {employees.map(emp => (
          <EmployeeRow
            key={emp.character_id}
            emp={emp}
            onRemove={removeEmployee}
            onUpdate={updateEmployee}
          />
        ))}
      </div>

      {showPicker ? (
        <div className="bg-secondary/60 rounded-lg max-h-40 overflow-y-auto border border-border">
          {availableChars.length === 0 && (
            <p className="text-xs text-muted-foreground italic p-3">No characters available</p>
          )}
          {availableChars.map(c => (
            <button
              key={c.id}
              onClick={() => addEmployee(c)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-secondary transition-colors text-left"
            >
              {c.avatar_url
                ? <img src={c.avatar_url} alt={c.name} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                : <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-bold text-primary">{c.name?.[0]}</span>
                  </div>
              }
              <span className="text-xs text-foreground">{c.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <button
          onClick={() => setShowPicker(true)}
          className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
        >
          <Plus className="w-3 h-3" /> Add employee
        </button>
      )}
    </div>
  );
}
/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
    safelist: [
      // Ring colors - existing
      "ring-emerald-500/40", "ring-orange-500/40", "ring-red-500/40", "ring-blue-500/40", "ring-zinc-600/40", "ring-pink-500/40", "ring-slate-500/40", "ring-orange-600/40", "ring-yellow-500/40",
      "ring-purple-500/40", "ring-blue-600/40", "ring-amber-400/40", "ring-rose-500/40", "ring-teal-400/40", "ring-red-600/40",
      // Ring colors - new states
      "ring-yellow-400/40", "ring-yellow-300/40", "ring-teal-300/40", "ring-amber-500/40", "ring-sky-400/40",
      "ring-green-400/40", "ring-lime-400/40", "ring-pink-400/40", "ring-rose-400/40", "ring-pink-300/40",
      "ring-violet-300/40", "ring-indigo-400/40", "ring-blue-400/40", "ring-cyan-400/40", "ring-emerald-400/40",
      "ring-purple-400/40", "ring-indigo-300/40", "ring-amber-300/40", "ring-orange-300/40", "ring-violet-400/40",
      "ring-rose-300/40", "ring-purple-300/40", "ring-red-400/40", "ring-pink-600/40",
      "ring-sky-500/40", "ring-green-500/40", "ring-teal-500/40", "ring-emerald-300/40", "ring-cyan-300/40",
      "ring-orange-400/40", "ring-red-500/40", "ring-red-700/40", "ring-red-800/40",
      "ring-green-600/40", "ring-lime-600/40", "ring-zinc-500/40", "ring-slate-400/40", "ring-amber-600/40",
      "ring-orange-700/40", "ring-purple-700/40", "ring-amber-700/40", "ring-stone-500/40", "ring-stone-600/40",
      "ring-rose-600/40", "ring-slate-600/40", "ring-blue-700/40", "ring-indigo-700/40",
      "ring-slate-700/40", "ring-zinc-700/40", "ring-zinc-800/40", "ring-stone-400/40",
      // Background colors
      "bg-emerald-400", "bg-orange-400", "bg-red-400", "bg-blue-400", "bg-zinc-500",
      "bg-orange-950/40", "bg-red-950/30", "bg-blue-950/30", "bg-zinc-900",
      "bg-blue-500", "bg-emerald-500", "bg-pink-500", "bg-orange-500", "bg-purple-500",
      // Text colors - existing
      "text-emerald-400", "text-orange-400", "text-red-400", "text-blue-400", "text-zinc-400",
      // Text colors - new states
      "text-yellow-400", "text-yellow-300", "text-teal-300", "text-amber-500", "text-sky-400",
      "text-green-400", "text-lime-400", "text-pink-400", "text-rose-400", "text-pink-300",
      "text-violet-300", "text-indigo-400", "text-cyan-400", "text-purple-400", "text-indigo-300",
      "text-amber-300", "text-orange-300", "text-violet-400", "text-rose-300", "text-purple-300",
      "text-red-400", "text-pink-600", "text-sky-500", "text-green-500", "text-teal-500",
      "text-emerald-300", "text-cyan-300", "text-orange-500", "text-red-700", "text-red-800",
      "text-green-600", "text-lime-600", "text-zinc-500", "text-slate-400", "text-amber-600",
      "text-orange-700", "text-purple-700", "text-amber-700", "text-stone-500", "text-stone-600",
      "text-rose-600", "text-slate-600", "text-blue-700", "text-indigo-700",
      "text-slate-700", "text-zinc-700", "text-zinc-800", "text-stone-400",
    ],
  theme: {
  	extend: {
  		fontFamily: {
  			inter: ['var(--font-inter)']
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
}
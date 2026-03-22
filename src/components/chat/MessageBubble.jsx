import { motion } from "framer-motion";
import { format } from "date-fns";

const emotionalColors = {
  calm: "bg-secondary",
  irritated: "bg-orange-950/40",
  defensive: "bg-red-950/30",
  reflective: "bg-blue-950/30",
  "closed-off": "bg-zinc-900"
};

export default function MessageBubble({ message, showName = false }) {
  const isUser = message.sender_type === "user";
  const bgColor = isUser ? "bg-primary" : (emotionalColors[message.emotional_state] || "bg-secondary");
  const time = message.timestamp ? format(new Date(message.timestamp), "h:mm a") : "";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex ${isUser ? "justify-end" : "justify-start"} px-4 mb-1`}
    >
      <div className={`max-w-[80%] ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        {showName && !isUser && message.character_name && (
          <span className="text-xs text-primary/70 ml-3 mb-1 font-medium">{message.character_name}</span>
        )}
        <div className={`${bgColor} ${isUser ? "rounded-2xl rounded-br-sm text-primary-foreground" : "rounded-2xl rounded-bl-sm text-foreground"} overflow-hidden`}>
          {message.image_url && (
            <img
              src={message.image_url}
              alt="shared photo"
              className="w-full max-w-xs rounded-t-2xl object-cover"
            />
          )}
          {message.content && (
            <p className="text-sm leading-relaxed whitespace-pre-wrap px-4 py-2.5">{message.content}</p>
          )}
        </div>
        {time && (
          <span className={`text-[10px] text-muted-foreground mt-1 ${isUser ? "mr-2" : "ml-2"}`}>{time}</span>
        )}
      </div>
    </motion.div>
  );
}
import { motion } from "framer-motion";

function TypingIndicator({ isTyping, label = "Typing" }) {
  if (!isTyping) return null;

  return (
    <div className="flex items-center gap-2 text-sm font-bold text-slate-500">
      <span>{label}</span>
      <div className="flex gap-1">
        {[0, 1, 2].map((item) => (
          <motion.span
            key={item}
            animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
            transition={{ repeat: Infinity, duration: 0.9, delay: item * 0.12 }}
            className="h-1.5 w-1.5 rounded-full bg-blue-600"
          />
        ))}
      </div>
    </div>
  );
}

export default TypingIndicator;

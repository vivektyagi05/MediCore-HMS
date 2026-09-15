import { Bot, Send } from "lucide-react";
import { useState } from "react";
import { getApiErrorMessage } from "../../api/axios";
import { aiApi } from "../../api/aiApi";
import Button from "../ui/Button";
import Input from "../ui/Input";

function AIChatbotPanel() {
  const [messages, setMessages] = useState([
    { role: "assistant", text: "Hi, I can guide booking, payments, records, and safe symptom triage." },
  ]);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const send = async () => {
    if (!message.trim()) return;
    const userMessage = message.trim();
    setMessage("");
    setMessages((current) => [...current, { role: "user", text: userMessage }]);
    setIsLoading(true);
    try {
      const response = await aiApi.chatbot({ message: userMessage });
      setMessages((current) => [...current, { role: "assistant", text: response.data.reply }]);
    } catch (error) {
      setMessages((current) => [...current, { role: "assistant", text: getApiErrorMessage(error) }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/70 bg-white/60 shadow-xl backdrop-blur-lg">
      <div className="border-b border-slate-200 p-4">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-blue-600 p-2 text-white"><Bot size={18} /></span>
          <div>
            <p className="font-black text-slate-950">HMS AI Chatbot</p>
            <p className="text-xs font-semibold text-slate-500">Support guidance, not diagnosis</p>
          </div>
        </div>
      </div>
      <div className="max-h-80 space-y-3 overflow-y-auto p-4">
        {messages.map((item, index) => (
          <div key={`${item.role}-${index}`} className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}>
            <p className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm font-semibold leading-6 shadow-lg ${item.role === "user" ? "bg-blue-600 text-white" : "bg-white text-slate-700"}`}>
              {item.text}
            </p>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-200 p-4">
        <div className="flex gap-3">
          <Input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") send();
            }}
            placeholder="Ask about bookings, invoices, records..."
          />
          <Button className="h-12 w-12 px-0" onClick={send} isLoading={isLoading}>
            <Send size={17} />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default AIChatbotPanel;

import { Mail, MapPin, Phone } from "lucide-react";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";

function Contact() {
  return (
    <section className="px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.85fr_1.15fr]">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Contact</p>
          <h1 className="mt-4 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
            Talk to the HMS Pro team.
          </h1>
          <p className="mt-6 text-base leading-8 text-slate-600">
            Share your hospital workflow goals and connect this interface to your operational model.
          </p>

          <div className="mt-8 space-y-4">
            {[
              { icon: Mail, text: "hello@hmspro.example" },
              { icon: Phone, text: "+91 98765 43210" },
              { icon: MapPin, text: "Bengaluru, India" },
            ].map((item) => (
              <div key={item.text} className="flex items-center gap-3 rounded-2xl bg-white/60 p-4 shadow-lg">
                <item.icon className="text-blue-600" size={20} />
                <span className="text-sm font-bold text-slate-700">{item.text}</span>
              </div>
            ))}
          </div>
        </div>

        <Card>
          <form className="grid gap-4">
            <Input label="Full name" name="name" placeholder="Dr. Asha Mehra" />
            <Input label="Email address" name="email" type="email" placeholder="asha@hospital.com" />
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Message</span>
              <textarea
                className="min-h-36 w-full resize-none rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
                placeholder="Tell us about your HMS requirements..."
              />
            </label>
            <Button type="submit" className="mt-2">Send Message</Button>
          </form>
        </Card>
      </div>
    </section>
  );
}

export default Contact;

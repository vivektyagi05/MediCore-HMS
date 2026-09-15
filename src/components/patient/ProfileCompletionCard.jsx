import Card from "../ui/Card";

function ProfileCompletionCard({ completion }) {
  return (
    <Card title="Profile Completion">
      <div className="flex items-center gap-5">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-3xl font-black text-white">
          {completion?.percentage || 0}%
        </div>
        <div>
          <p className="font-black text-slate-950">Complete your health profile</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Missing: {completion?.missing?.length ? completion.missing.join(", ") : "Nothing. You are all set."}
          </p>
        </div>
      </div>
    </Card>
  );
}

export default ProfileCompletionCard;

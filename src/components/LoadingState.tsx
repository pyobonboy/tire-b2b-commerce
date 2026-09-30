import { Loader2 } from "lucide-react";

export default function LoadingState() {
  return (
    <div className="flex items-center justify-center gap-2 p-10 text-center text-muted text-sm">
      <Loader2 size={16} className="animate-spin" />
      불러오는 중...
    </div>
  );
}

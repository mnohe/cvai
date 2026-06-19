import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { db } from "@/lib/firebase";
import { ActionComplete, ActionFailed, type Action } from "@/lib/types";

export function ActionProgress({
  actionId,
  onComplete,
  onFailed,
}: {
  actionId: string;
  onComplete: () => void;
  onFailed: (reason: string) => void;
}) {
  const { user } = useAuth();
  const [action, setAction] = useState<Action | null>(null);

  useEffect(() => {
    if (!user || !actionId) return;

    const unsubscribe = onSnapshot(doc(db, "users", user.uid, "actions", actionId), (snapshot) => {
      if (!snapshot.exists()) return;

      const nextAction = snapshot.data() as Action;
      setAction(nextAction);
      if (nextAction.status === ActionComplete) {
        unsubscribe();
        onComplete();
      }
      if (nextAction.status === ActionFailed) {
        unsubscribe();
        onFailed(nextAction.error ?? "Import failed");
      }
    });

    return unsubscribe;
  }, [actionId, onComplete, onFailed, user]);

  const percent = action?.progress.percent ?? (action ? 20 : 8);
  const label = action?.progress.message ?? "Analysing...";

  return (
    <div className="action-progress" aria-live="polite">
      <div className="panel-row">
        <p>{label}</p>
        <span className="muted">{percent}%</span>
      </div>
      <div className="cv-progress" role="progressbar" aria-label="CV import progress" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

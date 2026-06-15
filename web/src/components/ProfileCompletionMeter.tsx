import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/components/AuthProvider";
import { db } from "@/lib/firebase";
import {
  getProfileCompletion,
  type CompletionState,
} from "@/lib/profileCompletion";
import type { Candidate } from "@/lib/types";

export function ProfileCompletionMeter({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [completion, setCompletion] = useState<CompletionState>(
    getProfileCompletion(),
  );

  useEffect(() => {
    if (!user) {
      setCompletion(getProfileCompletion());
      return;
    }

    return onSnapshot(
      doc(db, "users", user.uid, "candidate", "profile"),
      (snapshot) => {
        setCompletion(
          getProfileCompletion(
            snapshot.exists()
              ? ({ id: user.uid, ...snapshot.data() } as Partial<Candidate>)
              : undefined,
          ),
        );
      },
      () => setCompletion(getProfileCompletion()),
    );
  }, [user]);

  const tone = useMemo(() => {
    if (completion.score === 0) return "meter-red";
    if (completion.score === 1) return "meter-amber";
    return "meter-green";
  }, [completion.score]);

  if (completion.score >= 5) {
    return null;
  }

  return (
    <button
      type="button"
      aria-label={`Profile completion ${completion.score} of 5`}
      className={`profile-meter ${tone} ${compact ? "profile-meter-compact" : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        navigate("/profile/cv?completion=open");
      }}
    >
      {compact ? (
        <span className="profile-pip filled" aria-hidden="true" />
      ) : (
        <span className="profile-pips" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((index) => (
            <span
              className={index < completion.score ? "profile-pip filled" : "profile-pip"}
              key={index}
            />
          ))}
        </span>
      )}
      {!compact && (
        <span className="profile-score">{completion.score}/5</span>
      )}
    </button>
  );
}

import { Link, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { QuickBookingWizard } from "../components/quick-booking/QuickBookingWizard";

export function QuickBookingPage() {
  const { t } = useTranslation();
  const { staffMember, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-xl text-zinc-400">
        {t("common.loading")}
      </div>
    );
  }

  if (!staffMember) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-black text-zinc-100">
      <div className="border-b border-white/5 bg-black/20 px-3 py-3 backdrop-blur-md sm:px-4">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2">
          <Link
            to="/reception"
            className="min-h-[48px] rounded-xl px-3 py-3 text-base text-sky-300 hover:text-sky-200"
          >
            ← {t("quickBook.backToReception")}
          </Link>
          <Link to="/" className="min-h-[48px] rounded-xl px-3 py-3 text-sm text-zinc-500 hover:text-zinc-300">
            CRM
          </Link>
        </div>
      </div>
      <QuickBookingWizard createdByStaffId={staffMember.id} />
    </div>
  );
}

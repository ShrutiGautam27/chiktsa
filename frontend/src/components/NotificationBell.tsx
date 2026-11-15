import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { useNotifications } from "@/hooks/care-queries";

export function NotificationBell() {
  const n = useNotifications();
  const unread = n.data?.unread ?? 0;
  return (
    <Link to="/app/notifications" className="relative rounded-full p-2 text-ink-700 hover:bg-sage-100"
      aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
      <Bell className="size-5" aria-hidden />
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-danger-600 px-1 text-[10px] font-semibold text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}

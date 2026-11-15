export type MedStatus = "pending_verification" | "active" | "paused" | "ended";
export type Severity = "blocking" | "warning";

export interface MedIssue { code: string; field: string; severity: Severity; message: string }
export interface Refill {
  tracked: boolean;
  stock?: number;
  dailyUse?: number;
  daysRemaining?: number;
  depletionDate?: string;
  level?: "ok" | "low" | "critical" | "out";
  checklist?: string[];
}
export interface Medication {
  id: string;
  seniorId: string;
  householdId: string;
  name: string;
  strength: string;
  form: string;
  doseQuantity: number | null;
  doseUnit: string;
  route: string;
  frequencyText: string;
  times: string[];
  daysOfWeek: number[];
  startDate: string | null;
  endDate: string | null;
  instructions: string;
  prescriber: string;
  source: "manual" | "prescription";
  prescriptionText: string;
  uncertainFields: string[];
  stockQuantity: number | null;
  lowStockDays: number;
  responsibleUid: string | null;
  pharmacy: string;
  status: MedStatus;
  verification: { verifiedByName: string; verifiedAt: string; acknowledgedWarnings: string[] } | null;
  issues: MedIssue[];
  blockingCount: number;
  refill: Refill;
  createdAt: string;
}
export interface DoseEvent {
  id: string;
  medicationId: string;
  medicationName: string;
  doseQuantity: number;
  doseUnit: string;
  instructions: string;
  scheduledFor: string;
  status: "scheduled" | "unconfirmed" | "taken" | "skipped";
  recordedBy: string | null;
  responsibleUid: string | null;
}
export interface Adherence {
  days: number;
  totals: { taken: number; skipped: number; unconfirmed: number };
  recordedTakenRate: number | null;
  byMedication: { medicationId: string; name: string; taken: number; skipped: number; unconfirmed: number }[];
  daily: { date: string; taken: number; skipped: number; unconfirmed: number }[];
  note: string;
}
export interface JourneyEntry { id: string; at: string; action: string; summary: string; actorName: string; changes: Record<string, { from: unknown; to: unknown }> | null }

export interface Appointment {
  id: string;
  householdId: string;
  seniorId: string;
  seniorName: string;
  title: string;
  providerName: string;
  location: string;
  startsAt: string;
  durationMinutes: number;
  notes: string;
  questions: string[];
  status: "scheduled" | "completed" | "cancelled";
  escortUid: string | null;
  escortName: string | null;
  escortAccepted: boolean;
  history: { from: string; to: string; reason: string; by: string; at: string }[];
  visitNotes: string;
  coverNeeded: boolean;
}

export type TaskStatus = "open" | "assigned" | "accepted" | "done" | "cancelled";
export interface CareTask {
  id: string;
  householdId: string;
  householdName?: string;
  seniorId: string | null;
  seniorName: string | null;
  title: string;
  description: string;
  redacted: boolean;
  kind: string;
  priority: "low" | "normal" | "high";
  status: TaskStatus;
  assigneeUid: string | null;
  assigneeName: string | null;
  createdByName: string;
  dueAt: string | null;
  overdue: boolean;
  coverNeeded: boolean;
  completedByName?: string | null;
}

export interface Gap {
  id: string;
  type: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  targetType: string;
  targetId: string;
  seniorId: string | null;
  seniorName: string | null;
  link: string;
  action: string;
}
export interface GapReport { generatedAt: string; counts: Record<"high" | "medium" | "low", number>; total: number; gaps: Gap[] }

export interface Handover {
  id: string;
  fromUid: string;
  fromName: string;
  toUid: string;
  toName: string;
  seniorIds: string[];
  seniorNames: Record<string, string>;
  observations: string;
  instructions: string[];
  scheduleChanges: string;
  status: "pending" | "acknowledged";
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgementNote: string;
  snapshot: {
    since: string;
    completedTasks: { id: string; title: string; completedByName: string }[];
    pendingTasks: { id: string; title: string; status: string; assigneeName: string | null; dueAt: string | null }[];
    upcomingAppointments: { id: string; title: string; startsAt: string; escortName: string | null; postponedSinceLastHandover: boolean }[];
    dosesRecorded: Record<string, number>;
    medicationChanges: { at: string; summary: string; by: string }[];
    medicationDetailsRestricted?: boolean;
  };
}
export interface Candidate { uid: string; displayName: string; role: string }
export interface Absence {
  id: string;
  uid: string;
  name: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  status: "active" | "cancelled";
  items: { type: "task" | "appointment"; id: string; seniorId: string | null; seniorName: string | null; title: string; dueAt: string | null; coveredBy: string | null; coveredByName: string | null; candidates: Candidate[] }[];
  uncovered: number;
}

export interface ContributionRow {
  uid: string;
  displayName: string;
  role: string;
  canTakeTasks: boolean;
  assignedPending: number;
  accepted: number;
  completed: number;
  overdue: number;
  escortUpcoming: number;
  dosesRecorded: number;
  handoversWritten: number;
  currentLoad: number;
  imbalanced: boolean;
  unavailableNow: boolean;
}
export interface Contribution {
  windowDays: number;
  members: ContributionRow[];
  unassignedTasks: number;
  averageLoad: number;
  fullView: boolean;
  suggestions: { taskId: string; taskTitle: string; fromUid: string; fromName: string; toUid: string; toName: string; reason: string }[];
  principle: string;
}
export interface HouseholdOverview {
  householdId: string;
  householdName: string;
  role: string;
  profiles: number;
  myOpenTasks: number;
  unassignedTasks: number;
  appointmentsNext7Days: number;
  gaps: Record<"high" | "medium" | "low", number> | null;
}
export interface Responsibilities {
  myTasks: CareTask[];
  claimable: CareTask[];
  escorts: { id: string; householdId: string; householdName: string; seniorId: string; seniorName: string; title: string; startsAt: string; location: string; escortAccepted: boolean; mine: boolean }[];
  handoversToAcknowledge: { id: string; householdId: string; householdName: string; fromName: string; createdAt: string }[];
  coverRequests: { absenceId: string; householdId: string; householdName: string; absentName: string; itemType: "task" | "appointment"; itemId: string; title: string; dueAt: string | null }[];
}
export interface ConsentView {
  seniorId: string;
  categories: string[];
  members: { uid: string; displayName: string; role: string; roleLabel: string; state: "full" | "limited" | "revoked" | "expired" | "owner"; categories: string[]; expiresAt: string | null; expiringSoon: boolean; restrictable: boolean }[];
  history: { at: string; summary: string; actorName: string }[];
}
export interface AppNotification {
  id: string; kind: string; title: string; body: string; link: string; read: boolean; createdAt: string; householdId: string | null;
  ackRequired?: boolean; acknowledgedAt?: string | null; deliveries?: Delivery[];
  meta?: { seniorId?: string; medicationId?: string; scheduledFor?: string; appointmentId?: string };
}

export const CATEGORY_LABELS: Record<string, string> = {
  medications: "Medications",
  appointments: "Appointments",
  care_notes: "Care notes",
  documents: "Documents",
};

export interface Delivery { channel: "in_app" | "email" | "push"; status: string; at: string; error?: string }
export interface NotificationRules {
  doseReminders: boolean;
  escalationSteps: { afterMinutes: number; roles: string[] }[];
  quietHours: { enabled: boolean; start: string; end: string };
  appointmentReminderHours: number[];
  escortConfirmHours: number;
  taskDueReminderHours: number;
  handoverReminderHours: number;
  lowStockAlerts: boolean;
  consentExpiryNoticeDays: number;
}
export interface ReminderActivity {
  id: string;
  kind: "dose" | "stock";
  seniorId: string | null;
  seniorName: string | null;
  medicationName: string | null;
  scheduledFor: string | null;
  status: "sent" | "escalated" | "acknowledged" | "resolved";
  recipients: string[];
  escalations: { step: number; at: string; recipients: string[] }[];
  heldUntil: string | null;
  acknowledgedByName: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
}
export interface DeliveryPrefs { prefs: { email: boolean; push: boolean }; channels: Record<string, string>; devices: number }
